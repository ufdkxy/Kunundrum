# Kunundrum — Current State and Next Work

*Living document: keep it current, delete resolved items instead of appending history (Git has the history). See [RULES.md](RULES.md) and [ARCHITECTURE.md](ARCHITECTURE.md).*

**Last updated:** 2026-11-23 · **App** `APP_VERSION = '3.18.4'` in `app.js` (single source; bump it with every app change) · **Solver** v0.19 (`SOLVER_VERSION` in `Solver/solver.cpp`) · **Parser** `parser.js` v0.13.17-js.1. Parser and solver versions change only when that component changes, never with the app.

## 1. Where the project stands

- **Catalog complete.** `levels.js` holds all 300 levels (1.1–30.10), each with an embedded solution. Every embedded solution replays through `engine.js` to a completed board (checked 2026-11-22).
- **Parser development is concluded.** `parser.js` (+ generated `parser_data.js`) is the definitive parser and was used to build the catalog; the Python `parse.py` is frozen and historical. The parser is kept for importing future screenshots, but no further work is planned.
- **Web app is essentially done.** All game mechanics are implemented (RULES.md), including teleport endpoints, tunnels, rotating arrows and wall colors. Only bug fixes are expected.
- **Solver:** exact forward and bidirectional search, beam search, `--max-depth` / `--max-score` certificates, tunnels and rotating arrows, multi-threaded forward and bidirectional search (v0.19); in the browser through the WASM bundle (`kunsolve-bundle.js`, still v0.17: rebuild pending, see SOLVER-022). Remaining ideas: a local optimizer and parallelization (section 3).

## 2. Catalog statistics (embedded solutions, 2026-11-22, after the 20.8 fix)

| | Total | Average | Median | Min | Max |
| --- | --- | --- | --- | --- | --- |
| Moves | 4,966 | 16.55 | 15 | 1 | 107 |
| Score | 4,801 | 16.00 | 15 | −2 | 107 |

- 16 levels have score ≠ moves because of hexagons (total saving 165): 1.7, 1.8, 2.2, 4.9, 5.4, 5.7, 5.8, 7.2, 7.3, 7.8, 8.4, 8.5, 9.8, 12.5, 25.8, 27.9. Lowest scores: 27.9 (−2), 9.8 (0), 1.1 and 7.3 (1).
- Highest scores: 10.10 (107), 15.4 (53), 9.9 (42), 6.9 and 16.5 (38). Chapter 10 is the hardest (average score 34.7), then chapter 15 (27.4); chapter 1 is the easiest (5.9).

## 3. Optimality of the embedded solutions

Per the project owner, **297 of the 300 embedded solutions have been proven optimal** (certified lowest score; 7.3 and 30.4 were closed on 2026-11-22, see below). Three are **not proven**; the embedded route is the best known (an upper bound):

