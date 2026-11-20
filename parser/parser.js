/* Kunundrum screenshot parser. THIS FILE IS THE DEFINITIVE PARSER (the web app uses it; parse.py is a frozen,
 * historical Python version that is no longer updated and may disagree with it: on any difference, parser.js wins).
 * Originally a dependency-free port of parse.py v0.10.0.
 *
 * Runs in the browser and in Node. The function names and measurement keys below still mirror parse.py's
 * where they existed, which helps when reading the history. Images are held as interleaved BGR bytes, like OpenCV, and the few OpenCV
 * primitives that parse.py uses (BGR->HSV/gray, INTER_AREA 2x shrink, bilinear
 * warpAffine, separable Gaussian) are re-implemented with
 * OpenCV's integer arithmetic where that matters for the tuned thresholds.
 *
 * Not ported: parse.py's frame_component / period_autocorrelation / detect_geometry
 * (unreachable: robust_geometry only calls detect_geometry for the --grid override,
 * which just builds a Geometry), the --templates folder loader, and file output.
 * `templates` may still be passed in options as [[name, Uint8Array(48*48*3)], ...].
 */
(function (root) {
'use strict';
const PARSER_VERSION = '0.13.7-js.1';
const COLORS = ['R', 'G', 'B', 'Y'];
const HEX_GUESS = { G: -5, R: 5 };
const SZ = 96, NPX = SZ * SZ;

/* ---------------------------------------------------------------- numeric helpers */

// Python's round(): halves go to the even neighbour (matters for odd cell sizes).
function pyRound(x) {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
const sum = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const mean = a => sum(a) / a.length;
const argmax = (a, from, to) => { let k = from; for (let i = from + 1; i < to; i++) if (a[i] > a[k]) k = i; return k; };
function percentile(values, q) {
  const s = Float64Array.from(values).sort();
  const pos = (s.length - 1) * q / 100, lo = Math.floor(pos), hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
// Mean of `values[i]` over indices where mask[i] is truthy (NaN when none, like numpy).
function maskMean(values, mask) {
  let s = 0, n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { s += values[i]; n++; }
  return s / n;
}
const maskCount = mask => { let n = 0; for (let i = 0; i < mask.length; i++) if (mask[i]) n++; return n; };
// Weighted vote over hue groups in Python dict order (first maximum wins, as max(..., key=get)).
function voteColor(groups) {
  let best = null;
  for (const k of ['R', 'Y', 'G', 'B']) if (best === null || groups[k] > groups[best]) best = k;
  return best;
}

/* Fixed per-patch geometry (96x96, centre 47.5). */
const RAD = new Float64Array(NPX), DX = new Float64Array(NPX), DY = new Float64Array(NPX);
for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) {
  const i = y * SZ + x;
  DX[i] = Math.abs(x - 47.5); DY[i] = Math.abs(y - 47.5);
  RAD[i] = Math.sqrt((x - 47.5) * (x - 47.5) + (y - 47.5) * (y - 47.5));
}
const mk = fn => { const m = new Uint8Array(NPX); for (let i = 0; i < NPX; i++) m[i] = fn(i) ? 1 : 0; return m; };

/* ---------------------------------------------------------------- OpenCV primitives */

const HDIV = new Int32Array(256), SDIV = new Int32Array(256);
for (let i = 1; i < 256; i++) { HDIV[i] = Math.round((30 << 12) / i); SDIV[i] = Math.round((255 << 12) / i); }

// cv2.cvtColor(BGR2HSV), 8-bit: H 0..179, S and V 0..255, OpenCV's fixed-point formulas.
function bgr2hsv(bgr) {
  const n = bgr.length / 3, out = new Uint8Array(bgr.length);
  for (let p = 0, o = 0; p < n; p++, o += 3) {
    const b = bgr[o], g = bgr[o + 1], r = bgr[o + 2];
    const v = Math.max(b, g, r), diff = v - Math.min(b, g, r);
    const s = (diff * SDIV[v] + 2048) >> 12;
    let h = v === r ? g - b : v === g ? b - r + 2 * diff : r - g + 4 * diff;
    h = (h * HDIV[diff] + 2048) >> 12;
    if (h < 0) h += 180;
    out[o] = h; out[o + 1] = s; out[o + 2] = v;
  }
  return out;
}
// cv2.cvtColor(BGR2GRAY), 8-bit.
function bgr2gray(bgr) {
  const n = bgr.length / 3, out = new Uint8Array(n);
  for (let p = 0, o = 0; p < n; p++, o += 3) out[p] = (bgr[o] * 1868 + bgr[o + 1] * 9617 + bgr[o + 2] * 4899 + 8192) >> 14;
  return out;
}
// cv2.resize(..., INTER_AREA) by exactly 2x, interleaved 8-bit with `ch` channels.
function shrink2(src, w, h, ch) {
  const ow = w >> 1, oh = h >> 1, out = new Uint8Array(ow * oh * ch);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) for (let c = 0; c < ch; c++) {
    const i = ((2 * y) * w + 2 * x) * ch + c;
    out[(y * ow + x) * ch + c] = (src[i] + src[i + ch] + src[i + w * ch] + src[i + w * ch + ch] + 2) >> 2;
  }
  return out;
}
function shrink2f(src, w, h) { // same for one float plane
  const ow = w >> 1, oh = h >> 1, out = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const i = (2 * y) * w + 2 * x;
    out[y * ow + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1]) / 4;
  }
  return out;
}
const reflect101 = (i, n) => { if (n === 1) return 0; while (i < 0 || i >= n) i = i < 0 ? -i : 2 * (n - 1) - i; return i; };
function gaussianKernel(ksize, sigma) {
  const k = [], c = (ksize - 1) / 2;
  for (let i = 0; i < ksize; i++) k.push(Math.exp(-((i - c) ** 2) / (2 * sigma * sigma)));
  const s = k.reduce((a, b) => a + b, 0);
  return k.map(v => v / s);
}
// cv2.GaussianBlur on one plane (BORDER_REFLECT_101), separable, float arithmetic.
function gaussianBlur(src, w, h, ksize, sigma) {
  const k = gaussianKernel(ksize, sigma), r = (ksize - 1) / 2;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let j = -r; j <= r; j++) a += k[j + r] * src[y * w + reflect101(x + j, w)];
    tmp[y * w + x] = a;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let j = -r; j <= r; j++) a += k[j + r] * tmp[reflect101(y + j, h) * w + x];
    out[y * w + x] = a;
  }
  return out;
}

// OpenCV's 2x2 bilinear weight table entries (15-bit, forced to sum to 32768), by 1/32 phase.
const WARP_TAB = (() => {
  const tab = new Int32Array(32 * 32 * 4);
  for (let fy = 0; fy < 32; fy++) for (let fx = 0; fx < 32; fx++) {
    const vy = fy / 32, vx = fx / 32;
    const w = [(1 - vy) * (1 - vx), (1 - vy) * vx, vy * (1 - vx), vy * vx].map(t => Math.round(t * 32768));
    const diff = 32768 - w[0] - w[1] - w[2] - w[3];
    if (diff) {
      let k = 0;
      for (let i = 1; i < 4; i++) if (diff < 0 ? w[i] > w[k] : w[i] < w[k]) k = i;
      w[k] += diff;
    }
    tab.set(w, (fy * 32 + fx) * 4);
  }
  return tab;
})();

