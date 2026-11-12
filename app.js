/* Kunundrum interface/controller. Engine, codec and catalog load separately. */
'use strict';
(() => {
const {validateBoard,createInitialState,applyMove,isComplete,isAccepted,parseSolution,resolveBallId,formatMove,formatSolution,COLOR_NAMES,DIRECTION_NAMES}=Core;
const {entries:CATALOG_ENTRIES}=Collection;
const {encodeBoard,decodeBoard,decodeRoute,readShareUrl,makeShareUrl}=Codec;


const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const APP_VERSION = '3.3.5'; // Single source of truth; the footer reads it.
const versionLabel = document.getElementById('app-version');
if (versionLabel) versionLabel.textContent = 'v' + APP_VERSION;
const brandLink = document.querySelector('.brand');
if (brandLink) brandLink.title = 'Kunundrum v' + APP_VERSION;
const PALETTE = { R: '#df3047', G: '#39ff24', B: '#6fe8ff', Y: '#fff15c' };
const GLYPHS = { u: '↑', d: '↓', l: '←', r: '→' };
const ICON_PATHS = {
  'arrow-up': '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  'arrow-down': '<path d="M12 5v14m-6-6 6 6 6-6"/>',
  'arrow-left': '<path d="M19 12H5m6-6-6 6 6 6"/>',
  'arrow-right': '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  'arrow-down-left': '<path d="M18 6 6 18m0-9v9h9"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'close': '<path d="m6 6 12 12M6 18 18 6"/>',
  'copy': '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  'share': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.5 6.6-4m-6.6 7 6.6 4"/>',
  'help': '<circle cx="12" cy="12" r="9"/><path d="M9.2 9a3 3 0 0 1 5.6 1.2c0 1.7-2.8 1.8-2.8 3.6M12 17h.01"/>',
  'braces': '<path d="M8 3H6v6l-3 3 3 3v6h2m8-18h2v6l3 3-3 3v6h-2"/>',
  'grid': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18m6-18v18"/>',
  'route': '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h9a4 4 0 0 1 0 8H8a2 2 0 0 0 0 4h9"/>',
  'selection': '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="3"/>',
  'undo': '<path d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 0 12"/>',
  'redo': '<path d="m16 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
  'reset': '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  'play': '<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke-width="1.5"/>',
  'pause': '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  'play-circle': '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4Z"/>',
  'step-back': '<path d="m15 5-7 7 7 7" stroke-width="2.4"/>',
  'step-forward': '<path d="m9 5 7 7-7 7" stroke-width="2.4"/>',
  'skip-first': '<path d="M6 5v14M18 5l-7 7 7 7" stroke-width="2.4"/>',
  'skip-last': '<path d="M18 5v14M6 5l7 7-7 7" stroke-width="2.4"/>',
  'save': '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 21v-8h10v8M7 3v5h8"/>',
  'check': '<path d="m5 12 4 4L19 6"/>',
  'edit': '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`; }
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
hydrateIcons();

function initCompactLayout() {
  const header = document.querySelector('.site-header');
  const stage = $('board-stage');
  const panel = stage?.closest('.board-panel');
  const bottom = panel?.querySelector('.board-bottom');
  if (!header || !stage || !panel || !bottom) return;
  let resizeFrame = 0;
  const pixels = value => Number.parseFloat(value) || 0;
  function fitBoardToViewport() {
    resizeFrame = 0;
    const svg = stage.querySelector(':scope > .board-svg');
    if (!svg) return;
    const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) return;
    const stageStyle = getComputedStyle(stage);
    const panelStyle = getComputedStyle(panel);
    const availableWidth = Math.max(1, stage.clientWidth - pixels(stageStyle.paddingLeft) - pixels(stageStyle.paddingRight));
    const viewportHeight = Math.min(window.innerHeight, window.visualViewport?.height || window.innerHeight);
    // Use document coordinates so scrolling never changes the board's fitted size.
    const panelTop = panel.getBoundingClientRect().top + window.scrollY;
    const availableHeight = Math.max(1, viewportHeight - panelTop - bottom.getBoundingClientRect().height
      - pixels(panelStyle.borderTopWidth) - pixels(panelStyle.borderBottomWidth) - pixels(stageStyle.paddingTop) - pixels(stageStyle.paddingBottom) - 8);
    const scale = Math.min(availableWidth / viewBox[2], availableHeight / viewBox[3]);
    for (const [property, value] of [['--board-fit-width', Math.floor(viewBox[2] * scale)], ['--board-fit-height', Math.floor(viewBox[3] * scale)]]) {
      const next = `${Math.max(1, value)}px`;
      if (stage.style.getPropertyValue(property) !== next) stage.style.setProperty(property, next);
    }
  }
  function scheduleBoardFit() {
    if (!resizeFrame) resizeFrame = requestAnimationFrame(fitBoardToViewport);
  }
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleBoardFit);
    [header, panel, bottom].forEach(element => observer.observe(element));
  }
  if (typeof MutationObserver !== 'undefined') new MutationObserver(scheduleBoardFit).observe(stage, { childList:true });
  window.addEventListener('resize', scheduleBoardFit);
  window.visualViewport?.addEventListener('resize', scheduleBoardFit);
  scheduleBoardFit();
}
initCompactLayout();

function renderHelpIcons() {
  const sample = validateBoard({
    version:1, id:'help-symbols', title:'Help symbols', width:6, height:2,
    balls:[{color:'B',x:1,y:1}], goals:[{color:'B',x:1,y:2}],
    arrows:[{x:2,y:1,direction:'r'}],
    switches:[{id:'S',x:3,y:1,wallGroups:[],teleportIds:['T']}],
    teleports:[{id:'T',color:'B',ends:[{x:4,y:1},{x:4,y:2}],active:true}],
    hexes:[{id:'minus',x:5,y:1,value:-5}],
  });
  const source = renderSvg(sample, createInitialState(sample), {mini:true});
  const defs = source.match(/<defs>[\s\S]*?<\/defs>/)?.[0] || '';
  function feature(label) {
    for (const match of source.matchAll(/<g\b[^>]*role="img"[^>]*aria-label="([^"]*)"[^>]*>/g)) {
      if (!label.test(match[1])) continue;
      const tags = /<\/?g\b[^>]*>/g;
      tags.lastIndex = match.index;
      let depth = 0, tag;
      while ((tag = tags.exec(source))) {
        depth += tag[0].startsWith('</') ? -1 : 1;
        if (depth === 0) return source.slice(match.index, tags.lastIndex)
          .replace(/\srole="img"/, '')
          .replace(/\saria-label="[^"]*"/, '')
          .replace(/\stransform="translate\([^"]+\)"/, '');
      }
    }
    return '';
  }
  const frame = (body, viewBox = '-32 -32 64 64') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="40" height="40" aria-hidden="true" focusable="false" style="display:block;width:40px;height:40px;max-width:none;flex:0 0 40px;overflow:visible">${body}</svg>`;
  const icons = [
    ['goal', / goal /],
    ['arrow', /^Fixed arrow /],
    ['switch', /^Off switch/],
    ['teleport', /^Active Blue teleport\./],
    ['hex', /^One-use -5 score /],
  ].map(([name, label]) => frame(
    (defs + feature(label)).replaceAll('preview-help-symbols-', `help-rule-${name}-`),
    name === 'arrow' ? '-24 -24 48 48' : undefined,
  ));
  icons.push(frame(`<g fill="none" stroke="${PALETTE.Y}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS.undo}</g>`, '-2 -2 28 28'));
  return icons;
}

function initHelpIcons() {
  const symbols = document.querySelectorAll('#help-dialog .rule-symbol');
  if (!symbols.length) return;
  const icons = renderHelpIcons();
  symbols.forEach((symbol, index) => {
    if (!icons[index]) return;
    Object.assign(symbol.style, {width:'40px', minWidth:'40px', height:'40px', flex:'0 0 40px', paddingTop:'0', fontSize:'0', alignItems:'center'});
    symbol.setAttribute('aria-hidden', 'true');
    symbol.innerHTML = icons[index];
  });
}

