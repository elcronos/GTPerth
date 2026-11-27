// Tower builder + the Perth skyline. Each building = tiers of extruded footprints (rect / rounded rect / circle /
// polygon), roof caps, parapets, plant rooms and crowns, merged into one facade-material mesh per city chunk.
// Heights from CTBUH / Wikipedia; positions from coordinates (see map.js) and street layout.
import { ShapeUtils, Vector2, BufferGeometry, Float32BufferAttribute, Mesh } from 'three';
import { heightAt } from '../../map.js';
import { rngFrom } from '../../cookbook/geo/noise.js';

// ---------------------------------------------------------------- footprints (local, CCW seen from above)
function rectPts(w, d, cr = 0, seg = 4) {
  const hw = w / 2, hd = d / 2;
  if (!cr) return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const p = [], c = [[hw - cr, -hd + cr, -Math.PI / 2], [hw - cr, hd - cr, 0], [-hw + cr, hd - cr, Math.PI / 2], [-hw + cr, -hd + cr, Math.PI]];
  for (const [cx, cz, a0] of c) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; p.push([cx + Math.cos(a) * cr, cz + Math.sin(a) * cr]); }
  return p;
}
function circlePts(r, n = 28) { const p = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; }
const area = (P) => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return a / 2; };
function ensureCCW(P) { return area(P) < 0 ? P : [...P].reverse(); }

// ---------------------------------------------------------------- geometry accumulator
class Acc {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.fac = []; this.gl = []; this.idx = []; }
  v(p, n, u, c, f, g) { this.pos.push(...p); this.nrm.push(...n); this.uv.push(...u); this.col.push(...c); this.fac.push(...f); this.gl.push(...g); return this.pos.length / 3 - 1; }
  geo() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2)); g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFac', new Float32BufferAttribute(this.fac, 4)); g.setAttribute('aGlass', new Float32BufferAttribute(this.gl, 3));
    g.setIndex(this.idx); g.computeBoundingSphere(); return g;
  }
}
const STYLE = { curtain: 0, punched: 1, ribbon: 2, fins: 3, resi: 4, solid: 5, roof: 6, cobble: 7 };

// walls of one extruded ring. P local CCW; xform(local) → world [x,z]; smooth: per-vertex normals (circles)
function walls(A, P, y0, y1, T, o, smooth, yTop) {
  const n = P.length; let u = 0;
  const fac = [o.pw || 1.5, o.fh || 3.6, STYLE[o.style] ?? 0, o.seed || 0];
  const W = P.map((p) => T(p));
  for (let i = 0; i < n; i++) {
    const a = W[i], b = W[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 1e-3) continue;
    const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
    let na = [tz, 0, -tx], nb = na;                       // outward for CCW-from-above in x-east/z-south? fixed below
    if (smooth) {
      const pa = W[(i - 1 + n) % n], pb = W[(i + 2) % n];
      const n0 = nrmAt(pa, a, b), n1 = nrmAt(a, b, pb); na = n0; nb = n1;
    }
    const ya1 = yTop ? yTop(a) : y1, yb1 = yTop ? yTop(b) : y1;
    const i0 = A.v([a[0], y0, a[1]], na, [u, y0 - o.base], o.frame, fac, o.glass);
    const i1 = A.v([b[0], y0, b[1]], nb, [u + len, y0 - o.base], o.frame, fac, o.glass);
    const i2 = A.v([b[0], yb1, b[1]], nb, [u + len, yb1 - o.base], o.frame, fac, o.glass);
    const i3 = A.v([a[0], ya1, a[1]], na, [u, ya1 - o.base], o.frame, fac, o.glass);
    A.idx.push(i0, i2, i1, i0, i3, i2);
    u += len;
  }
}
function nrmAt(p, a, b) { const tx = b[0] - p[0], tz = b[1] - p[1], l = Math.hypot(tx, tz) || 1; return [tz / l, 0, -tx / l]; }
function cap(A, P, y, T, o, yTop) {
  const W = P.map((p) => T(p));
  const faces = ShapeUtils.triangulateShape(W.map((p) => new Vector2(p[0], p[1])), []);
  const fac = [4, 4, STYLE.roof, o.seed || 0];
  const base = A.pos.length / 3;
  for (const p of W) A.v([p[0], yTop ? yTop(p) : y, p[1]], [0, 1, 0], [p[0], p[1]], o.roofCol || [0.32, 0.31, 0.3], fac, [0, 0, 0]);
  for (const f of faces) {
    const a = W[f[0]], b = W[f[1]], c = W[f[2]];
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cr > 0) A.idx.push(base + f[0], base + f[2], base + f[1]); else A.idx.push(base + f[0], base + f[1], base + f[2]);
  }
}

