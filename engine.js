/* Kunundrum game rules: no DOM dependencies. */
'use strict';
const Core = (() => {
/** Kunundrum's deterministic, immutable game model. Coordinates are Cartesian, 1-based. */

const COLORS          = ["R", "G", "B", "Y"];
const DIRECTIONS              = ["u", "d", "l", "r"];
const COLOR_NAMES                        = { R: "Red", G: "Green", B: "Blue", Y: "Yellow" };
const DIRECTION_NAMES                            = { u: "up", d: "down", l: "left", r: "right" };
const DELTAS                         = {
  u: { x: 0, y: 1 }, d: { x: 0, y: -1 }, l: { x: -1, y: 0 }, r: { x: 1, y: 0 },
};
const OPPOSITE = { u: "d", d: "u", l: "r", r: "l" };
const posKey = (p     )         => `${p.x},${p.y}`;
const samePos = (a     , b     )          => a.x === b.x && a.y === b.y;
const rowOrder = (a     , b     )         => a.y - b.y || a.x - b.x;

function object(value         , label        )                          {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value                           ;
}
function integer(value         , label        , min        , max        )         {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value;
}
function string(value         , label        , max        , fallback         )         {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== "string" || !candidate.trim() || candidate.length > max) {
    throw new Error(`${label} must be a nonempty string of at most ${max} characters.`);
  }
  return candidate.trim();
}
function identifier(value         , label        , fallback         )         {
  const id = string(value, label, 64, fallback);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id) || ["constructor", "prototype", "__proto__"].includes(id)) {
    throw new Error(`${label} may contain only letters, numbers, underscores, dots, and hyphens.`);
  }
  return id;
}
function boolean(value         , label        , fallback         )          {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  return value;
}
function entries(source                         , key        )            {
  const values = source[key];
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 4096) throw new Error(`${key} must be an array of at most 4096 entries.`);
  return values;
}
function uniqueIds                          (values     , label        , fail        )       {
  const ids = new Set        ();
  for (const value of values) {
    if (ids.has(value.id)) fail(`Duplicate ${label} ID: ${value.id}.`);
    ids.add(value.id);
  }
}