const LEVELS = CATALOG_ENTRIES.map(({id,code}) => {
  const level = decodeBoard(code);
  if (level.id !== id) throw new Error(`Level ${id} in levels.js contains board ${level.id}; update the ID or code.`);
  return level;
});
const OFFLINE = location.protocol === 'file:';
const STORAGE_KEY = 'kunundrum.replay.v1';
const BEST_KEY = 'kunundrum.best.v1';
const MAX_REPLAY_MOVES = 2000;
const MAX_ROUTE_CHARACTERS = 10000;
let board = LEVELS[0];
let frames = [{ state: createInitialState(board), path: [], record: null, events: [] }];
let cursor = 0;
let selected = 'R';
let busy = false;
let isPlaying = false;
let mode = 'manual';
let pendingMove = null;
let animationEpoch = 0;
let playEpoch = 0;
let toastTimer;
let dataTab = 'code';
let shareRun = false;
let bestScores = {};
let settings = { coordinates: false, trail: false, outline: false, speed: 1, viewDefaultsVersion: 1, outlineDefaultsVersion: 1 };
let viewSettingsInitialized = false;
let storageAvailable = true;
let currentPresetId = board.id;
const state = () => frames[cursor].state;
const padNumber = n => n < 0 ? String(n) : String(n).padStart(2, '0');
const pos = p => `(${p.x}, ${p.y})`;
initHelpIcons();

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').className = `toast visible${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => { $('toast').className = 'toast'; }, error ? 6500 : 3500);
}
function showError(id, message = '') {
  $(id).textContent = message;
  $(id).hidden = !message;
}
function stopPlayback() { isPlaying = false; playEpoch++; renderControls(); }
function cancelMotion() { animationEpoch++; busy = false; pendingMove = null; stopPlayback(); }
function getNotation(end = frames.length - 1) { return formatSolution(frames.slice(1, end + 1).map(frame => frame.record)); }
function initialFrame(nextBoard) { return { state: createInitialState(nextBoard), path: [], record: null, events: [] }; }

function buildReplay(nextBoard, notation) {
  const tokens = parseSolution(notation);
  if (tokens.length > MAX_REPLAY_MOVES) throw new Error(`A replay can contain at most ${MAX_REPLAY_MOVES.toLocaleString()} slides.`);
  if (!tokens.length) throw new Error('Enter a solution string first, for example Rur,G3ld,Bu.');
  const result = [initialFrame(nextBoard)];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    try {
      const previous = result[result.length - 1].state;
      const id = resolveBallId(previous, token.identifier);
      const move = applyMove(previous, nextBoard, id, token.direction, token.choices);
      if (move.kind === 'choose-direction') throw new Error(`Add a (->u), (->d), (->l), or (->r) choice for the rotating arrow at ${pos(move.position)}.`);
      if (move.kind !== 'ok') throw new Error(move.message);
      result.push(move);
    } catch (error) { throw new Error(`Move ${i + 1} (${token.identifier}${token.direction}): ${error.message}`); }
  }
  if (formatSolution(result.slice(1).map(frame => frame.record)).length > MAX_ROUTE_CHARACTERS) throw new Error('The expanded route exceeds 10,000 characters. Shorten it before loading.');
  return result;
}

function adoptBoard(nextBoard, replayFrames, at = 0, resetInput = true) {
  // Validate the whole candidate before replacing the user's current run.
  const normalized = validateBoard(nextBoard);
  const code = encodeBoard(normalized);
  const preset = LEVELS.find(level => encodeBoard(level) === code)?.id || null;
  const nextFrames = replayFrames || [initialFrame(normalized)];
  cancelMotion();
  board = normalized;
  frames = nextFrames;
  cursor = Math.min(Math.max(0, at), frames.length - 1);
  selected = (cursor > 0 ? frames[cursor].record?.ballId : null) || state().balls.find(ball => !ball.locked)?.id || state().balls[0].id;
  mode = replayFrames ? 'replay' : 'manual';
  currentPresetId = preset;
  if (resetInput) $('solution-input').value = replayFrames ? getNotation() : '';
  showError('replay-error');
  document.title = `${board.title} · Kunundrum`;
  render();
  persist();
}

function persist() {
  try {
    const records = getNotation();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ board: encodeBoard(board), moves: records, at: cursor, selected, mode, settings, draft: $('solution-input').value }));
    if (isAccepted(state()) && currentPresetId) {
      const previous = bestScores[currentPresetId];
      if (!previous || state().score < previous.score || state().score === previous.score && state().slides < previous.slides) {
        bestScores[currentPresetId] = { score: state().score, slides: state().slides };
        localStorage.setItem(BEST_KEY, JSON.stringify(bestScores));
      }
    }
    storageAvailable = true;
  } catch { storageAvailable = false; }
  // Persistence remains active; there is no visible save-status note.
}

function mappingLabels(b) {
  const labels={switches:new Map(),gates:new Map(),teleports:new Map()};
  const groups=new Map(),switchGroups=new Map();
  const switches=[...b.switches].sort((a,z)=>a.y-z.y||a.x-z.x||(a.id<z.id?-1:a.id>z.id?1:0));
  for(const sw of switches){
    const gateIds=b.gates.filter(gate=>sw.wallGroups.includes(gate.group)).map(gate=>gate.id).sort();
    const teleportIds=[...new Set(sw.teleportIds)].sort();
    if(!gateIds.length&&!teleportIds.length)continue;
    const key=JSON.stringify([gateIds,teleportIds]);
    if(!groups.has(key))groups.set(key,{number:groups.size+1,gateIds,teleportIds});
    switchGroups.set(sw.id,groups.get(key).number);
  }
  // Numbers explain different control mappings, not individual tile IDs.
  if(groups.size<2)return labels;
  for(const [id,number] of switchGroups)labels.switches.set(id,String(number));
  for(const group of groups.values()){
    for(const [kind,ids] of [['gates',group.gateIds],['teleports',group.teleportIds]]){
      for(const id of ids){
        const previous=labels[kind].get(id);
        labels[kind].set(id,previous?`${previous}, ${group.number}`:String(group.number));
      }
    }
  }
  return labels;
}

