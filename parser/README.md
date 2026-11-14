# Kunundrum Screenshot Parser v0.7

Offline Python/OpenCV screenshot-to-K3 converter. **Node.js is not required.**

## Installation

Debian/Ubuntu (avoids the “externally managed environment” pip error):

    sudo apt install python3-numpy python3-opencv

Or, inside a Python virtual environment:

    pip install -r requirements.txt

## Use

    python3 parse.py Screenshots/ -o parsed/
    python3 parse.py 8-2.jpg 8-5.jpg -o parsed/

For each screenshot, writes:

- `NAME.json` — editable board description
- `NAME_review.png` — original with classification overlays
- `NAME_diagnostics.json` — detected grid, warnings, per-cell measurements
- `NAME.k3.txt` — generated *only* when no warnings remain

The command's batch summary separates **recognition warnings** (incorrect or
ambiguous visual objects) from **mechanics pending** (e.g. switch mapping and
hexagon value not determined by a static screenshot). The final exit status is
nonzero if *either* kind of warning remains; this is intentional for automation.

If grid detection is wrong, supply a geometry manually:

    python3 parse.py 8-2.jpg --grid 280,113,80,10,7 -o parsed/

Format is `LEFT,TOP,CELL,COLS,ROWS`, in screenshot pixels; left/top are the
inside top-left of the grid, rows are counted top-to-bottom in the image (this is only the input geometry; output labelling is lexicographic, see below).
Board JSON coordinates are (x,y), counted from the **bottom-left**.

## Overrides

Use an optional `fixes.json` to resolve ambiguities. In batch mode, the outer
keys are screenshot basenames *without extension*, for example `8-5`.

    {
      "9-8": {
        "cells": {"5,5": "hex_10", "2,4": "hex_-20", "6,3": "hex_-5"},
        "switches": {
          "S1": {"wallGroups": ["W1"], "teleportIds": []},
          "S2": {"wallGroups": ["W2"], "teleportIds": []}
        }
      }
    }

    python3 parse.py Screenshots/ -o parsed/ --overrides fixes.json

**Switch mappings above are placeholders, not a known mapping.** For example,
9.8 has four switches; all four must be supplied to clear its mapping warnings.
`W1`, etc. are the automatically assigned gate IDs (visible in JSON). For
multi-gate groups use `gateGroups` and set each switch's `wallGroups` to the
chosen group identifiers. A board with exactly one switch is assigned all
switchable elements (gates and teleports) automatically and needs no mapping.

Hexagon values are not visible in a screenshot, so the parser guesses them by
sprite colour (green = -5, red = +5) and reports each guess as a pending
mechanics warning; override with `hex_<value>` cells as above.

For a single screenshot, `fixes.json` can be an un-nested object with `cells`
and `switches`. Other accepted labels include `outside`, `floor`, `wall`,
`arrow_u`, `arrow_d`, `arrow_l`, `arrow_r`, `goal_G`, `ball_R`,
`teleport_B`, `gate_W1_on`, `gate_W1_off`, `switch_S1`, and
`ball_G+goal_R` (ball occupying a differently colored goal).

## K3 encoding without Node.js

The new `encode_k3.py` implements the K3 binary board serializer in Python:

    python3 encode_k3.py parsed/8-2.json

`parse.py` invokes it automatically after all warnings have been cleared. The
Python serializer has been compared byte-for-byte with Replay Lab's official
JavaScript K3 encoder, including a board with an embedded solution. Unlike the
app's JavaScript encoder, the Python serializer **does not simulate a saved
solution**: replay/check it in Replay Lab before relying on it.

`encode_k3.js` loads the repository's shared `engine.js` and `codec.js` (repo root) for optional independent
cross-checking; it is not part of the required execution path.

## Improvements since v0.2

- Grid detection now considers *all* cyan-outline components, fixing boards
  with separate regions; recognizes 80, 90, and 99/100 pixel cells in tests.
- Differentiates cyan arrow chevrons from cyan balls using shape and a bundled
  reference library for all four directions.
- Recognizes a ball already occupying a goal of a different color.
- Better distinguishes cyan-outlined holes from ordinary floor.
- Separates visually ambiguous cells from screenshot-underdetermined mechanics.
- Emits K3 directly in Python without requiring `node` or `nodejs`.

## Regression testing

