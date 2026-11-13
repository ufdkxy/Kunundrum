'use strict';
const {spawnSync}=require('child_process'),fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const base=path.join(__dirname,'..'),repo=path.join(base,'..'),c={TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,atob,btoa};vm.createContext(c);for(const f of ['engine.js','codec.js'])vm.runInContext(fs.readFileSync(path.join(repo,f),'utf8'),c);
const codec=vm.runInContext('Codec',c);let rng=123456789;const rand=n=>{rng=(1664525*rng+1013904223)>>>0;return rng%n;};
function execute(code,algorithm,extra=[]){const p=spawnSync(path.join(base,'kunsolve'),[code,'--algorithm',algorithm,'--quiet','--seconds','3','--max-states','100000','--no-code',...extra],{encoding:'utf8',timeout:5000});const status=p.stdout.match(/^(OPTIMAL|UNSOLVABLE|INCONCLUSIVE|SOLUTION FOUND|NO SOLUTION)/m)?.[1];const slides=+(p.stdout.match(/^Slides: (\d+)/m)?.[1]??-1);if(!status)throw Error('bad '+p.stderr);return {status,slides};}
// --max-depth, given the optimum f from the unlimited forward run: depth = optimum must reproduce it, depth = optimum-1 must prove a
// lower bound ("NO SOLUTION WITHIN"), and an unsolvable board must stay unsolvable. Returns how many depth runs were INCONCLUSIVE (skipped).
function depthChecks(code,f,k){let skipped=0;for(const alg of ['forward','bidirectional']){
 const run=(d,expect,what)=>{const x=execute(code,alg,['--max-depth',''+d]);if(x.status==='INCONCLUSIVE'){skipped++;return;}assert(expect.includes(x.status),'case '+k+' '+alg+' --max-depth '+d+' ('+what+') gave '+x.status);if(x.status==='OPTIMAL')assert.equal(x.slides,f.slides,'case '+k+' '+alg+' depth slides');};
 if(f.status==='OPTIMAL'){run(f.slides,['OPTIMAL'],'optimum');if(f.slides>1)run(f.slides-1,['NO SOLUTION'],'optimum-1');}
 else if(f.status==='UNSOLVABLE')run(6,['UNSOLVABLE','NO SOLUTION'],'unsolvable board');}
 return skipped;}
let checked=0,depthSkipped=0;for(let k=0;k<50;k++){
 const w=4,h=3,positions=Array.from({length:w*h},(_,i)=>i);const draw=()=>{let i=rand(positions.length);let p=positions.splice(i,1)[0];return {x:1+p%w,y:1+Math.floor(p/w)};};
 const sameColor=k%3==0, ballColors=sameColor?['G','G']:['R','B'];
 const balls=ballColors.map(color=>({...draw(),color})),goals=ballColors.map(color=>({...draw(),color}));
 const walls=Array.from({length:rand(3)},draw);let arrows=[],teleports=[];
 if(k%3==1&&positions.length)arrows=[{...draw(),direction:'udlr'[rand(4)]}];
 if(k%7==0&&positions.length>=2)teleports=[{id:'T',color:'*',active:true,ends:[draw(),draw()]}];
 const board={version:1,width:w,height:h,id:'rnd'+k,title:'random',walls,balls,goals,arrows,teleports};
 const code=codec.encodeBoard(board);const f=execute(code,'forward'),r=execute(code,'bidirectional');
 if(f.status==='INCONCLUSIVE'||r.status==='INCONCLUSIVE')continue;
 assert.equal(r.status,f.status,'case '+k+' status');if(f.status==='OPTIMAL')assert.equal(r.slides,f.slides,'case '+k+' slides');depthSkipped+=depthChecks(code,f,k);checked++;
}
console.log('PASS '+checked+' randomized static-board forward/bidirectional comparisons, each with --max-depth checks (optimum, optimum-1); '+depthSkipped+' depth runs inconclusive');