function renderSvg(b, s, options = {}) {
  const mini = !!options.mini;
  const coordinates = !mini && settings.coordinates;
  const cell = 64;
  const pad = coordinates ? 35 : mini ? 10 : 18;
  const width = b.width * cell + pad * 2;
  const height = b.height * cell + pad * 2;
  const prefix = mini ? `preview-${b.id.replace(/[^a-zA-Z0-9]/g, '-')}` : 'main';
  const xy = p => ({ x: pad + (p.x - .5) * cell, y: pad + (b.height - p.y + .5) * cell });
  const wallKeys = new Set(b.walls.map(p => `${p.x},${p.y}`));
  const floor = (x, y) => x >= 1 && x <= b.width && y >= 1 && y <= b.height && !wallKeys.has(`${x},${y}`);
  const dockedGoalColors = new Map(b.goals
    .filter(goal => s.balls.some(ball => ball.locked && ball.color === goal.color && ball.x === goal.x && ball.y === goal.y))
    .map(goal => [`${goal.x},${goal.y}`, PALETTE[goal.color]]));
  const labels = mappingLabels(b);
  let svg = `<svg class="board-svg" viewBox="0 0 ${width} ${height}" ${mini ? 'aria-hidden="true"' : `role="group" aria-label="${escape(b.title)}. ${b.width} columns by ${b.height} rows. Arrow keys slide. Shift plus arrow keys select another ball."`} xmlns="http://www.w3.org/2000/svg"><defs>`;
  for (const [color, value] of Object.entries(PALETTE)) {
    svg += `<radialGradient id="${prefix}-orb-${color}" cx="35%" cy="28%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".28" stop-color="${value}"/><stop offset="1" stop-color="${value}" stop-opacity=".73"/></radialGradient>`;
  }
  svg += `<filter id="${prefix}-glow" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="3"/></filter>`;
  svg += `<filter id="${prefix}-orb-aura" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="8"/></filter>`;
  svg += `<pattern id="${prefix}-floor" x="${pad}" y="${pad}" width="${cell}" height="${cell}" patternUnits="userSpaceOnUse"><rect width="64" height="64" fill="#040e15"/><path d="M16 0V64M32 0V64M48 0V64M0 16H64M0 32H64M0 48H64" fill="none" stroke="#0d2c3c" stroke-width=".8"/></pattern>`;
  svg += `<radialGradient id="${prefix}-switch-rim" cx="38%" cy="25%" r="78%"><stop offset="0" stop-color="#527d91"/><stop offset=".5" stop-color="#1b3e50"/><stop offset="1" stop-color="#030b11"/></radialGradient><linearGradient id="${prefix}-switch-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8b91"/><stop offset=".42" stop-color="#f92430"/><stop offset=".55" stop-color="#eb000e"/><stop offset="1" stop-color="#99000a"/></linearGradient><linearGradient id="${prefix}-switch-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
  svg += `<radialGradient id="${prefix}-switch-green" cx="45%" cy="38%" r="66%"><stop offset="0" stop-color="#c2ff25"/><stop offset=".43" stop-color="#8be500"/><stop offset=".76" stop-color="#4c8e09"/><stop offset="1" stop-color="#1c3e09"/></radialGradient>`;
  svg += `<linearGradient id="${prefix}-gate-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5f666f"/><stop offset=".48" stop-color="#4b525b"/><stop offset="1" stop-color="#373e46"/></linearGradient><pattern id="${prefix}-gate-texture" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M-1 1L1-1M0 4L4 0M3 5L5 3" stroke="#121a23" stroke-opacity=".28" stroke-width=".7"/></pattern>`;
  svg += `<pattern id="${prefix}-gate" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#ffe34d"/><rect width="4" height="10" fill="#4b4829"/></pattern></defs>`;
  svg += `<rect x="${pad}" y="${pad}" width="${b.width * cell}" height="${b.height * cell}" rx="5" fill="#02080c"/>`;
  let boundary = '';
  for (let y = 1; y <= b.height; y++) for (let x = 1; x <= b.width; x++) {
    if (!floor(x, y)) continue;
    const px = pad + (x - 1) * cell, py = pad + (b.height - y) * cell;
    svg += `<rect class="grid-cell" x="${px}" y="${py}" width="${cell}" height="${cell}" style="fill:url(#${prefix}-floor);stroke:#16465b;stroke-width:.8"/>`;
    const dockedColor = dockedGoalColors.get(`${x},${y}`);
    if (dockedColor) svg += `<rect class="docked-goal-cell" x="${px}" y="${py}" width="${cell}" height="${cell}" fill="${dockedColor}" fill-opacity=".22" pointer-events="none"/>`;
    for (const [dx, dy, x1, y1, x2, y2] of [[-1,0,px,py,px,py+cell],[1,0,px+cell,py,px+cell,py+cell],[0,1,px,py,px+cell,py],[0,-1,px,py+cell,px+cell,py+cell]]) {
      if (!floor(x+dx,y+dy)) boundary += `M${x1} ${y1}L${x2} ${y2}`;
    }
  }
  svg += `<g fill="none" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"><path d="${boundary}" stroke="#00d5ed" stroke-width="9" opacity=".65" filter="url(#${prefix}-glow)"/><path d="${boundary}" stroke="#29d9f2" stroke-width="4.5"/><path d="${boundary}" stroke="#d0fbff" stroke-width="1.9"/></g>`;
  if (coordinates) {
    for (let x=1;x<=b.width;x++) svg += `<text class="coord-label" x="${xy({x,y:1}).x}" y="${height-10}" text-anchor="middle" fill="#8296a4" font-size="11">${x}</text>`;
    for (let y=1;y<=b.height;y++) svg += `<text class="coord-label" x="15" y="${xy({x:1,y}).y+4}" text-anchor="middle" fill="#8296a4" font-size="11">${y}</text>`;
  }
  for (const goal of b.goals) {
    const p=xy(goal), color=PALETTE[goal.color];
    svg += `<g role="img" aria-label="${COLOR_NAMES[goal.color]} goal ${pos(goal)}" transform="translate(${p.x},${p.y})"><g fill="none" stroke="${color}" stroke-width="5" opacity=".8" filter="url(#${prefix}-glow)"><circle r="22.5"/><circle r="9"/></g><circle r="22.5" fill="${color}" fill-opacity=".035" stroke="${color}" stroke-width="3.4"/><circle r="22.5" fill="none" stroke="#fff" stroke-width=".9" stroke-opacity=".6"/><circle r="9" fill="none" stroke="${color}" stroke-width="2.3"/></g>`;
  }
  for (const gate of b.gates) {
    const p=xy(gate), on=s.gateActive[gate.id], label=labels.gates.get(gate.id);
    const inset=on?21:25;
    svg += `<g role="img" aria-label="${on?'Active':'Inactive'} wall${label?' · control group '+label:''} ${pos(gate)}" transform="translate(${p.x},${p.y})">${on?`<rect x="-27" y="-27" width="54" height="54" rx="2" fill="none" stroke="#ffe85c" stroke-width="7" opacity=".25" filter="url(#${prefix}-glow)"/><rect class="gate-on" x="-27" y="-27" width="54" height="54" rx="2" fill="url(#${prefix}-gate)" stroke="#fff174" style="stroke-width:3.8"/>`:''}<rect class="${on?'gate-face':'gate-off'}" x="${-inset}" y="${-inset}" width="${inset*2}" height="${inset*2}" rx="1.5" fill="url(#${prefix}-gate-metal)" stroke="${on?'#b6aa45':'#77818c'}" style="opacity:1;stroke-dasharray:none;stroke-width:1.1"/><rect x="${1-inset}" y="${1-inset}" width="${inset*2-2}" height="${inset*2-2}" rx="1" fill="url(#${prefix}-gate-texture)"/><path d="M0 ${2-inset}V${inset-2}M${2-inset} 0H${inset-2}" fill="none" stroke="#242c34" stroke-width="2"/><path d="M2 ${2-inset}V${inset-2}M${2-inset} 2H${inset-2}" fill="none" stroke="#89939d" stroke-opacity=".32" stroke-width=".8"/>${label?`<text class="tile-label" x="0" y="0" dominant-baseline="central" fill="${on?'#fff1b8':'#dbe2e8'}" style="font-size:${label.length>4?10:14}px;font-weight:700;paint-order:stroke;stroke:#1c252e;stroke-width:3;stroke-linejoin:round">${label}</text>`:''}</g>`;
  }
  for (const arrow of b.arrows) {
    const p=xy(arrow), degrees={r:0,d:90,l:180,u:270}[arrow.direction], color=arrow.rotating?'#fa7187':'#99aebb';
    svg += `<g role="img" aria-label="${arrow.rotating?'Rotating':'Fixed'} arrow ${DIRECTION_NAMES[arrow.direction]} ${pos(arrow)}" transform="translate(${p.x},${p.y})">${arrow.rotating?`<circle r="23" fill="none" stroke="${color}" stroke-opacity=".3" stroke-dasharray="3 5"/>`:''}<g transform="rotate(${degrees})"><g class="${arrow.rotating?'rotating-arrow':''}"><path d="M-13-12-1 0-13 12M0-12 12 0 0 12" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g></g></g>`;
  }
  for (const teleport of b.teleports) for (const end of teleport.ends) {
    const p=xy(end), on=s.teleportActive[teleport.id], universal=teleport.color==='*';
    const color=on?(universal?'#c6cdd3':PALETTE[teleport.color]):'#73808a';
    const name=universal?'universal':COLOR_NAMES[teleport.color];
    const dash=2*Math.PI*23/12;
    svg += `<g role="img" aria-label="${on?'Active':'Inactive'} ${name} teleport. Links ${pos(teleport.ends[0])} and ${pos(teleport.ends[1])}." transform="translate(${p.x},${p.y})">${on?`<g fill="none" stroke="${color}" opacity=".85" filter="url(#${prefix}-glow)"><circle r="23" stroke-width="6" stroke-dasharray="${dash*.6} ${dash*1.4}"/><circle r="14" stroke-width="3"/></g>`:''}<circle r="23" fill="${color}" fill-opacity=".04" stroke="${color}" stroke-width="${on?2.8:1.8}" stroke-dasharray="${dash*.6} ${dash*.4}" stroke-linecap="round" stroke-opacity="${on?'.95':'.6'}"/>${on?`<circle r="23" fill="none" stroke="#f4ffff" stroke-width="1.3" stroke-dasharray="${dash*.6} ${dash*1.4}" stroke-linecap="round"/>`:''}<circle r="14" fill="#07151f" stroke="${color}" stroke-width="2" stroke-opacity="${on?'.9':'.55'}"/>${on?`<circle r="4.5" fill="#fff" opacity=".65" filter="url(#${prefix}-glow)"/>`:''}<circle r="3.8" fill="#fff" opacity="${on?'1':'.65'}"/></g>`;
  }
  for (const sw of b.switches) {
    const p=xy(sw), label=labels.switches.get(sw.id), on=s.switchOn?.[sw.id]??sw.on??false;
    svg += `<g role="img" aria-label="${on?'On':'Off'} switch${label?' · control group '+label:''} ${pos(sw)}" transform="translate(${p.x},${p.y})"><circle r="24" fill="url(#${prefix}-switch-rim)" stroke="#123345" stroke-width="1.5"/>${on?`<circle r="18" fill="#97ee10" opacity=".35" filter="url(#${prefix}-glow)"/>`:''}<circle cy="-.5" r="20.5" fill="url(#${prefix}-switch-${on?'green':'red'})" stroke="${on?'#254d0b':'#750714'}" stroke-width="1.4"/><path d="M-17-5C-15-24 15-24 17-5C8-9-8-9-17-5Z" fill="url(#${prefix}-switch-shine)" opacity="${on?'.18':'1'}"/>${label?`<text class="tile-label" x="0" y="0" dominant-baseline="central" fill="#fff9f4" style="font-size:14px;font-weight:700;paint-order:stroke;stroke:${on?'#214908':'#69000c'};stroke-width:2.5;stroke-linejoin:round">${label}</text>`:''}</g>`;
  }
  for (const hex of b.hexes) {
    if(s.consumedHexIds.includes(hex.id)) continue;
    const p=xy(hex), color=hex.value<0?'#177e0a':'#a91918', rim=hex.value<0?'#64ef24':'#ff3c35';
    const points='23,0 11.5,20 -11.5,20 -23,0 -11.5,-20 11.5,-20';
    svg += `<g role="img" aria-label="One-use ${hex.value>0?'+':''}${hex.value} score at ${pos(hex)}" transform="translate(${p.x},${p.y})"><polygon points="${points}" fill="none" stroke="${rim}" stroke-width="4" opacity=".6" filter="url(#${prefix}-glow)"/><polygon points="${points}" fill="${color}" stroke="${rim}" stroke-width="1.8"/><polygon points="${points}" transform="scale(.8)" fill="none" stroke="${rim}" stroke-width="1" stroke-opacity=".45"/><text text-anchor="middle" x="0" y="0" dominant-baseline="central" font-size="14" font-family="monospace" font-weight="700" fill="#fff" style="paint-order:stroke;stroke:${hex.value<0?'#12300b':'#3d0b0b'};stroke-width:2.5;stroke-linejoin:round">${hex.value>0?'+':'−'}${Math.abs(hex.value)}</text></g>`;
  }
  const trace = !mini && settings.trail ? options.trace : null;
  if (trace?.path?.length>1) {
    const color = PALETTE[trace.record?.ballId[0]] || '#b7efd8';
    for(let i=1;i<trace.path.length;i++) {
      const a=xy(trace.path[i-1]), z=xy(trace.path[i]);
      const teleportStep = Boolean(trace.path[i].teleport);
      const trailClass = `trail-line${teleportStep?' teleport-step':''}`;
      const dash = teleportStep ? ' stroke-dasharray="5 5"' : '';
      svg += `<line x1="${a.x}" y1="${a.y}" x2="${z.x}" y2="${z.y}" stroke="${color}" stroke-width="9" stroke-opacity=".72" filter="url(#${prefix}-glow)" pointer-events="none"${dash}/><line class="${trailClass}" x1="${a.x}" y1="${a.y}" x2="${z.x}" y2="${z.y}" stroke="${color}" stroke-opacity="${teleportStep?'.8':'1'}" stroke-width="3.8" stroke-linecap="round"${dash}/><line x1="${a.x}" y1="${a.y}" x2="${z.x}" y2="${z.y}" stroke="#ffffff" stroke-opacity="${teleportStep?'.26':'.56'}" stroke-width="1.15" stroke-linecap="round" pointer-events="none"${dash}/>`;
    }
    const a=xy(trace.path[0]);
    svg += `<circle cx="${a.x}" cy="${a.y}" r="5" fill="#051019" stroke="${color}" stroke-width="2.5"/><circle cx="${a.x}" cy="${a.y}" r="2.2" fill="#fff"/>`;
  }
  for (const ball of s.balls) {
    const p=xy(ball), color=PALETTE[ball.color], active=!mini && settings.outline && options.outlinedBallId===ball.id;
    const number=b.balls.filter(original=>original.color===ball.color).length>1?ball.id.slice(1):'';
    const numberSize=number.length===1?14:number.length===2?12:10;
    svg += `<g ${mini?'':`id="ball-${ball.id}" data-ball="${ball.id}" role="button" tabindex="${ball.locked?-1:0}" aria-disabled="${ball.locked}" aria-label="${COLOR_NAMES[ball.color]} ${ball.id}, ${pos(ball)}${ball.locked?', docked':', select ball'}"`} class="ball-hit${ball.locked?' locked':''}" style="outline:none;filter:none" transform="translate(${p.x},${p.y})"><circle r="31" fill="transparent"/>${active?`<circle class="selected-ring selected-glow" r="28" fill="none" stroke="${color}" stroke-width="6.5" stroke-opacity=".65" filter="url(#${prefix}-glow)"/><circle class="selected-ring selected-dash" r="27.5" fill="none" stroke="#f5ffff" stroke-width="3" stroke-opacity=".98" stroke-dasharray="5 4"/><circle class="selected-ring selected-inner" r="23.5" fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity=".95" stroke-dasharray="5 4"/>`:''}<circle r="27" fill="${color}" opacity="${ball.locked?'.24':'.58'}" filter="url(#${prefix}-orb-aura)" pointer-events="none"/><circle r="20" fill="${color}" opacity="${ball.locked?'.22':'.48'}" filter="url(#${prefix}-glow)" pointer-events="none"/><circle r="19" fill="${color}" opacity=".16" pointer-events="none"/><circle r="16" fill="none" stroke="${color}" stroke-opacity=".48" stroke-width="1.5" pointer-events="none"/><circle class="orb-core" r="${ball.locked?13:15}" fill="url(#${prefix}-orb-${ball.color})" style="stroke:${color};stroke-width:1"/>${number?`<text class="ball-number" x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="monospace" font-size="${numberSize}" font-weight="700" fill="#fff" aria-hidden="true" pointer-events="none" style="paint-order:stroke;stroke:#08131b;stroke-width:2.5;stroke-linejoin:round">${number}</text>`:ball.locked?'<path d="m-6 0 4 4 8-8" fill="none" stroke="#10202a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>':''}</g>`;
  }
  return svg+'</svg>';
}