Tested on thirteen screenshots: 6.8, 7.7, 7.9, 8.1, 8.2, 8.3, 8.5, 8.7,
8.8, 8.9, 8.10, 9.1, and 9.8. In this set, **all thirteen** yielded the
expected grid dimensions, ball/goal counts, and zero visual-recognition
warnings. Eight retained warnings for missing switch mapping / hexagon values.
This is not a guarantee of 100% correctness on unseen screenshots; always
inspect the annotated review images, particularly for partially covered cells,
new sprites, and nonstandard scaling.

## Changes in v0.7

- Plain grey metal = inactive gate (`gate_inactive`); metal with a yellow/brown striped frame = active gate (`gate_detected`). Inactive teleports (grey concentric circles on metal) are `teleport_*_inactive`: colour is unknown, so `*` is guessed.
- Red chevrons are detected as rotating arrows (direction not determined; blue fixed arrows as before).
- Floor vs exterior now also uses outline topology (crossing a neon edge toggles inside/outside, enclosed holes stay outside), because dark themes have floors as black as the exterior.
- A K3 code is always written (unless `--no-code`). Switches without an override get a mapping guessed by proximity: each switchable element goes to the nearest switch (Manhattan distance, ties to the first switch in lexicographic order), then empty switches take the nearest element from a switch holding several. The guess is reported as a warning; `--overrides` still wins.
- Known gaps: a ball sitting on a goal of a similar hue (e.g. green ball on a cyan ring in 11.9) is misread; rotating-arrow direction; the white edge-exit markers in 12.6 are only treated as closed outline gaps; K3 of a board the engine rejects (e.g. missing goals) is written but will not open in the app.

## Changes in v0.6

- Switchable elements are recognised: a metal tile split into quadrants by a dark
  cross is switchable. Plain = gate; with the teleport sprite on top = switchable
  teleport (labels `teleport_R_switchable`, ...). Always-on teleports (four corner
  arcs, bright centre dot, dim concentric circles, no metal) stay unswitchable.
- Teleports are detected by that sprite (also white/any-colour `teleport_*`).
  Switchable teleports get `"switchable": true` in the JSON (ignored by the engine).
- Switches are solid discs: green with a depressed shadow = on (`switch_on`, JSON
  `"on": true`), red = off.
- A lone switch controls all gates and all *switchable* teleports, never always-on ones.
  Switchable elements with no switch produce a warning.
- Board outline/grid detection works for any level theme (red, green, ...), not only cyan.
- Known gap: arrows in non-blue themes (red/green chevrons) are not recognised yet
  and are misread as balls. Gate/teleport on/off (inactive) appearance is untested.

## Changes in v0.8

- All automatic labelling uses **lexicographic order**: `(1,1) < (2,1) < ... < (n,1) < (1,2) < ...`, i.e. left to right, then bottom to top (previously screenshot reading order, top to bottom). This affects the generated `W`/`S`/`H` ids, the tie-break in the switch-mapping guess, and the order of warnings and `cells` in diagnostics.

## Changes in v0.5

- A board with exactly one switch assigns all gates and teleports to it; no mapping warning.
- Version is `PARSER_VERSION` in `parse.py` (`parse.py --version`), independent of the web app.

## Changes in v0.4

- Recognizes arrows even when the three chevrons are dim in the animation cycle.
  Recognition uses normalized blue-channel *shape* rather than a fixed brightness
  threshold. Bundled `arrow_shapes/` contains tiny direction templates calibrated
  to 72- and 90-pixel cells. Do not remove that directory.
- Fixes the large-grid alias for screenshots 9.9 (10 x 8) and 9.10 (12 x 8):
  both use 72-pixel cells, rather than the incorrect 143-pixel geometry.
- Tested against 20 provided screenshots, with no visual recognition warnings.
  Mechanics warnings for switch mappings and hexagon values remain intentionally.

The geometry calibration assumes full-size 1440 x 720 phone screenshots, as
provided. Use `--grid` for different resolutions if automatic detection fails.
As with earlier versions, a clean warnings count is **not** proof that every
object has been transcribed correctly; inspect the review PNGs before batch use.

## Changes in v0.9

- Grid detection now accepts cell sizes up to 180px (was 110px). Full-resolution 1440x720 screenshots have 120px cells, which were previously mis-detected as a half-size grid (e.g. 3.4 read as 14x8 instead of 7x4, 1.1 as 6x8 instead of 3x4).