/** Validate imported data and return only the supported, normalized version-1 fields. */
const tunnelEndOrder = (a     , b     )         => a.y - b.y || a.x - b.x || DIRECTIONS.indexOf(a.side) - DIRECTIONS.indexOf(b.side);
function validateBoard(raw         , problems         , notes         )        {
  // With a `problems` array, semantic problems (as opposed to unreadable data) are
  // collected instead of thrown, so a damaged board can still be opened for repair.
  const fail = (message        ) => { if (problems) problems.push(message); else throw new Error(message); };
  const source = object(raw, "Board");
  if (source.version !== undefined && source.version !== 1) throw new Error("This board uses an unsupported version; expected version 1.");
  const width = integer(source.width, "Board width", 1, 32);
  const height = integer(source.height, "Board height", 1, 32);
  const point = (value         , label        )      => {
    const item = object(value, label);
    return { x: integer(item.x, `${label} x`, 1, width), y: integer(item.y, `${label} y`, 1, height) };
  };
  const color = (value         , label        )        => {
    if (!COLORS.includes(value         )) throw new Error(`${label} must be R, G, B, or Y.`);
    return value         ;
  };
  const teleportColor = (value         , label        )                => {
    if (value !== "*" && !COLORS.includes(value         )) throw new Error(`${label} must be R, G, B, Y, or * (any ball color).`);
    return value                 ;
  };
  const direction = (value         , label        )            => {
    if (!DIRECTIONS.includes(value             )) throw new Error(`${label} must be u, d, l, or r.`);
    return value             ;
  };
  const ids = (value         , label        )           => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 1024) throw new Error(`${label} must be an array of IDs.`);
    const values = value.map((id, i) => identifier(id, `${label} ${i + 1}`));
    if (new Set(values).size !== values.length) throw new Error(`${label} contains a duplicate ID.`);
    return values.sort();
  };
  const walls = entries(source, "walls").map((v, i) => point(v, `Wall ${i + 1}`)).sort(rowOrder);
  const unnumbered = entries(source, "balls").map((value, i) => {
    const item = object(value, `Ball ${i + 1}`);
    return { ...point(item, `Ball ${i + 1}`), color: color(item.color, `Ball ${i + 1} color`) };
  });
  if (!unnumbered.length || unnumbered.length > 128) throw new Error("A board needs from 1 to 128 balls.");
  const balls = COLORS.flatMap(c => {
    const group = unnumbered.filter(b => b.color === c).sort(rowOrder);
    return group.map((b, i) => ({ ...b, id: group.length === 1 ? c : `${c}${i + 1}` }));
  });
  const goals = entries(source, "goals").map((value, i) => {
    const item = object(value, `Goal ${i + 1}`);
    return { ...point(item, `Goal ${i + 1}`), color: color(item.color, `Goal ${i + 1} color`) };
  }).sort(rowOrder);
  const arrows = entries(source, "arrows").map((value, i) => {
    const item = object(value, `Arrow ${i + 1}`);
    const rotating = boolean(item.rotating, `Arrow ${i + 1} rotating`, false);
    return { ...point(item, `Arrow ${i + 1}`), direction: direction(item.direction, `Arrow ${i + 1} direction`), ...(rotating ? { rotating: true } : {}) };
  }).sort(rowOrder);
  const gates = entries(source, "gates").map((value, i) => {
    const item = object(value, `Gate ${i + 1}`);
    const id = identifier(item.id, `Gate ${i + 1} ID`, `gate${i + 1}`);
    return { ...point(item, `Gate ${i + 1}`), id, active: boolean(item.active, `Gate ${i + 1} active`, true) };
  }).sort(rowOrder);
  const switches = entries(source, "switches").map((value, i) => {
    const item = object(value, `Switch ${i + 1}`);
    const on = boolean(item.on, `Switch ${i + 1} on`, false);
    return { ...point(item, `Switch ${i + 1}`), id: identifier(item.id, `Switch ${i + 1} ID`, `switch${i + 1}`), controls: ids(item.controls, `Switch ${i + 1} controls`), ...(on ? { on: true } : {}) };
  }).sort(rowOrder);
  const teleports = entries(source, "teleports").map((value, i)           => {
    // One entry per endpoint: its own cell, color (R, G, B, Y or * = universal) and on/off state. Partners are derived (see teleportExit).
    const item = object(value, `Teleport ${i + 1}`);
    return { id: identifier(item.id, `Teleport ${i + 1} ID`, `teleport${i + 1}`), color: teleportColor(item.color, `Teleport ${i + 1} color`), ...point(item, `Teleport ${i + 1}`), active: boolean(item.active, `Teleport ${i + 1} active`, true) };
  }).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const hexes = entries(source, "hexes").map((value, i) => {
    const item = object(value, `Hexagon ${i + 1}`);
    const valueNumber = integer(item.value, `Hexagon ${i + 1} value`, -10000, 10000);
    if (valueNumber === 0) throw new Error(`Hexagon ${i + 1} value must not be zero.`);
    return { ...point(item, `Hexagon ${i + 1}`), id: identifier(item.id, `Hexagon ${i + 1} ID`, `hex${i + 1}`), value: valueNumber };
  }).sort(rowOrder);

  // Tunnels: bidirectional pairs of openings in a cell side. `side` is the direction a ball must travel to enter the opening;
  // it leaves the partner opening heading the other way (inward). Pairings are stored (they cannot be derived).
  const tunnelEnd = (value         , label        ) => ({ ...point(value, label), side: direction(object(value, label).side, `${label} side`) });
  const tunnels = entries(source, "tunnels").map((value, i) => {
    const item = object(value, `Tunnel ${i + 1}`);
    const ends = [tunnelEnd(item.a, `Tunnel ${i + 1} end A`), tunnelEnd(item.b, `Tunnel ${i + 1} end B`)];
    ends.sort(tunnelEndOrder);
    return { a: ends[0], b: ends[1] };
  }).sort((p, q) => tunnelEndOrder(p.a, q.a));
  const openings = new Set        ();
  for (const t of tunnels) for (const e of [t.a, t.b]) {
    const key = `${e.x},${e.y},${e.side}`;
    if (openings.has(key)) fail(`Two tunnel openings share the ${DIRECTION_NAMES[e.side]} side of (${e.x},${e.y}).`);
    openings.add(key);
    if (walls.some(w => samePos(w, e))) fail(`A tunnel opening at (${e.x},${e.y}) lies in a fixed wall.`);
  }
  for (const t of tunnels) if (t.a.x === t.b.x && t.a.y === t.b.y && t.a.side === t.b.side) fail(`A tunnel connects the ${DIRECTION_NAMES[t.a.side]} side of (${t.a.x},${t.a.y}) to itself.`);
  uniqueIds(gates, "gate", fail); uniqueIds(switches, "switch", fail); uniqueIds(teleports, "teleport", fail); uniqueIds(hexes, "hexagon", fail);
  // Switches with the same non-empty list always toggle together and share one indicator (display only):
  // the set takes the value of its lowest-numbered switch.
  const sets = new Map();
  for (const sw of switches) if (sw.controls.length) { const key = sw.controls.join(","); sets.set(key, [...(sets.get(key) ?? []), sw]); }
  for (const set of sets.values()) {
    const [first, ...rest] = set.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    for (const sw of rest) if (!!sw.on !== !!first.on) {
      if (first.on) sw.on = true; else delete sw.on;
      if (notes) notes.push(`${sw.id} indicator set to match ${first.id}`);
    }
  }
  checkTeleports(teleports, fail);
  const switchable = new Set(gates.map(g => g.id));
  for (const t of teleports) { if (switchable.has(t.id)) fail(`Gate and teleport share the ID ${t.id}; a switch could not tell them apart.`); switchable.add(t.id); }
  for (const sw of switches) {
    for (const id of sw.controls) if (!switchable.has(id)) fail(`Switch ${sw.id} controls unknown gate or teleport ${id}.`);
  }
  const tileKinds = new Map                ();
  const occupy = (p     , name        )       => {
    const key = posKey(p), previous = tileKinds.get(key);
    if (previous) { fail(`${name} overlaps ${previous} at (${p.x},${p.y}); each cell may contain one floor feature.`); return; }
    tileKinds.set(key, name);
  };
  for (const p of walls) occupy(p, "a fixed wall");
  for (const p of goals) occupy(p, "a goal");
  for (const p of arrows) occupy(p, "an arrow");
  for (const p of gates) occupy(p, "a switchable wall");
  for (const p of switches) occupy(p, "a switch");
  for (const p of hexes) occupy(p, "a hexagon");
  for (const teleport of teleports) occupy(teleport, "a teleport");
  const occupiedBalls = new Set        ();
  for (const b of balls) {
    const key = posKey(b);
    if (occupiedBalls.has(key)) fail(`Two balls start at (${b.x},${b.y}).`);
    if (walls.some(w => samePos(w, b))) fail(`Ball ${b.id} starts inside a fixed wall.`);
    if (gates.some(g => g.active && samePos(g, b))) fail(`Ball ${b.id} starts inside an active switchable wall.`);
    occupiedBalls.add(key);
  }
  for (const c of COLORS) {
    if (goals.filter(g => g.color === c).length < balls.filter(b => b.color === c).length) {
      fail(`There must be at least one ${COLOR_NAMES[c].toLowerCase()} goal per ${COLOR_NAMES[c].toLowerCase()} ball.`);
    }
  }
  const board        = {
    version: 1,
    id: string(source.id, "Board ID", 80, "custom"),
    title: string(source.title, "Board title", 100, "Custom board"),
    width, height, walls, balls, goals, arrows, gates, switches, teleports, hexes,
  };
  if (tunnels.length) board.tunnels = tunnels;
  if (source.description !== undefined) {
    if (typeof source.description !== "string" || source.description.length > 2000) throw new Error("Board description must be at most 2000 characters.");
    board.description = source.description;
  }
  if (source.wallColor !== undefined) {
    // Cosmetic only: the neon wall (and floor grid) color. Blue is the default and is left out.
    const wallColor = color(source.wallColor, "Wall color");
    if (wallColor !== "B") board.wallColor = wallColor;
  }
  if (source.solution !== undefined) {
    if (typeof source.solution !== "string" || source.solution.length > 10000) throw new Error("Solution must be a string of at most 10000 characters.");
    parseSolution(source.solution);
    board.solution = source.solution;
  }
  return board;
}

