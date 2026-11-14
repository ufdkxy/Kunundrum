# Kunundrum — Current State, Known Issues, Next Work

*Living document: keep it current, delete resolved items instead of appending history (Git has the history). See [RULES.md](RULES.md) and [ARCHITECTURE.md](ARCHITECTURE.md).*

**Last updated:** 2026-11-13 · **App version:** `APP_VERSION = '3.3.13'` in `app.js` (single source; shown after the brand name, top left, and as its tooltip). Bump it with every app change. Invalid-but-readable boards (codes, links, JSON) now open in the editor with the problems listed instead of failing to load; Play stays gated by validation (`decodeBoard(code, problems)`, `validateBoard(raw, problems)`). The parser and solver have their own versions (`PARSER_VERSION` in `parser/parse.py`, `SOLVER_VERSION` in `Solver/solver.cpp`; both print with `--version`); bump each only when that component changes, never with the app.

## 1. Components

| Component | Location | State |
| --- | --- | --- |
| Browser Replay Lab / editor | repo root (`index.html`, `app.js`, `editor.js`, …) | Engine, rendering, replay, editor, K2/K3 read, K3 export (Export dialog: "URL format" and "Include route" checkboxes; a K3 code with route embeds it as the saved solution), share links, local catalog and music source exist. **Not browser-tested in any review so far.** |
| Page layout | `index.html`, `styles.css` (end of file) | Vertically compact, no page scroll on desktop: board + bottom bar (view toggles, selected ball and position, hint `mouse / Arrow keys: move.`, which becomes `Moving...` only while autoplay runs; `renderHint()` in `app.js`, refreshed by `renderControls()`) left; right column = Undo/Reset/speed row, transport row (standard five buttons: start, prev, autoplay, next, end); speed menu sits right-aligned in the Undo/Reset row; the route position tracker (n / m) lives in the Move history heading, Move history, Replay-a-solution input. Ball-picker, d-pad and footer were removed: select by clicking/tapping a ball or R/G/B/Y, move by drag/swipe or arrow keys. Narrow screens stack the column under the board. |
| Puzzle picker | `app.js` `renderLevelCards`, `index.html` `#levels-dialog` | Left chapter bar (1–30, from the `a` in `a.b`, with n/10 counts); selecting a chapter shows its `a.b` previews on the right. Opens on the current level's chapter. Mobile: bar becomes a horizontal strip. |
| Level catalog | `levels.js` | **9 entries** (6.6, 7.1, 7.3, 7.4, 7.6, 7.10, 8.1, 10.8, 10.9), each with an embedded solution that solves the board; the full 300-level catalog is not in the repo yet. |
| Screenshot parser | `parser/` (v0.8) | Python/OpenCV parser, manual overrides, review image, diagnostics, pure-Python K3 encoder, arrow templates. No screenshot test corpus in the repo. |
| Native solver | `Solver/` (v0.4, switch-aware, lowest-score objective) | C++17 CLI: exact forward and bidirectional BFS, certified `OPTIMAL`/`INCONCLUSIVE` outcomes, `--max-depth` lower-bound certificates (exit 4), K3 solution export, JS cross-verification tests. No WASM/browser integration. |
| Shared rules/codec | `engine.js`, `codec.js` (repo root) | Single copy, used directly by the web app, `Solver/tests/*.js` and `parser/encode_k3.js`. |

## 2. Last verification

**Solver and codec, 2026-11-11** (g++ 14.2.0, Node 22.16.0, original ZIP sources). **Re-run 2026-11-12 from the repo** (Node 22.23.4, shared root `engine.js`/`codec.js`/`levels.js`): `verify.js` 10 cases, `random-compare.js` 50/50 and `random-switch.js` 100/100 all passed: `make`, then `node tests/random-compare.js` (50/50), `node tests/random-switch.js` (100/100, 0 skipped) and `node tests/verify.js` (10 end-to-end cases) all passed. K3 round trip: all 7 catalog entries re-encoded by `parser/encode_k3.py` matched `Codec.encodeBoard` byte for byte.