// ---------------------------------------------------------------- one building
export function addBuilding(A, b, footprints) {
  const base = b.base ?? Math.min(heightAt(b.x, b.z), heightAt(b.x + 10, b.z + 10), heightAt(b.x - 10, b.z - 10)) - 0.3;
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  const T = (p) => [b.x + p[0] * c - p[1] * s, b.z + p[0] * s + p[1] * c];
  let y = base;
  b.tiers.forEach((t, ti) => {
    let P = t.pts ? t.pts : t.r ? circlePts(t.r, t.seg || 32) : rectPts(t.w, t.d, t.cr || 0, t.cseg || 4);
    if (t.off) P = P.map((p) => [p[0] + t.off[0], p[1] + t.off[1]]);
    // orient so that the wall normal formula [tz,0,-tx] points outward: for x-east/z-south that needs CW order seen from above
    P = ensureCCW(P);
    const y1 = base + t.h;
    const o = { pw: t.pw ?? b.pw, fh: t.fh ?? b.fh, style: t.style ?? b.style, seed: (b.seed ?? 1) + ti, base, frame: t.frame ?? b.frame, glass: t.glass ?? b.glass, roofCol: b.roofCol };
    const yTop = t.slope ? (p) => { const lx = (p[0] - b.x) * c + (p[1] - b.z) * s, lz = -(p[0] - b.x) * s + (p[1] - b.z) * c; const k = t.slope.axis === 'x' ? lx : lz; return y1 + (k * t.slope.k); } : null;
    walls(A, P, ti === 0 ? base - 2 : y, y1, T, o, !!t.r, yTop);
    if (!t.noCap) cap(A, P, y1, T, o, yTop);
    // parapet ring on the top of every tier that has a flat roof
    if (!t.slope && t.parapet !== 0) {
      const ph = t.parapet ?? 1.1;
      walls(A, P, y1, y1 + ph, T, { ...o, style: 'solid', frame: o.frame.map((v) => v * 0.9), fh: 4, pw: 3 }, !!t.r);
      cap(A, insetPts(P, 0.35), y1 + ph, T, { ...o, roofCol: o.frame.map((v) => v * 0.8) });
    }
    if (ti === 0 && footprints) footprints.push({ pts: P.map(T), name: b.name, h: t.h });
    y = y1;
  });
  // plant room + crown
  const top = y;
  if (b.plant !== false && !b.tiers[b.tiers.length - 1].slope) {
    const last = b.tiers[b.tiers.length - 1];
    const pw = (last.w || last.r * 1.4 || 20) * 0.45, pd = (last.d || last.r * 1.4 || 20) * 0.4;
    const P = ensureCCW(rectPts(pw, pd));
    const o = { pw: 3, fh: 4, style: 'solid', seed: 3, base, frame: [0.45, 0.45, 0.44], glass: [0, 0, 0], roofCol: [0.3, 0.3, 0.3] };
    walls(A, P, top, top + 4.5, T, o, false); cap(A, P, top + 4.5, T, o);
  }
  if (b.mast) { // communications mast / spire: tapered square section
    const [mh, mr] = b.mast; const segs = 6;
    for (let i = 0; i < segs; i++) {
      const r0 = mr * (1 - i / segs * 0.85), r1 = mr * (1 - (i + 1) / segs * 0.85);
      const y0 = top + (mh * i) / segs, y1 = top + (mh * (i + 1)) / segs;
      const P0 = ensureCCW(rectPts(r0 * 2, r0 * 2));
      walls(A, P0, y0, y1, T, { pw: 1, fh: 2, style: 'solid', seed: 9, base, frame: [0.6, 0.6, 0.62], glass: [0, 0, 0] }, false);
    }
  }
  return top;
}
function insetPts(P, d) {
  const n = P.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], p = P[i], b = P[(i + 1) % n];
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
    let dx = cx - p[0], dz = cz - p[1]; const l = Math.hypot(dx, dz) || 1;
    // move toward centroid direction approx
    out.push([p[0] + (dx / l) * d, p[1] + (dz / l) * d]);
  }
  return out;
}

