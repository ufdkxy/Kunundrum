#!/usr/bin/env python3
"""Compare parser.js's re-implemented OpenCV primitives with OpenCV on a random image.
Needs node, numpy, opencv. Usage: python3 test_primitives.py"""
import base64, json, subprocess, tempfile
from pathlib import Path
import cv2, numpy as np
import parse

here = Path(__file__).resolve().parent
rng = np.random.default_rng(1)
img = rng.integers(0, 256, (90, 120, 3), dtype=np.uint8)
img[:, :60] = (img[:, :60] // 3 + 80)  # some smoother, low-saturation content too
with tempfile.NamedTemporaryFile(suffix='.raw') as f:
    f.write(img.tobytes()); f.flush()
    out = json.loads(subprocess.check_output(['node', str(here / 'parse_raw.js'), '--prims', f.name, '120', '90']))
dec = lambda k, dt, shape: np.frombuffer(base64.b64decode(out[k]), dt).reshape(shape)
h, w = img.shape[:2]
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
blue = img[:, :, 0].astype(np.float32)
geom = parse.Geometry(7.3, 5.9, 37.7, 3, 2, 0)
checks = {
  'hsv':    (dec('hsv', np.uint8, (h, w, 3)), cv2.cvtColor(img, cv2.COLOR_BGR2HSV)),
  'gray':   (dec('gray', np.uint8, (h, w)), gray),
  'shrink': (dec('shrink', np.uint8, (h // 2, w // 2, 3)), cv2.resize(img, (w // 2, h // 2), interpolation=cv2.INTER_AREA)),
  'warp':   (dec('warp', np.uint8, (96, 96, 3)), parse.crop_cell(img, geom, 1, 1)),
  'blur3':  (dec('blur3', np.float32, (h, w)), cv2.GaussianBlur(blue, (3, 3), 1)),
  'blur5':  (dec('blur5', np.uint8, (h, w)), cv2.GaussianBlur(gray, (5, 5), 1)),
}
for name, (js, ref) in checks.items():
    d = np.abs(js.astype(np.float64) - ref.astype(np.float64))
    print(f'{name:7s} max|diff|={d.max():.4g}  mean={d.mean():.4g}  exact={100 * (d == 0).mean():.1f}%')
