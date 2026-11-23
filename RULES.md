# Kunundrum — Game Rules and Notation

**Baseline:** 2026-11-11. **Authority:** `engine.js` (`Core`) used directly (single copy in the repo root) by the Replay Lab, the solver tests and `parser/encode_k3.js`. This file documents the **implemented simulator**, not inferred rules of an external game. If observations disagree, record a fixture and investigate before changing mechanics.

## 1. Board, coordinates, and objects

- The board is a rectangular grid. Game coordinates are **1-based Cartesian** `(x, y)`: `(1, 1)` is bottom-left; `x` increases rightward and `y` increases upward. Screenshot row indices are top-down and are converted by `y = boardHeight - screenshotRow` for zero-based rows.
- **Lexicographic order.** Cells are ordered `(1,1) < (2,1) < ... < (n,1) < (1,2) < ...`: left to right (`x` ascending), then bottom to top (`y` ascending). This is the one order used for every labelling and numbering in the project (auto-assigned ids, ternary arrow-type strings, tie-breaks, binary cell offsets); "reading order" (top to bottom) is not used.
- Board JSON has `version: 1`, `id`, `title`, `width`, `height`, and optional `description`, `wallColor` (`R` or `G`; cosmetic, blue when omitted) and `solution`. Supported feature arrays are `walls`, `balls`, `goals`, `arrows`, `gates`, `switches`, `teleports`, `tunnels`, and `hexes`; missing arrays default to empty.
- Ball/goal colors are `R` (red), `G` (green), `B` (blue), and `Y` (yellow). Each ball needs a goal of its own color; extra goals are allowed. A goal is not an obstacle and may be crossed by another ball; only the **stopping** cell can lock a ball.
- A floor cell may carry **at most one** of: permanent wall, goal, arrow, gate, switch, teleport endpoint, or hexagon. A ball may coexist with a floor feature, subject to the initial-wall restrictions. Distinct balls cannot share a cell.
- `walls` are permanently impassable. An **active** gate is impassable; an inactive gate is traversable floor. Cells outside the rectangle are impassable. Other balls, including locked balls, are obstacles.

## 2. One move

A move selects one **unlocked** ball and one direction: `u`, `d`, `l`, or `r`. The ball advances one cell at a time, automatically continuing until the next step would leave the board, hit a permanent wall, hit an active gate, or hit any other ball. A **tunnel opening** on the side being crossed replaces that step (see **Tunnels**).

Rules are applied in this order on **each newly entered cell**:

1. Mark the cell as entered, and add it to the move path.
2. If it contains an unconsumed score hexagon, collect its signed value once for the entire run.
3. If it contains a fixed arrow, change the move heading to the arrow direction. If it contains a rotating arrow, its orientation comes from the shared arrow clock, whose phase the player chose before the move (see **Rotating arrows** below); during the move every arrow is fixed.
4. If it contains a **currently active, compatible** teleport, attempt its instantaneous jump to the partner endpoint (see **Teleport pairing**). The teleport is compatible if its color matches the ball or is `*` (universal). If it has no partner for this ball, the partner is **switched off**, or the exit is occupied by another ball, the sliding ball **stops at the entrance**. Otherwise append the exit to the path and resume sliding from that exit in the current heading.

**Teleport pairing.** `teleports` holds single endpoints, each with its own cell, color (`R`, `G`, `B`, `Y` or `*`) and on/off state; pairs are not stored. The partner is derived from the colors alone: same-color endpoints pair up; two universals pair only with each other (independent of the colored pairs); a lone universal is a **hub** paired with the single endpoint of every other color, and a ball entering the hub exits at the endpoint of its own color (a ball with no such endpoint stops on the hub). Valid boards have at most 2 endpoints per color and at most 2 universals, every single colored endpoint needs exactly one universal, and a lone universal needs at least one single. A switch controls endpoints individually (e.g. one half of a pair), so a pair can have one half on and one off: a matching ball entering the on half **stops there**, and the off half is ordinary floor. Pressing the switch turns the off half on.