// ---------------------------------------------------------------- the skyline
// Perth's CBD reads as deep blue/blue-grey reflective glass (photo-matched); frames are mid-grey, not white
const GL = {
  silver: [0.2, 0.25, 0.31], blue: [0.09, 0.17, 0.32], green: [0.1, 0.2, 0.19], grey: [0.13, 0.18, 0.24],
  bronze: [0.22, 0.17, 0.12], clear: [0.13, 0.19, 0.25], dark: [0.07, 0.09, 0.11], teal: [0.1, 0.21, 0.25],
};
const FR = { white: [0.5, 0.51, 0.52], alu: [0.36, 0.38, 0.4], lightAlu: [0.5, 0.52, 0.53], dark: [0.12, 0.12, 0.13], bronze: [0.33, 0.28, 0.23],
  granite: [0.36, 0.28, 0.24], sandstone: [0.6, 0.48, 0.34], cream: [0.68, 0.64, 0.56], precast: [0.5, 0.48, 0.44] };

export const NAMED = [
  // ---- Elizabeth Quay (east): The Ritz-Carlton (28 fl, 103 m) + The Towers residences (round), on a "cobble" podium
  { name: 'Ritz-Carlton Perth', x: 102, z: -88, style: 'resi', pw: 1.6, fh: 3.5, frame: FR.white, glass: GL.clear, seed: 11, tiers: [
    { w: 46, d: 58, h: 13, style: 'cobble', frame: [0.4, 0.36, 0.3], parapet: 1.2 }, { w: 34, d: 24, cr: 4, cseg: 3, h: 103, off: [0, 6], pw: 1.9 }] },
  { name: 'The Towers at Elizabeth Quay', x: 104, z: -146, style: 'resi', pw: 1.5, fh: 3.2, frame: FR.white, glass: GL.teal, seed: 12, tiers: [
    { w: 44, d: 30, h: 12, style: 'cobble', frame: [0.4, 0.36, 0.3] }, { r: 15.5, h: 84, seg: 36 }] },
  // ---- One The Esplanade (Chevron HQ, 29 fl, 133 m) and Nine The Esplanade (19 fl)
  { name: 'One The Esplanade', x: 96, z: -236, style: 'fins', pw: 1.5, fh: 4.2, frame: FR.white, glass: GL.clear, seed: 13, tiers: [
    { w: 58, d: 46, h: 12, style: 'curtain', fh: 6 }, { w: 44, d: 34, cr: 3, h: 133 }] },
  { name: 'Nine The Esplanade', x: 22, z: -238, style: 'curtain', pw: 1.25, fh: 4.0, frame: FR.alu, glass: GL.grey, seed: 14, tiers: [
    { w: 50, d: 40, h: 10, fh: 5 }, { w: 44, d: 32, cr: 2, h: 82 }] },
  // ---- EQ West (topped out 2026): 52 + 25 storeys over a podium
  { name: 'EQ West South', x: -110, z: -78, style: 'resi', pw: 1.5, fh: 3.25, frame: FR.alu, glass: GL.grey, seed: 15, tiers: [
    { w: 44, d: 56, h: 16, style: 'curtain', fh: 4 }, { w: 32, d: 29, cr: 7, h: 182 }] },
  { name: 'EQ West North', x: -112, z: -148, style: 'resi', pw: 1.5, fh: 3.25, frame: FR.alu, glass: GL.teal, seed: 16, tiers: [
    { w: 44, d: 50, h: 16, style: 'curtain', fh: 4 }, { w: 30, d: 27, cr: 6, h: 100 }] },
  // ---- civic / transport
  { name: 'Elizabeth Quay Station', x: -52, z: -252, style: 'curtain', pw: 2, fh: 7, frame: FR.alu, glass: GL.clear, plant: false, seed: 17, tiers: [{ w: 22, d: 12, h: 7 }] },
  { name: 'Perth Convention and Exhibition Centre', x: -192, z: -266, style: 'ribbon', pw: 2.5, fh: 7, frame: [0.48, 0.49, 0.5], glass: GL.dark, plant: false, seed: 18, tiers: [{ w: 180, d: 62, h: 20 }] },
  { name: 'Supreme Court', x: 300, z: -150, style: 'punched', pw: 3.2, fh: 5, frame: FR.sandstone, glass: GL.dark, plant: false, seed: 19, tiers: [{ w: 64, d: 30, h: 15 }] },
  // ---- St Georges Terrace / CBD core
  { name: 'Brookfield Place Tower 2', x: -96, z: -438, style: 'curtain', pw: 1.5, fh: 4.2, frame: FR.alu, glass: GL.silver, seed: 20, tiers: [{ w: 54, d: 42, h: 68 }] },
  { name: 'Brookfield Place', x: -96, z: -494, style: 'fins', pw: 2.2, fh: 4.1, frame: FR.white, glass: GL.blue, seed: 21, plant: false, tiers: [
    { w: 56, d: 30, h: 190 }, { w: 50, d: 24, h: 204, style: 'fins', pw: 3.2 }] },
  { name: 'Central Park', x: -24, z: -618, style: 'curtain', pw: 1.5, fh: 3.9, frame: FR.alu, glass: GL.silver, seed: 22, mast: [36, 2.2], tiers: [
    { pts: [[-19, -19], [19, -19], [30, 0], [19, 19], [-19, 19], [-30, 0]], h: 122 },
    { pts: [[-17, -17], [17, -17], [25, 0], [17, 17], [-17, 17], [-25, 0]], h: 168 },
    { pts: [[-14, -14], [14, -14], [19, 0], [14, 14], [-14, 14], [-19, 0]], h: 205 },
    { w: 20, d: 20, h: 226, style: 'fins', pw: 2.4 }] },
  { name: '108 St Georges Terrace (Palace Tower)', x: 115, z: -534, style: 'ribbon', pw: 1.6, fh: 3.6, frame: FR.lightAlu, glass: GL.green, seed: 23, plant: false, mast: [48, 1.1], tiers: [
    { pts: [[-26, 15], [26, 15], [4, -26], [-4, -26]], h: 160 }, { pts: [[-24, 13], [24, 13], [3, -23], [-3, -23]], h: 168, slope: { axis: 'z', k: -0.35 }, noCap: false }] },
  { name: 'Allendale Square', x: 218, z: -412, rot: Math.PI / 4, style: 'ribbon', pw: 1.4, fh: 3.7, frame: FR.bronze, glass: GL.bronze, seed: 24, tiers: [
    { pts: [[-18, -18], [-6, -14], [6, -18], [18, -18], [14, -6], [18, 6], [18, 18], [6, 14], [-6, 18], [-18, 18], [-14, 6], [-18, -6]], h: 132 }] },
  { name: 'Exchange Plaza', x: 192, z: -300, style: 'curtain', pw: 1.5, fh: 3.6, frame: FR.alu, glass: GL.blue, seed: 25, tiers: [
    { w: 44, d: 34, h: 30, style: 'curtain', fh: 3.2 }, { w: 40, d: 32, h: 124 }, { w: 34, d: 28, h: 136 }, { w: 26, d: 22, h: 146 }] },
  { name: 'QV1', x: -330, z: -566, style: 'punched', pw: 1.8, fh: 3.8, frame: FR.granite, glass: GL.dark, seed: 26, tiers: [{ w: 42, d: 42, cr: 5, h: 163 }] },
  { name: '240 St Georges Terrace', x: -262, z: -548, style: 'curtain', pw: 1.5, fh: 3.8, frame: FR.alu, glass: GL.grey, seed: 27, tiers: [{ w: 44, d: 34, h: 137 }] },
  { name: 'Capital Square', x: -206, z: -406, style: 'fins', pw: 1.6, fh: 3.9, frame: FR.white, glass: GL.teal, seed: 28, tiers: [{ w: 44, d: 36, cr: 4, h: 150 }] },
  { name: 'St Martins Tower', x: 420, z: -478, style: 'ribbon', pw: 1.5, fh: 3.6, frame: FR.precast, glass: GL.dark, seed: 29, tiers: [{ w: 34, d: 34, h: 132 }, { r: 14, h: 140, style: 'curtain' }] },
  { name: '140 St Georges Terrace', x: 60, z: -566, style: 'punched', pw: 1.6, fh: 3.7, frame: FR.precast, glass: GL.dark, seed: 30, tiers: [{ w: 38, d: 30, h: 131 }] },
  { name: '221 St Georges Terrace', x: -190, z: -496, style: 'curtain', pw: 1.5, fh: 3.6, frame: FR.alu, glass: GL.blue, seed: 31, tiers: [{ w: 36, d: 30, h: 110 }] },
  { name: 'Governor Stirling Tower', x: -146, z: -566, style: 'ribbon', pw: 1.5, fh: 3.6, frame: FR.precast, glass: GL.dark, seed: 32, tiers: [{ w: 34, d: 30, h: 110 }] },
  { name: '100 St Georges Terrace', x: 300, z: -526, style: 'curtain', pw: 1.5, fh: 3.8, frame: FR.alu, glass: GL.clear, seed: 33, tiers: [{ w: 36, d: 30, h: 103 }] },
  { name: 'Westralia Square', x: 30, z: -470, style: 'curtain', pw: 1.5, fh: 3.8, frame: FR.alu, glass: GL.teal, seed: 34, tiers: [{ w: 40, d: 34, h: 140 }] },
  { name: 'Woodside Plaza', x: -40, z: -440, style: 'fins', pw: 1.5, fh: 3.8, frame: FR.alu, glass: GL.silver, seed: 35, tiers: [{ w: 32, d: 28, h: 96 }] },
];