// parse.py crop_cell: cv2.warpAffine(INTER_LINEAR, BORDER_CONSTANT 0) of the cell square onto 96x96.
// The affine map is a pure scale+shift, so the inverse (dst->src) is src = origin + dst*cell/96.
function cropCell(img, geom, col, row) {
  const x0 = geom.left + col * geom.cell, y0 = geom.top + row * geom.cell, s = geom.cell / SZ;
  const out = new Uint8Array(NPX * 3);
  const AB = 1024, round = 16; // AB_SCALE, and AB_SCALE/INTER_TAB_SIZE/2
  const xs = new Int32Array(SZ), ys = new Int32Array(SZ);
  for (let d = 0; d < SZ; d++) {
    xs[d] = (Math.round(s * d * AB) + Math.round(x0 * AB) + round) >> 5;
    ys[d] = (Math.round(s * d * AB) + Math.round(y0 * AB) + round) >> 5;
  }
  const W = img.width, H = img.height, src = img.bgr;
  for (let dy = 0; dy < SZ; dy++) {
    const Y = ys[dy], sy = Y >> 5, fy = Y & 31;
    for (let dx = 0; dx < SZ; dx++) {
      const X = xs[dx], sx = X >> 5, fx = X & 31, t = (fy * 32 + fx) * 4;
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let k = 0; k < 4; k++) {
          const px = sx + (k & 1), py = sy + (k >> 1);
          if (px >= 0 && px < W && py >= 0 && py < H) acc += WARP_TAB[t + k] * src[(py * W + px) * 3 + c];
        }
        out[(dy * SZ + dx) * 3 + c] = (acc + 16384) >> 15;
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------- patches */

// A 96x96 BGR cell crop with lazily computed HSV / gray planes.
class Patch {
  constructor(bgr) { this.bgr = bgr; this._hsv = null; this._gray = null; this._f = null; }
  get hsv() { return this._hsv || (this._hsv = bgr2hsv(this.bgr)); }
  get gray() { return this._gray || (this._gray = bgr2gray(this.bgr)); }
  channel(c) { const o = new Uint8Array(NPX); for (let i = 0; i < NPX; i++) o[i] = this.bgr[i * 3 + c]; return o; }
  hsvChannel(c) { const o = new Uint8Array(NPX), h = this.hsv; for (let i = 0; i < NPX; i++) o[i] = h[i * 3 + c]; return o; }
}

function patchFeatures(patch) {
  if (patch._f) return patch._f;
  const bgr = patch.bgr, hsv = patch.hsv;
  let presence = 0, bc = 0, cb = 0, cn = 0, ab = 0, an = 0, mb = 0, mn = 0;
  for (let y = 26; y < 70; y++) for (let x = 26; x < 70; x++) if (bgr[(y * SZ + x) * 3] > 5) presence++;
  presence /= 44 * 44;
  const counts = { R: 0, Y: 0, G: 0, B: 0 };
  for (let i = 0; i < NPX; i++) {
    const r = RAD[i], bright = Math.max(bgr[i * 3], bgr[i * 3 + 1], bgr[i * 3 + 2]) > 125;
    if (bright && r < 40) bc++;
    if (r < 13) { cn++; if (bright) cb++; }
    if (r > 26 && r < 39) { an++; if (bright) ab++; }
    if (r > 15 && r < 31) { mn++; if (bright) mb++; }
    const h = hsv[i * 3], s = hsv[i * 3 + 1], v = hsv[i * 3 + 2];
    if (s > 90 && v > 75 && r < 42) {
      if (h < 12 || h > 169) counts.R += v; else if (h < 39) counts.Y += v; else if (h < 85) counts.G += v; else counts.B += v;
    }
  }
  const c = voteColor(counts), total = counts.R + counts.Y + counts.G + counts.B;
  return patch._f = {
    presence, bright_count: bc, core_bright: cb / cn, ann_bright: ab / an, mid_bright: mb / mn,
    color: c, color_strength: counts[c] / Math.max(total, 1), color_count: total,
  };
}

const imageSignature = patch => shrink2(patch.bgr, SZ, SZ, 3); // 48x48x3

/* ---------------------------------------------------------------- arrow matching */

let ARROW_TEMPLATES = null, ARROW_SHAPES = null;
const unb64 = s => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
};
function getData(opts) {
  const data = (opts && opts.data) || root.KunParserData || (typeof require === 'function' ? require('./parser_data.js') : null);
  if (!data) throw new Error('parser_data.js is not loaded.');
  return data;
}

function directionFromSprite(patch, data) {
  if (!ARROW_TEMPLATES) ARROW_TEMPLATES = data.arrowTemplates.map(([d, b]) => [d, unb64(b)]);
  const sig = imageSignature(patch);
  let best = Infinity, dir = null;
  for (const [d, ref] of ARROW_TEMPLATES) {
    let s = 0;
    for (let i = 0; i < sig.length; i++) { const e = sig[i] - ref[i]; s += e * e; }
    s /= sig.length;
    if (s < best || (s === best && d < dir)) { best = s; dir = d; }
  }
  if (best > 3800) return [null, 0];
  return [dir, best < 1300 ? 0.93 : best < 2300 ? 0.76 : 0.62];
}

function normalized(v) {
  let m = 0; for (let i = 0; i < v.length; i++) m += v[i]; m /= v.length;
  let n = 0; for (let i = 0; i < v.length; i++) { v[i] -= m; n += v[i] * v[i]; }
  n = Math.sqrt(n) + 1e-8;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
function blueArrowSignature(patch) {
  const b = new Float32Array(NPX);
  for (let i = 0; i < NPX; i++) b[i] = Math.max(0, patch.bgr[i * 3] - 30);
  const blur = gaussianBlur(b, SZ, SZ, 3, 1);
  const crop = new Float32Array(72 * 72);
  for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) crop[y * 72 + x] = blur[(y + 12) * SZ + x + 12];
  return normalized(shrink2f(crop, 72, 72));
}
function loadArrowShapes(data) {
  ARROW_SHAPES = [];
  for (const [stem, b] of Object.entries(data.arrowShapes)) {
    const d = stem[0], raw = unb64(b), t = new Float32Array(1296);
    for (let i = 0; i < 1296; i++) t[i] = raw[i] / 255;
    let m = 0; for (let i = 0; i < 1296; i++) m += t[i]; m /= 1296;
    for (let i = 0; i < 1296; i++) t[i] -= m;
    ARROW_SHAPES.push([d, normalized(Float32Array.from(t))]);
    // The animation mirrors the chevrons on the opposite arrow, so a flipped template
    // is a valid sample of the opposite direction in another phase.
    const f = new Float32Array(1296), vertical = 'ud'.includes(d);
    for (let y = 0; y < 36; y++) for (let x = 0; x < 36; x++) f[y * 36 + x] = vertical ? t[(35 - y) * 36 + x] : t[y * 36 + 35 - x];
    ARROW_SHAPES.push([{ u: 'd', d: 'u', l: 'r', r: 'l' }[d], normalized(f)]);
  }
}
function arrowShapeMatch(patch, data, relaxed = false, gate = true) {
  if (!ARROW_SHAPES) loadArrowShapes(data);
  if (!ARROW_SHAPES.length) return [null, 0];
  let strong = 0;
  for (let y = 14; y < 82; y++) for (let x = 14; x < 82; x++) if (patch.bgr[(y * SZ + x) * 3] > 48) strong++;
  if (strong < 600) return [null, 0];
  if (!gate && patchFeatures(patch).color === 'R') return [null, 0];
  if (gate) {
    const f = patchFeatures(patch);
    if (f.core_bright > .50 || f.ann_bright > .33 || f.color_strength < .72 || f.color !== 'B') return [null, 0];
  }
  const sig = blueArrowSignature(patch), by = { u: -1, d: -1, l: -1, r: -1 };
  for (const [d, ref] of ARROW_SHAPES) {
    let s = 0; for (let i = 0; i < sig.length; i++) s += sig[i] * ref[i];
    if (s > by[d]) by[d] = s;
  }
  const scores = Object.entries(by).map(([d, v]) => [v, d]).sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? 1 : -1));
  if (scores[0][0] < (relaxed ? .72 : .84)) return [null, 0];
  if (scores[0][0] - scores[1][0] < (relaxed ? .07 : .06)) return [null, 0];
  return [scores[0][1], Math.min(.99, scores[0][0])];
}

/* ---------------------------------------------------------------- sprite detectors */

function concentricGoal(patch) {
  const v = new Float64Array(NPX), rr = new Int32Array(NPX);
  for (let i = 0; i < NPX; i++) { v[i] = Math.max(patch.bgr[i * 3], patch.bgr[i * 3 + 1], patch.bgr[i * 3 + 2]); rr[i] = Math.round(RAD[i]); }
  const cnt = new Float64Array(70), tot = new Float64Array(70);
  for (let i = 0; i < NPX; i++) { cnt[rr[i]]++; tot[rr[i]] += v[i]; }
  const raw = []; for (let k = 0; k < 46; k++) raw.push(tot[k] / Math.max(cnt[k], 1));
  const padded = [raw[0], ...raw, raw[45]], prof = [];
  for (let k = 0; k < 46; k++) prof.push(.25 * padded[k] + .5 * padded[k + 1] + .25 * padded[k + 2]);
  const ko = 24 + argmax(prof.slice(24, 42), 0, 18), ki = 3 + argmax(prof.slice(3, 19), 0, 16);
  const po = prof[ko], pi = prof[ki];
  if (Math.min(po, pi) < 95 || ko - ki < 10) return false;
  if (Math.min(...prof.slice(ki + 3, ko - 3)) > .6 * Math.min(po, pi)) return false;
  if (Math.max(...prof.slice(Math.min(45, ko + 6))) > .55 * po) return false;
  if (mean(prof.slice(0, Math.max(1, ki - 3))) > .7 * pi) return false;
  for (const [k, pk] of [[ko, po], [ki, pi]]) {
    const ring = []; for (let i = 0; i < NPX; i++) if (rr[i] === k) ring.push(v[i]);
    if (percentile(ring, 15) < .6 * pk) return false;
  }
  return true;
}

