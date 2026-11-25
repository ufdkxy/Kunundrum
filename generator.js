'use strict';
// Random board generator (stage 1: walls, balls, goals; switches, teleports, tunnels, arrows and hexes come later).
// Strategy ("reverse construction"): build the walls, put the goals on random floor cells, start from the solved state (all balls docked)
// and walk BACKWARDS: each step picks a ball and a (start cell, direction) whose forward move, simulated with the game engine itself
// (Core.applyMove), ends exactly on the ball's current cell. The balls' final cells are the starting position, the reversed walk is a
// valid (not necessarily shortest) route. No rule is re-implemented here: every move is judged by engine.js.
// Generator.generate({width, height, solve, seconds, minMoves}) -> Promise<{board, route, moves, ...} | {failed} | null> (see generate()).   Requires engine.js (Core) and codec.js (Codec).
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

  // All (start cell, direction) pairs from which ball `id` makes one move that ends exactly where it stands now (same docked flag), judged by
  // the engine. `last` = the previous reverse step {id, x, y}: forbids undoing it and two consecutive moves of one ball that one move could replace.
  function predecessors(state, board, floor, id, last) {
    const ball = state.balls.find(b => b.id === id), occupied = new Set(state.balls.filter(b => b.id !== id).map(b => key(b.x, b.y)));
    const candidates = [];
    for (const p of floor) {
      if ((p.x === ball.x && p.y === ball.y) || occupied.has(key(p.x, p.y))) continue;
      if (p.x !== ball.x && p.y !== ball.y) continue; // plain boards: a move is a straight slide
      if (board.goals.some(g => g.color === ball.color && g.x === p.x && g.y === p.y)) continue; // would start docked
      if (last && last.id === id && last.x === p.x && last.y === p.y) continue;
      const pre = { ...state, balls: state.balls.map(b => b.id === id ? { ...b, x: p.x, y: p.y, locked: false } : b) };
      // Plain boards only: a slide that ends at the ball's cell must head towards it (arrows, teleports and tunnels will need all four).
      const toward = p.x === ball.x ? (p.y < ball.y ? 'u' : 'd') : (p.x < ball.x ? 'r' : 'l');
      for (const d of [toward]) {
        const r = Core.applyMove(pre, board, id, d);
        if (r.kind !== 'ok') continue;
        const end = r.state.balls.find(b => b.id === id);
        if (end.x !== ball.x || end.y !== ball.y || end.locked !== ball.locked) continue;
        if (last && last.id === id && DIRS.some(e => { const q = Core.applyMove(pre, board, id, e), b = q.kind === 'ok' && q.state.balls.find(x => x.id === id); return b && b.x === last.x && b.y === last.y; })) continue;
        candidates.push({ id, pre, d, from: p, to: { x: ball.x, y: ball.y } });
      }
    }
    return candidates;
  }

  const BALLS = 4; // always 4 balls, all of different colors

  // One wall layout, several tries at goals and walks (most failures are goals nothing can stop on, which a new goal draw fixes cheaply).
  function attempt(w, h) {
    const walls = makeWalls(w, h), floor = floorCells(w, h, walls);
    if (floor.length < 3 * BALLS + 4 || !connected(floor, walls)) return null;
    for (let tries = 0; tries < 12; tries++) { const result = walk(w, h, walls, floor); if (result) return result; }
    return null;
  }

  function walk(w, h, walls, floor) {
    const n = BALLS;
    const colors = shuffled(['R', 'G', 'B', 'Y']).slice(0, n), goalCells = shuffled(floor).slice(0, n); // any floor cell: a goal a lone ball cannot stop on needs another ball as a stopper, and the walk finds out
    const goals = colors.map((color, i) => ({ color, ...goalCells[i] }));
    // Solved state: every ball on the goal of its color (docked).
    const board = Core.validateBoard({ width: w, height: h, walls: wallList(walls), balls: goals.map(g => ({ ...g })), goals });
    let state = Core.createInitialState(board);
    const ids = state.balls.map(b => b.id), count = Object.fromEntries(ids.map(id => [id, 0])), route = [];
    const steps = 12 + rnd(9), perBall = 3; // 12-20 reverse steps, at least 3 per ball
    let last = null; // forbids the walk from simply undoing its previous step (same ball back to the cell it just came from)
    for (let k = 0; k < steps + 30; k++) {
      const short = ids.filter(id => count[id] < perBall), deficit = short.reduce((a, id) => a + perBall - count[id], 0);
      if (k >= steps && !short.length) break;
      const forced = short.length && steps - k <= deficit; // the remaining steps are all needed for balls below their minimum
      const order = shuffled(forced ? short : short.length && Math.random() < 0.5 ? short.concat(ids) : ids);
      let step = null;
      for (const id of order) {
        // Candidate steps for this ball, in random order; a step must leave the ball on a cell that has predecessors itself (unless it is the
        // last step), otherwise the walk dead-ends early and the puzzle stays short.
        for (const cand of shuffled(predecessors(state, board, floor, id, last))) {
          if (k < steps - 1 && !predecessors(cand.pre, board, floor, id, { id, x: cand.to.x, y: cand.to.y }).length) continue;
          step = cand; break;
        }
        if (step) break;
      }
      if (!step) break;
      state = step.pre; count[step.id]++; last = { id: step.id, x: step.to.x, y: step.to.y };
      route.unshift({ id: step.id, d: step.d });
    }
    if (ids.some(id => count[id] < perBall) || route.length < steps) return null; // dead-ended walks are discarded: the target length is the point
    // Self-check: the reversed walk must solve the board from the starting position.
    const start = state.balls.map(b => ({ color: b.color, x: b.x, y: b.y }));
    const draft = { id: 'generated', title: 'Random', width: w, height: h, walls: wallList(walls), balls: start, goals, arrows: [], gates: [], switches: [], teleports: [], hexes: [] };
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

  // The walk's own route is only one valid route. With a solver the board is kept only if the solver proves a route optimal and that route
  // is at least `minMoves` long; the proven route is what the board carries.
  const pause = () => new Promise(resolve => setTimeout(resolve, 0)); // lets the page repaint ("Generating...") between heavy steps

  function replays(board, route) {
    try {
      const valid = Core.validateBoard(board);
      let state = Core.createInitialState(valid);
      for (const t of Core.parseSolution(route)) {
        const m = Core.applyMove(state, valid, Core.resolveBallId(state, t.identifier), t.direction, t.choices);
        if (m.kind !== 'ok') return false;
        state = m.state;
      }
      return Core.isComplete(state);
    } catch { return false; }
  }

  /** One walk-built candidate of the given size (no solver involved), or null if none was found in 1000 attempts (very small boards). */
  function candidate(width, height) {
    for (let attempts = 1; attempts <= 1000; attempts++) {
      const result = attempt(width, height);
      if (result) return { ...result, attempts };
    }
    return null;
  }

  /**
   * A random board of the given size. Resolves to null if the size is too small.
   * Without `solve`: the first walk-built candidate, carrying the walk's route (not necessarily shortest).
   * With `solve(code, {seconds}) -> Promise<solver result>` (the app passes KunSolver.solve): candidates are solved one after another until one has
   * a replay-verified OPTIMAL route of at least `minMoves` moves, or `seconds` (total, default 10) run out. On timeout the best proven-optimal
   * candidate so far is returned (`short: true` if below `minMoves`), or {failed: true} if none was proven. Solver errors on a candidate skip it;
   * the same error on every candidate is reported as `solverError`.
   */
  async function generate({ width = 10, height = 7, solve = null, seconds = 10, minMoves = 12, perSolve = 3, now = () => Date.now() } = {}) {
    if (width < 3 || height < 3) return null;
    await pause();
    if (!solve) return candidate(width, height);
    const deadline = now() + seconds * 1000;
    let best = null, tried = 0, solverError = null, solved = 0;
    while (now() < deadline - 300) {
      const cand = candidate(width, height);
      if (!cand) return null;
      tried++;
      let r;
      try {
        const code = Codec.encodeBoard(Core.validateBoard(cand.board));
        r = await solve(code, { seconds: Math.min(perSolve, (deadline - now()) / 1000) });
      } catch (e) { solverError = e; await pause(); continue; }
      solverError = null; solved++;
      if (r && r.hasSolution && r.status === 'OPTIMAL' && replays(cand.board, r.solution)) {
        if (!best || r.moves > best.moves) best = { board: { ...cand.board, solution: r.solution }, route: r.solution, moves: r.moves, tried };
        if (r.moves >= minMoves) return { ...best, tried };
      }
      await pause();
    }
    if (best) return { ...best, tried, short: true };
    return { failed: true, tried, solverError: solved === 0 ? solverError : null };
  }

  return { generate };
})();
if (typeof module !== 'undefined') module.exports = Generator;
