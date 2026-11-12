'use strict';
const {spawnSync}=require('child_process'),fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const base=path.join(__dirname,'..'),c={TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,atob,btoa};vm.createContext(c);for(const f of ['engine.js','codec.js'])vm.runInContext(fs.readFileSync(path.join(base,f),'utf8'),c);
const codec=vm.runInContext('Codec',c);let rng=123456789;const rand=n=>{rng=(1664525*rng+1013904223)>>>0;return rng%n;};
function execute(code,algorithm){const p=spawnSync(path.join(base,'kunsolve'),[code,'--algorithm',algorithm,'--quiet','--seconds','6','--max-states','200000','--no-code'],{encoding:'utf8',timeout:9000});const status=p.stdout.match(/^(OPTIMAL|UNSOLVABLE|INCONCLUSIVE|SOLUTION FOUND)/m)?.[1];const slides=+(p.stdout.match(/^Slides: (\d+)/m)?.[1]??-1);if(!status)throw Error('bad '+p.stderr);return {status,slides,code:p.stdout};}
let checked=0, skipped=0;for(let k=0;k<100;k++){
 const w=4,h=3,positions=Array.from({length:w*h},(_,i)=>i);const draw=()=>{let i=rand(positions.length);let p=positions.splice(i,1)[0];return {x:1+p%w,y:1+Math.floor(p/w)};};
 const sameColor=k%3==0, ballColors=sameColor?['G','G']:['R','B'];
 const balls=ballColors.map(color=>({...draw(),color})),goals=ballColors.map(color=>({...draw(),color}));
 const walls=Array.from({length:rand(2)},draw);
 const nG=1+rand(3);let gates=[];for(let i=0;i<nG;i++)gates.push({...draw(),id:'W'+i,group:'grp'+(i%2),active:!!rand(2)});
 const nS=1+rand(2),switches=[];for(let i=0;i<nS;i++)switches.push({...draw(),id:'S'+i,wallGroups:['grp'+rand(Math.min(2,nG))],teleportIds:[]});
 let teleports=[];if(k%5==0&&positions.length>=2){teleports=[{id:'T',color:'*',active:true,ends:[draw(),draw()]}];switches[0].teleportIds=['T'];}
 const board={version:1,width:w,height:h,id:'rnd'+k,title:'random',walls,balls,goals,gates,switches,teleports};
 const code=codec.encodeBoard(board);const f=execute(code,'forward'),r=execute(code,'bidirectional');
 if(f.status==='INCONCLUSIVE'||r.status==='INCONCLUSIVE'){skipped++;continue;}
 assert.equal(r.status,f.status,'case '+k+' status '+JSON.stringify(board));if(f.status==='OPTIMAL')assert.equal(r.slides,f.slides,'case '+k+' slides');checked++;
}
console.log('PASS '+checked+' randomized switch-board forward/bidirectional comparisons; skipped '+skipped);