// A ball starting on a teleport (11.6): the orb is drawn with coloured corner arcs in the teleport's colour. Returns [ballColor, teleportColor]
// or null. Arcs are counted off the cell's axes only: a switch's blue ring also crosses the axes, corner arcs do not. Only non-red arcs are clean
// evidence (red walls bleed into the cell); a red arc needs a much stronger signal.
function ballOnTeleport(patch) {
  const hsv = patch.hsv, own = { R: 0, Y: 0, G: 0, B: 0 }, arc = { R: 0, Y: 0, G: 0, B: 0 }, axis = { R: 0, Y: 0, G: 0, B: 0 };
  for (let i = 0; i < NPX; i++) {
    const r = RAD[i], core = r < 20, ring = r >= 34 && r < 50 && DX[i] <= 40 && DY[i] <= 40;
    if (!core && !ring) continue;
    const onAxis = !core && Math.min(DX[i], DY[i]) <= 14;
    const h = hsv[i * 3], s = hsv[i * 3 + 1], v = hsv[i * 3 + 2];
    if (!(s > 85 && v > 105)) continue;
    const c = (h < 20 || h > 169) ? 'R' : h < 39 ? 'Y' : h < 85 ? 'G' : 'B';
    if (core) own[c]++; else (onAxis ? axis : arc)[c]++;
  }
  const ball = voteColor(own);
  if (own[ball] < .5 * (own.R + own.Y + own.G + own.B)) return null;
  let best = null;
  // Arcs in the ball's own colour count too: plain balls give at most 17 such pixels on 45 balls of the test screenshots, real arcs 400+.
  for (const c of ['R', 'Y', 'G', 'B']) if (arc[c] >= (c === 'R' ? (c === ball ? 600 : 800) : 250) && axis[c] <= .45 * arc[c] && (!best || arc[c] > arc[best])) best = c;
  return best ? [ball, best] : null;
}

function overlayColors(patch) {
  const hsv = patch.hsv, out = [];
  for (const region of [mk(i => RAD[i] < 16), mk(i => RAD[i] > 33 && RAD[i] < 40)]) {
    const bins = { R: 0, Y: 0, G: 0, B: 0 };
    let n = 0;
    for (let i = 0; i < NPX; i++) {
      if (!region[i]) continue;
      const h = hsv[i * 3], s = hsv[i * 3 + 1], v = hsv[i * 3 + 2];
      if (!(s > 85 && v > 105)) continue;
      n++;
      if (h < 20 || h > 169) bins.R += v; else if (h < 39) bins.Y += v; else if (h < 85) bins.G += v; else bins.B += v;
    }
    if (n < 75) return null;
    const col = voteColor(bins);
    if (bins[col] < .54 * (bins.R + bins.Y + bins.G + bins.B)) return null;
    out.push(col);
  }
  return out[0] !== out[1] ? out : null;
}

const XS_CROSS = [...Array(28).keys()].map(i => i + 6).concat([...Array(28).keys()].map(i => i + 62));
function metalCross(patch) {
  const g = patch.gray;
  const band = (rows, cols) => { let s = 0; for (const y of rows) for (const x of cols) s += g[y * SZ + x]; return s / (rows.length * cols.length); };
  const rng = (a, b) => [...Array(b - a).keys()].map(i => i + a);
  const h = band(rng(46, 50), XS_CROSS) - .5 * (band(rng(36, 41), XS_CROSS) + band(rng(55, 60), XS_CROSS));
  const v = band(XS_CROSS, rng(46, 50)) - .5 * (band(XS_CROSS, rng(36, 41)) + band(XS_CROSS, rng(55, 60)));
  return h < -20 && v < -20;
}

const M_CORNER = mk(i => DX[i] > 13 && DY[i] > 13 && RAD[i] > 30 && RAD[i] < 56);
const M_AXIS = mk(i => (DX[i] < 5 && DY[i] > 28 && DY[i] < 46) || (DY[i] < 5 && DX[i] > 28 && DX[i] < 46));
const QUADS = [true, false].flatMap(a => [true, false].map(b => mk(i => M_CORNER[i] && ((i % SZ < 48) === a) && ((Math.floor(i / SZ) < 48) === b))));
const M_R6 = mk(i => RAD[i] < 6), M_R8 = mk(i => RAD[i] < 8), M_R24 = mk(i => RAD[i] < 24), M_R12_24 = mk(i => RAD[i] >= 12 && RAD[i] < 24);
function teleportSprite(patch) {
  const V = patch.hsvChannel(2), S = patch.hsvChannel(1), H = patch.hsvChannel(0);
  const above = (arr, mask, t) => { let n = 0, d = 0; for (let i = 0; i < NPX; i++) if (mask[i]) { d++; if (arr[i] > t) n++; } return n / d; };
  if (Math.min(...QUADS.map(m => above(V, m, 100))) < .10) return null;
  if (above(V, M_AXIS, 170) > .08 || maskMean(V, M_R6) < 200) return null;
  if (above(V, M_R12_24, 170) > .5) return null;
  // Colour is read off the corner arcs. Pixels at the cell edge (|dx| or |dy| > 40) are excluded: the neon outline bleeds in there, and on red
  // walls it outvoted gray (universal) and green arcs next to a wall (13.2, 14.6, 14.8). Fall back to all corner pixels if too few remain.
  let lit = mk(i => M_CORNER[i] && V[i] > 100 && DX[i] <= 40 && DY[i] <= 40);
  if (lit.reduce((a, b) => a + b, 0) < 40) lit = mk(i => M_CORNER[i] && V[i] > 100);
  if (above(S, lit, 70) < .5) return '*';
  const counts = { R: 0, Y: 0, G: 0, B: 0 };
  for (let i = 0; i < NPX; i++) {
    if (!lit[i] || !(S[i] > 70)) continue;
    const h = H[i];
    if (h < 12 || h > 169) counts.R++; else if (h < 55) counts.Y++; else if (h < 85) counts.G++; else counts.B++;
  }
  return voteColor(counts);
}

// Bright pixels on the goal-ring radius (33-40): ~80 around a switch's dark ring, 400-900 around a ball drawn inside a goal ring.
function brightRing(patch) {
  const V = patch.hsvChannel(2); let n = 0;
  for (let i = 0; i < NPX; i++) if (RAD[i] > 33 && RAD[i] < 40 && V[i] > 150) n++;
  return n;
}

function switchDisc(patch) {
  const S = patch.hsvChannel(1), V = patch.hsvChannel(2), H = patch.hsvChannel(0);
  if (maskMean(S, M_R8) < 200) return null;
  const solid = mk(i => S[i] > 150 && V[i] > 90);
  if (maskMean(solid, M_R24) < .85) return null;
  // A goal ring drawn around a ball (13.4: red ball in a blue ring) is bright at r 33-40; a switch's dark ring is not (80 vs 660 pixels).
  if (brightRing(patch) > 300) return null;
  const hs = []; for (let i = 0; i < NPX; i++) if (M_R8[i]) hs.push(H[i]);
  hs.sort((a, b) => a - b);
  const n = hs.length, hue = Math.trunc(n % 2 ? hs[(n - 1) / 2] : (hs[n / 2 - 1] + hs[n / 2]) / 2);
  if (hue >= 39 && hue < 85) return 'switch_on';
  if (hue < 12 || hue > 169) return 'switch';
  return null;
}

const M_FRAME = mk(i => Math.max(DX[i], DY[i]) > 40);
function stripedBorder(patch) {
  const H = patch.hsvChannel(0), S = patch.hsvChannel(1), V = patch.hsvChannel(2);
  const yel = mk(i => H[i] >= 12 && H[i] <= 40 && S[i] > 100 && V[i] > 100);
  return maskMean(yel, M_FRAME) > .3;
}

function concentricSprite(patch) {
  const g = patch.gray, prof = [];
  for (let a = 2; a < 32; a += 3) {
    let s = 0, n = 0;
    for (let i = 0; i < NPX; i++) if (RAD[i] >= a && RAD[i] < a + 3) { s += g[i]; n++; }
    prof.push(s / n);
  }
  const m = mean(prof);
  return Math.sqrt(mean(prof.map(v => (v - m) ** 2))) > 15;
}

