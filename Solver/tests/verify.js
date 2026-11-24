'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const {spawnSync}=require('child_process');const path=require('path');
const root=path.join(__dirname,'..'),repo=path.join(root,'..');
const ctx={TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,atob,btoa,window:{}};vm.createContext(ctx);
for(let f of ['engine.js','codec.js','levels.js'])vm.runInContext(fs.readFileSync(path.join(repo,f),'utf8'),ctx,{filename:f});
const {Core,Codec}=vm.runInContext('({Core,Codec})',ctx);
function solutionCheck(code,sol){const board=Codec.decodeBoard(code);let st=Core.createInitialState(board);const tokens=Core.parseSolution(sol);for(let i=0;i<tokens.length;i++){const t=tokens[i];let id=Core.resolveBallId(st,t.identifier);let m=Core.applyMove(st,board,id,t.direction,t.choices);assert.equal(m.kind,'ok',`move ${i+1} ${id}${t.direction} ${m.kind}: ${m.message}`);st=m.state;}assert(Core.isComplete(st),`not complete, score=${st.score}`);return {board,score:st.score,count:tokens.length};}
const catalogCode=id=>fs.readFileSync(path.join(repo,'levels.js'),'utf8').match(new RegExp('^'+id.replace('.','\\.')+' = (K4\\.\\S+)','m'))[1];
let n=0;// 1.7, 1.8 and 2.2 contain hexagons: the objective is the lowest SCORE, not the fewest moves (saved routes: 13 moves/score 3, 10/5, 14/9).
const expectedScore={'1.7':3,'1.8':5,'2.2':9};
for(let id of ['6.6','7.4','7.1','7.6','7.10','8.1','1.7','1.8','2.2']){
 let p=spawnSync(path.join(root,'kunsolve'),['--level',id,'--catalog',path.join(repo,'levels.js'),'--quiet','--seconds','20','--max-states','1500000'],{cwd:root,encoding:'utf8',timeout:35000});assert.equal(p.status,0,`solver ${id}: ${p.stderr}\n${p.stdout}`);let code=catalogCode(id),sol=p.stdout.match(/^Solution: (\S+)/m)?.[1];assert(code&&sol);const out=solutionCheck(code,sol);if(expectedScore[id]!==undefined)assert.equal(out.score,expectedScore[id],'level '+id+' must be solved for the lowest score');console.log(id,sol,'score',out.score,'K4',code.length,'chars');n++;}