function renderBoard(trace = frames[cursor]) {
  // Outline follows the current control selection. Trail remains the last move.
  const outlinedBallId = selected;
  if(window.KunEditor?.active){window.KunEditor.render();return;}
  $('board-stage').innerHTML = renderSvg(board,state(),{outlinedBallId,trace});
}
function renderMeta() {
  $('level-title').textContent=board.title;
  $('board-dimensions').textContent=`${board.width} × ${board.height}`;
  $('score-value').textContent=padNumber(state().score);
  const docked=state().balls.filter(ball=>ball.locked).length;
  $('docked-value').innerHTML=`${docked}<span>/${state().balls.length}</span>`;
  const completed=$('completion-inline');
  completed.textContent=isComplete(state())?(isAccepted(state())?'Complete':'Complete · score ≤ 0 is not accepted') : '';
  completed.className=`completion-inline${isComplete(state())?isAccepted(state())?' done':' unaccepted':''}`;
  $('board-hint').innerHTML=isComplete(state())?(isAccepted(state())?'':'The original game requires score ≥ 1.'):(busy||isPlaying?'Moving...':`<span class="mouse-mini" aria-hidden="true"></span><span aria-hidden="true">/</span>Arrow keys: move`);
}
function updateResetControl() {
  $('reset').disabled=isPlaying||(!busy&&!pendingMove&&frames.length===1&&cursor===0&&!$('solution-input').value);
}
function renderControls() {
  const current=state();
  const ball=current.balls.find(b=>b.id===selected);
  const playbackLocked=busy||isPlaying;
  const routeComplete=frames.length>1&&isComplete(frames[frames.length-1].state);
  $('selected-name').textContent=ball?`${COLOR_NAMES[ball.color]}${ball.id.length>1?' '+ball.id.slice(1):''}${ball.locked?' docked':' selected'}`:'All balls docked';
  $('selected-position').textContent=ball?pos(ball):'';
  $('sel-dot').style.setProperty('--ball-color',ball?PALETTE[ball.color]:'#73808a');
  $('undo').disabled=playbackLocked||cursor===0||cursor!==frames.length-1;
  updateResetControl();
  for (const id of ['open-levels','open-help','open-board-data','open-share','toggle-coords','toggle-trace']) $(id).disabled=isPlaying;
  $('replay-first').disabled=playbackLocked||cursor===0;
  $('replay-back').disabled=playbackLocked||cursor===0;
  $('replay-next').disabled=playbackLocked||cursor>=frames.length-1;
  $('replay-last').disabled=playbackLocked||cursor>=frames.length-1;
  $('replay-play').disabled=!isPlaying&&(busy||!routeComplete);
  { const playBtn=$('replay-play'), want=isPlaying?'pause':'play'; if(playBtn.dataset.icon!==want){ playBtn.dataset.icon=want; playBtn.innerHTML=icon(want); } }
  $('replay-play').title = `${isPlaying?'Pause':isComplete(current)?'Replay again':'Autoplay route'} (Space)`;
  $('replay-play').setAttribute('aria-label', $('replay-play').title);
  $('replay-speed').disabled=isPlaying;
  $('replay-speed').value=String(settings.speed);
  $('replay-badge').textContent=isPlaying?'PLAYING':frames.length>1?`${cursor} / ${frames.length-1}`:'NO ROUTE';
  $('load-solution').disabled=playbackLocked;
  $('use-example').disabled=playbackLocked||!board.solution;
  $('solution-input').disabled=isPlaying;
  $('use-example').title=board.solution?'Load the saved solution from the start':'No saved solution for this board.';
  for(const [id,on] of [['toggle-coords',settings.coordinates],['toggle-outline',settings.outline],['toggle-trace',settings.trail]]) {$(id).classList.toggle('active',on);$(id).setAttribute('aria-pressed',String(on));}
}
function revealActiveMove() {
  const box=$('move-history');
  if(cursor===0){box.scrollTop=0;return;}
  const active=box.querySelector('.active');
  if(!active)return;
  const b=box.getBoundingClientRect(), a=active.getBoundingClientRect(), pad=8;
  if(a.top<b.top+pad) box.scrollTop-= (b.top+pad)-a.top;
  else if(a.bottom>b.bottom-pad) box.scrollTop+= a.bottom-(b.bottom-pad);
}
function renderHistory() {
  const count=frames.length-1;
  if ($('cursor-label')) $('cursor-label').textContent=cursor?`Move ${cursor} of ${count} · score ${state().score}`:'At the start';
  if(!count) {
    $('move-history').innerHTML='<div class="history-empty"><span>No moves.</span></div>';
    return;
  }
  const keepScroll=$('move-history').scrollTop;
  $('move-history').innerHTML=frames.slice(1).map((frame,index)=>{
    const n=index+1,record=frame.record,adjustment=record.scoreDelta-1;
    return `<button class="history-chip${n===cursor?' active':''}" data-jump="${n}" style="--ball-color:${PALETTE[record.ballId[0]]}" title="Move ${n}: ${escape(formatMove(record))}. Score ${frame.state.score}. ${escape(frame.events.join(' '))}" aria-label="Go to move ${n}: ${escape(formatMove(record))}, score ${frame.state.score}" ${n===cursor?'aria-current="step"':''}><span class="move-number">${n}</span><span class="move-code">${record.ballId}${GLYPHS[record.direction]}${record.choices.map(d=>`<small>↱${GLYPHS[d]}</small>`).join('')}</span>${adjustment?`<span class="score-adjust">${adjustment>0?'+':'−'}${Math.abs(adjustment)}</span>`:''}</button>`;
  }).join('');
  $('move-history').scrollTop=keepScroll;
  revealActiveMove();
}
function render() {renderMeta();renderBoard();renderControls();renderHistory();}

