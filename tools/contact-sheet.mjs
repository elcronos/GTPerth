#!/usr/bin/env node
// Tile screenshots into one labelled JPEG (round overviews for the lead / critic, before-after comparisons).
//   node contact-sheet.mjs --out contact.jpg [--cols 3] [--tile 520] [--title "round 03"] img1.png img2.jpg ...
//   node contact-sheet.mjs --out contact.jpg --dir shots/r03/critic [--match "^pose-\d+\.jpg$"]
// Labels default to the file name (without extension); pass --labels "a,b,c" to override. PNG and JPEG inputs.
// The output long edge is kept <= 1568 px when --fit is given (what the vision model actually sees).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const argv = process.argv.slice(2);
const A = { _: [] };
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const v = argv[i + 1]; if (v !== undefined && !v.startsWith('--')) { A[a.slice(2)] = v; i++; } else A[a.slice(2)] = true; } else A._.push(a); }
let files = A._;
if (A.dir) { const re = new RegExp(A.match || '\\.(png|jpe?g)$', 'i'); files = readdirSync(A.dir).filter((f) => re.test(f)).sort().map((f) => path.join(A.dir, f)); }
if (!A.out || !files.length) { console.error('usage: contact-sheet.mjs --out sheet.jpg [--cols 3] [--tile 520] files... | --dir D [--match RE]'); process.exit(1); }
const labels = A.labels ? String(A.labels).split(',') : files.map((f) => path.basename(f).replace(/\.\w+$/, ''));

const load = (f) => {
  const b = readFileSync(f);
  if (b[0] === 0x89) { const p = PNG.sync.read(b); return { w: p.width, h: p.height, d: p.data }; }
  const j = jpeg.decode(b, { useTArray: true, maxMemoryUsageInMB: 1024 }); return { w: j.width, h: j.height, d: j.data };
};
const imgs = files.map(load);
const cols = +(A.cols || Math.min(3, imgs.length)), rows = Math.ceil(imgs.length / cols);
let tw = +(A.tile || 520);
const aspect = imgs[0].h / imgs[0].w;
const S = 2, LH = 7 * S + 10, PAD = 6, TH = A.title ? 7 * 3 + 16 : 0; // label strip height, title band
if (A.fit) { const maxW = (1568 - PAD * (cols + 1)) / cols; tw = Math.min(tw, Math.floor(maxW)); }
const th = Math.round(tw * aspect);
const W = cols * tw + (cols + 1) * PAD, H = TH + rows * (th + LH) + (rows + 1) * PAD;
const out = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { out[i * 4] = 18; out[i * 4 + 1] = 18; out[i * 4 + 2] = 20; out[i * 4 + 3] = 255; }

// 5x7 bitmap font (rows top→bottom, 5 bits, MSB = left). Lowercase renders as uppercase.
const F = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  '-': [0, 0, 0, 31, 0, 0, 0], _: [0, 0, 0, 0, 0, 0, 31], '.': [0, 0, 0, 0, 0, 12, 12], ':': [0, 12, 12, 0, 12, 12, 0],
  '/': [1, 1, 2, 4, 8, 16, 16], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8], '=': [0, 0, 31, 0, 31, 0, 0],
  '#': [10, 10, 31, 10, 31, 10, 10], '%': [24, 25, 2, 4, 8, 19, 3], ',': [0, 0, 0, 0, 12, 4, 8], '+': [0, 4, 4, 31, 4, 4, 0],
};
function text(str, x0, y0, s, rgb) {
  let x = x0;
  for (const ch of String(str).toUpperCase()) {
    const g = F[ch];
    if (g) for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r] & (16 >> c))
      for (let v = 0; v < s; v++) for (let u = 0; u < s; u++) {
        const px = x + c * s + u, py = y0 + r * s + v; if (px >= W || py >= H) continue;
        const k = (py * W + px) * 4; out[k] = rgb[0]; out[k + 1] = rgb[1]; out[k + 2] = rgb[2];
      }
    x += 6 * s; if (x > W - 6 * s) break;
  }
}
// area-average downscale of img into the tile at (ox, oy)
function blit(img, ox, oy) {
  const sx = img.w / tw, sy = img.h / th;
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
    const x0 = Math.floor(i * sx), x1 = Math.max(x0 + 1, Math.floor((i + 1) * sx)), y0 = Math.floor(j * sy), y1 = Math.max(y0 + 1, Math.floor((j + 1) * sy));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y += Math.max(1, (y1 - y0) >> 2)) for (let x = x0; x < x1; x += Math.max(1, (x1 - x0) >> 2)) {
      const k = (Math.min(img.h - 1, y) * img.w + Math.min(img.w - 1, x)) * 4; r += img.d[k]; g += img.d[k + 1]; b += img.d[k + 2]; n++;
    }
    const o = ((oy + j) * W + ox + i) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
}
if (A.title) text(A.title, PAD + 4, PAD + 6, 3, [232, 183, 120]);
imgs.forEach((img, i) => {
  const c = i % cols, r = Math.floor(i / cols);
  const x = PAD + c * (tw + PAD), y = TH + PAD + r * (th + LH + PAD);
  blit(img, x, y);
  text(labels[i] || '', x + 2, y + th + 5, S, [225, 220, 210]);
});
writeFileSync(A.out, jpeg.encode({ data: out, width: W, height: H }, +(A.quality || 88)).data);
console.log(`${A.out}  ${W}x${H}  ${imgs.length} tiles`);