// Generate independent test fixtures for dynamic mechanics, then solve and verify.
function fixture(name,board,algo='forward'){let original=Codec.encodeBoard(board);let p=spawnSync(path.join(root,'kunsolve'),[original,'--algorithm',algo,'--quiet','--seconds','4','--max-states','30000'],{encoding:'utf8',timeout:7000});if(p.status!==0){console.error(name,p.stdout,p.stderr);throw Error('failed '+name)}let code=original,sol=p.stdout.match(/^Solution: (\S+)/m)?.[1];assert(code&&sol);let x=solutionCheck(code,sol);console.log(name,sol,'score',x.score);n++;}
fixture('basic',{version:1,width:4,height:1,id:'basic',title:'basic',balls:[{x:1,y:1,color:'R'}],goals:[{x:4,y:1,color:'R'}]});
fixture('rotating',{version:1,width:4,height:3,id:'rotate',title:'rotate',balls:[{x:1,y:1,color:'R'}],goals:[{x:2,y:3,color:'R'}],arrows:[{x:2,y:1,direction:'u',rotating:true}],walls:[{x:4,y:1},{x:4,y:2},{x:4,y:3}]});
fixture('hex',{version:1,width:4,height:2,id:'hex',title:'hex',balls:[{x:1,y:1,color:'R'}],goals:[{x:4,y:1,color:'R'}],hexes:[{x:2,y:1,value:-5,id:'H1'}]});
fixture('switch',{version:1,width:5,height:2,id:'switch',title:'switch',balls:[{x:1,y:1,color:'R'}],goals:[{x:5,y:1,color:'R'}],gates:[{x:3,y:1,id:'G1',active:true}],switches:[{x:2,y:1,id:'S1',controls:['G1']}]});
for(const [cap,status] of [[4,4],[5,0]]){const q=spawnSync(path.join(root,'kunsolve'),['--level','1.8','--catalog',path.join(repo,'levels.js'),'--max-score',String(cap),'--quiet'],{cwd:root,encoding:'utf8',timeout:35000});assert.equal(q.status,status,'1.8 --max-score '+cap);if(status===0)assert(/Score: 5\b/.test(q.stdout));}
console.log('PASS --max-score bound on 1.8 (4 -> proved none, 5 -> optimal)');
console.log('PASS '+n+' end-to-end fixture(s)');
// Cosmetic wall color (K4 header character): round trip, blue is canonical (omitted), solver keeps it in its output code.
{const base={version:1,width:5,height:2,id:'wc',title:'wc',balls:[{x:1,y:1,color:'R'}],goals:[{x:5,y:1,color:'R'}],gates:[{x:3,y:1,id:'G1',active:true}],switches:[{x:2,y:1,id:'S1',controls:['G1']}]};
 const blue=Codec.encodeBoard(base);assert.equal(Codec.encodeBoard({...base,wallColor:'B'}),blue,'explicit blue must encode like no color');assert.equal(Codec.decodeBoard(blue).wallColor,undefined);
 for(const c of ['R','G']){const code=Codec.encodeBoard({...base,wallColor:c});assert.notEqual(code,blue);assert.equal(Codec.decodeBoard(code).wallColor,c);
  const p=spawnSync(path.join(root,'kunsolve'),[code,'--quiet','--seconds','4','--max-states','30000'],{encoding:'utf8',timeout:7000});assert.equal(p.status,0,p.stderr+p.stdout);
  assert.equal(Codec.decodeBoard(code).wallColor,c);solutionCheck(code,p.stdout.match(/^Solution: (\S+)/m)[1]);}
 const q=spawnSync(path.join(root,'kunsolve'),[blue,'--quiet','--seconds','4','--max-states','30000'],{encoding:'utf8',timeout:7000});assert.equal(q.status,0,q.stderr+q.stdout);
 console.log('PASS wall color (K4 round trip, canonical blue, solver keeps R/G)');}
// Teleports are single endpoints with derived partners: hub (lone universal + one endpoint per color), off exit stops the ball on the entrance.
{const hub=(spokeOn)=>({version:1,width:5,height:3,id:'hub',title:'hub',balls:[{x:1,y:1,color:'B'}],goals:[{x:5,y:1,color:'B'}],
  teleports:[{id:'T1',x:3,y:1,color:'*',active:true},{id:'T2',x:3,y:3,color:'B',active:spokeOn}],switches:[{x:1,y:3,id:'S1',controls:['T2']}]});
 const first=(board,dir)=>{const st=Core.createInitialState(board);const m=Core.applyMove(st,board,Core.resolveBallId(st,'B'),dir,[]);assert.equal(m.kind,'ok',m.message);return m.state.balls[0];};
 const on=Codec.decodeBoard(Codec.encodeBoard(hub(true))),off=Codec.decodeBoard(Codec.encodeBoard(hub(false)));
 assert.deepEqual([first(on,'r').x,first(on,'r').y],[5,3],'ball entering the hub exits at the spoke of its color and continues');
 assert.deepEqual([first(off,'r').x,first(off,'r').y],[3,1],'off exit: the ball stops on the universal entrance');
 for(const bad of [{teleports:[{id:'T1',x:3,y:3,color:'B',active:true}]},{teleports:[{id:'T1',x:1,y:2,color:'B',active:true},{id:'T2',x:2,y:2,color:'B',active:true},{id:'T3',x:3,y:2,color:'B',active:true}]},
   {teleports:[{id:'T1',x:1,y:2,color:'*',active:true},{id:'T2',x:2,y:2,color:'*',active:true},{id:'T3',x:3,y:2,color:'B',active:true}]}])
  assert.throws(()=>Codec.encodeBoard({...hub(true),...bad,switches:[]}),/teleport/i,'invalid teleport pairing must be rejected');
 const code=Codec.encodeBoard(hub(false));const p=spawnSync(path.join(root,'kunsolve'),[code,'--quiet','--seconds','4','--max-states','30000'],{encoding:'utf8',timeout:7000});assert.equal(p.status,0,p.stderr+p.stdout);
 const r=solutionCheck(code,p.stdout.match(/^Solution: (\S+)/m)[1]);assert.equal(r.count,2,'switch on the spoke first, then through the hub');
 console.log('PASS teleport endpoints (hub exit, off exit stops, pairing validation, solver route)');}
