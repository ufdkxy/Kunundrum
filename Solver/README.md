# Kunundrum native C++ solver — prototype 0.19 (`SOLVER_VERSION` in `solver.cpp`, `kunsolve --version`; independent of the web app)

A dependency-free C++17 exact search engine for the **K4 Kunundrum board code** (see ../K4.md). The solver accepts a board code (or a file containing one), searches for the **lowest-score** solution (score = moves plus one-time hex bonuses and penalties; fewest moves among equal scores), checks the resulting path against its simulator, and exports a new K3 code with the solution embedded.

**This is a separate solver, not an update to the Replay Lab app.** The solver core is `solveBoard()` (board code + limits in, structured `Outcome` out, progress lines to a log stream); `main()` is a thin CLI wrapper. `make wasm` (see `wasm/README.md`) builds it with Emscripten and exports `kun_solve(code, flags)`; the worker and browser UI are **not included** yet.

## Build

Linux/macOS with g++ or clang++:

```sh
make
# or: g++ -O3 -std=c++17 -DNDEBUG solver.cpp -o kunsolve
```

Windows with Microsoft Visual C++ (Developer Command Prompt):

```bat
cl /O2 /EHsc /std:c++17 solver.cpp /Fe:kunsolve.exe
```

Windows with MinGW-w64:

```bat
g++ -O3 -std=c++17 -DNDEBUG solver.cpp -o kunsolve.exe
```

A prebuilt **Linux x86-64** `kunsolve-linux-x86_64` is included for convenience: a statically linked, stripped build of the current source (check with `./kunsolve-linux-x86_64 --version`; it runs on any x86-64 Linux without libstdc++ or glibc version concerns). Rebuild it with `make release` whenever `solver.cpp` changes. There is no prebuilt Windows executable in this archive.

## Run

```sh
./kunsolve --level 8.1
./kunsolve --level 7.6 --seconds 60 --max-states 2000000
./kunsolve --level 8.1 --max-depth 17          # prove there is no solution of 17 moves or fewer
./kunsolve 'K4.YOUR_CODE' --seconds 120 --max-states 3000000
./kunsolve board-code.txt --algorithm forward
cat board-code.txt | ./kunsolve -
```

The solver reads `levels.js` from the current directory by default. In this repository the catalog and the shared `engine.js`/`codec.js` live in the repo root (not in `Solver/`); pass `--catalog ../levels.js` when running from `Solver/`.

Options:

