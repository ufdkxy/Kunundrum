'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const {spawnSync}=require('child_process');const path=require('path');
const root=path.join(__dirname,'..'),repo=path.join(root,'..');
const ctx={TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,atob,btoa,window:{}};vm.createContext(ctx);
for(let f of ['engine.js','codec.js','levels.js'])vm.runInContext(fs.readFileSync(path.join(repo,f),'utf8'),ctx,{filename:f});
const {Core,Codec}=vm.runInContext('({Core,Codec})',ctx);
function solutionCheck(code,sol){const board=Codec.decodeBoard(code);let st=Core.createInitialState(board);const tokens=Core.parseSolution(sol);for(let i=0;i<tokens.length;i++){const t=tokens[i];let id=Core.resolveBallId(st,t.identifier);let m=Core.applyMove(st,board,id,t.direction,t.choices);assert.equal(m.kind,'ok',`move ${i+1} ${id}${t.direction} ${m.kind}: ${m.message}`);st=m.state;}assert(Core.isAccepted(st),`not accepted, score=${st.score}`);return {board,score:st.score,count:tokens.length};}
let n=0;// 1.7, 1.8 and 2.2 contain hexagons: the objective is the lowest SCORE, not the fewest moves (saved routes: 13 moves/score 3, 10/5, 14/9).
const expectedScore={'1.7':3,'1.8':5,'2.2':9};
for(let id of ['6.6','7.4','7.1','7.6','7.10','8.1','1.7','1.8','2.2']){
 let p=spawnSync(path.join(root,'kunsolve'),['--level',id,'--catalog',path.join(repo,'levels.js'),'--quiet','--seconds','20','--max-states','1500000'],{cwd:root,encoding:'utf8',timeout:35000});assert.equal(p.status,0,`solver ${id}: ${p.stderr}\n${p.stdout}`);let code=p.stdout.match(/^K3: (\S+)/m)?.[1],sol=p.stdout.match(/^Solution: (\S+)/m)?.[1];assert(code&&sol);const out=solutionCheck(code,sol);assert.equal(Codec.decodeBoard(code).solution,sol);if(expectedScore[id]!==undefined)assert.equal(out.score,expectedScore[id],'level '+id+' must be solved for the lowest score');console.log(id,sol,'score',out.score,'K3',code.length,'chars');n++;}
// Generate independent test fixtures for dynamic mechanics, then solve and verify.
function fixture(name,board){let original=Codec.encodeBoard(board);let p=spawnSync(path.join(root,'kunsolve'),[original,'--algorithm','forward','--quiet','--seconds','4','--max-states','30000'],{encoding:'utf8',timeout:7000});if(p.status!==0){console.error(name,p.stdout,p.stderr);throw Error('failed '+name)}let code=p.stdout.match(/^K3: (\S+)/m)?.[1],sol=p.stdout.match(/^Solution: (\S+)/m)?.[1];assert(code&&sol);let x=solutionCheck(code,sol);console.log(name,sol,'score',x.score);n++;}
fixture('basic',{version:1,width:4,height:1,id:'basic',title:'basic',balls:[{x:1,y:1,color:'R'}],goals:[{x:4,y:1,color:'R'}]});
fixture('rotating',{version:1,width:4,height:3,id:'rotate',title:'rotate',balls:[{x:1,y:1,color:'R'}],goals:[{x:2,y:3,color:'R'}],arrows:[{x:2,y:1,direction:'u',rotating:true}],walls:[{x:4,y:1},{x:4,y:2},{x:4,y:3}]});
fixture('hex',{version:1,width:4,height:2,id:'hex',title:'hex',balls:[{x:1,y:1,color:'R'}],goals:[{x:4,y:1,color:'R'}],hexes:[{x:2,y:1,value:-1,id:'H1'}]});
fixture('switch',{version:1,width:5,height:2,id:'switch',title:'switch',balls:[{x:1,y:1,color:'R'}],goals:[{x:5,y:1,color:'R'}],gates:[{x:3,y:1,id:'W1',group:'a',active:true}],switches:[{x:2,y:1,id:'S1',wallGroups:['a'],teleportIds:[]}]});
console.log('PASS '+n+' end-to-end fixture(s)');
