'use strict';
// One-time migration (app 3.10.0): teleports changed from pair records ({id,color,ends:[a,b],active}) to individual endpoints
// ({id,x,y,color,active}) with partners derived from colors. Rewrites levels.js in place.
//   node tools/migrate-teleports.js [--old-rev 2fd781e] [--check]    (--check: report only, do not write)
// The old engine/codec are read from git history (--old-rev, the last commit with the pair format); the new ones from the working tree.
// For every entry: decode with the old format, convert, re-encode with the new one, and replay the saved solution in BOTH engines;
// the end state (complete, score, move count) must agree. Pair T_k becomes two endpoints; endpoint IDs T1..Tn follow reading order
// (rows from the bottom, then columns); a switch that listed T_k lists both of its endpoints.
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert'),{execFileSync}=require('child_process');
const repo=path.join(__dirname,'..');
const args=process.argv.slice(2),check=args.includes('--check'),oldRev=args.includes('--old-rev')?args[args.indexOf('--old-rev')+1]:'2fd781e';
function load(read){const ctx={TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,atob,btoa,window:{}};vm.createContext(ctx);
 for(const f of ['engine.js','codec.js'])vm.runInContext(read(f),ctx,{filename:f});return vm.runInContext('({Core,Codec})',ctx);}
const OLD=load(f=>execFileSync('git',['show',`${oldRev}:${f}`],{cwd:repo,encoding:'utf8'})),NEW=load(f=>fs.readFileSync(path.join(repo,f),'utf8'));
function replay(E,code,solution){const board=E.Codec.decodeBoard(code);let st=E.Core.createInitialState(board);const tokens=E.Core.parseSolution(solution);
 tokens.forEach((t,i)=>{const m=E.Core.applyMove(st,board,E.Core.resolveBallId(st,t.identifier),t.direction,t.choices);assert.equal(m.kind,'ok',`move ${i+1}: ${m.message}`);st=m.state;});
 return {complete:E.Core.isComplete(st),score:st.score,moves:tokens.length};}
function convert(old){
 const board=JSON.parse(JSON.stringify(old));if(!board.teleports||!board.teleports.length)return board;
 const ends=[];for(const t of board.teleports)for(const e of t.ends)ends.push({pair:t,x:e.x,y:e.y});
 ends.sort((a,b)=>a.y-b.y||a.x-b.x);const ids=new Map();
 ends.forEach((e,i)=>{e.id='T'+(i+1);(ids.get(e.pair.id)||ids.set(e.pair.id,[]).get(e.pair.id)).push(e.id);});
 board.teleports=ends.map(e=>({id:e.id,x:e.x,y:e.y,color:e.pair.color,active:e.pair.active}));
 for(const sw of board.switches||[])sw.controls=sw.controls.flatMap(id=>ids.get(id)||[id]);
 return board;}
const file=path.join(repo,'levels.js'),text=fs.readFileSync(file,'utf8');let changed=0,kept=0;
const out=text.split('\n').map(line=>{const m=/^(\S+) = (K[23]\.\S+)$/.exec(line.trim());if(!m)return line;
 const [,id,code]=m,old=OLD.Codec.decodeBoard(code),board=convert(old),hasTele=!!(old.teleports&&old.teleports.length);
 const next=NEW.Codec.encodeBoard(board);
 if(old.solution){const a=replay(OLD,code,old.solution),b=replay(NEW,next,old.solution);assert.deepEqual(b,a,`${id}: replay differs (old ${JSON.stringify(a)}, new ${JSON.stringify(b)})`);assert(b.complete,`${id}: saved solution does not complete`);}
 if(!hasTele){assert.equal(next,code,`${id}: a board without teleports must keep its code`);kept++;return line;}
 changed++;console.log(`${id}: ${old.teleports.length} pair(s) -> ${board.teleports.length} endpoints, solution replays identically`);return `${id} = ${next}`;}).join('\n');
console.log(`${changed} entr${changed===1?'y':'ies'} migrated, ${kept} unchanged (no teleports)`);
if(!check){fs.writeFileSync(file,out);console.log('levels.js written');}
