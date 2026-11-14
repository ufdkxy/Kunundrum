// Kunundrum native exact solver. C++17; no dependencies. K2/K3 codes.
#include <algorithm>
#include <array>
#include <chrono>
#include <climits>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <functional>
#include <iostream>
#include <limits>
#include <numeric>
#include <queue>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
using namespace std;
using Byte=uint8_t;
static constexpr int MAX_CELLS=1024;
static const string DIR="udlr", COLORS="RGBY*";
int colorIndex(char c){auto n=COLORS.find(c);if(n==string::npos)throw runtime_error("invalid color");return (int)n;}
int dx[4]={0,0,-1,1},dy[4]={1,-1,0,0};
string trim(string s){auto a=s.find_first_not_of(" \t\r\n"),b=s.find_last_not_of(" \t\r\n");return a==string::npos?"":s.substr(a,b-a+1);}
vector<Byte> b64decode(string s){vector<Byte> out;int acc=0,bits=0;for(char c:s){int v= c>='A'&&c<='Z'?c-'A':c>='a'&&c<='z'?c-'a'+26:c>='0'&&c<='9'?c-'0'+52:c=='-'?62:c=='_'?63:-1;if(v<0)throw runtime_error("invalid base64url character");acc=(acc<<6)|v;bits+=6;if(bits>=8){bits-=8;out.push_back((Byte)(acc>>bits));acc&=(1<<bits)-1;}}if(bits>=6||acc)throw runtime_error("invalid base64url padding");return out;}
string b64encode(const vector<Byte>& b){static const char* abc="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";string o;int v=0,n=0;for(Byte x:b){v=(v<<8)|x;n+=8;while(n>=6){n-=6;o.push_back(abc[(v>>n)&63]);}}if(n)o.push_back(abc[(v<<(6-n))&63]);return o;}
void putuint(vector<Byte>& b,uint64_t v){do{Byte c=v&127;v>>=7;b.push_back(c|(v?128:0));}while(v);}
struct Reader{const vector<Byte>& b;size_t i=0;vector<string> dictionary; Reader(const vector<Byte>&b):b(b){} Byte byte(){if(i>=b.size())throw runtime_error("truncated board");return b[i++];} uint64_t u(){uint64_t x=0;for(int z=0;z<8;z++){Byte k=byte();x|=(uint64_t)(k&127)<<(7*z);if(!(k&128))return x;}throw runtime_error("invalid varint");}string str(){uint64_t t=u();if(t&1){size_t j=(t-1)/2;if(j>=dictionary.size())throw runtime_error("invalid string reference");return dictionary[j];}size_t n=t/2;if(n>20000||i+n>b.size())throw runtime_error("invalid string length");string s(b.begin()+i,b.begin()+i+n);i+=n;dictionary.push_back(s);return s;}int count(){auto n=u();if(n>4096)throw runtime_error("unreasonably large feature list");return (int)n;}};
struct Ball{int p,color,ordinal;string name;};
struct Gate{int p;string id,group;bool active;};
struct Switch{int p;string id;bool on;vector<string> groups,teleports;};
struct Teleport{int a,b,color;string id;bool active;};
struct Hex{int p,value;string id;};
struct Arrow{int p,dir;bool rotating;};
struct Board{
 int w=0,h=0;string id,title,description; bool hasDescription=false;vector<Ball> balls;vector<int> wall,goals;vector<Gate> gates;vector<Switch> switches;vector<Teleport> teleports;vector<Hex> hexes;vector<Arrow> arrows;vector<Byte> prefix,tail;string storedSolution;
 array<int,MAX_CELLS> fixed,arrowAt,gateAt,switchAt,teleAt,hexAt,goalColor;vector<vector<int>> groupGates,switchGroups,switchTele;
 vector<uint8_t> gateInit,teleInit,switchInit;int n=0;bool staticReverse=false;int initialScore=0;
 int at(int x,int y)const{return y*w+x;}bool inside(int x,int y)const{return x>=0&&x<w&&y>=0&&y<h;}
 void initialize(){
  if(w<1||h<1||w*h>MAX_CELLS||balls.empty()||balls.size()>128)throw runtime_error("unsupported board dimensions or ball count");
  n=balls.size();fixed.fill(0);arrowAt.fill(-1);gateAt.fill(-1);switchAt.fill(-1);teleAt.fill(-1);hexAt.fill(-1);goalColor.fill(-1);
  for(int p:wall){if(p<0||p>=w*h)throw runtime_error("bad wall");fixed[p]=1;}
  for(int g:goals){int p=g%MAX_CELLS,c=g/MAX_CELLS;goalColor[p]=c;}
  for(int i=0;i<(int)arrows.size();i++)arrowAt[arrows[i].p]=i;
  for(int i=0;i<(int)gates.size();i++)gateAt[gates[i].p]=i;
  for(int i=0;i<(int)switches.size();i++)switchAt[switches[i].p]=i;
  for(int i=0;i<(int)hexes.size();i++)hexAt[hexes[i].p]=i;
  for(int i=0;i<(int)teleports.size();i++){teleAt[teleports[i].a]=i;teleAt[teleports[i].b]=i;}
  unordered_map<string,int> groups, teleids;for(int i=0;i<(int)gates.size();i++)if(!groups.count(gates[i].group))groups[gates[i].group]=groups.size();
  groupGates.resize(groups.size());for(int i=0;i<(int)gates.size();i++)groupGates[groups[gates[i].group]].push_back(i);
  for(int i=0;i<(int)teleports.size();i++)teleids[teleports[i].id]=i;
  for(const auto &s:switches){vector<int> gs,ts;for(auto g:s.groups){if(!groups.count(g))throw runtime_error("unknown switch wall group");gs.push_back(groups[g]);}for(auto t:s.teleports){if(!teleids.count(t))throw runtime_error("unknown switch teleport ID");ts.push_back(teleids[t]);}switchGroups.push_back(gs);switchTele.push_back(ts);}
  for(auto g:gates)gateInit.push_back(g.active);
  for(auto t:teleports)teleInit.push_back(t.active);
  for(auto s:switches)switchInit.push_back(s.on);
  staticReverse=hexes.empty()&&none_of(arrows.begin(),arrows.end(),[](auto a){return a.rotating;});
 }
};
Board parseCode(string code){code=trim(code);if(code.rfind("K3.",0)!=0&&code.rfind("K2.",0)!=0)throw runtime_error("expected K2. or K3. board code");auto raw=b64decode(code.substr(3));Reader r(raw);int magic=r.byte();if(magic!=0xB2&&magic!=0xB3)throw runtime_error("invalid board magic");Board b;b.w=r.byte();b.h=r.byte();int flags=r.u();if(flags>3||b.w<1||b.h<1||b.w>32||b.h>32)throw runtime_error("invalid board header");b.id=r.str();b.title=r.str();if(flags&1){b.hasDescription=true;b.description=r.str();}
 size_t solutionStart=r.i;if(flags&2){if(magic==0xB2)b.storedSolution=r.str();else{size_t len=r.u();if(r.i+len>raw.size())throw runtime_error("truncated solution");r.i+=len;}}size_t bodyStart=r.i;
 b.prefix.assign(raw.begin()+4,raw.begin()+solutionStart);
 auto at=[&](){int p=r.u();if(p>=b.w*b.h)throw runtime_error("position out of bounds");return p;};
 for(int i=r.count();i>0;i--)b.wall.push_back(at());
 for(int i=r.count();i>0;i--){int p=at(),c=r.u();if(c>=4)throw runtime_error("invalid ball color");b.balls.push_back({p,c,0,""});}
 for(int i=r.count();i>0;i--){int p=at(),c=r.u();if(c>=4)throw runtime_error("invalid goal color");b.goals.push_back((int)c*MAX_CELLS+p);}
 for(int i=r.count();i>0;i--){int p=at(),v=r.u();if(v>7)throw runtime_error("invalid arrow");b.arrows.push_back({p,(int)v/2,(bool)(v%2)});}
 for(int i=r.count();i>0;i--){int p=at();string id=r.str(),g=r.str();bool act=r.u();b.gates.push_back({p,id,g,act});}
 for(int i=r.count();i>0;i--){int p=at();string id=r.str();bool on=r.u();vector<string> gs,ts;for(int k=r.count();k>0;k--)gs.push_back(r.str());for(int k=r.count();k>0;k--)ts.push_back(r.str());b.switches.push_back({p,id,on,gs,ts});}
 for(int i=r.count();i>0;i--){string id=r.str();int c=r.u(),act=r.u(),p=at(),q=at();if(c>=5)throw runtime_error("invalid teleport color");b.teleports.push_back({p,q,c,id,(bool)act});}
 for(int i=r.count();i>0;i--){int p=at();string id=r.str();uint64_t value=r.u();int signedValue=value&1?-(int)((value+1)/2):(int)(value/2);b.hexes.push_back({p,signedValue,id});}
 if(r.i!=raw.size())throw runtime_error("trailing board data");
 b.tail.assign(raw.begin()+bodyStart,raw.end());
 // Core.validateBoard sorts balls by color, then (y,x).
 stable_sort(b.balls.begin(),b.balls.end(),[](const Ball&a,const Ball&z){return a.color!=z.color?a.color<z.color:a.p<z.p;});
 for(int i=0;i<(int)b.balls.size();i++){int count=0,k=0;for(int j=0;j<(int)b.balls.size();j++)if(b.balls[j].color==b.balls[i].color){count++;if(j<=i)k++;}b.balls[i].ordinal=k;b.balls[i].name=string(1,COLORS[b.balls[i].color])+(count==1?"":to_string(k));}
 b.initialize();return b;
}
struct State{vector<uint16_t> p;vector<Byte> gate,tele,sw,hex;};
State initial(const Board&b){State s;for(const auto& x:b.balls)s.p.push_back(x.p);s.gate=b.gateInit;s.tele=b.teleInit;s.sw=b.switchInit;s.hex.assign(b.hexes.size(),0);return s;}
// The state is unlabelled within a color. Same-colored balls are physically interchangeable.
string stateKey(const Board&b,const State&s,int depth){string k; k.reserve(b.n*2+s.gate.size()+s.tele.size()+s.sw.size()+s.hex.size()+8);for(int i=0;i<b.n;){int j=i;while(j<b.n&&b.balls[j].color==b.balls[i].color)j++;vector<uint16_t> temp(s.p.begin()+i,s.p.begin()+j);sort(temp.begin(),temp.end());for(auto x:temp){k.push_back(char(x&255));k.push_back(char(x>>8));}i=j;}for(auto v:s.gate)k.push_back(char(v));for(auto v:s.tele)k.push_back(char(v));/* Switch visual on/off flags do not affect transitions. */for(auto v:s.hex)k.push_back(char(v));if(!b.hexes.empty()){
 // Hex boards: key on the score (moves so far + consumed hex values), clamped. Once the score is at least
 // 1 - (sum of unconsumed negative hex values), no future acceptance check can fail, so all larger scores
 // behave identically and share one key; below the cap the score still separates states exactly.
 long long score=depth,neg=0;for(size_t i=0;i<s.hex.size();i++){if(s.hex[i])score+=b.hexes[i].value;else if(b.hexes[i].value<0)neg+=b.hexes[i].value;}
 if(score>1-neg)score=1-neg;
 for(int j=0;j<4;j++)k.push_back(char(((uint32_t)score>>(8*j))&255));}
 return k;}