function redChevrons(patch) {
  const H = patch.hsvChannel(0), S = patch.hsvChannel(1), V = patch.hsvChannel(2);
  const box = new Uint8Array(60 * 60);
  let n = 0;
  for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) {
    const i = (y + 18) * SZ + x + 18;
    const red = (H[i] < 12 || H[i] > 165) && S[i] > 90 && V[i] > 50;
    box[y * 60 + x] = red ? 1 : 0; n += red ? 1 : 0;
  }
  if (!(n > 1000 && n < 2300)) return false;
  if (patchFeatures(patch).ann_bright > .5) return false;
  let diff = 0;
  for (let i = 0; i < 3600; i++) if (box[i] !== box[3599 - i]) diff++;
  const asym = diff / n;
  const hot = mk(i => V[i] > 200 && S[i] < 80);
  const white = maskMean(hot, M_R6) > .3;
  return asym > (white ? .6 : .2);
}

// Direction a stack of chevrons points to (arrow tip side). Blue chevrons are weighted by the blue channel; red (rotating) ones by
// red minus blue, so a red floor tint does not count.
function chevronDirection(patch, red = false) {
  const v = new Float64Array(72 * 72);
  for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) {
    const i = ((y + 12) * SZ + x + 12) * 3;
    v[y * 72 + x] = red ? patch.bgr[i + 2] - patch.bgr[i] : Math.max(0, patch.bgr[i] - 60);
  }
  // Rotating arrows are dim (red minus blue peaks near 65 on a floor tint near 45), so a fixed threshold loses the chevrons:
  // measure them above the cell's own median instead.
  if (red) {
    const sorted = Float64Array.from(v).sort(), base = sorted[sorted.length >> 1] + 5;
    for (let i = 0; i < v.length; i++) v[i] = Math.max(0, v[i] - base);
  }
  const c = 35.5, mid = d => d < 8, arm = d => d > 18 && d < 34;
  // Weighted mean of the measured coordinate over pixels selected by the *other* axis's distance from the centre.
  const mom = (selOn, measureHoriz) => {
    let w = 0, t = 0;
    for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) {
      if (!selOn(Math.abs((measureHoriz ? y : x) - c))) continue;
      const val = v[y * 72 + x];
      w += val; t += val * (measureHoriz ? x : y);
    }
    return t / (w + 1e-6);
  };
  const dv = mom(mid, false) - mom(arm, false);
  const dh = mom(mid, true) - mom(arm, true);
  const av = Math.abs(dv), ah = Math.abs(dh), major = Math.max(av, ah), minor = Math.min(av, ah);
  // Dim red chevrons on red-walled boards (11.9) give a weak but clear signal (about 2-4 against under 1 on the other axis),
  // so rotating arrows use a lower cutoff plus a dominance test instead of the blue arrows' fixed 5.
  if (red ? (major < 1.5 || major < 2 * minor) : major < 5) return null;
  if (av >= ah) return dv > 0 ? 'd' : 'u';
  return dh > 0 ? 'r' : 'l';
}

/* ---------------------------------------------------------------- classification */

function classify(patch, templates, data) {
  const f = patchFeatures(patch);
  let [dir, conf] = arrowShapeMatch(patch, data, false, false);
  if (dir !== null) return ['arrow_' + (chevronDirection(patch) || dir), conf, f];
  [dir, conf] = arrowShapeMatch(patch, data, true, false);
  if (dir !== null) return ['arrow_' + (chevronDirection(patch) || dir), Math.min(conf, .8), f];
  if (metalCross(patch)) {
    if (stripedBorder(patch)) return ['gate_detected', .95, f];
    const tc = teleportSprite(patch);
    if (tc) return [`teleport_${tc}_switchable`, .93, f];
    if (concentricSprite(patch)) return ['teleport_*_inactive', .85, f];
    return ['gate_inactive', .93, f];
  }
  const tc = teleportSprite(patch);
  if (tc) return [`teleport_${tc}`, .92, f];
  const sw = switchDisc(patch);
  if (sw) return [sw, .95, f];
  if (redChevrons(patch)) {
    const d = chevronDirection(patch, true); // orientation shown in the screenshot = phase 0 of the stored arrow
    return [d ? 'arrow_rotating_' + d : 'arrow_rotating', d ? .85 : .6, f];
  }

  const blurred = gaussianBlur(patch.gray, SZ, SZ, 5, 1), g8 = Float64Array.from(blurred, v => Math.round(v));
  let asymSum = 0;
  for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) {
    const a = g8[(y + 12) * SZ + x + 12], b = g8[(83 - y) * SZ + 83 - x];
    asymSum += Math.abs(a - b);
  }
  const asym = asymSum / (72 * 72);
  let wc = 0, gsum = 0, cn = 0;
  for (let i = 0; i < NPX; i++) if (RAD[i] < 13) {
    cn++;
    const m = Math.min(patch.bgr[i * 3], patch.bgr[i * 3 + 1], patch.bgr[i * 3 + 2]);
    if (m > 165 && patch.gray[i] > 200) wc++;
    gsum += patch.gray[i];
  }
  const whitecore = wc / cn, graycore = gsum / cn;
  let typ, c;
  if (f.color === 'B' && f.color_strength > .85 && f.core_bright > .69 && f.ann_bright < .23 &&
      f.bright_count > 900 && f.bright_count < 2400 && asym > 24.3 && !(whitecore > .46 && graycore > 202)) {
    let [d2, c2] = arrowShapeMatch(patch, data, true, false);
    if (d2 === null) [d2, c2] = directionFromSprite(patch, data);
    d2 = d2 ? (chevronDirection(patch) || d2) : null;
    return [d2 ? 'arrow_' + d2 : 'unknown', c2, f];
  }
  const overlap = (f.bright_count > 2400 && f.core_bright > .85 && (f.ann_bright > .7 || (f.ann_bright > .55 && brightRing(patch) > 300))) ? overlayColors(patch) : null;
  if (overlap) return [`ball_${overlap[0]}+goal_${overlap[1]}`, .91, f];
  const onTele = f.core_bright > .88 && f.bright_count > 2800 && f.mid_bright > .8 ? ballOnTeleport(patch) : null;
  if (onTele) return [`ball_${onTele[0]}+teleport_${onTele[1]}`, .85, f];
  if (f.core_bright < .02 && f.bright_count > 120 && f.bright_count < 900 && f.ann_bright < .26 && f.mid_bright < .12) { typ = 'outside'; c = .94; }
  else if (f.presence < .18) { typ = 'outside'; c = .99; }
  else if (f.bright_count > 2700 && f.color === 'R' && f.mid_bright > .78 && f.ann_bright > .39) { typ = 'switch'; c = .98; }
  else if (f.color === 'Y' && f.color_strength > .86 && f.ann_bright > .32 && f.ann_bright < .60 && f.core_bright < .50 && f.mid_bright > .55) { typ = 'gate_detected'; c = .95; }
  else if (f.bright_count > 450 && f.color_strength < .20 && f.ann_bright > .10 && f.ann_bright < .40) { typ = 'wall'; c = .96; }
  else if (f.bright_count > 1050 && f.bright_count < 2500 && f.core_bright > .54 && f.core_bright < .88 && f.ann_bright < .22 && f.mid_bright < .62) {
    typ = 'hex_pending_' + (f.color === 'R' ? 'R' : 'G'); c = .88;
  }
  else if (f.bright_count < 95) { typ = 'floor'; c = .96; }
  else {
    const col = f.color;
    if (concentricGoal(patch)) { typ = `goal_${col}`; c = .85; }
    else if (f.ann_bright > .54 && f.bright_count > 550) { typ = `goal_${col}`; c = Math.min(.98, .68 + .3 * (f.ann_bright - .54) / .4); }
    else if (f.core_bright > .88 && f.bright_count > 1300) { typ = `ball_${col}`; c = .90; }
    else if (f.core_bright > .38 && f.bright_count < 1450 && f.ann_bright < .38) { typ = `teleport_${col}`; c = .78; }
    else { typ = 'unknown'; c = 0; }
  }
  if (templates && templates.length && typ !== 'outside' && typ !== 'floor') {
    const sig = imageSignature(patch);
    const scored = templates.map(([kind, im]) => {
      let s = 0; for (let i = 0; i < sig.length; i++) { const e = sig[i] - im[i]; s += e * e; }
      return [s / sig.length, kind];
    }).sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
    const [best, kind] = scored[0], runner = scored.length > 1 ? scored[1][0] : Infinity;
    if (best < 950 && (runner > best * 1.25 || best < 180)) { typ = kind; c = Math.max(c, Math.min(.99, .7 + .28 * (1 - Math.min(best / 950, 1)))); }
  }
  return [typ, c, f];
}

/* ---------------------------------------------------------------- geometry */