function selectBall(id) {
  const ball=state().balls.find(ball=>ball.id===id);
  if(busy||isPlaying||!ball||ball.locked)return;
  stopPlayback(); selected=id; renderBoard();renderControls();persist();
}

function ballInDirection(balls,selectedId,direction,width,height) {
  const vector={u:[0,1],d:[0,-1],l:[-1,0],r:[1,0]}[direction];
  const available=balls.filter(ball=>!ball.locked);
  if(!vector||available.length<2)return null;
  const origin=balls.find(ball=>ball.id===selectedId);
  if(!origin)return available[0].id;
  const [vx,vy]=vector;
  const candidates=available.filter(ball=>ball.id!==selectedId).map(ball=>({
    id:ball.id,dx:ball.x-origin.x,dy:ball.y-origin.y,
  }));
  let targets=candidates.filter(ball=>ball.dx*vx+ball.dy*vy>0);
  // If nothing lies ahead, look across that board edge. Selection can always
  // reach another movable ball, even when all balls share a row or column.
  if(!targets.length)targets=candidates.map(ball=>({...ball,dx:ball.dx+vx*width,dy:ball.dy+vy*height}));
  // Prefer the same row or column, then the closest parallel row or column.
  // Within that alignment, select the nearest ball in the chosen direction.
  targets.sort((a,b)=>
    Math.abs(a.dx*vy-a.dy*vx)-Math.abs(b.dx*vy-b.dy*vx)
    ||(a.dx*vx+a.dy*vy)-(b.dx*vx+b.dy*vy)
    ||(a.id<b.id?-1:a.id>b.id?1:0));
  return targets[0]?.id||null;
}

function focusBallInDirection(direction) {
  if(busy)return;
  const id=ballInDirection(state().balls,selected,direction,board.width,board.height);
  if(!id)return;
  selectBall(id);
  $(`ball-${id}`)?.focus({preventScroll:true});
}

