#!/usr/bin/env python3
"""Run parse.py and parser.js on the same screenshots and report every difference.

    python3 compare_js.py Screenshots/            # a folder, or individual images
    python3 compare_js.py 9-9.jpg --grid 280,113,80,10,7

Reports per image: grid geometry, cells whose label differs (with both labels and the
confidence/measurement deltas), board JSON equality and warning equality. Exit status is
nonzero if any image differs in labels or board. Needs node, numpy and opencv."""
import argparse, json, re, subprocess, sys, tempfile
from pathlib import Path
import cv2
import parse

here = Path(__file__).resolve().parent

def level_of(stem):
    m = re.search(r'(?<![0-9])([0-9]+)[.-]([0-9]+)(?![0-9])', stem)
    return (m.group(1) + '.' + m.group(2)) if m else stem.replace('-', '.')

def compare(path, grid):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        geom, board, warnings, _ = parse.parse_one(path, tmp, grid, [], {}, False)
        diag = json.loads((tmp / (path.stem + '_diagnostics.json')).read_text())
        im = cv2.imread(str(path)); h, w = im.shape[:2]
        raw = tmp / 'image.raw'; raw.write_bytes(im.tobytes())
        cmd = ['node', str(here / 'parse_raw.js'), str(raw), str(w), str(h), level_of(path.stem)] + ([grid] if grid else [])
        js = json.loads(subprocess.check_output(cmd))
    bad = False
    g = js['geometry']
    print(f'{path.name}: py grid {geom.left:g},{geom.top:g},{geom.cell:g},{geom.width}x{geom.height}  js grid {g["left"]:g},{g["top"]:g},{g["cell"]:g},{g["width"]}x{g["height"]}')
    if (geom.left, geom.top, geom.cell, geom.width, geom.height) != (g['left'], g['top'], g['cell'], g['width'], g['height']):
        print('  ! GEOMETRY DIFFERS'); bad = True
    py = {(c['x'], c['y']): c for c in diag['cells']}
    for c in js['stats']:
        p = py.get((c['x'], c['y']))
        if p is None: print(f'  ! cell ({c["x"]},{c["y"]}) missing in python'); bad = True; continue
        dm = max((abs(c['measurements'][k] - v) for k, v in p['measurements'].items() if isinstance(v, (int, float))), default=0)
        if c['kind'] != p['kind']:
            print(f'  ! cell ({c["x"]},{c["y"]}): py {p["kind"]} ({p["confidence"]}) vs js {c["kind"]} ({c["confidence"]}); max measurement delta {dm:.3f}'); bad = True
        elif dm > 0.02 or abs(c['confidence'] - p['confidence']) > 0.01:
            print(f'    ~ cell ({c["x"]},{c["y"]}) {c["kind"]}: confidence {p["confidence"]} vs {c["confidence"]}, max measurement delta {dm:.3f}')
    if js['board'] != board: print('  ! BOARD JSON DIFFERS'); bad = True
    if js['warnings'] != warnings: print('  ! warnings differ:\n    py: %s\n    js: %s' % (warnings, js['warnings']))
    if not bad: print('  identical labels and board')
    return bad

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('images', nargs='+', type=Path); ap.add_argument('--grid')
a = ap.parse_args()
paths = [q for p in a.images for q in (sorted(x for x in p.iterdir() if x.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp')) if p.is_dir() else [p])]
sys.exit(1 if any([compare(p, a.grid) for p in paths]) else 0)