**Tunnels.** `tunnels` holds bidirectional, fixed pairs of **openings**. An opening is a cell plus a `side` (`u`, `d`, `l`, `r`): a gap in the outline on that side of the cell, either on the board edge or between a floor cell and a wall cell. `side` is the direction a ball must be heading to cross it. When the next step of a sliding ball would cross an opening, it does not hit the edge or wall: it enters the cell of the **partner** opening, and its heading becomes the opposite of the partner's `side` (it leaves inward, so the heading may change). The partner cell is an ordinary newly entered cell, so its hexagon, arrow and teleport are processed as usual (unlike a teleport exit). Passing through costs nothing beyond the move itself. If the partner cell holds another ball or an active gate, the ball **stops at the entrance** (a blocked first step is a no-op). Moving along a wall past an opening does nothing. Tunnels are never switchable. The pairing is stored, never derived (a screenshot does not show it; the parser only guesses, the editor corrects). Openings may not share a cell side, and an opening may not lie in a fixed wall cell. Tunnel loops are rejected by the existing loop rule. The path of a move records a tunnel step as a point with `tunnel: true`, `via` (side entered) and `out` (side left through).

**Important:** A teleport exit does not immediately trigger that exit cell's other features: processing resumes with the next step. The heading chosen at an arrow is retained across a teleport. An inactive or color-incompatible teleport behaves like ordinary traversable floor.

A move must enter at least one new cell. A blocked first step is a no-op, not a move. A repeated `(position, heading, number-of-rotating-orientations-used)` configuration or a move exceeding 65,536 simulation iterations is rejected as a loop; the original state is unchanged. An incomplete rotating-arrow decision returns a `choose-direction` result (with the valid orientations) rather than committing a partial move. Extra unused orientations are invalid.

**Rotating arrows.** All rotating (red) arrows turn in sync on one shared clock, one tick at a time. Each has a **type**: `cw` clockwise (a quarter turn per tick, period 4, the default), `ccw` counterclockwise (period 4), or `flip` (alternates between its direction and the opposite, period 2). The board stores every arrow's direction as displayed at clock phase 0 (the screenshot instant) and, for non-clockwise arrows, its `type`. Waiting is free and the clock is frozen while a ball moves (it resumes when the move ends), so the player simply picks the clock phase p (0–3) before each move; phase is not game state. Within a move, every rotating arrow shows its orientation for p, and an arrow met twice shows the same orientation both times. Rotating arrows on the cell where the ball starts, or where it stops, have no effect (only newly entered cells count, as for fixed arrows). The move therefore needs only the orientations that determine p: the **first** rotating arrow the ball reaches is chosen by the player (4 orientations for `cw`/`ccw`, its 2 opposite directions for `flip`); if that arrow is `flip`, it fixes only the parity of p, so the **first period-4 arrow reached after it** is chosen too (its 2 orientations compatible with that parity). If no period-4 arrow is reached, nothing more is needed. A letter that is impossible for the arrow is an error. Notation: see §5.

## 3. Goals, locking, switches, and score

After a legal move finishes at its **final** cell:

- If that cell is a goal matching the moving ball's color, the ball is **permanently locked/docked**; it cannot be selected again. Balls initially occupying their matching goals start locked.
- If that cell contains a switch, the switch fires **once at the end of the move**, not merely when crossed. Its visual `on` flag toggles; the flag is not itself used to determine move legality.
- A switch controls one list, `controls`, of gate and teleport IDs (gate IDs `G1`, …; teleport IDs `T1`, …; switch IDs `S1`, …). Switches with the same non-empty list are identical: pressing any of them toggles the whole set once, and they share one indicator, so the indicator is derived, not independent data (a set takes the `on` value of its lowest-numbered switch when input disagrees). Lists are expected to be identical or disjoint. Elements of one list may have different initial active states; they all flip together.
- **Blocked closing rule:** if any currently inactive gate in the switch's list would become active under a ball, the switch **cannot change state**: none of its gates or teleports toggle, and its visual `on` flag stays as it is.
- A move changes the score by `1 + sum(values of hexes first consumed during that move)`. Each hex may contribute its signed value (`-10000` through `10000`, excluding zero) **at most once per run**, even if traversed repeatedly. Score starts at `0`; moves start at `0`.

`Core.isComplete(state)` means every ball is locked, and the puzzle is solved exactly then. There is no score threshold: the score may be zero or negative. **Objective:** each puzzle is solved for the **lowest possible score**: the number of moves plus the one-time hex bonuses and penalties collected along the route (lower is better, so a negative hex is a bonus and a positive hex a penalty). The solver minimizes the score, and among equal scores the number of moves. On boards without hexes the score equals the move count.

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