/** Teleport pairing is derived from colors alone (no stored pairs): same-color endpoints pair up, two universals (*) pair with
 * each other, and a lone universal is a hub paired with the single endpoint of every other color. */
function teleportCounts(teleports) {
  const n = { R: 0, G: 0, B: 0, Y: 0, "*": 0 };
  for (const t of teleports) n[t.color]++;
  return n;
}
function checkTeleports(teleports, fail) {
  const n = teleportCounts(teleports);
  for (const c of COLORS) if (n[c] > 2) fail(`There are ${n[c]} ${COLOR_NAMES[c].toLowerCase()} teleports; at most 2 of a color are allowed.`);
  if (n["*"] > 2) fail(`There are ${n["*"]} universal teleports; at most 2 are allowed.`);
  for (const c of COLORS) if (n[c] === 1 && n["*"] !== 1) fail(`The ${COLOR_NAMES[c].toLowerCase()} teleport has no partner (a single teleport needs exactly one universal teleport).`);
  if (n["*"] === 1 && !COLORS.some(c => n[c] === 1)) fail("The universal teleport has no partner.");
}
/** The endpoint a ball of this color is sent to when it enters `entrance`, or null when there is none (the ball then stops on
 * the entrance). Callers check beforehand that the entrance is on and accepts the ball's color. */
