'use strict';
// Random board generator (stage 1: walls, balls, goals; switches, teleports, tunnels, arrows and hexes come later).
// Strategy ("reverse construction"): build the walls, put every goal where a ball can stop, start from the solved state (all balls docked)
// and walk BACKWARDS: each step picks a ball and a (start cell, direction) whose forward move, simulated with the game engine itself
// (Core.applyMove), ends exactly on the ball's current cell. The balls' final cells are the starting position, the reversed walk is a
// valid (not necessarily shortest) route. No rule is re-implemented here: every move is judged by engine.js.
// Generator.generate({width, height}) -> {board, route, attempts} | null.   Requires engine.js (Core).
const Generator = (() => {
  const DIRS = ['u', 'd', 'l', 'r'], DX = { u: 0, d: 0, l: -1, r: 1 }, DY = { u: 1, d: -1, l: 0, r: 0 };
  const rnd = n => Math.floor(Math.random() * n);
  const pick = list => list[rnd(list.length)];
  const shuffled = list => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const key = (x, y) => `${x},${y}`;

  // Real levels: median wall density 0.30 (middle half 0.18-0.40), walls mostly in bars and blobs (only 8% isolated cells), about a
  // quarter mirror-symmetric. Bars of 2-5 cells plus a few single cells, optionally mirrored left/right.
  function makeWalls(w, h) {
    const mirror = w >= 4 && Math.random() < 0.25, maxX = mirror ? Math.ceil(w / 2) : w;
    const target = Math.round((0.18 + Math.random() * 0.22) * maxX * h);
    const walls = new Set();
    for (let guard = 0; walls.size < target && guard < 1000; guard++) {
      let x = 1 + rnd(maxX), y = 1 + rnd(h);
      if (Math.random() < 0.3) { walls.add(key(x, y)); continue; }
      const d = pick(DIRS), length = 2 + rnd(4);
      for (let i = 0; i < length && walls.size < target; i++, x += DX[d], y += DY[d]) {
        if (x < 1 || x > maxX || y < 1 || y > h) break;
        walls.add(key(x, y));
      }
    }
    if (mirror) for (const k of [...walls]) { const [x, y] = k.split(',').map(Number); walls.add(key(w + 1 - x, y)); }
    return walls;
  }

  function floorCells(w, h, walls) {
    const cells = [];
    for (let y = 1; y <= h; y++) for (let x = 1; x <= w; x++) if (!walls.has(key(x, y))) cells.push({ x, y });
    return cells;
  }

  function connected(cells, walls) {
    if (!cells.length) return false;
    const free = new Set(cells.map(c => key(c.x, c.y))), seen = new Set([key(cells[0].x, cells[0].y)]), stack = [cells[0]];
    while (stack.length) {
      const c = stack.pop();
      for (const d of DIRS) { const k = key(c.x + DX[d], c.y + DY[d]); if (free.has(k) && !seen.has(k)) { seen.add(k); stack.push({ x: c.x + DX[d], y: c.y + DY[d] }); } }
    }
    return seen.size === cells.length;
  }

  const wallList = walls => [...walls].map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; });

  // Cells where a lone ball can end a move on this wall layout: only those make sensible goals.
  function stopCells(w, h, walls, floor) {
    const probe = Core.validateBoard({ width: w, height: h, walls: wallList(walls), balls: [{ color: 'R', ...floor[0] }], goals: [{ color: 'R', ...floor[floor.length - 1] }] });
    const base = Core.createInitialState(probe), stops = new Map();
    for (const p of floor) for (const d of DIRS) {
      const state = { ...base, balls: [{ ...base.balls[0], x: p.x, y: p.y, locked: false }] };
      const r = Core.applyMove(state, probe, 'R', d);
      if (r.kind === 'ok') { const b = r.state.balls[0]; stops.set(key(b.x, b.y), { x: b.x, y: b.y }); }
    }
    return [...stops.values()];
  }

  function attempt(w, h) {
    const walls = makeWalls(w, h), floor = floorCells(w, h, walls);
    const n = 2 + rnd(3); // 2-4 balls, all of different colors
    if (floor.length < 3 * n + 4 || !connected(floor, walls)) return null;
    const stops = stopCells(w, h, walls, floor);
    if (stops.length < n) return null;
    const colors = shuffled(['R', 'G', 'B', 'Y']).slice(0, n), goalCells = shuffled(stops).slice(0, n);
    const goals = colors.map((color, i) => ({ color, ...goalCells[i] }));
    // Solved state: every ball on the goal of its color (docked).
    const board = Core.validateBoard({ width: w, height: h, walls: wallList(walls), balls: goals.map(g => ({ ...g })), goals });
    let state = Core.createInitialState(board);
    const ids = state.balls.map(b => b.id), moved = new Set(), route = [];
    const steps = 6 + rnd(10) + Math.round(w * h / 50); // longer walks on bigger boards
    let last = null; // forbids the walk from simply undoing its previous step (same ball back to the cell it just came from)
    for (let k = 0; k < steps + 30; k++) {
      const unmoved = ids.filter(id => !moved.has(id));
      if (k >= steps && !unmoved.length) break;
      const forced = unmoved.length && steps - k <= unmoved.length;
      const order = shuffled(forced || (unmoved.length && Math.random() < 0.5) ? unmoved.concat(ids) : ids);
      let step = null;
      for (const id of order) {
        const ball = state.balls.find(b => b.id === id), occupied = new Set(state.balls.filter(b => b.id !== id).map(b => key(b.x, b.y)));
        const candidates = [];
        for (const p of floor) {
          if ((p.x === ball.x && p.y === ball.y) || occupied.has(key(p.x, p.y))) continue;
          if (p.x !== ball.x && p.y !== ball.y) continue; // plain boards: a move is a straight slide
          if (board.goals.some(g => g.color === ball.color && g.x === p.x && g.y === p.y)) continue; // would start docked
          if (last && last.id === id && last.x === p.x && last.y === p.y) continue;
          const pre = { ...state, balls: state.balls.map(b => b.id === id ? { ...b, x: p.x, y: p.y, locked: false } : b) };
          for (const d of DIRS) {
            const r = Core.applyMove(pre, board, id, d);
            if (r.kind !== 'ok') continue;
            const end = r.state.balls.find(b => b.id === id);
            if (end.x !== ball.x || end.y !== ball.y || end.locked !== ball.locked) continue;
            // Two consecutive moves of one ball that a single move could replace make a pointless route.
            if (last && last.id === id && DIRS.some(e => { const q = Core.applyMove(pre, board, id, e), b = q.kind === 'ok' && q.state.balls.find(x => x.id === id); return b && b.x === last.x && b.y === last.y; })) continue;
            candidates.push({ id, pre, d, from: p, to: { x: ball.x, y: ball.y } });
          }
        }
        if (candidates.length) { step = pick(candidates); break; }
      }
      if (!step) break;
      state = step.pre; moved.add(step.id); last = { id: step.id, x: step.to.x, y: step.to.y };
      route.unshift({ id: step.id, d: step.d });
    }
    if (moved.size < ids.length || route.length < Math.max(6, 2 * n + 2)) return null;
    // Self-check: the reversed walk must solve the board from the starting position.
    const start = state.balls.map(b => ({ color: b.color, x: b.x, y: b.y }));
    const draft = { id: 'generated', title: 'Random board', width: w, height: h, walls: wallList(walls), balls: start, goals, arrows: [], gates: [], switches: [], teleports: [], hexes: [] };
    const valid = Core.validateBoard(draft);
    let replay = Core.createInitialState(valid);
    if (replay.balls.some(b => b.locked)) return null;
    const records = [];
    for (const m of route) {
      const r = Core.applyMove(replay, valid, m.id, m.d);
      if (r.kind !== 'ok') return null;
      replay = r.state; records.push(r.record);
    }
    if (!Core.isComplete(replay)) return null;
    return { board: draft, route: Core.formatSolution(records), moves: route.length };
  }

  /** A random board of the given size, or null if none was found (very small boards). */
  function generate({ width = 10, height = 7 } = {}) {
    if (width < 3 || height < 3) return null;
    for (let attempts = 1; attempts <= 300; attempts++) {
      const result = attempt(width, height);
      if (result) return { ...result, attempts };
    }
    return null;
  }

  return { generate };
})();
if (typeof module !== 'undefined') module.exports = Generator;
