'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const {spawnSync}=require('child_process');const path=require('path');
const root=path.join(__dirname,'..'),repo=path.join(root,'..');
const ctx={TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,atob,btoa,window:{}};vm.createContext(ctx);
for(let f of ['engine.js','codec.js','levels.js'])vm.runInContext(fs.readFileSync(path.join(repo,f),'utf8'),ctx,{filename:f});
const {Core,Codec}=vm.runInContext('({Core,Codec})',ctx);
function solutionCheck(code,sol){const board=Codec.decodeBoard(code);let st=Core.createInitialState(board);const tokens=Core.parseSolution(sol);for(let i=0;i<tokens.length;i++){const t=tokens[i];let id=Core.resolveBallId(st,t.identifier);let m=Core.applyMove(st,board,id,t.direction,t.choices);assert.equal(m.kind,'ok',`move ${i+1} ${id}${t.direction} ${m.kind}: ${m.message}`);st=m.state;}assert(Core.isComplete(st),`not complete, score=${st.score}`);return {board,score:st.score,count:tokens.length};}
let n=0;// 1.7, 1.8 and 2.2 contain hexagons: the objective is the lowest SCORE, not the fewest moves (saved routes: 13 moves/score 3, 10/5, 14/9).
const expectedScore={'1.7':3,'1.8':5,'2.2':9};
for(let id of ['6.6','7.4','7.1','7.6','7.10','8.1','1.7','1.8','2.2']){
 let p=spawnSync(path.join(root,'kunsolve'),['--level',id,'--catalog',path.join(repo,'levels.js'),'--quiet','--seconds','20','--max-states','1500000'],{cwd:root,encoding:'utf8',timeout:35000});assert.equal(p.status,0,`solver ${id}: ${p.stderr}\n${p.stdout}`);let code=p.stdout.match(/^K3: (\S+)/m)?.[1],sol=p.stdout.match(/^Solution: (\S+)/m)?.[1];assert(code&&sol);const out=solutionCheck(code,sol);assert.equal(Codec.decodeBoard(code).solution,sol);if(expectedScore[id]!==undefined)assert.equal(out.score,expectedScore[id],'level '+id+' must be solved for the lowest score');console.log(id,sol,'score',out.score,'K3',code.length,'chars');n++;}
// Generate independent test fixtures for dynamic mechanics, then solve and verify.
function fixture(name,board,algo='forward'){let original=Codec.encodeBoard(board);let p=spawnSync(path.join(root,'kunsolve'),[original,'--algorithm',algo,'--quiet','--seconds','4','--max-states','30000'],{encoding:'utf8',timeout:7000});if(p.status!==(algo==='beam'?2:0)){console.error(name,p.stdout,p.stderr);throw Error('failed '+name)}let code=p.stdout.match(/^K3: (\S+)/m)?.[1],sol=p.stdout.match(/^Solution: (\S+)/m)?.[1];assert(code&&sol);let x=solutionCheck(code,sol);console.log(name,sol,'score',x.score);n++;}
fixture('basic',{version:1,width:4,height:1,id:'basic',title:'basic',balls:[{x:1,y:1,color:'R'}],goals:[{x:4,y:1,color:'R'}]});
fixture('rotating',{version:1,width:4,height:3,id:'rotate',title:'rotate',balls:[{x:1,y:1,color:'R'}],goals:[{x:2,y:3,color:'R'}],arrows:[{x:2,y:1,direction:'u',rotating:true}],walls:[{x:4,y:1},{x:4,y:2},{x:4,y:3}]});
fixture('hex',{version:1,width:4,height:2,id:'hex',title:'hex',balls:[{x:1,y:1,color:'R'}],goals:[{x:4,y:1,color:'R'}],hexes:[{x:2,y:1,value:-1,id:'H1'}]});
fixture('switch',{version:1,width:5,height:2,id:'switch',title:'switch',balls:[{x:1,y:1,color:'R'}],goals:[{x:5,y:1,color:'R'}],gates:[{x:3,y:1,id:'G1',active:true}],switches:[{x:2,y:1,id:'S1',controls:['G1']}]});
for(const [cap,status] of [[4,4],[5,0]]){const q=spawnSync(path.join(root,'kunsolve'),['--level','1.8','--catalog',path.join(repo,'levels.js'),'--max-score',String(cap),'--quiet','--no-code'],{cwd:root,encoding:'utf8',timeout:35000});assert.equal(q.status,status,'1.8 --max-score '+cap);if(status===0)assert(/Score: 5\b/.test(q.stdout));}
console.log('PASS --max-score bound on 1.8 (4 -> proved none, 5 -> optimal)');
console.log('PASS '+n+' end-to-end fixture(s)');
// Balanced bidirectional search: certified optimum on a chapter-10 level, and the proven lower bound printed when the budget runs out.
{const cat=path.join(repo,'levels.js'),run=(id,extra)=>spawnSync(path.join(root,'kunsolve'),['--level',id,'--catalog',cat,'--algorithm','balanced','--quiet','--no-code','--seconds','60',...extra],{cwd:root,encoding:'utf8',timeout:90000});
 const a=run('10.8',['--max-states','0']);assert.equal(a.status,0,a.stdout);assert(/^OPTIMAL/m.test(a.stdout)&&/^Moves: 28$/m.test(a.stdout),'balanced 10.8 must prove 28 moves optimal');
 const b=run('10.9',['--max-states','200000']);assert.equal(b.status,2,b.stdout);const lb=+(b.stdout.match(/^Lower bound: at least (\d+) moves/m)?.[1]??0);assert(lb>=10&&lb<=28,'balanced 10.9 lower bound '+lb);
 console.log('PASS balanced search (10.8 optimal 28; 10.9 lower bound',lb,'with 200,000 states)');}
