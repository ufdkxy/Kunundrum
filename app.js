/* Kunundrum interface/controller. Engine, codec and catalog load separately. */
'use strict';
(() => {
const {validateBoard,createInitialState,applyMove,applyMoveAtPhase,isComplete,parseSolution,resolveBallId,formatMove,formatSolution,COLOR_NAMES,DIRECTION_NAMES}=Core;
const {entries:CATALOG_ENTRIES}=Collection;
const {encodeBoard,decodeBoard,encodeRoute,decodeRouteCode,readShareUrl,makeShareUrl}=Codec;


const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const APP_VERSION = '4.7.4'; // Single source of truth; the footer reads it.
const versionLabel = document.getElementById('app-version');
if (versionLabel) versionLabel.textContent = 'v' + APP_VERSION;
const brandLink = document.querySelector('.brand');
if (brandLink) brandLink.title = 'Kunundrum v' + APP_VERSION;
const PALETTE = { R: '#df3047', G: '#39ff24', B: '#6fe8ff', Y: '#fff15c' };
// Cosmetic wall themes (board.wallColor; blue when absent): neon outline layers plus the floor-grid tint.
const WALL_THEMES = {
  B: { glow: '#00d5ed', mid: '#29d9f2', core: '#d0fbff', floor: '#040e15', grid: '#0d2c3c', cell: '#16465b' },
  R: { glow: '#ff1f2e', mid: '#ff3a46', core: '#ffd9db', floor: '#0e0407', grid: '#3c0f15', cell: '#5a1219' },
  G: { glow: '#27ff1c', mid: '#4dff3a', core: '#e2ffdb', floor: '#030f05', grid: '#0d3a14', cell: '#16591f' },
};
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
  'import': '<path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/>',
  'braces': '<path d="M8 3H6v6l-3 3 3 3v6h2m8-18h2v6l3 3-3 3v6h-2"/>',
  'hash': '<path d="M5 9h14M5 15h14M10 4 8 20m8-16-2 16"/>',
  'grid': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18m6-18v18"/>',
  'route': '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h9a4 4 0 0 1 0 8H8a2 2 0 0 0 0 4h9"/>',
  'selection': '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="3"/>',
  'undo': '<path d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 0 12"/>',
  'redo': '<path d="m16 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
  'reset': '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  'play': '<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke-width="1.5"/>',
  'replay': '<path d="m5 5 10 7-10 7Z" fill="currentColor" stroke-width="1.5"/><path d="M19 5v14" stroke-width="2.4"/>',
  'pause': '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  'play-circle': '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4Z"/>',
  'step-back': '<path d="m15 5-7 7 7 7" stroke-width="2.4"/>',
  'step-forward': '<path d="m9 5 7 7-7 7" stroke-width="2.4"/>',
  'skip-first': '<path d="M6 5v14M18 5l-7 7 7 7" stroke-width="2.4"/>',
  'skip-last': '<path d="M18 5v14M6 5l7 7-7 7" stroke-width="2.4"/>',
  'save': '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 21v-8h10v8M7 3v5h8"/>',
  'check': '<path d="m5 12 4 4L19 6"/>',
  'star': '<path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8Z"/>',
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
    id:'help-symbols', title:'Help symbols', width:6, height:2,
    balls:[{color:'B',x:1,y:1}], goals:[{color:'B',x:1,y:2}],
    arrows:[{x:2,y:1,direction:'r'}],
    switches:[{id:'S',x:3,y:1,controls:['G1']}], gates:[{id:'G1',x:5,y:2,active:false}], // inactive gate: the derived switch indicator is then Off (the help icon shows the red switch)
   
    teleports:[{id:'T1',color:'Y',x:4,y:1,active:true},{id:'T2',color:'Y',x:4,y:2,active:true}],
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
  const icon = Object.fromEntries([
    ['goal', / goal /],
    ['arrow', /^Fixed arrow /],
    ['switch', /^Off switch/],
    ['teleport', /^Active Yellow teleport/],
    ['hex', /^One-use -5 score /],
  ].map(([name, label]) => [name, frame(
    (defs + feature(label)).replaceAll('preview-help-symbols-', `help-rule-${name}-`),
    name === 'arrow' ? '-24 -24 48 48' : undefined,
  )]));
  icon.tunnel = frame(`<g transform="scale(1.9)">${tunnelTriangles('u')}</g>`);
  // Same order as the cards in index.html (How to play).
  const icons = [icon.goal, icon.hex, icon.arrow, icon.teleport, icon.switch, icon.tunnel];
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
  // K4 stores the board only: the catalog line supplies the id, the title is derived and the route follows the board code.
  const extra = {}, level = decodeBoard(code, undefined, extra);
  return validateBoard({...level, id, title: `Level ${id}`, ...(extra.route ? {solution: decodeRouteCode(level, extra.route)} : {})});
});
const OFFLINE = location.protocol === 'file:';
const STORAGE_KEY = 'kunundrum.replay.v1';
const BEST_KEY = 'kunundrum.best.v1';
const PUZZLES_KEY = 'kunundrum.puzzles.v1'; // puzzle dialog: {scroll, selected}
const MAX_REPLAY_MOVES = 2000;
const MAX_ROUTE_CHARACTERS = 10000;
let board = LEVELS[0];
let frames = [{ state: createInitialState(board), path: [], record: null, events: [] }];
let cursor = 0;
let selected = 'R';
let busy = false;
let isPlaying = false;
let mode = 'manual';
// Shared arrow clock: rotating arrows advance one tick a second while no ball is moving (waiting is free; the clock is frozen during a
// move and resumes afterwards). A move uses the orientations shown at the moment it starts.
const clock = { ticks: 0 };
const arrowAngle = (type, ticks) => type === 'flip' ? 180 * (ticks % 2) : (type === 'ccw' ? -90 : 90) * (ticks % 4);
function updateArrows() { document.querySelectorAll('.rotating-arrow').forEach(el => { el.style.transform = `rotate(${arrowAngle(el.dataset.type, clock.ticks)}deg)`; }); }
// Replay and jumps: wait (advance the clock) to the first phase from now on that fits the move's orientations.
function syncClock(phases) {
  if (!phases || phases.includes(clock.ticks % 4)) return;
  for (let d = 1; d < 4; d++) if (phases.includes((clock.ticks + d) % 4)) { clock.ticks += d; break; }
  updateArrows();
}
setInterval(() => { if (busy || document.hidden) return; clock.ticks++; updateArrows(); }, 1000);
let animationEpoch = 0;
let playEpoch = 0;
let toastTimer;
let bestScores = {};
let settings = { coordinates: false, labels: true, trail: false, outline: false, speed: 1 };
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
function cancelMotion() { animationEpoch++; busy = false; stopPlayback(); }
function getNotation(end = frames.length - 1) { return formatSolution(frames.slice(1, end + 1).map(frame => frame.record)); }
function initialFrame(nextBoard) { return { state: createInitialState(nextBoard), path: [], record: null, events: [] }; }

function buildReplay(nextBoard, notation) {
  const tokens = parseSolution(notation);
  if (tokens.length > MAX_REPLAY_MOVES) throw new Error(`A replay can contain at most ${MAX_REPLAY_MOVES.toLocaleString()} moves.`);
  if (!tokens.length) throw new Error('Enter a solution string first, for example Rur,G3ld,Bu.');
  const result = [initialFrame(nextBoard)];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    try {
      const previous = result[result.length - 1].state;
      const id = resolveBallId(previous, token.identifier);
      const move = applyMove(previous, nextBoard, id, token.direction, token.choices);
      if (move.kind === 'choose-direction') throw new Error(`Add the rotating arrow's orientation to this move, e.g. (->u), for the arrow at ${pos(move.position)}.`);
      if (move.kind !== 'ok') throw new Error(move.message);
      result.push(move);
    } catch (error) { throw new Error(`Move ${i + 1} (${token.identifier}${token.direction}): ${error.message}`); }
  }
  if (formatSolution(result.slice(1).map(frame => frame.record)).length > MAX_ROUTE_CHARACTERS) throw new Error('The expanded route exceeds 10,000 characters. Shorten it before loading.');
  return result;
}

