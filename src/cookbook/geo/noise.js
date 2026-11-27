/*! Portions adapted from MIT-licensed code, Copyright (c) 2026 Maksymilian Dendura. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
// CPU noise + small math helpers shared by geo/*, decals/* and backdrop/* (load-time only — never per frame).
// Value noise with quintic fade (no grid artefacts at 1st derivative), fbm, ridged fbm, domain warp.
// Hash adapted from MIT-licensed code, Copyright (c) 2026 Maksymilian Dendura (see THIRD_PARTY_NOTICES.md).

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const mix = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

// mulberry32 — same as engine/core.js G.rng, duplicated so geo files work standalone in node tests
export const rngFrom = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// FNV-1a 32-bit string hash (seed decal distress by text so the same sign always wears the same way)
export const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export const ihash = (x, y, z, s = 0) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(s, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// 3D value noise in [0,1]
export function vnoise3(x, y, z, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const a = mix(mix(ihash(ix, iy, iz, s), ihash(ix + 1, iy, iz, s), fx), mix(ihash(ix, iy + 1, iz, s), ihash(ix + 1, iy + 1, iz, s), fx), fy);
  const b = mix(mix(ihash(ix, iy, iz + 1, s), ihash(ix + 1, iy, iz + 1, s), fx), mix(ihash(ix, iy + 1, iz + 1, s), ihash(ix + 1, iy + 1, iz + 1, s), fx), fy);
  return mix(a, b, fz);
}
// 2D value noise in [0,1]
export function vnoise2(x, y, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  return mix(mix(ihash(ix, iy, 0, s), ihash(ix + 1, iy, 0, s), fx), mix(ihash(ix, iy + 1, 0, s), ihash(ix + 1, iy + 1, 0, s), fx), fy);
}
// fbm in [0,1] (normalised); octaves rotate/offset to hide lattice alignment
export function fbm2(x, y, o = 4, s = 0, lac = 2.03, gain = 0.5) {
  let a = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < o; i++) {
    sum += a * vnoise2(x, y, s + i); norm += a;
    const nx = x * 0.8 - y * 0.6, ny = x * 0.6 + y * 0.8; // rotate ~37° per octave
    x = nx * lac + 17.1; y = ny * lac + 31.7; a *= gain;
  }
  return sum / norm;
}
export function fbm3(x, y, z, o = 4, s = 0) {
  let a = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < o; i++) { sum += a * vnoise3(x, y, z, s + i); norm += a; x = x * 2.03 + 17.1; y = y * 2.03 + 31.7; z = z * 2.03 + 5.3; a *= 0.5; }
  return sum / norm;
}
// ridged fbm in [0,1]: sharp crests, used for mountain ridges and erosion-like gullies
export function ridged2(x, y, o = 5, s = 0) {
  let a = 0.5, sum = 0, norm = 0, prev = 1;
  for (let i = 0; i < o; i++) {
    let n = 1 - Math.abs(vnoise2(x, y, s + i) * 2 - 1); n *= n;
    sum += n * a * prev; norm += a; prev = clamp(n * 1.6, 0, 1); // crest-weighting: detail concentrates on ridges
    const nx = x * 0.8 - y * 0.6, ny = x * 0.6 + y * 0.8;
    x = nx * 2.07 + 11.3; y = ny * 2.07 + 5.9; a *= 0.5;
  }
  return sum / norm;
}