// Tunnel arms (21.1): one-cell stubs whose open end is clipped by the game's drawing area and marked with white triangles. Their strokes
// can be too pale for the outline measurement, so the grid comes out short. A marker pair about one cell beyond a grid edge means that
// the grid continues there (checked up to two cells out, on all four sides). Ordinary tunnel markers sit right at the outline instead.
function extendForTunnelArms(img, g) {
  const { width: W, height: H } = img, hsv = img.hsv || (img.hsv = bgr2hsv(img.bgr));
  const yLo = Math.trunc(H * .125), yHi = Math.trunc(H * .94);
  const whites = (xa, xb, ya, yb) => {
    let n = 0;
    for (let y = Math.max(yLo, Math.trunc(ya)); y < Math.min(yHi, Math.trunc(yb)); y++) for (let x = Math.max(0, Math.trunc(xa)); x < Math.min(W, Math.trunc(xb)); x++) {
      const i = y * W + x; if (hsv[i * 3 + 2] > 200 && hsv[i * 3 + 1] < 50) n++;
    }
    return n;
  };
  const c = g.cell, out = { ...g };
  const probe = (edge, lo, hi, vertical) => { // marker pixels in a band around `edge`, across [lo, hi)
    return vertical ? whites(lo, hi, edge - 14, edge + 16) : whites(edge - 14, edge + 16, lo, hi);
  };
  const right = g.left + g.width * c, bottom = g.top + g.height * c;
  for (let d = 1; d <= 2; d++) if (probe(g.left - d * c, g.top, bottom, false) >= 25) { out.left = g.left - d * c; out.width += d; break; }
  for (let d = 1; d <= 2; d++) if (probe(right + d * c, g.top, bottom, false) >= 25) { out.width += d; break; }
  for (let d = 1; d <= 2; d++) if (probe(g.top - d * c, g.left, right, true) >= 25) { out.top = g.top - d * c; out.height += d; break; }
  for (let d = 1; d <= 2; d++) if (probe(bottom + d * c, g.left, right, true) >= 25) { out.height += d; break; }
  return out;
}

function robustGeometry(img, grid) {
  if (grid) {
    const v = (typeof grid === 'string' ? grid.split(',') : grid).map(Number);
    if (v.length !== 5 || v.some(Number.isNaN)) throw new Error('grid is LEFT,TOP,CELL,COLS,ROWS');
    return { left: v[0], top: v[1], cell: v[2], width: Math.trunc(v[3]), height: Math.trunc(v[4]), score: 1 };
  }
  const { width: w, height: h, bgr } = img;
  const hsv = img.hsv || (img.hsv = bgr2hsv(bgr)), cyan = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const b = bgr[p * 3], g = bgr[p * 3 + 1], r = bgr[p * 3 + 2];
    cyan[p] = ((b > 88 && g > 88 && r < 155 && b > r + 30) || (hsv[p * 3 + 1] > 110 && hsv[p * 3 + 2] > 170)) ? 1 : 0;
  }
  cyan.fill(0, 0, Math.trunc(h * .125) * w);
  cyan.fill(0, Math.trunc(h * .94) * w);
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1, count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cyan[y * w + x]) {
    count++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (count < 200) throw new Error('Could not find cyan board outline');
  const spanx = x1 - x0 + 1, spany = y1 - y0 + 1;
  // Seam profiles do not depend on the candidate cell size.
  const xb = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) xb[p] = Math.max(bgr[p * 3], bgr[p * 3 + 1], bgr[p * 3 + 2]);
  const px = new Float64Array(w - 1), py = new Float64Array(h - 1);
  const ra = Math.max(0, y0 + 15), rb = Math.min(h, y1 - 15), ca = Math.max(0, x0 + 15), cb = Math.min(w, x1 - 15);
  if (rb > ra) for (let x = 0; x < w - 1; x++) { let s = 0; for (let y = ra; y < rb; y++) s += Math.abs(xb[y * w + x + 1] - xb[y * w + x]); px[x] = s / (rb - ra); }
  if (cb > ca) for (let y = 0; y < h - 1; y++) { let s = 0; for (let x = ca; x < cb; x++) s += Math.abs(xb[(y + 1) * w + x] - xb[y * w + x]); py[y] = s / (cb - ca); }
  const seamAt = (profile, start, cnt) => {
    const vals = [];
    for (let j = 1; j < cnt; j++) {
      const i = pyRound(start + j * seamAt.cell);
      if (i >= 1 && i < profile.length - 2) vals.push((profile[i - 1] + profile[i] + profile[i + 1]) / 3);
    }
    return vals.length ? mean(vals) : 0;
  };
  let best = null;
  for (let cell = 42; cell <= 180; cell++) {
    const cols = pyRound((spanx - 23) / cell), rows = pyRound((spany - 17) / cell);
    if (cols < 2 || cols > 32 || rows < 2 || rows > 32) continue;
    const mx = spanx - cols * cell, my = spany - rows * cell;
    if (!(mx >= 6 && mx <= 40 && my >= 2 && my <= 40)) continue;
    seamAt.cell = cell;
    let left = x0 + 4, ls = -Infinity, top = y0, ts = -Infinity;
    for (let v = x0 + 4; v < x0 + 22; v++) { const s = seamAt(px, v, cols); if (s > ls) { ls = s; left = v; } }
    for (let v = y0; v < y0 + 16; v++) { const s = seamAt(py, v, rows); if (s > ts) { ts = s; top = v; } }
    const seam = seamAt(px, left, cols) + seamAt(py, top, rows);
    const fit = Math.abs(mx - 23) * .15 + Math.min(Math.abs(my - 10), Math.abs(my - 23)) * .12;
    const half = seamAt(px, left + cell / 2, cols) + seamAt(py, top + cell / 2, rows);
    const score = (seam - half) * .12 - fit - .008 * (cols + rows) - .45 * Math.abs(cell - pyRound(cell / 10) * 10);
    if (!best || score > best.score) best = { left, top, cell, width: cols, height: rows, score };
  }
  if (!best) throw new Error('Could not establish a grid from the full cyan outline; supply the grid geometry manually');
  return extendForTunnelArms(img, best);
}

