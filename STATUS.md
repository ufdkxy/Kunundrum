# Kunundrum — Current State, Known Issues, Next Work

*Living document: keep it current, delete resolved items instead of appending history (Git has the history). See [RULES.md](RULES.md) and [ARCHITECTURE.md](ARCHITECTURE.md).*

**Last updated:** 2026-11-12 · **App version:** `APP_VERSION = '3.3.6'` in `app.js` (single source; shown after the brand name, top left, and as its tooltip). Bump it with every app change. The parser and solver have their own versions (`PARSER_VERSION` in `parser/parse.py`, `SOLVER_VERSION` in `Solver/solver.cpp`; both print with `--version`); bump each only when that component changes, never with the app.

## 1. Components

| Component | Location | State |
| --- | --- | --- |
| Browser Replay Lab / editor | repo root (`index.html`, `app.js`, `editor.js`, …) | Engine, rendering, replay, editor, K2/K3 read, K3 export, share links, local catalog and music source exist. **Not browser-tested in any review so far.** |
| Page layout | `index.html`, `styles.css` (end of file) | Vertically compact, no page scroll on desktop: board + bottom bar (view toggles, selected ball and position, hint `mouse / Arrow keys: move.`) left; right column = Undo/Reset/speed row, transport row (standard five buttons: start, prev, autoplay, next, end); speed menu sits right-aligned in the Undo/Reset row; the route position tracker (n / m) lives in the Move history heading, Move history, Replay-a-solution input. Ball-picker, d-pad and footer were removed: select by clicking/tapping a ball or R/G/B/Y, move by drag/swipe or arrow keys. Narrow screens stack the column under the board. |
| Puzzle picker | `app.js` `renderLevelCards`, `index.html` `#levels-dialog` | Left chapter bar (1–30, from the `a` in `a.b`, with n/10 counts); selecting a chapter shows its `a.b` previews on the right. Opens on the current level's chapter. Mobile: bar becomes a horizontal strip. |
| Level catalog | `levels.js` | **7 starter entries only** (6.6, 7.1, 7.3, 7.4, 7.6, 7.10, 8.1); not the complete private catalog. |
| Screenshot parser | `parser/` (v0.6) | Python/OpenCV parser, manual overrides, review image, diagnostics, pure-Python K3 encoder, arrow templates. No screenshot test corpus in the repo. |
| Native solver | `Solver/` (v0.2, switch-aware) | C++17 CLI: exact forward and bidirectional BFS, certified `OPTIMAL`/`INCONCLUSIVE` outcomes, K3 solution export, JS cross-verification tests. No WASM/browser integration. |
| Shared rules/codec | `engine.js`, `codec.js` (repo root) | Single copy, used directly by the web app, `Solver/tests/*.js` and `parser/encode_k3.js`. |

## 2. Last verification

**Solver and codec, 2026-11-11** (g++ 14.2.0, Node 22.16.0, original ZIP sources). **Re-run 2026-11-12 from the repo** (Node 22.23.4, shared root `engine.js`/`codec.js`/`levels.js`): `verify.js` 10 cases, `random-compare.js` 50/50 and `random-switch.js` 100/100 all passed: `make`, then `node tests/random-compare.js` (50/50), `node tests/random-switch.js` (100/100, 0 skipped) and `node tests/verify.js` (10 end-to-end cases) all passed. K3 round trip: all 7 catalog entries re-encoded by `parser/encode_k3.py` matched `Codec.encodeBoard` byte for byte.

Certified optimal slide counts (`verify.js`): 6.6 → 18, 7.1 → 15, 7.4 → 27, 7.6 → 20, 7.10 → 27, 8.1 → 18. Level 7.3 is not in `verify.js`; no optimality claim for it. `Solver/README.md` still says 7.4 is inconclusive at 1.5M states; the actual test run certified it, so trust the test output.

**Not yet checked:** browser launch and UI/editor behavior; parser accuracy on real screenshots; switch mappings and signed hex values against the game; performance on a large catalog.

## 3. Known issues

### P1 — to reproduce and fix

