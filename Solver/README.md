# Kunundrum native C++ solver — prototype 0.2 (`SOLVER_VERSION` in `solver.cpp`, `kunsolve --version`; independent of the web app)

A dependency-free C++17 exact search engine for the **K2/K3 Kunundrum board format**. The solver accepts a board code (or a file containing one), searches for a minimum-slide solution, checks the resulting path against its simulator, and exports a new K3 code with the solution embedded.

**This is a separate solver, not an update to the Replay Lab app.** The source is suitable for an eventual Emscripten/WebAssembly build, but a browser-facing WebAssembly module and browser UI are **not included** yet.

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

A prebuilt **Linux x86-64** `kunsolve-linux-x86_64` is included for convenience. There is no prebuilt Windows executable in this archive.

## Run

```sh
./kunsolve --level 8.1
./kunsolve --level 7.6 --seconds 60 --max-states 2000000
./kunsolve 'K3.YOUR_CODE' --seconds 120 --max-states 3000000
./kunsolve board-code.txt --algorithm forward
cat board-code.txt | ./kunsolve -
```

The solver reads `levels.js` from the current directory by default. In this repository the catalog and the shared `engine.js`/`codec.js` live in the repo root (not in `Solver/`); pass `--catalog ../levels.js` when running from `Solver/`.

Options:

- `--algorithm auto|forward|bidirectional` — auto selects bidirectional search for boards without hexagons/rotating arrows when terminal gate/teleport masks fit the state budget, otherwise forward BFS.
- `--max-states N` — maximum combined stored states, default 2,000,000.
- `--seconds S` — wall-clock search limit, default 60.
- `--max-choices N` — maximum rotating-arrow choices within one slide, default 8.
- `--quiet` — hide per-depth progress; statistics and results still print.
- `--no-code` — omit the long embedded K3 output.

Outcomes/exit codes:

- **OPTIMAL** (exit 0): shortest accepted solution, proved by exhaustive depth-layer exploration. The K3 output includes the solution.
- **UNSOLVABLE** (exit 3): entire reachable-state search exhausted without an accepted completion.
- **INCONCLUSIVE** (exit 2): time, state, or rotating-arrow choice budget was exceeded; no optimality claim.
- **SOLUTION FOUND (optimality not certified)** (exit 2): solution verified, but incomplete layers prevent an optimality guarantee.
- Invalid input or unsupported forced algorithm: exit 1.

## Algorithms

### Forward breadth-first search

All game features use the same transition semantics as `engine.js`: all four ball directions; fixed and rotating arrows; colored/universal teleports; consumable hexes and score; toggle switches/walls/teleports; permanent goal locking. A branch encountering a rotating arrow is expanded over all four chosen directions, up to the specified per-slide choice limit. A reached goal is accepted only with **score >= 1**.

States are quotiented by permutations of same-colored balls; route reconstruction assigns them back to the original G1/G2/... IDs. The state key contains all mutable gate, switch, teleport and consumed-hex flags. Hexagon boards also incorporate slide depth, because different path lengths can lead to the same geometry but different final scores. This makes score correctness exact, although it can drastically increase the state count.

### Switch-aware bidirectional breadth-first search (v0.2)

The reverse search enumerates **genuine predecessor transitions** for static walls, fixed arrows, teleports, and now **switches controlling gates and teleports**, including the game's blocked-closing rule. As before, a backward edge is accepted only if the corresponding forward slide reproduces its successor state; the final reported path is also independently replayed from the original initial board.

The starting reverse frontier includes **all possible terminal gate configurations**, using one bit per gate *group*, not one bit per individual wall. This works because all gates in a group always flip together. Controlled teleports are similarly enumerated, while uncontrolled teleports retain their initial state. States differing only in the switch's visual on/off indicator are safely merged: the indicator never affects slide legality or switch behavior, only the actual gate/teleport flags do.

