# Kunundrum — Game Rules and Notation

**Baseline:** 2026-11-11. **Authority:** `engine.js` (`Core`) used directly (single copy in the repo root) by the Replay Lab, the solver tests and `parser/encode_k3.js`. This file documents the **implemented simulator**, not inferred rules of an external game. If observations disagree, record a fixture and investigate before changing mechanics.

## 1. Board, coordinates, and objects

- The board is a rectangular grid. Game coordinates are **1-based Cartesian** `(x, y)`: `(1, 1)` is bottom-left; `x` increases rightward and `y` increases upward. Screenshot row indices are top-down and are converted by `y = boardHeight - screenshotRow` for zero-based rows.
- **Lexicographic order.** Cells are ordered `(1,1) < (2,1) < ... < (n,1) < (1,2) < ...`: left to right (`x` ascending), then bottom to top (`y` ascending). This is the one order used for every labelling and numbering in the project (auto-assigned ids, ternary arrow-type strings, tie-breaks, binary cell offsets); "reading order" (top to bottom) is not used.
- Board JSON has `version: 1`, `id`, `title`, `width`, `height`, and optional `description` and `solution`. Supported feature arrays are `walls`, `balls`, `goals`, `arrows`, `gates`, `switches`, `teleports`, and `hexes`; missing arrays default to empty.
- Ball/goal colors are `R` (red), `G` (green), `B` (blue), and `Y` (yellow). Each ball needs a goal of its own color; extra goals are allowed. A goal is not an obstacle and may be crossed by another ball; only the **stopping** cell can lock a ball.
- A floor cell may carry **at most one** of: permanent wall, goal, arrow, gate, switch, teleport endpoint, or hexagon. A ball may coexist with a floor feature, subject to the initial-wall restrictions. Distinct balls cannot share a cell.
- `walls` are permanently impassable. An **active** gate is impassable; an inactive gate is traversable floor. Cells outside the rectangle are impassable. Other balls, including locked balls, are obstacles.

## 2. One move

A move selects one **unlocked** ball and one direction: `u`, `d`, `l`, or `r`. The ball advances one cell at a time, automatically continuing until the next step would leave the board, hit a permanent wall, hit an active gate, or hit any other ball.

Rules are applied in this order on **each newly entered cell**:

1. Mark the cell as entered, and add it to the move path.
2. If it contains an unconsumed score hexagon, collect its signed value once for the entire run.
3. If it contains a fixed arrow, change the move heading to the arrow direction. If it contains a rotating arrow, use the next explicit player-selected heading.
4. If it contains a **currently active, compatible** teleport, attempt its instantaneous jump to the paired endpoint. The teleport is compatible if its color matches the ball or is `*` (universal). If its exit is occupied by another ball, the sliding ball **stops at the entrance**. Otherwise append the exit to the path and resume sliding from that exit in the current heading.

**Important:** A teleport exit does not immediately trigger that exit cell's other features: processing resumes with the next step. The heading chosen at an arrow is retained across a teleport. An inactive or color-incompatible teleport behaves like ordinary traversable floor.

A move must enter at least one new cell. A blocked first step is a no-op, not a move. A repeated `(position, heading, number-of-rotating-choices-used)` configuration or a move exceeding 65,536 simulation iterations is rejected as a loop; the original state is unchanged. An incomplete rotating-arrow decision returns a `choose-direction` result rather than committing a partial move. Extra unused choices are invalid.

## 3. Goals, locking, switches, and score

After a legal move finishes at its **final** cell:

