'use strict';
// Tunnels and rotating arrows: the solver is checked against a brute-force BFS written on top of the JS engine (Core.applyMoveAtPhase over every
// clock phase), the single source of truth for the rules. Small hand-made boards only; every algorithm must agree with the oracle.
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const {spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),repo=path.join(root,'..');
const ctx={TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,atob,btoa,window:{}};vm.createContext(ctx);
for(const f of ['engine.js','codec.js'])vm.runInContext(fs.readFileSync(path.join(repo,f),'utf8'),ctx,{filename:f});
const {Core,Codec}=vm.runInContext('({Core,Codec})',ctx);
function oracle(board){ // fewest moves by BFS over (ball positions, locks, gate/teleport/switch state); hex-free boards only
 const key=s=>JSON.stringify([s.balls.map(b=>[b.x,b.y,b.locked]),s.gateActive,s.teleportActive]);
 let frontier=[Core.createInitialState(board)],seen=new Set([key(frontier[0])]);if(Core.isComplete(frontier[0]))return 0;
 for(let depth=1;depth<=30&&frontier.length;depth++){const next=[];
  for(const st of frontier)for(const ball of st.balls){if(ball.locked)continue;for(const d of 'udlr')for(let ph=0;ph<4;ph++){
   const r=Core.applyMoveAtPhase(st,board,ball.id,d,ph);if(r.kind!=='ok')continue;if(Core.isComplete(r.state))return depth;
   const k=key(r.state);if(!seen.has(k)){seen.add(k);next.push(r.state);}}}
  frontier=next;}
 return null;}
function solverRun(code,algo,extra=[]){const p=spawnSync(path.join(root,'kunsolve'),[code,'--algorithm',algo,'--quiet','--seconds','20',...extra],{encoding:'utf8',timeout:40000});return {status:p.status,out:p.stdout,err:p.stderr};}
function replay(code,sol){const board=Codec.decodeBoard(code);let st=Core.createInitialState(board);for(const t of Core.parseSolution(sol)){const m=Core.applyMove(st,board,Core.resolveBallId(st,t.identifier),t.direction,t.choices);assert.equal(m.kind,'ok','solver route must replay in the engine: '+sol+' '+(m.message||''));st=m.state;}assert(Core.isComplete(st),'route must finish the board');}
const R=(x,y)=>({x,y,color:'R'});
const base=(id,w,h,extra)=>({version:1,width:w,height:h,id,title:id,...extra});
const boards=[
 // a tunnel through the left board edge to the right edge
 base('t-edge',5,1,{balls:[R(2,1)],goals:[R(5,1)],tunnels:[{a:{x:1,y:1,side:'l'},b:{x:5,y:1,side:'u'}}]}),
 // tunnel between a floor cell and a wall cell, heading changes (leaves downward), exit cell holds a fixed arrow
 base('t-turn',4,4,{balls:[R(1,4)],goals:[R(4,1)],walls:[{x:2,y:4},{x:3,y:3}],arrows:[{x:4,y:3,direction:'d'}],tunnels:[{a:{x:1,y:4,side:'r'},b:{x:4,y:4,side:'u'}}]}),
 // blocked tunnel exit (a second ball sits on it) stops the ball at the entrance; the other ball must move away first
 base('t-block',5,2,{balls:[R(1,1),{x:5,y:1,color:'B'}],goals:[R(3,2),{x:5,y:2,color:'B'}],walls:[{x:3,y:1}],tunnels:[{a:{x:2,y:1,side:'r'},b:{x:5,y:1,side:'r'}}]}),
 // a cw rotating arrow
 base('r-cw',4,3,{balls:[R(1,1)],goals:[R(2,3)],arrows:[{x:2,y:1,direction:'r',rotating:true}],walls:[{x:4,y:1},{x:4,y:2},{x:4,y:3}]}),
 // a flip arrow first, a ccw arrow later (second annotation letter)
 base('r-flip-ccw',5,3,{balls:[R(1,1)],goals:[R(5,3)],arrows:[{x:2,y:1,direction:'u',rotating:true,type:'flip'},{x:2,y:3,direction:'r',rotating:true,type:'ccw'}],walls:[{x:1,y:2},{x:3,y:1}]}),
 // rotating arrows plus a tunnel and two balls
 base('mix',5,3,{balls:[R(1,1),{x:1,y:3,color:'G'}],goals:[R(5,3),{x:5,y:1,color:'G'}],arrows:[{x:3,y:2,direction:'u',rotating:true,type:'flip'}],tunnels:[{a:{x:1,y:2,side:'l'},b:{x:5,y:2,side:'r'}}]}),
];
let checked=0;
for(const raw of boards){const board=Core.validateBoard(raw);
 const want=oracle(board),code=Codec.encodeBoard(board);
 for(const algo of ['forward','bidirectional','beam']){
  const r=solverRun(code,algo);
  if(want===null){assert.notEqual(r.status,0,board.id+' '+algo+' must not claim a route');continue;}
  assert.equal(r.status,0,`${board.id} ${algo} must be certified: ${r.out}${r.err}`);
  assert.equal(+r.out.match(/^Moves: (\d+)/m)[1],want,`${board.id} ${algo} optimum vs engine oracle`);
  replay(r.out.match(/^K3: (\S+)/m)[1],r.out.match(/^Solution: (\S+)/m)[1]);
  const out=Codec.decodeBoard(r.out.match(/^K3: (\S+)/m)[1]);assert.deepEqual(out.tunnels,Codec.decodeBoard(code).tunnels,'solver output code keeps the tunnels');
  assert.deepEqual(out.arrows,Codec.decodeBoard(code).arrows,'solver output code keeps the arrow types');
  checked++;}
 console.log(board.id,'optimum',want);
}
console.log('PASS tunnels / rotating arrows: '+checked+' solver runs agree with the engine oracle');