- **WEB-002: Pasted `#route=` link loses its route.** `boot()` handles `shared.route`, but `importBoard()` in `app.js` only builds a replay from `share.moves`. Pasting a compact route link into Board Data loads the board without the replay. Fix without breaking `#moves=` links and add a browser regression test. *Found by source inspection (re-confirmed 2026-11-12); not browser-reproduced.*
- **PARSE-001: Saved diagnostics omit encoding failures.** `parse.py` writes `NAME_diagnostics.json` before the automatic K3 encode, so an encode failure is only in the console. Write diagnostics after encoding or rewrite on exception.
- **PARSE-002: Single-switch auto-mapping overrides explicit input.** In `assemble_board`, the single-switch/all-gates/no-teleports shortcut replaces `wallGroups` even when a `switches` override is supplied, and runs before `gateGroups` overrides (stale group references possible). Apply gate-group overrides first, honor explicit switch mappings, deduplicate, and validate the board before K3 output. Until then, inspect and fix the JSON by hand.
- **PARSE-003: Zero warnings does not mean a correct transcription.** Uncertain sprites, color/goal overlays and unusual scaling can fail silently. Check every `*_review.png` against its screenshot, and add regression tests for false negatives.

### P1 — mechanics screenshots cannot determine

- **MECH-001: Switch mappings.** A screenshot does not establish a switch's `wallGroups`/`teleportIds`; the one-switch auto-mapping is a heuristic. Default IDs (`W1`, `S1`, …) are not verified mappings.
- **MECH-002: Hexagon signed values.** Detected score cells stay `hex_pending` until values are supplied; do not promote incomplete data to authoritative K3 codes.
- **MECH-003: Other ambiguous state.** Gates are encoded initially active; rotating arrows need `arrow_rotating` overrides; teleports pair automatically only with exactly two same-color endpoints. Verify against gameplay.

### P2 — solver and tests

- **DATA-001: Never overwrite a comprehensive `levels.js` with the starter file.** Back it up first; use `convert-levels.html` to migrate K2 entries and confirm each saved solution still replays.
- **SOLVER-001: Native only.** No Emscripten build, worker, progress/cancel API or UI.
- **SOLVER-002: Limits are not proofs.** `INCONCLUSIVE` never means unsolvable, and a best-found route is not optimal. `--max-states` caps nodes, not bytes; hexagon states grow fastest.
- **TEST-001: No parser test assets.** The v0.4 README cites 20 tested screenshots, none in the repo. Add originals, reviewed JSON and expected outputs under a test-data directory.
- **TEST-002: No browser tests.** Cover startup, Board Data import, share links, localStorage migration, editor load/save and geometry display.

## 4. Next work

1. Verify the browser app offline from `index.html`; restore the full private `levels.js` from the local working copy (keep the 7-entry starter for deterministic tests).
2. Fix WEB-002 and add browser tests for `#route` and legacy `#moves` links, persisted play, editor load/save, K2→K3 conversion and rotating-arrow routes.
3. Build a gold-standard screenshot set (original image, reviewed JSON, `fixes.json`, review PNG) including dim/cycling arrows, mixed ball+goal sprites, disconnected regions, 9.9 (10×8) and 9.10 (12×8) at 72-px cells, switch mappings and hex values.
4. Fix PARSE-001/002 and validate boards (`Core.validateBoard` or equivalent) before K3 emission.
5. Re-run solver tests from `Solver/` in the repo; scale to the full catalog, storing replay-verified solutions as fixtures.
6. Integrate the solver into the browser (worker/WASM with submit/cancel/progress and JS `Core` verification) only after the above; keep the native solver as the reference.
7. Keep this file, `RULES.md` and `ARCHITECTURE.md` current with every milestone; keep K2 imports, K3 codes and legacy replay links backward compatible unless told otherwise.

## 5. Commands

```sh
# Solver (from Solver/)
make
node tests/verify.js
node tests/random-compare.js
node tests/random-switch.js

# Parser (from parser/, needs numpy and OpenCV)
python3 parse.py --help
python3 parse.py Screenshots/ -o parsed/ --overrides fixes.json
python3 encode_k3.py parsed/8-2.json
```

The parser commands are workflows, not passing tests; they need screenshots and `fixes.json` that are not in the repo.

## 6. Release gate

- Browser app tested from `index.html` with an identified catalog; `APP_VERSION` bumped.
- Rule regression tests pass; solver output replays through the original JS engine.
- K2 imports readable; K3 JS↔Python round trip unchanged; compact and legacy replay links both work.
- Parser screenshots and reviewed outputs versioned; pending-mechanics cases never silently dropped.
- Any new optimality claim has the solver's `OPTIMAL` certificate plus an independent replay; inconclusive stays inconclusive.