- `--algorithm auto|forward|bidirectional|beam` — `bidirectional` is the [bidirectional search](#bidirectional-search) (needs no hexes, equal goals/balls and an affordable terminal-state enumeration); **`auto` chooses it** for applicable boards with at least 3 balls, else forward. (v0.17: the former `balanced` is now simply `bidirectional`; the old forward-heavy version was removed.)
- `--max-states N` — maximum combined stored states (forward + reverse), default 3,000,000; `0` = unlimited.
- `--threads N` — worker threads for forward and bidirectional search (default 0 = all cores; beam search and the WASM build are single-threaded). Results (route, states, transitions) do not depend on N; only the speed does.
- `--max-memory MB` — cap on the stored state bytes (default none). With no limits the memory of the machine is the real limit: v0.7/v0.8 stored roughly 20-30 bytes per state; since v0.18 a state costs its packed key (about 8 bytes for 8 balls) plus a 4-byte index-table slot at load 0.25-0.5, roughly 40% less. Routes are rebuilt after the search instead of being stored.
- `--seconds S` — wall-clock search limit, default 60; `0` = unlimited.

- `--beam-heuristic static|dynamic` — beam ranking (default `static`); see [Beam search](#beam-search-heuristic-upper-bound).
- `--beam-width N` — states kept per layer by `--algorithm beam` (default 200,000); `--seed N` — its tie-break seed (default 1).
- `--split-depth P` / `--reverse-depth R` — bidirectional search only (v0.24). Builds the reverse set once (to depth R; without `--reverse-depth` it grows until it would use about 40% of `--max-states`/`--max-memory`, so one of the three is required), then runs a separate forward search from every distinct state at depth P against it, freeing each run's forward states afterwards. The memory peak is the reverse set plus ONE root's forward states, so it trades time for memory: roots overlap (moves of different balls commute), so total work grows with P. Prefer the smallest P that fits, typically 1 or 2. Use `--max-depth` for lower-bound proofs. Too small an R makes every root's forward search deep and slow.
- `--disk-dir DIR` / `--disk-buckets N` — bidirectional search only (v0.25; native build). The reverse set is built in RAM exactly as for `--split-depth` (`--reverse-depth R`, or a `--max-states`/`--max-memory` budget; 40% of it is used), while the FORWARD layers live on disk in `N` hash buckets (default 256): each layer is expanded by reading its bucket files and writing every successor to the candidate file of its bucket (meeting the reverse set on the way), then each bucket is deduplicated against all its earlier layers, one bucket table per thread. Only sequential file access, every state is expanded once (no overlap, unlike `--split-depth`). RAM = reverse set + `--threads` bucket tables (raise `N` if those get large); disk = about one packed key per forward state plus one layer of candidates (roughly 5-8 candidates per new state). The files are deleted afterwards. Use `--max-depth` for lower-bound proofs; a found route is rebuilt from the layer files. Cannot be combined with `--split-depth`.
- `--max-depth N` — only consider solutions of at most N moves (N >= 1, default unlimited); see [Depth limit](#depth-limit-certifying-a-known-solution).
- `--max-score N` — only consider routes with score at most N (default: no bound); see [Score limit](#score-limit).
- `--json` — print the result as one JSON object (status, score, moves, solution, bounds, statistics, error) instead of text; the WebAssembly export returns the same object.
- `--quiet` — hide per-depth progress; statistics and results still print.

Outcomes/exit codes:

- **OPTIMAL** (exit 0): accepted solution with the lowest possible score (fewest moves among equal scores), proved by exhaustive exploration. The output lists `Score:` and `Moves:`. The K3 output includes the solution.
- **UNSOLVABLE** (exit 3): entire reachable-state search exhausted without an accepted completion.
- **INCONCLUSIVE** (exit 2): time, state or memory budget was exceeded; no optimality claim.
- **SOLUTION FOUND (optimality not certified)** (exit 2): solution verified, but incomplete layers prevent an optimality guarantee.
- **NO SOLUTION WITHIN N MOVES** (exit 4, only with `--max-depth N`): every sequence of at most N moves was covered and none is accepted, so the optimum is at least N+1 moves (or the board is unsolvable).
- **NO SOLUTION WITH SCORE <= N** (exit 4, only with `--max-score N`): every route that could score N or less was covered and none finishes the board, so the optimal score is at least N+1 (or the board is unsolvable). It is never reported as UNSOLVABLE, because pruned states mean the whole space was not covered.
- Beam search always ends with **SOLUTION FOUND (optimality not certified)** (exit 2) or **INCONCLUSIVE** (exit 2); it never proves anything.
- Invalid input or unsupported forced algorithm: exit 1.

## Depth limit: certifying a known solution

`--max-depth N` restricts the search to solutions of at most N moves. Its main use is to certify a solution you already have. **This certifies the move count, which equals the score only on boards without hexes.** On a board with hexes the objective is the score, which a longer route can lower, so certify by running without `--max-depth` and comparing the printed `Score:`. If a hex-free level has a replay-verified solution of L moves:

```sh
./kunsolve --level 8.1 --catalog ../levels.js --max-depth 17     # L = 18
```

- **exit 4** (`NO SOLUTION WITHIN 17 MOVES`): nothing shorter exists, so the known L-move solution is optimal.
- **exit 0** (`OPTIMAL`): a shorter solution exists; it is printed and replay-verified.
- **exit 2** (`INCONCLUSIVE`): time or state budget ran out; no claim.

With hexes, `--max-depth N` returns the lowest score among routes of at most N moves; `OPTIMAL` is printed only when no longer route can score lower (a route of more than N moves scores at least N+1 plus the sum of all negative hex values).

## Score limit

`--max-score N` starts the search with the bound "score at most N": every state whose lower bound (`score so far + unlocked balls + unconsumed negative hex values`) exceeds N is discarded from the start, instead of only after a route has been found. To certify a saved route that scores S, run with `--max-score S-1` and expect exit 4; with `--max-score S` the solver returns the optimal route (score S, `OPTIMAL`). It works on hex boards, where `--max-depth` does not certify the score. Without hexes the score is the move count, so `--max-score N` is turned into `--max-depth N` and the bidirectional search can be used.

```
./kunsolve --level 1.8 --catalog ../levels.js --max-score 4   # exit 4: no route scores 4 or less
./kunsolve --level 1.8 --catalog ../levels.js --max-score 5   # OPTIMAL, score 5 (10 moves)
```

The bound is weak when a board has many large negative hexes: level 7.3 (16 hexes) is still inconclusive with `--max-score 0` at 2,000,000 states (10 s) and at 8,000,000 states (54 s).

Searching with `--max-depth L` instead also certifies (it returns `OPTIMAL` with L moves), but `L-1` is cheaper because the last layer is never expanded.

How it is applied: forward BFS stops expanding at the limit, and on the final layer only tests whether a generated state is accepted without storing it, which saves the largest layer's memory. Bidirectional search ignores meeting points longer than N and certifies once the complete forward and reverse depths together reach N. A bound is only reported when no state, time or rotating-arrow choice budget was exceeded. The limit gives a bound on length; it does not by itself make BFS faster, but it is the natural cut-off for a future A*/IDA* search.

## Algorithms

### Forward breadth-first search

All game features use the same transition semantics as `engine.js`: all four ball directions; fixed and rotating arrows (shared clock, see below); tunnels; colored/universal teleports; consumable hexes and score; toggle switches/walls/teleports; permanent goal locking. **Rotating arrows:** the clock phase is not search state; the player picks it before every move, so each (ball, direction) is simulated for each distinct phase (4 if some arrow is clockwise/counterclockwise, 2 if only flip arrows, none when the move meets no rotating arrow) and phases giving the same trajectory are one move. The route output uses the `(->xy)` notation of RULES.md §5 (`xy`: orientation of the first rotating arrow, plus that of the first period-4 arrow after a flip arrow). **Tunnels** replace the step across an opening: the ball enters the partner cell heading inward (that cell is processed like any entered cell); a blocked exit stops the ball at the entrance.

States are quotiented by permutations of same-colored balls; route reconstruction assigns them back to the original G1/G2/... IDs. The state key contains all mutable gate, switch, teleport and consumed-hex flags. The score is not part of the key (v0.2 to v0.4 keyed on it): for one geometry and one set of consumed hexes the score (moves + consumed hex values) only grows with the move count, and breadth-first order reaches every such state with the fewest moves first, so the first arrival is the best one.

**Objective (v0.4).** Without hexes, the score equals the move count, so the first complete state is optimal. With hexes a longer route can score lower (v0.3 and earlier stopped at the first accepted state, i.e. minimized moves, and wrongly certified 1.7 and 1.8). Now the search continues past the first solution found and discards every state whose lower bound cannot beat the best score found: `score so far + (unlocked balls, one move each) + (sum of unconsumed negative hex values)`. Breadth-first order means equal scores are found fewest moves first. `OPTIMAL` is only printed once the whole bounded space is covered. The bound is weak with large negative hexes: 7.3 (16 hexes, values -15..20) is not certified within the default limits.

### Switch-aware bidirectional breadth-first search (v0.2)

The reverse search enumerates **genuine predecessor transitions** for static walls, fixed arrows, teleports, and now **switches controlling gates and teleports**, including the game's blocked-closing rule. As before, a backward edge is accepted only if the corresponding forward move reproduces its successor state; the final reported path is also independently replayed from the original initial board.

The starting reverse frontier includes **all possible terminal gate configurations**, using one bit per gate *group* (gates controlled by exactly the same switches), not one bit per individual wall. This works because all gates in a group always flip together. Controlled teleports are similarly enumerated, while uncontrolled teleports retain their initial state. States differing only in the switch's visual on/off indicator are safely merged: the indicator never affects move legality or switch behavior, only the actual gate/teleport flags do.

- Equal numbers of goals and balls are required for bidirectional mode.
- **Switches are supported**, including simultaneous toggling of multiple gates and dynamic teleports.
- **Consumable hexagons** still need forward search (or beam). Fixed/rotating arrows, tunnels, active and inactive teleports are supported by the bidirectional search too (the reverse search treats each clock phase as a static arrow layout and tunnels as extra edges).
- If enumerating terminal configurations exceeds a conservative limit (16 bits or one quarter of the state budget), auto mode falls back to forward BFS.
- Reverse expansion (v0.8) ray-casts backward from each ball's destination over the same move rules as the forward search (stoppers, fixed arrows, teleports), so its cost follows the number of real predecessors, not cells x 4. There is no fixed reverse depth cap; the state/byte/time budget and `--max-depth` bound it.
- A reverse layer cut short by the time/state budget is discarded, and the solver issues an optimality certificate only after complete reverse and forward search layers cover all shorter candidate paths.

Benchmark (single run in this environment; timings are not portable):

| Board | Algorithm | States | Result | Time |
|---|---|---:|---|---:|
| 6.6 | Switch-aware bidirectional | 30,078 | Optimal 18 | 0.28s |
| 7.4 | Switch-aware bidirectional | 261,652 | Optimal 27 | 1.63s |
| 7.4 | Forward BFS | 1,500,000 | Inconclusive | 9.86s |
| 8.1 | Bidirectional | 730,064 | Optimal 18 | 9.66s |

This is an **exact**, not heuristic, algorithm when it terminates successfully. Reaching resource limits remains inconclusive. Runtime and state count need not always improve relative to forward BFS; on easy switch boards, bidirectional reverse enumeration can have extra overhead.

## Bidirectional search

`--algorithm bidirectional` (also what `auto` selects; called "balanced" in v0.11-v0.16) is the exact bidirectional search with one shared budget (`--max-states`, `--max-memory`) and alternating layers: each step expands a whole layer of whichever side (forward from the start, reverse from the goal) currently has the smaller frontier, and every new state is looked up in the other side's store, from both directions. It has the same preconditions and gives the same certified results as `bidirectional` (it is cross-checked against forward and bidirectional on the catalog and on the random tests), but it does not cap the reverse side at about 1,000,000 states, which made `bidirectional` very forward-heavy on large boards.

- Certification: with the forward side complete to depth `fd` and the reverse side to depth `rd`, every route of at most `fd + rd` moves has been found, so the best candidate is optimal once `fd + rd >= best - 1`.
- When the budget or time runs out, `INCONCLUSIVE` (or `SOLUTION FOUND (optimality not certified)`) is followed by `Lower bound: at least N moves` with `N = fd + rd + 1`. Only this mode prints that bound (the other exact modes report it only for `--max-depth` runs).
- Level 9.9 (8 balls): the former forward-heavy `bidirectional` (removed in v0.17) with `--max-states 0` (reverse capped at 1M states) completed forward depth 15 and reverse depth 9 with 143M states, proving at least 25 moves. the balanced search with `--max-memory 5000` completed forward depth 14 and reverse depth 15 with 193M states (840 s), proving **at least 30 moves**. The best known route has 42 moves.
- Chapter 10: 10.8 optimal 28 with 812k states (`bidirectional`: 1.2M); 10.9 optimal 28 with 2.7M states in 6 s (`bidirectional`: 2.8M).

## Beam search (heuristic; certifies in special cases)

`--algorithm beam` is for boards where the exact searches cannot finish (e.g. level 9.9: 8 balls, long corridors; exhaustive search proves only "no solution within 24 moves" before running out of memory, while a 300,000-state beam finds a 42-move route in about 45 s). It is meant to **lower the upper bound**; the route is re-simulated by the solver before printing. **Certification (v0.17):** on boards without hexes the score is the move count, so as long as the beam width has never dropped a state the beam is a plain BFS; a route found in layer D is then proved optimal (`OPTIMAL`, exit 0) if no state was dropped while building layers 1..D-1 (state dedup uses a 64-bit hash, a collision probability of about 1e-6 at 10 million states). Otherwise the output is `SOLUTION FOUND (optimality not certified)` (exit 2), with `Lower bound: at least N moves` for the complete layers before the first drop. If the whole reachable space is enumerated without drops and no route exists, the result is `UNSOLVABLE`; with `--max-depth` and no drops the result is `NO SOLUTION WITHIN N MOVES`. Boards with hexes are never certified.

- One layer per move; only the `--beam-width` best new states of each layer are kept (states already kept in earlier layers are dropped). Memory is roughly `3 x width x (state bytes + 20)` for the candidates of a layer plus the kept layers (needed to rebuild the route); `--max-memory` and `--seconds` stop the search (then `INCONCLUSIVE`).
- Ranking: sum over unlocked balls of the moves a *lone* ball needs to reach a free goal of its color (walls, gates, fixed arrows, teleports as initially set; other balls ignored), minimised over the ball-to-goal assignment (exact for up to 4 balls per color, greedy beyond), plus the hex score collected so far, plus a small random tie-break (`--seed`). The heuristic is inadmissible (other balls can act as stoppers) which is fine for an upper bound.
- Boards without switches (tunnels, rotating arrows and hexes included) use an allocation-free move generator (on 9.9, width 300,000 takes about 45 s and width 20,000 about 3 s); boards with switches use the generic `successors()` and are much slower. Hexes are supported: the search continues past the first route while a lower score is still possible.
- `--beam-heuristic dynamic` (boards without switches and rotating arrows) replaces each lone-ball distance by `min(static, distance with the other balls fixed where they stand now)`, so moving a ball into a spot where it stops another ball is rewarded immediately. It is about 5x slower per state but much better at small widths; at very large widths the static ranking wins (see below). Use `dynamic` for quick runs (width 5,000-50,000) and `static` with a very wide beam when time allows.
- Level 9.9 (user route: 47 moves), static: widths 5,000 / 20,000 / 100,000 / 300,000 / 600,000 / 1,000,000 give 63 / 59 / 53 / 42 / 42 / 42 moves (the jump between 100,000 and 300,000 is a threshold the beam must be wide enough to cross). Dynamic: widths 5,000 / 20,000 / 50,000 / 120,000 / 300,000 give 56 / 51 / 50 / 49 / 48 moves.
- Tip: wider beams and different `--seed` values give different routes; the best route found can be passed to the exact search as `--max-depth (length - 1)` once it is affordable.

## Tests

Node.js (optional, for independent cross-validation) is needed only for tests; the C++ solver itself has no Node dependency:

```sh
node tests/verify.js
node tests/split.js
```

`tests/verify.js` runs several real catalog levels and simple feature fixtures, decodes the native solver's exported K4 codes with the app's JavaScript codec, and replays every solution using the *original* JS `engine.js`.

`tests/verify.js` also runs beam search on 1.7, 1.8, 2.2 (known optimal scores 3, 5, 9), 7.3 and 8.1 plus basic, rotating-arrow and switch fixtures: each route must replay in the JavaScript engine; on hexed levels and on 8.1 at width 20,000 the output must say "optimality not certified", while 6.6 at width 2,000,000 and the tiny fixtures must be certified `OPTIMAL`. `tests/mechanics.js` (called by `verify.js`) checks tunnels and rotating arrows on small hand-made boards against a brute-force BFS built on the JS engine (`Core.applyMoveAtPhase` over every phase): forward, bidirectional and beam must all return its optimum, and the routes must replay.

`tests/split.js` checks the v0.24 predecessor fixes (24.1 and 8.6) and `--split-depth` against the plain bidirectional search on 10.8.

Tested on the following supplied catalog levels (times vary by machine):

| Level | Optimal moves | Algorithm | Typical environment time |
|---|---:|---|---:|
| 6.6 | 18 | Bidirectional BFS | < 1 s |
| 7.1 | 15 | Bidirectional BFS | ~ 5 s |
| 7.4 | 27 | Bidirectional BFS | ~ 2 s |
| 7.6 | 20 | Bidirectional BFS | < 1 s |
| 7.10 | 27 | Bidirectional BFS | < 1 s |
| 8.1 | 18 | Bidirectional BFS | ~ 10 s |
| 10.8 | 28 | Bidirectional BFS (`--max-depth 27`) | ~ 25 s |

With the default 3,000,000-state budget, **7.3** (16 hexagons, so forward BFS) and **10.9** are inconclusive; this is not a correctness failure, their search spaces are simply larger. 10.9 (like 10.8) certifies optimal at 28 with larger limits. As of 2026-11-22 five catalog levels still have no optimality proof for their embedded routes: **7.3** (26 moves, score 1), **9.9** (42; proven >= 30), **10.10** (107; proven >= 64), **15.8** (29) and **30.4** (27); see STATUS.md section 3. Possible future work: a local optimizer for stored routes and a parallel search.

## WebAssembly direction

The C++17 search/state model deliberately has no external libraries. It can be compiled by Emscripten, but a practical browser integration still needs a worker-based API for run/cancel/progress/result, bounded memory handling, and an app-side interface. The native executable is the baseline for testing that future compilation.

## Known limits

- The app's K4 **board codes** are supported (`--catalog` reads `levels.js` lines `id = K4.<board code><route>`; a route after the board code is ignored by the solver, which also accepts exported codes that include one; solutions are printed without commas). Legacy K1 and arbitrary JSON board files are not directly accepted; import/export JSON through Replay Lab first.

- Memory usage is dominated by the graph of visited states. `--max-states` is a count, **not** a strict memory budget.
- Boards with many hexes still have a large search space, since every subset of consumed hexes is a distinct state, and the score bound is weak with large negative hexes (7.3 is inconclusive at small budgets; the project owner has since proven it optimal with a tight `--max-score`).
- Forward and bidirectional search are multi-threaded (v0.19, `--threads`); beam search is not. The WASM build (`wasm/`) is single-threaded.

### Existing solutions as test inputs

Solutions supplied by a user are useful as **upper bounds** for branch-and-bound/heuristic search, and especially as 300 realistic regression fixtures to test move generation, switches, and output validity. A plain forward BFS already explores by increasing depth, so an incumbent doesn't automatically speed it up, but it can constrain depth in A*/IDA* or meet-in-the-middle variants. A supplied solution's length can be used with `--max-depth` (see above); the solver does not read the stored solution of a K3 code by itself yet.
