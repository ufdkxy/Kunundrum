/* K4 text board code (K4.md), compact binary routes, and share links. */
'use strict';
const Codec = (() => {
const { validateBoard,parseSolution,resolveBallId,createInitialState,applyMove,formatSolution } = Core;

/** A code identifies a board, independent of any later moves made on it. */
const MAX_BOARD_CODE_LENGTH = 1_000;
const MAX_ROUTE_CODE_LENGTH = 20_000; // a route may follow the board code
const MAX_MOVES_LENGTH = 10_000;
const MAX_URL_LENGTH = 131_072;
const MAX_REPLAY_POSITION = 10_000;

/** Compact route (binary move stream): varint number of moves; one byte choice mode; packed move
 * indices (ball index * 4 + direction, ceil(log2(ballCount*4)) bits each).
 * Choice mode 0: no rotating-arrow annotations. Choice mode 1: uint choice
 * count for each move, followed by 2-bit packed choices. All pads are zero.
 * Ball indices refer to Core.validateBoard's stable color/position ordering.
 */
function compactSolution(board, notation) {
  const tokens = parseSolution(notation);
  if (!tokens.length || tokens.length > 10000) throw new Error('Invalid compact route solution move count.');
  const directionIndex = 'udlr';
  const bitsPerMove = Math.ceil(Math.log2(board.balls.length * 4));
  const out = [];
  const putUint = value => { do { let n=value%128; value=Math.floor(value/128);out.push(n|(value?128:0)); } while(value); };
  const pushBits = (values, width) => {
    let current=0,used=0;
    for(const value of values) {
      if(value >= 2 ** width) throw new Error('Invalid compact route packed move.');
      for(let k=width-1;k>=0;k--) {
        current=(current<<1)|((value>>>k)&1); used++;
        if(used===8) {out.push(current);current=0;used=0;}
      }
    }
    if(used) out.push(current<<(8-used));
  };
  // Resolve abbreviated names against the live replay state, so numeric/short
  // identifiers retain exactly the same meaning as the full solution parser.
  let state=createInitialState(board);
  const records=[],moves=[],choices=[];
  for(const token of tokens) {
    const id=resolveBallId(state,token.identifier);
    const bi=board.balls.findIndex(b=>b.id===id);
    if(bi<0) throw new Error('Unknown ball.');
    moves.push(bi*4+directionIndex.indexOf(token.direction));
    choices.push(token.choices.map(c=>directionIndex.indexOf(c)));
    const result=applyMove(state,board,id,token.direction,token.choices);
    if(result.kind!=='ok') throw new Error(`Cannot encode invalid saved solution at move ${moves.length}: ${result.message}`);
    records.push(result.record); state=result.state;
  }
  putUint(moves.length);
  const hasChoices=choices.some(a=>a.length);
  out.push(hasChoices?1:0);
  pushBits(moves,bitsPerMove);
  if(hasChoices) {
    for(const item of choices)putUint(item.length);
    pushBits(choices.flat(),2);
  }
  return new Uint8Array(out);
}
function expandSolution(board, bytes) {
  let offset=0;
  const readByte=()=>{if(offset>=bytes.length)throw new Error('Truncated compact route solution.');return bytes[offset++];};
  const readUint=()=>{let value=0,m=1;for(let i=0;i<8;i++){const b=readByte();value+=(b&127)*m;if(!Number.isSafeInteger(value))throw new Error('Invalid compact route move count.');if(!(b&128))return value;m*=128;}throw new Error('Invalid compact route integer.');};
  const readBits=(count,width)=>{
    const size=Math.ceil(count*width/8);
    if(offset+size>bytes.length)throw new Error('Truncated compact route bitstream.');
    const result=[];
    for(let i=0;i<count;i++){
      let v=0;
      for(let j=0;j<width;j++){
        const bitIndex=i*width+j;
        v=(v<<1)|((bytes[offset+(bitIndex>>3)]>>(7-(bitIndex&7)))&1);
      }
      result.push(v);
    }
    if(size && count*width%8) {
      const padding=8-count*width%8;
      if(bytes[offset+size-1]&((1<<padding)-1))throw new Error('Nonzero compact route padding.');
    }
    offset+=size;
    return result;
  };
  const count=readUint();
  if(!count||count>10000)throw new Error('Invalid compact route move count.');
  const mode=readByte();if(mode>1)throw new Error('Unsupported compact route choice mode.');
  const values=readBits(count,Math.ceil(Math.log2(board.balls.length*4)));
  const counts=mode?Array.from({length:count},readUint):Array(count).fill(0);
  const total=counts.reduce((a,b)=>a+b,0);
  if(total>10000)throw new Error('Too many rotating-arrow choices.');
  const allChoices=mode?readBits(total,2):[];
  if(offset!==bytes.length)throw new Error('Unexpected compact route solution bytes.');
  let ci=0,state=createInitialState(board);
  const records=[];
  for(let i=0;i<count;i++) {
    const value=values[i],bi=Math.floor(value/4),direction='udlr'[value%4];
    if(bi>=board.balls.length)throw new Error('Invalid compact route ball index.');
    const choices=allChoices.slice(ci,ci+counts[i]).map(v=>'udlr'[v]);ci+=counts[i];
    const result=applyMove(state,board,board.balls[bi].id,direction,choices);
    if(result.kind!=='ok')throw new Error(`Invalid compact route saved solution at move ${i+1}: ${result.message}`);
    records.push(result.record);state=result.state;
  }
  return formatSolution(records);
}

const CODE_COLORS = 'RGBY*';
const CODE_DIRECTIONS = 'udlr';
/* ---- K4: short, canonical, alphanumeric board code (board data only; see K4.md for the specification) ---- */
const N62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const K4_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'; // grid symbols in K4.md §3.2 order (offsets below)
const K4_WALL = 0, K4_GAP = 6, K4_ARROW = 10, K4_GOAL = 14, K4_GATE = 18, K4_SWITCH = 20, K4_TELE = 21, K4_ROT = 31, K4_HEX = 43, K4_RESERVED = 51;
const K4_HEX_VALUES = [-20, -15, -10, -5, 5, 10, 15, 20];
const K4_ARROW_TYPES = ['cw', 'ccw', 'flip'];
const K4_STEP = { u: [0, 1], d: [0, -1], l: [-1, 0], r: [1, 0] };
const K4_BALL_COLORS = 'RGBY';
const K4_PREFIX = 'K4.';

/** Perimeter index of a board-edge opening (K4.md §3.3) and its inverse. */
function k4Perimeter(w, h, x, y, side) {
  if (side === 'd') return x - 1;
  if (side === 'r') return w + (y - 1);
  if (side === 'u') return w + h + (w - x);
  return 2 * w + h + (h - y);
}
function k4FromPerimeter(w, h, i) {
  if (i < w) return { x: i + 1, y: 1, side: 'd' };
  if (i < w + h) return { x: w, y: i - w + 1, side: 'r' };
  if (i < 2 * w + h) return { x: w - (i - w - h), y: h, side: 'u' };
  return { x: 1, y: h - (i - 2 * w - h), side: 'l' };
}

function encodeK4(input) {
  const b = validateBoard(input);
  const fail = message => { throw new Error('K4: ' + message); };
  const w = b.width, h = b.height, total = w * h;
  if (w > 15 || h > 15) fail('boards are limited to 15 x 15 cells.');
  if (b.balls.length > 61) fail('at most 61 balls are supported.');
  const wallColor = b.wallColor === undefined ? 0 : b.wallColor === 'R' ? 1 : b.wallColor === 'G' ? 2 : fail('wall color must be blue, red or green.');
  const at = p => (p.y - 1) * w + p.x - 1;
  const sym = new Array(total).fill(-1); // letter index, -1 = plain floor
  const isWall = new Array(total).fill(false), gapDir = new Array(total).fill(-1);
  for (const p of b.walls) { isWall[at(p)] = true; sym[at(p)] = K4_WALL; }
  for (const p of b.goals) sym[at(p)] = K4_GOAL + 'RGBY'.indexOf(p.color);
  for (const p of b.arrows) sym[at(p)] = p.rotating ? K4_ROT + K4_ARROW_TYPES.indexOf(p.type ?? 'cw') * 4 + CODE_DIRECTIONS.indexOf(p.direction) : K4_ARROW + CODE_DIRECTIONS.indexOf(p.direction);
  for (const p of b.gates) sym[at(p)] = K4_GATE + (p.active ? 1 : 0);
  for (const p of b.switches) sym[at(p)] = K4_SWITCH;
  for (const p of b.teleports) sym[at(p)] = K4_TELE + CODE_COLORS.indexOf(p.color) * 2 + (p.active ? 0 : 1);
  for (const p of b.hexes) {
    const k = K4_HEX_VALUES.indexOf(p.value);
    if (k < 0) fail(`hexagon value ${p.value} is not one of ${K4_HEX_VALUES.join(', ')}.`);
    sym[at(p)] = K4_HEX + k;
  }
  // Tunnels: every opening sits on a wall cell (gap letter) or the board edge (perimeter index).
  const tunnels = b.tunnels ?? [];
  if (tunnels.length > 31) fail('at most 31 tunnel pairs are supported.');
  const ends = [];
  tunnels.forEach((t, pair) => {
    for (const e of [t.a, t.b]) {
      const [dx, dy] = K4_STEP[e.side], nx = e.x + dx, ny = e.y + dy;
      if (nx < 1 || nx > w || ny < 1 || ny > h) { ends.push({ pair, edge: true, order: k4Perimeter(w, h, e.x, e.y, e.side) }); continue; }
      const cell = at({ x: nx, y: ny });
      if (!isWall[cell]) fail(`the tunnel opening at (${e.x},${e.y}) must face a wall cell or the board edge.`);
      if (gapDir[cell] >= 0) fail(`the wall cell (${nx},${ny}) carries more than one tunnel opening.`);
      gapDir[cell] = CODE_DIRECTIONS.indexOf(e.side);
      ends.push({ pair, edge: false, order: cell });
    }
  });
  ends.sort((p, q) => (p.edge - q.edge) || p.order - q.order);
  const edgeOrders = ends.filter(e => e.edge).map(e => e.order);
  const firstOf = new Map(), partner = new Array(ends.length);
  ends.forEach((e, i) => { if (firstOf.has(e.pair)) { const j = firstOf.get(e.pair); partner[i] = j; partner[j] = i; } else firstOf.set(e.pair, i); });
  // Grid.
  let grid = '', floorRun = 0, wallRun = 0;
  const flushFloor = () => { if (floorRun) grid += floorRun; floorRun = 0; };
  const flushWall = () => { if (wallRun) { grid += K4_LETTERS[K4_WALL + 5].repeat(Math.floor(wallRun / 6)) + (wallRun % 6 ? K4_LETTERS[K4_WALL + wallRun % 6 - 1] : ''); } wallRun = 0; };
  for (let i = 0; i < total; i++) {
    if (isWall[i] && gapDir[i] < 0) { flushFloor(); wallRun++; continue; }
    flushWall();
    if (isWall[i]) { flushFloor(); grid += K4_LETTERS[K4_GAP + gapDir[i]]; }
    else if (sym[i] < 0) floorRun++;
    else { flushFloor(); grid += K4_LETTERS[sym[i]]; }
  }
  flushFloor(); flushWall();
  let out = K4_PREFIX + N62[w] + N62[h] + N62[wallColor] + grid + N62[edgeOrders.length] + edgeOrders.map(i => N62[i]).join('');
  // Pairing: the lowest unpaired opening is paired with the j-th other unpaired opening; the last pair is implied.
  let unpaired = ends.map((_, i) => i);
  while (unpaired.length > 2) {
    const rest = unpaired.slice(1), j = rest.indexOf(partner[unpaired[0]]);
    out += N62[j];
    unpaired = rest.filter((_, k) => k !== j);
  }
  // Switch mapping.
  if (b.switches.length) {
    const groupOfKey = new Map(), switchGroup = [], member = new Map();
    for (const sw of b.switches) {
      if (!sw.controls.length) fail(`switch ${sw.id} controls nothing.`);
      const key = [...sw.controls].sort().join(',');
      if (!groupOfKey.has(key)) {
        if (groupOfKey.size >= 61) fail('at most 61 switch groups are supported.');
        groupOfKey.set(key, groupOfKey.size + 1);
        for (const id of sw.controls) { if (member.has(id)) fail(`switch control lists must be identical or disjoint (${id}).`); member.set(id, groupOfKey.size); }
      }
      switchGroup.push(groupOfKey.get(key));
    }
    const gateGroup = b.gates.map(g => member.get(g.id) ?? fail(`gate ${g.id} is not controlled by any switch.`));
    const teleGroup = b.teleports.map(t => member.get(t.id) ?? (t.active ? 0 : fail(`inactive teleport ${t.id} is not controlled by any switch.`)));
    const groups = groupOfKey.size;
    out += N62[groups];
    if (groups > 1) out += [...switchGroup, ...gateGroup].map(g => N62[g]).join('');
    out += teleGroup.map(g => N62[g]).join('');
  } else if (b.gates.length) fail('gates need at least one switch.');
  else if (b.teleports.some(t => !t.active)) fail('inactive teleports need a switch.');
  // Balls.
  const values = b.balls.map(p => 4 * at(p) + K4_BALL_COLORS.indexOf(p.color)).sort((p, q) => p - q);
  out += N62[values.length] + values.map(v => N62[Math.floor(v / 62)] + N62[v % 62]).join('');
  return out;
}

function decodeK4(code, problems, extra) {
  const fail = message => { throw new Error('Invalid K4 board code: ' + message); };
  if (!code.startsWith(K4_PREFIX) || !/^[0-9A-Za-z]+$/.test(code.slice(3))) fail('only letters and digits may follow "K4.".');
  let s = code.slice(3);
  let pos = 0;
  const next = () => { if (pos >= s.length) fail('the code is truncated.'); return s[pos++]; };
  const num = (max, what) => { const c = next(), v = N62.indexOf(c); if (v > max) fail(`${what} is out of range.`); return v; };
  const width = N62.indexOf(next()), height = N62.indexOf(next());
  if (width < 1 || width > 15 || height < 1 || height > 15) fail('the board size must be 1 to 15 in each direction.');
  const wc = num(2, 'the wall color');
  const w = width, total = w * height;
  const raw = { width, height, walls: [], goals: [], arrows: [], gates: [], switches: [], teleports: [], hexes: [], balls: [] };
  if (wc) raw.wallColor = wc === 1 ? 'R' : 'G';
  const gaps = []; // wall cell + side
  const spot = i => ({ x: i % w + 1, y: Math.floor(i / w) + 1 });
  let cell = 0;
  while (cell < total) {
    const remaining = total - cell, c = next();
    if (c >= '0' && c <= '9') {
      if (c === '0') fail('a floor run cannot start with 0.');
      let v = +c;
      while (v < remaining && pos < s.length && s[pos] >= '0' && s[pos] <= '9') v = v * 10 + +s[pos++];
      if (v > remaining) fail('the grid is longer than the board.');
      cell += v; continue;
    }
    const li = K4_LETTERS.indexOf(c);
    if (li < 0) fail(`unknown symbol "${c}".`);
    if (li === K4_RESERVED) fail('the symbol Z is reserved.');
    if (li < K4_GAP) { const n = li - K4_WALL + 1; if (n > remaining) fail('the grid is longer than the board.'); for (let k = 0; k < n; k++) raw.walls.push(spot(cell + k)); cell += n; continue; }
    const p = spot(cell++);
    if (li < K4_ARROW) { raw.walls.push(p); gaps.push({ cell: cell - 1, side: CODE_DIRECTIONS[li - K4_GAP] }); }
    else if (li < K4_GOAL) raw.arrows.push({ ...p, direction: CODE_DIRECTIONS[li - K4_ARROW] });
    else if (li < K4_GATE) raw.goals.push({ ...p, color: 'RGBY'[li - K4_GOAL] });
    else if (li < K4_SWITCH) raw.gates.push({ ...p, active: li === K4_GATE + 1 });
    else if (li === K4_SWITCH) raw.switches.push({ ...p });
    else if (li < K4_ROT && li < K4_TELE + 10) { const k = li - K4_TELE; raw.teleports.push({ ...p, color: CODE_COLORS[k >> 1], active: !(k & 1) }); }
    else if (li < K4_HEX) { const k = li - K4_ROT, type = K4_ARROW_TYPES[k >> 2]; raw.arrows.push({ ...p, direction: CODE_DIRECTIONS[k & 3], rotating: true, ...(type !== 'cw' ? { type } : {}) }); }
    else raw.hexes.push({ ...p, value: K4_HEX_VALUES[li - K4_HEX] });
  }
  // Tunnel openings: wall gaps in cell order, then edge openings in perimeter order.
  const openings = gaps.map(g => { const [dx, dy] = K4_STEP[g.side], q = spot(g.cell), x = q.x - dx, y = q.y - dy; if (x < 1 || x > w || y < 1 || y > height) fail('a tunnel gap has no floor cell next to it.'); return { x, y, side: g.side }; });
  const edgeCount = num(61, 'the edge opening count');
  for (let k = 0; k < edgeCount; k++) { const i = N62.indexOf(next()); if (i >= 2 * (w + height)) fail('an edge opening index is out of range.'); openings.push(k4FromPerimeter(w, height, i)); }
  if (openings.length % 2) fail('the number of tunnel openings is odd.');
  if (openings.length) {
    raw.tunnels = [];
    let unpaired = openings.map((_, i) => i);
    while (unpaired.length > 2) {
      const rest = unpaired.slice(1), j = N62.indexOf(next());
      if (j >= rest.length) fail('a tunnel pairing index is out of range.');
      raw.tunnels.push({ a: openings[unpaired[0]], b: openings[rest[j]] });
      unpaired = rest.filter((_, k) => k !== j);
    }
    raw.tunnels.push({ a: openings[unpaired[0]], b: openings[unpaired[1]] });
  }
  // Ids come from cell order; switch control lists are rebuilt from the group numbers.
  raw.gates.forEach((g, i) => { g.id = 'G' + (i + 1); });
  raw.teleports.forEach((t, i) => { t.id = 'T' + (i + 1); });
  raw.switches.forEach((sw, i) => { sw.id = 'S' + (i + 1); sw.controls = []; });
  raw.hexes.forEach((x, i) => { x.id = 'hex' + (i + 1); });
  if (raw.switches.length) {
    const groups = num(61, 'the switch group count');
    if (!groups) fail('a board with switches needs at least one switch group.');
    const swGroup = [], gateGroup = [];
    if (groups === 1) { raw.switches.forEach(() => swGroup.push(1)); raw.gates.forEach(() => gateGroup.push(1)); }
    else {
      for (const list of [swGroup, gateGroup]) for (let k = 0; k < (list === swGroup ? raw.switches.length : raw.gates.length); k++) { const g = N62.indexOf(next()); if (g < 1 || g > groups) fail('a switch or gate group number is out of range.'); list.push(g); }
    }
    const teleGroup = raw.teleports.map(() => num(groups, 'a teleport group number'));
    raw.switches.forEach((sw, i) => {
      sw.controls = [...raw.gates.filter((_, k) => gateGroup[k] === swGroup[i]).map(g => g.id), ...raw.teleports.filter((_, k) => teleGroup[k] === swGroup[i]).map(t => t.id)];
      if (!sw.controls.length) fail('a switch group controls nothing.');
    });
  }
  const ballCount = num(61, 'the ball count');
  if (!ballCount) fail('a board needs at least one ball.');
  for (let k = 0; k < ballCount; k++) {
    const v = N62.indexOf(next()) * 62 + N62.indexOf(next());
    if (v >= 4 * total) fail('a ball position is out of range.');
    raw.balls.push({ ...spot(v >> 2), color: K4_BALL_COLORS[v & 3] });
  }
  if (extra && pos < s.length) { // `K4.<board><route>`: the board is self-delimiting, so whatever follows the balls is the base-62 route
    extra.route = s.slice(pos);
    s = s.slice(0, pos); code = K4_PREFIX + s;
  }
  if (pos !== s.length) fail('unexpected characters after the balls.');
  const own = [], board = validateBoard(raw, problems ?? own);
  if (!(problems ?? own).length) { // strict: only the canonical spelling is accepted
    let again;
    try { again = encodeK4(board); } catch (error) { fail(error.message.replace(/^K4: /, '')); }
    if (again !== code) fail('the code is not in canonical form.');
  }
  return board;
}

/** The K4 code identifies the board only (no id, title, description or solution). */
function encodeBoard(board)         {
  const code = encodeK4(board);
  if (code.length > MAX_BOARD_CODE_LENGTH) throw new Error('This board is too large for a shareable code.');
  return code;
}

function parseJsonBoard(json        , problems         )        {
  let raw         ;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("The board data is not valid JSON. Check its brackets, commas, and quotes.");
  }
  return validateBoard(raw, problems);
}

/** Accepts a board code, a JSON board, or a complete shared-board URL. */
/** With a `problems` array, an unreadable-but-structurally-parsable board is returned and its validity problems are listed there instead of thrown. */
function decodeBoard(input        , problems         , extra)        {
  // With an `extra` object, a route after the K4 board code is returned in extra.route (decode it with decodeRouteCode).
  if (typeof input !== "string") throw new Error("Paste a board code or JSON board.");
  let code = input.trim();
  if (!code) throw new Error("Paste a board code, board link, or JSON board first.");

  if (/^https?:\/\//i.test(code) || /^[?#]/.test(code)) {
    const shared = readShareUrl(code);
    if (!shared.boardCode) {
      throw new Error("That link identifies a preset level, not a custom board code. Use the level selector to open it.");
    }
    code = shared.boardCode;
  }

  if (code.length > MAX_BOARD_CODE_LENGTH + (extra ? MAX_ROUTE_CODE_LENGTH : 0)) {
    throw new Error("The board data is too large (maximum 1,000 characters).");
  }
  if (code.startsWith("{")) return parseJsonBoard(code, problems);
  if (code.startsWith(K4_PREFIX)) return decodeK4(code, problems, extra);
  if (/^K\d+\./.test(code)) throw new Error('Unsupported board-code version; this player supports K4.');
  throw new Error('A board code must start with K4.');
}

function parseUrl(input        )      {
  if (typeof input !== "string" || input.length > MAX_URL_LENGTH) {
    throw new Error("The shared link is too long or invalid.");
  }
  let url     ;
  try {
    url = new URL(input, "https://kunundrum.invalid/");
  } catch {
    throw new Error("The shared link is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("A shared board link must use http or https.");
  }
  return url;
}

function oneParameter(query                 , hash                 , key        )                     {
  const values = [...query.getAll(key), ...hash.getAll(key)];
  if (values.length > 1) throw new Error(`The shared link contains more than one ${key} value.`);
  return values[0];
}

function checkLevelId(value        )         {
  if (!value || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("The shared level identifier is invalid.");
  }
  return value;
}

function checkMoves(value        )         {
  if (value.length > MAX_MOVES_LENGTH) throw new Error("A shared replay can contain at most 10,000 characters.");
  return value;
}

function checkPosition(value        )         {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_REPLAY_POSITION) {
    throw new Error("The replay position must be a whole number from 0 to 10,000.");
  }
  return value;
}

/** Reads a URL without executing or decoding its puzzle data. */
function readShareUrl(input        )             {
  const url = parseUrl(input);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const boardCode = oneParameter(url.searchParams, hash, "board");
  const levelId = oneParameter(url.searchParams, hash, "level");
  const atText = oneParameter(url.searchParams, hash, "at");
  const result             = {};

  if (boardCode !== undefined) {
    if (!boardCode || boardCode.length > MAX_BOARD_CODE_LENGTH + MAX_ROUTE_CODE_LENGTH) {
      throw new Error("The shared board code is empty or too large.");
    }
    result.boardCode = boardCode;
  }
  if (levelId !== undefined) result.levelId = checkLevelId(levelId);
  if (boardCode !== undefined && levelId !== undefined) {
    throw new Error("The shared link contains both a preset level and a custom board. Use one board source.");
  }
  if (atText !== undefined) {
    if (!/^(0|[1-9]\d*)$/.test(atText)) {
      throw new Error("The replay position must be a whole number from 0 to 10,000.");
    }
    result.at = checkPosition(Number(atText));
  }
  return result;
}

/** Produces a fresh link; old board and replay parameters never leak into it. */
function makeShareUrl(baseUrl        , input            )         {
  const url = parseUrl(baseUrl);
  url.search = "";
  url.hash = "";
  const hash = new URLSearchParams();

  if (input.board && input.levelId !== undefined) {
    throw new Error("Share either a preset level or a custom board, not both.");
  }
  if (input.board) {
    let code = encodeBoard(input.board);
    if (input.moves !== undefined) { checkMoves(input.moves); code += encodeRoute(input.board, input.moves); } // the route rides inside the board code
    hash.set("board", code);
  } else if (input.moves !== undefined) throw new Error("A route needs its board in the link.");
  if (input.levelId !== undefined) url.searchParams.set("level", checkLevelId(input.levelId));
  if (input.at !== undefined) hash.set("at", String(checkPosition(input.at)));
  const hashText = hash.toString();
  if (hashText) url.hash = hashText;
  const result = url.toString();
  if (result.length > MAX_URL_LENGTH) throw new Error("This board and replay are too large for one shared link.");
  return result;
}

/** Alphanumeric route text: the compact route bytes, behind a leading sentinel 1, read as one base-62 number. */
function toBase62(bytes) {
  let n = 1n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) { out = N62[Number(n % 62n)] + out; n /= 62n; }
  return out;
}
function fromBase62(text) {
  let n = 0n;
  for (const c of text) { const v = N62.indexOf(c); if (v < 0) throw new Error('Invalid route code.'); n = n * 62n + BigInt(v); }
  const bytes = [];
  while (n > 1n) { bytes.push(Number(n & 255n)); n >>= 8n; }
  if (n !== 1n) throw new Error('Invalid route code.');
  const result = Uint8Array.from(bytes.reverse());
  if (toBase62(result) !== text) throw new Error('The route code is not in canonical form.');
  return result;
}
/** Alphanumeric compact route, appended directly to a K4 board code (`K4.<board><route>`, no separator). */
function encodeRoute(board, notation) {
  return toBase62(compactSolution(validateBoard(board), notation));
}
/** Decodes route text (as returned in `extra.route` by decodeBoard) into a route in text notation. */
function decodeRouteCode(board, text) {
  if (typeof text !== 'string' || !text || text.length > MAX_ROUTE_CODE_LENGTH) throw new Error('Invalid route code.');
  return expandSolution(validateBoard(board), fromBase62(text));
}

return {encodeBoard,decodeBoard,encodeRoute,decodeRouteCode,readShareUrl,makeShareUrl};
})();

