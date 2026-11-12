# Kunundrum — Architecture, Data Interfaces, and Formats

**Baseline:** 2026-11-11, based on the three supplied archives:

| Archive | Component | Entry points |
| --- | --- | --- |
| `Kunundrum_v3.0.1_K3_complete.zip` | Browser Replay Lab, editor, catalog, K3 codec | `app.js`, `editor.js`, `engine.js`, `codec.js`, `catalog.js`, `levels.js`, `convert-levels.html` |
| `Kunundrum_screenshot_parser_0.4.zip` | Offline screenshot recognition and Python K3 writer | `parse.py`, `encode_k3.py` |
| `Kunundrum_CPP_Solver_0.2_switches.zip` | Native exact optimal solver | `solver.cpp`, `Makefile`, `tests/*.js` |

**Source-of-truth policy:** `engine.js` defines gameplay; `codec.js` defines the browser's K2/K3 implementation; `solver.cpp` independently implements transitions and binary I/O; `parse.py` supplies candidate board data requiring human review. The copies of `engine.js` and `codec.js` in **all three archives are byte-identical** at this baseline. Preserve their parity when updating them.

## 1. Overall data flow

```text
Screenshots --parse.py/OpenCV--> board JSON + review PNG + diagnostics
               |  human review / cell and mechanics overrides
               v
           encode_k3.py --> K3 board code --------------+
                                                        |
Existing JSON / K2 / K3 --> Codec.decodeBoard ----------+--> Core.validateBoard
                                                        |       |
                                                        |       +--> Browser game / editor / replay
                                                        |       |
                                                        +-------+--> C++ solver (K2/K3 input)
                                                                    |
                                                 verified optimal notation + embedded K3
                                                                    |
                                                  Codec.decodeBoard + Core.applyMove
```

No server or framework is required by the JavaScript sources. The native solver and Python screenshot parser are **separate command-line programs**, not browser integrations. There is presently no WebAssembly bridge, worker protocol, or browser solver UI.

## 2. Browser modules and responsibilities

| File | Responsibility | Important exposed interface |
| --- | --- | --- |
| `engine.js` | Board normalization, validation, immutable state and slide simulation, notation parsing | global `Core` |
| `codec.js` | K2/K3 board binary encoding/decoding; compact K3 routes; replay URLs | global `Codec` |
| `levels.js` | Editable newline catalog data, held as a template-string assignment | `window.KUNUNDRUM_LEVEL_CODES` |
| `catalog.js` | Parse and validate catalog entries and IDs | global `Collection.entries` |
| `app.js` | Render SVG board, play/move controls, replay history, import/export, URL and localStorage state | `window.KunundrumHost` for editor integration |
| `editor.js` | In-place board editing, object properties, drag/drop, undo/redo, validation, K3 export | `window.KunEditor` |
| `styles.css` | Browser presentation, responsive layout | CSS |
| `music.js` | Optional user-supplied, five-track music playback | DOM audio controls and `Music/*.mp3` |
| `convert-levels.html` | Standalone local K2/K3 catalog-to-K3 converter | file input + browser-generated `levels.js` download |
| `favicon.svg` | Icon | static asset |

Logical script dependencies: `engine.js` precedes `codec.js`; `levels.js` precedes `catalog.js`; `engine.js`/`codec.js`/`catalog.js` precede `app.js`; `app.js` creates `KunundrumHost` used by the editor. `music.js` is independent of the game mechanics. An actual page loading order **cannot be verified** because the supplied web ZIP omits `index.html`; restore the matching page rather than constructing unverified DOM markup from assumptions.

### Public engine API

```text
Core.validateBoard(raw) -> normalizedBoard
Core.createInitialState(board) -> State
Core.applyMove(state, board, ballId, direction, choices=[]) -> MoveResult
Core.isComplete(state) -> boolean
Core.isAccepted(state) -> boolean
Core.parseSolution(text) -> tokens
Core.resolveBallId(state, identifier) -> stableBallId
Core.formatMove(record) -> string
Core.formatSolution(records) -> string
```