- If that cell is a goal matching the moving ball's color, the ball is **permanently locked/docked**; it cannot be selected again. Balls initially occupying their matching goals start locked.
- If that cell contains a switch, the switch fires **once at the end of the move**, not merely when crossed. Its visual `on` flag toggles; the flag is not itself used to determine move legality.
- The switch tries to toggle every gate belonging to each group named in its `wallGroups`, and every teleport named in `teleportIds`. A group may contain several gates, and its members may have different initial active states.
- **Blocked closing rule:** for a particular gate group, if any currently inactive gate in that group would become active under a ball, **none of that group's gates change** on this activation. Other groups and controlled teleports still toggle. The switch visual indicator still changes.
- A move changes the score by `1 + sum(values of hexes first consumed during that move)`. Each hex may contribute its signed value (`-10000` through `10000`, excluding zero) **at most once per run**, even if traversed repeatedly. Score starts at `0`; moves start at `0`.

`Core.isComplete(state)` means every ball is locked. **Acceptance** (`Core.isAccepted(state)`) additionally requires `score >= 1`. A fully docked board with score `0` or less is **not accepted**. **Objective:** each puzzle is solved for the **lowest possible score**: the number of moves plus the one-time hex bonuses and penalties collected along the route (lower is better, so a negative hex is a bonus and a positive hex a penalty). The solver minimizes the score, and among equal scores the number of moves. On boards without hexes the score equals the move count.

## 4. Ball identifiers and ordering

`Core.validateBoard` sorts balls by color in **R, G, B, Y order**, then by ascending `y`, then ascending `x` within each color. A unique ball of a color has ID `R`, `G`, etc.; multiple same-colored balls have `R1`, `R2`, etc., in that fixed initial order. IDs do **not** renumber when balls move or lock.

`Core.resolveBallId` accepts:

- Exact IDs such as `G3`, or a color abbreviation such as `G` **only when exactly one unlocked ball of that color remains**.
- `R1` as an alias for the single red ball `R` (and analogously for other colors).
- An unprefixed ordinal such as `3` **only when exactly one unlocked ball's fixed numbered ID ends in `3`**. It is *not* a global ball index, and single-letter IDs have no such ordinal.

The serializer's zero-based binary **ball index** is a different concept: it uses the complete validated board's stable color/position ordering, including locked balls.

## 5. Solution notation

A solution is a comma-separated sequence of **ball groups**. A group starts with a ball identifier followed by one or more direction letters; consecutive moves of the same ball can be concatenated. Spaces/newlines are ignored by the parser.

```text
Rur,G3ld,Bu
G2l,G3d,G1r,G3ru,G5d,G4l,G5ur,G3l,G6dl,G2u,G3rdld,G1l
Rr(->u),Gd
```

The second example is the bundled 18-move route for level 8.1. Each `u/d/l/r` is **one whole move**, not a single-cell step. For a rotating arrow encountered during a move, immediately follow that move's initial direction with one `(->u)`, `(->d)`, `(->l)`, or `(->r)` **per rotating-arrow encounter in traversal order** (Unicode `→` is accepted in place of `->`). For example `Rr(->u)` means move red right and choose up at the encountered rotating arrow. No comma separates an arrow choice from its move.

Text parsing checks syntax and identifiers; applying the moves against successive states checks their legality. `Core.formatSolution` coalesces adjacent moves of the same ball into one group. A saved `solution` field need not be winning merely because its notation parses: validate by replaying it and checking `Core.isAccepted`.

## 6. Canonical board JSON example

```json
{
  "version": 1,
  "id": "example",
  "title": "Example",
  "width": 4,
  "height": 2,
  "walls": [],
  "balls": [{"color": "R", "x": 1, "y": 1}],
  "goals": [{"color": "R", "x": 4, "y": 1}],
  "arrows": [],
  "gates": [{"id": "W1", "group": "doors", "x": 3, "y": 2, "active": true}],
  "switches": [{"id": "S1", "x": 2, "y": 2, "wallGroups": ["doors"], "teleportIds": []}],
  "teleports": [],
  "hexes": []
}
```

Additional feature shapes:

```json
{"x": 2, "y": 1, "direction": "u", "rotating": true}
{"id": "T1", "color": "*", "active": true, "ends": [{"x": 1, "y": 2}, {"x": 4, "y": 2}]}
{"id": "H1", "x": 3, "y": 1, "value": -5}
```