function teleportExit(teleports, entrance, ballColor) {
  const others = teleports.filter(t => t !== entrance && t.id !== entrance.id);
  if (entrance.color !== "*") {
    const mate = others.filter(t => t.color === entrance.color);
    if (mate.length === 1) return mate[0];
    const universal = others.filter(t => t.color === "*");
    return universal.length === 1 ? universal[0] : null;
  }
  const universal = others.filter(t => t.color === "*");
  if (universal.length === 1) return universal[0];
  const spokes = teleports.filter(t => t.color === ballColor);
  return spokes.length === 1 ? spokes[0] : null;
}

function createInitialState(board       )            {
  return {
    balls: board.balls.map(b => ({ ...b, locked: board.goals.some(g => g.color === b.color && samePos(g, b)) })),
    gateActive: Object.fromEntries(board.gates.map(g => [g.id, g.active])),
    teleportActive: Object.fromEntries(board.teleports.map(t => [t.id, t.active])),
    switchOn: Object.fromEntries(board.switches.map(s => [s.id, s.on ?? false])),
    consumedHexIds: [], moves: 0, score: 0,
  };
}
function isComplete(state           )          { return state.balls.length > 0 && state.balls.every(b => b.locked); }

/** A move either returns a complete new snapshot, or leaves the input untouched. */
function applyMove(state           , board       , ballId        , direction           , choices              = [])             {
  const ball = state.balls.find(b => b.id === ballId);
  const fail = (kind                              , message        , path              = [])             => ({ kind, message, path });
  if (!ball) return fail("error", `There is no ball named ${ballId}.`);
  if (ball.locked) return fail("blocked", `${ballId} is docked and cannot move.`);
  if (!DIRECTIONS.includes(direction) || choices.some(c => !DIRECTIONS.includes(c))) return fail("error", "Directions must be u, d, l, or r.");
  if (choices.length > 1024) return fail("error", "A move can contain at most 1024 rotating-arrow choices.");
  const path              = [{ x: ball.x, y: ball.y }];
  const others = state.balls.filter(b => b.id !== ballId);
  const occupied = new Set(others.map(posKey));
  const fixed = new Set(board.walls.map(posKey));
  const activeGates = new Set(board.gates.filter(g => state.gateActive[g.id]).map(posKey));
  const arrows = new Map(board.arrows.map(a => [posKey(a), a]));
  const hexes = new Map(board.hexes.map(h => [posKey(h), h]));
  const teleportCells = new Map(board.teleports.map(t => [posKey(t), t]));
  const tunnelHops = new Map        ();
  for (const t of board.tunnels ?? []) { tunnelHops.set(`${t.a.x},${t.a.y},${t.a.side}`, t.b); tunnelHops.set(`${t.b.x},${t.b.y},${t.b.side}`, t.a); }
  const consumed = new Set(state.consumedHexIds);
  const visited = new Set        ();
  const events           = [];
  let x = ball.x, y = ball.y, heading = direction, choicesUsed = 0, scoreDelta = 1;
  let entered = false, steps = 0;
  while (true) {
    if (++steps > 65536) return fail("loop", "This move is too long to resolve safely. Nothing was changed.", path);
    const signature = `${x},${y},${heading},${choicesUsed}`;
    if (visited.has(signature)) return fail("loop", "This move loops forever. Nothing was changed; choose another direction.", path);
    visited.add(signature);
    // A tunnel opening on the side the ball is heading for takes precedence over whatever lies beyond that side (edge or wall).
    const hop = tunnelHops.get(`${x},${y},${heading}`), delta = DELTAS[heading];
    const next = hop ? { x: hop.x, y: hop.y } : { x: x + delta.x, y: y + delta.y }, key = posKey(next);
    if (!hop && (next.x < 1 || next.x > board.width || next.y < 1 || next.y > board.height)) break;
    if (fixed.has(key) || activeGates.has(key) || occupied.has(key)) { if (hop) events.push("The tunnel exit is blocked; stopped at its entrance."); break; }
    entered = true; x = next.x; y = next.y; path.push(hop ? { x, y, tunnel: true, via: heading, out: hop.side } : { x, y }); // via = side entered, out = side left through
    if (hop) { heading = OPPOSITE[hop.side]; events.push("Passed through a tunnel."); }
    const hex = hexes.get(key);
    if (hex && !consumed.has(hex.id)) {
      consumed.add(hex.id); scoreDelta += hex.value;
      events.push(`${hex.value > 0 ? "+" : ""}${hex.value} hexagon consumed.`);
    }
    const arrow = arrows.get(key);
    if (arrow) {
      if (arrow.rotating) {
        if (choicesUsed >= choices.length) return { kind: "choose-direction", position: { x, y }, choicesUsed, path, message: `Choose the rotating arrow's exit at (${x},${y}).` };
        heading = choices[choicesUsed++];
      } else heading = arrow.direction;
    }
    const endpoint = teleportCells.get(key);
    if (endpoint && state.teleportActive[endpoint.id] && (endpoint.color === "*" || endpoint.color === ball.color)) {
      const exit = teleportExit(board.teleports, endpoint, ball.color);
      if (!exit || !state.teleportActive[exit.id]) { events.push("The teleport has no active exit; stopped at its entrance."); break; }
      if (occupied.has(posKey(exit))) { events.push("The teleport exit is occupied; stopped at its entrance."); break; }
      x = exit.x; y = exit.y;
      path.push({ x, y, teleport: true });
      events.push(`${COLOR_NAMES[ball.color]} teleported.`);
    }
  }
  if (!entered) return fail("blocked", `${ballId} cannot move ${DIRECTION_NAMES[direction]} from here.`, path);
  if (choicesUsed !== choices.length) return fail("error", `This move uses ${choicesUsed} rotating-arrow ${choicesUsed === 1 ? "choice" : "choices"}, but ${choices.length} were supplied.`, path);
  const end = { x, y };
  const locked = board.goals.some(g => g.color === ball.color && samePos(g, end));
  const nextState            = {
    balls: state.balls.map(b => b.id === ballId ? { ...b, x, y, locked } : { ...b }),
    gateActive: { ...state.gateActive }, teleportActive: { ...state.teleportActive },
    switchOn: { ...state.switchOn },
    consumedHexIds: [...consumed], moves: state.moves + 1, score: state.score + scoreDelta,
  };
  if (locked) events.push(`${ballId} docked.`);
  const sw = board.switches.find(s => samePos(s, end));
  if (sw) {
    const allOccupied = new Set(nextState.balls.map(posKey));
    const gates = board.gates.filter(g => sw.controls.includes(g.id));
    if (gates.some(g => !state.gateActive[g.id] && allOccupied.has(posKey(g)))) {
      // A gate that cannot close blocks the whole switch: nothing it controls toggles, and the switch itself stays put.
      events.push(`Switch ${sw.id} did not change because a closing gate is occupied.`);
    } else {
      const nowOn = !(state.switchOn[sw.id] ?? sw.on ?? false), key = sw.controls.join(",");
      for (const twin of board.switches) if (twin.id === sw.id || (key && twin.controls.join(",") === key)) nextState.switchOn[twin.id] = nowOn;
      for (const gate of gates) nextState.gateActive[gate.id] = !nextState.gateActive[gate.id];
      for (const id of sw.controls) if (id in nextState.teleportActive) {
        nextState.teleportActive[id] = !nextState.teleportActive[id];
        events.push(`Teleport ${id} ${nextState.teleportActive[id] ? "activated" : "deactivated"}.`);
      }
      events.push(`Switch ${sw.id} toggled.`);
    }
  }
  const record             = {
    ballId, direction, choices: choices.slice(), scoreDelta,
    from: { x: ball.x, y: ball.y }, to: end, notation: "",
  };
  record.notation = formatMove(record);
  return { kind: "ok", state: nextState, path, record, events };
}