`applyMove` returns `{kind:'ok', state, path, record, events}` on success; `{kind:'choose-direction',position,choicesUsed,path,message}` for a missing rotating-arrow choice; or `{kind:'blocked'|'loop'|'error',message,path?}` for failure. The input board/state are not mutated. See [RULES.md](RULES.md) for transition details.

### State and replay model

```js
{
  balls: [{ id, color, x, y, locked }, ...],
  gateActive: { [gateId]: boolean },
  teleportActive: { [teleportId]: boolean },
  switchOn: { [switchId]: boolean },
  consumedHexIds: [hexId, ...],
  slides: 0,
  score: 0
}
```

`app.js` holds replay **frames** (`{state,path,record,events}`) and a `cursor`; replay loading re-simulates the route from the initial state. Manual play, SVG animation, keyboard and pointer gestures, replay navigation, view settings, sharing and best-run recording live in the controller. Persistence uses localStorage keys `kunundrum.replay.v1` and `kunundrum.best.v1` when available. `window.KunundrumHost` exposes `getBoard()`, `svg(draft)`, `stop()`, and `play(draft)` for `editor.js`. `window.KunEditor` exposes `active`, `render`, and `open()`.

The editor works on an independent draft and validates it before switching back to Play or saving a code. Drawing, teleport-endpoint pairing, object properties, grid resizing, moving objects, and undo/redo are implemented. Editing a board feature clears the draft's saved solution.

## 3. Canonical board JSON and validation

The board object follows the schema illustrated in [RULES.md](RULES.md). All game components consume `Core.validateBoard` output when using the browser implementation. Normalization sorts feature lists; most arrays sort bottom-to-top then left-to-right, teleports sort by ID, balls sort **R/G/B/Y then y/x**, and each teleport's ends sort y/x. The validator also checks references, ID uniqueness, floor-feature overlap, and initial ball placement.

Coordinate and index conventions:

- JSON: `(x,y)` 1-based, origin **bottom-left**.
- Binary cell offset: `index = (y - 1) * width + (x - 1)` (zero-based).
- Screenshot parser: OpenCV uses row-down screen coordinates; output JSON uses bottom-left coordinates.
- K3 solution move index: `4 * zeroBasedValidatedBallIndex + directionIndex`, where direction indices are `u=0, d=1, l=2, r=3`.

**Do not infer switch mappings from visual proximity**. JSON explicitly supplies `wallGroups` (gate **group names**) and `teleportIds` (teleport **IDs**). The numeric/cardinal appearance of a switch is not the mapping. The screenshot parser can emit an unresolved mapping warning and an editable, not-yet-authoritative JSON board.

## 4. K2/K3 binary board format

Codes are `K2.` or `K3.` plus **unpadded base64url** (RFC-style `-` and `_` alphabet) of a binary stream. The browser **writes K3**, reads K2 and K3, and rejects K1. The parser's Python writer emits K3. The native solver reads K2/K3 and emits K3 with a solution.

At the stream level:

```text
byte: magic             0xB2 (K2) or 0xB3 (K3)
byte: width             1..32
byte: height            1..32
varuint: flags          bit 0 = description present, bit 1 = solution present
string: id
string: title
[string: description]
[solution: K2 string; K3 varuint byteLength + binary solution bytes]
list: walls              (position)
list: balls              (position, color)
list: goals              (position, color)
list: arrows             (position, directionIndex*2 + rotatingBit)
list: gates              (position, id, group, activeBool)
list: switches           (position, id, onBool, wallGroups[], teleportIds[])
list: teleports          (id, color, activeBool, endpointA, endpointB)
list: hexes              (position, id, zigzagSignedValue)
```

