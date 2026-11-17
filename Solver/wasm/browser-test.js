'use strict';
// Phase 2 check: the solver client in real Chromium, from file:// (how the app is opened today) and from http:// (GitHub Pages).
// Needs Playwright (dev only): node wasm/browser-test.js     (run from Solver/; needs kunsolve-bundle.js, i.e. after node wasm/build.js)
const path=require('path'),http=require('http'),fs=require('fs'),assert=require('assert');
const {chromium}=require('playwright');
const repo=path.join(__dirname,'..','..');
const server=()=>new Promise(res=>{const s=http.createServer((q,r)=>{const f=path.join(repo,decodeURIComponent(q.url.split('?')[0]));
 fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end();}else{r.writeHead(200,{'content-type':f.endsWith('.html')?'text/html':'text/javascript'});r.end(d);}});}).listen(0,()=>res(s));});
async function suite(browser,url,label){
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(url);
 const r=await page.evaluate(async()=>{
  const codes={};String(window.KUNUNDRUM_LEVEL_CODES).split('\n').forEach(l=>{const m=/^(\S+) = (\S+)/.exec(l);if(m)codes[m[1]]=m[2];});
  const out={};
  let prog=[];let r1=await KunSolver.solve(codes['6.6'],{algorithm:'auto',seconds:60,maxMemoryMB:1500},p=>prog.push(p)).promise;
  out.solve={status:r1.status,score:r1.score,moves:r1.moves,verify:KunSolver.verifyResult(r1),progress:prog.length,hasDepth:prog.some(p=>p.depth!==null),heapMB:r1.heapMB};
  const t=performance.now();const job=KunSolver.solve(codes['10.9'],{seconds:120});setTimeout(()=>job.cancel(),1500);
  try{await job.promise;out.cancel={ok:false};}catch(e){out.cancel={ok:!!e.cancelled,ms:Math.round(performance.now()-t)};}
  let r2=await KunSolver.solve(codes['1.7'],{algorithm:'beam',beamWidth:1000}).promise;out.afterCancel={status:r2.status,score:r2.score};
  let r3=await KunSolver.solve(codes['1.8'],{maxScore:4}).promise;out.bound={status:r3.status,exit:r3.exit};
  let r4=await KunSolver.solve('K3.zzzz',{}).promise;out.badCode={exit:r4.exit,error:r4.error};
  try{await KunSolver.solve(codes['6.6'],{algorithm:'x --seconds 1'}).promise;out.badOpt='accepted';}catch(e){out.badOpt=e.message;}
  return out;});
 assert.strictEqual(r.solve.status,'OPTIMAL');assert.strictEqual(r.solve.score,18);assert(r.solve.verify.ok&&r.solve.verify.checked);assert(r.solve.progress>0&&r.solve.hasDepth);
 assert(r.cancel.ok&&r.cancel.ms<4000,'cancel '+JSON.stringify(r.cancel));
 assert.strictEqual(r.afterCancel.score,3);assert.strictEqual(r.bound.exit,4);assert.strictEqual(r.badCode.exit,1);assert(/invalid algorithm/.test(r.badOpt),r.badOpt);
 assert.deepStrictEqual(errors,[],'page errors: '+errors.join(' | '));
 console.log(`${label}: OK  solve=${r.solve.status}/${r.solve.score} progress=${r.solve.progress} heap=${r.solve.heapMB}MB cancel=${r.cancel.ms}ms`);await page.close();}
(async()=>{const browser=await chromium.launch();let bad=0;
 const demo='Solver/wasm/demo.html';const s=await server();
 for(const [label,url] of [['file://','file://'+path.join(repo,demo)],['http://','http://127.0.0.1:'+s.address().port+'/'+demo]]){try{await suite(browser,url,label);}catch(e){bad++;console.log(label+': FAIL '+e.message);}}
 await browser.close();s.close();console.log(bad?bad+' failure(s)':'all browser checks pass');process.exit(bad?1:0);})();