// Bidirectional search: certified optimum on a chapter-10 level, and the proven lower bound printed when the budget runs out.
{const cat=path.join(repo,'levels.js'),run=(id,extra)=>spawnSync(path.join(root,'kunsolve'),['--level',id,'--catalog',cat,'--algorithm','bidirectional','--quiet','--seconds','60',...extra],{cwd:root,encoding:'utf8',timeout:90000});
 const a=run('10.8',['--max-states','0']);assert.equal(a.status,0,a.stdout);assert(/^OPTIMAL/m.test(a.stdout)&&/^Moves: 28$/m.test(a.stdout),'bidirectional 10.8 must prove 28 moves optimal');
 const b=run('10.9',['--max-states','200000']);assert.equal(b.status,2,b.stdout);const lb=+(b.stdout.match(/^Lower bound: at least (\d+) moves/m)?.[1]??0);assert(lb>=10&&lb<=28,'bidirectional 10.9 lower bound '+lb);
 console.log('PASS bidirectional search (10.8 optimal 28; 10.9 lower bound',lb,'with 200,000 states)');}
// Beam search: every route must replay in the JS engine; it claims optimality only on hex-free boards where the width never dropped a state.
// On these tiny boards a 20,000-state beam never prunes, so it also finds the known optimal score.
for(const [id,score] of [['1.7',3],['1.8',5],['2.2',9],['7.3',null],['8.1',null]]){
 const p=spawnSync(path.join(root,'kunsolve'),['--level',id,'--catalog',path.join(repo,'levels.js'),'--algorithm','beam','--beam-width','20000','--quiet','--seconds','30'],{cwd:root,encoding:'utf8',timeout:50000});
 const hexFree=false; // at width 20,000 none of these certifies (hexes, or 8.1's beam drops states); see the certification checks below
 assert.equal(p.status,hexFree?0:2,`beam ${id}: ${p.stderr}\n${p.stdout}`);assert(hexFree?/^OPTIMAL/m.test(p.stdout):/SOLUTION FOUND \(optimality not certified\)/.test(p.stdout),`beam ${id} optimality claim`);
 const code=catalogCode(id),sol=p.stdout.match(/^Solution: (\S+)/m)?.[1];assert(code&&sol);const out=solutionCheck(code,sol);
 if(score!==null)assert.equal(out.score,score,`beam ${id} score`);console.log('beam',id,'score',out.score,'moves',out.count);
}
{const p=spawnSync(path.join(root,'kunsolve'),['--level','2.2','--catalog',path.join(repo,'levels.js'),'--algorithm','beam','--beam-heuristic','dynamic','--beam-width','20000','--quiet','--seconds','30'],{cwd:root,encoding:'utf8',timeout:50000});
 assert.equal(p.status,2,p.stderr+p.stdout);assert(/dynamic heuristic/.test(p.stdout)&&/optimality not certified/.test(p.stdout));
 const out=solutionCheck(catalogCode('2.2'),p.stdout.match(/^Solution: (\S+)/m)[1]);assert.equal(out.score,9,'beam dynamic 2.2 score');console.log('beam dynamic 2.2 score',out.score);}