/** Parse notation without resolving ball IDs; resolution happens against each replay snapshot. */
function parseSolution(text        )              {
  if (typeof text !== "string") throw new Error("A solution must be text.");
  if (text.length > 100000) throw new Error("The solution is too long (100,000 character maximum).");
  const compact = text.replace(/\s+/g, "");
  if (!compact) return [];
  const tokens              = [];
  const groups = compact.split(",");
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    if (!group) throw new Error(`Group ${groupIndex + 1} is empty; remove the extra comma.`);
    const match = /^([RGBY](?:[1-9]\d*)?|[1-9]\d*)/.exec(group);
    if (!match) throw new Error(`Group ${groupIndex + 1} must start with a ball ID, such as R, G3, or an unambiguous number.`);
    const identifier = match[1];
    let index = identifier.length, moveCount = 0;
    while (index < group.length) {
      const direction = group[index]             ;
      if (!DIRECTIONS.includes(direction)) throw new Error(`Expected u, d, l, or r after ${identifier} in group ${groupIndex + 1}; found '${group[index]}'.`);
      index++; moveCount++;
      const choices              = [];
      while (group[index] === "(") {
        const choice = /^\((?:->|→)([udlr])\)/.exec(group.slice(index));
        if (!choice) throw new Error(`Invalid rotating-arrow annotation in group ${groupIndex + 1}; use (->u), (->d), (->l), or (->r).`);
        choices.push(choice[1]             ); index += choice[0].length;
      }
      tokens.push({ identifier, direction, choices });
      if (tokens.length > 10000) throw new Error("A replay can contain at most 10,000 moves.");
    }
    if (!moveCount) throw new Error(`Ball ${identifier} needs at least one direction in group ${groupIndex + 1}.`);
  }
  return tokens;
}