Certified optimal scores (`verify.js`): 6.6 → 18, 7.1 → 15, 7.4 → 27, 7.6 → 20, 7.10 → 27, 8.1 → 18 (no hexes, so score = moves); with hexes 1.7 → 3 (13 moves), 1.8 → 5 (10 moves), 2.2 → 9 (14 moves). Level 7.3 is not in `verify.js`; the solver makes no claim for it (it finds a 16-move route with score 16, far worse than the saved route's score 1, and cannot certify within the default limits).

**App 3.3.15, 2026-11-14: move history minimum height.** The move history panel now reserves room for two rows of moves (e.g. level 1.9) so the layout no longer jumps as moves are added: 99px standard, 100px small screens, 77px in the compact layout.

**Solver v0.5 and app 3.3.14, 2026-11-14: no score floor.** The `score >= 1` acceptance rule was removed (it is not a game rule): a board is solved when every ball is locked, and scores of zero or below are valid. `Core.isAccepted` is gone (use `Core.isComplete`), the app no longer warns about scores of 0 or less, the legacy `slides` best-score key is no longer read, and the solver's state key no longer contains the score (a state's score only grows with its move count, so breadth-first order keeps the best). Catalog results are unchanged: every level except 7.3, 10.8, 10.9 is certified and equals the saved score; `verify.js` 13 cases, `random-compare.js` 50/50, `random-switch.js` 100/100 pass. A board that is already docked returns `OPTIMAL` with 0 moves and score 0.

**Solver v0.4, 2026-11-13: objective fixed to the lowest score.** Through v0.3 the solver minimized the move count, so on boards with hexes its `OPTIMAL` was wrong (1.7: 5 moves / score 15 instead of 13 / 3; 1.8: 8 moves / score 8 instead of 10 / 5; 2.2 happened to agree). v0.4 searches past the first accepted state with an admissible bound. All 38 catalog levels now give the saved route's score (7.3, 10.8, 10.9 inconclusive at 3,000,000 states); `verify.js` 13 cases (adds 1.7, 1.8, 2.2 with expected scores), `random-compare.js` 50/50, `random-switch.js` 100/100 passed. The `--max-depth` exit-4 certificate proves a move count, so it is a score certificate only on hex-free boards.

**Solver v0.3, 2026-11-13** (g++, Node, 2-core container, single runs, so timings are rough): `verify.js` 10 cases, `random-compare.js` 50/50 and `random-switch.js` 100/100 (both now with `--max-depth` checks at the optimum and optimum − 1) all passed. Hex state key (clamped score instead of depth): 148 random boards with hexes (107 solved ones with a negative hex) gave identical outcome and move count to v0.2, with 1.9× fewer states in total; a further 44 boards that v0.2 could not finish in 400,000 states were finished (solved or proved unsolvable) by v0.3, but 10 of those re-run on v0.2 with 3,000,000 states still did not finish, so they are unchecked against it. A single ±1 hex on a free cell of 6.6 / 7.6 cost 4.9× / 5.9× more states in v0.2. Level 7.3 (hex values -15..20) is unchanged: 905,912 vs 906,468 states at depth 13.

Stored solutions checked with `--max-depth (length − 1)` (`--max-states 3000000 --seconds 90`): **exit 4, so the stored length is certified optimal** (all hex-free, where score = moves) for 6.6 (18), 7.1 (15), 7.4 (27), 7.6 (20), 7.10 (27), 8.1 (18) and 10.8 (28). **Inconclusive** (3,000,000 states): 7.3 (26, forward BFS because of the hexes) and 10.9 (28).

**Not yet checked:** browser launch and UI/editor behavior; parser accuracy on real screenshots; switch mappings and signed hex values against the game; performance on a large catalog.

## 3. Known issues

### P1 — to reproduce and fix

- **PARSE-001: Saved diagnostics omit encoding failures.** `parse.py` writes `NAME_diagnostics.json` before the automatic K3 encode, so an encode failure is only in the console. Write diagnostics after encoding or rewrite on exception.
- **PARSE-002: Single-switch auto-mapping overrides explicit input.** In `assemble_board`, the single-switch/all-gates/no-teleports shortcut replaces `wallGroups` even when a `switches` override is supplied, and runs before `gateGroups` overrides (stale group references possible). Apply gate-group overrides first, honor explicit switch mappings, deduplicate, and validate the board before K3 output. Until then, inspect and fix the JSON by hand.
- **PARSE-003: Zero warnings does not mean a correct transcription.** Uncertain sprites, color/goal overlays and unusual scaling can fail silently. Check every `*_review.png` against its screenshot, and add regression tests for false negatives.