async function animatePath(id,path) {
  if(path.length<2||matchMedia('(prefers-reduced-motion: reduce)').matches)return true;
  const epoch=animationEpoch;
  const element=$(`ball-${id}`);
  if(!element)return true;
  const pad=settings.coordinates?35:18;
  const xy=p=>({x:pad+(p.x-.5)*64,y:pad+(board.height-p.y+.5)*64});
  const duration=Math.min(1400,Math.max(180,(path.length-1)*54))/settings.speed;
  // Use the animation-frame clock from the first callback. Its timestamp can
  // precede performance.now() read while scheduling that same frame.
  let start;
  return new Promise(resolve=>{
    function skipAnimation(error){
      // Motion is cosmetic: commit the already-validated move without tweening
      // if rendering fails, rather than leaving the controls permanently busy.
      console.warn('Kunundrum: skipped a failed slide animation.',error);
      resolve(epoch===animationEpoch);
    }
    function frame(now){
      if(epoch!==animationEpoch){resolve(false);return;}
      try{
        if(start===undefined)start=now;
        const fraction=Math.max(0,Math.min(1,(now-start)/duration));
        const point=fraction*(path.length-1),index=Math.min(path.length-2,Math.floor(point)),offset=point-index;
        const a=xy(path[index]),z=xy(path[index+1]);
        if(path[index+1].teleport){
          const target=offset<.5?a:z;element.setAttribute('transform',`translate(${target.x},${target.y})`);element.style.opacity=String(Math.abs(offset-.5)*2);
        }else{
          element.setAttribute('transform',`translate(${a.x+(z.x-a.x)*offset},${a.y+(z.y-a.y)*offset})`);element.style.opacity='1';
        }
        if(fraction===1){element.style.opacity='1';resolve(true);}else requestAnimationFrame(frame);
      }catch(error){
        skipAnimation(error);
      }
    }
    try{requestAnimationFrame(frame);}catch(error){skipAnimation(error);}
  });
}

async function makeMove(id,direction,choices=[]) {
  if(busy||isPlaying)return;
  if(cursor >= MAX_REPLAY_MOVES){toast('This route has reached the 2,000-slide limit. Go back to an earlier move to start a new branch.',true);return;}
  showError('replay-error');
  let result;
  try {result=applyMove(state(),board,id,direction,choices);}catch(error){toast(error.message,true);return;}
  if(result.kind==='choose-direction') {
    pendingMove={id,direction,choices};
    renderBoard({path:result.path,record:{ballId:id}});
    $('rotate-caption').textContent=`At ${pos(result.position)}, choose the arrow's exit direction.`;
    openDialog('rotate-dialog');
    return;
  }
  if(result.kind!=='ok'){renderBoard();toast(result.message,true);return;}
  const nextRecords = [...frames.slice(1,cursor+1).map(frame=>frame.record),result.record];
  if(formatSolution(nextRecords).length > MAX_ROUTE_CHARACTERS){renderBoard();toast('This route has reached the 10,000-character limit. Go back to an earlier move to start a new branch.',true);return;}
  busy=true;selected=id;renderBoard(result);renderControls();renderMeta();
  const done=await animatePath(id,result.path);
  if(!done)return;
  frames=frames.slice(0,cursor+1);frames.push(result);cursor++;mode='manual';busy=false;
  selected=selectionAfterMove(id);
  render();persist();
  if(isComplete(state()))toast(isAccepted(state())?`Complete in ${state().slides} slides. Final score: ${state().score}.`:`All balls docked with score ${state().score}. The original game rejects scores ≤ 0.`,!isAccepted(state()));
}

function selectionAfterMove(movedId) {
  const balls = state().balls;
  const moved = balls.find(ball => ball.id === movedId);
  if (moved && !moved.locked) return movedId;
  return balls.find(ball => !ball.locked)?.id || movedId;
}
function goTo(index) {
  if(busy||isPlaying)return;
  stopPlayback();cursor=Math.max(0,Math.min(frames.length-1,index));pendingMove=null;
  // Prefer the last moved ball, or the next playable one when it docked.
  if(cursor > 0)selected=selectionAfterMove(frames[cursor].record.ballId);
  else if(state().balls.find(ball=>ball.id===selected)?.locked)selected=state().balls.find(ball=>!ball.locked)?.id||selected;
  render();persist();
}
function deleteLastMove() {
  if (busy || isPlaying || cursor===0 || cursor!==frames.length-1) return false;
  stopPlayback();
  frames.pop();
  cursor--;
  mode='manual';
  // Keep a loaded route's text synchronized with its shortened history.
  if ($('solution-input').value.trim()) $('solution-input').value = getNotation();
  clearReplayLocation();
  selected=cursor>0?selectionAfterMove(frames[cursor].record.ballId):(state().balls.find(ball=>!ball.locked)?.id||state().balls[0].id);
  render();persist();
  return true;
}
function clearReplayLocation() {
  try {
    const url=new URL(location.href);
    url.searchParams.delete('moves');url.searchParams.delete('at');
    const hash=new URLSearchParams(url.hash.slice(1));
    if(hash.has('moves')||hash.has('at')) {
      hash.delete('moves');hash.delete('at');
      url.hash=hash.toString();
    }
    history.replaceState(history.state,'',url.href);
  }catch{}
}
function resetRun() {
  cancelMotion();
  gesture=null;clearTimeout(toastTimer);$('toast').className='toast';
  frames=[initialFrame(board)];cursor=0;mode='manual';
  selected=state().balls.find(ball=>!ball.locked)?.id||state().balls[0].id;
  $('solution-input').value='';showError('replay-error');
  const rotation=$('rotate-dialog');if(rotation.open)rotation.close();
  clearReplayLocation();render();persist();
}
async function nextStep() {
  if(busy||cursor>=frames.length-1)return false;
  const next=frames[cursor+1];
  busy=true;selected=next.record.ballId;renderBoard(next);renderControls();renderMeta();
  if(!await animatePath(next.record.ballId,next.path))return false;
  cursor++;busy=false;
  // Switch to another movable ball after docking; the trail remains this move.
  selected=selectionAfterMove(next.record.ballId);
  render();persist();return true;
}
async function playRoute() {
  if(isPlaying){stopPlayback();return;}
  if(busy||frames.length<=1||!isComplete(frames[frames.length-1].state))return;
  if(cursor===frames.length-1)goTo(0);
  isPlaying=true;mode='replay';const epoch=++playEpoch;renderControls();renderMeta();renderHistory();
  while(isPlaying&&epoch===playEpoch&&cursor<frames.length-1) {
    if(!await nextStep())break;
    if(cursor<frames.length-1)await new Promise(resolve=>setTimeout(resolve,320/settings.speed));
  }
  if(epoch===playEpoch){isPlaying=false;renderControls();renderMeta();renderHistory();}
}
function loadSolution(text) {
  if(busy||isPlaying)return;
  try {
    const prepared=buildReplay(board,text);
    stopPlayback();frames=prepared;cursor=0;mode='replay';selected=frames[1].record.ballId;
    $('solution-input').value=text.trim();showError('replay-error');render();persist();
    toast(`Loaded ${frames.length-1} moves. ${isComplete(frames.at(-1).state)?'Completes the board.':'Partial route.'}`);
  }catch(error){showError('replay-error',error.message);}
}