- `varuint` is unsigned **LEB128** (7 data bits per byte, continuation bit high).
- `list` is varuint count then its elements.
- `position` is the zero-based row-major offset above, stored as varuint.
- `color` is an integer index into `RGBY*` (`*` only for teleports).
- `string` values use a per-board dictionary: a new UTF-8 string is tagged with `2 * byteLength` and then raw bytes; a repeat is tagged `2 * dictionaryIndex + 1`. Dictionary order follows first occurrence in the binary stream.
- `activeBool`/`onBool` are varuint `0` or `1`. Hex signed values are mapped `v>=0 -> 2*v`, `v<0 -> -2*v-1`.
- The serialized lists and strings must be kept in the canonical order when seeking byte-for-byte interoperability.

### K3 embedded solution / compact route

```text
varuint: numberOfMoves (1..10000)
byte: choiceMode         0 = none, 1 = explicit rotating-arrow choices
bits: packed move codes (ceil(log2(4 * numberOfBalls)) per move)
[if choiceMode 1: varuint choiceCount for EACH move]
[if choiceMode 1: all packed choice directions, 2 bits each]
```

Both bitstreams are **MSB-first** within each byte; unused low padding bits must be zero. The mode-1 counts precede the single flattened choice bitstream. The decoder validates the reconstructed moves by **replaying them**, so invalid saved routes are rejected by JavaScript `Codec.decodeBoard`. Python `encode_k3.py` reproduces the layout but **does not** simulate or validate solutions.

Browser size limits: board code at most 32,768 characters, full URL at most 131,072, route/solution text at most 10,000 characters; the controller accepts at most **2,000 replay moves** even though the underlying K3 move stream supports up to 10,000.

### Replay URL conventions

- Preset board: `?level=8.1` (example; in URL query).
- Custom board: `#board=K3...` (in URL hash).
- Compact replay: `#route=BASE64URL` with optional `&at=moveIndex`; old `#moves=Rur,...` links remain readable.
- The URL parser also accepts supported parameters from query or hash, forbids duplicates, and rejects simultaneous board and level or simultaneous moves and route.

`Codec` exports `encodeBoard`, `decodeBoard`, `decodeRoute`, `readShareUrl`, and `makeShareUrl`. `makeShareUrl` creates a compact `route` when supplied `routeBoard` plus `moves`; otherwise it uses legacy `moves` text. See [STATUS.md](STATUS.md) for an import-path issue affecting pasted compact routes.

## 5. Screenshot recognition pipeline

`parse.py` requires Python, NumPy and OpenCV (`requirements.txt`). It:

1. Locates the cyan board outline and infers grid origin, cell size, width and height; `--grid LEFT,TOP,CELL,COLS,ROWS` overrides inference.
2. Crops normalized cells, measures brightness/color/symmetry and compares arrow shapes against **bundled `arrow_shapes/`** to handle dim phases of animated chevrons; optional image templates can refine other objects.
3. Maps screen rows to game coordinates; assembles board arrays, pairing same-color teleport ends only when there are exactly two.
4. Applies override labels and mechanical mappings; flags ambiguous recognition, unsigned/unknown hex values, incomplete teleport pairing, unknown switch mappings and ball/goal count mismatches.
5. Writes `NAME.json`, `NAME_review.png`, `NAME_diagnostics.json`, and **only if no warnings** `NAME.k3.txt` through `encode_k3.py`.

Example:

```sh
python3 parse.py Screenshots/ -o parsed/ --overrides fixes.json
python3 parse.py 9-9.jpg --grid LEFT,TOP,72,10,8 -o parsed/
python3 encode_k3.py parsed/8-2.json
```

Replace `LEFT` and `TOP` with measured pixel coordinates; the displayed 72-pixel cell size and 10×8 geometry come from the parser release notes for level 9.9 and were **not** independently verified here. For a batch, overrides are keyed by image **basename without extension**, with optional `cells` mapping such as `"5,5": "hex_10"`, plus `switches`, `gateGroups`, `teleports`, and `solution`. Cell labels include `arrow_u`, `arrow_d`, `arrow_l`, `arrow_r`, `arrow_rotating`, `gate_W1_on`, `gate_W1_off`, `switch_S1`, `ball_G+goal_R`, `outside`, `floor`, and `wall`.

