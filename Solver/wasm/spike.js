'use strict';
// Phase 0 check: run the WASM build of the unchanged CLI on catalog levels and compare with the native solver.
// Usage (from Solver/): node wasm/spike.js [levelId ...]      default: 6.6 7.4 7.6 8.1 1.7 1.8 2.2 10.8 10.9 (those present in levels.js)
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const repo=path.join(__dirname,'..','..');
const catalog=fs.readFileSync(path.join(repo,'levels.js'),'utf8');
const codeOf=id=>{const m=catalog.match(new RegExp('^'+id.replace('.','\\.')+' = (\\S+)','m'));return m&&m[1];};
const ids=process.argv.slice(2).length?process.argv.slice(2):['6.6','7.4','7.6','8.1','1.7','1.8','2.2','10.8','10.9'];
const createKunsolve=require('./build/kunsolve.js');
const nativeCandidates=[path.join(__dirname,'..','kunsolve'),path.join(__dirname,'..','kunsolve.exe'),path.join(__dirname,'..','kunsolve-linux-x86_64')];
const native=nativeCandidates.find(p=>fs.existsSync(p)&&(process.platform!=='linux'?!p.includes('linux'):true));
const ARGS=['--quiet','--seconds','150','--max-states','10000000'];
function parse(text){const g=re=>{const m=text.match(re);return m?m[1].trim():null;};
 return {status:g(/^(OPTIMAL|SOLUTION FOUND[^\n]*|UNSOLVABLE|INCONCLUSIVE|NO SOLUTION[^\n]*)$/m),score:g(/^Score: (.*)$/m),moves:g(/^Moves: (.*)$/m),states:g(/^States: (.*)$/m),nativeMem:g(/^Memory: (.*)$/m)};}
async function runWasm(code){const out=[];let exit=null;const t=Date.now();
 const m=await createKunsolve({print:l=>out.push(l),printErr:()=>{},onExit:c=>{exit=c;},quit:(c)=>{exit=c;}});
 try{const r=m.callMain([code,...ARGS]);if(exit===null&&typeof r==='number')exit=r;}catch(e){if(e&&e.status!==undefined)exit=e.status;else throw e;}
 return {...parse(out.join('\n')),exit,sec:((Date.now()-t)/1000).toFixed(1),heapMB:m.HEAPU8?(m.HEAPU8.length>>20):'n/a'};}
function runNative(code){if(!native)return null;const t=Date.now();const p=spawnSync(native,[code,...ARGS],{encoding:'utf8',maxBuffer:1<<26});return {...parse(p.stdout),exit:p.status,sec:((Date.now()-t)/1000).toFixed(1)};}
(async()=>{let bad=0;console.log('native: '+(native||'(none found; showing WASM only - run `make` in Solver/ to compare)'));
 for(const id of ids){const code=codeOf(id);if(!code){console.log(id+': not in levels.js, skipped');continue;}
  const w=await runWasm(code),n=runNative(code);
  const same=!n||(w.status===n.status&&w.score===n.score&&w.moves===n.moves&&w.exit===n.exit);if(!same)bad++;
  console.log(`${id}: ${same?'OK  ':'DIFF'} wasm ${w.status} score=${w.score} moves=${w.moves} states=${w.states} exit=${w.exit} ${w.sec}s heap=${w.heapMB}MB(solver says ${w.nativeMem})`+(n?`\n      native ${n.status} score=${n.score} moves=${n.moves} states=${n.states} exit=${n.exit} ${n.sec}s`+(n.states!==w.states?'  (state counts differ)':''):''));}
 console.log(bad?`${bad} level(s) differ`:'all compared levels match');process.exit(bad?1:0);})();
