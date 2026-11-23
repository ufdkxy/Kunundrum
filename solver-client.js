// Browser client for the WebAssembly solver. Classic script (works from file:// and http://); exposes window.KunSolver.
//   const job = KunSolver.solve(Codec.encodeBoard(board), {algorithm:'bidirectional', seconds:60, maxMemoryMB:1500}, p => ...);
//   job.promise -> result object (see Solver README, --json) plus heapMB;  job.cancel() terminates the worker (promise rejects with err.cancelled).
// Each solve gets a fresh worker (fresh WASM heap) that is terminated afterwards; cancelling is just terminating it.
(function(){'use strict';
const SCRIPT_URL=(document.currentScript&&document.currentScript.src)||'';
let sourcePromise=null;
function loadSource(url){
 if(window.KUNSOLVE_WORKER_SOURCE)return Promise.resolve(window.KUNSOLVE_WORKER_SOURCE);
 if(!sourcePromise)sourcePromise=new Promise((resolve,reject)=>{
  const s=document.createElement('script');s.src=url||SCRIPT_URL.replace(/[^/]*$/,'')+'kunsolve-bundle.js';
  s.onload=()=>window.KUNSOLVE_WORKER_SOURCE?resolve(window.KUNSOLVE_WORKER_SOURCE):reject(new Error('solver bundle is empty'));
  s.onerror=()=>{sourcePromise=null;reject(new Error('could not load the solver (kunsolve-bundle.js)'));};
  document.head.appendChild(s);});
 return sourcePromise;}
const ALGORITHMS=['auto','forward','bidirectional','beam'],HEURISTICS=['static','dynamic'];
// options -> CLI flag string. Everything is validated; nothing user-typed reaches the flag string unchecked.
function buildFlags(o){
 const f=[];const num=(key,flag,{int=true,min=-Infinity,max=Infinity}={})=>{const v=o[key];if(v===undefined||v===null||v==='')return;const n=Number(v);
  if(!Number.isFinite(n)||n<min||n>max)throw new Error('invalid '+key+': '+v);f.push(flag,String(int?Math.trunc(n):n));};
 if(o.algorithm){if(!ALGORITHMS.includes(o.algorithm))throw new Error('invalid algorithm: '+o.algorithm);f.push('--algorithm',o.algorithm);}
 if(o.beamHeuristic){if(!HEURISTICS.includes(o.beamHeuristic))throw new Error('invalid beamHeuristic: '+o.beamHeuristic);f.push('--beam-heuristic',o.beamHeuristic);}
 num('seconds','--seconds',{int:false,min:0,max:86400});num('maxStates','--max-states',{min:0});num('maxMemoryMB','--max-memory',{min:1,max:4096});
 num('maxDepth','--max-depth',{min:1,max:100000});num('maxScore','--max-score',{min:-1e12,max:1e12});
 num('beamWidth','--beam-width',{min:1});num('seed','--seed',{min:0});
 return f.join(' ');}
// Solver progress lines ("forward depth 5 visited 1234 elapsed 0.8s", "beam depth 7 kept 20000 ...") -> {line, depth, fwdDepth, revDepth, states, elapsed}
function parseProgress(line){const d=/\bdepth (\d+)/g;let depth=null,m;while((m=d.exec(line)))depth=Math.max(depth||0,+m[1]);
 const s=/\b(?:states|visited|kept) (\d+)/.exec(line),e=/elapsed ([\d.]+)s/.exec(line);
 const f=/\bforward depth (\d+)/.exec(line),r=/\breverse depth (\d+)/.exec(line);
 return {line,depth,fwdDepth:f?+f[1]:null,revDepth:r?+r[1]:null,states:s?+s[1]:null,elapsed:e?+e[1]:null};}
function solve(code,options,onProgress){
 let worker=null,url=null,settled=false,rejectFn;
 const cleanup=()=>{if(worker){worker.terminate();worker=null;}if(url){URL.revokeObjectURL(url);url=null;}};
 const promise=new Promise((resolve,reject)=>{rejectFn=reject;let flags;
  try{flags=buildFlags(options||{});}catch(e){settled=true;reject(e);return;}
  loadSource().then(src=>{if(settled)return;
   url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));worker=new Worker(url);
   worker.onmessage=ev=>{const m=ev.data;
    if(m.type==='progress'){if(onProgress)onProgress(parseProgress(m.line));}
    else if(m.type==='result'){settled=true;cleanup();resolve(Object.assign({heapMB:m.heapMB},m.result));}
    else if(m.type==='error'){settled=true;cleanup();reject(new Error(m.message));}};
   worker.onerror=ev=>{settled=true;cleanup();reject(new Error(ev.message||'the solver worker failed'));};
   worker.postMessage({type:'solve',id:1,code:String(code),flags});
  }).catch(e=>{settled=true;cleanup();reject(e);});});
 const cancel=()=>{if(settled)return;settled=true;cleanup();const e=new Error('cancelled');e.cancelled=true;rejectFn(e);};
 return {promise,cancel};}
// (`Codec` is a top-level const in codec.js: a global binding, not a window property.)
// A returned route is only trusted after the app's own codec has decoded the K3 and replayed it through Core (Codec.decodeBoard throws if not).
function verifyResult(result){if(!result||!result.hasSolution)return {ok:true,checked:false};
 try{Codec.decodeBoard(result.k3);return {ok:true,checked:true};}catch(e){return {ok:false,checked:true,error:e.message};}}
window.KunSolver={solve,buildFlags,parseProgress,verifyResult,loadSource};
})();
