# Kunundrum Screenshot Parser v0.4

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
inside top-left of the grid, rows are counted top-to-bottom in the image.
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