// Cells inside the neon outline, from outline topology (see parse.py inside_cells).
function insideCells(img, geom, out) {
  const { width: W, height: H, bgr } = img;
  const hsv = img.hsv || (img.hsv = bgr2hsv(bgr));
  const neon = i => hsv[i * 3 + 2] > 150, white = i => hsv[i * 3 + 2] > 200 && hsv[i * 3 + 1] < 50;
  const cw = geom.width, ch = geom.height, c = geom.cell;
  // Wall color votes (hue of saturated neon pixels on edges that count as walls): B cyan/blue, R red, G green.
  const votes = { B: 0, R: 0, G: 0 };
  const hueClass = i => {
    if (hsv[i * 3 + 1] < 90 || hsv[i * 3 + 2] < 150) return null;
    const h = hsv[i * 3];
    return (h < 12 || h > 169) ? 'R' : (h >= 39 && h < 85) ? 'G' : (h >= 85 && h <= 135) ? 'B' : null;
  };
  let gapMark = false; // set by wall(): white marker pixels on an edge without a neon outline = tunnel opening candidate
  const wall = (x0, y0, x1, y1, vertical) => {
    let best = 0, mark = 0;
    const local = { B: 0, R: 0, G: 0 };
    for (let off = -8; off <= 8; off++) {
      let n = 0, hit = 0, wh = 0;
      if (vertical) {
        const xs = pyRound(x0 + off);
        if (xs < 0 || xs >= W) continue;
        for (let y = Math.max(0, Math.trunc(y0)); y < Math.min(H, Math.trunc(y1)); y++) { n++; const i = y * W + xs; if (neon(i)) { hit++; const k = hueClass(i); if (k) local[k]++; } if (white(i)) wh++; }
      } else {
        const ys = pyRound(y0 + off);
        if (ys < 0 || ys >= H) continue;
        for (let x = Math.max(0, Math.trunc(x0)); x < Math.min(W, Math.trunc(x1)); x++) { n++; const i = ys * W + x; if (neon(i)) { hit++; const k = hueClass(i); if (k) local[k]++; } if (white(i)) wh++; }
      }
      // White marker pixels are bright too but are not outline: two triangles can cover ~70% of a cell edge (12.6), so they must not count as wall.
      if (n) { best = Math.max(best, (hit - wh) / n); mark = Math.max(mark, wh / n); }
    }
    if (best > .6) for (const k in votes) votes[k] += local[k];
    // Real tunnel markers cover >= 50% of the edge (12.6, 21.1); a teleport's bright square gives 7-15% (white teleport on 12.9), so require 30%.
    gapMark = best <= .6 && mark > .3;
    return best > .6 || mark > .05;
  };
  const gaps = new Map();
  const edgeWall = ([ac, ar], [bc, br]) => {
    if (ac !== bc) {
      const e = Math.max(ac, bc), r = ar;
      if (!(r >= 0 && r < ch)) return false;
      const x = geom.left + e * c, y0 = geom.top + r * c + .25 * c, y1 = geom.top + r * c + .75 * c;
      const res = wall(x, y0, x, y1, true);
      if (gapMark) gaps.set(`${ac},${ar}|${bc},${br}`, [[ac, ar], [bc, br]]);
      return res;
    }
    const e = Math.max(ar, br), col = ac;
    if (!(col >= 0 && col < cw)) return false;
    const y = geom.top + e * c, x0 = geom.left + col * c + .25 * c, x1 = geom.left + col * c + .75 * c;
    const res = wall(x0, y, x1, y, false);
    if (gapMark) gaps.set(`${ac},${ar}|${bc},${br}`, [[ac, ar], [bc, br]]);
    return res;
  };
  const INF = 1e9, key = (a, b) => a + ',' + b, dist = new Map([[key(-1, -1), 0]]);
  const dq = [[-1, -1]]; // 0-1 BFS; push/unshift emulate appendleft/append
  while (dq.length) {
    const cur = dq.shift(), d = dist.get(key(cur[0], cur[1]));
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = [cur[0] + dc, cur[1] + dr];
      if (!(nx[0] >= -1 && nx[0] <= cw && nx[1] >= -1 && nx[1] <= ch)) continue;
      const wgt = edgeWall(cur, nx) ? 1 : 0, nd = d + wgt, k = key(nx[0], nx[1]);
      if (nd < (dist.has(k) ? dist.get(k) : INF)) { dist.set(k, nd); if (wgt === 0) dq.unshift(nx); else dq.push(nx); }
    }
  }
  const inside = new Set();
  for (let col = 0; col < cw; col++) for (let row = 0; row < ch; row++) if ((dist.has(key(col, row)) ? dist.get(key(col, row)) : INF) % 2 === 1) inside.add(key(col, row));
  if (out) {
    out.wallVotes = votes;
    // Tunnel openings: marked gap between an inside cell and a non-inside one. Side = direction the ball travels to enter it.
    const seen = new Set(), openings = [];
    for (const [[ac, ar], [bc, br]] of gaps.values()) {
      const aIn = inside.has(ac + ',' + ar), bIn = inside.has(bc + ',' + br);
      if (aIn === bIn) continue;
      const [ic, ir] = aIn ? [ac, ar] : [bc, br], [oc, or] = aIn ? [bc, br] : [ac, ar];
      const side = oc !== ic ? (oc < ic ? 'l' : 'r') : (or < ir ? 'u' : 'd');
      const o = { x: ic + 1, y: geom.height - ir, side }, k = `${o.x},${o.y},${o.side}`;
      if (!seen.has(k)) { seen.add(k); openings.push(o); }
    }
    out.openings = openings.sort((p, q) => p.y - q.y || p.x - q.x || 'udlr'.indexOf(p.side) - 'udlr'.indexOf(q.side));
  }
  return inside;
}

// Tunnel pairing cannot be read from a screenshot, so this is only a first guess (the editor changes it). Openings on opposite sides
// pair first (top-bottom, left-right): the same row/column before any, then the nearest line; this is the pairing the saved solution of
// 21.1 needs (its openings are offset). Anything left pairs in lexicographic order; an odd one out is returned in `left`.
function guessTunnelPairs(openings) {
  const free = openings.slice(), pairs = [], opp = { l: 'r', r: 'l', u: 'd', d: 'u' };
  const line = o => (o.side === 'l' || o.side === 'r') ? o.y : o.x, along = o => (o.side === 'l' || o.side === 'r') ? o.x : o.y;
  for (const sameLineOnly of [true, false]) {
    for (let i = 0; i < free.length; i++) {
      const a = free[i];
      if (!a) continue;
      let bestJ = -1, bestD = null;
      for (let j = i + 1; j < free.length; j++) {
        const b = free[j];
        if (!b || b.side !== opp[a.side] || (sameLineOnly && line(b) !== line(a))) continue;
        const d = [Math.abs(line(b) - line(a)), Math.abs(along(b) - along(a))];
        if (bestJ < 0 || d[0] < bestD[0] || (d[0] === bestD[0] && d[1] < bestD[1])) { bestJ = j; bestD = d; }
      }
      if (bestJ >= 0) { pairs.push({ a, b: free[bestJ] }); free[i] = free[bestJ] = null; }
    }
  }
  const rest = free.filter(Boolean);
  while (rest.length > 1) pairs.push({ a: rest.shift(), b: rest.shift() });
  return { pairs, left: rest };
}

// Cosmetic wall color from the hue votes: 'B' (default), 'R' or 'G'; null when there is too little evidence to say.
function wallColorFromVotes(votes) {
  const total = votes.B + votes.R + votes.G;
  if (total < 40) return null;
  const [color, n] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return n / total >= .8 ? color : null;
}

/* ---------------------------------------------------------------- board assembly */

function parseLabel(label) {
  label = label.trim().replace(/:/g, '_');
  if (['empty', 'floor', 'outside', 'wall', 'switch', 'switch_on', 'unknown', 'hex_pending', 'hex_pending_G', 'hex_pending_R', 'gate_detected', 'gate_inactive'].includes(label)) return label;
  if (label.includes('+')) return label.split('+').map(parseLabel).join('+');
  const parts = label.split('_');
  if (['ball', 'goal', 'teleport'].includes(parts[0]) && parts.length === 2 && COLORS.includes(parts[1])) return label;
  if (parts[0] === 'teleport' && (parts.length === 2 || parts.length === 3) && [...COLORS, '*'].includes(parts[1]) && (parts.length === 2 || ['switchable', 'inactive'].includes(parts[2]))) return label;
  if (parts[0] === 'switch' && parts.length === 2) return label;
  if (parts[0] === 'arrow' && parts.length === 2 && ['u', 'd', 'l', 'r', 'rotating'].includes(parts[1])) return label;
  if (parts[0] === 'arrow' && parts.length === 3 && parts[1] === 'rotating' && ['u', 'd', 'l', 'r'].includes(parts[2])) return label;
  if (parts[0] === 'gate' && parts.length >= 2) return label;
  if (parts[0] === 'hex' && parts.length === 2 && /^[+-]?\d+$/.test(parts[1])) return label;
  throw new Error(`Invalid cell label '${label}'`);
}

function guessSwitchMapping(switches, gates, teleports, switchInfo, unresolved) {
  const claimed = new Set();
  for (const sw of switches) if (sw.id in switchInfo) for (const i of sw.controls) claimed.add(i);
  const elements = gates.filter(g => !claimed.has(g.id)).map(g => [g.id, [[g.x, g.y]]]);
  for (const t of teleports) if (t.switchable && !claimed.has(t.id)) elements.push([t.id, [[t.x, t.y]]]);
  let free = switches.filter(sw => !(sw.id in switchInfo));
  if (!free.length && elements.length) free = [...switches];
  if (!free.length) return '';
  for (const sw of free) {
    if (!(sw.id in switchInfo)) sw.controls = [];
    const msg = `Switch at (${sw.x},${sw.y}) has unknown mapping`;
    unresolved.splice(0, unresolved.length, ...unresolved.filter(w => w !== msg));
  }
  const dist = (sw, el) => Math.min(...el[1].map(([x, y]) => Math.abs(sw.x - x) + Math.abs(sw.y - y)));
  const owner = new Map();
  for (const el of elements) {
    let bi = 0;
    for (let i = 1; i < free.length; i++) if (dist(free[i], el) < dist(free[bi], el)) bi = i;
    owner.set(el[0], bi);
  }
  const countOwned = o => [...owner.values()].filter(v => v === o).length;
  free.forEach((sw, i) => {
    if ([...owner.values()].includes(i)) return;
    const donors = elements.filter(el => countOwned(owner.get(el[0])) > 1);
    if (!donors.length) return;
    let el = donors[0];
    for (const e of donors.slice(1)) { const a = dist(sw, e), b = dist(sw, el); if (a < b || (a === b && e[0] < el[0])) el = e; }
    owner.set(el[0], i);
  });
  for (const el of elements) free[owner.get(el[0])].controls.push(el[0]);
  if (switches.length === 1) return '';
  const empty = free.filter(sw => !sw.controls.length).map(sw => sw.id);
  if (empty.length) unresolved.push('Switch(es) ' + empty.join(', ') + ' control nothing: fewer switchable elements than switches');
  return free.map(sw => `${sw.id}->${sw.controls.join(',') || '-'}`).join('; ');
}

