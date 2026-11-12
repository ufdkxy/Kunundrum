# Kunundrum — Current State, Verification, Known Issues, Next Work

**Status date:** 2026-11-11  
**Scope:** three user-supplied source archives; no external repository or private full catalog was available. This is a source-based baseline, **not** a claim that the packaged browser app or screenshot recognition has been end-to-end tested. See [RULES.md](RULES.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Snapshot

| Subsystem | Supplied version | State established from source |
| --- | --- | --- |
| Browser Replay Lab / editor | ZIP labeled `v3.0.1_K3_complete`; in-code version string `3.0.0` | Browser engine, rendering, replay, editor, K2/K3 read, K3 export, share links, local catalog and music source exist. **`index.html` missing from ZIP**, preventing standalone app launch as packaged. |
| Starter level catalog | Bundled `levels.js` | **7 entries only:** 6.6, 7.1, 7.3, 7.4, 7.6, 7.10, 8.1. It is **not** the complete private level catalog. |
| Screenshot parser | v0.4 | Python/OpenCV parser, manual overrides, annotated review image, diagnostics and pure-Python K3 encoding are implemented; bundled templates for animated arrows. Historical screenshot test images are **not included**. |
| Native optimal solver | v0.2, switch-aware | C++17 CLI with exact forward BFS and switch-aware bidirectional BFS, certified optimality outcomes, K3 solution export and JS cross-verification tests. **No WASM/browser integration.** |
| Shared JavaScript rules and codec | `engine.js`, `codec.js` | Byte-for-byte identical copies across the three ZIPs at this baseline. |

**Important inventory warning:** The browser README lists `index.html` as included and instructs opening it directly, but the supplied ZIP has no such file. The optional `Music/*.mp3` files are also absent, **by design**; their omission is not a packaging defect. The ZIP filename and embedded app/README version labels differ (`v3.0.1` versus `3.0.0`), so use source hashes/commits rather than version text alone when tracking changes.

## 2. Verification performed for this baseline

### Native solver — passed on 2026-11-11

A fresh executable was compiled with `make` using g++ 14.2.0, and these **unmodified bundled regression scripts** completed successfully under Node.js 22.16.0:

| Command | Observed result |
| --- | --- |
| `node tests/random-compare.js` | **PASS:** 50/50 static-board forward/bidirectional comparisons |
| `node tests/random-switch.js` | **PASS:** 100/100 generated switch-board comparisons; 0 skipped |
| `node tests/verify.js` | **PASS:** 10 end-to-end cases (six catalog boards plus basic, rotating-arrow, hex and switch fixtures); C++ solutions decoded and replayed successfully using original JS engine/codec |

The following minimum accepted move counts were certified by the solver during `verify.js` (exit status 0, `OPTIMAL`):

| Level | Optimal slides |
| --- | ---: |
| 6.6 | 18 |
| 7.1 | 15 |
| 7.4 | 27 |
| 7.6 | 20 |
| 7.10 | 27 |
| 8.1 | 18 |

**7.3 was not included in the end-to-end verify script**, and no new optimality claim is made for it. The solver's bundled README contains an older statement that **7.4** is inconclusive at a 1.5-million-state limit; the actual current test run **did** certify 7.4 at 27 moves. Prefer current executable/test output over that inconsistent prose. Runtimes and future resource-limit outcomes may vary by environment.

### K3 interoperability — passed on 2026-11-11

- Decoded all **seven** supplied `levels.js` entries using the bundled JavaScript `Codec` and normalized with the bundled JavaScript `Core`.
- Re-encoded each with `encode_k3.py` and compared against canonical `Codec.encodeBoard`; all **7/7 codes matched byte-for-byte**, including entries containing saved solutions.
- NumPy 2.3.5 and OpenCV 4.13.0 are installed in the review environment, so the parser dependencies import successfully. **No original screenshots were supplied with the ZIPs**, so grid-recognition and classification accuracy were not independently re-tested.

### Checks not performed

- Browser launch, visual UI/editor regression or link handling in a real DOM, because `index.html` is absent.
- Parser accuracy on the 20 screenshots claimed in its v0.4 README, because screenshots and expected outputs are absent.
- End-to-end manual confirmation of switch mappings and signed hex values against game behavior.
- Performance/memory testing on the full private catalog or compilation into WebAssembly.

## 3. Known issues and operational caveats

### P0 — Packaging and data integrity

**WEB-001: Missing browser entry point.** `Kunundrum_v3.0.1_K3_complete.zip` includes `app.js`, `editor.js`, CSS, other modules and `convert-levels.html`, but **no `index.html`**. Restore the last correct HTML page with its required DOM IDs and script order. Do not manufacture an untested replacement and call it equivalent to the missing original.

**DATA-001: Only a starter catalog is present.** The included `levels.js` has seven examples, not the complete user-maintained collection. **Never overwrite an existing comprehensive `levels.js`** with the ZIP's starter file. Keep a backup and use `convert-levels.html` to migrate K2 entries to K3 when needed; confirm each embedded solution still replays.

**BUILD-001: Version labeling not synchronized.** The ZIP is named v3.0.1, while `app.js` declares `APP_VERSION = '3.0.0'` and `README_K3.txt` refers to v3.0.0. Establish one release identifier and update package metadata/README at the next verified packaging milestone.

### P1 — Source-level gaps to reproduce and fix

**WEB-002: Pasted compact replay link loses route.** `app.js` startup (`boot`) handles `shared.route` via `Codec.decodeRoute`, but the Board Data import function `importBoard()` only builds replay from `share.moves`. A user pasting a `#route=` link into the Board Data dialog appears to load the board without its replay. Add a browser regression test and fix that import branch without breaking `#moves=` compatibility. **Detected by source inspection; not browser-reproduced in this baseline.**

**PARSE-001: Encoding errors are not fully reflected in saved diagnostics.** `parse.py` writes `NAME_diagnostics.json` **before** attempting automatic K3 encoding; if encoding fails, it appends a warning in memory afterward. The console reports failure, but the already-written JSON diagnostics omit that warning. Move final diagnostics writing after encoding or rewrite the file on exception. **Detected by source inspection.**

**PARSE-002: Single-switch auto-mapping can override explicit corrections and leave stale group references.** In `assemble_board`, the single-switch/all-gates/no-teleports shortcut *unconditionally* replaces that switch's `wallGroups`, even if the user supplied a `switches` override. It also runs **before** `gateGroups` overrides; a renamed/merged group can therefore leave stale switch references. Apply gate-group overrides first, honor an explicit switch mapping over any heuristic, deduplicate groups, and validate the completed board before K3 emission. Until fixed, inspect and correct the resulting JSON manually, then re-encode it. **Detected by source inspection.**

**PARSE-003: Clean warning counts cannot guarantee correct transcription.** The v0.4 arrow-shape matcher improves recognition of animation-dimmed chevrons, and geometry logic addresses 72-pixel large boards. But uncertain sprite types, stationary screenshot limitations, color/goal overlays and unfamiliar scaling can still produce **silent errors**. Inspect `*_review.png` against every source screenshot, even when no warnings appear. Add regression assertions for false negatives, not only warning counts.

### P1 — Mechanics that screenshots do not determine

**MECH-001: Switch control mapping.** A screenshot does not generally establish a switch's target `wallGroups`/`teleportIds`. The parser supports explicit override mappings, and its automatic one-switch/all-gates assumption is a **heuristic**, not a universal game rule. Do not interpret default `W1`, `S1`, etc. IDs as externally verified mappings.

**MECH-002: Hexagon signed values.** The parser labels visually detected score cells `hex_pending` until their positive/negative values are supplied. Incomplete data should not be promoted to authoritative K3 codes.

**MECH-003: Other ambiguous visual state.** Automatic parser labels encode gate tiles initially active; rotating-arrow identity is not reliably auto-classified and may need `arrow_rotating` overrides. Screenshot-based teleport pairing is only automatic when exactly two endpoints of one color appear. Verify gameplay state before finalizing each board.

### P2 — Solver and test coverage

**SOLVER-001: Native-only solver.** No Emscripten output, web worker, browser run/cancel/progress API, or UI exists in these archives. The native CLI is the current trusted backend.

**SOLVER-002: Resource limits are not negative proofs.** Searches can return `INCONCLUSIVE` due to time, state or rotating-choice limits. Never label such a puzzle unsolvable or its best found route optimal. `--max-states` is a node-count cap, not a memory-byte cap. Hexagon depth-sensitive states can grow particularly fast.

**TEST-001: Parser test assets absent.** There is no bundled screenshot corpus with golden corrected JSON and grid/arrow expectations; the v0.4 README reports 20 historically tested images but provides no rerunnable fixtures. Preserve original images and known-good outputs in a dedicated test-data directory once available.

**TEST-002: Cross-module UI tests absent.** Existing automated tests focus on C++ versus JS mechanics and encoding. The web editor, startup, Board Data import, share links, localStorage migration, and geometry display need reproducible browser tests once the HTML entry point is restored.

## 4. Recommended next sequence

1. **Create a single authoritative source repository.** Suggested root layout: `web/`, `parser/`, `solver/`, `tests/`, `testdata/`, plus root `RULES.md`, `ARCHITECTURE.md`, `STATUS.md`. Import all archive sources without modifying mechanics, and tag this baseline with the archive versions. Record the test commands and toolchain in CI. Avoid changing relative script/template paths until integration has been verified.
2. **Restore the missing `index.html` and complete catalog safely.** Retrieve the matching original page and the private `levels.js` from the user's latest local working version. Keep the seven-entry starter catalog separately for deterministic tests. Verify that the browser/editor run offline before making feature changes.
3. **Build a gold-standard screenshot dataset.** For each level, preserve the original full-resolution screenshot, reviewed board JSON, `fixes.json`, an annotated review PNG and any mechanic observations. Include known hard cases: dim/cycling arrows, mixed ball+goal sprites, disconnected board regions, 9.9 at **10×8** and 9.10 at **12×8** with 72-pixel cells, switch mappings and hex values. These dimensions are historical v0.4 release claims; they were **not** independently checked with images in this baseline.
4. **Implement strict parser validation and fix source-level gaps.** Validate generated boards with `Core.validateBoard` or equivalent portable checks before emitting K3; prevent unresolved/contradictory overrides from being silently accepted; fix `PARSE-001`/`PARSE-002`; compare each generated K3 against the JS codec on representative boards, and add tests for false-negative arrows.
5. **Fix and test the browser import path.** Cover `#route` and legacy `#moves` links, persisted play, editor load/save, K2-to-K3 conversion, rotating-arrow routes, and empty/invalid input; then synchronize the app version marker.
6. **Scale solver verification to the expanded catalog.** Store independently replayed solutions as regression fixtures and incumbent move-count bounds where applicable. Compare exact search to known solutions; an incumbent is not itself a proof of optimality. Benchmark large switch/hex/rotating boards before changing algorithms.
7. **Integrate solver into the browser only after baseline is stable.** Define a worker/WASM interface for submit/cancel/progress/result, memory/state budgets, and output verification via the JS `Core` implementation. Keep the native solver as a reference executable.
8. **Update these three docs at every meaningful milestone** with precise version, observed test results, new known issues, and schema/semantics changes. Preserve backward compatibility with K2 board imports, K3 codes and legacy replay text links unless explicitly instructed otherwise.

## 5. Repeatable baseline commands

```sh
# Native solver (from a source checkout's solver directory)
make
node tests/verify.js
node tests/random-compare.js
node tests/random-switch.js

# Screenshot parser (from its directory, with numpy/OpenCV installed)
python3 parse.py --help
python3 parse.py Screenshots/ -o parsed/ --overrides fixes.json
python3 encode_k3.py parsed/8-2.json
```

The screenshot commands are **workflows**, not tests that passed in this review: they require additional files (`Screenshots/`, `fixes.json`, corrected JSON) not included in the archives. The solver test commands **were** executed successfully with the supplied sources.

## 6. Acceptance gate for the next release

- Browser distribution includes a tested `index.html`, all required JS/CSS/assets, and an explicitly identified catalog; release labels agree.
- Game-rule regression tests pass; exact C++ solutions are accepted when replayed through the **original** JavaScript engine.
- K2 imports remain readable; K3 JS↔Python round-trip is unchanged for regression fixtures; both compact and legacy replay links work.
- Parser's original screenshots and reviewed board outputs are versioned; warnings and mechanics-pending cases are not silently discarded.
- Any new optimality claims include the solver's `OPTIMAL` certificate and an independently verified replay; inconclusive results remain labeled inconclusive.
