'use strict';
// One-time migration (K4.md §6 step 3): levels.js lines `id = K3.<code>` become `id = K4.<board code> <solution>`.
// K4 stores the board only; the id stays on the line and the solution follows the code (text notation, RULES.md §5).
//   node tools/migrate-k4.js [--check]    (--check: verify and report only, do not write)
// For every entry: decode K3, encode K4, decode K4, require equal boards (ignoring ids, title, solution and the switch indicator),
// replay the saved solution on both boards and require the same completion, score and move count. A backup levels.js.k3.bak is
// written next to levels.js before it is replaced (delete it once verified).
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const repo=path.join(__dirname,'..'),check=process.argv.includes('--check');
const ctx={TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,atob,btoa,window:{}};vm.createContext(ctx);
for(const f of ['engine.js','codec.js'])vm.runInContext(fs.readFileSync(path.join(repo,f),'utf8'),ctx,{filename:f});
const {Core,Codec}=vm.runInContext('({Core,Codec})',ctx);
const norm=b=>{const pos=p=>`${p.x},${p.y}`,idPos=new Map([...b.gates,...b.teleports].map(e=>[e.id,pos(e)]));
 return JSON.stringify({w:b.width,h:b.height,wc:b.wallColor??null,walls:b.walls,balls:b.balls.map(({id,...r})=>r),goals:b.goals,arrows:b.arrows,
  gates:b.gates.map(({id,...r})=>r),teleports:b.teleports.map(({id,...r})=>r).sort((p,q)=>p.y-q.y||p.x-q.x),hexes:b.hexes.map(({id,...r})=>r),
  switches:b.switches.map(s=>({x:s.x,y:s.y,controls:s.controls.map(id=>idPos.get(id)).sort()})),tunnels:b.tunnels??[]});};
function replay(board,solution){let st=Core.createInitialState(board);const tokens=Core.parseSolution(solution);
 tokens.forEach((t,i)=>{const m=Core.applyMove(st,board,Core.resolveBallId(st,t.identifier),t.direction,t.choices);assert.equal(m.kind,'ok',`move ${i+1}: ${m.message}`);st=m.state;});
 return {complete:Core.isComplete(st),score:st.score,moves:tokens.length};}
const file=path.join(repo,'levels.js'),text=fs.readFileSync(file,'utf8');let n=0,lens=[],indicator=[];
const out=text.split('\n').map(line=>{const m=/^(\d{1,2}\.(?:10|[1-9])) = (K3\.\S+)$/.exec(line.trim());if(!m)return line;
 const [,id,k3]=m,a=Codec.decodeBoard(k3);assert.equal(a.id,id);assert(a.solution,`${id}: no embedded solution`);
 if(a.switches.some(s=>s.on))indicator.push(id);
 const k4=Codec.encodeBoardK4(a),b=Codec.decodeBoard(k4);
 assert.equal(norm(b),norm(a),`${id}: boards differ after the K4 round trip`);
 assert.equal(Codec.encodeBoardK4(b),k4,`${id}: K4 is not stable`);
 const ra=replay(a,a.solution),rb=replay(b,a.solution);assert.deepEqual(rb,ra,`${id}: replay differs`);assert(rb.complete,`${id}: solution does not complete`);
 n++;lens.push(k4.length-3);return `${id} = ${k4} ${a.solution}`;}).join('\n').replace('// Kunundrum K3 catalog. Edit the lines inside the template string.','// Kunundrum catalog. One line per level: `id = K4.<board code> <solution>`. Edit the lines inside the template string.');
console.log(`${n} levels verified (board round trip, canonical stability, solution replay); K4 payload length min ${Math.min(...lens)}, max ${Math.max(...lens)}, mean ${(lens.reduce((x,y)=>x+y,0)/n).toFixed(1)}`);
if(indicator.length)console.log('Switch indicator (on) is not stored by K4 and is reset to off for:',indicator.join(', '));
if(!check){fs.copyFileSync(file,file+'.k3.bak');fs.writeFileSync(file,out);console.log('levels.js written (backup levels.js.k3.bak)');}