### P1 — mechanics screenshots cannot determine

- **MECH-001: Switch mappings.** A screenshot does not establish a switch's `wallGroups`/`teleportIds`; the one-switch auto-mapping is a heuristic. Default IDs (`W1`, `S1`, …) are not verified mappings.
- **MECH-002: Hexagon signed values.** Detected score cells stay `hex_pending` until values are supplied; do not promote incomplete data to authoritative K3 codes.
- **MECH-003: Other ambiguous state.** Gates are encoded initially active; rotating arrows need `arrow_rotating` overrides; teleports pair automatically only with exactly two same-color endpoints. Verify against gameplay.

### P1 — mechanics recorded but not implemented

- **MECH-004: Wraparound walls** (paired outline portals that can change the heading) are in no component: not `engine.js`, `solver.cpp`, the K3 format or the parser. Needs a board format extension first (K4 or a K3 field). In the solver the move loops already key loop detection on heading, and the reverse search generates every predecessor and tests it with `fastEnd`, so adding wraparounds to `simulate`/`fastEnd` should carry over to bidirectional search without a separate reverse rule.
- **MECH-005: Rotating arrows follow a shared phase clock** (rule in [RULES.md](RULES.md) §6b: orientations frozen during a move; only the first rotating arrow is selectable, by waiting). `engine.js` and the solver still let the player choose independently at every rotating arrow, which over-approximates the game, so certified counts for boards with rotating arrows are for the simplified model. Blocked on the open questions in §6b (cost of waiting, clock advance, board/K3 encoding). The solver state would gain a phase (mod 4) and the choice branching would shrink to the first arrow.

### P2 — solver and tests

- **DATA-001: Never overwrite a comprehensive `levels.js` with the starter file.** Back it up first; use `convert-levels.html` to migrate K2 entries and confirm each saved solution still replays.
- **SOLVER-001: Native only.** No Emscripten build, worker, progress/cancel API or UI.
- **SOLVER-002: Limits are not proofs.** `INCONCLUSIVE` never means unsolvable, and a best-found route is not optimal. `--max-states` caps nodes, not bytes; hexagon states grow fastest.
- **SOLVER-003: `parseCode` skips board validation.** Overlapping floor features (later arrays silently overwrite earlier ones in `arrowAt`/`gateAt`/…), a ball starting inside an active gate, too few goals for a color, duplicate IDs are all accepted, whereas `Core.validateBoard` rejects them. Port the checks or run the board through the JS validator first.
- **SOLVER-004: Bidirectional search needs goals == balls.** The rules allow extra goals; those boards fall back to forward BFS. Enumerate goal subsets as reverse seeds instead.
- **SOLVER-005: `--max-choices` is unnecessary on hex-free boards.** A rotating-arrow move's reachable end cells are plain reachability over (cell, heading), so the cap and its loss of certificates could go. Probably moot once MECH-005 changes the choice model.
- **SOLVER-006: Forward BFS is slower and larger than needed.** `simulate()` allocates an occupancy vector and a hash set per move while the stamp-array `fastEnd` is used only by bidirectional search; each `Node` stores a full `State` (five vectors) plus its key. Use the fast path for static boards and store only a packed key.
- **SOLVER-007: Reverse expansion is brute force** (every cell × 4 directions × ball per node, tested with `fastEnd`), with a hard cap at reverse depth 12. Ray-cast backward from the destination instead.
- **SOLVER-008: A*/IDA* with the depth bound.** A remaining-unlocked-balls lower bound is admissible; per-ball distance with other balls removed is **not** (other balls and gates act as stoppers). With a depth limit D, hex boards can also prune states where `score + (D − depth) + (sum of unconsumed positive hexes) < 1`.
- **SOLVER-009: Automate certification.** Read the stored solution from a K3 code and compare it with the solver: on hex-free boards run `--max-depth L-1` (L = stored move count) and expect exit 4; on boards with hexes compare the stored route's score with the solver's `Score:`. Optionally over a whole catalog, reporting certified / better-found / inconclusive.
- **SOLVER-010: Accept a known score as a bound.** The solver starts with no incumbent and finds weak routes first (7.3: score 16 against a saved score of 1). An option such as `--max-score S` would let it prune with the saved route's score from the start, which is probably what makes 7.3 certifiable; it would also fit the `--max-depth` bound for A*/IDA*.
- **TEST-003: Hex/rotating/teleport mechanics are covered only by a few fixed fixtures in `verify.js`.** Test on the real levels rather than generated boards: as levels using those mechanics are added to `levels.js`, solve each, replay the route through `Core.applyMove`, and check the length against the stored solution (equal once certified; shorter would mean the stored solution is not optimal or the solver is wrong). Do not add large sets of synthetic boards.
- **BUILD-001: Keep the committed `Solver/kunsolve-linux-x86_64` current.** It is a static, stripped build (about 2 MB) made with `make release`; rebuild and commit it with every `solver.cpp` change (it currently matches v0.3).
- **TEST-001: No parser test assets.** The v0.4 README cites 20 tested screenshots, none in the repo. Add originals, reviewed JSON and expected outputs under a test-data directory.
- **TEST-002: No browser tests.** Cover startup, Board Data import, share links, localStorage migration, editor load/save and geometry display.