function openDialog(id) {stopPlayback();if(!$(id).open)$(id).showModal();}
function closeDialog(dialog) {dialog.close();if(dialog.id==='rotate-dialog'){pendingMove=null;renderBoard();}}
const levelParts = id => id.split('.').map(Number);
let levelsChapter = null;
function revealChapter() {
  const bar = $('chapter-bar'), act = bar.querySelector('.active');
  if (!act) return;
  if (getComputedStyle(bar).flexDirection === 'row') bar.scrollLeft = act.offsetLeft - bar.offsetLeft - 8;
  else bar.scrollTop = act.offsetTop - bar.offsetTop - 8;
}
function renderLevelCards(chapter) {
  const byChapter = new Map();
  for (const level of LEVELS) {
    const [a] = levelParts(level.id);
    if (!byChapter.has(a)) byChapter.set(a, []);
    byChapter.get(a).push(level);
  }
  for (const list of byChapter.values()) list.sort((x, y) => levelParts(x.id)[1] - levelParts(y.id)[1]);
  if (chapter == null) chapter = levelsChapter ?? levelParts(currentPresetId || LEVELS[0].id)[0];
  levelsChapter = chapter;
  $('chapter-bar').innerHTML = Array.from({length: 30}, (_, i) => {
    const a = i + 1, count = byChapter.get(a)?.length || 0;
    return `<button type="button" class="chapter-button${a === chapter ? ' active' : ''}${count ? '' : ' empty'}" data-chapter="${a}" aria-pressed="${a === chapter}"><strong>${a}</strong><span>${count}/10</span></button>`;
  }).join('');
  revealChapter();
  const list = byChapter.get(chapter) || [];
  $('level-cards').innerHTML = list.length ? list.map(level => {
    const best = bestScores[level.id];
    return `<button class="level-card${currentPresetId===level.id?' active':''}" data-level="${escape(level.id)}"><div class="level-preview" style="grid-row:auto">${renderSvg(level,createInitialState(level),{mini:true})}</div><div class="level-card-title" style="align-self:center"><strong>${escape(level.title)}</strong><span>${best?`${icon('check')} ${best.score}`:level.width+' × '+level.height}</span></div></button>`;
  }).join('') : `<p class="level-empty">No puzzles in chapter ${chapter} yet.</p>`;
}
function shareUrl() {
  const source=OFFLINE?{board}:currentPresetId?{levelId:currentPresetId}:{board};
  const url=makeShareUrl(OFFLINE?'https://kunundrum.invalid/':location.href,{...source,routeBoard:board,...(shareRun&&frames.length>1?{moves:getNotation(),at:cursor}:{})});
  return OFFLINE?new URL(url).hash:url;
}
function renderShare() {
  $('share-board').classList.toggle('active',!shareRun);$('share-board').setAttribute('aria-pressed',String(!shareRun));
  $('share-replay').classList.toggle('active',shareRun);$('share-replay').setAttribute('aria-pressed',String(shareRun));
  $('share-url').value=shareUrl();
  $('share-caption').textContent=OFFLINE
    ? (shareRun&&frames.length>1 ? `Paste in Board data. ${frames.length-1} moves; starts at move ${cursor}.` : 'Paste in Board data to load the starting board.')
    : (shareRun&&frames.length>1?`Includes all ${frames.length-1} moves and opens at move ${cursor}.`:'Opens the puzzle at its starting position.');
}
async function copyText(text,success) {
  try {await navigator.clipboard.writeText(text);toast(success);return true;}
  catch {
    const parent=document.querySelector('dialog[open]')||document.body;
    const temp=document.createElement('textarea');temp.value=text;temp.setAttribute('readonly','');temp.style.position='fixed';temp.style.opacity='0';parent.append(temp);temp.select();
    let ok=false;try{ok=document.execCommand('copy');}catch{}finally{temp.remove();}toast(ok?success:'Automatic copy is unavailable. Select the text and copy it manually.',!ok);return ok;
  }
}
function setDataTab(tab) {
  dataTab=tab;
  $('data-code-tab').classList.toggle('active',tab==='code');$('data-code-tab').setAttribute('aria-pressed',String(tab==='code'));
  $('data-json-tab').classList.toggle('active',tab==='json');$('data-json-tab').setAttribute('aria-pressed',String(tab==='json'));
  $('board-input-label').textContent=tab==='json'?'BOARD JSON':'BOARD CODE OR LINK';
  $('board-input').value=tab==='json'?JSON.stringify(board,null,2):'';
  $('board-input').placeholder=tab==='json'?'Edit the board definition…':'Paste a K3. board code or a shared link…';
  $('board-data-help').textContent=tab==='json'?'Loading starts a new run. Validated before loading.':'Paste a board or replay code. Validated before loading.';
  showError('board-error');
}
function importBoard() {
  const input=$('board-input').value.trim();
  try {
    if(!input)throw new Error('Paste a board code, a shared link, or a JSON board first.');
    let nextBoard,share;
    if(/^(?:https?:\/\/|[?#])/i.test(input)) {
      share=readShareUrl(input);
      nextBoard=share.boardCode?decodeBoard(share.boardCode):LEVELS.find(level=>level.id===share.levelId);
      if(!nextBoard)throw new Error('This link does not contain a recognized puzzle.');
    } else nextBoard=decodeBoard(input);
    const prepared=share?.moves?buildReplay(nextBoard,share.moves):undefined;
    adoptBoard(nextBoard,prepared,share?.at||0);
    clearLocation();$('board-dialog').close();toast(`Loaded ${nextBoard.title}.`);
  }catch(error){showError('board-error',error.message);}
}
function clearLocation(){try{history.replaceState(null,'',location.pathname);}catch{}}

// Controls use one delegated listener each so rendering snapshots cannot multiply handlers.
document.querySelector('.skip-link').addEventListener('click',event=>{event.preventDefault();$('board-stage').focus();$('board-stage').scrollIntoView({block:'start'});});
$('undo').addEventListener('click',deleteLastMove);
$('reset').addEventListener('click',resetRun);
$('replay-first').addEventListener('click',()=>goTo(0));
$('replay-back').addEventListener('click',()=>goTo(cursor-1));
$('replay-next').addEventListener('click',()=>goTo(cursor+1));
$('replay-last').addEventListener('click',()=>goTo(frames.length-1));
$('replay-play').addEventListener('click',playRoute);
$('replay-speed').addEventListener('change',event=>{settings.speed=Number(event.target.value);persist();});
$('load-solution').addEventListener('click',()=>loadSolution($('solution-input').value));
$('use-example').addEventListener('click',()=>{if(board.solution)loadSolution(board.solution);});
$('solution-input').addEventListener('input',()=>{if(isPlaying)return;showError('replay-error');updateResetControl();persist();});
$('solution-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();loadSolution(event.target.value);}});
$('copy-route').addEventListener('click',()=>{const text=getNotation(cursor);if(!text){toast('No moves to copy yet.');return;}copyText(text,'Route notation copied.');});
$('move-history').addEventListener('click',event=>{if(busy||isPlaying)return;const target=event.target.closest('[data-jump]');if(target)goTo(Number(target.dataset.jump));});
$('toggle-coords').addEventListener('click',()=>{if(busy||isPlaying)return;settings.coordinates=!settings.coordinates;renderBoard();renderControls();persist();});
$('toggle-trace').addEventListener('click',()=>{if(busy||isPlaying)return;settings.trail=!settings.trail;renderBoard();renderControls();persist();});
$('toggle-outline').addEventListener('click',()=>{if(busy||isPlaying)return;settings.outline=!settings.outline;renderBoard();renderControls();persist();});
$('open-levels').addEventListener('click',()=>{levelsChapter=null;renderLevelCards();openDialog('levels-dialog');revealChapter();});
$('chapter-bar').addEventListener('click',event=>{const b=event.target.closest('[data-chapter]');if(b)renderLevelCards(Number(b.dataset.chapter));});
$('level-cards').addEventListener('click',event=>{const target=event.target.closest('[data-level]');if(!target)return;const next=LEVELS.find(level=>level.id===target.dataset.level);if(next){adoptBoard(next);clearLocation();$('levels-dialog').close();}});
$('open-help').addEventListener('click',()=>openDialog('help-dialog'));
$('open-share').addEventListener('click',()=>{shareRun=false;renderShare();openDialog('share-dialog');});
$('share-board').addEventListener('click',()=>{shareRun=false;renderShare();});
$('share-replay').addEventListener('click',()=>{shareRun=true;renderShare();});
$('copy-share').addEventListener('click',()=>copyText($('share-url').value,OFFLINE?'Portable board/replay code copied.':'Replay link copied.'));
$('share-url').addEventListener('click',event=>event.target.select());
$('open-board-data').addEventListener('click',()=>{setDataTab('code');openDialog('board-dialog');});
$('import-from-levels').addEventListener('click',()=>{$('levels-dialog').close();setDataTab('code');openDialog('board-dialog');});
$('data-code-tab').addEventListener('click',()=>setDataTab('code'));
$('data-json-tab').addEventListener('click',()=>setDataTab('json'));
$('load-board').addEventListener('click',importBoard);
$('board-input').addEventListener('input',()=>showError('board-error'));
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>closeDialog(button.closest('dialog'))));
document.querySelectorAll('dialog').forEach(dialog=>{
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog(dialog);});
  dialog.addEventListener('cancel',()=>{if(dialog.id==='rotate-dialog'){pendingMove=null;renderBoard();}});
});
document.querySelectorAll('[data-rotation]').forEach(button=>button.addEventListener('click',()=>{
  const move=pendingMove;if(!move)return;
  pendingMove=null;$('rotate-dialog').close();makeMove(move.id,move.direction,[...move.choices,button.dataset.rotation]);
}));