The three snippets above illustrate arrow, teleport and hexagon entries respectively; insert them into the appropriate arrays, **not all on top of existing features**. Validation limits include 1–32 cells per dimension, 1–128 balls, up to 4,096 entries per feature array, and valid references from switches to gate groups and teleport IDs. Duplicate feature IDs, overlapping floor features, insufficient goals by color, and initial balls inside fixed/active walls are rejected.

## 6a. How features look in the game (for screenshot parsing)

- **Arrows:** red chevrons are **rotating** arrows (the player picks the exit); blue chevrons are **fixed** arrows. There are no green arrows. Chevron colours do not follow the level theme.
- **Switchable elements** (gates and some teleports) are drawn on a metal tile split into quadrants by a dark central cross. Every switchable element is controlled by exactly one switch, and every switch controls at least one element, so a board with a single switch is unambiguous.
- **Gates:** plain grey metal = **inactive** (floor); metal with a yellow/brown striped border = **active** (acts as a wall).
- **Teleports:** four coloured corner arcs, a bright centre dot and dim concentric circles. Drawn on bare floor = always on (not switchable); drawn over the metal cross tile = switchable. An **inactive** teleport loses its colour (grey concentric circles on the metal tile).
- **Switches:** solid glossy disc; red = off, green with a depressed shadow = on (display state only, see 3).

## 6b. Observed mechanics not yet implemented in `engine.js`

Recorded from game screenshots (e.g. level 12.6); the simulator above does **not** implement these yet.

- **Wraparound walls.** White triangles marking a gap in the board outline (on an outer edge or an outline segment) are a wraparound. They behave essentially like universal teleporters: they come in **bidirectional fixed pairs**, and a ball entering one emerges from its partner. Unlike teleporters, the **heading can change**: e.g. a ball moving left into a wraparound may come out of the paired exit moving down (the exit's outward direction). Each marker's triangles indicate the side it opens on.
- **Rotating arrows.** All red (rotating) arrows rotate **in sync** on one shared phase clock. Each rotating arrow has one of three types: **clockwise** (period 4), **counterclockwise** (period 4), or **flipping** between two opposite directions (period 2). A screenshot captures every arrow at one instant of the clock, so a board's rotating arrows are fully described by their displayed directions plus a ternary string giving each arrow's type (in lexicographic order). **Confirmed rule (2026-11-13):** orientations are frozen for the duration of one ball move. By waiting (letting the shared clock advance) before the move, the player can pick the orientation of the **first** rotating arrow the ball reaches; every later rotating arrow in the same move then shows whatever that same clock phase gives it and cannot be chosen independently. The current engine and solver differ: their "rotating" arrow lets the player pick an exit independently at **every** rotating arrow of a move (one `(->x)` per encounter). That is a looser model, so solutions and certified move counts for boards with rotating arrows describe the simplified model, not the game, until this is implemented.
  - *Still open:* whether waiting costs a move or score; whether the clock also advances after each move; which orientations the first arrow can show (a clockwise or counterclockwise arrow cycles through all four, a flipping arrow only its two opposite directions); and how the phase and arrow types are stored in boards, the solution notation and K3.

## 7. Invariants to preserve when editing mechanics

1. `Core.applyMove` is immutable: failed/incomplete moves do not modify the supplied state.
2. Initial IDs and geometry are deterministic and stable across JSON, K2/K3, replay, and the solver.
3. The switch's `on` indicator is **display state**, distinct from actual gate/teleport active flags.
4. Locked balls remain on the board and block movement; locking only occurs at the **end** of a move (or at initialization).
5. Teleport exits occupied by other balls block jumps, not entry; arrow, hex, teleport, then final switch/goal processing must keep the documented order.
6. Hexes are one-use, and accepted victory requires **all balls locked plus positive score**.
7. Any proposed difference between the external game's behavior and these rules requires explicit evidence, a regression fixture, and synchronized changes to `engine.js`, `solver.cpp`, and affected codecs/parsers.