## 4. Next work

1. Verify the browser app offline from `index.html`; grow `levels.js` toward the full catalog (it currently holds 9 entries; keep a small fixed set for deterministic tests).
2. Add browser tests for `#route` and legacy `#moves` links, persisted play, editor load/save, K2→K3 conversion and rotating-arrow routes.
3. Build a gold-standard screenshot set (original image, reviewed JSON, `fixes.json`, review PNG) including dim/cycling arrows, mixed ball+goal sprites, disconnected regions, 9.9 (10×8) and 9.10 (12×8) at 72-px cells, switch mappings and hex values.
4. Fix PARSE-001/002 and validate boards (`Core.validateBoard` or equivalent) before K3 emission.
5. Scale solver certification to the full catalog: for each level run `kunsolve --level ID` and compare the printed `Score:` with the saved route's score (on hex-free levels `--max-depth (stored moves − 1)` with exit 4 is a cheaper certificate; SOLVER-009 would automate this). Levels left inconclusive (7.3, 10.9 so far) need the performance work in SOLVER-006/007/008.
6. Integrate the solver into the browser (worker/WASM with submit/cancel/progress and JS `Core` verification) only after the above; keep the native solver as the reference.
7. Keep this file, `RULES.md` and `ARCHITECTURE.md` current with every milestone; keep K2 imports, K3 codes and legacy replay links backward compatible unless told otherwise.

## 5. Commands

```sh
# Solver (from Solver/)
make
node tests/verify.js
node tests/random-compare.js
node tests/random-switch.js
./kunsolve --level 8.1 --catalog ../levels.js --max-depth 17 --no-code   # exit 4 = nothing of 17 moves or fewer, so a known 18 is optimal

# Parser (from parser/, needs numpy and OpenCV)
python3 parse.py --help
python3 parse.py Screenshots/ -o parsed/ --overrides fixes.json
python3 encode_k3.py parsed/8-2.json
```

The parser commands are workflows, not passing tests; they need screenshots and `fixes.json` that are not in the repo.

## 6. Release gate

- Browser app tested from `index.html` with an identified catalog; `APP_VERSION` bumped.
- Rule regression tests pass; solver output replays through the original JS engine; `Solver/kunsolve-linux-x86_64 --version` matches `SOLVER_VERSION`.
- K2 imports readable; K3 JS↔Python round trip unchanged; compact and legacy replay links both work.
- Parser screenshots and reviewed outputs versioned; pending-mechanics cases never silently dropped.
- Any new optimality claim has the solver's `OPTIMAL` certificate (or, on boards without hexes, a `NO SOLUTION WITHIN L-1 MOVES` bound, exit 4, matching a replay-verified solution of L moves) plus an independent replay; inconclusive stays inconclusive.