function resolveBallId(state           , identifier        )         {
  const available = state.balls.filter(b => !b.locked);
  if (/^[RGBY]$/.test(identifier)) {
    const matches = available.filter(b => b.color === identifier);
    if (matches.length === 1) return matches[0].id;
    if (!matches.length) throw new Error(`There are no unlocked ${COLOR_NAMES[identifier         ].toLowerCase()} balls.`);
    throw new Error(`${identifier} is ambiguous; use ${matches.map(b => b.id).join(" or ")}.`);
  }
  if (/^[RGBY][1-9]\d*$/.test(identifier)) {
    const exact = state.balls.find(b => b.id === identifier);
    if (exact) {
      if (exact.locked) throw new Error(`${identifier} is already docked.`);
      return exact.id;
    }
    // A lone ball is normally written R; accept R1 as its explicit original number.
    if (identifier.slice(1) === "1") {
      const lone = state.balls.filter(b => b.color === identifier[0]);
      if (lone.length === 1 && lone[0].id.length === 1 && !lone[0].locked) return lone[0].id;
    }
    throw new Error(`There is no unlocked ball named ${identifier}.`);
  }
  if (/^[1-9]\d*$/.test(identifier)) {
    const matches = available.filter(b => b.id.slice(1) === identifier);
    if (matches.length === 1) return matches[0].id;
    if (!matches.length) throw new Error(`No unlocked ball has the fixed number ${identifier}; include its color.`);
    throw new Error(`Number ${identifier} is ambiguous; use ${matches.map(b => b.id).join(" or ")}.`);
  }
  throw new Error(`Invalid ball ID '${identifier}'.`);
}

function formatMove(record                                                      )         {
  return `${record.ballId}${record.direction}${record.choices.map(c => `(->${c})`).join("")}`;
}
function formatSolution(records                                                             )         {
  const groups           = [];
  let previousId = "";
  for (const record of records) {
    const directions = `${record.direction}${record.choices.map(c => `(->${c})`).join("")}`;
    if (record.ballId === previousId) groups[groups.length - 1] += directions;
    else groups.push(`${record.ballId}${directions}`);
    previousId = record.ballId;
  }
  return groups.join(",");
}

return {validateBoard,teleportExit,createInitialState,applyMove,isComplete,parseSolution,resolveBallId,formatMove,formatSolution,COLOR_NAMES,DIRECTION_NAMES};
})();
