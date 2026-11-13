/* K3 adaptive binary solution codec, backwards-compatible K2 reader. */
'use strict';
const Codec = (() => {
const { validateBoard,parseSolution,resolveBallId,createInitialState,applyMove,formatSolution } = Core;

/** A code identifies a board, independent of any later moves made on it. */
const BOARD_CODE_PREFIX = "K3.";
const MAX_BOARD_CODE_LENGTH = 32_768;
const MAX_MOVES_LENGTH = 10_000;
const MAX_URL_LENGTH = 131_072;
const MAX_REPLAY_POSITION = 10_000;

function toBase64Url(bytes            )         {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(payload        )             {
  if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload) || payload.length % 4 === 1) {
    throw new Error("The board code is incomplete or contains invalid characters.");
  }
  let binary        ;
  try {
    binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    throw new Error("The board code is not valid base64 data.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (toBase64Url(bytes) !== payload) {
    throw new Error("The board code is incomplete or has been altered.");
  }
  return bytes;
}

/** K3 move stream: varint number of moves; one byte choice mode; packed move
 * indices (ball index * 4 + direction, ceil(log2(ballCount*4)) bits each).
 * Choice mode 0: no rotating-arrow annotations. Choice mode 1: uint choice
 * count for each move, followed by 2-bit packed choices. All pads are zero.
 * Ball indices refer to Core.validateBoard's stable color/position ordering.
 */
function compactSolution(board, notation) {
  const tokens = parseSolution(notation);
  if (!tokens.length || tokens.length > 10000) throw new Error('Invalid K3 solution move count.');
  const directionIndex = 'udlr';
  const bitsPerMove = Math.ceil(Math.log2(board.balls.length * 4));
  const out = [];
  const putUint = value => { do { let n=value%128; value=Math.floor(value/128);out.push(n|(value?128:0)); } while(value); };
  const pushBits = (values, width) => {
    let current=0,used=0;
    for(const value of values) {
      if(value >= 2 ** width) throw new Error('Invalid K3 packed move.');
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
    if(bi<0) throw new Error('Unknown K3 ball.');
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
  const readByte=()=>{if(offset>=bytes.length)throw new Error('Truncated K3 solution.');return bytes[offset++];};
  const readUint=()=>{let value=0,m=1;for(let i=0;i<8;i++){const b=readByte();value+=(b&127)*m;if(!Number.isSafeInteger(value))throw new Error('Invalid K3 move count.');if(!(b&128))return value;m*=128;}throw new Error('Invalid K3 integer.');};
  const readBits=(count,width)=>{
    const size=Math.ceil(count*width/8);
    if(offset+size>bytes.length)throw new Error('Truncated K3 bitstream.');
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
      if(bytes[offset+size-1]&((1<<padding)-1))throw new Error('Nonzero K3 padding.');
    }
    offset+=size;
    return result;
  };
  const count=readUint();
  if(!count||count>10000)throw new Error('Invalid K3 move count.');
  const mode=readByte();if(mode>1)throw new Error('Unsupported K3 choice mode.');
  const values=readBits(count,Math.ceil(Math.log2(board.balls.length*4)));
  const counts=mode?Array.from({length:count},readUint):Array(count).fill(0);
  const total=counts.reduce((a,b)=>a+b,0);
  if(total>10000)throw new Error('Too many rotating-arrow choices.');
  const allChoices=mode?readBits(total,2):[];
  if(offset!==bytes.length)throw new Error('Unexpected K3 solution bytes.');
  let ci=0,state=createInitialState(board);
  const records=[];
  for(let i=0;i<count;i++) {
    const value=values[i],bi=Math.floor(value/4),direction='udlr'[value%4];
    if(bi>=board.balls.length)throw new Error('Invalid K3 ball index.');
    const choices=allChoices.slice(ci,ci+counts[i]).map(v=>'udlr'[v]);ci+=counts[i];
    const result=applyMove(state,board,board.balls[bi].id,direction,choices);
    if(result.kind!=='ok')throw new Error(`Invalid K3 saved solution at move ${i+1}: ${result.message}`);
    records.push(result.record);state=result.state;
  }
  return formatSolution(records);
}

/** K2 is a compact, lossless binary encoding of the validated board.
 * Positions are zero-based cell offsets; integers are unsigned LEB128.
 * Strings use a small back-reference dictionary, including feature/group IDs.
 * The format is self-contained; no server, compression library or catalog required.
 */
const CODE_COLORS = 'RGBY*';
const CODE_DIRECTIONS = 'udlr';
function binaryBoard(board, k3 = true) {
  const bytes = [k3 ? 0xB3 : 0xB2, board.width, board.height];
  const strings = new Map();
  const encoder = new TextEncoder();
  const uint = value => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid binary board integer.');
    do { const piece = value % 128; value = Math.floor(value / 128); bytes.push(piece | (value ? 128 : 0)); } while (value);
  };
  const str = value => {
    if (strings.has(value)) { uint(strings.get(value) * 2 + 1); return; }
    const encoded = encoder.encode(value);
    uint(encoded.length * 2); bytes.push(...encoded); strings.set(value, strings.size);
  };
  const at = point => uint((point.y - 1) * board.width + point.x - 1);
  const list = (items, fn) => { uint(items.length); items.forEach(fn); };
  const color = value => uint(CODE_COLORS.indexOf(value));
  uint((board.description !== undefined ? 1 : 0) | (board.solution !== undefined ? 2 : 0));
  str(board.id); str(board.title);
  if (board.description !== undefined) str(board.description);
  if (board.solution !== undefined) {
    if (k3) {const packed=compactSolution(board,board.solution);uint(packed.length);bytes.push(...packed);}
    else str(board.solution);
  }
  list(board.walls, at);
  list(board.balls, p => { at(p); color(p.color); });
  list(board.goals, p => { at(p); color(p.color); });
  list(board.arrows, p => { at(p); uint(CODE_DIRECTIONS.indexOf(p.direction) * 2 + (p.rotating ? 1 : 0)); });
  list(board.gates, p => { at(p); str(p.id); str(p.group); uint(p.active ? 1 : 0); });
  list(board.switches, p => {
    at(p); str(p.id); uint(p.on ? 1 : 0);
    list(p.wallGroups, str); list(p.teleportIds, str);
  });
  list(board.teleports, p => { str(p.id); color(p.color); uint(p.active ? 1 : 0); at(p.ends[0]); at(p.ends[1]); });
  list(board.hexes, p => { at(p); str(p.id); uint(p.value < 0 ? -2 * p.value - 1 : 2 * p.value); });
  return new Uint8Array(bytes);
}
function unbinaryBoard(bytes, problems) {
  let offset = 0;
  const strings = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const byte = () => {
    if (offset >= bytes.length) throw new Error('Truncated K2 board code.');
    return bytes[offset++];
  };
  const uint = () => {
    let value = 0, multiplier = 1;
    for (let i = 0; i < 8; i++) {
      const b = byte();
      value += (b & 127) * multiplier;
      if (!Number.isSafeInteger(value)) throw new Error('Invalid K2 integer.');
      if (!(b & 128)) return value;
      multiplier *= 128;
    }
    throw new Error('Invalid K2 variable-length integer.');
  };
  const str = () => {
    const tag = uint();
    if (tag & 1) {
      const value = strings[(tag - 1) / 2];
      if (value === undefined) throw new Error('Invalid K2 string reference.');
      return value;
    }
    const length = tag / 2;
    if (length > 20000 || offset + length > bytes.length) throw new Error('Invalid K2 string length.');
    const value = decoder.decode(bytes.subarray(offset, offset + length));
    offset += length;
    strings.push(value);
    return value;
  };
  const magic=byte();if (magic!==0xB2 && magic!==0xB3) throw new Error('Invalid K2/K3 board header.');
  const width = byte(), height = byte(), flags = uint();
  if (!(width >= 1 && width <= 32 && height >= 1 && height <= 32) || flags > 3) throw new Error('Invalid K2 board dimensions or flags.');
  const at = () => {
    const index = uint();
    if (index >= width * height) throw new Error('Invalid K2 board position.');
    return { x: index % width + 1, y: Math.floor(index / width) + 1 };
  };
  const list = fn => {
    const count = uint();
    if (count > 4096) throw new Error('K2 board feature count exceeds limit.');
    return Array.from({length:count}, fn);
  };
  const color = (universal = false) => {
    const i = uint();
    if (i >= (universal ? 5 : 4)) throw new Error('Invalid K2 color.');
    return CODE_COLORS[i];
  };
  const raw = {version:1, width, height, id:str(), title:str()};
  if (flags & 1) raw.description = str();
  let solutionBytes;
  if (flags & 2) {
    if (magic===0xB2) raw.solution=str();
    else {const size=uint();if(size>20000||offset+size>bytes.length)throw new Error('Invalid K3 solution length.');solutionBytes=bytes.subarray(offset,offset+size);offset+=size;}
  }
  raw.walls = list(at);
  raw.balls = list(() => ({...at(), color:color()}));
  raw.goals = list(() => ({...at(), color:color()}));
  raw.arrows = list(() => {
    const p = at(), option = uint();
    if (option > 7) throw new Error('Invalid K2 arrow.');
    return {...p, direction:CODE_DIRECTIONS[Math.floor(option / 2)], ...(option % 2 ? {rotating:true} : {})};
  });
  raw.gates = list(() => ({...at(), id:str(), group:str(), active:bool()}));
  function bool() { const v=uint(); if (v > 1) throw new Error('Invalid K2 boolean.'); return !!v; }
  raw.switches = list(() => {
    const p = at(), id = str(), on = bool(), wallGroups = list(str), teleportIds = list(str);
    return {...p,id,wallGroups,teleportIds,...(on ? {on:true} : {})};
  });
  raw.teleports = list(() => ({id:str(),color:color(true),active:bool(),ends:[at(),at()]}));
  raw.hexes = list(() => { const p=at(),id=str(),value=uint();return {...p,id,value:value % 2 ? -(value+1)/2 : value/2}; });
  if (offset !== bytes.length) throw new Error('Unexpected data after K2/K3 board.');
  if(solutionBytes){
    const own=[];const checked=validateBoard(raw,own);
    if(own.length){if(!problems)validateBoard(raw);problems.push('The embedded solution was dropped because the board is invalid.');}
    else raw.solution=expandSolution(checked,solutionBytes);
  }
  return validateBoard(raw,problems);
}
function encodeBoard(board       )         {
  const code = BOARD_CODE_PREFIX + toBase64Url(binaryBoard(validateBoard(board)));
  if (code.length > MAX_BOARD_CODE_LENGTH) throw new Error('This board is too large for a shareable code (maximum 32 KB).');
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
function decodeBoard(input        , problems         )        {
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

  if (code.length > MAX_BOARD_CODE_LENGTH) {
    throw new Error("The board data is too large (maximum 32 KB).");
  }
  if (code.startsWith("{")) return parseJsonBoard(code, problems);
  if (code.startsWith('K3.') || code.startsWith('K2.')) {
    const bytes=fromBase64Url(code.slice(3));
    if(bytes[0] !== (code.startsWith('K3.')?0xB3:0xB2))throw new Error('Board code prefix and payload version disagree.');
    return unbinaryBoard(bytes, problems);
  }
  if (/^K\d+\./.test(code)) throw new Error('Unsupported board-code version; this player supports K2 and K3.');
  throw new Error('A board code must start with K3. (K2 imports are also supported.)');
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
  const moves = oneParameter(url.searchParams, hash, "moves");
  const route = oneParameter(url.searchParams, hash, "route");
  const atText = oneParameter(url.searchParams, hash, "at");
  const result             = {};

  if (boardCode !== undefined) {
    if (!boardCode || boardCode.length > MAX_BOARD_CODE_LENGTH) {
      throw new Error("The shared board code is empty or too large (maximum 32 KB).");
    }
    result.boardCode = boardCode;
  }
  if (levelId !== undefined) result.levelId = checkLevelId(levelId);
  if (boardCode !== undefined && levelId !== undefined) {
    throw new Error("The shared link contains both a preset level and a custom board. Use one board source.");
  }
  if (moves !== undefined && route !== undefined) throw new Error('Supply either moves or compact route, not both.');
  if (moves !== undefined) result.moves = checkMoves(moves);
  if (route !== undefined) {
    if (route.length > MAX_MOVES_LENGTH || !/^[A-Za-z0-9_-]+$/.test(route)) throw new Error('Invalid compact K3 route.');
    result.route=route;
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
  if (input.board) hash.set("board", encodeBoard(input.board));
  if (input.levelId !== undefined) url.searchParams.set("level", checkLevelId(input.levelId));
  if (input.moves !== undefined) {
    checkMoves(input.moves);
    if(input.routeBoard) hash.set('route',toBase64Url(compactSolution(validateBoard(input.routeBoard),input.moves)));
    else hash.set('moves',input.moves);
  }
  if (input.at !== undefined) hash.set("at", String(checkPosition(input.at)));
  const hashText = hash.toString();
  if (hashText) url.hash = hashText;
  const result = url.toString();
  if (result.length > MAX_URL_LENGTH) throw new Error("This board and replay are too large for one shared link.");
  return result;
}

function decodeRoute(board, code) {
  if(typeof code!=='string'||code.length>MAX_MOVES_LENGTH)throw new Error('Invalid K3 route.');
  return expandSolution(validateBoard(board),fromBase64Url(code));
}
return {encodeBoard,decodeBoard,decodeRoute,readShareUrl,makeShareUrl};
})();