fixture('beam basic',{version:1,width:4,height:1,id:'basic',title:'basic',balls:[{x:1,y:1,color:'R'}],goals:[{x:4,y:1,color:'R'}]},'beam');
fixture('beam rotating',{version:1,width:4,height:3,id:'rotate',title:'rotate',balls:[{x:1,y:1,color:'R'}],goals:[{x:2,y:3,color:'R'}],arrows:[{x:2,y:1,direction:'u',rotating:true}],walls:[{x:4,y:1},{x:4,y:2},{x:4,y:3}]},'beam');
fixture('beam switch',{version:1,width:5,height:2,id:'switch',title:'switch',balls:[{x:1,y:1,color:'R'}],goals:[{x:5,y:1,color:'R'}],gates:[{x:3,y:1,id:'G1',active:true}],switches:[{x:2,y:1,id:'S1',controls:['G1']}]},'beam');
{const p=spawnSync(path.join(root,'kunsolve'),['--level','6.6','--catalog',path.join(repo,'levels.js'),'--algorithm','beam','--beam-width','2000000','--quiet','--seconds','60'],{cwd:root,encoding:'utf8',timeout:90000});
 assert.equal(p.status,0,p.stdout);assert(/^OPTIMAL/m.test(p.stdout)&&/^Moves: 18$/m.test(p.stdout),'beam 6.6 certifies 18 when no state is dropped');
 const q=spawnSync(path.join(root,'kunsolve'),['--level','8.1','--catalog',path.join(repo,'levels.js'),'--algorithm','beam','--beam-width','20000','--quiet','--seconds','30'],{cwd:root,encoding:'utf8',timeout:50000});
 assert.equal(q.status,2,q.stdout);assert(/^Lower bound: at least \d+ moves/m.test(q.stdout),'a beam that dropped states still proves the complete layers');console.log('PASS beam certification (6.6 certified; 8.1 at width 20,000 only a bound)');}
console.log('PASS beam search (replay-verified routes; certified only when hex-free and nothing dropped)');
// Tunnels (engine only; the solver does not support them yet): crossing, heading change, blocked exit, loop rejection, K4 round trip.
{const tb=Core.validateBoard({version:1,id:'tun',title:'tun',width:5,height:2,balls:[{color:'R',x:3,y:1}],goals:[{color:'R',x:1,y:2}],tunnels:[{a:{x:5,y:2,side:'r'},b:{x:1,y:1,side:'l'}}]});
 const m=Core.applyMove(Core.createInitialState(tb),tb,'R','l');assert.equal(m.kind,'ok');assert.deepEqual([m.state.balls[0].x,m.state.balls[0].y,m.state.balls[0].locked],[1,2,true]);assert(m.path.some(p=>p.tunnel&&p.x===5&&p.y===2&&p.via==='l'&&p.out==='r'));
 assert.deepEqual(Codec.decodeBoard(Codec.encodeBoard(tb)).tunnels,tb.tunnels);
 const bb=Core.validateBoard({...JSON.parse(JSON.stringify(tb)),balls:[{color:'R',x:3,y:1},{color:'G',x:5,y:2}],goals:[{color:'R',x:1,y:2},{color:'G',x:4,y:1}]});
 assert.deepEqual(Core.applyMove(Core.createInitialState(bb),bb,'R','l').path.map(p=>p.x),[3,2,1]);
 const lb=Core.validateBoard({version:1,id:'l',title:'l',width:3,height:1,balls:[{color:'R',x:2,y:1}],goals:[{color:'R',x:3,y:1}],tunnels:[{a:{x:1,y:1,side:'l'},b:{x:3,y:1,side:'r'}}]});
 assert.equal(Core.applyMove(Core.createInitialState(lb),lb,'R','l').kind,'loop');
 console.log('PASS tunnels (engine, K4)');}
// Level 21.1 (real level: 4 tunnel arms): parsed from the screenshot, saved route replays to a win in 12 moves; pairing guess top-bottom, left-right.
{const line=fs.readFileSync(path.join(repo,'levels.js'),'utf8').match(/^21\.1 = (K4\.\S+) (\S+)$/m);assert(line,'21.1 in levels.js');const [,code211,sol211]=line;
 const b=Codec.decodeBoard(code211);assert.deepEqual(b.tunnels.map(t=>[t.a,t.b].map(e=>e.side).sort().join('')),['du','lr']);assert.equal(solutionCheck(code211,sol211).count,12);
 console.log('PASS level 21.1 (tunnels, catalog code)');}
require('./mechanics.js');
