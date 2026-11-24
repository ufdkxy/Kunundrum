// Kunundrum native exact solver. C++17; no dependencies. K4 board codes.
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
#ifndef __EMSCRIPTEN__ // the WebAssembly build stays single-threaded
#include <atomic>
#include <thread>
#define KUN_THREADS 1
#endif
using namespace std;
using Byte=uint8_t;
static constexpr int MAX_CELLS=1024;
static const string DIR="udlr", COLORS="RGBY*";
int colorIndex(char c){auto n=COLORS.find(c);if(n==string::npos)throw runtime_error("invalid color");return (int)n;}
int dx[4]={0,0,-1,1},dy[4]={1,-1,0,0};
string trim(string s){auto a=s.find_first_not_of(" \t\r\n"),b=s.find_last_not_of(" \t\r\n");return a==string::npos?"":s.substr(a,b-a+1);}
struct Ball{int p,color,ordinal;string name;};
struct Gate{int p;string id;bool active;};
struct Switch{int p;string id;bool on;vector<string> controls;};
struct Teleport{int p,color;string id;bool active;}; // one endpoint; partners are derived from colors (see teleExit)
struct Hex{int p,value;string id;};
struct Arrow{int p,dir;bool rotating;int type=0;}; // type: 0 clockwise, 1 counterclockwise, 2 flip (rotating arrows only)
struct Tunnel{int pa,sa,pb,sb;}; // two openings: cell and side (0..3 = u,d,l,r)
struct Board{
 int w=0,h=0;int wallColor=-1;vector<Ball> balls;vector<int> wall,goals;vector<Gate> gates;vector<Switch> switches;vector<Teleport> teleports;vector<Hex> hexes;vector<Arrow> arrows;vector<Tunnel> tunnels;
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
 int threads=1; // workers used by rebuild()
 uint32_t find(const uint8_t*k,uint64_t h)const{size_t mask=table.size()-1,pos=h&mask;for(;;pos=(pos+1)&mask){uint32_t e=table[pos];if(e==NONE)return NONE;if(!memcmp(at(e),k,K))return e;}}
 uint32_t find(const uint8_t*k)const{return find(k,hashBytes(k,K));}
 void prefetch(uint64_t h)const{__builtin_prefetch(&table[h&(table.size()-1)]);}
 void place(uint32_t idx,uint64_t h){size_t mask=table.size()-1,pos=h&mask;while(table[pos]!=NONE)pos=(pos+1)&mask;table[pos]=idx;}
 void rebuild(size_t n,size_t slots){count=n;table.assign(slots,NONE);
#ifdef KUN_THREADS
  if(threads>1&&n>(1u<<18)){ // parallel re-insertion: the nodes are distinct, so claiming a free slot with compare-and-swap is enough
   const size_t mask=slots-1,per=(n+threads-1)/threads;vector<thread> pool;
   for(int t=0;t<threads;t++)pool.emplace_back([&,t]{const size_t a=t*per,e=min(n,a+per);for(size_t i=a;i<e;i++){size_t pos=hashBytes(at(i),K)&mask;for(;;pos=(pos+1)&mask){uint32_t exp=NONE;if(__atomic_compare_exchange_n(&table[pos],&exp,(uint32_t)i,false,__ATOMIC_RELAXED,__ATOMIC_RELAXED))break;}}});
   for(auto&x:pool)x.join();
   return;}
#endif
  for(size_t i=0;i<n;i++)place((uint32_t)i,hashBytes(at(i),K));}
 // Adds a state known to be absent (call find first). Returns its index.
 uint32_t add(const uint8_t*k){return add(k,hashBytes(k,K));}
 uint32_t add(const uint8_t*k,uint64_t h){
  if((count+1)*2>table.size())rebuild(count,table.size()*2);
  size_t idx=count;if((idx>>SHIFT)>=chunks.size())chunks.emplace_back(new uint8_t[(size_t)stride<<SHIFT]);
  memcpy(at(idx),k,K);
  count++;place((uint32_t)idx,h);return (uint32_t)idx;
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
struct Limits{uint64_t maxStates=3000000;/* UINT64_MAX = unlimited */uint64_t maxBytes=0;/* 0 = unlimited */double seconds=60;/* 0 = unlimited */int maxDepth=0;/* 0 = unlimited */bool scoreCap=false;long long maxScore=0;/* --max-score: only routes with score <= maxScore matter */bool verbose=true;string algorithm="auto";bool beamDynamic=false;size_t beamWidth=200000;int threads=0;/* worker threads for the exact searches; 0 = all cores (the WebAssembly build always uses 1) */uint64_t seed=1;/* --algorithm beam: states kept per layer, tie-break seed */};
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
// ---- Parallel layer expansion (v0.19) ----
// A layer of parents [lo,hi) is cut into tasks of TASK_PARENTS parents, BATCH_TASKS tasks per batch. In each batch the tasks run in parallel:
// gen(parent, buffer, transitions) only READS the stores and appends candidate records to its task buffer. Then the main thread merges the
// buffers in task order (merge(buffer): deduplicate against the stores, add, meeting/acceptance checks), so insertion order, routes and counts
// are independent of the number of threads. The task/batch layout is fixed for the same reason. merge returns false to stop.
static constexpr size_t TASK_PARENTS=1024,BATCH_TASKS=32;
template<class Gen,class Merge,class Stop>
void expandLayer(size_t lo,size_t hi,int threads,uint64_t&transitions,Gen gen,Merge merge,Stop stop){
 vector<vector<uint8_t>> bufs(BATCH_TASKS);vector<uint64_t> trs(BATCH_TASKS,0);
 for(size_t base=lo;base<hi;){
  if(stop())return;
  const size_t span=min(hi-base,TASK_PARENTS*BATCH_TASKS),nt=(span+TASK_PARENTS-1)/TASK_PARENTS;
  auto work=[&](size_t t){bufs[t].clear();trs[t]=0;const size_t a=base+t*TASK_PARENTS,e=min(base+span,a+TASK_PARENTS);for(size_t i=a;i<e;i++)gen(i,bufs[t],trs[t]);};
#ifdef KUN_THREADS
  const size_t th=min<size_t>((size_t)max(threads,1),nt);
  if(th>1){atomic<size_t> next{0};auto run=[&]{for(size_t t;(t=next++)<nt;)work(t);};vector<thread> pool;for(size_t k=1;k<th;k++)pool.emplace_back(run);run();for(auto&x:pool)x.join();}
  else
#endif
  for(size_t t=0;t<nt;t++)work(t);
  for(size_t t=0;t<nt;t++){transitions+=trs[t];if(!merge(bufs[t]))return;}
  base+=span;
 }
}
SearchResult forwardBFS(const Board&b,const Limits&lim,ClockLimit&timer,const Packer&pk){SearchResult out;out.algorithm="forward BFS";State s0=initial(b);
 Store store;store.init(pk.K);store.threads=lim.threads;vector<uint8_t> key(pk.K);pk.pack(s0,key.data());store.add(key.data());store.closeLayer();
 if(complete(b,s0)){out.solved=true;out.exhaustive=true;out.states=1;out.bytes=store.bytes();return out;}
 const bool byScore=!b.hexes.empty();
 const bool prune=byScore||lim.scoreCap; // bound-based pruning: needed for the score objective with hexes, and for --max-score
 long long negAll=0;for(const auto&h:b.hexes)if(h.value<0)negAll+=h.value;
 long long best=lim.scoreCap?lim.maxScore+1:LLONG_MAX; // routes must score below best; --max-score S starts it at S+1
 auto full=[&](){return store.size()>=lim.maxStates||(lim.maxBytes&&store.bytes()>=lim.maxBytes);};
 uint32_t found=0;bool success=false,limit=false,depthCut=false;uint64_t transitions=0;int dep=0;size_t lo=0,hi=1;
 const size_t K=pk.K,R=K+17; // candidate record: packed state, hash, value (score if accepted, else lower bound), accepted flag
 auto gen=[&](size_t parent,vector<uint8_t>&buf,uint64_t&tr){
  thread_local vector<uint8_t> kb;kb.resize(K);
  State ps;pk.unpack(store.key(parent),ps);
  if(prune&&scoreLowerBound(b,ps,dep)>=best)return; // cannot beat the best route found so far or the --max-score bound
  Stats st;
  successors(b,ps,st,[&](Transition&& t){pk.pack(t.s,kb.data());const uint64_t h=hashBytes(kb.data(),K);if(store.find(kb.data(),h)!=Store::NONE)return;
   const bool acc=complete(b,t.s);const long long v=acc?scoreHex(b,t.s,dep+1):(prune?scoreLowerBound(b,t.s,dep+1):0);
   const size_t at=buf.size();buf.resize(at+R);memcpy(&buf[at],kb.data(),K);memcpy(&buf[at+K],&h,8);memcpy(&buf[at+K+8],&v,8);buf[at+K+16]=acc;});
  tr+=st.transitions;};
 auto merge=[&](vector<uint8_t>&buf){
  for(size_t o=0;o<buf.size();o+=R){
   if(o+16*R<buf.size()){uint64_t hp;memcpy(&hp,&buf[o+16*R+K],8);store.prefetch(hp);}
   const uint8_t*k=&buf[o];uint64_t h;long long v;memcpy(&h,k+K,8);memcpy(&v,k+K+8,8);const bool acc=k[K+16];
   if(store.find(k,h)!=Store::NONE)continue; // duplicate within this layer (the workers only saw earlier layers)
   if(prune&&v>=best)continue; // a finished route that cannot beat the incumbent or the bound, or a state whose lower bound cannot
   if(lim.maxDepth>0&&dep+1>=lim.maxDepth){ // Last allowed layer: only test acceptance. These states are never expanded, so they are not stored unless accepted.
    if(acc){if(v<best){best=v;found=store.add(k,h);success=true;}}else depthCut=true;
    continue;}
   if(full()){limit=true;return false;}
   const uint32_t ni=store.add(k,h);
   if(acc&&v<best){best=v;found=ni;success=true;}
   if(success&&!byScore)return false;
  }
  return true;};
 auto stop=[&]{if(full()||timer.expired())limit=true;return limit||(success&&!byScore);};
 while(lo<hi&&!(success&&!byScore)){
  if(full()||timer.expired()){limit=true;break;}
  if(dep>0)store.closeLayer();
  if(lim.verbose){LOG<<"forward depth "<<dep<<" visited "<<store.size()<<" elapsed "<<timer.elapsed()<<"s";if(success)LOG<<" best score "<<best;LOG<<"\n";}
  expandLayer(lo,hi,lim.threads,transitions,gen,merge,stop);
  if(limit)break;
  lo=hi;hi=store.size();dep++;
 }
 out.states=store.size();out.bytes=store.bytes();out.transitions=transitions;out.solved=success;
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
 Store rev;rev.init(pk.K);rev.threads=lim.threads;vector<uint8_t> key(pk.K);
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
 Store fwd;fwd.init(pk.K);fwd.threads=lim.threads;pk.pack(start,key.data());fwd.add(key.data());fwd.closeLayer();
 int best=INT32_MAX;uint32_t fMeet=0,rMeet=0;uint64_t transitions=0;
 auto record=[&](uint32_t fi,uint32_t ri){int len=fwd.depthOf(fi)+rev.depthOf(ri);if(len<best){best=len;fMeet=fi;rMeet=ri;if(lim.verbose)LOG<<"candidate "<<best<<" moves (forward "<<fwd.depthOf(fi)<<", reverse "<<rev.depthOf(ri)<<")\n";}};
 auto meetF=[&](uint32_t fi){uint32_t ri=rev.find(fwd.key(fi));if(ri!=Store::NONE)record(fi,ri);};
 meetF(0);
 auto full=[&](){return rev.size()+fwd.size()>=lim.maxStates||(lim.maxBytes&&rev.bytes()+fwd.bytes()>=lim.maxBytes);};
 int fd=0,rd=0;size_t fHead=0,fEnd=1,rHead=0,rEnd=rev.size();bool limited=false,certified=false,exhausted=false;
 const size_t K=pk.K,R=K+12; // candidate record: packed state, hash, index of the same state in the opposite store (or NONE)
 auto genF=[&](size_t fh,vector<uint8_t>&buf,uint64_t&tr){
  thread_local vector<uint8_t> kb;kb.resize(K);
  State st;pk.unpack(fwd.key(fh),st);
  for(int i=0;i<b.n;i++){
   if(b.goalColor[st.p[i]]==b.balls[i].color)continue;
   for(int d=0;d<4;d++){
    for(int ph=0;ph<b.nPhases;ph++){
     bool rot=false;tr++;int np=fastEnd(b,st,i,d,ph,rot);
     if(np>=0){
      State next=st;next.p[i]=np;
      int swi=b.switchAt[np];if(swi>=0)b.fireSwitch(swi,next);
      pk.pack(next,kb.data());const uint64_t h=hashBytes(kb.data(),K);
      if(fwd.find(kb.data(),h)==Store::NONE){const uint32_t o=rev.find(kb.data(),h);const size_t at=buf.size();buf.resize(at+R);memcpy(&buf[at],kb.data(),K);memcpy(&buf[at+K],&h,8);memcpy(&buf[at+K+8],&o,4);}
     }
     if(!rot)break; // no rotating arrow met: the same for every phase
    }
   }
  }
 };
 auto genR=[&](size_t rh,vector<uint8_t>&buf,uint64_t&tr){
  thread_local vector<uint8_t> kb,targetKey,checkKey;thread_local vector<int> starts;kb.resize(K);targetKey.resize(K);checkKey.resize(K);
  State targetState;pk.unpack(rev.key(rh),targetState);pk.pack(targetState,targetKey.data());
  // Predecessors of the target for each ball i: ball i made one move from p in direction d and ended at dest while every other ball stayed put.
  // The predecessor board (other balls, gates, teleports, with the preceding switch undone) does not depend on the start cell, so all valid
  // starts come from one backward ray-cast from dest over the move automaton instead of simulating every (cell, direction) pair.
  for(int i=0;i<b.n;i++){
   const int dest=targetState.p[i];
   State tmpl=targetState;
   // Undo the switch activated by the preceding move. The blocked-closing rule is determined by the *post*-move occupancy, not source occupancy.
   const int swi=b.switchAt[dest];
   if(swi>=0)b.undoSwitch(swi,tmpl,targetState);
   for(int ph=0;ph<b.nPhases;ph++){
    backReach(b,tmpl,i,dest,ph,starts);
    for(int sd:starts){
     const int p=sd>>2;
     // Previously occupied target goal cannot be departed; all other balls stay fixed.
     if(b.fixed[p]||b.goalColor[p]==b.balls[i].color)continue;
     int gi=b.gateAt[p];if(gi>=0&&targetState.gate[gi])continue;
     bool occupied=false;for(int j=0;j<b.n;j++)if(j!=i&&targetState.p[j]==p){occupied=true;break;}if(occupied)continue;
     if(gi>=0&&tmpl.gate[gi])continue;
     tr++;
     State predecessor=tmpl;predecessor.p[i]=p;
     // Replay the switch's effects to reject invalid reverse candidates.
     State check=predecessor;check.p[i]=dest;
     if(swi>=0)b.fireSwitch(swi,check);
     pk.pack(check,checkKey.data());if(memcmp(checkKey.data(),targetKey.data(),K))continue;
     pk.pack(predecessor,kb.data());const uint64_t h=hashBytes(kb.data(),K);
     if(rev.find(kb.data(),h)==Store::NONE){const uint32_t o=fwd.find(kb.data(),h);const size_t at=buf.size();buf.resize(at+R);memcpy(&buf[at],kb.data(),K);memcpy(&buf[at+K],&h,8);memcpy(&buf[at+K+8],&o,4);}
    }
   }
  }
 };
 auto mergeInto=[&](Store&sd,bool forward,vector<uint8_t>&buf){
  for(size_t o=0;o<buf.size();o+=R){
   if(o+16*R<buf.size()){uint64_t hp;memcpy(&hp,&buf[o+16*R+K],8);sd.prefetch(hp);}
   const uint8_t*k=&buf[o];uint64_t h;uint32_t other;memcpy(&h,k+K,8);memcpy(&other,k+K+8,4);
   if(sd.find(k,h)!=Store::NONE)continue; // duplicate within this layer
   if(full()){limited=true;return false;}
   const uint32_t idx=sd.add(k,h);
   if(other!=Store::NONE){if(forward)record(idx,other);else record(other,idx);}
  }
  return true;};
 auto stop=[&]{if(timer.expired()||full())limited=true;return limited;};
 while(!timer.expired()&&!limited){
  const size_t fSize=fEnd-fHead,rSize=rEnd-rHead;
  if(fSize==0||rSize==0){exhausted=true;break;} // one side has enumerated everything it can reach
  if(fSize<=rSize){ // expand the whole forward layer of depth fd
   expandLayer(fHead,fEnd,lim.threads,transitions,genF,[&](vector<uint8_t>&buf){return mergeInto(fwd,true,buf);},stop);
   if(limited)break;
   fHead=fEnd;fd++;fEnd=fwd.size();fwd.closeLayer();
  }else{ // expand the whole reverse layer of depth rd
   expandLayer(rHead,rEnd,lim.threads,transitions,genR,[&](vector<uint8_t>&buf){return mergeInto(rev,false,buf);},stop);
   if(limited)break;
   rHead=rEnd;rd++;rEnd=rev.size();rev.closeLayer();
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
// ---- K4 board code (see K4.md): canonical alphanumeric text; board data only (no id, title or solution) ----
static const string K4_N62="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",K4_LETTERS="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
static const int K4_HEX[8]={-20,-15,-10,-5,5,10,15,20};
static int k4Perimeter(int w,int h,int x,int y,int side){return side==1?x-1:side==3?w+(y-1):side==0?w+h+(w-x):2*w+h+(h-y);} // x,y 1-based; sides 0..3 = u,d,l,r
static void k4FromPerimeter(int w,int h,int i,int&x,int&y,int&side){if(i<w){x=i+1;y=1;side=1;}else if(i<w+h){x=w;y=i-w+1;side=3;}else if(i<2*w+h){x=w-(i-w-h);y=h;side=0;}else{x=1;y=h-(i-2*w-h);side=2;}}
string codeK4(const Board&b){
 const int w=b.w,h=b.h,total=w*h;
 if(w>15||h>15)throw runtime_error("K4: boards are limited to 15 x 15 cells");
 if(b.balls.size()>61)throw runtime_error("K4: at most 61 balls");
 vector<int> sym(total,-1),gapDir(total,-1);vector<char> isWall(total,0);
 for(int p:b.wall){isWall[p]=1;sym[p]=0;}
 for(int g:b.goals)sym[g%MAX_CELLS]=14+g/MAX_CELLS;
 for(auto&a:b.arrows)sym[a.p]=a.rotating?31+a.type*4+a.dir:10+a.dir;
 for(auto&g:b.gates)sym[g.p]=18+(g.active?1:0);
 for(auto&s:b.switches)sym[s.p]=20;
 for(auto&t:b.teleports)sym[t.p]=21+t.color*2+(t.active?0:1);
 for(auto&x:b.hexes){int k=-1;for(int i=0;i<8;i++)if(K4_HEX[i]==x.value)k=i;if(k<0)throw runtime_error("K4: hexagon value not in +-5/10/15/20");sym[x.p]=43+k;}
 if(b.tunnels.size()>31)throw runtime_error("K4: at most 31 tunnel pairs");
 struct E{bool edge;int order,pair;};vector<E> ends;
 for(int t=0;t<(int)b.tunnels.size();t++){const Tunnel&tn=b.tunnels[t];int cells[2]={tn.pa,tn.pb},sides[2]={tn.sa,tn.sb};
  for(int k=0;k<2;k++){int x=cells[k]%w,y=cells[k]/w,nx=x+dx[sides[k]],ny=y+dy[sides[k]];
   if(nx<0||nx>=w||ny<0||ny>=h){ends.push_back({true,k4Perimeter(w,h,x+1,y+1,sides[k]),t});continue;}
   int c=ny*w+nx;if(!isWall[c])throw runtime_error("K4: a tunnel opening must face a wall cell or the board edge");
   if(gapDir[c]>=0)throw runtime_error("K4: a wall cell carries more than one tunnel opening");
   gapDir[c]=sides[k];ends.push_back({false,c,t});}}
 sort(ends.begin(),ends.end(),[](const E&a,const E&z){return a.edge!=z.edge?a.edge<z.edge:a.order<z.order;});
 vector<int> firstOf(b.tunnels.size(),-1),partner(ends.size(),-1);
 for(int i=0;i<(int)ends.size();i++){int&f=firstOf[ends[i].pair];if(f>=0){partner[i]=f;partner[f]=i;}else f=i;}
 string grid;int floorRun=0,wallRun=0;
 auto flushFloor=[&]{if(floorRun)grid+=to_string(floorRun);floorRun=0;};
 auto flushWall=[&]{if(wallRun){grid+=string(wallRun/6,K4_LETTERS[5]);if(wallRun%6)grid+=K4_LETTERS[wallRun%6-1];}wallRun=0;};
 for(int i=0;i<total;i++){
  if(isWall[i]&&gapDir[i]<0){flushFloor();wallRun++;continue;}
  flushWall();
  if(isWall[i]){flushFloor();grid+=K4_LETTERS[6+gapDir[i]];}
  else if(sym[i]<0)floorRun++;else{flushFloor();grid+=K4_LETTERS[sym[i]];}
 }
 flushFloor();flushWall();
 string out="K4.";out+=K4_N62[w];out+=K4_N62[h];out+=K4_N62[b.wallColor<0?0:b.wallColor==0?1:b.wallColor==1?2:throw runtime_error("K4: wall color must be blue, red or green")];out+=grid;
 vector<int> edges;for(auto&e:ends)if(e.edge)edges.push_back(e.order);
 out+=K4_N62[edges.size()];for(int i:edges)out+=K4_N62[i];
 vector<int> un(ends.size());for(int i=0;i<(int)un.size();i++)un[i]=i;
 while(un.size()>2){vector<int> rest(un.begin()+1,un.end());int j=(int)(find(rest.begin(),rest.end(),partner[un[0]])-rest.begin());out+=K4_N62[j];rest.erase(rest.begin()+j);un=rest;}
 if(!b.switches.empty()){
  unordered_map<string,int> gateIdx,teleIdx;for(int i=0;i<(int)b.gates.size();i++)gateIdx[b.gates[i].id]=i;for(int i=0;i<(int)b.teleports.size();i++)teleIdx[b.teleports[i].id]=i;
  map<vector<string>,int> groupOf;vector<int> swGroup;unordered_map<string,int> member;
  for(auto&s:b.switches){if(s.controls.empty())throw runtime_error("K4: a switch controls nothing");vector<string> key=s.controls;sort(key.begin(),key.end());
   if(!groupOf.count(key)){if(groupOf.size()>=61)throw runtime_error("K4: at most 61 switch groups");int g=(int)groupOf.size()+1;groupOf[key]=g;for(auto&id:key){if(member.count(id))throw runtime_error("K4: switch control lists must be identical or disjoint");member[id]=g;}}
   swGroup.push_back(groupOf[key]);}
  vector<int> gateGroup,teleGroup;
  for(auto&g:b.gates){auto it=member.find(g.id);if(it==member.end())throw runtime_error("K4: a gate is not controlled by any switch");gateGroup.push_back(it->second);}
  for(auto&t:b.teleports){auto it=member.find(t.id);if(it==member.end()){if(!t.active)throw runtime_error("K4: an inactive teleport is not controlled by any switch");teleGroup.push_back(0);}else teleGroup.push_back(it->second);}
  int groups=(int)groupOf.size();out+=K4_N62[groups];
  if(groups>1){for(int g:swGroup)out+=K4_N62[g];for(int g:gateGroup)out+=K4_N62[g];}
  for(int g:teleGroup)out+=K4_N62[g];
 }else if(!b.gates.empty())throw runtime_error("K4: gates need at least one switch");
 else for(auto&t:b.teleports)if(!t.active)throw runtime_error("K4: inactive teleports need a switch");
 vector<int> vals;for(auto&x:b.balls)vals.push_back(4*x.p+x.color);sort(vals.begin(),vals.end());
 out+=K4_N62[vals.size()];for(int v:vals){out+=K4_N62[v/62];out+=K4_N62[v%62];}
 return out;
}
Board parseCode(string code){
 code=trim(code);if(code.rfind("K4.",0)!=0)throw runtime_error("expected K4. board code");
 string s=code.substr(3);for(char c:s)if(!isalnum((unsigned char)c))throw runtime_error("invalid K4 board code: only letters and digits may follow K4.");
 size_t pos=0;
 auto next=[&]()->char{if(pos>=s.size())throw runtime_error("invalid K4 board code: truncated");return s[pos++];};
 auto n62=[&]()->int{return (int)K4_N62.find(next());};
 auto num=[&](int mx){int v=n62();if(v>mx)throw runtime_error("invalid K4 board code: value out of range");return v;};
 Board b;b.w=n62();b.h=n62();int wc=num(2);
 if(b.w<1||b.w>15||b.h<1||b.h>15)throw runtime_error("invalid K4 board code: board size must be 1 to 15");
 if(wc==1)b.wallColor=0;else if(wc==2)b.wallColor=1;
 int w=b.w,total=b.w*b.h,cell=0;vector<pair<int,int>> gaps;
 while(cell<total){int rem=total-cell;char c=next();
  if(c>='0'&&c<='9'){if(c=='0')throw runtime_error("invalid K4 board code: floor run starts with 0");int v=c-'0';while(v<rem&&pos<s.size()&&isdigit((unsigned char)s[pos]))v=v*10+(s[pos++]-'0');if(v>rem)throw runtime_error("invalid K4 board code: grid too long");cell+=v;continue;}
  int li=(int)K4_LETTERS.find(c);if(li==51)throw runtime_error("invalid K4 board code: Z is reserved");
  if(li<6){int n=li+1;if(n>rem)throw runtime_error("invalid K4 board code: grid too long");for(int k=0;k<n;k++)b.wall.push_back(cell+k);cell+=n;continue;}
  int p=cell++;
  if(li<10){b.wall.push_back(p);gaps.push_back({p,li-6});}
  else if(li<14)b.arrows.push_back({p,li-10,false,0});
  else if(li<18)b.goals.push_back((li-14)*MAX_CELLS+p);
  else if(li<20)b.gates.push_back({p,"",li==19});
  else if(li==20)b.switches.push_back({p,"",false,{}});
  else if(li<31){int k=li-21;b.teleports.push_back({p,k>>1,"",!(k&1)});}
  else if(li<43){int k=li-31;b.arrows.push_back({p,k&3,true,k>>2});}
  else b.hexes.push_back({p,K4_HEX[li-43],""});
 }
 struct O{int p,side;};vector<O> opens;
 for(auto&g:gaps){int x=g.first%w-dx[g.second],y=g.first/w-dy[g.second];if(x<0||x>=w||y<0||y>=b.h)throw runtime_error("invalid K4 board code: tunnel gap without floor cell");opens.push_back({y*w+x,g.second});}
 int edgeCount=num(61);for(int k=0;k<edgeCount;k++){int i=n62();if(i>=2*(w+b.h))throw runtime_error("invalid K4 board code: edge opening out of range");int x,y,side;k4FromPerimeter(w,b.h,i,x,y,side);opens.push_back({(y-1)*w+x-1,side});}
 if(opens.size()%2)throw runtime_error("invalid K4 board code: odd number of tunnel openings");
 if(!opens.empty()){vector<int> un(opens.size());for(int i=0;i<(int)un.size();i++)un[i]=i;
  auto push=[&](int a,int z){O A=opens[a],Z=opens[z];if(A.p*4+A.side>Z.p*4+Z.side)swap(A,Z);b.tunnels.push_back({A.p,A.side,Z.p,Z.side});};
  while(un.size()>2){vector<int> rest(un.begin()+1,un.end());int j=n62();if(j>=(int)rest.size())throw runtime_error("invalid K4 board code: tunnel pairing out of range");push(un[0],rest[j]);rest.erase(rest.begin()+j);un=rest;}
  push(un[0],un[1]);
  sort(b.tunnels.begin(),b.tunnels.end(),[](const Tunnel&a,const Tunnel&z){return a.pa*4+a.sa<z.pa*4+z.sa;});}
 for(int i=0;i<(int)b.gates.size();i++)b.gates[i].id="G"+to_string(i+1);
 for(int i=0;i<(int)b.teleports.size();i++)b.teleports[i].id="T"+to_string(i+1);
 for(int i=0;i<(int)b.switches.size();i++)b.switches[i].id="S"+to_string(i+1);
 if(!b.switches.empty()){
  int groups=num(61);if(!groups)throw runtime_error("invalid K4 board code: no switch groups");
  vector<int> swGroup,gateGroup,teleGroup;
  if(groups==1){swGroup.assign(b.switches.size(),1);gateGroup.assign(b.gates.size(),1);}
  else{for(size_t i=0;i<b.switches.size();i++){int g=n62();if(g<1||g>groups)throw runtime_error("invalid K4 board code: group out of range");swGroup.push_back(g);}
   for(size_t i=0;i<b.gates.size();i++){int g=n62();if(g<1||g>groups)throw runtime_error("invalid K4 board code: group out of range");gateGroup.push_back(g);}}
  for(size_t i=0;i<b.teleports.size();i++)teleGroup.push_back(num(groups));
  for(size_t i=0;i<b.switches.size();i++){auto&sw=b.switches[i];
   for(size_t k=0;k<b.gates.size();k++)if(gateGroup[k]==swGroup[i])sw.controls.push_back(b.gates[k].id);
   for(size_t k=0;k<b.teleports.size();k++)if(teleGroup[k]==swGroup[i])sw.controls.push_back(b.teleports[k].id);
   if(sw.controls.empty())throw runtime_error("invalid K4 board code: a switch group controls nothing");}
 }
 int ballCount=num(61);if(!ballCount)throw runtime_error("invalid K4 board code: no balls");
 for(int k=0;k<ballCount;k++){int v=n62()*62;v+=n62();if(v>=4*total)throw runtime_error("invalid K4 board code: ball out of range");b.balls.push_back({v>>2,v&3,0,""});}
 if(pos!=s.size())throw runtime_error("invalid K4 board code: trailing characters");
 // Core.validateBoard sorts balls by color, then (y,x).
 stable_sort(b.balls.begin(),b.balls.end(),[](const Ball&a,const Ball&z){return a.color!=z.color?a.color<z.color:a.p<z.p;});
 for(int i=0;i<(int)b.balls.size();i++){int count=0,k=0;for(int j=0;j<(int)b.balls.size();j++)if(b.balls[j].color==b.balls[i].color){count++;if(j<=i)k++;}b.balls[i].ordinal=k;b.balls[i].name=string(1,COLORS[b.balls[i].color])+(count==1?"":to_string(k));}
 b.initialize();
 string again;try{again=codeK4(b);}catch(const exception&e){throw runtime_error(string("invalid K4 board code: ")+e.what());}
 if(again!=code)throw runtime_error("invalid K4 board code: not in canonical form");
 return b;
}
string readInput(const string& argument){ifstream f(argument,ios::binary);if(f.good()){string s((istreambuf_iterator<char>(f)),{});return trim(s);}return argument;}
string catalogCode(const string& id,const string& filename){ifstream file(filename);if(!file)throw runtime_error("cannot open catalog: "+filename);string line;while(getline(file,line)){line=trim(line);string prefix=id+" = ";if(line.rfind(prefix,0)==0){string rest=trim(line.substr(prefix.size()));return rest.substr(0,rest.find_first_of(" \t"));}}throw runtime_error("level not found: "+id);}
static const char* SOLVER_VERSION="0.21"; // Solver's own version, independent of the web app's APP_VERSION.
// ---- Core entry point (shared by the CLI and the WebAssembly build) ----
struct Cli{Limits lim;string input,level,catalog="levels.js";bool version=false,help=false,json=false;};
static const char* HELP_TEXT="Kunundrum exact C++ solver (K4)\nUsage: kunsolve BOARD_CODE_OR_FILE [--algorithm auto|forward|bidirectional|beam] [--beam-width N] [--beam-heuristic static|dynamic] [--seed N] [--threads N] [--max-states N] [--seconds N] [--max-memory MB] [--max-depth N] [--max-score N] [--quiet] [--version]\n       kunsolve --level ID [--catalog levels.js] [options]\nOutput: lowest-score route (fewest moves among equal scores), its score and move count, and its K4 board code.\nauto = bidirectional search when applicable (no hexes, equal goals/balls, at least 3 balls), else forward.\nbeam = heuristic: certifies optimality (exit 0) only on hex-free boards when no state was ever dropped by the beam width, otherwise an upper bound (exit 2).\n0 = unlimited for --max-states, --seconds and --max-memory (memory is then the real limit).\nExit codes: 0 optimal, 2 inconclusive, 3 exhausted/unsolvable, 4 no solution within --max-depth or --max-score (proved bound), 1 error.\n";
// Same flags as the command line; the WebAssembly export passes its options as a flag string.
static Cli parseArgs(const vector<string>&args){
 Cli c;Limits&lim=c.lim;string&input=c.input,&level=c.level,&catalog=c.catalog;
 for(size_t i=0;i<args.size();i++){const string&a=args[i];auto value=[&](){if(++i>=args.size())throw runtime_error("missing argument for "+a);return args[i];};
  if(a=="--version"){c.version=true;return c;}
  if(a=="--help"||a=="-h"){c.help=true;return c;}
  if(a=="--json"){c.json=true;continue;}
   else if(a=="--level")level=value();else if(a=="--catalog")catalog=value();else if(a=="--algorithm")lim.algorithm=value();else if(a=="--max-states"){lim.maxStates=stoull(value());if(lim.maxStates==0)lim.maxStates=UINT64_MAX;}else if(a=="--threads"){lim.threads=stoi(value());if(lim.threads<0)throw runtime_error("--threads must be >= 0");}else if(a=="--max-memory"){lim.maxBytes=stoull(value())<<20;}else if(a=="--seconds")lim.seconds=stod(value());else if(a=="--max-score"){lim.maxScore=stoll(value());lim.scoreCap=true;if(lim.maxScore<-1000000000000LL||lim.maxScore>1000000000000LL)throw runtime_error("--max-score out of range");}else if(a=="--max-depth"){lim.maxDepth=stoi(value());if(lim.maxDepth<1)throw runtime_error("--max-depth must be at least 1");}else if(a=="--beam-width"){lim.beamWidth=stoull(value());if(lim.beamWidth<1)throw runtime_error("--beam-width must be at least 1");}else if(a=="--beam-heuristic"){string v=value();if(v!="static"&&v!="dynamic")throw runtime_error("--beam-heuristic must be static or dynamic");lim.beamDynamic=v=="dynamic";}else if(a=="--seed")lim.seed=stoull(value());else if(a=="--quiet")lim.verbose=false;else if(a.rfind("--",0)==0)throw runtime_error("unknown option: "+a);else if(input.empty())input=a;else throw runtime_error("unexpected argument: "+a);
 }
 return c;
}
struct Outcome{int exit=1;string status,algorithm,solution,error,text;bool hasSolution=false,hasLowerScore=false;long long score=0,lowerScore=0;int moves=0,lowerMoves=0;uint64_t states=0,transitions=0,memMB=0;double elapsed=0;};
static string jstr(const string&s){string r="\"";for(unsigned char ch:s){if(ch=='"'||ch=='\\'){r+='\\';r+=(char)ch;}else if(ch<0x20){char b[8];snprintf(b,sizeof b,"\\u%04x",ch);r+=b;}else r+=(char)ch;}return r+"\"";}
static string toJson(const Outcome&o){ostringstream j;j<<"{\"exit\":"<<o.exit<<",\"status\":"<<jstr(o.status)<<",\"hasSolution\":"<<(o.hasSolution?"true":"false")<<",\"score\":"<<o.score<<",\"moves\":"<<o.moves<<",\"solution\":"<<jstr(o.solution)<<",\"lowerMoves\":"<<o.lowerMoves<<",\"hasLowerScore\":"<<(o.hasLowerScore?"true":"false")<<",\"lowerScore\":"<<o.lowerScore<<",\"algorithm\":"<<jstr(o.algorithm)<<",\"states\":"<<o.states<<",\"transitions\":"<<o.transitions<<",\"memoryMB\":"<<o.memMB<<",\"elapsed\":"<<o.elapsed<<",\"error\":"<<jstr(o.error)<<"}";return j.str();}
// Solves one board code. Writes progress lines to LOG; never throws (errors go to Outcome::error, exit 1).
static Outcome solveBoard(const string&input,Limits lim){
 Outcome o;ostringstream os;
 try{
  o.exit=[&]()->int{
  if(lim.maxStates<2||lim.seconds<0)throw runtime_error("invalid resource limits");
  {int t=lim.threads;
#ifdef KUN_THREADS
   if(t<=0){t=(int)max(1u,thread::hardware_concurrency());}
   t=min(t,64);
#else
   t=1;
#endif
   lim.threads=t;}
  Board b=parseCode(input);LOG<<"board ("<<b.w<<"x"<<b.h<<") "<<b.n<<" balls, "<<b.hexes.size()<<" hexes, "<<b.switches.size()<<" switches\n";
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
   o.status=optimal?"OPTIMAL":"SOLUTION FOUND (optimality not certified)";o.hasSolution=true;o.score=score;o.moves=(int)route.size();o.solution=formatMoves(b,route);
   os<<o.status<<"\nScore: "<<score<<"\nMoves: "<<o.moves<<"\nSolution: "<<o.solution<<"\n";
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
  Outcome o=solveBoard(input,c.lim);
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
 try{vector<string> args;istringstream is(flags?flags:"");string w;while(is>>w)args.push_back(w);Cli c=parseArgs(args);o=solveBoard(code?code:"",c.lim);}
 catch(const exception&e){o.error=e.what();o.exit=1;}
 g_log=&cerr;out=toJson(o);return out.c_str();
}
#endif