// Beam search (heuristic upper bound): every route must replay in the JS engine; it never claims optimality (exit 2, "not certified").
// On these tiny boards a 20,000-state beam never prunes, so it also finds the known optimal score.
for(const [id,score] of [['1.7',3],['1.8',5],['2.2',9],['7.3',null],['8.1',null]]){
 const p=spawnSync(path.join(root,'kunsolve'),['--level',id,'--catalog',path.join(repo,'levels.js'),'--algorithm','beam','--beam-width','20000','--quiet','--seconds','30'],{cwd:root,encoding:'utf8',timeout:50000});
 assert.equal(p.status,2,`beam ${id}: ${p.stderr}\n${p.stdout}`);assert(/SOLUTION FOUND \(optimality not certified\)/.test(p.stdout),`beam ${id} must not claim optimality`);
 const code=p.stdout.match(/^K3: (\S+)/m)?.[1],sol=p.stdout.match(/^Solution: (\S+)/m)?.[1];assert(code&&sol);const out=solutionCheck(code,sol);
 if(score!==null)assert.equal(out.score,score,`beam ${id} score`);console.log('beam',id,'score',out.score,'moves',out.count);
}
{const p=spawnSync(path.join(root,'kunsolve'),['--level','2.2','--catalog',path.join(repo,'levels.js'),'--algorithm','beam','--beam-heuristic','dynamic','--beam-width','20000','--quiet','--seconds','30'],{cwd:root,encoding:'utf8',timeout:50000});
 assert.equal(p.status,2,p.stderr+p.stdout);assert(/dynamic heuristic/.test(p.stdout)&&/optimality not certified/.test(p.stdout));
 const out=solutionCheck(p.stdout.match(/^K3: (\S+)/m)[1],p.stdout.match(/^Solution: (\S+)/m)[1]);assert.equal(out.score,9,'beam dynamic 2.2 score');console.log('beam dynamic 2.2 score',out.score);}
fixture('beam basic',{version:1,width:4,height:1,id:'basic',title:'basic',balls:[{x:1,y:1,color:'R'}],goals:[{x:4,y:1,color:'R'}]},'beam');
fixture('beam rotating',{version:1,width:4,height:3,id:'rotate',title:'rotate',balls:[{x:1,y:1,color:'R'}],goals:[{x:2,y:3,color:'R'}],arrows:[{x:2,y:1,direction:'u',rotating:true}],walls:[{x:4,y:1},{x:4,y:2},{x:4,y:3}]},'beam');
fixture('beam switch',{version:1,width:5,height:2,id:'switch',title:'switch',balls:[{x:1,y:1,color:'R'}],goals:[{x:5,y:1,color:'R'}],gates:[{x:3,y:1,id:'G1',active:true}],switches:[{x:2,y:1,id:'S1',controls:['G1']}]},'beam');
console.log('PASS beam search (replay-verified routes, no optimality claim)');
