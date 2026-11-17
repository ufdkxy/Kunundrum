#!/usr/bin/env node
/* Node driver for parser.js (used by compare_js.py / test_primitives.py).
 *   node parse_raw.js image.raw WIDTH HEIGHT [LEVEL] [LEFT,TOP,CELL,COLS,ROWS]   -> JSON result on stdout
 *   node parse_raw.js --prims image.raw WIDTH HEIGHT                              -> primitive outputs (base64)
 * image.raw is interleaved BGR bytes, exactly what cv2.imread returns. */
'use strict';
const fs = require('node:fs');
const P = require('./parser.js');
const args = process.argv.slice(2);
const prims = args[0] === '--prims';
if (prims) args.shift();
const [file, w, h, level, grid] = args;
if (!file || !w || !h) { console.error('Usage: node parse_raw.js [--prims] image.raw WIDTH HEIGHT [LEVEL] [GRID]'); process.exit(2); }
const img = { width: +w, height: +h, bgr: new Uint8Array(fs.readFileSync(file)) };
const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
if (prims) {
  const I = P._internals, n = img.width * img.height;
  const gray = I.bgr2gray(img.bgr), blue = Float32Array.from({ length: n }, (_, i) => img.bgr[i * 3]);
  const g = { left: 7.3, top: 5.9, cell: 37.7 };
  const patch = I.cropCell(img, g, 1, 1);
  console.log(JSON.stringify({
    hsv: b64(I.bgr2hsv(img.bgr)), gray: b64(gray), shrink: b64(I.shrink2(img.bgr, img.width, img.height, 3)),
    warp: b64(patch), blur3: b64(I.gaussianBlur(blue, img.width, img.height, 3, 1)),
    blur5: b64(Uint8Array.from(I.gaussianBlur(gray, img.width, img.height, 5, 1), v => Math.round(v))),
  }));
} else {
  const r = P.parseImage(img, { level: level || 'imported', grid: grid || undefined });
  console.log(JSON.stringify({ board: r.board, warnings: r.warnings, geometry: r.geometry, labels: r.labels, stats: r.stats }));
}