let gesture=null;
$('board-stage').addEventListener('pointerdown',event=>{
  const hit=event.target.closest('[data-ball]');if(!hit||busy)return;
  const ball=state().balls.find(b=>b.id===hit.dataset.ball);if(!ball||ball.locked)return;
  event.preventDefault();gesture={id:ball.id,x:event.clientX,y:event.clientY,pointerId:event.pointerId};
  $('board-stage').setPointerCapture(event.pointerId);selectBall(ball.id);
});
$('board-stage').addEventListener('pointerup',event=>{
  if(!gesture||gesture.pointerId!==event.pointerId)return;
  const saved=gesture;gesture=null;
  if($('board-stage').hasPointerCapture(event.pointerId))$('board-stage').releasePointerCapture(event.pointerId);
  const dx=event.clientX-saved.x,dy=event.clientY-saved.y;
  if(Math.max(Math.abs(dx),Math.abs(dy))>22)makeMove(saved.id,Math.abs(dx)>Math.abs(dy)?dx>0?'r':'l':dy>0?'d':'u');
});
$('board-stage').addEventListener('pointercancel',()=>{gesture=null;});
$('board-stage').addEventListener('click',event=>{const hit=event.target.closest('[data-ball]');if(hit&&!busy&&!gesture)selectBall(hit.dataset.ball);});
$('board-stage').addEventListener('keydown',event=>{const hit=event.target.closest('[data-ball]');if(hit&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();selectBall(hit.dataset.ball);}});
document.addEventListener('keydown',event=>{
  if(event.isComposing||document.querySelector('dialog[open]')||window.KunEditor?.active)return;
  // Allow held Previous/Next shortcuts to step through the recorded route.
  // Prevent held movement and other commands from firing repeatedly.
  const repeatingNavigation = !event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey && ['z','x','pageup','pagedown'].includes(event.key.toLowerCase());
  if(event.repeat&&!repeatingNavigation)return;
  if(event.target.isContentEditable||event.target.closest('input,textarea,select'))return;
  if((event.code==='Space'||event.key===' ')&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey){
    event.preventDefault();playRoute();return;
  }
  if(isPlaying)return;
  const key=event.key.toLowerCase();
  const direction={ArrowUp:'u',ArrowDown:'d',ArrowLeft:'l',ArrowRight:'r'}[event.key];
  if(direction){
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    event.preventDefault();
    if(event.shiftKey)focusBallInDirection(direction);else makeMove(selected,direction);
    return;
  }
  if(event.ctrlKey||event.metaKey){
    if(key==='z'&&!event.shiftKey){event.preventDefault();deleteLastMove();}
    return;
  }
  if(event.altKey)return;
  if(key==='home'||key==='z'&&event.shiftKey){event.preventDefault();goTo(0);return;}
  if(key==='end'||key==='x'&&event.shiftKey){event.preventDefault();goTo(frames.length-1);return;}
  if(key==='z'||key==='pageup'){event.preventDefault();goTo(cursor-1);return;}
  if(key==='x'||key==='pagedown'){event.preventDefault();goTo(cursor+1);return;}
  if('rgby'.includes(key)&&key.length===1){
    const available=state().balls.filter(ball=>ball.color===key.toUpperCase()&&!ball.locked);
    if(available.length){event.preventDefault();const index=available.findIndex(ball=>ball.id===selected);selectBall(available[(index+1)%available.length].id);}
  }
});

// After mouse use of the side/bottom controls, hand keyboard focus back to the board
// (keyboard activation keeps focus where it is; the replay textarea is exempt).
const returnFocusToBoard=()=>{ if(!window.KunEditor?.active) $('board-stage').focus({preventScroll:true}); };
document.querySelector('.control-column').addEventListener('click',event=>{ if(event.detail>0&&event.target.closest('button')) returnFocusToBoard(); });
document.querySelector('.board-bottom').addEventListener('click',event=>{ if(event.detail>0&&event.target.closest('button')) returnFocusToBoard(); });
let selectByMouse=false;
$('replay-speed').addEventListener('pointerdown',()=>{selectByMouse=true;});
$('replay-speed').addEventListener('keydown',()=>{selectByMouse=false;});
$('replay-speed').addEventListener('change',()=>{ if(selectByMouse){selectByMouse=false;returnFocusToBoard();} });

window.KunundrumHost = {
  getBoard:()=>JSON.parse(JSON.stringify(board)),
  svg:draft=>renderSvg(draft,createInitialState(draft),{outlinedBallId:null}),
  stop:()=>cancelMotion(),
  play:draft=>{adoptBoard(draft);},
};
function boot() {
  let saved=null;
  try {
    const stored=localStorage.getItem(STORAGE_KEY);if(stored&&stored.length<120000)saved=JSON.parse(stored);
    const best=JSON.parse(localStorage.getItem(BEST_KEY)||'{}');
    if(best&&typeof best==='object')bestScores=Object.fromEntries(Object.entries(best).filter(([id,value])=>LEVELS.some(level=>level.id===id)&&Number.isInteger(value?.score)&&value.score>=1&&Number.isInteger(value?.slides)));
  }catch{storageAvailable=false;}
  if(!viewSettingsInitialized) {
    const previous=saved?.settings;
    settings.coordinates=previous?.viewDefaultsVersion===1&&previous.coordinates===true;
    settings.trail=previous?.viewDefaultsVersion===1&&previous.trail===true;
    // Migrate earlier installs to outline-off once; retain subsequent user choices.
    settings.outline=previous?.outlineDefaultsVersion===1 && previous.outline===true;
    settings.outlineDefaultsVersion=1;
    settings.speed=[.5,1,2].includes(previous?.speed)?previous.speed:1;
    viewSettingsInitialized=true;
  }
  try {
    const shared=readShareUrl(OFFLINE?'https://kunundrum.invalid/'+location.search+location.hash:location.href);
    if(shared.boardCode||shared.levelId||shared.moves||shared.route){
      const next=shared.boardCode?decodeBoard(shared.boardCode):shared.levelId?LEVELS.find(level=>level.id===shared.levelId):LEVELS[0];
      if(!next)throw new Error(`Unknown puzzle ${shared.levelId}. Choose one from the collection.`);
      const prepared=(shared.route||shared.moves)?buildReplay(next,shared.route?decodeRoute(next,shared.route):shared.moves):undefined;
      adoptBoard(next,prepared,shared.at||0);
    }else if(saved?.board){
      const next=decodeBoard(saved.board);const prepared=saved.moves?buildReplay(next,saved.moves):undefined;
      adoptBoard(next,prepared,Number.isInteger(saved.at)?saved.at:0);
      if(cursor===0&&state().balls.some(ball=>ball.id===saved.selected&&!ball.locked))selected=saved.selected;
      mode=saved.mode==='replay'?'replay':'manual';
      if(typeof saved.draft==='string'&&saved.draft.length<=10000)$('solution-input').value=saved.draft;
      render();
    }else adoptBoard(LEVELS[0]);
  }catch(error){adoptBoard(LEVELS[0]);toast(`Could not load this run: ${error.message}`,true);}
}
boot();
window.addEventListener('hashchange',()=>{if(/(?:^|&)(?:board|level|moves|route|at)=/.test(location.hash.slice(1)))boot();});
window.addEventListener('beforeunload',persist);

})();