- Equal numbers of goals and balls are required for bidirectional mode.
- **Switches are supported**, including simultaneous toggling of multiple gates and dynamic teleports.
- **Consumable hexagons and rotating arrows** still use forward search. Fixed arrows, active and inactive teleports are supported.
- If enumerating terminal configurations exceeds a conservative limit (16 bits or one quarter of the state budget), auto mode falls back to forward BFS.
- A reverse layer cut short by the time/state budget is discarded, and the solver issues an optimality certificate only after complete reverse and forward search layers cover all shorter candidate paths.

Benchmark (single run in this environment; timings are not portable):

| Board | Algorithm | States | Result | Time |
|---|---|---:|---|---:|
| 6.6 | Switch-aware bidirectional | 30,078 | Optimal 18 | 0.28s |
| 7.4 | Switch-aware bidirectional | 261,652 | Optimal 27 | 1.63s |
| 7.4 | Forward BFS | 1,500,000 | Inconclusive | 9.86s |
| 8.1 | Bidirectional | 730,064 | Optimal 18 | 9.66s |

This is an **exact**, not heuristic, algorithm when it terminates successfully. Reaching resource limits remains inconclusive. Runtime and state count need not always improve relative to forward BFS; on easy switch boards, bidirectional reverse enumeration can have extra overhead.

## Tests

Node.js (optional, for independent cross-validation) is needed only for tests; the C++ solver itself has no Node dependency:

```sh
node tests/verify.js
node tests/random-compare.js and random-switch.js
```

`tests/verify.js` runs several real catalog levels and simple feature fixtures, decodes the native solver's exported K3 codes with the app's JavaScript codec, and replays every solution using the *original* JS `engine.js`.

`tests/random-compare.js and random-switch.js` generates 50 small random static boards (including identical-color balls, walls, fixed arrows and colored/universal teleports) and compares C++ forward BFS against C++ bidirectional BFS on every board.

Tested on the following supplied catalog levels (times vary by machine):

| Level | Optimal slides | Algorithm | Typical environment time |
|---|---:|---|---:|
| 6.6 | 18 | Forward BFS | < 1 s |
| 7.1 | 15 | Bidirectional BFS | ~ 5 s |
| 7.6 | 20 | Bidirectional BFS | < 1 s |
| 7.10 | 27 | Bidirectional BFS | < 1 s |
| 8.1 | 18 | Bidirectional BFS | ~ 10 s |

Levels 7.3 and 7.4 remain **inconclusive** at a 1.5-million-state limit. These are not failures of correctness; their dynamic mechanics lead to a much larger search space. Their optimization has not been certified by this program yet.

## WebAssembly direction

The C++17 search/state model deliberately has no external libraries. It can be compiled by Emscripten, but a practical browser integration still needs a worker-based API for run/cancel/progress/result, bounded memory handling, and an app-side interface. The native executable is the baseline for testing that future compilation.

## Known limits

- The app's K2 and K3 **board codes** are supported. Legacy K1 and arbitrary JSON board files are not directly accepted; import/export JSON through Replay Lab first.
- If the rotating-arrow choice limit is encountered, the search does **not** claim unconditional optimality or unsolvability.
- Memory usage is dominated by the graph of visited states. `--max-states` is a count, **not** a strict memory budget.
- Searches with hexagon score constraints can require revisiting geometric configurations at different depths, leading to much larger search spaces.
- Only single-threaded CPU search is currently implemented. No WASM binary or randomizer is bundled.

### Switch regression suite

Run `node tests/random-switch.js` to compare exact forward BFS and switch-aware bidirectional search on 100 generated 4-by-3 boards (including shared gate groups, mixed initial gate states, blocked closures, and some switch-controlled teleports). The seeded test currently passes all 100. Run `node tests/verify.js` to verify solutions and K3 payloads against the independently maintained JavaScript game engine.

### Existing solutions as test inputs

Solutions supplied by a user are useful as **upper bounds** for branch-and-bound/heuristic search, and especially as 300 realistic regression fixtures to test move generation, switches, and output validity. A plain forward BFS already explores by increasing depth, so an incumbent doesn't automatically speed it up, but it can constrain depth in A*/IDA* or meet-in-the-middle variants. This release does **not yet** accept a supplied incumbent solution as a CLI option.
