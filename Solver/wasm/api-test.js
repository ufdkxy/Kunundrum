'use strict';
// Phase 1 check: the kun_solve() JSON API of the WASM build vs. the native CLI (--json), with the returned route replayed by the real JS engine.
// Usage (from Solver/, after `node wasm/build.js` and `make`): node wasm/api-test.js
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert'),{spawnSync}=require('child_process');
const repo=path.join(__dirname,'..','..'),solverDir=path.join(__dirname,'..');
const ctx={TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,atob,btoa,window:{}};vm.createContext(ctx);
for(const f of ['engine.js','codec.js','levels.js'])vm.runInContext(fs.readFileSync(path.join(repo,f),'utf8'),ctx,{filename:f});
const {Core,Codec}=vm.runInContext('({Core,Codec})',ctx);
const catalog=fs.readFileSync(path.join(repo,'levels.js'),'utf8');
const codeOf=id=>{const m=catalog.match(new RegExp('^'+id.replace('.','\\.')+' = (\\S+)','m'));assert(m,'level '+id+' not in levels.js');return m[1];};
const createKunsolve=require('./build/kunsolve.js');
const native=['kunsolve','kunsolve.exe','kunsolve-linux-x86_64'].map(f=>path.join(solverDir,f)).find(p=>fs.existsSync(p)&&(process.platform==='linux'||!p.includes('linux')));
assert(native,'native solver not found: run `make` in Solver/');
async function wasm(code,flags){const lines=[];const m=await createKunsolve({onProgress:l=>lines.push(l),print:()=>{},printErr:()=>{}});
 const j=JSON.parse(m.ccall('kun_solve','string',['string','string'],[code,flags]));return {j,lines};}
const cases=[['6.6','--seconds 60'],['8.1','--seconds 60'],['1.8','--max-score 4'],['1.8','--max-score 5'],['6.6','--max-depth 17'],['2.2',''],['1.7','--algorithm beam --beam-width 1000'],['10.8','--seconds 150']];
(async()=>{let bad=0;
 for(const [id,flags] of cases){const code=codeOf(id);
  const {j,lines}=await wasm(code,flags);
  const p=spawnSync(native,[code,'--quiet','--json',...flags.split(' ').filter(Boolean)],{encoding:'utf8',maxBuffer:1<<26});const n=JSON.parse(p.stdout);
  try{for(const k of ['exit','status','hasSolution','score','moves','solution','lowerMoves','hasLowerScore','lowerScore','algorithm','states','transitions'])assert.deepStrictEqual(j[k],n[k],k);
   if(id==='8.1')assert(lines.length>0,'no progress lines');
   console.log(`${id} ${flags}: OK ${j.status} score=${j.score} moves=${j.moves} states=${j.states} progressLines=${lines.length}`);}
  catch(e){bad++;console.log(`${id} ${flags}: FAIL ${e.message}`);}}
 const e=(await wasm('K4.zzzz','')).j;try{assert.strictEqual(e.exit,1);assert(e.error);console.log('bad code: OK error="'+e.error+'"');}catch(x){bad++;console.log('bad code: FAIL',JSON.stringify(e));}
 const f=(await wasm(codeOf('6.6'),'--bogus-flag')).j;try{assert.strictEqual(f.exit,1);assert(f.error);console.log('bad flag: OK error="'+f.error+'"');}catch(x){bad++;console.log('bad flag: FAIL',JSON.stringify(f));}
 console.log(bad?bad+' failure(s)':'all API checks pass');process.exit(bad?1:0);})();