function assembleBoard(labels, geom, level, overrides) {
  const walls = [], balls = [], goals = [], arrows = [], gates = [], switches = [], hexes = [];
  const telecells = [], rotating = [];
  let unresolved = [];
  for (let row = geom.height - 1; row >= 0; row--) for (let col = 0; col < geom.width; col++) {
    const kind = labels[row][col], x = col + 1, y = geom.height - row, pos = () => ({ x, y });
    if (kind.includes('+')) {
      for (const part of kind.split('+')) {
        if (part.startsWith('ball_')) balls.push({ ...pos(), color: part.slice(5) });
        else if (part.startsWith('goal_')) goals.push({ ...pos(), color: part.slice(5) });
        else if (part.startsWith('teleport_')) telecells.push({ ...pos(), color: part.slice(9), switchable: false, inactive: false });
      }
    } else if (kind === 'outside' || kind === 'wall') walls.push(pos());
    else if (kind === 'floor' || kind === 'empty') { /* nothing */ }
    else if (kind.startsWith('ball_')) balls.push({ ...pos(), color: kind.slice(5) });
    else if (kind.startsWith('goal_')) goals.push({ ...pos(), color: kind.slice(5) });
    else if (kind.startsWith('teleport_')) {
      const rest = kind.slice(9), i = rest.indexOf('_');
      const color = i < 0 ? rest : rest.slice(0, i), flag = i < 0 ? '' : rest.slice(i + 1);
      telecells.push({ ...pos(), color, switchable: ['switchable', 'inactive'].includes(flag), inactive: flag === 'inactive' });
    } else if (kind.startsWith('arrow_')) {
      const [d, od] = kind.slice(6).split('_'); // arrow_<dir>, arrow_rotating or arrow_rotating_<dir>
      const rot = d === 'rotating';
      arrows.push({ ...pos(), direction: rot ? (od || 'u') : d, ...(rot ? { rotating: true } : {}) });
      if (rot) rotating.push({ x, y, known: !!od });
    } else if (kind === 'hex_pending_G' || kind === 'hex_pending_R') {
      const v = HEX_GUESS[kind.slice(-1)];
      hexes.push({ ...pos(), id: `H${hexes.length + 1}`, value: v });
      unresolved.push(`Hexagon at (${x},${y}) value guessed by colour: ${v >= 0 ? '+' : ''}${v}`);
    } else if (kind === 'hex_pending') unresolved.push(`Hexagon at (${x},${y}) needs its signed value`);
    else if (kind.startsWith('hex_')) hexes.push({ ...pos(), id: `H${hexes.length + 1}`, value: parseInt(kind.slice(4), 10) });
    else if (kind === 'gate_detected' || kind === 'gate_inactive') gates.push({ ...pos(), id: `G${gates.length + 1}`, active: kind === 'gate_detected' });
    else if (kind.startsWith('gate_')) {
      const bits = kind.split('_');
      gates.push({ ...pos(), id: bits[1], active: !(bits.length > 2 && ['off', 'inactive', 'false'].includes(bits[2])) });
    } else if (kind.startsWith('switch')) {
      const isOn = kind === 'switch_on';
      const sid = kind.includes('_') && !isOn ? kind.slice(kind.indexOf('_') + 1) : `S${switches.length + 1}`;
      switches.push({ ...pos(), id: sid, controls: [], ...(isOn ? { on: true } : {}) });
      unresolved.push(`Switch at (${x},${y}) has unknown mapping`);
    } else unresolved.push(`Unrecognized object at (${x},${y})`);
  }
  // Teleports are single endpoints; partners follow from the colors (same-color endpoints pair up, two universals pair with each other,
  // a lone universal pairs with the single endpoint of every other color). An inactive endpoint is drawn gray and has lost its color,
  // so it is given the color of a lone colored endpoint that needs a partner (nearest first), or becomes a universal.
  const teleports = [], pairConfig = overrides.teleports || [];
  if (pairConfig.length) {
    pairConfig.forEach((item, i) => teleports.push({ id: item.id || `T${i + 1}`, x: item.x, y: item.y, color: item.color, active: item.active === undefined ? true : item.active, ...(item.switchable ? { switchable: true } : {}) }));
  } else if (telecells.length) {
    const known = telecells.filter(t => !t.inactive), gray = telecells.filter(t => t.inactive);
    const count = c => known.filter(t => t.color === c).length;
    const needy = COLORS.filter(c => count(c) === 1 && count('*') !== 1);
    const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const assigned = new Map(), pool = [...gray], notes = [];
    while (needy.length && pool.length) {
      let best = null;
      for (const c of needy) { const mate = known.find(t => t.color === c); for (const g of pool) { const d = dist(mate, g); if (!best || d < best.d) best = { c, g, d }; } }
      assigned.set(best.g, best.c); needy.splice(needy.indexOf(best.c), 1); pool.splice(pool.indexOf(best.g), 1);
      notes.push(`(${best.g.x},${best.g.y}) ${best.c}`);
    }
    if (pool.length === 2 || (pool.length === 1 && count('*') === 1)) { for (const g of pool) { assigned.set(g, '*'); notes.push(`(${g.x},${g.y}) universal`); } pool.length = 0; }
    if (notes.length) unresolved.push(`Inactive (gray) teleports lost their color; assigned by proximity: ${notes.join(', ')}. Check the pairing`);
    if (pool.length) unresolved.push(`${pool.length} inactive teleport(s) at ${pool.map(g => `(${g.x},${g.y})`).join(', ')}: color unknown, set it in the editor`);
    for (const g of pool) assigned.set(g, '*');
    for (const c of needy) unresolved.push(`${c} teleport has no partner`);
    for (const t of telecells.sort((a, b) => a.y - b.y || a.x - b.x))
      teleports.push({ id: `T${teleports.length + 1}`, x: t.x, y: t.y, color: t.inactive ? assigned.get(t) : t.color, active: !t.inactive, ...(t.switchable ? { switchable: true } : {}) });
  }
  // A screenshot shows a rotating arrow's current orientation only, never whether it turns clockwise, counterclockwise or flips.
  if (rotating.length) {
    const at = r => `(${r.x},${r.y})`, unknown = rotating.filter(r => !r.known);
    unresolved.push(`Rotating arrow type assumed clockwise at ${rotating.map(at).join(', ')}: a screenshot cannot show whether an arrow turns clockwise, counterclockwise or flips. Set each one's Type in the editor.`
      + (unknown.length ? ` Orientation not recognized (assumed up) at ${unknown.map(at).join(', ')}.` : ''));
  }
  const switchInfo = overrides.switches || {};
  for (const s of switches) if (s.id in switchInfo) {
    const spec = switchInfo[s.id];
    s.controls = [...(spec.controls || [])];
    if ('on' in spec) { if (spec.on) s.on = true; else delete s.on; }
  }
  if (Object.keys(switchInfo).length) {
    for (const s of switches) if (s.id in switchInfo) {
      const msg = `Switch at (${s.x},${s.y}) has unknown mapping`;
      unresolved = unresolved.filter(w => w !== msg);
    }
  }
  const switchableTp = teleports.filter(t => t.switchable).map(t => t.id);
  const guessed = guessSwitchMapping(switches, gates, teleports, switchInfo, unresolved);
  if (guessed) unresolved.push('Switch mapping guessed by proximity: ' + guessed);
  if (!switches.length && (gates.length || switchableTp.length)) unresolved.push('Switchable gates/teleports found but no switch detected');
  const bc = {}, gc = {};
  for (const b of balls) bc[b.color] = (bc[b.color] || 0) + 1;
  for (const g of goals) gc[g.color] = (gc[g.color] || 0) + 1;
  for (const [color, n] of Object.entries(bc)) if ((gc[color] || 0) < n) unresolved.push(`${color}: ${n} balls but only ${gc[color] || 0} goals`);
  if (!balls.length) unresolved.push('No balls detected');
  const board = { version: 1, id: level, title: `Level ${level}`, width: geom.width, height: geom.height, walls, balls, goals, arrows, gates, switches, teleports, hexes };
  if ('solution' in overrides) board.solution = overrides.solution;
  return [board, unresolved];
}

/* ---------------------------------------------------------------- driver */

function levelFromName(name) {
  const stem = String(name || '').replace(/\.[^.]*$/, '');
  const m = /(?<![0-9])([0-9]+)[.-]([0-9]+)(?![0-9])/.exec(stem);
  return m ? `${m[1]}.${m[2]}` : stem.replace(/-/g, '.');
}