The second example is the bundled 18-move route for level 8.1. Each `u/d/l/r` is **one whole move**, not a single-cell step. For a rotating arrow encountered during a move, immediately follow that move's initial direction with **one** annotation `(->x)`, where `x` is the orientation (`u`, `d`, `l`, or `r`) of the first rotating arrow met (Unicode `→` is accepted in place of `->`). If that arrow is a `flip` arrow and the path later reaches a period-4 arrow, add that arrow's orientation as a second letter: `(->xy)`, e.g. `Rr(->ur)` = move red right, the first (period-2) arrow points up, the first period-4 arrow points right, regardless of any further period-2 arrows in between. Two separate annotations on one move are invalid, and no comma separates the annotation from its move.

Text parsing checks syntax and identifiers; applying the moves against successive states checks their legality. `Core.formatSolution` coalesces adjacent moves of the same ball into one group. A saved `solution` field need not be winning merely because its notation parses: validate by replaying it and checking `Core.isComplete`.

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
  "gates": [{"id": "G1", "x": 3, "y": 2, "active": true}],
  "switches": [{"id": "S1", "x": 2, "y": 2, "controls": ["G1"]}],
  "teleports": [],
  "hexes": []
}
```

Additional feature shapes:

```json
{"x": 2, "y": 1, "direction": "u", "rotating": true, "type": "flip"}
{"id": "T1", "x": 1, "y": 2, "color": "*", "active": true}
{"id": "H1", "x": 3, "y": 1, "value": -5}
{"a": {"x": 1, "y": 3, "side": "l"}, "b": {"x": 8, "y": 3, "side": "r"}}
```

The four snippets above illustrate arrow (a rotating arrow may add `"type": "ccw"` or `"flip"`; clockwise is the default and is omitted), teleport, hexagon and tunnel (pair of openings) entries respectively; insert them into the appropriate arrays, **not all on top of existing features**. Validation limits include 1–32 cells per dimension, 1–128 balls, up to 4,096 entries per feature array, and valid references from switches to gate and teleport IDs (a gate and a teleport may not share an ID). Duplicate feature IDs, overlapping floor features, insufficient goals by color, and initial balls inside fixed/active walls are rejected.

## 6a. How features look in the game (for screenshot parsing)

- **Arrows:** red chevrons are **rotating** arrows (their type, clockwise / counterclockwise / flip, cannot be told from one screenshot, so the parser guesses clockwise and the type is supplied by hand); blue chevrons are **fixed** arrows. There are no green arrows. Chevron colours do not follow the level theme.
- **Switchable elements** (gates and some teleports) are drawn on a metal tile split into quadrants by a dark central cross. A board with a single switch is unambiguous: it controls every switchable element.
- **Gates:** plain grey metal = **inactive** (floor); metal with a yellow/brown striped border = **active** (acts as a wall).
- **Teleports:** four coloured corner arcs, a bright centre dot and dim concentric circles. Drawn on bare floor = always on (not switchable); drawn over the metal cross tile = switchable. An **inactive** teleport loses its colour (grey concentric circles on the metal tile).
- **Tunnels:** two small white triangles side by side along a gap in the neon outline (board edge or an outline segment), pointing in opposite directions (one out of the board, one into it). The pairing is not visible.
- **Switches:** solid glossy disc; red = off, green with a depressed shadow = on (display state only, see 3).

## 6b. Solver support

Tunnels and rotating arrows are implemented in `solver.cpp` (v0.17) with the semantics above: the solver tries every distinct arrow clock phase per move and prints the `(->xy)` annotation. The WebAssembly bundle used by the app (`kunsolve-bundle.js`) is the v0.17 build and includes them.

## 7. Invariants to preserve when editing mechanics

1. `Core.applyMove` is immutable: failed/incomplete moves do not modify the supplied state.
2. Initial IDs and geometry are deterministic and stable across JSON, K3, replay, and the solver.
3. The switch's `on` indicator is **display state**, distinct from actual gate/teleport active flags.
4. Locked balls remain on the board and block movement; locking only occurs at the **end** of a move (or at initialization).
5. Teleport exits occupied by other balls block jumps, not entry; arrow, hex, teleport, then final switch/goal processing must keep the documented order.
6. Hexes are one-use, and victory requires **all balls locked** (the score may be zero or negative).
7. Any proposed difference between the external game's behavior and these rules requires explicit evidence, a regression fixture, and synchronized changes to `engine.js`, `solver.cpp`, and affected codecs/parsers.