function adoptBoard(nextBoard, replayFrames, at = 0) {
  // Validate the whole candidate before replacing the user's current run.
  const normalized = validateBoard(nextBoard);
  const code = encodeBoard(normalized);
  const presetLevel = LEVELS.find(level => encodeBoard(level) === code) || null;
  const preset = presetLevel?.id || null;
  const nextFrames = replayFrames || [initialFrame(normalized)];
  cancelMotion();
  board = presetLevel || normalized; // a K4 code carries no id, title or solution: a catalog board gets them back
  frames = nextFrames;
  cursor = Math.min(Math.max(0, at), frames.length - 1);
  if (cursor > 0) syncClock(frames[cursor].phases);
  selected = (cursor > 0 ? frames[cursor].record?.ballId : null) || state().balls.find(ball => !ball.locked)?.id || state().balls[0].id;
  mode = replayFrames ? 'replay' : 'manual';
  currentPresetId = preset;
  showError('replay-error');
  document.title = `${board.title} · Kunundrum`;
  render();
  persist();
}

function persist() {
  try {
    const records = getNotation();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ board: encodeBoard(board), title: currentPresetId ? undefined : board.title, solution: currentPresetId ? undefined : board.solution, moves: records, at: cursor, selected, mode, settings, draft: $('solution-input').value }));
    if (isComplete(state()) && currentPresetId) {
      const previous = bestScores[currentPresetId];
      if (!previous || state().score < previous.score || state().score === previous.score && state().moves < previous.moves) {
        bestScores[currentPresetId] = { score: state().score, moves: state().moves };
        localStorage.setItem(BEST_KEY, JSON.stringify(bestScores));
      }
    }
    storageAvailable = true;
  } catch { storageAvailable = false; }
  // Persistence remains active; there is no visible save-status note.
}

function mappingLabels(b) {
  // Tile numbers say which switch controls which element; display only (IDs stay distinct).
  // Switches controlling exactly the same elements share one label (that of the first of them), and
  // numbers only appear when the board has at least two such distinct switches.
  const labels={switches:new Map(),gates:new Map(),teleports:new Map()};
  const tag=id=>/^S\d+$/.test(id)?id.slice(1):id;
  const groupLabel=new Map(), shown=new Map();
  for(const sw of b.switches){
    const key=[...new Set(sw.controls)].sort().join('|');
    if(!groupLabel.has(key))groupLabel.set(key,tag(sw.id));
    shown.set(sw.id,groupLabel.get(key));
  }
  if(groupLabel.size<2)return labels;
  const gateIds=new Set(b.gates.map(g=>g.id));
  for(const sw of b.switches){
    const label=shown.get(sw.id);
    labels.switches.set(sw.id,label);
    for(const id of sw.controls){
      const kind=gateIds.has(id)?'gates':'teleports',previous=labels[kind].get(id);
      if(!previous)labels[kind].set(id,label);
      else if(!previous.split(', ').includes(label))labels[kind].set(id,`${previous}, ${label}`);
    }
  }
  return labels;
}

// Tunnel opening marker, as in the game: two small triangles side by side along the outline gap, pointing in opposite directions
// (one out of the board, one into it). Coordinates are relative to the centre of the opened cell side.
function tunnelTriangles(side) {
  const horizontal = side === 'u' || side === 'd', gap = 7.5;
  const dirs = { u: [['u', -gap], ['d', gap]], d: [['u', -gap], ['d', gap]], l: [['r', -gap], ['l', gap]], r: [['r', -gap], ['l', gap]] }[side];
  const angle = { r: 0, d: 90, l: 180, u: 270 };
  return dirs.map(([dir, off]) => `<g transform="translate(${horizontal ? off : 0},${horizontal ? 0 : off}) rotate(${angle[dir]})"><polygon points="3.5,0 -3.5,-6 -3.5,6" fill="#fff"/></g>`).join('');
}

// Pair number (like the switch/gate numbers: only when it tells pairs apart), outside the cell next to the opening; for openings on the
// board border this lies in the margin around the grid.
function tunnelLabel(side, label, show) {
  if (!show) return '';
  const half = 3.6 * label.length, dx = { u: 0, d: 0, l: -(7 + half), r: 7 + half }[side], dy = { u: -13, d: 13, l: 0, r: 0 }[side];
  return `<text class="tile-label" x="${dx}" y="${dy}" dominant-baseline="central" fill="#e6f7ff" style="font-size:12px;font-weight:700;paint-order:stroke;stroke:#06131b;stroke-width:3;stroke-linejoin:round">${label}</text>`;
}