// img: {width, height, bgr: Uint8Array(width*height*3)}. Returns everything parse.py writes to disk.
function parseImage(img, options = {}) {
  const data = getData(options), overrides = options.overrides || {}, templates = options.templates || [];
  const level = options.level || 'imported';
  let geometry = robustGeometry(img, options.grid);
  const warnings = [], cellOverrides = overrides.cells || {};
  const classifyGrid = geom => {
    const labels = Array.from({ length: geom.height }, () => Array(geom.width).fill(null));
    const confidence = Array.from({ length: geom.height }, () => Array(geom.width).fill(0));
    const stats = [], notes = [];
    for (let row = geom.height - 1; row >= 0; row--) for (let col = 0; col < geom.width; col++) {
      const patch = new Patch(cropCell(img, geom, col, row));
      let [kind, conf, features] = classify(patch, templates, data);
      const key = `${col + 1},${geom.height - row}`;
      if (key in cellOverrides) { kind = parseLabel(String(cellOverrides[key])); conf = 1; }
      labels[row][col] = kind; confidence[row][col] = conf;
      if (kind === 'unknown' || (conf < .7 && kind !== 'outside' && kind !== 'floor')) notes.push(`Cell (${key}) classified ${kind}, confidence ${conf.toFixed(2)}`);
      const measurements = {};
      for (const [k, v] of Object.entries(features)) measurements[k] = typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v;
      stats.push({ x: col + 1, y: geom.height - row, kind, confidence: Math.round(conf * 1000) / 1000, measurements });
    }
    return { labels, confidence, stats, notes };
  };
  let grid = classifyGrid(geometry);
  // Boards made of separate rooms (11.6: six 2x2 rooms) can fool the seam search into a cell twice the real size. Every real level has
  // balls, so when none were found try the half-size grid (same origin) and keep it only if it finds some.
  const hasBall = g => g.labels.some(r => r.some(k => String(k).startsWith('ball_')));
  if (!options.grid && !hasBall(grid) && geometry.cell >= 84) {
    const half = { ...geometry, cell: geometry.cell / 2, width: geometry.width * 2, height: geometry.height * 2 };
    const alt = classifyGrid(half);
    if (hasBall(alt)) { geometry = half; grid = alt; }
  }
  const { labels, confidence, stats } = grid;
  warnings.push(...grid.notes);
  const wallVotes = {};
  try {
    const inside = insideCells(img, geometry, wallVotes);
    if (inside.size) for (let r = 0; r < geometry.height; r++) for (let c = 0; c < geometry.width; c++) {
      if (labels[r][c] === 'outside' && inside.has(c + ',' + r) && !((`${c + 1},${geometry.height - r}`) in cellOverrides)) {
        labels[r][c] = 'floor'; confidence[r][c] = .8;
        for (const st of stats) if (st.x === c + 1 && st.y === geometry.height - r) st.kind = 'floor';
      }
    }
  } catch (exc) { warnings.push('Outline topology check failed: ' + exc.message); }
  const [board, issues] = assembleBoard(labels, geometry, level, overrides);
  warnings.push(...issues);
  let wallColor = overrides.wallColor !== undefined ? overrides.wallColor : wallColorFromVotes(wallVotes.wallVotes || { B: 0, R: 0, G: 0 });
  if (wallColor === null) { wallColor = 'B'; warnings.push('Wall color uncertain (too few or mixed outline pixels); assumed blue. Set it in the editor if the walls are red or green.'); }
  if (wallColor !== 'B') board.wallColor = wallColor;
  if (wallVotes.openings?.length) {
    const { pairs, left } = guessTunnelPairs(wallVotes.openings);
    if (pairs.length) board.tunnels = pairs;
    warnings.push(`Tunnel pairing is a guess (${wallVotes.openings.length} openings found); check and correct it in the editor.` + (left.length ? ` One opening (${left[0].x}, ${left[0].y}, ${left[0].side}) has no partner and was dropped.` : ''));
  }
  const recognition = warnings.filter(w => w.startsWith('Cell (') || w.startsWith('Unrecognized object') || w.startsWith('No balls detected') || w.includes('balls but only'));
  return { board, warnings, recognitionWarnings: recognition, mechanicsPending: warnings.filter(w => !recognition.includes(w)), geometry, labels, confidence, stats, level, wallColor, wallVotes: wallVotes.wallVotes, openings: wallVotes.openings || [] };
}

// RGBA (canvas ImageData layout) -> the BGR image parseImage expects.
function fromRGBA(imageData) {
  const { width, height, data } = imageData, bgr = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) { bgr[p * 3] = data[p * 4 + 2]; bgr[p * 3 + 1] = data[p * 4 + 1]; bgr[p * 3 + 2] = data[p * 4]; }
  return { width, height, bgr };
}

/* ---------------------------------------------------------------- browser-only helpers */

async function loadFile(file) {
  let bitmap; // raw pixel values, like OpenCV's imread (no colour-profile conversion)
  try { bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none' }); } catch (e) { bitmap = await createImageBitmap(file); }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return { image: fromRGBA(ctx.getImageData(0, 0, canvas.width, canvas.height)), bitmap };
}

// Draw the screenshot with parse.py's review overlay onto `canvas`.
function renderReview(canvas, bitmap, result) {
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d'), g = result.geometry;
  ctx.drawImage(bitmap, 0, 0);
  const palette = { ball: '#6eff78', goal: '#ffff50', teleport: '#50aaff', gate: '#ffaa64', switch: '#ff64ff', arrow: '#ffdcaa', hex: '#afafff', unknown: '#ff0000' };
  ctx.lineWidth = 2; ctx.textBaseline = 'alphabetic';
  ctx.font = `${Math.round(Math.max(.34, Math.min(.65, g.cell / 160)) * 28)}px sans-serif`;
  for (let row = 0; row < g.height; row++) for (let col = 0; col < g.width; col++) {
    const label = result.labels[row][col];
    if (label === 'outside' || label === 'floor' || label === 'empty') continue;
    const px = pyRound(g.left + col * g.cell), py = pyRound(g.top + row * g.cell), d = pyRound(g.cell);
    ctx.strokeStyle = ctx.fillStyle = result.confidence[row][col] < .7 ? '#ff0000' : (palette[label.split('_')[0]] || '#ff5050');
    ctx.strokeRect(px + 3, py + 3, d - 6, d - 6);
    ctx.fillText(label.replace('teleport', 'tp').replace('unknown', '?'), px + 5, py + d - 8, d - 8);
  }
  // Tunnel openings: a thick magenta bar on the gap's cell side, numbered by guessed pair (N, N; unpaired ones get '?').
  const tunnels = result.board?.tunnels || [], same = (o, p) => o.x === p.x && o.y === p.y && o.side === p.side;
  ctx.strokeStyle = ctx.fillStyle = '#ff40ff'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.font = `bold ${Math.round(Math.max(.34, Math.min(.65, g.cell / 160)) * 34)}px sans-serif`;
  for (const o of result.openings || []) {
    const col = o.x - 1, row = g.height - o.y, x0 = g.left + col * g.cell, y0 = g.top + row * g.cell, c = g.cell, m = .15 * c;
    const [ax, ay, bx, by] = o.side === 'l' ? [x0, y0 + m, x0, y0 + c - m] : o.side === 'r' ? [x0 + c, y0 + m, x0 + c, y0 + c - m]
      : o.side === 'u' ? [x0 + m, y0, x0 + c - m, y0] : [x0 + m, y0 + c, x0 + c - m, y0 + c];
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    const k = tunnels.findIndex(t => same(t.a, o) || same(t.b, o));
    const tx = o.side === 'l' ? x0 + 4 : o.side === 'r' ? x0 + c - 4 - c * .25 : x0 + c * .4, ty = o.side === 'u' ? y0 + c * .35 : o.side === 'd' ? y0 + c - 8 : y0 + c * .55;
    ctx.fillText(k < 0 ? '?' : 'T' + (k + 1), tx, ty);
  }
  ctx.lineWidth = 2; ctx.lineCap = 'butt';
}

async function parseFile(file, options = {}) {
  const { image, bitmap } = await loadFile(file);
  const result = parseImage(image, { ...options, level: options.level || levelFromName(file.name) });
  return { ...result, bitmap };
}

const api = { PARSER_VERSION, parseImage, parseFile, fromRGBA, renderReview, levelFromName, parseLabel,
  _internals: { chevronDirection, guessTunnelPairs, pyRound, bgr2hsv, bgr2gray, shrink2, gaussianBlur, cropCell, robustGeometry, insideCells, classify, Patch, patchFeatures, assembleBoard } };
if (typeof module === 'object' && module.exports) module.exports = api; else root.KunParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
