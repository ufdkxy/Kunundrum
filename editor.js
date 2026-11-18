/* Kunundrum in-place board editor: no network, no build step. */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const keys = ['walls','balls','goals','arrows','gates','switches','teleports','hexes'];
const clone = x => JSON.parse(JSON.stringify(x));
const colorNames={R:'Red',G:'Green',B:'Blue',Y:'Yellow','*':'Universal'};
const singular={walls:'Wall',balls:'Ball',goals:'Goal',arrows:'Arrow',gates:'Gate',switches:'Switch',teleports:'Teleport',hexes:'Hexagon'};
const tools=['select','ball','goal','wall','gate','switch','arrow','teleport','tunnel','hex','erase'];
const sideNames={u:'top',d:'bottom',l:'left',r:'right'};
// Nearest cell side to the pointer, from the cell's hit rectangle (used by the Tunnel tool).
function sideOf(event){const el=event.target.closest?.('[data-edit-x]');if(!el)return null;const r=el.getBoundingClientRect(),fx=(event.clientX-r.left)/r.width,fy=(event.clientY-r.top)/r.height,d={l:fx,r:1-fx,u:fy,d:1-fy};return Object.keys(d).reduce((m,k)=>d[k]<d[m]?k:m,'l');}
const openingAt=(t,x,y,side)=>[t.a,t.b].some(e=>e.x===x&&e.y===y&&(!side||e.side===side));
const mutable = {active:false,draft:null,grab:null,floatDrag:null,preferFloor:false,pendingTunnel:null,clickSide:null,tool:'select',color:'G',direction:'r',rotating:false,activeTile:true,hexValue:-5,selected:null,history:[],future:[],dragging:false,dragChanged:false,dragBefore:null,lastCell:'',dirty:false};
const E = mutable;
const host = () => window.KunundrumHost;
const same=(a,b)=>a&&b&&a.x===b.x&&a.y===b.y;
const clean = s => String(s||'').trim();
const prune = b => {const ids=new Set([...b.gates,...b.teleports].map(v=>v.id));for(const sw of b.switches)sw.controls=sw.controls.filter(id=>ids.has(id));};
const list = s => clean(s).split(',').map(clean).filter(Boolean);
const at = (p,x,y)=>p.x===x&&p.y===y;
const nextId = (arr, prefix) => {let i=1;while(arr.some(v=>v.id===prefix+i))i++;return prefix+i;};
const template=()=>({version:1,id:'custom',title:'Custom board',width:10,height:7,walls:[],balls:[{color:'R',x:1,y:1}],goals:[{color:'R',x:10,y:7}],arrows:[],gates:[],switches:[],teleports:[],hexes:[]});
function snapshot(){return JSON.stringify(E.draft);}
function remember(before){if(before===snapshot())return false;E.history.push(before);if(E.history.length>150)E.history.shift();E.future=[];E.dirty=true;return true;}
function setStatus(message='',error=false){$('editor-status').textContent=message;$('editor-status').classList.toggle('error',error);}
function putProps(){
 const match=E.selected;
 const panel=$('editor-properties');
 if(!match){panel.replaceChildren();panel.hidden=true;return;}
 panel.hidden=false;
 let item=null;
 item=E.draft[match.type]?.find(v=>v._eid===match.id || (v.id && v.id===match.id) || (v.x===match.x&&v.y===match.y));
 if(!item){E.selected=null;putProps();return;}
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const select=(name,options,value)=>`<label>${name}<select data-edit="${name}">${options.map(v=>`<option value="${esc(v[0])}" ${v[0]===value?'selected':''}>${esc(v[1])}</option>`).join('')}</select></label>`;
 const input=(name,value,type='text')=>`<label>${name}<input data-edit="${name}" type="${type}" value="${esc(value)}"/></label>`;
 const colors=Object.keys(colorNames).filter(c=>match.type==='teleports'||c!=='*').map(c=>[c,colorNames[c]]);
 let html=`<div class="editor-object-title">${singular[match.type]||esc(match.type)}${item.id?' · '+esc(item.id):''}</div>`;
 if(item.color)html+=select('Color',colors,item.color);
 if(match.type==='arrows'){html+=select('Direction',[['u','Up'],['d','Down'],['l','Left'],['r','Right']],item.direction);html+=select('Rotating',[["false","No"],["true","Yes"]],String(!!item.rotating));}
 if(match.type==='gates'){html+=select('Active',[["true","On"],["false","Off"]],String(item.active));}
 if(match.type==='switches'){html+=input('Gate/Teleport IDs',item.controls.join(', '));html+=select('Active',[["true","On"],["false","Off"]],String(!!item.on));}
 if(match.type==='teleports'){html+=select('Active',[["true","On"],["false","Off"]],String(item.active));}
 if(match.type==='hexes')html+=input('Value',item.value,'number');
 html+='<button class="secondary-button editor-delete" id="editor-delete-object" type="button">Delete object</button>';
 panel.innerHTML=html;
}
const iconCache={};
function renderIcons(){
 const color=E.color,spec={ball:{color},goal:{color},wall:{wallColor:E.draft?.wallColor},gate:{active:E.activeTile},switch:{},arrow:{direction:E.direction,rotating:E.rotating},teleport:{color,active:E.activeTile},hex:{value:E.hexValue||-5}};
 for(const el of document.querySelectorAll('[data-tool-icon]')){
  const type=el.dataset.toolIcon,args={type,...spec[type]},key=JSON.stringify(args);
  if(el.dataset.iconKey===key)continue;
  el.dataset.iconKey=key;el.innerHTML=iconCache[key]||(iconCache[key]=host().icon(args));
 }
}
function syncJson(){const box=$('editor-json');if(!$('editor-json-box').hidden&&document.activeElement!==box&&E.draft)box.value=JSON.stringify(E.draft,null,2);}
function setReview(source,show=true){
 const thumb=$('editor-review-thumb'),canvas=$('editor-review-canvas');
 if(!show||!source||!source.width){thumb.hidden=true;return;}
 const k=Math.min(480/source.width,1),w=Math.max(1,Math.round(source.width*k)),h=Math.max(1,Math.round(source.height*k));
 canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(source,0,0,w,h);thumb.hidden=false;
}
function refresh(){
 renderIcons();
 if(E.tool!=='tunnel')E.pendingTunnel=null;
 if(E.active&&document.activeElement!==$('editor-title'))$('editor-title').value=E.draft.title;
 $('edit-mode-label').textContent=E.active?'Play':'Edit';
 $('edit-mode-icon-edit').hidden=E.active;
 $('edit-mode-icon-play').hidden=!E.active;
 $('edit-mode-button').setAttribute('aria-pressed',String(E.active));
 document.body.classList.toggle('edit-mode',E.active);
 for(const id of ['open-levels','open-board-data','open-share','open-solver'])$(id).disabled=E.active;
 $('editor-width').value=E.draft?.width??10;$('editor-height').value=E.draft?.height??7;
 $('editor-hex').value=E.hexValue;
 $('editor-rotating').checked=E.rotating;
 $('editor-active').checked=E.activeTile;
 for(const button of document.querySelectorAll('[data-editor-tool]')){button.classList.toggle('chosen',button.dataset.editorTool===E.tool);button.setAttribute('aria-pressed',String(button.dataset.editorTool===E.tool));}
 for(const button of document.querySelectorAll('[data-editor-color]')){button.classList.toggle('chosen',button.dataset.editorColor===E.color);button.setAttribute('aria-pressed',String(button.dataset.editorColor===E.color));}
 $('editor-wall-colors').hidden=E.tool!=='wall';
 const wallColor=E.draft?.wallColor||'B';
 for(const button of document.querySelectorAll('[data-editor-wall-color]')){button.classList.toggle('chosen',button.dataset.editorWallColor===wallColor);button.setAttribute('aria-pressed',String(button.dataset.editorWallColor===wallColor));}
 for(const button of document.querySelectorAll('[data-editor-direction]')){button.classList.toggle('chosen',button.dataset.editorDirection===E.direction);button.setAttribute('aria-pressed',String(button.dataset.editorDirection===E.direction));}
 $('editor-undo').disabled=!E.history.length;$('editor-redo').disabled=!E.future.length;
  const t=E.tool;
 $('editor-colors').hidden=!['ball','goal','teleport'].includes(t);
 $('editor-universal-color').hidden=t!=='teleport';
 $('editor-directions').hidden=t!=='arrow';
 $('editor-hex-label').hidden=t!=='hex';
 $('editor-active-label').hidden=!['gate','teleport'].includes(t);
 $('editor-rotating-label').hidden=t!=='arrow';
 $('board-stage').classList.toggle('editor-select-tool',E.active&&E.tool==='select');
 if(E.tool!=='select')$('board-stage').classList.remove('editor-grabbable','editor-grabbing');
 putProps();
}
function overlay(){
 if(!E.active)return '';
 const pad=18,cell=64,b=E.draft;
 let out='<g class="editor-hit-layer">';
 for(let y=1;y<=b.height;y++)for(let x=1;x<=b.width;x++){
  const px=pad+(x-1)*cell,py=pad+(b.height-y)*cell;
  out+=`<rect data-edit-x="${x}" data-edit-y="${y}" x="${px}" y="${py}" width="${cell}" height="${cell}" fill="transparent" stroke="none"/>`;
 }
 out+='</g>';
 if(E.pendingTunnel){
  const e=E.pendingTunnel,px=pad+(e.x-1)*cell,py=pad+(b.height-e.y)*cell;
  const [ex,ey]={u:[px+cell/2,py],d:[px+cell/2,py+cell],l:[px,py+cell/2],r:[px+cell,py+cell/2]}[e.side];
  out+=`<g class="editor-drag-preview" pointer-events="none" transform="translate(${ex},${ey})"><circle r="13" fill="#43dcff" fill-opacity=".25" stroke="#90f2ff" stroke-width="3" stroke-dasharray="5 3"/></g>`;
 }
 if(E.dragging&&E.grab?.selection&&E.grab.hover&&!same(E.grab.from,E.grab.hover)){
  const h=E.grab.hover, px=pad+(h.x-.5)*cell,py=pad+(b.height-h.y+.5)*cell;
  out+=`<g class="editor-drag-preview" pointer-events="none" transform="translate(${px},${py})"><rect x="-29" y="-29" width="58" height="58" rx="6" fill="#43dcff" fill-opacity=".14" stroke="#90f2ff" stroke-width="3" stroke-dasharray="7 4"/></g>`;
 }
 return out;
}
// Move a clone of the genuine SVG tile artwork with the pointer. The draft data
// is untouched until pointerup, so an abandoned drag never alters the board.
function svgPoint(event){
 const svg=$('board-stage').querySelector('svg');if(!svg)return null;
 const matrix=svg.getScreenCTM();if(!matrix)return null;
 const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
 return p.matrixTransform(matrix.inverse());
}
function pickTileArtwork(grab){
 const svg=$('board-stage').querySelector('svg');if(!svg)return null;
 const {selection,from}=grab;
 const position=`(${from.x}, ${from.y})`;
 if(selection.type==='balls'){
  const member=E.draft.balls.find(b=>at(b,from.x,from.y));
  return [...svg.querySelectorAll('g[data-ball]')].find(g=>g.dataset.ball===member?.id)||
   [...svg.querySelectorAll('g[data-ball]')].find(g=>g.getAttribute('aria-label')?.includes(position))||null;
 }
 const match={goals:' goal ',gates:' wall',arrows:' arrow ',switches:' switch',hexes:' score at ',teleports:' teleport '}[selection.type];
 return [...svg.querySelectorAll('g[role="img"]')].find(g=>{
  const label=g.getAttribute('aria-label')||'';
  if(!match||!label.includes(match))return false;
  return label.endsWith(position);
 })||null;
}
function startFloatingDrag(event){
 const grab=E.grab;if(!grab)return;
 const svg=$('board-stage').querySelector('svg');if(!svg)return;
 const original=pickTileArtwork(grab);
 let float;
 if(original){float=original.cloneNode(true);original.style.opacity='.16';}
 else if(grab.selection.type==='walls'){
  float=document.createElementNS('http://www.w3.org/2000/svg','g');
  const r=document.createElementNS('http://www.w3.org/2000/svg','rect');
  r.setAttribute('x','-25');r.setAttribute('y','-25');r.setAttribute('width','50');r.setAttribute('height','50');r.setAttribute('rx','2');r.setAttribute('fill','#687987');r.setAttribute('stroke','#bdccd6');r.setAttribute('stroke-width','2');float.appendChild(r);
 }else return;
 float.removeAttribute('id');float.removeAttribute('role');float.removeAttribute('aria-label');float.removeAttribute('tabindex');
 float.classList.add('editor-floating-tile');float.setAttribute('pointer-events','none');
 svg.appendChild(float);
 E.floatDrag={float,original};
 updateFloatingDrag(event);
}
function updateFloatingDrag(event){
 if(!E.floatDrag)return;
 const pt=svgPoint(event);if(!pt)return;
 E.floatDrag.float.setAttribute('transform',`translate(${pt.x},${pt.y})`);
 const hover=E.grab?.hover;
 const preview=$('board-stage').querySelector('.editor-drag-preview');
 if(preview&&hover){
  const px=18+(hover.x-.5)*64,py=18+(E.draft.height-hover.y+.5)*64;
  preview.setAttribute('transform',`translate(${px},${py})`);
  preview.hidden=false;
 }
}
function clearFloatingDrag(){
 if(E.floatDrag){E.floatDrag.float.remove();if(E.floatDrag.original)E.floatDrag.original.style.opacity='';E.floatDrag=null;}
}
function renderDraft(){
 if(!E.active)return;
 const preview=clone(E.draft);
 for(const c of ['R','G','B','Y']){const members=preview.balls.filter(v=>v.color===c).sort((a,b)=>a.y-b.y||a.x-b.x);members.forEach((b,i)=>{b.id=members.length===1?c:c+(i+1);});}
 const svg=host().svg(preview);
 $('board-stage').innerHTML=svg.replace('</svg>',overlay()+'</svg>');
 $('board-dimensions').textContent=`${E.draft.width} × ${E.draft.height}`;
 $('level-title').textContent=E.draft.title;
 syncJson();
}
function setMode(active){
 if(active===E.active)return;
 if(active){
  host().stop();
  E.draft=clone(host().getBoard());E.fromHost=true;E.history=[];E.future=[];E.selected=null;E.tool='select';E.dirty=false;
  setReview(null,false);
  E.active=true;$('editor-export-code').hidden=true;setStatus('');refresh();renderDraft();
 }else{
  try{
   // The current run (board + route) survives editing until the draft is actually changed:
   // only a draft copied from the running board with an empty undo history resumes it.
   const unchanged=E.fromHost&&!E.history.length;
   const notes=[];
   if(!unchanged)host().play(Core.validateBoard(E.draft,undefined,notes));
   E.active=false;E.selected=null;clearFloatingDrag();refresh();setStatus('');
   if(notes.length)host().toast(notes.join('; '));
   if(unchanged)host().resume();
  }catch(err){setStatus(`Cannot test yet: ${err.message}`,true);$('editor-status').scrollIntoView({block:'nearest'});}
 }
}
function openDraft(draft,problems=[],fromScreenshot=false){
 // Open a board that failed validation for repair; Play stays gated by validateBoard in setMode(false).
 host().stop();
 E.draft=clone(draft);E.fromHost=false;E.history=[];E.future=[];E.selected=null;E.tool='select';E.dirty=true;
 E.active=true;$('editor-export-code').hidden=true;if(!fromScreenshot)setReview(null,false);refresh();
 try{renderDraft();}catch(err){setStatus(`Opened for repair, but the board cannot be drawn: ${err.message}`,true);return;}
 setStatus(problems.length?`This board is not playable yet — fix it, then press Play. ${problems.join(' ')}`:'',problems.length>0);
}
function find(x,y,underBall=false){
 if(!E.draft)return null;
 for(const type of (underBall?['switches','gates','arrows','hexes','goals','walls','teleports']:['balls','switches','gates','arrows','hexes','goals','walls','teleports'])){
  const p=E.draft[type].find(v=>at(v,x,y));if(p)return {type,id:p.id||p._eid||null,x,y};
 }
 return null;
}
function eraseAt(x,y,all=false){
 const b=E.draft;
 if(all){for(const name of keys)b[name]=b[name].filter(v=>!at(v,x,y));return;}
 const found=find(x,y);
 if(!found){if(b.tunnels){const side=E.clickSide,exact=side&&b.tunnels.some(t=>openingAt(t,x,y,side));b.tunnels=b.tunnels.filter(t=>!openingAt(t,x,y,exact?side:null));if(!b.tunnels.length)delete b.tunnels;}return;}
 b[found.type]=b[found.type].filter(p=>!(p.x===x&&p.y===y));
 E.selected=null;
}
function clearFloor(x,y){
 for(const type of ['walls','goals','arrows','gates','switches','teleports','hexes'])E.draft[type]=E.draft[type].filter(v=>!at(v,x,y));
}
function moveObject(start,end,selection){
 if(!selection||same(start,end)||end.x<1||end.y<1||end.x>E.draft.width||end.y>E.draft.height)return false;
 const original=snapshot();
 let item;
  item=E.draft[selection.type].find(v=>same(v,start));
  if(!item)return false;
  if(selection.type==='balls'){
    if(E.draft.balls.some(v=>same(v,end)))return false;
    if(E.draft.walls.some(v=>same(v,end))||E.draft.gates.some(v=>same(v,end)&&v.active))return false;
  }else{
    if(selection.type==='walls'||selection.type==='gates'&&item.active){if(E.draft.balls.some(v=>same(v,end)))return false;}
    clearFloor(end.x,end.y);
  }
  item.x=end.x;item.y=end.y;
 delete E.draft.solution;
 prune(E.draft);
 const changed=remember(original);
 if(changed){E.selected={...selection,x:end.x,y:end.y};renderDraft();refresh();setStatus('Object moved.');}
 return changed;
}
function editAt(x,y,eraser=false){
 if(!E.active||x<1||y<1||x>E.draft.width||y>E.draft.height)return false;
 const b=E.draft,t=eraser?'erase':E.tool;
 if(t==='select') {E.selected=find(x,y,E.preferFloor);refresh();setStatus(E.selected?'':'No object in this cell.');return false;}
 const previous=snapshot();
 if(t!=='select')delete b.solution;
 if(t==='erase') eraseAt(x,y);
 else if(t==='ball') {b.walls=b.walls.filter(p=>!at(p,x,y));b.gates=b.gates.filter(p=>!(p.active&&at(p,x,y)));b.balls=b.balls.filter(p=>!at(p,x,y));b.balls.push({color:E.color,x,y});}
 else if(t==='tunnel'){
  const side=E.clickSide||'r',pend=E.pendingTunnel;
  if(b.walls.some(p=>at(p,x,y))){setStatus('A tunnel opening cannot be in a fixed wall cell.',true);return false;}
  const list=b.tunnels||(b.tunnels=[]),hit=list.findIndex(p=>openingAt(p,x,y,side));
  if(hit>=0){list.splice(hit,1);E.pendingTunnel=null;}
  else if(!pend||(pend.x===x&&pend.y===y&&pend.side===side)){E.pendingTunnel=pend?null:{x,y,side};renderDraft();setStatus(pend?'':`First opening: ${sideNames[side]} side of (${x}, ${y}). Click the partner opening.`);}
  else{list.push({a:{...pend},b:{x,y,side}});E.pendingTunnel=null;}
  if(!list.length)delete b.tunnels;
 }else if(t==='teleport'){
  clearFloor(x,y);
  b.teleports.push({id:nextId(b.teleports,'T'),color:E.color,active:E.activeTile,x,y});
 }else{
  clearFloor(x,y);
  const point={x,y};
  if(t==='wall'){b.walls.push(point);if(b.tunnels){b.tunnels=b.tunnels.filter(p=>!openingAt(p,x,y));if(!b.tunnels.length)delete b.tunnels;}}
  if(t==='goal')b.goals.push({...point,color:E.color});
  if(t==='gate')b.gates.push({...point,id:nextId(b.gates,'G'),active:E.activeTile});
  if(t==='switch')b.switches.push({...point,id:nextId(b.switches,'S'),controls:[],on:false});
  if(t==='arrow')b.arrows.push({...point,direction:E.direction,...(E.rotating?{rotating:true}:{})});
  if(t==='hex')b.hexes.push({...point,id:nextId(b.hexes,'hex'),value:E.hexValue||-5});
 }
 prune(b);
 const changed=previous!==snapshot();
 if(changed){E.dragChanged=true;E.dirty=true;E.selected=null;refresh();renderDraft();setStatus('Draft edited — choose Play to validate and test.');}
 return changed;
}
function applyProperty(key,value){
 const sel=E.selected;if(!sel)return;
 const data=E.draft[sel.type]?.find(v=>v.id&&v.id===sel.id||v.x===sel.x&&v.y===sel.y);
 if(!data)return;
 const prev=snapshot();
 delete E.draft.solution;
 if(key==='Color')data.color=value;
 if(key==='Direction')data.direction=value;
 if(key==='Rotating')data.rotating=value==='true';
 if(key==='Active'){if(sel.type==='switches'){const on=value==='true',same=data.controls.join(',');for(const sw of E.draft.switches)if(sw===data||(same&&sw.controls.join(',')===same)){if(on)sw.on=true;else delete sw.on;}}else data.active=value==='true';}

 if(key==='Gate/Teleport IDs')data.controls=list(value);
 if(key==='Value')data.value=Number(value);
 if(remember(prev)){refresh();renderDraft();setStatus('Property updated.');}
}
function editorUndo(redo=false){
 const from=redo?E.future:E.history,to=redo?E.history:E.future;
 if(!from.length)return;
 to.push(snapshot());E.draft=JSON.parse(from.pop());E.selected=null;refresh();renderDraft();setStatus('');
}
function updateDimensions(){
 const w=Number($('editor-width').value),h=Number($('editor-height').value);
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||w>32||h<1||h>32){setStatus('Grid dimensions must be from 1 to 32.',true);return;}
 const prev=snapshot();E.draft.width=w;E.draft.height=h;
 const inside=p=>p.x<=w&&p.y<=h;
 for(const type of keys)E.draft[type]=E.draft[type].filter(inside);
 if(E.draft.tunnels){E.draft.tunnels=E.draft.tunnels.filter(t=>inside(t.a)&&inside(t.b));if(!E.draft.tunnels.length)delete E.draft.tunnels;}
 prune(E.draft);remember(prev);refresh();renderDraft();setStatus('Grid resized. Out-of-bounds objects were removed.');
}
function newBoard(){setReview(null,false);E.draft=template();E.fromHost=false;E.history=[];E.future=[];E.selected=null;refresh();renderDraft();setStatus('New board.');}
function ensureEditing(){if(!E.active)setMode(true);}
const panel=document.getElementById('editor-panel');
$('edit-mode-button').addEventListener('click',()=>setMode(!E.active));
$('editor-new').addEventListener('click',()=>{ensureEditing();if(E.dirty&&!confirm('Discard the current draft and start a blank board?'))return;newBoard();});
$('editor-save').addEventListener('click',()=>{try{const valid=Core.validateBoard(E.draft);const code=Codec.encodeBoard(valid);const output=$('editor-export-code');output.value=code;output.hidden=false;output.focus();output.select();if(navigator.clipboard?.writeText){navigator.clipboard.writeText(code).then(()=>setStatus('K3 code copied.')).catch(()=>setStatus('Select and copy the K3 code shown below.'));}else setStatus('Select and copy the K3 code shown below.');}catch(err){setStatus(err.message,true);}});
$('editor-undo').addEventListener('click',()=>editorUndo());$('editor-redo').addEventListener('click',()=>editorUndo(true));
$('editor-resize').addEventListener('click',updateDimensions);
$('editor-title').addEventListener('change',event=>{const prev=snapshot();E.draft.title=clean(event.target.value)||'Custom board';E.draft.id=E.draft.title.toLowerCase().replace(/[^a-z0-9_.-]/g,'-').replace(/^-+/,'').slice(0,80)||'custom';remember(prev);renderDraft();refresh();});
$('editor-properties').addEventListener('change',event=>{const key=event.target.dataset.edit;if(key)applyProperty(key,event.target.value);});
$('editor-properties').addEventListener('click',event=>{if(event.target.id==='editor-delete-object'&&E.selected){const prev=snapshot();const s=E.selected;E.draft[s.type]=E.draft[s.type].filter(p=>!at(p,s.x,s.y));prune(E.draft);E.selected=null;remember(prev);refresh();renderDraft();}});
for(const button of panel.querySelectorAll('[data-editor-tool]')) {
 button.draggable=true;
 button.addEventListener('dragstart',event=>{E.tool=button.dataset.editorTool;event.dataTransfer.setData('text/plain',E.tool);event.dataTransfer.effectAllowed='copy';refresh();});
}
panel.addEventListener('click',event=>{
 const t=event.target.closest('[data-editor-tool]');if(t){E.tool=t.dataset.editorTool;refresh();renderDraft();return;}
 const c=event.target.closest('[data-editor-color]');if(c){E.color=c.dataset.editorColor;refresh();return;}
 const w=event.target.closest('[data-editor-wall-color]');if(w&&E.draft){const prev=snapshot();if(w.dataset.editorWallColor==='B')delete E.draft.wallColor;else E.draft.wallColor=w.dataset.editorWallColor;remember(prev);refresh();renderDraft();return;}
 const d=event.target.closest('[data-editor-direction]');if(d){E.direction=d.dataset.editorDirection;refresh();return;}
});
$('editor-hex').addEventListener('change',e=>E.hexValue=Number(e.target.value)||-5);
$('editor-rotating').addEventListener('change',e=>E.rotating=e.target.checked);
$('editor-active').addEventListener('change',e=>E.activeTile=e.target.checked);
function cellAt(event){const el=event.target.closest?.('[data-edit-x]');if(el)return [Number(el.dataset.editX),Number(el.dataset.editY)];const svg=$('board-stage').querySelector('svg');if(!svg)return null;const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;const transform=svg.getScreenCTM();if(!transform)return null;const converted=point.matrixTransform(transform.inverse());const x=Math.floor((converted.x-18)/64)+1,y=E.draft.height-Math.floor((converted.y-18)/64);return [x,y];}
const stage=$('board-stage');
stage.addEventListener('dragover',event=>{if(!E.active)return;event.preventDefault();event.dataTransfer.dropEffect='copy';},true);
stage.addEventListener('drop',event=>{if(!E.active)return;event.preventDefault();event.stopImmediatePropagation();const tool=event.dataTransfer.getData('text/plain');if(tools.includes(tool)){E.tool=tool;refresh();}const loc=cellAt(event);if(!loc)return;E.clickSide=sideOf(event);const prev=snapshot();editAt(loc[0],loc[1]);remember(prev);refresh();},true);
stage.addEventListener('pointerdown',event=>{
 if(!E.active)return;event.stopImmediatePropagation();event.preventDefault();if(event.button!==0&&event.button!==2)return;
 const p=cellAt(event);if(!p)return;E.dragging=true;E.dragChanged=false;E.dragBefore=snapshot();E.lastCell='';stage.setPointerCapture(event.pointerId);
 E.lastCell=p.join(',');E.preferFloor=event.altKey;E.clickSide=sideOf(event);editAt(p[0],p[1],event.button===2);E.grab=E.tool==='select'&&event.button===0&&E.selected?{from:{x:p[0],y:p[1]},selection:E.selected,hover:{x:p[0],y:p[1]}}:null;stage.classList.toggle('editor-grabbing',!!E.grab);stage.classList.remove('editor-grabbable');if(E.grab)startFloatingDrag(event);
},true);
stage.addEventListener('pointermove',event=>{
 if(!E.active||!E.dragging)return;event.stopImmediatePropagation();event.preventDefault();
 const p=cellAt(event);
 if(E.tool==='select'&&E.grab){
  if(p){E.grab.hover={x:p[0],y:p[1]};}
  updateFloatingDrag(event);
  if(!p||p.join(',')===E.lastCell)return;
  E.lastCell=p.join(',');
  let highlight=$('board-stage').querySelector('.editor-drag-preview');
  if(!highlight){
   const svg=$('board-stage').querySelector('svg');
   const g=document.createElementNS('http://www.w3.org/2000/svg','g');
   g.classList.add('editor-drag-preview');g.setAttribute('pointer-events','none');
   g.innerHTML='<rect x="-29" y="-29" width="58" height="58" rx="6" fill="#43dcff" fill-opacity=".13" stroke="#90f2ff" stroke-width="3" stroke-dasharray="7 4"/>';
   svg.insertBefore(g,E.floatDrag?.float||null);
   highlight=g;
  }
  updateFloatingDrag(event);
  return;
 }
 if(!p)return;const k=p.join(',');if(k===E.lastCell)return;E.lastCell=k;
 if(['wall','goal','ball','erase','gate','arrow','hex'].includes(E.tool))editAt(p[0],p[1]);
},true);
stage.addEventListener('pointerup',event=>{
 if(!E.active)return;event.stopImmediatePropagation();if(!E.dragging)return;E.dragging=false;if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);
 if(E.tool==='select'&&E.grab){const dest=cellAt(event);clearFloatingDrag();if(dest)moveObject(E.grab.from,{x:dest[0],y:dest[1]},E.grab.selection);E.grab=null;renderDraft();}
 stage.classList.remove('editor-grabbing');
 if(E.dragChanged)remember(E.dragBefore);refresh();
},true);
stage.addEventListener('pointercancel',()=>{if(E.dragChanged)remember(E.dragBefore);E.dragging=false;clearFloatingDrag();E.grab=null;stage.classList.remove('editor-grabbing');renderDraft();},true);
stage.addEventListener('pointermove',event=>{
 if(!E.active||E.dragging)return;
 const p=cellAt(event);stage.classList.toggle('editor-grabbable',E.tool==='select'&&!!p&&!!find(p[0],p[1],event.altKey));
},true);
stage.addEventListener('pointerleave',()=>stage.classList.remove('editor-grabbable'),true);
stage.addEventListener('click',event=>{if(E.active){event.preventDefault();event.stopImmediatePropagation();}},true);
stage.addEventListener('contextmenu',event=>{if(E.active)event.preventDefault();});
document.addEventListener('keydown',event=>{
 if(!E.active||document.querySelector('dialog[open]'))return;
 const input=event.target.closest('input,textarea,select');if(input)return;
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.stopImmediatePropagation();editorUndo(event.shiftKey);return;}
},true);
$('editor-review-thumb').addEventListener('click',()=>host().showReview());
$('editor-json-toggle').addEventListener('click',()=>{const box=$('editor-json-box'),open=box.hidden;box.hidden=!open;$('editor-json-toggle').setAttribute('aria-expanded',String(open));$('editor-json-toggle').textContent=open?'Hide JSON':'Edit JSON';if(open&&E.draft)$('editor-json').value=JSON.stringify(E.draft,null,2);});
$('editor-json-apply').addEventListener('click',()=>{
 try{
  const notes=[],valid=Core.validateBoard(JSON.parse($('editor-json').value),undefined,notes);
  const prev=snapshot();E.draft=clone(valid);delete E.draft.solution;E.selected=null;remember(prev);
  refresh();renderDraft();setStatus(notes.length?`JSON applied. ${notes.join('; ')}`:'JSON applied.');
 }catch(err){setStatus(`Invalid JSON board: ${err.message}`,true);}
});
window.KunEditor={get active(){return E.active;},render:renderDraft,open:()=>setMode(true),openDraft,setReview};
refresh();
})();
