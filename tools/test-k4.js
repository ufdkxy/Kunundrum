'use strict';
// K4 codec tests: the real catalog (levels.js, K4 lines), a few hand-made edge fixtures and rejection cases.   node tools/test-k4.js
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const repo=path.join(__dirname,'..');
const ctx={TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,atob,btoa,window:{}};vm.createContext(ctx);
for(const f of ['engine.js','codec.js','levels.js','catalog.js'])vm.runInContext(fs.readFileSync(path.join(repo,f),'utf8'),ctx,{filename:f});
const {Core,Codec,Collection}=vm.runInContext('({Core,Codec,Collection})',ctx);
let n=0;const ok=(name)=>{n++;console.log('ok',name);};
// 1. Catalog: every line decodes, re-encodes to itself (board + route) and its route completes the board.
for(const {id,code} of Collection.entries){assert(code.startsWith('K4.'),id);const extra={},b=Codec.decodeBoard(code,undefined,extra);assert(extra.route,id);
 const solution=Codec.decodeRouteCode(b,extra.route);assert(!/[,\s]/.test(solution),id);assert.equal(Codec.encodeBoard(b)+Codec.encodeRoute(b,solution),code,id);
 const full=Core.validateBoard({...b,id,title:'Level '+id,solution});let st=Core.createInitialState(full);
 const resolve=Core.createResolver();for(const t of Core.parseSolution(solution)){const m=Core.applyMove(st,full,resolve(st,t),t.direction,t.choices);assert.equal(m.kind,'ok',id);st=m.state;}assert(Core.isComplete(st),id);}
ok(`catalog: ${Collection.entries.length} levels canonical (board + route) and solved`);
// 2. Fixtures.
const round=(name,board)=>{const code=Codec.encodeBoard(board),back=Codec.decodeBoard(code);assert.equal(Codec.encodeBoard(back),code,name);return {code,back};};
const walls15=[];for(let x=1;x<=15;x++)walls15.push({x,y:8});walls15.splice(3,1);
const big=round('15x15',{width:15,height:15,walls:walls15.filter(w=>w.x!==5),balls:[{x:1,y:1,color:'R'},{x:15,y:15,color:'Y'}],goals:[{x:15,y:1,color:'R'},{x:1,y:15,color:'Y'}],hexes:[{x:7,y:3,id:'h',value:-20},{x:8,y:3,id:'h2',value:20}]});
assert.equal(big.back.width,15);assert.equal(big.back.hexes.length,2);ok('15x15 board with hexes and a long wall run');
const corner=round('corner',{width:3,height:3,walls:[{x:2,y:2}],balls:[{x:2,y:1,color:'B'}],goals:[{x:3,y:3,color:'B'}],
 tunnels:[{a:{x:1,y:1,side:'d'},b:{x:1,y:1,side:'l'}},{a:{x:3,y:3,side:'u'},b:{x:2,y:1,side:'u'}}]});