// South Perth (Mill Point Road): 1960s-2020s residential towers, white render + balconies; Civic Heart (37 fl, 147.5 m)
export const SOUTH_PERTH = [
  { name: 'Civic Heart', x: -140, z: 1452, style: 'resi', pw: 1.6, fh: 3.2, frame: FR.white, glass: GL.grey, seed: 50, tiers: [{ w: 44, d: 36, h: 12, style: 'curtain' }, { w: 30, d: 26, cr: 6, h: 105 }] },
];
function southPerthFill(rng) {
  // South Perth as seen from the city: Sir James Mitchell Park (65 ha of lawn) runs east from Mends Street with
  // Mill Point Road behind it; the high-rise flats (12–30 floors, cream/white balconies) cluster from Mill Point
  // to just east of Mends Street, then the frontage drops to 3–8 storey flats among trees.
  const out = [];
  const path = [[-780, 760], [-700, 860], [-610, 990], [-480, 1140], [-360, 1260], [-250, 1360], [-188, 1420], [0, 1450], [300, 1480], [800, 1520], [1400, 1560]];
  for (const row of [0, 1, 2]) for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = 6 + rng() * 14;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    while (d < L - 8) {
      const t = d / L;
      const off = -(row === 0 ? 20 + rng() * 10 : row === 1 ? 62 + rng() * 20 : 110 + rng() * 30);   // inland (south) of Mill Point Road
      const x = a[0] + (b[0] - a[0]) * t + Math.sin(ang) * off, z = a[1] + (b[1] - a[1]) * t - Math.cos(ang) * off;
      const w = 16 + rng() * 18, dd = 14 + rng() * 12;
      d += w + 10 + rng() * 22;
      if (Math.abs(x + 190) < 34 && z < 1520) continue;   // Mends Street itself
      const towerZone = x < 60 && x > -760;                // Mill Point → Mends: the high-rise strip
      const r = rng();
      let h;
      if (towerZone) h = row === 0 ? (r < 0.38 ? 45 + rng() * 50 : r < 0.7 ? 20 + rng() * 18 : 9 + rng() * 8) : row === 1 ? (r < 0.15 ? 36 + rng() * 36 : 10 + rng() * 14) : 8 + rng() * 10;
      else h = row === 0 ? (r < 0.15 ? 30 + rng() * 25 : 10 + rng() * 14) : 8 + rng() * 10;
      const tone = 0.7 + rng() * 0.14;
      const b0 = { name: 'South Perth apartments', x, z, rot: ang + (rng() - 0.5) * 0.25, style: rng() < 0.7 ? 'resi' : 'punched', pw: 1.3 + rng() * 0.8, fh: 2.9 + rng() * 0.3,
        frame: [tone, tone * 0.98, tone * 0.93], glass: [GL.grey, GL.dark, GL.teal, GL.clear][Math.floor(rng() * 4)], seed: 60 + out.length };
      b0.tiers = h > 45 && rng() < 0.5 ? [{ w: w * 1.15, d: dd * 1.2, h: 7, style: 'curtain' }, { w, d: dd, cr: rng() < 0.4 ? 5 : 0, h: h * 0.85 }, { w: w * 0.8, d: dd * 0.8, h }] : [{ w, d: dd, cr: rng() < 0.3 ? 4 : 0, h }];
      out.push(b0);
    }
  }
  return out;
}
// CBD infill: a grid of mid-rise office blocks around the named towers so the skyline reads as a dense city
function cbdFill(rng, footprints) {
  const out = []; const styles = ['curtain', 'curtain', 'ribbon', 'punched', 'fins'];
  const glasses = [GL.grey, GL.blue, GL.silver, GL.clear, GL.dark, GL.teal, GL.green];
  const frames = [FR.alu, FR.lightAlu, FR.precast, FR.dark, FR.white, FR.cream];
  const roads = [-36, 125, 260, 400, -180, -320];
  for (let x = -420; x <= 560; x += 46) for (let z = -300; z >= -980; z -= 44) {
    if (roads.some((r) => Math.abs(x - r) < 18)) continue;
    if ([-512, -640, -770, -890].some((r) => Math.abs(z - r) < 20)) continue;
    if (z > -340 && x < 130 && x > -60) continue;                   // keep The Esplanade frontage open
    const jx = x + (rng() - 0.5) * 10, jz = z + (rng() - 0.5) * 10;
    if (NAMED.some((b) => Math.hypot(b.x - jx, b.z - jz) < 46)) continue;
    if (jx < -330 && jz > -620) continue;                           // Kings Park side
    const tall = Math.exp(-Math.hypot(jx - 20, jz + 520) / 380);
    const h = 18 + rng() * 40 + tall * rng() * 90;
    const w = 26 + rng() * 14, d = 22 + rng() * 14;
    const st = styles[Math.floor(rng() * styles.length)];
    out.push({ name: 'office', x: jx, z: jz, style: st, pw: 1.2 + rng() * 1.3, fh: 3.3 + rng() * 0.9,
      frame: frames[Math.floor(rng() * frames.length)], glass: glasses[Math.floor(rng() * glasses.length)], seed: 100 + out.length,
      tiers: rng() < 0.3 ? [{ w, d, h: h * 0.6 }, { w: w * 0.8, d: d * 0.8, h }] : [{ w, d, h, cr: rng() < 0.15 ? 5 : 0 }] });
  }
  return out;
}

export function create(G, { material }) {
  const rng = rngFrom(4207);
  const footprints = [];
  const chunks = new Map();
  const all = [...NAMED, ...cbdFill(rng, footprints), ...SOUTH_PERTH, ...southPerthFill(rng)];
  for (const b of all) {
    const key = Math.floor(b.x / 400) + ',' + Math.floor(b.z / 400);
    if (!chunks.has(key)) chunks.set(key, new Acc());
    addBuilding(chunks.get(key), b, footprints);
  }
  const meshes = [];
  for (const [k, A] of chunks) {
    const m = new Mesh(A.geo(), material); m.name = 'towers-' + k; m.castShadow = true; m.receiveShadow = true; meshes.push(m);
  }
  return { meshes, footprints, buildings: all };
}
export { Acc, rectPts, circlePts, walls, cap, ensureCCW, GL, FR, STYLE };