function renderSvg(b, s, options = {}) {
  const mini = !!options.mini;
  const theme = WALL_THEMES[b.wallColor] || WALL_THEMES.B;
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
  const showLabels = mini || settings.labels; // the Labels toggle only affects the main board, not previews
  const labels = showLabels ? mappingLabels(b) : { switches: new Map(), gates: new Map(), teleports: new Map() };
  let svg = `<svg class="board-svg" viewBox="0 0 ${width} ${height}" ${mini ? 'aria-hidden="true"' : `role="group" aria-label="${escape(b.title)}. ${b.width} columns by ${b.height} rows. Arrow keys move. Shift plus arrow keys select another ball."`} xmlns="http://www.w3.org/2000/svg"><defs>`;
  for (const [color, value] of Object.entries(PALETTE)) {
    svg += `<radialGradient id="${prefix}-orb-${color}" cx="35%" cy="28%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".28" stop-color="${value}"/><stop offset="1" stop-color="${value}" stop-opacity=".73"/></radialGradient>`;
  }
  svg += `<filter id="${prefix}-glow" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="3"/></filter>`;
  svg += `<filter id="${prefix}-orb-aura" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="8"/></filter>`;
  svg += `<pattern id="${prefix}-floor" x="${pad}" y="${pad}" width="${cell}" height="${cell}" patternUnits="userSpaceOnUse"><rect width="64" height="64" fill="${theme.floor}"/><path d="M16 0V64M32 0V64M48 0V64M0 16H64M0 32H64M0 48H64" fill="none" stroke="${theme.grid}" stroke-width=".8"/></pattern>`;
  svg += `<radialGradient id="${prefix}-switch-rim" cx="38%" cy="25%" r="78%"><stop offset="0" stop-color="#527d91"/><stop offset=".5" stop-color="#1b3e50"/><stop offset="1" stop-color="#030b11"/></radialGradient><linearGradient id="${prefix}-switch-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8b91"/><stop offset=".42" stop-color="#f92430"/><stop offset=".55" stop-color="#eb000e"/><stop offset="1" stop-color="#99000a"/></linearGradient><linearGradient id="${prefix}-switch-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
  svg += `<radialGradient id="${prefix}-switch-dent" cx="50%" cy="50%" r="50%"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient><radialGradient id="${prefix}-switch-green" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#c2ff25"/><stop offset=".43" stop-color="#8be500"/><stop offset=".76" stop-color="#4c8e09"/><stop offset="1" stop-color="#1c3e09"/></radialGradient>`;
  svg += `<linearGradient id="${prefix}-gate-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5f666f"/><stop offset=".48" stop-color="#4b525b"/><stop offset="1" stop-color="#373e46"/></linearGradient><pattern id="${prefix}-gate-texture" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M-1 1L1-1M0 4L4 0M3 5L5 3" stroke="#121a23" stroke-opacity=".28" stroke-width=".7"/></pattern>`;
  svg += `<pattern id="${prefix}-gate" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#ffe34d"/><rect width="4" height="10" fill="#4b4829"/></pattern></defs>`;
  svg += `<rect x="${pad}" y="${pad}" width="${b.width * cell}" height="${b.height * cell}" rx="5" fill="#02080c"/>`;
  let boundary = '';
  const SIDE_OF = {'-1,0':'l','1,0':'r','0,1':'u','0,-1':'d'};
  const openings = new Set((b.tunnels||[]).flatMap(t=>[t.a,t.b].map(e=>`${e.x},${e.y},${e.side}`)));
  for (let y = 1; y <= b.height; y++) for (let x = 1; x <= b.width; x++) {
    if (!floor(x, y)) continue;
    const px = pad + (x - 1) * cell, py = pad + (b.height - y) * cell;
    svg += `<rect class="grid-cell" x="${px}" y="${py}" width="${cell}" height="${cell}" style="fill:url(#${prefix}-floor);stroke:${theme.cell};stroke-width:.8"/>`;
    const dockedColor = dockedGoalColors.get(`${x},${y}`);
    if (dockedColor) svg += `<rect class="docked-goal-cell" x="${px}" y="${py}" width="${cell}" height="${cell}" fill="${dockedColor}" fill-opacity=".22" pointer-events="none"/>`;
    for (const [dx, dy, x1, y1, x2, y2] of [[-1,0,px,py,px,py+cell],[1,0,px+cell,py,px+cell,py+cell],[0,1,px,py,px+cell,py],[0,-1,px,py+cell,px+cell,py+cell]]) {
      if (!floor(x+dx,y+dy) && !openings.has(`${x},${y},${SIDE_OF[dx+','+dy]}`)) boundary += `M${x1} ${y1}L${x2} ${y2}`;
    }
  }
  svg += `<g fill="none" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"><path d="${boundary}" stroke="${theme.glow}" stroke-width="9" opacity=".65" filter="url(#${prefix}-glow)"/><path d="${boundary}" stroke="${theme.mid}" stroke-width="4.5"/><path d="${boundary}" stroke="${theme.core}" stroke-width="1.9"/></g>`;
  (b.tunnels||[]).forEach((t,i)=>{
    for (const e of [t.a,t.b]) {
      const px=pad+(e.x-1)*cell, py=pad+(b.height-e.y)*cell;
      const [ex,ey]={u:[px+cell/2,py],d:[px+cell/2,py+cell],l:[px,py+cell/2],r:[px+cell,py+cell/2]}[e.side];
      svg += `<g class="tunnel-mark" role="img" aria-label="Tunnel ${i+1} opening ${DIRECTION_NAMES[e.side]} of ${pos(e)}" transform="translate(${ex},${ey})" pointer-events="none">${tunnelTriangles(e.side)}${tunnelLabel(e.side, String(i+1), showLabels && b.tunnels.length > 1)}</g>`;
    }
  });
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
    svg += `<g role="img" aria-label="${on?'Active':'Inactive'} wall${label?' · switch '+label:''} ${pos(gate)}" transform="translate(${p.x},${p.y})">${on?`<rect x="-27" y="-27" width="54" height="54" rx="2" fill="none" stroke="#ffe85c" stroke-width="7" opacity=".25" filter="url(#${prefix}-glow)"/><rect class="gate-on" x="-27" y="-27" width="54" height="54" rx="2" fill="url(#${prefix}-gate)" stroke="url(#${prefix}-gate)" style="stroke-width:3.8"/>`:''}<rect class="${on?'gate-face':'gate-off'}" x="${-inset}" y="${-inset}" width="${inset*2}" height="${inset*2}" rx="1.5" fill="url(#${prefix}-gate-metal)" stroke="${on?'#b6aa45':'#77818c'}" style="opacity:1;stroke-dasharray:none;stroke-width:1.1"/><rect x="${1-inset}" y="${1-inset}" width="${inset*2-2}" height="${inset*2-2}" rx="1" fill="url(#${prefix}-gate-texture)"/><path d="M0 ${2-inset}V${inset-2}M${2-inset} 0H${inset-2}" fill="none" stroke="#242c34" stroke-width="2"/><path d="M2 ${2-inset}V${inset-2}M${2-inset} 2H${inset-2}" fill="none" stroke="#89939d" stroke-opacity=".32" stroke-width=".8"/>${label?`<text class="tile-label" x="0" y="0" dominant-baseline="central" fill="${on?'#fff1b8':'#dbe2e8'}" style="font-size:${label.length>4?10:14}px;font-weight:700;paint-order:stroke;stroke:#1c252e;stroke-width:3;stroke-linejoin:round">${label}</text>`:''}</g>`;
  }
  for (const arrow of b.arrows) {
    const p=xy(arrow), degrees={r:0,d:90,l:180,u:270}[arrow.direction], color=arrow.rotating?'#ff8a9b':'#a0cddb', glow=arrow.rotating?'#ff2a45':'#2a86b0';
    const chev=[-19,-8,3].map((a,i)=>`<polygon points="${a},-14 ${a+6},-14 ${a+16},0 ${a+6},14 ${a},14 ${a+10},0" opacity="${[.62,1,.45][i]}"/>`).join('');
    svg += `<g role="img" aria-label="${arrow.rotating?({ccw:'Counterclockwise rotating',flip:'Flipping'}[arrow.type]||'Clockwise rotating'):'Fixed'} arrow ${DIRECTION_NAMES[arrow.direction]} ${pos(arrow)}" transform="translate(${p.x},${p.y})"><g transform="rotate(${degrees})"><g${arrow.rotating?` class="rotating-arrow" data-type="${arrow.type||'cw'}" style="transform:rotate(${arrowAngle(arrow.type,clock.ticks)}deg)"`:''}><g fill="${glow}" filter="url(#${prefix}-glow)" opacity=".9">${chev}</g><g fill="${color}" stroke="${color}" stroke-width=".8" stroke-linejoin="round">${chev}</g></g></g></g>`;
  }
  for (const teleport of b.teleports) {
    const p=xy(teleport), on=s.teleportActive[teleport.id], universal=teleport.color==='*';
    const metal=!on||b.switches.some(sw=>sw.controls.includes(teleport.id)); // metal base: inactive, or switchable (stays when on)
    const color=on?(universal?'#c6cdd3':PALETTE[teleport.color]):'#a3afb9';
    const name=universal?'universal':COLOR_NAMES[teleport.color];
    const arcs=[45,135,225,315].map(a=>{const pt=d=>{const r=(a+d)*Math.PI/180;return `${(23*Math.cos(r)).toFixed(2)} ${(23*Math.sin(r)).toFixed(2)}`;};return `M${pt(-17)}A23 23 0 0 1 ${pt(17)}`;}).join('');
    svg += `<g role="img" aria-label="${on?'Active':'Inactive'} ${name} teleport ${pos(teleport)}" transform="translate(${p.x},${p.y})">${!metal?`<rect x="-25" y="-25" width="50" height="50" fill="${color}" fill-opacity=".14"/>`:`<rect x="-25" y="-25" width="50" height="50" rx="1.5" fill="url(#${prefix}-gate-metal)" stroke="#77818c" style="stroke-width:1.1"/><rect x="-24" y="-24" width="48" height="48" rx="1" fill="url(#${prefix}-gate-texture)"/><path d="M0 -23V23M-23 0H23" fill="none" stroke="#242c34" stroke-width="2"/><path d="M2 -23V23M-23 2H23" fill="none" stroke="#89939d" stroke-opacity=".32" stroke-width=".8"/>`}<g fill="none" stroke="${color}" stroke-opacity="${on?'.5':'1'}" stroke-width="${on?1:1.4}"><circle r="19"/><circle r="13.5"/><circle r="8"/></g>${on?`<g filter="url(#${prefix}-glow)" opacity=".8"><path d="${arcs}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/><circle r="5" fill="${color}"/></g>`:''}<path d="${arcs}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-opacity="1"/><circle r="4.5" fill="${color}" fill-opacity="1"/><circle r="2.2" fill="#fff" fill-opacity=".85"/></g>`;
  }
  for (const sw of b.switches) {
    const p=xy(sw), label=labels.switches.get(sw.id), on=s.switchOn?.[sw.id]??sw.on??false;
    svg += `<g role="img" aria-label="${on?'On':'Off'} switch${label?' · switch '+label:''} ${pos(sw)}" transform="translate(${p.x},${p.y})"><circle r="24" fill="url(#${prefix}-switch-rim)" stroke="#123345" stroke-width="1.5"/><circle cy="${on?0:-.5}" r="20.5" fill="url(#${prefix}-switch-${on?'green':'red'})" stroke="${on?'#254d0b':'#750714'}" stroke-width="1.4"/>${on?`<circle r="20.5" fill="url(#${prefix}-switch-dent)"/>`:''}<path d="M-17-5C-15-24 15-24 17-5C8-9-8-9-17-5Z" fill="url(#${prefix}-switch-shine)" opacity="${on?'.18':'1'}"/>${label?`<text class="tile-label" x="0" y="0" dominant-baseline="central" fill="#fff9f4" style="font-size:14px;font-weight:700;paint-order:stroke;stroke:${on?'#214908':'#69000c'};stroke-width:2.5;stroke-linejoin:round">${label}</text>`:''}</g>`;
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
      const tun = trace.path[i].tunnel;
      if (tun) {
        const D={u:[0,-1],d:[0,1],l:[-1,0],r:[1,0]}, ov=D[trace.path[i].via], ou=D[trace.path[i].out];
        const stub=(c,v)=>`<line x1="${c.x}" y1="${c.y}" x2="${c.x+v[0]*32}" y2="${c.y+v[1]*32}" stroke="${color}" stroke-width="3.8" stroke-linecap="round" stroke-dasharray="5 5" stroke-opacity=".8" pointer-events="none"/>`;
        svg += stub(a,ov)+stub(z,ou); continue;
      }
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
    const number=showLabels&&b.balls.filter(original=>original.color===ball.color).length>1?ball.id.slice(1):'';
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
let generatingRandom = false;
// New random: the same generator as the editor's "Generate random board" link, but the board goes straight into play (no edit mode).
async function newRandom() {
  if (generatingRandom || !window.KunEditor) return;
  const started = board, {width, height} = board;
  generatingRandom = true; renderMeta();
  try {
    const result = await window.KunEditor.generate(width, height);
    if (!result) toast('No random board could be generated at this size.', true);
    else if (result.failed) toast(result.solverError ? 'The solver failed: ' + result.solverError.message : 'No board with a proven optimal route was found within 10 s. Try again.', true);
    else if (board !== started) { /* another board was opened meanwhile: discard */ }
    else {
      const next = result.board;
      generatingRandom = false; adoptBoard(next); clearReplayLocation(); persist(); return;
    }
  } catch (error) { toast('Generating failed: ' + error.message, true); }
  generatingRandom = false; renderMeta();
}
// Stars: the score of the board's best known route (the saved solution: proven optimal for generated boards and 99% of the catalog)
// decides. score <= best: 3 stars, <= best + 2: 2 stars, otherwise 1; an unfinished board has 0.
const bestKnownCache = new Map();
function bestKnownScore(b) {
  if (!b?.solution) return null;
  if (!bestKnownCache.has(b.solution)) {
    let score = null;
    try { const last = buildReplay(b, b.solution).at(-1).state; if (isComplete(last)) score = last.score; } catch {}
    bestKnownCache.set(b.solution, score);
  }
  return bestKnownCache.get(b.solution);
}
function starCount(score, best) { return score <= best ? 3 : score <= best + 2 ? 2 : 1; }
function starsHtml(count) {
  return `<span class="stars" role="img" aria-label="${count} of 3 stars">${[1, 2, 3].map(i => `<span class="${i <= count ? 'on' : 'off'}">${icon('star')}</span>`).join('')}</span>`;
}
// Next level in numeric order (chapter, number) among catalog levels; levels.js file order is not numeric.
function nextLevel() {
  if (!currentPresetId) return null;
  const key = id => { const [c,n] = id.split('.').map(Number); return c*100+n; };
  const here = key(currentPresetId);
  return LEVELS.filter(level => key(level.id) > here).sort((x,y) => key(x.id)-key(y.id))[0] || null;
}
function renderMeta() {
  $('level-title').textContent=board.title;
  document.title = `${board.title} · Kunundrum`;
  $('board-dimensions').textContent=`${board.width} × ${board.height}`;
  $('score-value').textContent=padNumber(state().score);
  const docked=state().balls.filter(ball=>ball.locked).length;
  $('docked-value').innerHTML=`${docked}<span>/${state().balls.length}</span>`;
  const completed=$('completion-inline');
  const finished=isComplete(state());
  const best=finished?bestKnownScore(board):null;
  const hasNext=finished&&!!nextLevel();
  const hasRandom=finished&&!currentPresetId&&!!board.solution; // a generated board (the only non-catalog board that carries a route)
  completed.innerHTML=finished?`${best===null?'Complete':starsHtml(starCount(state().score,best))}${hasNext?'<button class="next-puzzle" id="next-puzzle" type="button" title="Go to the next puzzle (N)">Next puzzle ›</button>':''}${hasRandom?`<button class="next-puzzle" id="new-random" type="button" title="Generate a new random board (N)"${generatingRandom?' disabled':''}>${generatingRandom?'Generating...':'New random'}</button>`:''}`:'';
  completed.className=`completion-inline${isComplete(state())?' done':''}`;
}
// Bottom-bar hint. "Moving..." is shown only while autoplay is running (isPlaying), never for a
// manual move. Derived purely from current state and called from renderControls(), which every
// isPlaying change goes through, so it cannot go stale (stopPlayback() only re-renders controls).
function renderHint() {
  const s=state();
  $('board-hint').innerHTML=isComplete(s)?'':(isPlaying?'Moving...':`<span class="mouse-mini" aria-hidden="true"></span><span aria-hidden="true">/</span>Arrow keys: move`);
}
function updateResetControl() {
  $('reset').disabled=isPlaying||(!busy&&frames.length===1&&cursor===0);
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
  const editing=!!window.KunEditor?.active;
  for (const id of ['open-levels','open-help','open-board-data','open-share','edit-mode-button']) $(id).disabled=isPlaying||(editing&&!['open-help','edit-mode-button'].includes(id));
  $('replay-first').disabled=playbackLocked||cursor===0;
  $('replay-back').disabled=playbackLocked||cursor===0;
  $('replay-next').disabled=playbackLocked||cursor>=frames.length-1;
  $('replay-last').disabled=playbackLocked||cursor>=frames.length-1;
  $('replay-play').disabled=!isPlaying&&(busy||!routeComplete);
  const want=isPlaying?'pause':(routeComplete&&cursor===frames.length-1?'replay':'play');
  { const playBtn=$('replay-play'); if(playBtn.dataset.icon!==want){ playBtn.dataset.icon=want; playBtn.innerHTML=icon(want); } }
  $('replay-play').title = `${isPlaying?'Pause':want==='replay'?'Replay from start':'Autoplay route'} (Space)`;
  $('replay-play').setAttribute('aria-label', $('replay-play').title);
  $('replay-speed').disabled=isPlaying;
  $('replay-speed').value=String(settings.speed);
  $('replay-badge').textContent=isPlaying?'PLAYING':frames.length>1?`${cursor} / ${frames.length-1}`:'';
  $('load-solution').disabled=playbackLocked;
  $('solution-input').disabled=isPlaying;
  for(const [id,on] of [['toggle-coords',settings.coordinates],['toggle-labels',settings.labels],['toggle-outline',settings.outline],['toggle-trace',settings.trail]]) {$(id).classList.toggle('active',on);$(id).setAttribute('aria-pressed',String(on));}
  renderHint();
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
  // Per-segment durations: moves are quick, a teleport is a ~1s fade-out / fade-in.
  const TELEPORT_MS=1000;
  const segments=[];for(let i=1;i<path.length;i++)segments.push(path[i].teleport?TELEPORT_MS:path[i].tunnel?108:54);
  const moveTotal=segments.reduce((sum,ms,i)=>sum+(path[i+1].teleport?0:ms),0);
  const moveScale=moveTotal?Math.min(1400,Math.max(180,moveTotal))/moveTotal:1;
  const durations=segments.map((ms,i)=>(path[i+1].teleport?ms:ms*moveScale)/settings.speed);
  const duration=durations.reduce((sum,ms)=>sum+ms,0);
  const svgRoot=element.ownerSVGElement;
  const rings=[];
  function ring(p,color){
    if(!svgRoot)return null;
    const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('r','20');c.setAttribute('fill','none');c.setAttribute('stroke',color);c.setAttribute('stroke-width','4');
    c.setAttribute('transform',`translate(${p.x},${p.y})`);c.setAttribute('pointer-events','none');c.style.opacity='0';
    svgRoot.insertBefore(c,element);rings.push(c);return c;
  }
  const ballColor=element.querySelector('.orb-core')?.style.stroke||'#8feeff';
  // Use the animation-frame clock from the first callback. Its timestamp can
  // precede performance.now() read while scheduling that same frame.
  let start;
  const cleanup=()=>{rings.forEach(r=>r.remove());element.style.opacity='1';};
  const tele=new Map();
  return new Promise(resolve=>{
    function skipAnimation(error){
      // Motion is cosmetic: commit the already-validated move without tweening
      // if rendering fails, rather than leaving the controls permanently busy.
      console.warn('Kunundrum: skipped a failed move animation.',error);
      cleanup();
      resolve(epoch===animationEpoch);
    }
    function frame(now){
      if(epoch!==animationEpoch){cleanup();resolve(false);return;}
      try{
        if(start===undefined)start=now;
        const elapsed=Math.max(0,Math.min(duration,now-start));
        let index=0,acc=0;
        while(index<durations.length-1&&elapsed>=acc+durations[index]){acc+=durations[index];index++;}
        const offset=durations[index]?Math.min(1,(elapsed-acc)/durations[index]):1;
        const a=xy(path[index]),z=xy(path[index+1]);
        if(path[index+1].teleport){
          if(!tele.has(index))tele.set(index,[ring(a,ballColor),ring(z,ballColor)]);
          const [ra,rz]=tele.get(index);
          const ease=t=>t*t*(3-2*t);
          let target,opacity,scale;
          if(offset<.4){const t=ease(offset/.4);target=a;opacity=1-t;scale=1-.75*t;}
          else if(offset<.6){target=z;opacity=0;scale=.25;}
          else{const t=ease((offset-.6)/.4);target=z;opacity=t;scale=.25+.75*t;}
          element.setAttribute('transform',`translate(${target.x},${target.y}) scale(${scale})`);element.style.opacity=String(opacity);
          // Expanding ring at the departure portal while fading out, and at the arrival portal while fading in.
          const pulse=(r,t)=>{if(!r)return;r.style.opacity=t>0&&t<1?String(.9*(1-t)):'0';r.setAttribute('r',String(20+26*t));};
          pulse(ra,Math.min(1,offset/.5));pulse(rz,Math.max(0,(offset-.5)/.5));
        }else if(path[index+1].tunnel){
          // Slide out through the entrance side, then in through the partner's side.
          const D={u:[0,-1],d:[0,1],l:[-1,0],r:[1,0]},ov=D[path[index+1].via],ou=D[path[index+1].out];
          if(offset<.5){const t=offset/.5;element.setAttribute('transform',`translate(${a.x+ov[0]*32*t},${a.y+ov[1]*32*t})`);element.style.opacity=String(1-t);}
          else{const t=(offset-.5)/.5;element.setAttribute('transform',`translate(${z.x+ou[0]*32*(1-t)},${z.y+ou[1]*32*(1-t)})`);element.style.opacity=String(t);}
        }else{
          element.setAttribute('transform',`translate(${a.x+(z.x-a.x)*offset},${a.y+(z.y-a.y)*offset})`);element.style.opacity='1';
        }
        if(elapsed>=duration){cleanup();element.setAttribute('transform',`translate(${xy(path[path.length-1]).x},${xy(path[path.length-1]).y})`);resolve(true);}else requestAnimationFrame(frame);
      }catch(error){
        skipAnimation(error);
      }
    }
    try{requestAnimationFrame(frame);}catch(error){skipAnimation(error);}
  });
}

async function makeMove(id,direction) {
  if(busy||isPlaying)return;
  if(cursor >= MAX_REPLAY_MOVES){toast('This route has reached the 2,000-move limit. Go back to an earlier move to start a new branch.',true);return;}
  showError('replay-error');
  let result;
  try {result=applyMoveAtPhase(state(),board,id,direction,clock.ticks%4);}catch(error){toast(error.message,true);return;}
  if(result.kind!=='ok'){renderBoard();toast(result.message,true);return;}
  const nextRecords = [...frames.slice(1,cursor+1).map(frame=>frame.record),result.record];
  if(formatSolution(nextRecords).length > MAX_ROUTE_CHARACTERS){renderBoard();toast('This route has reached the 10,000-character limit. Go back to an earlier move to start a new branch.',true);return;}
  busy=true;selected=id;renderBoard(result);renderControls();renderMeta();
  const done=await animatePath(id,result.path);
  if(!done)return;
  frames=frames.slice(0,cursor+1);frames.push(result);cursor++;mode='manual';busy=false;
  selected=selectionAfterMove(id);
  render();persist();
  if(isComplete(state()))toast(`Complete in ${state().moves} moves. Final score: ${state().score}.`);
}

function selectionAfterMove(movedId) {
  const balls = state().balls;
  const moved = balls.find(ball => ball.id === movedId);
  if (moved && !moved.locked) return movedId;
  return balls.find(ball => !ball.locked)?.id || movedId;
}
function goTo(index) {
  if(busy||isPlaying)return;
  stopPlayback();cursor=Math.max(0,Math.min(frames.length-1,index));
  if(cursor>0)syncClock(frames[cursor].phases);
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
  clearReplayLocation();
  selected=cursor>0?selectionAfterMove(frames[cursor].record.ballId):(state().balls.find(ball=>!ball.locked)?.id||state().balls[0].id);
  render();persist();
  return true;
}
function clearReplayLocation() {
  try {
    const url=new URL(location.href);
    url.searchParams.delete('at');
    const hash=new URLSearchParams(url.hash.slice(1));
    const code=hash.get('board'),extra={};
    if(code){try{decodeBoard(code,[],extra);if(extra.route)hash.set('board',code.slice(0,code.length-extra.route.length));}catch{}} // a manual move makes the embedded route stale
    hash.delete('at');url.hash=hash.toString();
    history.replaceState(history.state,'',url.href);
  }catch{}
}
function resetRun() {
  cancelMotion();
  gesture=null;clearTimeout(toastTimer);$('toast').className='toast';
  frames=[initialFrame(board)];cursor=0;mode='manual';
  selected=state().balls.find(ball=>!ball.locked)?.id||state().balls[0].id;
  showError('replay-error');
  clearReplayLocation();render();persist();
}
async function nextStep() {
  if(busy||cursor>=frames.length-1)return false;
  const next=frames[cursor+1];
  syncClock(next.phases);
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
    showError('replay-error');render();persist();
    toast(`Loaded ${frames.length-1} moves. ${isComplete(frames.at(-1).state)?'Completes the board.':'Partial route.'}`);
  }catch(error){showError('replay-error',error.message);}
}

function openDialog(id) {stopPlayback();if(!$(id).open)$(id).showModal();}
function closeDialog(dialog) {dialog.close();}
const levelParts = id => id.split('.').map(Number);
// Puzzle dialog state: the scroll position and the selected card survive closing the dialog and reloading the page; the active chapter is derived from the scroll position.
let levelsChapter = null, levelsScroll = null, levelsSelected = null, chapterPin = null, chapterDigits = '', digitTimer = 0;
try { const p = JSON.parse(localStorage.getItem(PUZZLES_KEY)); if (Number.isFinite(p?.scroll) && p.scroll >= 0) levelsScroll = p.scroll; if (typeof p?.selected === 'string') levelsSelected = p.selected; } catch {}
try { localStorage.removeItem('kunundrum.chapter.v1'); } catch {} // superseded by the saved scroll position
// Puzzle dialog: one continuous list of all levels (a section per chapter, 4 cards per row, plain non-sticky chapter headings). Cards are built once;
// previews are rendered lazily when they scroll near the viewport.
let levelCardsBuilt = false, levelObserver = null, spyFrame = 0;
const levelById = new Map(LEVELS.map(level => [level.id, level]));
function fillPreview(el) {
  if (el.firstChild) return;
  const level = levelById.get(el.parentElement.dataset.level);
  if (level) el.innerHTML = renderSvg(level, createInitialState(level), {mini: true});
}
function buildLevelCards() {
  levelCardsBuilt = true;
  const byChapter = new Map();
  for (const level of LEVELS) {
    const a = levelParts(level.id)[0];
    if (!byChapter.has(a)) byChapter.set(a, []);
    byChapter.get(a).push(level);
  }
  for (const list of byChapter.values()) list.sort((x, y) => levelParts(x.id)[1] - levelParts(y.id)[1]);
  $('chapter-bar').innerHTML = Array.from({length: 30}, (_, i) => {
    const a = i + 1;
    return `<button type="button" class="chapter-button${byChapter.has(a) ? '' : ' empty'}" data-chapter="${a}" aria-pressed="false"><strong>${a}</strong></button>`;
  }).join('');
  $('level-cards').innerHTML = [...byChapter.keys()].sort((x, y) => x - y).map(a =>
    `<section class="level-chapter" data-chapter="${a}"><h3 class="chapter-heading">Chapter ${a}</h3><div class="chapter-grid">${byChapter.get(a).map(level =>
      `<button class="level-card" data-level="${escape(level.id)}"><div class="level-preview"></div><div class="level-card-title"><strong>${escape(level.title)}</strong><span></span></div></button>`).join('')}</div></section>`
  ).join('') + '<div class="level-spacer" aria-hidden="true"></div>';
  const previews = $('level-cards').querySelectorAll('.level-preview');
  if (typeof IntersectionObserver === 'function') {
    levelObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { fillPreview(entry.target); levelObserver.unobserve(entry.target); }
    }, {root: $('level-cards'), rootMargin: '500px 0px'});
    previews.forEach(el => levelObserver.observe(el));
  } else previews.forEach(fillPreview);
}
function refreshLevelCards() { // best scores and the current level change between visits
  for (const card of $('level-cards').querySelectorAll('.level-card')) {
    const best = bestScores[card.dataset.level];
    card.classList.toggle('active', currentPresetId === card.dataset.level);
    const known = best ? bestKnownScore(levelById.get(card.dataset.level)) : null;
    card.querySelector('.level-card-title span').innerHTML = best ? `${known === null ? icon('check') : starsHtml(starCount(best.score, known))} ${best.score}` : '';
  }
}
function revealChapterButton() { // keep the active chapter button visible in the chapter bar
  const bar = $('chapter-bar'), act = bar.querySelector('.active');
  if (!act) return;
  const a = act.getBoundingClientRect(), r = bar.getBoundingClientRect();
  if (getComputedStyle(bar).flexDirection === 'row') {
    if (a.left < r.left || a.right > r.right) bar.scrollLeft = act.offsetLeft - bar.offsetLeft - (bar.clientWidth - act.offsetWidth) / 2;
  } else if (a.top < r.top || a.bottom > r.bottom) bar.scrollTop = act.offsetTop - bar.offsetTop - (bar.clientHeight - act.offsetHeight) / 2; // centre, so the previous chapter stays visible
}
function updateChapterSpy() { // the active chapter is the last one whose heading has reached the middle of the list (unless a jump pinned it)
  spyFrame = 0;
  const box = $('level-cards');
  if (!box.clientHeight) return;
  levelsScroll = box.scrollTop;
  let current = null;
  if (chapterPin && Math.abs(box.scrollTop - chapterPin.top) < 2) current = chapterPin.chapter;
  else {
    chapterPin = null;
    const line = box.scrollTop + box.clientHeight / 2;
    for (const sec of box.querySelectorAll('.level-chapter')) {
      if (sec.offsetTop <= line) current = Number(sec.dataset.chapter); else break;
    }
  }
  if (current == null) return;
  levelsChapter = current;
  for (const btn of $('chapter-bar').querySelectorAll('.chapter-button')) {
    const on = Number(btn.dataset.chapter) === current;
    btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', String(on));
  }
  revealChapterButton();
}
function sizeLevelSpacer() { // lets the last (short) chapters scroll up to the top, so every chapter button can be reached
  const box = $('level-cards'), last = box.querySelector('.level-chapter:last-of-type');
  if (last) box.querySelector('.level-spacer').style.height = Math.max(0, box.clientHeight - last.offsetHeight) + 'px';
}
const levelCardList = () => [...$('level-cards').querySelectorAll('.level-card')];
function selectCard(card, scroll = true) { // the keyboard selection: highlighted, focused (Enter opens it) and kept in view
  const box = $('level-cards');
  box.querySelector('.level-card.selected')?.classList.remove('selected');
  card.classList.add('selected');
  levelsSelected = card.dataset.level;
  card.focus({preventScroll: true});
  if (!scroll) return;
  const sec = card.closest('.level-chapter'), b = box.getBoundingClientRect();
  const firstRow = card.getBoundingClientRect().top - sec.querySelector('.chapter-grid').getBoundingClientRect().top < 4;
  let r = card.getBoundingClientRect();
  if (firstRow) { if (sec.getBoundingClientRect().top < b.top) box.scrollTop = sec.offsetTop; } // show the heading with the first row
  else if (r.top < b.top + 8) box.scrollTop += r.top - b.top - 8;
  r = card.getBoundingClientRect();
  if (r.bottom > b.bottom - 8) box.scrollTop += r.bottom - b.bottom + 8;
  chapterPin = {chapter: Number(sec.dataset.chapter), top: box.scrollTop};
  updateChapterSpy();
}
function scrollToChapter(chapter) { // jump to a chapter, keeping the selected position within the chapter (1..10)
  const box = $('level-cards'), sec = box.querySelector(`.level-chapter[data-chapter="${chapter}"]`);
  if (!sec) return;
  box.scrollTop = sec.offsetTop;
  const num = levelParts(levelsSelected || '1.1')[1], cards = [...sec.querySelectorAll('.level-card')];
  selectCard(cards.find(c => levelParts(c.dataset.level)[1] === num) || cards[cards.length - 1]);
}
function neighbourCard(from, dir) { // nearest card in the row above/below, by horizontal centre (rows differ across chapters)
  const r = from.getBoundingClientRect(), cx = r.left + r.width / 2;
  const cand = levelCardList().map(c => ({c, r: c.getBoundingClientRect()})).filter(o => dir > 0 ? o.r.top > r.top + 4 : o.r.top < r.top - 4);
  if (!cand.length) return null;
  const row = dir > 0 ? Math.min(...cand.map(o => o.r.top)) : Math.max(...cand.map(o => o.r.top));
  const inRow = cand.filter(o => Math.abs(o.r.top - row) < 4);
  inRow.sort((x, y) => Math.abs(x.r.left + x.r.width / 2 - cx) - Math.abs(y.r.left + y.r.width / 2 - cx));
  return inRow[0].c;
}
function openLevels() {
  if (!levelCardsBuilt) buildLevelCards();
  refreshLevelCards();
  openDialog('levels-dialog');
  sizeLevelSpacer();
  const box = $('level-cards');
  if (!levelById.has(levelsSelected)) { levelsSelected = levelById.has(currentPresetId) ? currentPresetId : LEVELS[0].id; levelsScroll = null; }
  const card = levelCardList().find(c => c.dataset.level === levelsSelected);
  if (levelsScroll == null) scrollToChapter(levelParts(levelsSelected)[0]);
  else { box.scrollTop = levelsScroll; chapterPin = null; updateChapterSpy(); selectCard(card, false); }
}
function levelsKey(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
  if (/^[0-9]$/.test(event.key)) { // digits type a chapter number (1-30); a pause starts a new number
    chapterDigits += event.key;
    if (Number(chapterDigits) > 30) chapterDigits = event.key;
    clearTimeout(digitTimer); digitTimer = setTimeout(() => { chapterDigits = ''; }, 900);
    event.preventDefault();
    if (Number(chapterDigits) >= 1) scrollToChapter(Number(chapterDigits));
    return;
  }
  const cards = levelCardList(), cur = cards.findIndex(c => c.dataset.level === levelsSelected), from = cards[cur];
  let next = null;
  if (event.key === 'Home') next = cards[0];
  else if (event.key === 'End') next = cards[cards.length - 1];
  else if (!from) { if (event.key.startsWith('Arrow')) next = cards[0]; }
  else if (event.key === 'ArrowLeft') next = cards[Math.max(0, cur - 1)];
  else if (event.key === 'ArrowRight') next = cards[Math.min(cards.length - 1, cur + 1)];
  else if (event.key === 'ArrowUp') next = neighbourCard(from, -1) || from;
  else if (event.key === 'ArrowDown') next = neighbourCard(from, 1) || from;
  if (!next) return;
  event.preventDefault();
  selectCard(next);
}
// Export dialog: a full permalink and a K4 board code (board only); the link optionally carries the current route.
let shareRoute = false;
function shareLink(withRoute) {
  const hasRoute = withRoute && frames.length > 1;
  const {solution:_saved,...bareBoard} = board; // without a route, export no saved solution
  // A route travels inside the board code (K4.<board><route>), so a link with a route always carries the board.
  const input=hasRoute?{board:bareBoard,moves:getNotation(),at:cursor}:OFFLINE||!currentPresetId?{board:bareBoard}:{levelId:currentPresetId};
  // makeShareUrl only accepts http(s) bases, so over file:// build the hash with a placeholder base.
  return OFFLINE?location.href.split(/[?#]/)[0]+new URL(makeShareUrl('https://kunundrum.invalid/',input)).hash:makeShareUrl(location.href,input);
}
function shareCode(withRoute) {
  const code=encodeBoard(board); // an optional compact alphanumeric route follows the board code directly
  return withRoute&&frames.length>1?code+encodeRoute(board,getNotation()):code;
}
function renderShare() {
  const canRoute=frames.length>1, withRoute=shareRoute&&canRoute, n=frames.length-1;
  $('share-include-route').checked=withRoute;
  $('share-include-route').disabled=!canRoute;
  $('share-route-help').textContent=withRoute?`Includes ${n}-move route`:canRoute?'':'Make a move to include a route';
  let link='',code='',error='';
  try{link=shareLink(withRoute);code=shareCode(withRoute);}catch(e){error=e.message;}
  $('share-link').value=link;$('share-code').value=code;
  $('share-code-help').textContent=error||(withRoute?'Board code and route; paste it in Import.':'Board code; paste it in Import.');
  $('share-link-help').textContent=error||(withRoute?`Opens at move ${cursor}.`:'');
}
async function copyText(text,success) {
  try {await navigator.clipboard.writeText(text);toast(success);return true;}
  catch {
    const parent=document.querySelector('dialog[open]')||document.body;
    const temp=document.createElement('textarea');temp.value=text;temp.setAttribute('readonly','');temp.style.position='fixed';temp.style.opacity='0';parent.append(temp);temp.select();
    let ok=false;try{ok=document.execCommand('copy');}catch{}finally{temp.remove();}toast(ok?success:'Automatic copy is unavailable. Select the text and copy it manually.',!ok);return ok;
  }
}
function resetBoardInput() {$('board-input').value='';showError('board-error');}
function importBoard() {
  const input=$('board-input').value.trim();
  try {
    if(!input)throw new Error('Paste a board code, a link or a JSON board first.');
    let nextBoard,share,route;const problems=[];
    if(/^(?:[a-z][a-z0-9+.-]*:\/\/|[?#])/i.test(input)) {
      const cut=input.search(/[?#]/); // only the query and hash matter, so links from file:// and any host work
      share=readShareUrl('https://kunundrum.invalid/'+(cut<0?'':input.slice(cut)));
      const extra={};
      nextBoard=share.boardCode?decodeBoard(share.boardCode,problems,extra):LEVELS.find(level=>level.id===share.levelId);
      if(!nextBoard)throw new Error('This link does not contain a recognized puzzle.');
      if(extra.route&&!problems.length)route=decodeRouteCode(nextBoard,extra.route);
    } else if(/^K\d+\./.test(input)) {
      const extra={}; // `K4.<board><route>`
      nextBoard=decodeBoard(input,problems,extra);
      if(extra.route&&!problems.length)route=decodeRouteCode(nextBoard,extra.route);
    } else nextBoard=decodeBoard(input,problems);
    if(problems.length){editInvalid(nextBoard,problems);clearLocation();$('board-dialog').close();return;}
    const prepared=route?buildReplay(nextBoard,route):undefined;
    adoptBoard(nextBoard,prepared,share?.at||0);
    clearLocation();$('board-dialog').close();toast(`Loaded ${board.title}.`);
  }catch(error){showError('board-error',error.message);}
}
// A well-formed but invalid board opens in the editor (Play is gated by validation there);
// the previous valid run stays loaded underneath.
function editInvalid(draft,problems){
  resetRun(); // a successful import clears the previous run's move history
  // At boot app.js runs before the deferred editor.js, so wait for it.
  if(window.KunEditor)window.KunEditor.openDraft(draft,problems);
  else window.addEventListener('DOMContentLoaded',()=>window.KunEditor.openDraft(draft,problems),{once:true});
  toast(`${draft.title} is not playable yet; opened in the editor.`,true);
}
function clearLocation(){try{history.replaceState(null,'',location.pathname);}catch{}}

// Screenshot import: parser.js (port of parse.py) loads on first use, the recognised board opens
// in the editor, and the review dialog shows the annotated screenshot plus every parser warning.
let parserLoading=null;
function loadParser(){
  if(window.KunParser&&window.KunParserData)return Promise.resolve();
  const load=src=>new Promise((ok,fail)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>fail(new Error('Could not load the screenshot parser.'));document.head.appendChild(s);});
  return parserLoading||(parserLoading=Promise.all([load('./parser_data.js'),load('./parser.js')]).catch(error=>{parserLoading=null;throw error;}));
}
async function importScreenshot(file){
  if(!file||!/^image\//.test(file.type||'')){toast('Choose an image file.',true);return;}
  toast('Reading screenshot…');
  try{
    await loadParser();
    const guess=KunParser.levelFromName(file.name);
    const result=await KunParser.parseFile(file,{level:/^\d{1,2}\.\d{1,2}$/.test(guess)?guess:'imported'});
    const problems=[];
    const draft=decodeBoard(JSON.stringify(result.board),problems);
    clearLocation();
    resetRun(); // a successful import clears the previous run's move history
    if($('board-dialog').open)$('board-dialog').close();
    window.KunEditor.openDraft(draft,problems,true);
    KunParser.renderReview($('shot-review'),result.bitmap,result);
    const b=result.board,n=result.warnings.length;
    $('shot-summary').textContent=`${b.width}×${b.height} board, ${b.balls.length} balls, ${b.goals.length} goals, ${b.teleports.length} teleports.${b.wallColor?` ${{R:'Red',G:'Green'}[b.wallColor]} walls.`:''} ${n?`${n} warning${n>1?'s':''} to review:`:''}`;
    const list=$('shot-warnings');list.replaceChildren(...result.warnings.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    window.KunEditor.setReview($('shot-review'));
    openDialog('shot-dialog');
  }catch(error){toast(`Screenshot import failed: ${error.message}`,true);}
}

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
$('solution-input').addEventListener('input',()=>{if(isPlaying)return;showError('replay-error');updateResetControl();persist();});
$('solution-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();loadSolution(event.target.value);}});
$('copy-route').addEventListener('click',()=>{const text=getNotation(cursor);if(!text){toast('No moves to copy yet.');return;}copyText(text,'Route notation copied.');});
$('move-history').addEventListener('click',event=>{if(busy||isPlaying)return;const target=event.target.closest('[data-jump]');if(target)goTo(Number(target.dataset.jump));});
$('toggle-coords').addEventListener('click',()=>{settings.coordinates=!settings.coordinates;if(!busy)renderBoard();renderControls();persist();});
$('toggle-trace').addEventListener('click',()=>{settings.trail=!settings.trail;if(!busy)renderBoard();renderControls();persist();});
$('toggle-labels').addEventListener('click',()=>{settings.labels=!settings.labels;if(!busy)renderBoard();renderControls();persist();});
$('toggle-outline').addEventListener('click',()=>{settings.outline=!settings.outline;if(!busy)renderBoard();renderControls();persist();});
$('open-levels').addEventListener('click',openLevels);
$('levels-dialog').addEventListener('keydown',levelsKey);
$('levels-dialog').addEventListener('close',()=>{try{localStorage.setItem(PUZZLES_KEY,JSON.stringify({scroll:levelsScroll,selected:levelsSelected}));}catch{}});
$('level-cards').addEventListener('scroll',()=>{if(!spyFrame)spyFrame=requestAnimationFrame(updateChapterSpy);});
window.addEventListener('resize',()=>{if(levelCardsBuilt&&$('levels-dialog').open)sizeLevelSpacer();});
$('chapter-bar').addEventListener('click',event=>{const b=event.target.closest('[data-chapter]');if(b)scrollToChapter(Number(b.dataset.chapter));});
$('completion-inline').addEventListener('click',event=>{if(busy||isPlaying)return;if(event.target.closest('#new-random')){newRandom();return;}if(!event.target.closest('#next-puzzle'))return;const next=nextLevel();if(next){adoptBoard(next);clearLocation();}});
$('level-cards').addEventListener('click',event=>{const target=event.target.closest('[data-level]');if(!target)return;const next=LEVELS.find(level=>level.id===target.dataset.level);if(next){levelsSelected=next.id;adoptBoard(next);clearLocation();$('levels-dialog').close();}});
$('open-help').addEventListener('click',()=>openDialog('help-dialog'));
$('open-share').addEventListener('click',()=>{shareRoute=true;$('share-include-route').checked=true;renderShare();openDialog('share-dialog');});
$('share-include-route').addEventListener('change',event=>{shareRoute=event.target.checked;renderShare();});
$('copy-link').addEventListener('click',()=>copyText($('share-link').value,'Permalink copied.'));
$('copy-code').addEventListener('click',()=>copyText($('share-code').value,'K4 code copied.'));
for(const id of ['share-link','share-code'])$(id).addEventListener('click',event=>event.target.select());
$('open-board-data').addEventListener('click',()=>{resetBoardInput();openDialog('board-dialog');loadParser().then(()=>{$('parser-version').textContent='v'+KunParser.PARSER_VERSION;},()=>{});});
$('load-board').addEventListener('click',importBoard);
$('import-shot').addEventListener('click',()=>$('shot-file').click());
$('shot-file').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';importScreenshot(file);});
window.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
window.addEventListener('drop',event=>{const file=[...(event.dataTransfer?.files||[])].find(f=>/^image\//.test(f.type));if(!file)return;event.preventDefault();if($('board-dialog').open)importScreenshot(file);});
$('board-input').addEventListener('input',()=>showError('board-error'));
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>closeDialog(button.closest('dialog'))));
document.querySelectorAll('dialog').forEach(dialog=>{
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog(dialog);});
});

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
  // E toggles the editor (also while editing, hence before the editor bail-out below).
  if(event.key.toLowerCase()==='e'&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.isComposing&&!document.querySelector('dialog[open]')&&!event.target.isContentEditable&&!event.target.closest('input,textarea,select')){
    event.preventDefault();const edit=$('edit-mode-button');
    if(!event.repeat&&!edit.disabled&&!isPlaying&&!busy)edit.click();
    return;
  }
  if(event.isComposing||document.querySelector('dialog[open]')||window.KunEditor?.active)return;
  // Allow held Previous/Next shortcuts to step through the recorded route.
  // Prevent held movement and other commands from firing repeatedly.
  const repeatingNavigation = !event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey && ['z','x','pageup','pagedown'].includes(event.key.toLowerCase());
  if(event.repeat&&!repeatingNavigation)return;
  if(event.target.isContentEditable||event.target.closest('input,textarea,select'))return;
  if((event.code==='Space'||event.key===' ')&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey){
    event.preventDefault();playRoute();return;
  }
  const viewToggle=!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&{c:'toggle-coords',l:'toggle-labels',o:'toggle-outline',t:'toggle-trace'}[event.key.toLowerCase()];
  if(viewToggle){event.preventDefault();$(viewToggle).click();return;}
  // N = Next puzzle, P = Puzzles, S = Solver, only while the matching button is available. Shift+S = load the saved solution (a hidden shortcut, shown nowhere in the UI).
  const action=!event.ctrlKey&&!event.metaKey&&!event.altKey&&(!event.shiftKey&&{n:$('new-random')?'new-random':'next-puzzle',p:'open-levels',s:'open-solver'}[event.key.toLowerCase()]);
  if(event.shiftKey&&event.key==='S'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){if(board.solution&&!isPlaying&&!busy&&$('load-solution').offsetParent!==null){event.preventDefault();loadSolution(board.solution);}return;}
  if(action){const button=$(action);if(button&&!button.disabled&&!isPlaying&&!busy&&button.offsetParent!==null){event.preventDefault();button.click();return;}}
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

// The board the editor opens on: the position at the replay cursor (current ball positions, gate/teleport states,
// consumed hexagons removed) as a regular starting board. At move 0 this is the board itself.
function boardAtCursor() {
  const b = JSON.parse(JSON.stringify(board));
  if (cursor === 0) return b;
  const s = state(), consumed = new Set(s.consumedHexIds);
  b.balls = s.balls.map(({ locked, ...ball }) => ball);
  for (const g of b.gates) g.active = s.gateActive[g.id];
  for (const t of b.teleports) t.active = s.teleportActive[t.id];
  b.hexes = b.hexes.filter(h => !consumed.has(h.id));
  for (const sw of b.switches) delete sw.on; // derived again by validateBoard from the elements' states
  return validateBoard(b);
}
window.KunundrumHost = {
  getBoard:boardAtCursor,
  svg:draft=>renderSvg(draft,createInitialState(draft),{outlinedBallId:null}),
  stop:()=>cancelMotion(),
  play:draft=>{adoptBoard(validateBoard(draft));clearReplayLocation();persist();}, // an edited board always starts a fresh run: the old route is dropped
  resume:()=>{render();},
  toast:message=>toast(message),
  // Solver dialog (solver-ui.js): the current board as a K4 code, plus the score and move count of the CURRENT route (the full move history, `frames`, not just the moves up to the cursor and independent of the Replay text box) when it finishes the board. Stops any playback.
  prepareSolver:()=>{
    stopPlayback();
    const {solution,...bare}=board,info={code:encodeBoard(bare),title:board.title,id:currentPresetId,route:null};
    // The position at the replay cursor as a board of its own (the score so far is not part of it); at move 0 it equals the start board.
    const {solution:_s,...here}=boardAtCursor();info.position={code:encodeBoard(here),at:cursor,total:frames.length-1};
    if(frames.length>1){const s=frames[frames.length-1].state;if(isComplete(s))info.route={score:s.score,moves:frames.length-1};}
    return info;
  },
  copy:(text,message)=>copyText(text,message),
  showReview:()=>openDialog('shot-dialog'),
  // Genuine board artwork for one tile, cropped from a 3x3 board so it looks exactly as on the board.
  icon:spec=>{
    const at={x:2,y:2},c=['R','G','B','Y'].includes(spec.color)?spec.color:'R';
    const b={id:'icon-'+spec.type,title:'',width:3,height:3,walls:[],balls:[],goals:[],arrows:[],gates:[],switches:[],teleports:[],hexes:[]};
    if(spec.type==='ball')b.balls.push({...at,color:c,id:c});
    if(spec.type==='goal')b.goals.push({...at,color:c});
    if(spec.type==='wall'){b.walls.push(at);if(spec.wallColor)b.wallColor=spec.wallColor;}
    if(spec.type==='gate')b.gates.push({...at,id:'G1',active:spec.active!==false});
    if(spec.type==='switch')b.switches.push({...at,id:'S',controls:[]});
    if(spec.type==='arrow')b.arrows.push({...at,direction:spec.direction||'r',...(spec.rotating?{rotating:true,...(spec.arrowType&&spec.arrowType!=='cw'?{type:spec.arrowType}:{})}:{})});
    if(spec.type==='teleport')b.teleports.push({...at,id:'T1',color:spec.color||'*',active:spec.active!==false});
    if(spec.type==='hex')b.hexes.push({...at,id:'hex1',value:spec.value||-5});
    if(spec.type==='tunnel')b.tunnels=[{a:{...at,side:'l'},b:{...at,side:'r'}}];
    return renderSvg(b,createInitialState(b),{mini:true}).replace(/<text class="tile-label"[^>]*>[^<]*<\/text>/g,'').replace(/viewBox="[^"]*"/,`viewBox="${spec.type==='tunnel'?'68 68 76 76':'74 74 64 64'}"`).replace('<svg class="board-svg"','<svg class="tool-icon-svg"');
  },
};
function boot() {
  let saved=null;
  try {
    const stored=localStorage.getItem(STORAGE_KEY);if(stored&&stored.length<120000)saved=JSON.parse(stored);
    const best=JSON.parse(localStorage.getItem(BEST_KEY)||'{}');
    if(best&&typeof best==='object')bestScores=Object.fromEntries(Object.entries(best).filter(([id,value])=>LEVELS.some(level=>level.id===id)&&Number.isInteger(value?.score)&&Number.isInteger(value?.moves)));
  }catch{storageAvailable=false;}
  if(!viewSettingsInitialized) {
    const previous=saved?.settings;
    settings.coordinates=previous?.coordinates===true;
    settings.labels=previous?.labels!==false; // default on
    settings.trail=previous?.trail===true;
    settings.outline=previous?.outline===true;
    settings.speed=[.5,1,2].includes(previous?.speed)?previous.speed:1;
    viewSettingsInitialized=true;
  }
  try {
    const shared=readShareUrl(OFFLINE?'https://kunundrum.invalid/'+location.search+location.hash:location.href);
    if(shared.boardCode||shared.levelId){
      const problems=[],extra={};
      const next=shared.boardCode?decodeBoard(shared.boardCode,problems,extra):shared.levelId?LEVELS.find(level=>level.id===shared.levelId):LEVELS[0];
      if(!next)throw new Error(`Unknown puzzle ${shared.levelId}. Choose one from the collection.`);
      if(problems.length){adoptBoard(LEVELS[0]);editInvalid(next,problems);return;}
      const prepared=extra.route?buildReplay(next,decodeRouteCode(next,extra.route)):undefined;
      adoptBoard(next,prepared,shared.at||0);
    }else if(saved?.board){
      const next=decodeBoard(saved.board);if(typeof saved.title==='string'&&saved.title&&saved.title.length<=80)next.title=saved.title; // custom boards keep their title (the K4 code has none)
      if(typeof saved.solution==='string'&&saved.solution.length<=10000)next.solution=saved.solution; // a generated board keeps its best known route (needed for stars)
      const prepared=saved.moves?buildReplay(next,saved.moves):undefined;
      adoptBoard(next,prepared,Number.isInteger(saved.at)?saved.at:0);
      if(cursor===0&&state().balls.some(ball=>ball.id===saved.selected&&!ball.locked))selected=saved.selected;
      mode=saved.mode==='replay'?'replay':'manual';
      if(typeof saved.draft==='string'&&saved.draft.length<=10000)$('solution-input').value=saved.draft;
      render();
    }else adoptBoard(LEVELS[0]);
  }catch(error){adoptBoard(LEVELS[0]);toast(`Could not load this run: ${error.message}`,true);}
}
boot();
window.addEventListener('hashchange',()=>{if(/(?:^|&)(?:board|level|at)=/.test(location.hash.slice(1)))boot();});
window.addEventListener('beforeunload',persist);

})();
