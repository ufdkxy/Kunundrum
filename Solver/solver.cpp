// Kunundrum native exact solver. C++17; no dependencies. K3 codes.
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
#include <map>
#include <memory>
#include <cstring>
#include <climits>
#include <numeric>
#include <deque>
#include <queue>
#include <random>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <sstream>
#include <cstdio>
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
struct Gate{int p;string id;bool active;};
struct Switch{int p;string id;bool on;vector<string> controls;};
struct Teleport{int p,color;string id;bool active;}; // one endpoint; partners are derived from colors (see teleExit)
struct Hex{int p,value;string id;};
struct Arrow{int p,dir;bool rotating;int type=0;}; // type: 0 clockwise, 1 counterclockwise, 2 flip (rotating arrows only)
struct Tunnel{int pa,sa,pb,sb;}; // two openings: cell and side (0..3 = u,d,l,r)
struct Board{
 int w=0,h=0;string id,title,description; bool hasDescription=false;int wallColor=-1;vector<Ball> balls;vector<int> wall,goals;vector<Gate> gates;vector<Switch> switches;vector<Teleport> teleports;vector<Hex> hexes;vector<Arrow> arrows;vector<Tunnel> tunnels;vector<Byte> prefix,tail;
 array<int,MAX_CELLS> fixed,arrowAt,gateAt,switchAt,teleAt,hexAt,goalColor;vector<vector<int>> groupGates,switchGroups,switchTele;vector<array<int,4>> teleExit; // teleExit[endpoint][ball color]: endpoint index the ball is sent to, -1 = none (the ball stops on the entrance)
  // groupGates: gates controlled by exactly the same switches (they always toggle together)
 template<class S> void fireSwitch(int sw,S&s)const{ // all-or-nothing: one blocked closing gate freezes the whole switch
  for(int g:switchGroups[sw])for(int j:groupGates[g])if(!s.gate[j])for(auto ball:s.p)if(ball==gates[j].p)return;
  s.sw[sw]^=1;for(int g:switchGroups[sw])for(int j:groupGates[g])s.gate[j]^=1;for(int t:switchTele[sw])s.tele[t]^=1;}
 template<class S> void undoSwitch(int sw,S&s,const S&post)const{ // reverse of fireSwitch; blocked is judged on the post-move occupancy
  for(int g:switchGroups[sw])for(int j:groupGates[g])for(auto ball:post.p)if(ball==gates[j].p)return;
  s.sw[sw]^=1;for(int g:switchGroups[sw])for(int j:groupGates[g])s.gate[j]^=1;for(int t:switchTele[sw])s.tele[t]^=1;}
 vector<uint8_t> gateInit,teleInit,switchInit;int n=0;bool staticReverse=false;int initialScore=0;
 // hop[cell*4+heading] = partner cell*4 + heading after the tunnel (or -1); hopFrom is the inverse (at most one source per entry).
 array<int,MAX_CELLS*4> hop,hopFrom;vector<array<uint8_t,4>> phaseDir;int nPhases=1; // phaseDir[arrow][phase]: heading the arrow shows at clock phase 0..3
 static int cwIndex(int d){static const int t[4]={0,2,3,1};return t[d];} // u,d,l,r -> position in the clockwise cycle u,r,d,l
 static int cwDir(int i){static const int t[4]={0,3,1,2};return t[i&3];}
 int arrowDir(int ai,int phase)const{return phaseDir[ai][phase];}
 int at(int x,int y)const{return y*w+x;}bool inside(int x,int y)const{return x>=0&&x<w&&y>=0&&y<h;}
 void initialize(){
  if(w<1||h<1||w*h>MAX_CELLS||balls.empty()||balls.size()>128)throw runtime_error("unsupported board dimensions or ball count");
  n=balls.size();fixed.fill(0);arrowAt.fill(-1);gateAt.fill(-1);switchAt.fill(-1);teleAt.fill(-1);hexAt.fill(-1);goalColor.fill(-1);
  for(int p:wall){if(p<0||p>=w*h)throw runtime_error("bad wall");fixed[p]=1;}
  for(int g:goals){int p=g%MAX_CELLS,c=g/MAX_CELLS;goalColor[p]=c;}
  for(int i=0;i<(int)arrows.size();i++)arrowAt[arrows[i].p]=i;
  phaseDir.assign(arrows.size(),{});bool p4=false,p2=false;
  for(int i=0;i<(int)arrows.size();i++){const Arrow&a=arrows[i];for(int ph=0;ph<4;ph++){int d=a.dir;if(a.rotating){if(a.type==2)d=ph&1?(a.dir^1):a.dir;else d=cwDir(cwIndex(a.dir)+(a.type==0?ph:4-ph));}phaseDir[i][ph]=(uint8_t)d;}if(a.rotating){if(a.type==2)p2=true;else p4=true;}}
  nPhases=p4?4:(p2?2:1);
  hop.fill(-1);hopFrom.fill(-1);
  for(const Tunnel&t:tunnels){
   if(t.pa<0||t.pb<0||t.pa>=w*h||t.pb>=w*h||t.sa<0||t.sa>3||t.sb<0||t.sb>3)throw runtime_error("invalid tunnel");
   int ka=t.pa*4+t.sa,kb=t.pb*4+t.sb;if(ka==kb||hop[ka]>=0||hop[kb]>=0||fixed[t.pa]||fixed[t.pb])throw runtime_error("invalid tunnel openings");
   hop[ka]=t.pb*4+(t.sb^1);hop[kb]=t.pa*4+(t.sa^1);hopFrom[hop[ka]]=ka;hopFrom[hop[kb]]=kb;
  }
  for(int i=0;i<(int)gates.size();i++)gateAt[gates[i].p]=i;
  for(int i=0;i<(int)switches.size();i++)switchAt[switches[i].p]=i;
  for(int i=0;i<(int)hexes.size();i++)hexAt[hexes[i].p]=i;
  for(int i=0;i<(int)teleports.size();i++)teleAt[teleports[i].p]=i;
  { // Teleport pairing from colors alone: same-color endpoints pair up, two universals (4) pair with each other, a lone universal is a hub paired with the single endpoint of each other color.
   int cnt[5]={0,0,0,0,0};for(auto&t:teleports)cnt[t.color]++;
   for(int c=0;c<4;c++)if(cnt[c]>2||(cnt[c]==1&&cnt[4]!=1))throw runtime_error("invalid teleport pairing");
   if(cnt[4]>2)throw runtime_error("invalid teleport pairing");
   int T=teleports.size();teleExit.assign(T,array<int,4>{-1,-1,-1,-1});
   for(int i=0;i<T;i++)for(int bc=0;bc<4;bc++){
    int mate=-1,mc=0,uni=-1,uc=0,spoke=-1,sc=0;
    for(int j=0;j<T;j++){if(j==i)continue;if(teleports[j].color==teleports[i].color&&teleports[i].color!=4){mate=j;mc++;}if(teleports[j].color==4){uni=j;uc++;}}
    for(int j=0;j<T;j++)if(teleports[j].color==bc){spoke=j;sc++;}
    int ex=-1;
    if(teleports[i].color!=4)ex=mc==1?mate:(uc==1?uni:-1);
    else ex=uc==1?uni:(sc==1?spoke:-1);
    teleExit[i][bc]=ex;
   }
  }
  unordered_map<string,int> gateIdx,teleids;for(int i=0;i<(int)gates.size();i++)gateIdx[gates[i].id]=i;
  for(int i=0;i<(int)teleports.size();i++)teleids[teleports[i].id]=i;
  // Gates controlled by exactly the same set of switches always toggle together (a blocked switch freezes its whole list), so each such set is one "group".
  vector<vector<int>> signature(gates.size());
  for(int si=0;si<(int)switches.size();si++)for(auto&id:switches[si].controls){
   auto g=gateIdx.find(id);if(g!=gateIdx.end()){if(teleids.count(id))throw runtime_error("gate and teleport share an ID");if(signature[g->second].empty()||signature[g->second].back()!=si)signature[g->second].push_back(si);}
   else if(!teleids.count(id))throw runtime_error("switch controls unknown gate or teleport ID");}
  map<vector<int>,int> groupOf;vector<int> gateGroup(gates.size());
  for(int i=0;i<(int)gates.size();i++){auto it=groupOf.find(signature[i]);if(it==groupOf.end()){it=groupOf.emplace(signature[i],(int)groupOf.size()).first;groupGates.emplace_back();}gateGroup[i]=it->second;groupGates[it->second].push_back(i);}
  for(const auto &s:switches){vector<int> gs,ts;for(auto&id:s.controls){auto g=gateIdx.find(id);if(g!=gateIdx.end()){int grp=gateGroup[g->second];if(find(gs.begin(),gs.end(),grp)==gs.end())gs.push_back(grp);}else{int t=teleids[id];if(find(ts.begin(),ts.end(),t)==ts.end())ts.push_back(t);}}switchGroups.push_back(gs);switchTele.push_back(ts);}
  for(auto g:gates)gateInit.push_back(g.active);
  for(auto t:teleports)teleInit.push_back(t.active);
  for(auto s:switches)switchInit.push_back(s.on);
  staticReverse=hexes.empty();
 }
};
Board parseCode(string code){code=trim(code);if(code.rfind("K3.",0)!=0)throw runtime_error("expected K3. board code");auto raw=b64decode(code.substr(3));Reader r(raw);int magic=r.byte();if(magic!=0xB3)throw runtime_error("invalid board magic");Board b;b.w=r.byte();b.h=r.byte();int flags=r.u();if((flags&~31)||b.w<1||b.h<1||b.w>32||b.h>32)throw runtime_error("invalid board header");b.id=r.str();b.title=r.str();if(flags&1){b.hasDescription=true;b.description=r.str();}if(flags&4){int c=r.u();if(c>3)throw runtime_error("invalid wall color");if(c!=2)b.wallColor=c;}
 size_t solutionStart=r.i;if(flags&2){size_t len=r.u();if(r.i+len>raw.size())throw runtime_error("truncated solution");r.i+=len;}size_t bodyStart=r.i;
 b.prefix.assign(raw.begin()+4,raw.begin()+solutionStart);
 auto at=[&](){int p=r.u();if(p>=b.w*b.h)throw runtime_error("position out of bounds");return p;};
 for(int i=r.count();i>0;i--)b.wall.push_back(at());
 for(int i=r.count();i>0;i--){int p=at(),c=r.u();if(c>=4)throw runtime_error("invalid ball color");b.balls.push_back({p,c,0,""});}
 for(int i=r.count();i>0;i--){int p=at(),c=r.u();if(c>=4)throw runtime_error("invalid goal color");b.goals.push_back((int)c*MAX_CELLS+p);}
 for(int i=r.count();i>0;i--){int p=at(),v=r.u();if(v>7)throw runtime_error("invalid arrow");b.arrows.push_back({p,(int)v/2,(bool)(v%2),0});}
 for(int i=r.count();i>0;i--){int p=at();string id=r.str();bool act=r.u();b.gates.push_back({p,id,act});}
 for(int i=r.count();i>0;i--){int p=at();string id=r.str();bool on=r.u();vector<string> cs;for(int k=r.count();k>0;k--)cs.push_back(r.str());b.switches.push_back({p,id,on,cs});}
 for(int i=r.count();i>0;i--){int p=at();string id=r.str();int c=r.u(),act=r.u();if(c>=5)throw runtime_error("invalid teleport color");b.teleports.push_back({p,c,id,(bool)act});}
 for(int i=r.count();i>0;i--){int p=at();string id=r.str();uint64_t value=r.u();int signedValue=value&1?-(int)((value+1)/2):(int)(value/2);b.hexes.push_back({p,signedValue,id});}
 if(flags&8)for(int i=r.count();i>0;i--){int pa=at(),sa=r.u(),pb=at(),sb=r.u();if(sa>3||sb>3)throw runtime_error("invalid tunnel side");b.tunnels.push_back({pa,sa,pb,sb});}
 if(flags&16){string digits=r.str();size_t k=0;for(auto&a:b.arrows)if(a.rotating){if(k>=digits.size()||digits[k]<'0'||digits[k]>'2')throw runtime_error("invalid rotating arrow types");a.type=digits[k]=='0'?2:digits[k]=='1'?0:1;k++;}if(k!=digits.size())throw runtime_error("invalid rotating arrow types");}
 if(r.i!=raw.size())throw runtime_error("trailing board data");
 b.tail.assign(raw.begin()+bodyStart,raw.end());
 // Core.validateBoard sorts balls by color, then (y,x).
 stable_sort(b.balls.begin(),b.balls.end(),[](const Ball&a,const Ball&z){return a.color!=z.color?a.color<z.color:a.p<z.p;});
 for(int i=0;i<(int)b.balls.size();i++){int count=0,k=0;for(int j=0;j<(int)b.balls.size();j++)if(b.balls[j].color==b.balls[i].color){count++;if(j<=i)k++;}b.balls[i].ordinal=k;b.balls[i].name=string(1,COLORS[b.balls[i].color])+(count==1?"":to_string(k));}
 b.initialize();return b;
}
struct State{vector<uint16_t> p;vector<Byte> gate,tele,sw,hex;};
State initial(const Board&b){State s;for(const auto& x:b.balls)s.p.push_back(x.p);s.gate=b.gateInit;s.tele=b.teleInit;s.sw=b.switchInit;s.hex.assign(b.hexes.size(),0);return s;}
struct Move{uint16_t source=0;uint8_t color=0,dir=0,phase=0;}; // phase: arrow clock phase 0..3 chosen before the move
struct Transition{State s;Move m;};
// ---- Compact state storage (SOLVER-012) ----
// A search state is packed into a fixed-size byte string: per color the sorted ball cells (balls of one color are interchangeable),
// one bit per switch-controlled gate group (all gates of a group always flip together, so the first gate determines the rest) and per
// switch-controlled teleport, and one bit per hexagon (consumed). Everything else is constant during a search, and the switch's
// visual on/off flag and the score are deliberately not part of the key: for one position and one set of consumed hexes the score only
// grows with the move count, so breadth-first order reaches every such state with the fewest moves first.
struct Packer{
 const Board* b=nullptr;int K=0,posBits=1;vector<int> groups,teles;vector<uint8_t> gateRel;State base;
 void init(const Board&bd){
  b=&bd;while((1<<posBits)<bd.w*bd.h)posBits++;
  for(int g=0;g<(int)bd.groupGates.size();g++){bool c=false;for(const auto&gs:bd.switchGroups)if(find(gs.begin(),gs.end(),g)!=gs.end())c=true;if(c)groups.push_back(g);}
  for(int t=0;t<(int)bd.teleports.size();t++){bool c=false;for(const auto&ts:bd.switchTele)if(find(ts.begin(),ts.end(),t)!=ts.end())c=true;if(c)teles.push_back(t);}
  gateRel.assign(bd.gates.size(),0);for(const auto&gg:bd.groupGates)for(int j:gg)gateRel[j]=bd.gateInit[j]^bd.gateInit[gg[0]];
  int bits=bd.n*posBits+(int)groups.size()+(int)teles.size()+(int)bd.hexes.size();K=(bits+7)/8;base=initial(bd);
 }
 void pack(const State&s,uint8_t*out)const{
  memset(out,0,K);int at=0;
  auto put=[&](unsigned v,int n){for(int i=0;i<n;i++,at++)if((v>>i)&1)out[at>>3]|=(uint8_t)(1<<(at&7));};
  uint16_t tmp[128];
  for(int i=0;i<b->n;){int j=i;while(j<b->n&&b->balls[j].color==b->balls[i].color)j++;int c=j-i;for(int k=0;k<c;k++)tmp[k]=s.p[i+k];sort(tmp,tmp+c);for(int k=0;k<c;k++)put(tmp[k],posBits);i=j;}
  for(int g:groups)put(s.gate[b->groupGates[g][0]],1);
  for(int t:teles)put(s.tele[t],1);
  for(size_t h=0;h<s.hex.size();h++)put(s.hex[h],1);
 }
 void unpack(const uint8_t*in,State&s)const{
  s=base;int at=0;
  auto get=[&](int n){unsigned v=0;for(int i=0;i<n;i++,at++)v|=(unsigned)((in[at>>3]>>(at&7))&1)<<i;return v;};
  for(int i=0;i<b->n;i++)s.p[i]=(uint16_t)get(posBits);
  for(int g:groups){unsigned v=get(1);for(int j:b->groupGates[g])s.gate[j]=(uint8_t)(v^gateRel[j]);}
  for(int t:teles)s.tele[t]=(uint8_t)get(1);
  for(size_t h=0;h<s.hex.size();h++)s.hex[h]=(uint8_t)get(1);
 }
};
static inline uint64_t hashBytes(const uint8_t*p,int n){uint64_t h=0x9E3779B97F4A7C15ULL;int i=0;for(;i+8<=n;i+=8){uint64_t v;memcpy(&v,p+i,8);h=(h^v)*0xff51afd7ed558ccdULL;h^=h>>32;}uint64_t v=0;if(i<n)memcpy(&v,p+i,n-i);h=(h^v^((uint64_t)n<<56))*0xc4ceb9fe1a85ec53ULL;h^=h>>29;return h;}
// Nodes live in fixed-size chunks of one flat byte array and hold ONLY the packed state (v0.18: no parent, depth or move per node).
// Layers are contiguous in insertion order, so `bounds` gives every node's depth; routes are rebuilt after a successful search (rebuildForward/rebuildReverse).
// An open-addressing table of node indices (compared byte for byte, so there are no hash collisions to worry about) finds duplicates.
struct Store{
 static constexpr uint32_t NONE=0xFFFFFFFFu;static constexpr int SHIFT=16;
 int K=0,stride=0;vector<unique_ptr<uint8_t[]>> chunks;vector<uint32_t> table;size_t count=0;
 vector<size_t> bounds{0}; // bounds[k] = index of the first node of layer k (the last entry opens the layer being generated)
 void init(int k){K=k;stride=K;table.assign(1<<16,NONE);bounds.assign(1,0);}
 void closeLayer(){bounds.push_back(count);}
 int depthOf(size_t i)const{return (int)(upper_bound(bounds.begin(),bounds.end(),i)-bounds.begin())-1;}
 uint8_t* at(size_t i)const{return chunks[i>>SHIFT].get()+(i&(((size_t)1<<SHIFT)-1))*stride;}
 size_t size()const{return count;}
 uint64_t bytes()const{return (uint64_t)chunks.size()*((uint64_t)stride<<SHIFT)+(uint64_t)table.size()*4;}
 const uint8_t* key(size_t i)const{return at(i);}
 uint32_t find(const uint8_t*k)const{size_t mask=table.size()-1,pos=hashBytes(k,K)&mask;for(;;pos=(pos+1)&mask){uint32_t e=table[pos];if(e==NONE)return NONE;if(!memcmp(at(e),k,K))return e;}}
 void place(uint32_t idx){size_t mask=table.size()-1,pos=hashBytes(at(idx),K)&mask;while(table[pos]!=NONE)pos=(pos+1)&mask;table[pos]=idx;}
 void rebuild(size_t n,size_t slots){count=n;table.assign(slots,NONE);for(size_t i=0;i<n;i++)place((uint32_t)i);}
 // Adds a state known to be absent (call find first). Returns its index.
 uint32_t add(const uint8_t*k){
  if((count+1)*2>table.size())rebuild(count,table.size()*2);
  size_t idx=count;if((idx>>SHIFT)>=chunks.size())chunks.emplace_back(new uint8_t[(size_t)stride<<SHIFT]);
  memcpy(at(idx),k,K);
  count++;place((uint32_t)idx);return (uint32_t)idx;
 }
};
// Performs a complete move for a ball found at source, with the shared arrow clock showing `phase` (0..3; waiting is free, so the player
// picks it before the move). Returns 1 for success, 0 blocked/loop. `ann` receives the notation annotation letters: the orientation of the
// first rotating arrow met, plus (when that one is a flip arrow) the orientation of the first period-4 arrow met after it. A move that meets
// no rotating arrow has an empty annotation and is the same for every phase.
int simulate(const Board&b,const State&s,int bi,int direction,int phase,State&ns,int&delta,string&ann){
 int p=s.p[bi],h=direction;delta=1;ann.clear();int stage=0;vector<uint8_t> consumed=s.hex;vector<uint8_t> occ(b.w*b.h,0);for(int i=0;i<b.n;i++)if(i!=bi)occ[s.p[i]]=1;
 unordered_set<uint32_t> visited;bool entered=false;
 bool stopped=false;
 for(int steps=0;steps<65536;steps++){
  if(!visited.insert((uint32_t)(p*4+h)).second)return 0; // phase is fixed, so a repeated (cell, heading) is a loop
  int np,nh=h,hp=b.hop[p*4+h];
  if(hp>=0){np=hp>>2;nh=hp&3;}  // a tunnel opening replaces the step
  else{int x=p%b.w+dx[h],y=p/b.w+dy[h];if(!b.inside(x,y)){stopped=true;break;}np=b.at(x,y);}
  if(b.fixed[np]||occ[np]){stopped=true;break;}
  int gi=b.gateAt[np];if(gi>=0&&s.gate[gi]){stopped=true;break;}
  entered=true;p=np;h=nh;
  int hi=b.hexAt[p];if(hi>=0&&!consumed[hi]){consumed[hi]=1;delta+=b.hexes[hi].value;}
  int ai=b.arrowAt[p];if(ai>=0){const Arrow&a=b.arrows[ai];if(a.rotating){int o=b.arrowDir(ai,phase);if(stage==0){ann+=DIR[o];stage=a.type==2?1:2;}else if(stage==1&&a.type!=2){ann+=DIR[o];stage=2;}h=o;}else h=a.dir;}
  int ti=b.teleAt[p];if(ti>=0&&s.tele[ti]&&(b.teleports[ti].color==4||b.teleports[ti].color==b.balls[bi].color)){
   int ex=b.teleExit[ti][b.balls[bi].color];if(ex<0||!s.tele[ex]){stopped=true;break;}
   int exit=b.teleports[ex].p;if(occ[exit]){stopped=true;break;}p=exit;
  }
 }
 if(!stopped||!entered)return 0;
 ns=s;ns.p[bi]=p;ns.hex=std::move(consumed);
 int sw=b.switchAt[p];if(sw>=0){b.fireSwitch(sw,ns);}
 return 1;
}
int scoreHex(const Board&b,const State&s,int depth){int v=depth;for(int i=0;i<(int)b.hexes.size();i++)if(s.hex[i])v+=b.hexes[i].value;return v;}
bool complete(const Board&b,const State&s){for(int i=0;i<b.n;i++)if(b.goalColor[s.p[i]]!=b.balls[i].color)return false;return true;}
struct Stats{uint64_t transitions=0,expanded=0;};
// Every distinct move of every unlocked ball. Phases that give the same annotation are the same move; a move that meets no rotating arrow is tried once.
void successors(const Board&b,const State&s,Stats&stats,const function<void(Transition&&)>& emit){
 for(int i=0;i<b.n;i++){
  if(b.goalColor[s.p[i]]==b.balls[i].color)continue;
  for(int d=0;d<4;d++){
   string seen[4];bool got[4]={false,false,false,false};
   for(int ph=0;ph<b.nPhases;ph++){
    State n;int delta=0;string ann;stats.transitions++;
    if(!simulate(b,s,i,d,ph,n,delta,ann))continue;
    bool dup=false;for(int q=0;q<ph;q++)if(got[q]&&seen[q]==ann)dup=true;
    seen[ph]=ann;got[ph]=true;if(dup)continue;
    emit({std::move(n),{s.p[i],(Byte)b.balls[i].color,(Byte)d,(Byte)ph}});
    if(ann.empty())break;
   }
  }
 }
}
struct SearchResult{bool solved=false,exhaustive=false,boundProved=false;vector<Move> path;uint64_t states=0,transitions=0,bytes=0;int depth=0;int provenMoves=0;/* balanced search: complete layers prove that no route of at most this many moves exists */string algorithm;};
struct Limits{uint64_t maxStates=3000000;/* UINT64_MAX = unlimited */uint64_t maxBytes=0;/* 0 = unlimited */double seconds=60;/* 0 = unlimited */int maxDepth=0;/* 0 = unlimited */bool scoreCap=false;long long maxScore=0;/* --max-score: only routes with score <= maxScore matter */bool verbose=true;string algorithm="auto";bool beamDynamic=false;size_t beamWidth=200000;uint64_t seed=1;/* --algorithm beam: states kept per layer, tie-break seed */};
static ostream* g_log=&cerr; // progress/diagnostic stream: stderr for the CLI, a callback stream in the WebAssembly build
#define LOG (*g_log)
using Clock=chrono::steady_clock;
struct ClockLimit{Clock::time_point start=Clock::now();double seconds;explicit ClockLimit(double s):seconds(s){} bool expired()const{return seconds>0&&chrono::duration<double>(Clock::now()-start).count()>=seconds;}double elapsed()const{return chrono::duration<double>(Clock::now()-start).count();}};
// Lower bound on the final score of any accepted route continuing from state s (reached after `depth` moves): every
// unlocked ball still needs at least one move (+1 each), and the best case collects every unconsumed negative hex.
long long scoreLowerBound(const Board&b,const State&s,int depth){long long v=scoreHex(b,s,depth);for(int i=0;i<b.n;i++)if(b.goalColor[s.p[i]]!=b.balls[i].color)v++;for(size_t i=0;i<s.hex.size();i++)if(!s.hex[i]&&b.hexes[i].value<0)v+=b.hexes[i].value;return v;}
// Objective: the lowest score (moves plus hex bonuses and penalties); among equal scores, the fewest moves.
// Without hexes the score equals the move count, so the first accepted state of the breadth-first search is optimal.
// With hexes a longer route can score lower, so the search continues past the first accepted state and prunes every
// state whose scoreLowerBound cannot beat the best score found. Equal-score routes are found in order of move count.
// Objective: the lowest score (moves plus hex bonuses and penalties); among equal scores, the fewest moves.
// Without hexes the score equals the move count, so the first accepted state of the breadth-first search is optimal.
// With hexes a longer route can score lower, so the search continues past the first accepted state and prunes every
// state whose scoreLowerBound cannot beat the best score found. Equal-score routes are found in order of move count.
// Route to node idx without stored parent pointers: the first node of the previous layer with the wanted successor is its parent
// (the one the search recorded, apart from states a bound pruned before expansion, which give an equally long, equally scored route).
vector<Move> rebuildForward(const Board&b,const Store&st,const Packer&pk,uint32_t idx){
 vector<Move> path;vector<uint8_t> cur(st.K),tmp(st.K);memcpy(cur.data(),st.key(idx),st.K);Stats stats;
 for(int d=st.depthOf(idx);d>0;d--){
  bool ok=false;
  for(size_t i=st.bounds[d-1];i<st.bounds[d]&&!ok;i++){
   State ps;pk.unpack(st.key(i),ps);
   successors(b,ps,stats,[&](Transition&& t){if(ok)return;pk.pack(t.s,tmp.data());if(!memcmp(tmp.data(),cur.data(),st.K)){ok=true;path.push_back(t.m);memcpy(cur.data(),st.key(i),st.K);}});
  }
  if(!ok)throw runtime_error("internal error: route reconstruction failed");
 }
 reverse(path.begin(),path.end());return path;
}
// Reverse store: node idx at depth d can reach the target in d moves, so one of its successors is stored at depth d-1. Returns the moves in play order.
vector<Move> rebuildReverse(const Board&b,const Store&st,const Packer&pk,uint32_t idx){
 vector<Move> path;vector<uint8_t> tmp(st.K);Stats stats;uint32_t at=idx;
 for(int d=st.depthOf(idx);d>0;d--){
  State s;pk.unpack(st.key(at),s);bool ok=false;uint32_t nx=0;
  successors(b,s,stats,[&](Transition&& t){if(ok)return;pk.pack(t.s,tmp.data());uint32_t j=st.find(tmp.data());if(j!=Store::NONE&&st.depthOf(j)==d-1){ok=true;nx=j;path.push_back(t.m);}});
  if(!ok)throw runtime_error("internal error: reverse route reconstruction failed");
  at=nx;
 }
 return path;
}
SearchResult forwardBFS(const Board&b,const Limits&lim,ClockLimit&timer,const Packer&pk){SearchResult out;out.algorithm="forward BFS";State s0=initial(b);
 Store store;store.init(pk.K);vector<uint8_t> key(pk.K);pk.pack(s0,key.data());store.add(key.data());store.closeLayer();Stats stats;int old=-1;
 if(complete(b,s0)){out.solved=true;out.exhaustive=true;out.states=1;out.bytes=store.bytes();return out;}
 const bool byScore=!b.hexes.empty();
 const bool prune=byScore||lim.scoreCap; // bound-based pruning: needed for the score objective with hexes, and for --max-score
 long long negAll=0;for(const auto&h:b.hexes)if(h.value<0)negAll+=h.value;
 long long best=lim.scoreCap?lim.maxScore+1:LLONG_MAX; // routes must score below best; --max-score S starts it at S+1
 auto full=[&](){return store.size()>=lim.maxStates||(lim.maxBytes&&store.bytes()>=lim.maxBytes);};
 size_t head=0;uint32_t found=0;bool success=false,limit=false,depthCut=false;int dep=0;size_t layerEnd=1;
 for(;head<store.size()&&!(success&&!byScore);head++){
  if(full()||timer.expired()){limit=true;break;}
  if(head==layerEnd){dep++;layerEnd=store.size();store.closeLayer();}if(dep!=old){old=dep;if(lim.verbose){LOG<<"forward depth "<<old<<" visited "<<store.size()<<" elapsed "<<timer.elapsed()<<"s";if(success)LOG<<" best score "<<best;LOG<<"\n";}}
  State parentState;pk.unpack(store.key(head),parentState);
  if(prune&&scoreLowerBound(b,parentState,dep)>=best)continue; // cannot beat the best route found so far or the --max-score bound
  successors(b,parentState,stats,[&](Transition&& t){if(limit||(success&&!byScore))return;pk.pack(t.s,key.data());if(store.find(key.data())!=Store::NONE)return;
   const bool acc=complete(b,t.s);
   if(prune&&acc&&scoreHex(b,t.s,dep+1)>=best)return; // a finished route that cannot beat the incumbent or the bound
   if(prune&&!acc&&scoreLowerBound(b,t.s,dep+1)>=best)return;
   if(lim.maxDepth>0&&dep+1>=lim.maxDepth){ // Last allowed layer: only test acceptance. These states are never expanded, so they are not stored unless accepted.
    if(acc){long long sc=scoreHex(b,t.s,dep+1);if(sc<best){best=sc;found=store.add(key.data());success=true;}}else depthCut=true;
    return;}
   if(full()){limit=true;return;}
   uint32_t ni=store.add(key.data());
   if(acc){long long sc=scoreHex(b,t.s,dep+1);if(sc<best){best=sc;found=ni;success=true;}}});
  stats.expanded++;
 }
 out.states=store.size();out.bytes=store.bytes();out.transitions=stats.transitions;out.solved=success;
 const bool covered=!limit; // every state within the limits was explored
 if(success){
  // Without hexes the first accepted state is shortest. With hexes the whole space must be covered; under --max-depth D a longer
  // route (more than D moves) scores at least D+1 plus every negative hex, so it can only matter if that bound is below best.
  out.exhaustive=!byScore?true:covered&&(!depthCut||(long long)lim.maxDepth+1+negAll>=best);
  out.depth=store.depthOf(found);out.path=rebuildForward(b,store,pk,found);
 }else{out.exhaustive=covered&&!depthCut&&!lim.scoreCap;out.boundProved=covered&&(depthCut||lim.scoreCap);} // with --max-score pruned states mean no UNSOLVABLE claim, only 'no route within the bound'
 return out;
}
// Fast move for the bidirectional search (no hexes). `phase` is the arrow clock phase; `rot` reports whether a rotating arrow was met.
int fastEnd(const Board&b,const State&s,int i,int d,int phase,bool&rot){
 static thread_local array<uint32_t,MAX_CELLS*4> visited{};
 static thread_local uint32_t ticket=0;
 if(++ticket==0){visited.fill(0);ticket=1;}
 int p=s.p[i],h=d;bool entered=false,stopped=false;rot=false;
 for(int steps=0;steps<MAX_CELLS*4;steps++){
  uint32_t &stamp=visited[p*4+h];if(stamp==ticket)return -1;stamp=ticket;
  int np,nh=h,hp=b.hop[p*4+h];
  if(hp>=0){np=hp>>2;nh=hp&3;}
  else{int x=p%b.w+dx[h],y=p/b.w+dy[h];if(!b.inside(x,y)){stopped=true;break;}np=b.at(x,y);}
  if(b.fixed[np]){stopped=true;break;}
  int gate=b.gateAt[np];if(gate>=0&&s.gate[gate]){stopped=true;break;}
  bool occupied=false;for(int j=0;j<b.n;j++)if(j!=i&&s.p[j]==np){occupied=true;break;}
  if(occupied){stopped=true;break;}
  entered=true;p=np;h=nh;
  int ai=b.arrowAt[p];if(ai>=0){if(b.arrows[ai].rotating)rot=true;h=b.arrowDir(ai,phase);}
  int ti=b.teleAt[p];if(ti>=0&&s.tele[ti]&&(b.teleports[ti].color==4||b.teleports[ti].color==b.balls[i].color)){
   int ex=b.teleExit[ti][b.balls[i].color];if(ex<0||!s.tele[ex]){stopped=true;break;}
   int exit=b.teleports[ex].p;
   bool occ=false;for(int j=0;j<b.n;j++)if(j!=i&&s.p[j]==exit){occ=true;break;}
   if(occ){stopped=true;break;}p=exit;
  }
 }
 return stopped&&entered?p:-1; // Reject loops (all 4*cell states exhausted).
}
// Backward ray-cast: appends (cell*4+heading), sorted, for every start from which fastEnd(b,s,i,heading,phase) returns dest, i.e. every
// way ball i can make one move that ends at dest. Walks the move automaton backwards from the stopping condition. Its states are
// the pre-step (cell, heading) pairs of fastEnd; the forward map is deterministic, so every state is reached at most once and no
// loop test is needed. Tunnels are extra edges (hopFrom). The cost is the size of the preimage rather than cells x 4 simulated moves.
void backReach(const Board&b,const State&s,int i,int dest,int phase,vector<int>&out){
 static thread_local array<uint32_t,MAX_CELLS*4> seen{};
 static thread_local uint32_t ticket=0;
 static thread_local vector<int> queue;
 if(++ticket==0){seen.fill(0);ticket=1;}
 queue.clear();out.clear();
 const int color=b.balls[i].color;
 auto occupied=[&](int c){for(int j=0;j<b.n;j++)if(j!=i&&s.p[j]==c)return true;return false;};
 auto enterable=[&](int c){if(b.fixed[c])return false;int g=b.gateAt[c];if(g>=0&&s.gate[g])return false;return !occupied(c);};
 auto trigger=[&](int c){int t=b.teleAt[c];return t>=0&&s.tele[t]&&(b.teleports[t].color==4||b.teleports[t].color==color);};
 auto pushState=[&](int c,int h){int k=c*4+h;if(seen[k]!=ticket){seen[k]=ticket;queue.push_back(k);}};
 // Pushes every pre-step state whose single step enters cell c with incoming heading h: the plain step from the cell behind c (unless that
 // side is a tunnel opening, which replaces the step) and the tunnel that leaves into c with that heading.
 auto arrive=[&](int c,int h){
  int x=c%b.w-dx[h],y=c/b.w-dy[h];
  if(b.inside(x,y)){int pc=b.at(x,y);if(b.hop[pc*4+h]<0)pushState(pc,h);}
  int f=b.hopFrom[c*4+h];if(f>=0)pushState(f>>2,f&3);
 };
 // Seeds. (1) The ball stands on dest heading h and its next step (through a tunnel if there is one) is blocked.
 for(int h=0;h<4;h++){
  int hp=b.hop[dest*4+h],n;
  if(hp>=0)n=hp>>2;else{int x=dest%b.w+dx[h],y=dest/b.w+dy[h];if(!b.inside(x,y)){pushState(dest,h);continue;}n=b.at(x,y);}
  if(!enterable(n))pushState(dest,h);
 }
 // (2) The ball enters a teleport cell (dest) whose exit is occupied and stops on it.
 if(trigger(dest)&&enterable(dest)){
  const int ti=b.teleAt[dest],ex=b.teleExit[ti][color];
  if(ex<0||!s.tele[ex]||occupied(b.teleports[ex].p))for(int h=0;h<4;h++)arrive(dest,h);
 }
 // Preimages of the pre-step state (c,h): one entry into a cell (plus arrow and teleport effects) that leaves the ball there.
 for(size_t qi=0;qi<queue.size();qi++){
  const int c=queue[qi]>>2,h=queue[qi]&3;
  if(trigger(c)){
   // c is the exit of a teleport the ball entered at another endpoint (exit must be free; the entry cell needs only to be enterable).
   if(occupied(c))continue;
   const int ci=b.teleAt[c];
   for(int e=0;e<(int)b.teleports.size();e++){
    if(e==ci||!s.tele[e]||!(b.teleports[e].color==4||b.teleports[e].color==color)||b.teleExit[e][color]!=ci)continue;
    const int entry=b.teleports[e].p;
    if(!enterable(entry))continue;
    int ai=b.arrowAt[entry];
    if(ai>=0){if(b.arrowDir(ai,phase)==h)for(int hh=0;hh<4;hh++)arrive(entry,hh);}
    else arrive(entry,h);
   }
  }else{
   if(!enterable(c))continue;
   int ai=b.arrowAt[c];
   if(ai>=0){if(b.arrowDir(ai,phase)==h)for(int hh=0;hh<4;hh++)arrive(c,hh);}
   else arrive(c,h);
  }
 }
 for(int k:queue)if((k>>2)!=dest)out.push_back(k);
 sort(out.begin(),out.end());
}
// ---- Bidirectional BFS (SOLVER-017) ----
// Both searches share one state/memory budget and alternate: each step expands a whole
// layer of whichever side currently has the smaller frontier, and every new state is checked against the other side (from both
// directions). Certification: if the forward side is complete to depth fd and the reverse side to depth rd, every route of at most
// fd+rd moves has been found, so the best candidate is optimal once fd+rd >= best-1 (or no route exists within fd+rd moves).
SearchResult bidirectional(const Board&b,const Limits&lim,ClockLimit&timer,const Packer&pk){
 SearchResult out;out.algorithm="bidirectional BFS";const int D=lim.maxDepth>0?lim.maxDepth:INT32_MAX; // D: only paths of at most D moves matter
 if(!b.staticReverse||b.goals.size()!=b.balls.size())return out;
 State start=initial(b),target=start;
 for(int c=0;c<4;c++){
  vector<int> loc;for(int v:b.goals)if(v/MAX_CELLS==c)loc.push_back(v%MAX_CELLS);sort(loc.begin(),loc.end());
  int idx=0;for(int i=0;i<b.n;i++)if(b.balls[i].color==c){if(idx>=(int)loc.size())return out;target.p[i]=loc[idx++];}
 }
 if(complete(b,start)){out.solved=true;out.exhaustive=true;out.states=1;return out;} // already docked: zero moves, score 0
 // Enumerate all possible terminal polarities of the switch-controlled gate groups and teleports. Gates belonging to
 // a group always toggle together, so their relative active states are invariant: a group needs only ONE bit, not k bits.
 // Gate groups and teleports no switch controls never change, so they stay at their initial state.
 Store rev;rev.init(pk.K);vector<uint8_t> key(pk.K),targetKey(pk.K),checkKey(pk.K);
 const int groupCount=(int)pk.groups.size(),teleCount=(int)pk.teles.size();
 if(groupCount+teleCount>16){if(lim.verbose)LOG<<"too many terminal gate/teleport configurations for reverse seeds\n";return out;}
 uint64_t variants=1ULL<<(groupCount+teleCount);
 if(variants>lim.maxStates/4){if(lim.verbose)LOG<<"terminal configurations exceed reverse budget\n";return out;}
 for(uint64_t mask=0;mask<variants;mask++){
  State candidate=target;
  for(int g=0;g<groupCount;g++)if(mask&(1ULL<<g))for(int j:b.groupGates[pk.groups[g]])candidate.gate[j]^=1;
  for(int k=0;k<teleCount;k++)if(mask&(1ULL<<(groupCount+k)))candidate.tele[pk.teles[k]]^=1;
  bool valid=true;
  for(int i=0;i<b.n;i++){
   int gi=b.gateAt[candidate.p[i]];
   if(gi>=0&&candidate.gate[gi])valid=false;
  }
  if(!valid)continue;
  pk.pack(candidate,key.data());
  if(rev.find(key.data())!=Store::NONE)continue;
  rev.add(key.data());
 }
 if(rev.size()==0)return out;
 rev.closeLayer();
 if(lim.verbose)LOG<<"reverse target seeds "<<rev.size()<<" ("<<variants<<" configurations)\n";
 Store fwd;fwd.init(pk.K);pk.pack(start,key.data());fwd.add(key.data());fwd.closeLayer();
 int best=INT32_MAX;uint32_t fMeet=0,rMeet=0;uint64_t transitions=0;
 auto record=[&](uint32_t fi,uint32_t ri){int len=fwd.depthOf(fi)+rev.depthOf(ri);if(len<best){best=len;fMeet=fi;rMeet=ri;if(lim.verbose)LOG<<"candidate "<<best<<" moves (forward "<<fwd.depthOf(fi)<<", reverse "<<rev.depthOf(ri)<<")\n";}};
 auto meetF=[&](uint32_t fi){uint32_t ri=rev.find(fwd.key(fi));if(ri!=Store::NONE)record(fi,ri);};
 auto meetR=[&](uint32_t ri){uint32_t fi=fwd.find(rev.key(ri));if(fi!=Store::NONE)record(fi,ri);};
 meetF(0);
 auto full=[&](){return rev.size()+fwd.size()>=lim.maxStates||(lim.maxBytes&&rev.bytes()+fwd.bytes()>=lim.maxBytes);};
 int fd=0,rd=0;size_t fHead=0,fEnd=1,rHead=0,rEnd=rev.size();bool limited=false,certified=false,exhausted=false;vector<int> starts;
 while(!timer.expired()&&!limited){
  const size_t fSize=fEnd-fHead,rSize=rEnd-rHead;
  if(fSize==0||rSize==0){exhausted=true;break;} // one side has enumerated everything it can reach
  if(fSize<=rSize){ // expand the whole forward layer of depth fd
   for(;fHead<fEnd&&!limited;fHead++){
    if(timer.expired()||full()){limited=true;break;}
    const size_t fh=fHead;
   State st;pk.unpack(fwd.key(fh),st);
   for(int i=0;i<b.n;i++){
    if(b.goalColor[st.p[i]]==b.balls[i].color)continue;
    for(int d=0;d<4;d++){
     for(int ph=0;ph<b.nPhases&&!limited;ph++){
      bool rot=false;transitions++;int np=fastEnd(b,st,i,d,ph,rot);
      if(np>=0){
       State next=st;next.p[i]=np;
       int swi=b.switchAt[np];if(swi>=0){
        b.fireSwitch(swi,next);
       }
       pk.pack(next,key.data());
       if(fwd.find(key.data())==Store::NONE){
        if(full()){limited=true;break;}
        uint32_t idx=fwd.add(key.data());
        meetF(idx);
       }
      }
      if(!rot)break; // no rotating arrow met: the same for every phase
     }
    }
    if(limited)break;
   }
   }
   if(limited)break;
   fd++;fEnd=fwd.size();fwd.closeLayer();
  }else{ // expand the whole reverse layer of depth rd
   for(;rHead<rEnd&&!limited;rHead++){
    if(timer.expired()||full()){limited=true;break;}
    const size_t rh=rHead;
   State targetState;pk.unpack(rev.key(rh),targetState);pk.pack(targetState,targetKey.data());
   // Predecessors of the target for each ball i: ball i made one move from p in direction d and ended at dest while every other ball stayed put.
   // The predecessor board (other balls, gates, teleports, with the preceding switch undone) does not depend on the start cell, so all valid
   // starts come from one backward ray-cast from dest over the move automaton instead of simulating every (cell, direction) pair.
   for(int i=0;i<b.n&&!limited;i++){
    const int dest=targetState.p[i];
    State tmpl=targetState;
    // Undo the switch activated by the preceding move. The blocked-closing
    // rule is determined by the *post*-move occupancy, not source occupancy.
    const int swi=b.switchAt[dest];
    if(swi>=0){
     b.undoSwitch(swi,tmpl,targetState);
    }
    for(int ph=0;ph<b.nPhases&&!limited;ph++){
    backReach(b,tmpl,i,dest,ph,starts);
    for(int sd:starts){
     const int p=sd>>2;
     // Previously occupied target goal cannot be departed; all other balls stay fixed.
     if(b.fixed[p]||b.goalColor[p]==b.balls[i].color)continue;
     int gi=b.gateAt[p];if(gi>=0&&targetState.gate[gi])continue;
     bool occupied=false;for(int j=0;j<b.n;j++)if(j!=i&&targetState.p[j]==p){occupied=true;break;}if(occupied)continue;
     if(gi>=0&&tmpl.gate[gi])continue;
     transitions++;
     State predecessor=tmpl;predecessor.p[i]=p;
     // Replay the switch's effects to reject invalid reverse candidates.
     State check=predecessor;check.p[i]=dest;
     if(swi>=0){
      b.fireSwitch(swi,check);
     }
     pk.pack(check,checkKey.data());if(memcmp(checkKey.data(),targetKey.data(),pk.K))continue;
     pk.pack(predecessor,key.data());
     if(rev.find(key.data())!=Store::NONE)continue;
     if(full()){limited=true;break;}
     uint32_t idx=rev.add(key.data());
     meetR(idx);
    }
    }
   }
   }
   if(limited)break;
   rd++;rEnd=rev.size();rev.closeLayer();
  }
  if(lim.verbose)LOG<<"forward depth "<<fd<<" reverse depth "<<rd<<" states "<<fwd.size()+rev.size()<<" best "<<(best==INT32_MAX?-1:best)<<" elapsed "<<timer.elapsed()<<"s\n";
  {int need=min(best==INT32_MAX?INT32_MAX:best-1,D);if(need!=INT32_MAX&&(long long)fd+rd>=need){certified=true;break;}}
 }
 out.states=fwd.size()+rev.size();out.bytes=fwd.bytes()+rev.bytes();out.transitions=transitions;out.provenMoves=exhausted?0:fd+rd;
 if(best!=INT32_MAX&&best<=D){
  out.solved=true;out.depth=best;out.exhaustive=certified||exhausted;vector<Move> before,after;
  before=rebuildForward(b,fwd,pk,fMeet);after=rebuildReverse(b,rev,pk,rMeet);
  out.path=std::move(before);out.path.insert(out.path.end(),after.begin(),after.end());
 }else if(best==INT32_MAX){if(exhausted)out.exhaustive=true;else if(certified)out.boundProved=true;}
 else out.boundProved=certified||exhausted;
 return out;
}
// ---- Beam search (SOLVER-014): heuristic upper bound for boards too large for the exact searches ----
// Layer by layer (one layer = one more move) only the `width` best states are kept, ranked by a distance heuristic.
// It finds good routes quickly but NEVER certifies optimality: the result is always "SOLUTION FOUND (optimality not certified)".
// Heuristic: for every unlocked ball the number of moves a lone ball (ignoring all other balls) needs to reach each free goal of
// its color, minimised over the assignment of balls to goals (exact for up to 4 balls per color, greedy beyond); plus the hex
// score collected so far. It is inadmissible (other balls can act as stoppers), which is fine for an upper bound.
struct HashSet64{
 vector<uint64_t> t;size_t n=0;HashSet64():t(1<<16,0){}
 static uint64_t norm(uint64_t k){return k|1;}
 void grow(){vector<uint64_t> o;o.swap(t);t.assign(o.size()*2,0);for(auto k:o)if(k){size_t i=(k>>1)&(t.size()-1);while(t[i])i=(i+1)&(t.size()-1);t[i]=k;}}
 bool has(uint64_t k)const{k=norm(k);size_t i=(k>>1)&(t.size()-1);while(t[i]){if(t[i]==k)return true;i=(i+1)&(t.size()-1);}return false;}
 bool insert(uint64_t k){k=norm(k);if((n+1)*2>t.size())grow();size_t i=(k>>1)&(t.size()-1);while(t[i]){if(t[i]==k)return false;i=(i+1)&(t.size()-1);}t[i]=k;n++;return true;}
 uint64_t bytes()const{return t.size()*8;}
};
struct BeamHeuristic{
 const Board&b;int penalty=20;vector<int> goalCell,goalCol;vector<vector<int>> dist;vector<int> goalsOfColor[4],ballsOfColor[4];
 // All cells where a lone ball stops after sliding from `start` in direction h0 (rotating arrows branch in every direction).
 void lone(int start,int h0,int color,vector<int>&out)const{
  struct Fr{int p,h,steps;bool entered;};vector<Fr> st{{start,h0,0,false}};const int cap=4*b.w*b.h+16;
  while(!st.empty()){
   Fr f=st.back();st.pop_back();int p=f.p,h=f.h;bool entered=f.entered,stopped=false;
   for(int steps=f.steps;steps<cap;steps++){
    int np,nh=h,hp=b.hop[p*4+h];
    if(hp>=0){np=hp>>2;nh=hp&3;}else{int x=p%b.w+dx[h],y=p/b.w+dy[h];if(!b.inside(x,y)){stopped=true;break;}np=b.at(x,y);}
    if(b.fixed[np]){stopped=true;break;}
    int gi=b.gateAt[np];if(gi>=0&&b.gateInit[gi]){stopped=true;break;}
    entered=true;p=np;h=nh;
    int ai=b.arrowAt[p];if(ai>=0){auto a=b.arrows[ai];if(a.rotating){for(int q=1;q<4;q++)st.push_back({p,q,steps+1,true});h=0;}else h=a.dir;}
    int ti=b.teleAt[p];if(ti>=0&&b.teleInit[ti]&&(b.teleports[ti].color==4||b.teleports[ti].color==color)){int ex=b.teleExit[ti][color];if(ex<0||!b.teleInit[ex]){stopped=true;break;}p=b.teleports[ex].p;}
   }
   if(stopped&&entered)out.push_back(p);
  }
 }
 explicit BeamHeuristic(const Board&bd,int pen):b(bd),penalty(pen){
  int N=b.w*b.h;for(int g:b.goals){goalCell.push_back(g%MAX_CELLS);goalCol.push_back(g/MAX_CELLS);}
  for(int g=0;g<(int)goalCell.size();g++)goalsOfColor[goalCol[g]].push_back(g);
  for(int i=0;i<b.n;i++)ballsOfColor[b.balls[i].color].push_back(i);
  vector<vector<int>> rev[4];
  for(int c=0;c<4;c++){rev[c].assign(N,{});for(int p=0;p<N;p++)if(!b.fixed[p])for(int d=0;d<4;d++){vector<int> ends;lone(p,d,c,ends);for(int e:ends)if(e!=p)rev[c][e].push_back(p);}}
  dist.assign(goalCell.size(),vector<int>(N,penalty));
  for(int g=0;g<(int)goalCell.size();g++){auto&D=dist[g];D[goalCell[g]]=0;deque<int> q{goalCell[g]};while(!q.empty()){int t=q.front();q.pop_front();for(int c:rev[goalCol[g]][t])if(D[c]==penalty&&c!=goalCell[g]){D[c]=D[t]+1;q.push_back(c);}}}
 }
 bool dynamic=false;vector<vector<int>> dyn;vector<uint8_t> occ;vector<int> bq; // dyn[ball][cell]: moves for that ball with the other balls fixed where they stand now
 int slideState(const State&s,int color,int p,int h)const{ // where a ball of `color` stops sliding from p in direction h, other balls = occ; -1 if it cannot move or loops
  const int cap=4*b.w*b.h+8;bool entered=false;
  for(int st=0;st<cap;st++){
   int np,nh=h,hp=b.hop[p*4+h];
   if(hp>=0){np=hp>>2;nh=hp&3;}else{int x=p%b.w+dx[h],y=p/b.w+dy[h];if(!b.inside(x,y))return entered?p:-1;np=b.at(x,y);}
   if(b.fixed[np]||occ[np])return entered?p:-1;
   int gi=b.gateAt[np];if(gi>=0&&s.gate[gi])return entered?p:-1;
   entered=true;p=np;h=nh;
   int ai=b.arrowAt[p];if(ai>=0)h=b.arrows[ai].dir;
   int ti=b.teleAt[p];if(ti>=0&&s.tele[ti]&&(b.teleports[ti].color==4||b.teleports[ti].color==color)){int ei=b.teleExit[ti][color];if(ei<0||!s.tele[ei])return p;int ex=b.teleports[ei].p;if(occ[ex])return p;p=ex;}
  }
  return -1;
 }
 void dynBFS(const State&s,int i){
  auto&D=dyn[i];fill(D.begin(),D.end(),1000);vector<int>&q=bq;q.assign(1,s.p[i]);D[s.p[i]]=0;
  for(size_t qi=0;qi<q.size();qi++){int c=q[qi];for(int d=0;d<4;d++){int t=slideState(s,b.balls[i].color,c,d);if(t>=0&&D[t]>D[c]+1){D[t]=D[c]+1;q.push_back(t);}}}
 }
 int D(const State&s,int g,int ball)const{ // lone-ball distance, lowered where the current positions of other balls make it shorter
  int st=dist[g][s.p[ball]];if(!dynamic)return st;int dy=dyn[ball][goalCell[g]];return dy<st?dy:st;
 }
 int rec(const State&s,const int*bp,int k,const int*gs,int m,int i,unsigned used)const{
  if(i==k)return 0;
  int best=INT32_MAX/2;
  for(int j=0;j<m;j++)if(!(used>>j&1))best=min(best,D(s,gs[j],bp[i])+rec(s,bp,k,gs,m,i+1,used|1u<<j));
  return best;
 }
 int eval(const State&s){
  int h=0;
  if(dynamic){occ.assign(b.w*b.h,0);for(int i=0;i<b.n;i++)occ[s.p[i]]=1;for(int i=0;i<b.n;i++)if(b.goalColor[s.p[i]]!=b.balls[i].color){occ[s.p[i]]=0;dynBFS(s,i);occ[s.p[i]]=1;}}
  for(int c=0;c<4;c++){
   if(ballsOfColor[c].empty())continue;
   int bp[128],k=0,gs[128],m=0;
   for(int g:goalsOfColor[c]){bool filled=false;for(int i:ballsOfColor[c])if(s.p[i]==goalCell[g])filled=true;if(!filled)gs[m++]=g;}
   for(int i:ballsOfColor[c])if(b.goalColor[s.p[i]]!=c)bp[k++]=i;
   if(k==0)continue;
   if(k<=4&&m<=12&&m>=k)h+=rec(s,bp,k,gs,m,0,0);
   else{unsigned used=0;for(int i=0;i<k;i++){int bj=-1,bd=INT32_MAX;for(int j=0;j<m&&j<32;j++)if(!(used>>j&1)&&D(s,gs[j],bp[i])<bd){bd=D(s,gs[j],bp[i]);bj=j;}if(bj>=0){used|=1u<<bj;h+=bd;}else h+=penalty;}}
  }
  return h;
 }
};
SearchResult beamSearch(const Board&b,const Limits&lim,ClockLimit&timer,const Packer&pk){
 SearchResult out;out.algorithm="beam search (width "+to_string(lim.beamWidth)+(lim.beamDynamic?", dynamic heuristic":"")+")";
 const size_t W=lim.beamWidth,K=pk.K;
 // Static boards (no switches, no rotating arrows) use an allocation-free move generator; others fall back to successors().
 const bool fast=b.switches.empty(); // allocation-free generator (tunnels, rotating arrows and hexes supported)
 BeamHeuristic H(b,20);
 if(lim.beamDynamic){if(fast&&b.nPhases==1){H.dynamic=true;H.dyn.assign(b.n,vector<int>(b.w*b.h,1000));}else if(lim.verbose)LOG<<"note: --beam-heuristic dynamic needs a board without switches and rotating arrows; using static\n";}
 long long totalNeg=0;for(auto&h:b.hexes)if(h.value<0)totalNeg+=h.value;
 struct Layer{vector<uint8_t> key;vector<uint32_t> parent;vector<uint16_t> source;vector<uint8_t> color,dir,phase;size_t size()const{return parent.size();}};
 vector<Layer> layers(1);
 {State s0=initial(b);if(complete(b,s0)){out.solved=true;out.depth=0;return out;}
  layers[0].key.resize(K);pk.pack(s0,layers[0].key.data());layers[0].parent.push_back(0);layers[0].source.push_back(0);layers[0].color.push_back(0);layers[0].dir.push_back(0);layers[0].phase.push_back(0);}
 HashSet64 seen;seen.insert(hashBytes(layers[0].key.data(),K));
 mt19937_64 rng(lim.seed);
 struct Meta{int sc;uint32_t parent;uint16_t source;uint8_t color,dir,phase;};
 long long bestScore=LLONG_MAX;int bestDepth=-1;uint32_t bestParent=0;Move bestMove;
 const int maxLayers=lim.maxDepth>0?lim.maxDepth:(b.hexes.empty()?1000:200);
 uint64_t transitions=0,layerBytes=K+16;bool limited=false;
 // Certification: without hexes the score is the move count, so layer by layer the beam is a plain BFS until the width first drops a state.
 // dropped = some layer before the current one was incomplete; droppedNow = the layer being generated lost states.
 bool dropped=false,droppedNow=false,exhausted=false;int firstDrop=-1;
 vector<uint8_t> ckey,buf(K);vector<Meta> cm;
 vector<uint8_t> occ(b.w*b.h,0);vector<int> touched;
 for(int depth=0;depth<maxLayers&&!limited;depth++){
  const Layer cur=std::move(layers[depth]); // the layer is only read here; its path data is restored below
  ckey.clear();cm.clear();droppedNow=false;HashSet64 local;
  auto prune=[&](size_t keep){ // keep the `keep` best candidates
   vector<uint32_t> order(cm.size());iota(order.begin(),order.end(),0);
   nth_element(order.begin(),order.begin()+keep,order.end(),[&](uint32_t x,uint32_t y){return cm[x].sc<cm[y].sc;});order.resize(keep);sort(order.begin(),order.end());
   if(cm.size()>keep){droppedNow=true;if(firstDrop<0)firstDrop=depth;}
   vector<uint8_t> nk;nk.reserve(keep*K);vector<Meta> nm;nm.reserve(keep);
   for(uint32_t i:order){nk.insert(nk.end(),ckey.begin()+(size_t)i*K,ckey.begin()+(size_t)(i+1)*K);nm.push_back(cm[i]);}
   ckey.swap(nk);cm.swap(nm);
  };
  auto consider=[&](const State&c,uint32_t parent,int source,int color,int dir,int phase){
   transitions++;
   if(complete(b,c)){long long sc=scoreHex(b,c,depth+1);if(sc<bestScore){bestScore=sc;bestDepth=depth+1;bestParent=parent;bestMove=Move();bestMove.source=source;bestMove.color=color;bestMove.dir=dir;bestMove.phase=phase;}return;}
   pk.pack(c,buf.data());uint64_t hk=hashBytes(buf.data(),K);
   if(seen.has(hk)||!local.insert(hk))return;
   cm.push_back({(H.eval(c)+scoreHex(b,c,0))*16+(int)(rng()&15),parent,(uint16_t)source,(uint8_t)color,(uint8_t)dir,(uint8_t)phase});ckey.insert(ckey.end(),buf.begin(),buf.end());
   if(cm.size()>=3*W+1024)prune(W);
  };
  State ps,scratch;
  for(size_t ni=0;ni<cur.size()&&!limited;ni++){
   if((ni&255)==0&&(timer.expired()||(lim.maxBytes&&seen.bytes()+layerBytes>lim.maxBytes))){limited=true;break;}
   pk.unpack(&cur.key[ni*K],ps);
   if(!fast){Stats st;successors(b,ps,st,[&](Transition&&t){consider(t.s,(uint32_t)ni,t.m.source,t.m.color,t.m.dir,t.m.phase);});continue;}
   fill(occ.begin(),occ.end(),0);for(int i=0;i<b.n;i++)occ[ps.p[i]]=1;scratch=ps;
   for(int i=0;i<b.n;i++){
    if(b.goalColor[ps.p[i]]==b.balls[i].color)continue;
    occ[ps.p[i]]=0;
    for(int d=0;d<4;d++){
     for(int ph=0;ph<b.nPhases;ph++){
      int p=ps.p[i],h=d;bool entered=false,stopped=false,rot=false;touched.clear();const int cap=4*b.w*b.h+8;
      for(int steps=0;steps<cap;steps++){
       int np,nh=h,hp=b.hop[p*4+h];
       if(hp>=0){np=hp>>2;nh=hp&3;}else{int x=p%b.w+dx[h],y=p/b.w+dy[h];if(!b.inside(x,y)){stopped=true;break;}np=b.at(x,y);}
       if(b.fixed[np]||occ[np]){stopped=true;break;}
       int gi=b.gateAt[np];if(gi>=0&&ps.gate[gi]){stopped=true;break;}
       entered=true;p=np;h=nh;
       int hi=b.hexAt[p];if(hi>=0&&!scratch.hex[hi]){scratch.hex[hi]=1;touched.push_back(hi);}
       int ai=b.arrowAt[p];if(ai>=0){if(b.arrows[ai].rotating)rot=true;h=b.arrowDir(ai,ph);}
       int ti=b.teleAt[p];if(ti>=0&&ps.tele[ti]&&(b.teleports[ti].color==4||b.teleports[ti].color==b.balls[i].color)){int ei=b.teleExit[ti][b.balls[i].color];if(ei<0||!ps.tele[ei]){stopped=true;break;}int ex=b.teleports[ei].p;if(occ[ex]){stopped=true;break;}p=ex;}
      }
      if(stopped&&entered){scratch.p[i]=p;consider(scratch,(uint32_t)ni,ps.p[i],b.balls[i].color,d,ph);scratch.p[i]=ps.p[i];}
      for(int hi:touched)scratch.hex[hi]=0;
      if(!rot)break; // a move that meets no rotating arrow is the same for every phase (loops without one are too)
     }
    }
    occ[ps.p[i]]=1;
   }
  }
  layers[depth]=cur;
  if(limited)break;
  if(bestDepth>=0&&(b.hexes.empty()||depth+2+totalNeg>=bestScore))break; // no later layer can beat the best route
  if(cm.empty()){exhausted=true;break;}
  if(cm.size()>W)prune(W);
  if(droppedNow)dropped=true; // layer depth+1 is incomplete
  Layer nl;nl.key=ckey;for(size_t i=0;i<cm.size();i++){nl.parent.push_back(cm[i].parent);nl.source.push_back(cm[i].source);nl.color.push_back(cm[i].color);nl.dir.push_back(cm[i].dir);nl.phase.push_back(cm[i].phase);seen.insert(hashBytes(&nl.key[i*K],K));}
  layerBytes+=nl.size()*(K+9);
  if(lim.verbose){int best=INT32_MAX;for(auto&m:cm)best=min(best,m.sc>>4);LOG<<"beam depth "<<depth+1<<" kept "<<nl.size()<<" best rank "<<best<<" elapsed "<<timer.elapsed()<<"s\n";}
  layers.push_back(std::move(nl));
 }
 out.states=seen.n;out.transitions=transitions;out.bytes=seen.bytes()+layerBytes;
 // A solution found while generating layer D is optimal when layers 0..D-1 are complete (nothing dropped before; hex-free boards only).
 // `dropped` is updated after each layer's best-route check, so at the break it still describes only the layers before the current one.
 const bool noHex=b.hexes.empty();
 if(bestDepth>=0){
  out.solved=true;out.exhaustive=noHex&&!dropped;out.depth=bestDepth;vector<Move> rv{bestMove};uint32_t at=bestParent;
  for(int d=bestDepth-1;d>=1;d--){Move m;m.source=layers[d].source[at];m.color=layers[d].color[at];m.dir=layers[d].dir[at];m.phase=layers[d].phase[at];rv.push_back(m);at=layers[d].parent[at];}
  reverse(rv.begin(),rv.end());out.path=std::move(rv);
 }else if(!limited&&!dropped&&!droppedNow){
  if(exhausted)out.exhaustive=true; // the whole reachable space was enumerated without dropping anything: unsolvable
  else if(noHex&&lim.maxDepth>0)out.boundProved=true; // all layers up to the depth limit were complete
 }
 if(noHex&&!out.exhaustive&&firstDrop>=0&&!(bestDepth>=0&&bestDepth<=firstDrop+1))out.provenMoves=firstDrop+1; // layers 0..firstDrop were complete: no route of at most firstDrop+1 moves
 return out;
}
// Convert source-position moves to the specific, stable IDs of the original labeled balls.
struct LabeledMove{int ball,dir;string choices;}; // choices: annotation letters, e.g. "ur" for (->ur)
vector<LabeledMove> labelAndVerify(const Board&b,const vector<Move>& path,int& finalScore){
 State st=initial(b);vector<int> labeledPositions;for(auto x:b.balls)labeledPositions.push_back(x.p);
 vector<LabeledMove> result;int depth=0;
 for(const Move &m:path){
  int bi=-1;for(int i=0;i<b.n;i++)if(b.balls[i].color==m.color&&labeledPositions[i]==m.source){bi=i;break;}
  if(bi<0)throw runtime_error("internal route error: missing source ball");
  State next;int delta=0;string ann;
  int status=simulate(b,st,bi,m.dir,m.phase,next,delta,ann);
  if(status!=1)throw runtime_error("internal route error: illegal move");
  labeledPositions[bi]=next.p[bi];st=std::move(next);depth++;
  result.push_back({bi,m.dir,ann});
 }
 finalScore=scoreHex(b,st,depth);
 if(!complete(b,st))throw runtime_error("internal route error: unfinished");
 return result;
}
string formatMoves(const Board&b,const vector<LabeledMove>& path){string out;int last=-1;for(const auto& m:path){if(last!=m.ball){if(!out.empty())out+=',';out+=b.balls[m.ball].name;last=m.ball;}out+=DIR[m.dir];if(!m.choices.empty())out+="(->"+m.choices+")";}return out;}
vector<Byte> packedSolution(const Board&b,const vector<LabeledMove>& path){
 vector<Byte> bytes;putuint(bytes,path.size());bool hasChoices=false;for(auto&m:path)if(!m.choices.empty())hasChoices=true;bytes.push_back(hasChoices?1:0);
 int width=0;while((1ULL<<width)<(uint64_t)b.n*4)width++;
 auto pack=[&](const vector<int>&v,int bits){int cur=0,count=0;for(int x:v){for(int j=bits-1;j>=0;j--){cur=cur*2+((x>>j)&1);if(++count==8){bytes.push_back(cur);cur=0;count=0;}}}if(count)bytes.push_back(cur<<(8-count));};
 vector<int> vals;for(auto m:path)vals.push_back(m.ball*4+m.dir);pack(vals,width);
 if(hasChoices){vector<int> opts;for(auto&m:path){putuint(bytes,m.choices.size());for(char c:m.choices)opts.push_back(DIR.find(c));}pack(opts,2);}
 return bytes;
}
string codeWithSolution(const Board&b,const vector<LabeledMove>& path){
 bool hasTypes=false;for(auto&a:b.arrows)if(a.rotating&&a.type!=0)hasTypes=true;
 vector<Byte> raw={0xB3,(Byte)b.w,(Byte)b.h,(Byte)((b.hasDescription?1:0)|2|(b.wallColor>=0?4:0)|(b.tunnels.empty()?0:8)|(hasTypes?16:0))};
 unordered_map<string,int> dict;
 auto str=[&](const string& s){auto it=dict.find(s);if(it!=dict.end()){putuint(raw,it->second*2+1);return;}putuint(raw,s.size()*2);raw.insert(raw.end(),s.begin(),s.end());int index=dict.size();dict.emplace(s,index);};
 auto pos=[&](int p){putuint(raw,p);};
 str(b.id);str(b.title);if(b.hasDescription)str(b.description);if(b.wallColor>=0)putuint(raw,b.wallColor);
 vector<Byte> sol=packedSolution(b,path);putuint(raw,sol.size());raw.insert(raw.end(),sol.begin(),sol.end());
 putuint(raw,b.wall.size());for(int p:b.wall)pos(p);
 putuint(raw,b.balls.size());for(auto ball:b.balls){pos(ball.p);putuint(raw,ball.color);}
 putuint(raw,b.goals.size());for(int g:b.goals){pos(g%MAX_CELLS);putuint(raw,g/MAX_CELLS);}
 putuint(raw,b.arrows.size());for(auto a:b.arrows){pos(a.p);putuint(raw,2*a.dir+(a.rotating?1:0));}
 putuint(raw,b.gates.size());for(auto g:b.gates){pos(g.p);str(g.id);putuint(raw,g.active);}
 putuint(raw,b.switches.size());for(auto t:b.switches){pos(t.p);str(t.id);putuint(raw,t.on);putuint(raw,t.controls.size());for(auto&id:t.controls)str(id);}
 putuint(raw,b.teleports.size());for(auto t:b.teleports){pos(t.p);str(t.id);putuint(raw,t.color);putuint(raw,t.active);}
 putuint(raw,b.hexes.size());for(auto h:b.hexes){pos(h.p);str(h.id);putuint(raw,h.value<0?(uint64_t)(-2LL*h.value-1):(uint64_t)(2LL*h.value));}
 if(!b.tunnels.empty()){putuint(raw,b.tunnels.size());for(auto&t:b.tunnels){pos(t.pa);putuint(raw,t.sa);pos(t.pb);putuint(raw,t.sb);}}
 if(hasTypes){string digits;for(auto&a:b.arrows)if(a.rotating)digits+=a.type==2?'0':a.type==0?'1':'2';str(digits);}
 return "K3."+b64encode(raw);
}
string readInput(const string& argument){ifstream f(argument,ios::binary);if(f.good()){string s((istreambuf_iterator<char>(f)),{});return trim(s);}return argument;}
string catalogCode(const string& id,const string& filename){ifstream file(filename);if(!file)throw runtime_error("cannot open levels.js: "+filename);string line;while(getline(file,line)){line=trim(line);string prefix=id+" = ";if(line.rfind(prefix,0)==0)return trim(line.substr(prefix.size()));}throw runtime_error("level not found: "+id);}
static const char* SOLVER_VERSION="0.18"; // Solver's own version, independent of the web app's APP_VERSION.
// ---- Core entry point (shared by the CLI and the WebAssembly build) ----
struct Cli{Limits lim;string input,level,catalog="levels.js";bool wantK3=true,version=false,help=false,json=false;};
static const char* HELP_TEXT="Kunundrum exact C++ solver (K3)\nUsage: kunsolve BOARD_CODE_OR_FILE [--algorithm auto|forward|bidirectional|beam] [--beam-width N] [--beam-heuristic static|dynamic] [--seed N] [--max-states N] [--seconds N] [--max-memory MB] [--max-depth N] [--max-score N] [--quiet] [--version]\n       kunsolve --level ID [--catalog levels.js] [options]\nOutput: lowest-score route (fewest moves among equal scores), its score and move count, and K3 code including solution.\nauto = bidirectional search when applicable (no hexes, equal goals/balls, at least 3 balls), else forward.\nbeam = heuristic: certifies optimality (exit 0) only on hex-free boards when no state was ever dropped by the beam width, otherwise an upper bound (exit 2).\n0 = unlimited for --max-states, --seconds and --max-memory (memory is then the real limit).\nExit codes: 0 optimal, 2 inconclusive, 3 exhausted/unsolvable, 4 no solution within --max-depth or --max-score (proved bound), 1 error.\n";
// Same flags as the command line; the WebAssembly export passes its options as a flag string.
static Cli parseArgs(const vector<string>&args){
 Cli c;Limits&lim=c.lim;string&input=c.input,&level=c.level,&catalog=c.catalog;bool&wantK3=c.wantK3;
 for(size_t i=0;i<args.size();i++){const string&a=args[i];auto value=[&](){if(++i>=args.size())throw runtime_error("missing argument for "+a);return args[i];};
  if(a=="--version"){c.version=true;return c;}
  if(a=="--help"||a=="-h"){c.help=true;return c;}
  if(a=="--json"){c.json=true;continue;}
   else if(a=="--level")level=value();else if(a=="--catalog")catalog=value();else if(a=="--algorithm")lim.algorithm=value();else if(a=="--max-states"){lim.maxStates=stoull(value());if(lim.maxStates==0)lim.maxStates=UINT64_MAX;}else if(a=="--max-memory"){lim.maxBytes=stoull(value())<<20;}else if(a=="--seconds")lim.seconds=stod(value());else if(a=="--max-score"){lim.maxScore=stoll(value());lim.scoreCap=true;if(lim.maxScore<-1000000000000LL||lim.maxScore>1000000000000LL)throw runtime_error("--max-score out of range");}else if(a=="--max-depth"){lim.maxDepth=stoi(value());if(lim.maxDepth<1)throw runtime_error("--max-depth must be at least 1");}else if(a=="--beam-width"){lim.beamWidth=stoull(value());if(lim.beamWidth<1)throw runtime_error("--beam-width must be at least 1");}else if(a=="--beam-heuristic"){string v=value();if(v!="static"&&v!="dynamic")throw runtime_error("--beam-heuristic must be static or dynamic");lim.beamDynamic=v=="dynamic";}else if(a=="--seed")lim.seed=stoull(value());else if(a=="--quiet")lim.verbose=false;else if(a=="--no-code")wantK3=false;else if(a.rfind("--",0)==0)throw runtime_error("unknown option: "+a);else if(input.empty())input=a;else throw runtime_error("unexpected argument: "+a);
 }
 return c;
}
struct Outcome{int exit=1;string status,algorithm,solution,k3,error,text;bool hasSolution=false,hasLowerScore=false;long long score=0,lowerScore=0;int moves=0,lowerMoves=0;uint64_t states=0,transitions=0,memMB=0;double elapsed=0;};
static string jstr(const string&s){string r="\"";for(unsigned char ch:s){if(ch=='"'||ch=='\\'){r+='\\';r+=(char)ch;}else if(ch<0x20){char b[8];snprintf(b,sizeof b,"\\u%04x",ch);r+=b;}else r+=(char)ch;}return r+"\"";}
static string toJson(const Outcome&o){ostringstream j;j<<"{\"exit\":"<<o.exit<<",\"status\":"<<jstr(o.status)<<",\"hasSolution\":"<<(o.hasSolution?"true":"false")<<",\"score\":"<<o.score<<",\"moves\":"<<o.moves<<",\"solution\":"<<jstr(o.solution)<<",\"k3\":"<<jstr(o.k3)<<",\"lowerMoves\":"<<o.lowerMoves<<",\"hasLowerScore\":"<<(o.hasLowerScore?"true":"false")<<",\"lowerScore\":"<<o.lowerScore<<",\"algorithm\":"<<jstr(o.algorithm)<<",\"states\":"<<o.states<<",\"transitions\":"<<o.transitions<<",\"memoryMB\":"<<o.memMB<<",\"elapsed\":"<<o.elapsed<<",\"error\":"<<jstr(o.error)<<"}";return j.str();}
// Solves one board code. Writes progress lines to LOG; never throws (errors go to Outcome::error, exit 1).
static Outcome solveBoard(const string&input,Limits lim,bool wantK3){
 Outcome o;ostringstream os;
 try{
  o.exit=[&]()->int{
  if(lim.maxStates<2||lim.seconds<0)throw runtime_error("invalid resource limits");
  Board b=parseCode(input);LOG<<"board "<<b.id<<" ("<<b.w<<"x"<<b.h<<") "<<b.n<<" balls, "<<b.hexes.size()<<" hexes, "<<b.switches.size()<<" switches\n";
  const int userDepth=lim.maxDepth;
  if(lim.scoreCap&&b.hexes.empty()&&lim.maxScore>=1){ // without hexes the score is the move count, so the score bound is a depth bound (also usable by the bidirectional search)
   lim.maxDepth=lim.maxDepth>0?(int)min<long long>(lim.maxDepth,lim.maxScore):(int)min<long long>(lim.maxScore,1000000);
  }
  ClockLimit timer(lim.seconds);
  SearchResult res;
  Packer pk;pk.init(b);
  int terminalBits=(int)(pk.groups.size()+pk.teles.size());
  bool feasibleSeeds=terminalBits<=16&&(1ULL<<terminalBits)<=lim.maxStates/4;
  bool canBi=b.staticReverse&&b.goals.size()==b.balls.size()&&feasibleSeeds;
  if(lim.algorithm=="bidirectional"&&!canBi)throw runtime_error("bidirectional search requires no hexagons, equal goals/balls and an affordable terminal-state enumeration");
  if(lim.algorithm=="bidirectional"||(lim.algorithm=="auto"&&canBi&&b.n>=3))res=bidirectional(b,lim,timer,pk);
  else if(lim.algorithm=="beam")res=beamSearch(b,lim,timer,pk);
  else if(lim.algorithm=="auto"||lim.algorithm=="forward")res=forwardBFS(b,lim,timer,pk);
  else throw runtime_error("unknown algorithm");
  o.algorithm=res.algorithm;o.states=res.states;o.transitions=res.transitions;o.memMB=res.bytes>>20;o.elapsed=timer.elapsed();
  os<<"Algorithm: "<<res.algorithm<<"\n"<<(userDepth>0?"Depth limit: "+to_string(userDepth)+"\n":string())+(lim.scoreCap?"Score limit: "+to_string(lim.maxScore)+"\n":string())<<"States: "<<res.states<<"\nTransitions: "<<res.transitions<<"\nMemory: "<<(res.bytes>>20)<<" MB\nElapsed: "<<timer.elapsed()<<" s\n";
  if(res.solved){int score;auto route=labelAndVerify(b,res.path,score);bool optimal=res.exhaustive;
   o.status=optimal?"OPTIMAL":"SOLUTION FOUND (optimality not certified)";o.hasSolution=true;o.score=score;o.moves=(int)route.size();o.solution=formatMoves(b,route);if(wantK3&&!route.empty())o.k3=codeWithSolution(b,route);
   os<<o.status<<"\nScore: "<<score<<"\nMoves: "<<o.moves<<"\nSolution: "<<o.solution<<"\n";if(!o.k3.empty())os<<"K3: "<<o.k3<<"\n";
   if(!optimal&&res.provenMoves>0&&res.provenMoves<(int)route.size()){o.lowerMoves=res.provenMoves+1;os<<"Lower bound: at least "<<o.lowerMoves<<" moves\n";}
   if(!optimal)LOG<<"WARNING: search did not complete the layers needed to certify optimality\n";
   return optimal?0:2;
  }
  if(res.boundProved){
   if(lim.scoreCap){o.status="NO SOLUTION WITH SCORE <= "+to_string(lim.maxScore)+(userDepth>0?" WITHIN "+to_string(userDepth)+" MOVES":string());os<<o.status<<"\n";if(userDepth==0){o.hasLowerScore=true;o.lowerScore=lim.maxScore+1;os<<"Lower bound: score at least "<<o.lowerScore<<"\n";}}
   else{o.status="NO SOLUTION WITHIN "+to_string(lim.maxDepth)+" MOVES";o.lowerMoves=lim.maxDepth+1;os<<o.status<<"\nLower bound: at least "<<o.lowerMoves<<" moves\n";}
   return 4;}
  o.status=res.exhaustive?"UNSOLVABLE":"INCONCLUSIVE";os<<o.status<<"\n";if(!res.exhaustive&&res.provenMoves>0){o.lowerMoves=res.provenMoves+1;os<<"Lower bound: at least "<<o.lowerMoves<<" moves (no solution within "<<res.provenMoves<<" moves)\n";}return res.exhaustive?3:2;

  }();
 }catch(const bad_alloc&){o.error="out of memory";o.exit=1;LOG<<"Error: out of memory\n";}
 catch(const exception&e){o.error=e.what();o.exit=1;LOG<<"Error: "<<e.what()<<"\n";}
 o.text=os.str();return o;
}
int main(int argc,char**argv){
 try{
  Cli c=parseArgs(vector<string>(argv+1,argv+argc));
  if(c.version){cout<<"kunsolve v"<<SOLVER_VERSION<<"\n";return 0;}
  if(c.help){cout<<HELP_TEXT;return 0;}
  string input=c.input;
  if(input.empty()&&c.level.empty())throw runtime_error("missing board code/file or --level");
  if(!c.level.empty())input=catalogCode(c.level,c.catalog);else if(input=="-"){input=string((istreambuf_iterator<char>(cin)),{});}else input=readInput(input);
  Outcome o=solveBoard(input,c.lim,c.wantK3);
  if(c.json)cout<<toJson(o)<<"\n";else cout<<o.text;
  return o.exit;
 }catch(const exception&e){cerr<<"Error: "<<e.what()<<"\n";return 1;}
}
#ifdef __EMSCRIPTEN__
// ---- WebAssembly export: kun_solve(boardCode, "--flag value ...") -> JSON (see toJson). Progress lines go to Module.onProgress(line). ----
#include <emscripten.h>
EM_JS(void,kun_progress,(const char* line),{if(Module.onProgress)Module.onProgress(UTF8ToString(line));});
EM_JS_DEPS(kun_progress_deps,"$UTF8ToString");
namespace{struct LineBuf:streambuf{string cur;int overflow(int ch)override{if(ch=='\n'){kun_progress(cur.c_str());cur.clear();}else if(ch!=EOF)cur+=(char)ch;return ch==EOF?0:ch;}};}
extern "C" EMSCRIPTEN_KEEPALIVE const char* kun_solve(const char*code,const char*flags){
 static string out;LineBuf lb;ostream ls(&lb);g_log=&ls;Outcome o;
 try{vector<string> args;istringstream is(flags?flags:"");string w;while(is>>w)args.push_back(w);Cli c=parseArgs(args);o=solveBoard(code?code:"",c.lim,c.wantK3);}
 catch(const exception&e){o.error=e.what();o.exit=1;}
 g_log=&cerr;out=toJson(o);return out.c_str();
}
#endif