assert.equal(corner.back.tunnels.length,2);ok('corner cell with two edge openings plus a wall gap');
const wallColor=round('green',{width:2,height:1,walls:[],balls:[{x:1,y:1,color:'R'}],goals:[{x:2,y:1,color:'R'}],wallColor:'G'});assert.equal(wallColor.back.wallColor,'G');ok('wall color');
const rot=round('rot',{width:4,height:1,walls:[],balls:[{x:1,y:1,color:'R'}],goals:[{x:4,y:1,color:'R'}],arrows:[{x:2,y:1,direction:'u',rotating:true,type:'flip'},{x:3,y:1,direction:'l',rotating:true},{x:4,y:1,direction:'d',rotating:true,type:'ccw'}].slice(0,2)});
assert.equal(rot.back.arrows[0].type,'flip');ok('rotating arrow types');
// 2b. Notation: no commas in output; commas and spaces are still ignored on input; groups are read back to back.
assert.equal(Core.formatSolution([{ballId:'R',direction:'u',choices:[]},{ballId:'R',direction:'l',choices:[]},{ballId:'G2',direction:'d',choices:[]},{ballId:'B',direction:'r',choices:['u']}]),'RulG2dBr(->u)');
assert.deepEqual(Core.parseSolution('RulG2dBr(->u)'),Core.parseSolution('Rul, G2d,B r(->u)'));
assert.deepEqual(Core.parseSolution('1l2u').map(t=>t.identifier+t.direction),['1l','2u']);ok('notation without commas');
// 2c. Relative labels (RULES.md section 4): labels follow the current position; a group is one physical ball.
{const b=Core.validateBoard({id:'rel',title:'rel',width:3,height:3,walls:[{x:2,y:3}],balls:[{x:2,y:1,color:'R'},{x:1,y:2,color:'R'}],goals:[{x:3,y:3,color:'R'},{x:3,y:1,color:'R'}]});
 const play=text=>{let st=Core.createInitialState(b);const res=Core.createResolver(),recs=[];for(const t of Core.parseSolution(text)){const m=Core.applyMove(st,b,res(st,t),t.direction,t.choices);assert.equal(m.kind,'ok',text+' '+m.message);st=m.state;recs.push(m.record);}return recs;};
 const swap=play('R1uR1d'); // R1 moves up beside the other red ball and becomes R2, so the next R1 is the other ball
 assert.notEqual(swap[0].ballId,swap[1].ballId);assert.deepEqual(swap.map(r=>r.label),['R1','R1']);assert.equal(Core.formatSolution(swap),'R1uR1d');
 const same=play('R1uR2r'); // R2 names the same ball after the swap, so the two groups merge into one
 assert.equal(same[0].ballId,same[1].ballId);assert.equal(Core.formatSolution(same),'R1ur');
 assert.deepEqual(play('R1ur').map(r=>r.ballId),same.map(r=>r.ballId)); // a group stays on one ball whatever its label becomes
 assert.deepEqual(Object.values(Core.ballLabels(Core.createInitialState(b))),['R1','R2']);
 assert.throws(()=>play('Ru'),/ambiguous/);assert.throws(()=>play('R3u'),/no unlocked ball/);
 // the route codec stores the rank among unlocked balls, so it round-trips through swaps
 for(const text of ['R1uR1d','R1ur']){assert.equal(Codec.decodeRouteCode(b,Codec.encodeRoute(b,text)),text);}
 ok('relative labels, physical-ball groups, route codec');}
// 3. Rejections.
const base='K4.'+Codec.encodeBoard({width:2,height:1,walls:[],balls:[{x:1,y:1,color:'R'}],goals:[{x:2,y:1,color:'R'}]}).slice(3);
const bad=(name,fn)=>{assert.throws(fn);ok('rejects '+name);};
const run=Codec.encodeBoard({width:8,height:1,walls:[2,3,4,5,6,7,8].map(x=>({x,y:1})),balls:[{x:1,y:1,color:'R'}],goals:[{x:1,y:1,color:'R'}]});
assert(run.includes('fa'));
bad('non-canonical wall run',()=>Codec.decodeBoard(run.replace('fa','af')));
bad('trailing characters',()=>Codec.decodeBoard(base+'0'));
bad('reserved symbol Z',()=>Codec.decodeBoard('K4.211Z'+base.slice(7)));
bad('leading zero run',()=>Codec.decodeBoard('K4.2100'+base.slice(7)));
bad('truncated',()=>Codec.decodeBoard(base.slice(0,-1)));
bad('size 16',()=>Codec.encodeBoard({width:16,height:1,walls:[],balls:[{x:1,y:1,color:'R'}],goals:[{x:2,y:1,color:'R'}]}));
bad('hex value 7',()=>Codec.encodeBoard({width:3,height:1,walls:[],balls:[{x:1,y:1,color:'R'}],goals:[{x:2,y:1,color:'R'}],hexes:[{x:3,y:1,id:'h',value:7}]}));
bad('opening facing floor',()=>Codec.encodeBoard({width:3,height:1,walls:[],balls:[{x:1,y:1,color:'R'}],goals:[{x:2,y:1,color:'R'}],tunnels:[{a:{x:1,y:1,side:'r'},b:{x:3,y:1,side:'r'}}]}));
bad('uncontrolled gate',()=>Codec.encodeBoard({width:3,height:1,walls:[],balls:[{x:1,y:1,color:'R'}],goals:[{x:2,y:1,color:'R'}],gates:[{x:3,y:1,id:'g',active:true}]}));
{const c='K4.3401pa6a2010F',b=Codec.decodeBoard(c),z=Codec.encodeRoute(Core.validateBoard({...b,id:'1.1',title:'x'}),'Gd');
 bad('route without an extra receiver',()=>Codec.decodeBoard(c+z));
 bad('route that is not alphanumeric',()=>Codec.decodeBoard(c+'-',undefined,{}));
 bad('non-canonical route (leading 0)',()=>Codec.decodeRouteCode(b,'0'+z.slice(1)));
 bad('garbage route',()=>Codec.decodeRouteCode(b,'!!'));}
console.log(n+' checks passed');