struct Move{uint16_t source=0;uint8_t color=0,dir=0;string choices;};
struct Transition{State s;Move m;};
// Performs a complete move for a ball found at source. Choice string contains udlr.
// Returns 1 for success, 0 blocked/loop, 2 more rotating-arrow choices needed.
int simulate(const Board&b,const State&s,int bi,int direction,const string& choices,State&ns,int&delta,int&choicesUsed){
 int p=s.p[bi],h=direction;delta=1;choicesUsed=0;vector<uint8_t> consumed=s.hex;vector<uint8_t> occ(b.w*b.h,0);for(int i=0;i<b.n;i++)if(i!=bi)occ[s.p[i]]=1;
 // loop-detection signature consists of p, direction and choices used
 unordered_set<uint64_t> visited;bool entered=false;
 bool stopped=false;
 for(int steps=0;steps<65536;steps++){
  uint64_t signature=((uint64_t)choicesUsed*4+h)*1024+p;
  if(!visited.insert(signature).second)return 0;
  int x=p%b.w+dx[h],y=p/b.w+dy[h];if(!b.inside(x,y)){stopped=true;break;}
  int np=b.at(x,y);if(b.fixed[np]||occ[np]){stopped=true;break;}
  int gi=b.gateAt[np];if(gi>=0&&s.gate[gi]){stopped=true;break;}
  entered=true;p=np;
  int hi=b.hexAt[p];if(hi>=0&&!consumed[hi]){consumed[hi]=1;delta+=b.hexes[hi].value;}
  int ai=b.arrowAt[p];if(ai>=0){auto a=b.arrows[ai];if(a.rotating){if(choicesUsed==(int)choices.size())return 2;int q=DIR.find(choices[choicesUsed++]);if(q<0||q>=4)return 0;h=q;}else h=a.dir;}
  int ti=b.teleAt[p];if(ti>=0&&s.tele[ti]&&(b.teleports[ti].color==4||b.teleports[ti].color==b.balls[bi].color)){
   auto t=b.teleports[ti];int exit=(t.a==p?t.b:t.a);if(occ[exit]){stopped=true;break;}p=exit;
  }
 }
 if(!stopped||!entered||choicesUsed!=(int)choices.size())return 0;
 ns=s;ns.p[bi]=p;ns.hex=move(consumed);
 int sw=b.switchAt[p];if(sw>=0){ns.sw[sw]^=1;for(int group:b.switchGroups[sw]){bool blocked=false;for(int g:b.groupGates[group])if(!ns.gate[g]){for(auto ball:ns.p)if(ball==b.gates[g].p)blocked=true;}if(!blocked)for(int g:b.groupGates[group])ns.gate[g]^=1;}for(int t:b.switchTele[sw])ns.tele[t]^=1;}
 return 1;
}
int scoreHex(const Board&b,const State&s,int depth){int v=depth;for(int i=0;i<(int)b.hexes.size();i++)if(s.hex[i])v+=b.hexes[i].value;return v;}
bool complete(const Board&b,const State&s){for(int i=0;i<b.n;i++)if(b.goalColor[s.p[i]]!=b.balls[i].color)return false;return true;}
bool accepted(const Board&b,const State&s,int depth){return complete(b,s)&&scoreHex(b,s,depth)>=1;}
struct Stats{uint64_t transitions=0,expanded=0;bool truncatedChoices=false;};
void successors(const Board&b,const State&s,int maxChoices,Stats&stats,const function<void(Transition&&)>& emit){
 for(int i=0;i<b.n;i++){
  if(b.goalColor[s.p[i]]==b.balls[i].color)continue;
  for(int d=0;d<4;d++){
   vector<string> stack{string()};while(!stack.empty()){
    string choices=move(stack.back());stack.pop_back();State n;int delta=0,used=0;stats.transitions++;int ok=simulate(b,s,i,d,choices,n,delta,used);
    if(ok==1){emit({move(n),{s.p[i],(Byte)b.balls[i].color,(Byte)d,move(choices)}});}
    else if(ok==2){if((int)choices.size()>=maxChoices){stats.truncatedChoices=true;continue;}for(int j=3;j>=0;j--)stack.push_back(choices+DIR[j]);}
   }
  }
 }
}
struct Node{State s;uint32_t parent;Move m;int depth;};
struct SearchResult{bool solved=false,exhaustive=false,truncated=false,boundProved=false;vector<Move> path;uint64_t states=0,transitions=0;int depth=0;string algorithm;};
struct Limits{uint64_t maxStates=2000000;double seconds=60;int maxChoices=8;int maxDepth=0;/* 0 = unlimited */bool verbose=true;string algorithm="auto";};
using Clock=chrono::steady_clock;
struct ClockLimit{Clock::time_point start=Clock::now();double seconds;explicit ClockLimit(double s):seconds(s){} bool expired()const{return chrono::duration<double>(Clock::now()-start).count()>=seconds;}double elapsed()const{return chrono::duration<double>(Clock::now()-start).count();}};
// Lower bound on the final score of any accepted route continuing from state s (reached after `depth` moves): every
// unlocked ball still needs at least one move (+1 each), and the best case collects every unconsumed negative hex.
long long scoreLowerBound(const Board&b,const State&s,int depth){long long v=scoreHex(b,s,depth);for(int i=0;i<b.n;i++)if(b.goalColor[s.p[i]]!=b.balls[i].color)v++;for(size_t i=0;i<s.hex.size();i++)if(!s.hex[i]&&b.hexes[i].value<0)v+=b.hexes[i].value;return v;}
// Objective: the lowest score (moves plus hex bonuses and penalties); among equal scores, the fewest moves.
// Without hexes the score equals the move count, so the first accepted state of the breadth-first search is optimal.
// With hexes a longer route can score lower, so the search continues past the first accepted state and prunes every
// state whose scoreLowerBound cannot beat the best score found. Equal-score routes are found in order of move count.
SearchResult forwardBFS(const Board&b,const Limits&lim,ClockLimit&timer){SearchResult out;out.algorithm="forward BFS";State s0=initial(b);vector<Node> nodes;nodes.reserve(min<uint64_t>(lim.maxStates,1000000));nodes.push_back({s0,0,{},0});unordered_map<string,uint32_t> seen;seen.reserve(min<uint64_t>(lim.maxStates,1000000));seen.emplace(stateKey(b,s0,0),0);Stats stats;int old=-1;
 if(accepted(b,s0,0)){out.solved=true;out.exhaustive=true;return out;}
 const bool byScore=!b.hexes.empty();
 long long negAll=0;for(const auto&h:b.hexes)if(h.value<0)negAll+=h.value;
 long long best=LLONG_MAX;
 size_t head=0;uint32_t found=0;bool success=false,limit=false,depthCut=false;
 for(;head<nodes.size()&&!(success&&!byScore);head++){
  if(nodes.size()>=lim.maxStates||timer.expired()){limit=true;break;}
  const auto& cur=nodes[head];if(cur.depth!=old){old=cur.depth;if(lim.verbose){cerr<<"forward depth "<<old<<" visited "<<seen.size()<<" elapsed "<<timer.elapsed()<<"s";if(byScore&&success)cerr<<" best score "<<best;cerr<<"\n";}}
  State parentState=cur.s;int dep=cur.depth;
  if(byScore&&success&&scoreLowerBound(b,parentState,dep)>=best)continue; // cannot beat the best route found so far
  successors(b,parentState,lim.maxChoices,stats,[&](Transition&& t){if(limit||(success&&!byScore))return;string key=stateKey(b,t.s,dep+1);if(seen.count(key))return;
   const bool acc=accepted(b,t.s,dep+1);
   if(byScore&&!acc&&success&&scoreLowerBound(b,t.s,dep+1)>=best)return;
   if(lim.maxDepth>0&&dep+1>=lim.maxDepth){ // Last allowed layer: only test acceptance. These states are never expanded, so they are not stored.
    if(acc){long long sc=scoreHex(b,t.s,dep+1);if(!success||sc<best){best=sc;found=(uint32_t)nodes.size();nodes.push_back({move(t.s),(uint32_t)head,move(t.m),dep+1});}success=true;}else depthCut=true;
    return;}
   if(nodes.size()>=lim.maxStates){limit=true;return;}uint32_t ni=nodes.size();seen.emplace(move(key),ni);nodes.push_back({move(t.s),(uint32_t)head,move(t.m),dep+1});
   if(acc){long long sc=scoreHex(b,nodes.back().s,dep+1);if(!success||sc<best){best=sc;found=ni;}success=true;}});
  stats.expanded++;
 }
 out.states=seen.size();out.transitions=stats.transitions;out.truncated=stats.truncatedChoices;out.solved=success;
 const bool covered=!limit&&!stats.truncatedChoices; // every state within the limits was explored and no rotating-arrow choices were dropped
 if(success){
  // Without hexes the first accepted state is shortest. With hexes the whole space must be covered; under --max-depth D a longer
  // route (more than D moves) scores at least D+1 plus every negative hex, so it can only matter if that bound is below best.
  out.exhaustive=!byScore?!stats.truncatedChoices:covered&&(!depthCut||(long long)lim.maxDepth+1+negAll>=best);
  out.depth=nodes[found].depth;while(found){out.path.push_back(nodes[found].m);found=nodes[found].parent;}reverse(out.path.begin(),out.path.end());
 }else{out.exhaustive=covered&&!depthCut;out.boundProved=covered&&depthCut;}
 return out;
}
// Fast static-rule move for bidirectional search; no mutable mechanics, rotating arrows or hexes.
int fastEnd(const Board&b,const State&s,int i,int d){
 static thread_local array<uint32_t,MAX_CELLS*4> visited{};
 static thread_local uint32_t ticket=0;
 if(++ticket==0){visited.fill(0);ticket=1;}
 int p=s.p[i],h=d;bool entered=false,stopped=false;
 for(int steps=0;steps<MAX_CELLS*4;steps++){
  uint32_t &stamp=visited[p*4+h];if(stamp==ticket)return -1;stamp=ticket;
  int x=p%b.w+dx[h],y=p/b.w+dy[h];if(!b.inside(x,y)){stopped=true;break;}
  int np=b.at(x,y);if(b.fixed[np]){stopped=true;break;}
  int gate=b.gateAt[np];if(gate>=0&&s.gate[gate]){stopped=true;break;}
  bool occupied=false;for(int j=0;j<b.n;j++)if(j!=i&&s.p[j]==np){occupied=true;break;}
  if(occupied){stopped=true;break;}
  entered=true;p=np;
  int ai=b.arrowAt[p];if(ai>=0)h=b.arrows[ai].dir;
  int ti=b.teleAt[p];if(ti>=0&&s.tele[ti]&&(b.teleports[ti].color==4||b.teleports[ti].color==b.balls[i].color)){
   auto t=b.teleports[ti];int exit=t.a==p?t.b:t.a;
   bool occ=false;for(int j=0;j<b.n;j++)if(j!=i&&s.p[j]==exit){occ=true;break;}
   if(occ){stopped=true;break;}p=exit;
  }
 }
 return stopped&&entered?p:-1; // Reject loops (all 4*cell states exhausted).
}
struct BiNode {State s;uint32_t parent;Move m;uint16_t depth;};
SearchResult bidirectional(const Board&b,const Limits&lim,ClockLimit&timer){
 SearchResult out;out.algorithm="bidirectional BFS";const int D=lim.maxDepth>0?lim.maxDepth:INT32_MAX; // D: only paths of at most D moves matter
 if(!b.staticReverse||b.goals.size()!=b.balls.size())return out;
 State start=initial(b),target=start;
 for(int c=0;c<4;c++){
  vector<int> loc;for(int v:b.goals)if(v/MAX_CELLS==c)loc.push_back(v%MAX_CELLS);sort(loc.begin(),loc.end());
  int idx=0;for(int i=0;i<b.n;i++)if(b.balls[i].color==c){if(idx>=(int)loc.size())return out;target.p[i]=loc[idx++];}
 }
 if(complete(b,start)){out.exhaustive=true;out.states=1;return out;}
 // Enumerate all possible terminal wall-group polarities. Gates belonging to
 // a group always toggle together, so their relative active states are invariant.
 // A gate group with k walls needs only ONE bit, not k bits.
 // Switch visual state is intentionally excluded from the search key.
 vector<BiNode> reverseNodes;reverseNodes.reserve(min<uint64_t>(lim.maxStates/2,400000));
 unordered_map<string,uint32_t> reverseSeen;reverseSeen.reserve(min<uint64_t>(lim.maxStates/2,400000));
 const int groupCount=(int)b.groupGates.size();
 vector<int> dynamicTele;
 for(int t=0;t<(int)b.teleports.size();t++){
  bool controlled=false;for(const auto& tt:b.switchTele)if(find(tt.begin(),tt.end(),t)!=tt.end())controlled=true;
  if(controlled)dynamicTele.push_back(t);
 }
 if(groupCount+dynamicTele.size()>16){if(lim.verbose)cerr<<"too many terminal gate/teleport configurations for reverse seeds\n";return out;}
 uint64_t variants=1ULL<<(groupCount+dynamicTele.size());
 if(variants>lim.maxStates/4){if(lim.verbose)cerr<<"terminal configurations exceed reverse budget\n";return out;}
 for(uint64_t mask=0;mask<variants;mask++){
  State candidate=target;
  for(int g=0;g<groupCount;g++)if(mask&(1ULL<<g))for(int j:b.groupGates[g])candidate.gate[j]^=1;
  for(int k=0;k<(int)dynamicTele.size();k++)if(mask&(1ULL<<(groupCount+k)))candidate.tele[dynamicTele[k]]^=1;
  bool valid=true;
  for(int i=0;i<b.n;i++){
   int gi=b.gateAt[candidate.p[i]];
   if(gi>=0&&candidate.gate[gi])valid=false;
  }
  if(!valid)continue;
  string key=stateKey(b,candidate,0);
  if(reverseSeen.count(key))continue;
  uint32_t idx=reverseNodes.size();reverseSeen.emplace(move(key),idx);
  reverseNodes.push_back({move(candidate),0,{},0});
 }
 if(reverseNodes.empty())return out;
 if(lim.verbose)cerr<<"reverse target seeds "<<reverseNodes.size()<<" ("<<variants<<" configurations)\n";
 int reverseDepth=0;size_t revHead=0;uint64_t transitions=0;
 // Stop after complete layers, reserving at least half the memory/state budget for forward BFS.
 uint64_t reverseBudget=max<uint64_t>(1,lim.maxStates/2);
 bool reverseLimited=false;
 while(revHead<reverseNodes.size()&&!timer.expired()){
  size_t layerEnd=reverseNodes.size();if(reverseNodes[revHead].depth>=12||reverseNodes[revHead].depth>=D)break;
  bool finished=true;
  for(;revHead<layerEnd;revHead++){
   if(reverseNodes.size()>=reverseBudget||timer.expired()){finished=false;break;}
   State targetState=reverseNodes[revHead].s;
   for(int i=0;i<b.n&&finished;i++){
    int dest=targetState.p[i];
    for(int p=0;p<b.w*b.h&&finished;p++){
     // Previously occupied target goal cannot be departed; all other balls stay fixed.
     if(p==dest||b.fixed[p]||b.goalColor[p]==b.balls[i].color)continue;
     int gi=b.gateAt[p];if(gi>=0&&targetState.gate[gi])continue;
     bool occupied=false;for(int j=0;j<b.n;j++)if(j!=i&&targetState.p[j]==p){occupied=true;break;}if(occupied)continue;
     State predecessor=targetState;predecessor.p[i]=p;
     // Undo the switch activated by the preceding move. The blocked-closing
     // rule is determined by the *post*-move occupancy, not source occupancy.
     int swi=b.switchAt[dest];
     if(swi>=0){
      predecessor.sw[swi]^=1;
      for(int g:b.switchGroups[swi]){
       bool occupiedGate=false;
       for(int j:b.groupGates[g])for(int ball:targetState.p)
        if(ball==b.gates[j].p)occupiedGate=true;
       if(!occupiedGate)for(int j:b.groupGates[g])predecessor.gate[j]^=1;
      }
      for(int t:b.switchTele[swi])predecessor.tele[t]^=1;
     }
     if(gi>=0&&predecessor.gate[gi])continue;
     for(int d=0;d<4;d++){
      transitions++;
      if(fastEnd(b,predecessor,i,d)!=dest)continue;
      // Replay the switch's effects to reject invalid reverse candidates.
      State check=predecessor;check.p[i]=dest;
      if(swi>=0){
       check.sw[swi]^=1;
       for(int g:b.switchGroups[swi]){
        bool blocked=false;
        for(int j:b.groupGates[g])if(!check.gate[j])for(int ball:check.p)
         if(ball==b.gates[j].p)blocked=true;
        if(!blocked)for(int j:b.groupGates[g])check.gate[j]^=1;
       }
       for(int t:b.switchTele[swi])check.tele[t]^=1;
      }
      if(stateKey(b,check,0)!=stateKey(b,targetState,0))continue;
      string key=stateKey(b,predecessor,0);
      if(reverseSeen.count(key))continue;
      if(reverseNodes.size()>=reverseBudget){finished=false;break;}
      uint32_t index=reverseNodes.size();reverseSeen.emplace(move(key),index);
      reverseNodes.push_back({predecessor,(uint32_t)revHead,{(uint16_t)p,(Byte)b.balls[i].color,(Byte)d,""},(uint16_t)(reverseNodes[revHead].depth+1)});
     }
    }
   }
  }
  if(!finished){reverseLimited=true;break;}
  reverseDepth++;if(lim.verbose)cerr<<"reverse depth "<<reverseDepth<<" states "<<reverseNodes.size()<<" elapsed "<<timer.elapsed()<<"s\n";
  if(reverseNodes.size()>reverseBudget*3/5&&reverseDepth>=4)break;
 }
 // If the last reverse layer was interrupted, it is safe to discard it and use only earlier complete layers.
 if(reverseLimited){
  while(!reverseNodes.empty()&&reverseNodes.back().depth>reverseDepth)reverseNodes.pop_back();
  reverseSeen.clear();reverseSeen.reserve(reverseNodes.size()*2+1);for(int i=0;i<(int)reverseNodes.size();i++)reverseSeen.emplace(stateKey(b,reverseNodes[i].s,0),i);
 }
 if(lim.verbose)cerr<<"reverse side completed to depth "<<reverseDepth<<"\n";
 if(timer.expired()){out.states=reverseNodes.size();out.transitions=transitions;return out;}
 vector<BiNode> forwardNodes;forwardNodes.reserve(min<uint64_t>(lim.maxStates-reverseNodes.size(),300000));forwardNodes.push_back({start,0,{},0});
 unordered_map<string,uint32_t> forwardSeen;forwardSeen.reserve(min<uint64_t>(lim.maxStates-reverseNodes.size(),300000));forwardSeen.emplace(stateKey(b,start,0),0);
 int best=INT32_MAX;uint32_t fMeet=0,rMeet=0;
 auto meet=[&](uint32_t fi){auto it=reverseSeen.find(stateKey(b,forwardNodes[fi].s,0));if(it==reverseSeen.end())return;int len=(int)forwardNodes[fi].depth+(int)reverseNodes[it->second].depth;if(len<best){best=len;fMeet=fi;rMeet=it->second;if(lim.verbose)cerr<<"candidate "<<best<<" moves (forward "<<forwardNodes[fi].depth<<", reverse "<<reverseNodes[it->second].depth<<")\n";}};
 meet(0);
 size_t head=0;bool limited=false,certified=false;
 while(head<forwardNodes.size()&&!timer.expired()){
  int depth=forwardNodes[head].depth;
  size_t layerEnd=forwardNodes.size();
  for(;head<layerEnd;head++){
   State st=forwardNodes[head].s;
   for(int i=0;i<b.n;i++){
    if(b.goalColor[st.p[i]]==b.balls[i].color)continue;
    for(int d=0;d<4;d++){
     transitions++;int np=fastEnd(b,st,i,d);if(np<0)continue;
     State next=st;next.p[i]=np;
     int swi=b.switchAt[np];if(swi>=0){
      next.sw[swi]^=1;
      for(int g:b.switchGroups[swi]){
       bool blocked=false;
       for(int j:b.groupGates[g])if(!next.gate[j])for(int ball:next.p)
        if(ball==b.gates[j].p)blocked=true;
       if(!blocked)for(int j:b.groupGates[g])next.gate[j]^=1;
      }
      for(int t:b.switchTele[swi])next.tele[t]^=1;
     }
     string key=stateKey(b,next,0);if(forwardSeen.count(key))continue;
     if(forwardNodes.size()+reverseNodes.size()>=lim.maxStates){limited=true;break;}
     uint32_t idx=forwardNodes.size();forwardSeen.emplace(move(key),idx);
     forwardNodes.push_back({move(next),(uint32_t)head,{st.p[i],(Byte)b.balls[i].color,(Byte)d,""},(uint16_t)(depth+1)});
     meet(idx);
    }
    if(limited)break;
   }
   if(limited||timer.expired())break;
  }
  if(limited||timer.expired())break;
  if(lim.verbose)cerr<<"forward depth "<<depth+1<<" states "<<forwardNodes.size()<<" best "<<(best==INT32_MAX?-1:best)<<" elapsed "<<timer.elapsed()<<"s\n";
  // Every path of length < best must intersect a complete reverse ball of depth R
  // at forward depth max(0,best-1-R); all forward states through depth+1 are generated.
  // need = longest path length that must be covered: below the best candidate, but never beyond the depth limit D.
  {int need=min(best==INT32_MAX?INT32_MAX:best-1,D);if(need!=INT32_MAX&&depth+1+reverseDepth>=need){certified=true;break;}}
 }
 out.states=forwardNodes.size()+reverseNodes.size();out.transitions=transitions;
 const bool forwardDone=!limited&&!timer.expired()&&head==forwardNodes.size();
 if(best!=INT32_MAX&&best<=D){
  out.solved=true;out.depth=best;out.exhaustive=certified;vector<Move> before,after;
  uint32_t at=fMeet;while(at){before.push_back(forwardNodes[at].m);at=forwardNodes[at].parent;}reverse(before.begin(),before.end());
  at=rMeet;while(reverseNodes[at].depth>0){after.push_back(reverseNodes[at].m);at=reverseNodes[at].parent;}
  out.path=move(before);out.path.insert(out.path.end(),after.begin(),after.end());
 }else if(best==INT32_MAX){if(forwardDone)out.exhaustive=true;else if(certified)out.boundProved=true;}
 else out.boundProved=certified||forwardDone; // only candidates longer than D exist: no solution within D moves
 return out;
}
// Convert source-position moves to the specific, stable IDs of the original labeled balls.
struct LabeledMove{int ball,dir;string choices;};
vector<LabeledMove> labelAndVerify(const Board&b,const vector<Move>& path,int& finalScore){
 State st=initial(b);vector<int> labeledPositions;for(auto x:b.balls)labeledPositions.push_back(x.p);
 vector<LabeledMove> result;int depth=0;
 for(const Move &m:path){
  int bi=-1;for(int i=0;i<b.n;i++)if(b.balls[i].color==m.color&&labeledPositions[i]==m.source){bi=i;break;}
  if(bi<0)throw runtime_error("internal route error: missing source ball");
  State next;int delta=0,used=0;
  int status=simulate(b,st,bi,m.dir,m.choices,next,delta,used);
  if(status!=1)throw runtime_error("internal route error: illegal move");
  labeledPositions[bi]=next.p[bi];st=move(next);depth++;
  result.push_back({bi,m.dir,m.choices});
 }
 finalScore=scoreHex(b,st,depth);
 if(!accepted(b,st,depth))throw runtime_error("internal route error: unfinished or score below one");
 return result;
}
string formatMoves(const Board&b,const vector<LabeledMove>& path){string out;int last=-1;for(const auto& m:path){if(last!=m.ball){if(!out.empty())out+=',';out+=b.balls[m.ball].name;last=m.ball;}out+=DIR[m.dir];for(char c:m.choices){out+="(->";out+=c;out+=')';}}return out;}
vector<Byte> packedSolution(const Board&b,const vector<LabeledMove>& path){
 vector<Byte> bytes;putuint(bytes,path.size());bool hasChoices=false;for(auto&m:path)if(!m.choices.empty())hasChoices=true;bytes.push_back(hasChoices?1:0);
 int width=0;while((1ULL<<width)<(uint64_t)b.n*4)width++;
 auto pack=[&](const vector<int>&v,int bits){int cur=0,count=0;for(int x:v){for(int j=bits-1;j>=0;j--){cur=cur*2+((x>>j)&1);if(++count==8){bytes.push_back(cur);cur=0;count=0;}}}if(count)bytes.push_back(cur<<(8-count));};
 vector<int> vals;for(auto m:path)vals.push_back(m.ball*4+m.dir);pack(vals,width);
 if(hasChoices){vector<int> opts;for(auto&m:path){putuint(bytes,m.choices.size());for(char c:m.choices)opts.push_back(DIR.find(c));}pack(opts,2);}
 return bytes;
}
string codeWithSolution(const Board&b,const vector<LabeledMove>& path){
 vector<Byte> raw={0xB3,(Byte)b.w,(Byte)b.h,(Byte)((b.hasDescription?1:0)|2)};
 unordered_map<string,int> dict;
 auto str=[&](const string& s){auto it=dict.find(s);if(it!=dict.end()){putuint(raw,it->second*2+1);return;}putuint(raw,s.size()*2);raw.insert(raw.end(),s.begin(),s.end());int index=dict.size();dict.emplace(s,index);};
 auto pos=[&](int p){putuint(raw,p);};
 str(b.id);str(b.title);if(b.hasDescription)str(b.description);
 vector<Byte> sol=packedSolution(b,path);putuint(raw,sol.size());raw.insert(raw.end(),sol.begin(),sol.end());
 putuint(raw,b.wall.size());for(int p:b.wall)pos(p);
 putuint(raw,b.balls.size());for(auto ball:b.balls){pos(ball.p);putuint(raw,ball.color);}
 putuint(raw,b.goals.size());for(int g:b.goals){pos(g%MAX_CELLS);putuint(raw,g/MAX_CELLS);}
 putuint(raw,b.arrows.size());for(auto a:b.arrows){pos(a.p);putuint(raw,2*a.dir+(a.rotating?1:0));}
 putuint(raw,b.gates.size());for(auto g:b.gates){pos(g.p);str(g.id);str(g.group);putuint(raw,g.active);}
 putuint(raw,b.switches.size());for(auto t:b.switches){pos(t.p);str(t.id);putuint(raw,t.on);putuint(raw,t.groups.size());for(auto g:t.groups)str(g);putuint(raw,t.teleports.size());for(auto id:t.teleports)str(id);}
 putuint(raw,b.teleports.size());for(auto t:b.teleports){str(t.id);putuint(raw,t.color);putuint(raw,t.active);pos(t.a);pos(t.b);}
 putuint(raw,b.hexes.size());for(auto h:b.hexes){pos(h.p);str(h.id);putuint(raw,h.value<0?(uint64_t)(-2LL*h.value-1):(uint64_t)(2LL*h.value));}
 return "K3."+b64encode(raw);
}
string readInput(const string& argument){ifstream f(argument,ios::binary);if(f.good()){string s((istreambuf_iterator<char>(f)),{});return trim(s);}return argument;}
string catalogCode(const string& id,const string& filename){ifstream file(filename);if(!file)throw runtime_error("cannot open levels.js: "+filename);string line;while(getline(file,line)){line=trim(line);string prefix=id+" = ";if(line.rfind(prefix,0)==0)return trim(line.substr(prefix.size()));}throw runtime_error("level not found: "+id);}
static const char* SOLVER_VERSION="0.4"; // Solver's own version, independent of the web app's APP_VERSION.
int main(int argc,char**argv){
 try{
  Limits lim;string input,level,catalog="levels.js";bool wantK3=true;
  for(int i=1;i<argc;i++){string a=argv[i];auto value=[&](){if(++i>=argc)throw runtime_error("missing argument for "+a);return string(argv[i]);};
   if(a=="--version"){cout<<"kunsolve v"<<SOLVER_VERSION<<"\n";return 0;}
   if(a=="--help"||a=="-h"){cout<<"Kunundrum exact C++ solver (K2/K3)\nUsage: kunsolve BOARD_CODE_OR_FILE [--algorithm auto|forward|bidirectional] [--max-states N] [--seconds N] [--max-choices N] [--max-depth N] [--quiet] [--version]\n       kunsolve --level ID [--catalog levels.js] [options]\nOutput: lowest-score route (fewest moves among equal scores), its score and move count, and K3 code including solution.\nExit codes: 0 optimal, 2 inconclusive, 3 exhausted/unsolvable, 4 no solution within --max-depth (proved lower bound), 1 error.\n";return 0;}
   else if(a=="--level")level=value();else if(a=="--catalog")catalog=value();else if(a=="--algorithm")lim.algorithm=value();else if(a=="--max-states")lim.maxStates=stoull(value());else if(a=="--seconds")lim.seconds=stod(value());else if(a=="--max-choices")lim.maxChoices=stoi(value());else if(a=="--max-depth"){lim.maxDepth=stoi(value());if(lim.maxDepth<1)throw runtime_error("--max-depth must be at least 1");}else if(a=="--quiet")lim.verbose=false;else if(a=="--no-code")wantK3=false;else if(input.empty())input=a;else throw runtime_error("unexpected argument: "+a);
  }
  if(input.empty()&&level.empty())throw runtime_error("missing board code/file or --level");
  if(!level.empty())input=catalogCode(level,catalog);else if(input=="-"){input=string((istreambuf_iterator<char>(cin)),{});}else input=readInput(input);
  if(lim.maxStates<2||lim.seconds<=0||lim.maxChoices<0||lim.maxChoices>32)throw runtime_error("invalid resource limits");
  Board b=parseCode(input);cerr<<"board "<<b.id<<" ("<<b.w<<"x"<<b.h<<") "<<b.n<<" balls, "<<b.hexes.size()<<" hexes, "<<b.switches.size()<<" switches\n";
  ClockLimit timer(lim.seconds);
  SearchResult res;
  int controlledTele=0;
  for(int t=0;t<(int)b.teleports.size();t++){
   bool controlled=false;
   for(const auto& sw:b.switchTele)if(find(sw.begin(),sw.end(),t)!=sw.end())controlled=true;
   if(controlled)controlledTele++;
  }
  int terminalBits=(int)b.groupGates.size()+controlledTele;
  bool feasibleSeeds=terminalBits<=16&&(1ULL<<terminalBits)<=lim.maxStates/4;
  bool canBi=b.staticReverse&&b.goals.size()==b.balls.size()&&feasibleSeeds;
  if(lim.algorithm=="bidirectional"&&!canBi)throw runtime_error("bidirectional search requires no hexagons/rotating arrows, equal goals/balls and an affordable terminal-state enumeration");
  if((lim.algorithm=="auto"&&canBi&&b.n>=3)||lim.algorithm=="bidirectional")res=bidirectional(b,lim,timer);
  else if(lim.algorithm=="auto"||lim.algorithm=="forward")res=forwardBFS(b,lim,timer);
  else throw runtime_error("unknown algorithm");
  cout<<"Algorithm: "<<res.algorithm<<"\n"<<(lim.maxDepth>0?"Depth limit: "+to_string(lim.maxDepth)+"\n":string())<<"States: "<<res.states<<"\nTransitions: "<<res.transitions<<"\nElapsed: "<<timer.elapsed()<<" s\n";
  if(res.solved){int score;auto route=labelAndVerify(b,res.path,score);bool optimal=res.exhaustive;
   cout<<(optimal?"OPTIMAL":"SOLUTION FOUND (optimality not certified)")<<"\nScore: "<<score<<"\nMoves: "<<route.size()<<"\nSolution: "<<formatMoves(b,route)<<"\n";if(wantK3)cout<<"K3: "<<codeWithSolution(b,route)<<"\n";
   if(!optimal)cerr<<"WARNING: search did not complete the layers needed to certify optimality\n";
   return optimal?0:2;
  }
  if(res.boundProved){cout<<"NO SOLUTION WITHIN "<<lim.maxDepth<<" MOVES\nLower bound: at least "<<lim.maxDepth+1<<" moves\n";return 4;}
  cout<<(res.exhaustive?"UNSOLVABLE":"INCONCLUSIVE")<<"\n";return res.exhaustive?3:2;
 }catch(const exception&e){cerr<<"Error: "<<e.what()<<"\n";return 1;}
}