| Level | Moves | Score | Known lower bound / notes |
| --- | --- | --- | --- |
| 9.9 | 42 | 42 | 8 balls, corridors; proven ≥ 30 moves (balanced/bidirectional search, v0.11); beam search found 42 at width 300,000 |
| 10.10 | 107 | 107 | earlier computations proved ≥ 64; game's own best shown 108; route lowered 113 → 107 by a windowed optimizer (route windows with ≤ 5 free balls) outside the repo |
| 15.8 | 29 | 29 | proven ≥ 21 moves (v0.19, 8 threads on the project owner's machine, 2026-11-23: complete layers to forward 11 + reverse 10 with 791M states after ~730 s, about 1.1M states/s, then stopped by hand; the previous v0.17 run reached 18 with 100M states in 507 s at the 3 GB limit). States roughly double per layer, so each further layer needs about 2x the states (about 15 GB for 800M states): at most one or two more layers fit in 24 GB, nowhere near 29; windowed optimizer finds no improvement (up to 8 free balls, 8M nodes per window) |

**What closed 7.3 and 30.4:** `--max-score N` (N = best known score − 1) with forward BFS prunes hexagon boards drastically; 30.4 certifies score ≥ 27 in 59 s (9.6M states, 248 MB). Use it first on any hexagon board before trying other ideas.

Closing the gap means either raising the lower bound (exact search with parallelism / better pruning) or lowering the route (local optimizer). Either result is welcome; the primary goal is always a shortest solution.

## 4. Next work (all optional, solver only)

1. **Local optimizer** (SOLVER-020): take a stored route, free a window of consecutive moves (or a subset of balls) and search exactly for a cheaper replacement; iterate. Prototype outside the repo cut 10.10 from 113 to 107; a full-mechanics scratch copy (2026-11-22) found no improvement on 9.9, 15.8 or 30.4, so it is not yet worth adding to `solver.cpp` (port it only if a rough long route turns up that exact search cannot finish).
2. **Parallelization** (SOLVER-021, planned, see section 5): multi-threaded layer expansion for forward/bidirectional/beam search in the native solver (currently single-threaded; the WASM build stays single-threaded). Mainly a speedup; it will not by itself close 9.9, 10.10 or 15.8.
3. Keep this file, `RULES.md` and `ARCHITECTURE.md` current with every milestone; keep K3 codes and legacy replay links backward compatible unless told otherwise.

## 5. Open solver backlog (P2)

- **SOLVER-002: Limits are not proofs.** `INCONCLUSIVE` never means unsolvable and a best-found route is not optimal. `--max-states` caps nodes, not bytes; hexagon states grow fastest.
- **SOLVER-003: `parseCode` skips board validation.** Overlapping floor features, a ball starting inside an active gate, too few goals for a color or duplicate IDs are accepted, whereas `Core.validateBoard` rejects them. Run the board through the JS validator first (the app already does).
- **SOLVER-021 (done for forward and bidirectional search, solver v0.19; beam search still single-threaded): parallel layer expansion, native only.** Implemented as designed below, with `--threads N` (default 0 = all cores; WASM always 1). Per batch of 32 tasks x 1024 parents the workers only read the stores and emit candidate records (key, hash, and for bidirectional the index of the same state in the opposite store); the main thread merges them in task order with prefetching, so routes, state and transition counts are identical for every thread count and, for bidirectional, identical to v0.18 (checked on 10.8, 10.9, 5.7, 1.7 with 1, 2 and 8 threads; `verify.js` and `mechanics.js` pass). The hash table is rebuilt in parallel (CAS slot claim). Measured only on a 2-core sandbox: 10.9 9.5 s to 6.2 s with 2 threads (1.5x); the serial merge was 25% of the run before moving hashing and the meeting check into the workers, so expect roughly 4-5x on 8 cores (to be measured on the real machine). Original plan: Target machine: 8 cores, 24 GB RAM. Expected speedup ~2.5-3x on 4 cores, ~4-6x on 8 (estimate, not measured; limited by random memory lookups and the serial layer barrier). It buys time, not proofs: the gaps (9.9 proven >= 30 vs 42, 15.8 >= 18 vs 29, 10.10 >= 64 vs 107) are 11-43 layers, so with ~2-4x state growth per layer 8x speed gives 1-2 extra layers; 15.8 stopped at the 3 GB limit, so raise `--max-memory` too (24 GB RAM allows ~8x more states). Tighter bounds (SOLVER-008/012), a smaller per-state footprint or the local optimizer matter more for closing those levels.
  Design: BFS is already layer-synchronous over a flat node array. (1) Expand phase (parallel, store read-only): threads take chunks of the current layer, unpack, generate successors, pack, check `Store::find()` lock-free, and append candidates (key, parent, move) to per-thread buffers. (2) Merge phase: dedup candidates by hash shard in parallel, the earliest chunk wins on duplicates, then a short serial prefix-sum assigns node indices in chunk order, so route, score and state counts are identical for every thread count. (3) `Store`: size the hash table once per layer before expanding (no doubling inside `add()`). (4) Forward BFS: `best`/score bound is a per-layer snapshot. (5) Bidirectional: the same per layer on both sides; `meetF`/`meetR` become read-only lookups in the opposite store with a deterministic minimum for the best meeting. (6) Beam: parallel expansion and heuristic scoring; the `nth_element` selection with the seed tie-break stays serial. (7) Process layers in batches of ~1M parents to bound candidate-buffer memory; `--max-states`, `--seconds` and `--max-memory` are then checked per batch (can overshoot by one batch). (8) CLI `--threads N` (default 1 until validated, later possibly auto), `-pthread` in the Makefile (check the static `release` link), forced to 1 under `__EMSCRIPTEN__`. (9) Solver v0.18; update this file, the Solver README and ARCHITECTURE.md; no APP_VERSION change (web app untouched).
  Tests (real levels only): 10.8, 10.9 and `tests/verify.js`; `--threads 1` vs `2` vs `8` must give identical routes and state counts.
  WASM threads (optional, separate step, not planned): possible in principle with Emscripten pthreads (`-pthread`, shared memory), but it needs `SharedArrayBuffer`, i.e. cross-origin isolation (COOP/COEP headers). That is impossible from `file://` (no headers, no service workers) and on GitHub Pages only via the `coi-serviceworker` workaround (the page reloads once; falls back to 1 thread when not isolated). The single-file Blob-worker bundle also needs rework for pthread sub-workers, and the 2 GB wasm32 heap / 1500 MB UI limit stays, so the memory wall remains. Low value for the browser Solver dialog, whose boards are small.
- **SOLVER-022 (done, solver v0.18): smaller per-state footprint.** `Store` nodes now hold only the packed state (parent u32, depth u16 and move 3 bytes removed, 9 of ~17 bytes for 8 balls); depth comes from layer bounds (`Store::bounds`/`depthOf`) and the route is rebuilt after a successful search (`rebuildForward`: first node of the previous layer with the wanted successor; `rebuildReverse`: a successor stored one layer lower in the reverse store). Checked on 10.9, 10.8, 5.7, 1.7: identical states, transitions, score and speed; memory 66 to 42 MB on 10.9 (about 1.55x, less than first estimated because the 4-byte index table, 8-11 bytes per state at load 0.25-0.5, was left alone). Bidirectional routes can differ from v0.17 in the reverse half (same length). **Pending:** rebuild the WASM bundle (`node wasm/build.js`, needs Emscripten). Further ideas: a 1-byte tag array so the index table can run at load ~0.75 (about 10% more), keys stored inline in the table (about 20% more, but loses insertion order and needs a 3x peak when growing), tighter key packing (floor cells only, combination ranking for same-colour balls: 1-2 bytes), disk-based duplicate detection.
- **SOLVER-006: Forward BFS is slower and larger than needed.** `simulate()` allocates per move; each `Node` stores a full `State`. Use the stamp-array `fastEnd` for static boards and store only a packed key. Beam on switch or rotating-arrow boards also uses the slow generic `successors()`.
- **SOLVER-008 / SOLVER-012: A\* / IDA\*** with the depth or score bound. A remaining-unlocked-balls bound is admissible; per-ball distance with other balls removed is **not** (other balls and gates act as stoppers). IDA\* needs almost no memory.
- **SOLVER-013: Resumable depth search** (`--save-frontier` / `--resume`) so a search stopped at depth N continues at N+1.
- **SOLVER-016: Beam search quality.** Open ideas: meet-in-the-middle with an exact reverse region, an endgame database for states with at most 3 undocked balls, automatic width/seed iteration, feeding the best length to the exact search as `--max-depth`.
- **SOLVER-018 (done):** the WASM bundle is v0.17 (source is v0.18, rebuild pending) and the Solver dialog accepts tunnels and rotating arrows. If `solver.cpp` changes, rebuild it (`node wasm/build.js`) and the Linux binary (`make release`; `Solver/kunsolve-linux-x86_64` currently reports v0.17).
- **TEST-002: No automated browser test suite** beyond `Solver/wasm/ui-test.js` (Solver dialog from file://) and `browser-test.js`. Optional: startup, Import, share links, editor load/save, rotating-arrow routes.
- **DATA-001: Never overwrite `levels.js` with a starter file.** After any bulk re-encode, confirm each saved solution still replays (the statistics script from 2026-11-22 does this: decode every entry with `Codec.decodeBoard`, replay with `Core.applyMove`, check `Core.isComplete`).

## 6. Verification

Latest full runs: solver and codec 2026-11-11/12 (`make`, then `node tests/verify.js` 10 cases, `random-compare.js` 50/50, `random-switch.js` 100/100); later solver versions re-ran `verify.js` (13+ cases incl. 10.8 optimal 28, hub/off-exit teleports, wall color, beam) and `tests/mechanics.js` (all algorithms vs a brute-force oracle on tunnel/rotating-arrow boards). Certified optimal scores in `verify.js`: 6.6 → 18, 7.1 → 15, 7.4 → 27, 7.6 → 20, 7.10 → 27, 8.1 → 18, 10.8 → 28; with hexes 1.7 → 3 (13 moves), 1.8 → 5 (10 moves), 2.2 → 9 (14 moves). The 2026-11-22 catalog check (all 300 embedded routes replay and finish) is described in section 2.

The `--max-depth` certificate (exit 4) proves a move count, so it is a score certificate only on hex-free boards; on boards with hexes use `--max-score`.

## 7. Commands

```sh
# Solver (from Solver/)
make
node tests/verify.js
node tests/random-compare.js
node tests/random-switch.js
node tests/mechanics.js
./kunsolve --level 8.1 --catalog ../levels.js --max-depth 17 --no-code   # exit 4 = nothing of 17 moves or fewer, so a known 18 is optimal
./kunsolve --level 8.1 --catalog ../levels.js --max-score 17 --no-code   # same for boards with hexes (score bound)

# Parser (historical Python, from parser/, needs numpy and OpenCV; the app uses parser.js)
python3 parse.py --help
```

## 8. Release gate

- `APP_VERSION` bumped; app tested from `index.html`.
- Rule regression tests pass; solver output replays through the original JS engine; `Solver/kunsolve-linux-x86_64 --version` matches `SOLVER_VERSION`.
- K3 JS↔Python round trip unchanged; compact and legacy replay links both work.
- Any new optimality claim has the solver's `OPTIMAL` certificate (or, on boards without hexes, `NO SOLUTION WITHIN L-1 MOVES`, exit 4, matching a replay-verified solution of L moves, or `NO SOLUTION WITH SCORE <= S-1` on boards with hexes) plus an independent replay; inconclusive stays inconclusive.