**Limitations:** Static screenshots do not unambiguously reveal switch control mappings or signed hex values. The classifier produces directional arrows; rotating-arrow identity is available via manual override, not proven by automatic detection. Default inferred gates begin active, and a one-switch/all-gates/no-teleports board has a special automatic gate-mapping assumption that currently even overwrites a supplied switch mapping (see `PARSE-002`). Verify these against the actual level before accepting encoded data. Accuracy claims in the parser README concern historical sample screenshots not included in the archive; manually inspect review PNGs even when there are zero warnings.

The parser's generated K3 board is equivalent in layout to the JavaScript codec after normalization, but downstream use should still call `Core.validateBoard` and, for routes, run the actual simulator.

## 6. Native optimal solver

Build and run:

```sh
cd solver
make
./kunsolve --level 8.1
./kunsolve board-code.txt --algorithm forward --seconds 120 --max-states 3000000
./kunsolve 'K3....' --algorithm auto
```

The C++17 CLI is a separate process (`solver.cpp`) with no external runtime libraries. It accepts a literal code, a file containing a code, standard input (`-`), or a catalog ID (`--level`, optional `--catalog`). Common flags are `--algorithm auto|forward|bidirectional`, `--seconds` (default 60), `--max-states` (default 2,000,000), `--max-choices` (default 8), `--quiet`, and `--no-code`.

- **Forward BFS:** exact move-depth search, including rotating-arrow choice branching, one-use hex values, fixed arrows, gates/switches, compatible teleports and goal locking. With hexes, the state key also tracks depth so score remains determined by a given state.
- **Bidirectional BFS:** backward predecessor generation with **forward transition revalidation**. Supports fixed arrows, static/controlled teleports and switch-controlled gate groups with blocked closing. It **does not** support rotating arrows or hexes. It additionally needs equal numbers of balls and goals and an affordable enumeration of terminal gate-group/controlled-teleport masks. `auto` chooses bidirectional mode only when feasible **and there are at least three balls**; otherwise forward mode.
- Within a color, balls are interchangeable for search-state deduplication; solution reconstruction restores stable public ball IDs. Mutable gate, teleport and consumed-hex flags appear in search keys. The switch visual `on` flag does not determine transitions and is excluded from state deduplication.
- Search limits may make a result **INCONCLUSIVE** (exit 2). `OPTIMAL` (exit 0) means a verified accepted shortest path; `UNSOLVABLE` (exit 3) means exhaustive proof; invalid input / unsupported forced mode exits 1. A found but uncertified solution also exits 2.
- For any solution, the C++ program re-simulates the route and exports solution notation and an updated K3 code. The JavaScript regression suite independently decodes and replays the exported code.

`--max-states` caps stored search states, **not bytes or memory use**. Searches are currently single-threaded. No browser-facing WASM or worker interface exists yet.

## 7. Regression and compatibility contract

Native tests (`solver/tests/`):

```sh
make
node tests/verify.js
node tests/random-compare.js
node tests/random-switch.js
```

`verify.js` checks bundled catalog levels and small rotating-arrow/hex/switch fixtures by decoding the C++ output via JavaScript `Codec` and replaying it via JavaScript `Core`. The randomized suites compare C++ forward versus bidirectional outcomes (50 static cases and 100 switch cases; deterministic seeds).

For changes to game rules, binary layout, notation, parser, or solver:

1. Add a minimal reproducible board JSON and expected replay/state transition.
2. Validate using `Core.validateBoard` and `Core.applyMove` (gameplay oracle).
3. Check K2 import, K3 JS encode/decode, Python K3 interoperability, and route/link backward compatibility as applicable.
4. Compare solver results with JavaScript replay; require an optimality certificate before recording a move count as optimal.
5. Extend parser tests with representative **original screenshot + corrected JSON + review/diagnostics**, especially animated arrows, nonstandard grids, goals occupied by balls, switches and hexes.
6. Update [RULES.md](RULES.md), this document, and [STATUS.md](STATUS.md) at milestones; do not silently reinterpret mechanics or overwrite the full private catalog with the sample catalog.
