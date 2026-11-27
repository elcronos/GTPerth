// Geometry kit: real-scale, bevelled building blocks that output indexed BufferGeometry with
// position / normal / uv / color. UVs are METRIC everywhere (1 uv unit = 1 m) so every texture set
// tiles at the same physical density on every prop. Every primitive bevels its edges (5-12 mm) —
// sharp 90° edges are the #1 "CG" tell; a bevel catches a highlight line from the sun and the env.
//
//   import { Kit, roundedBox, container, crate } from './geo/kit.js';
//   const k = new Kit();
//   k.push(0, 0, 0, 0.3); container(k, { color: 0x2f5d7c }); k.pop();
//   k.push(4, 0, 1); crate(k); k.pop();
//   k.bakeAO({ ground: 0 }); k.grime();            // contact AO between parts + height/streak grime
//   scene.add(k.build({ paint, steel, wood }));    // ONE mesh per material key
//
// Material keys used by the props: paint, steel, wood, rubber, glass, concrete, dark.
// Paint/tint colours go into vertex colours, so one 'paint' material serves every container colour.
import {
  BufferGeometry, BufferAttribute, Float32BufferAttribute, Uint32BufferAttribute, Matrix4, Vector2, Vector3,
  Quaternion, Euler, Color, Mesh, Group, Shape, Path, ExtrudeGeometry, CatmullRomCurve3, ShapeUtils,
} from 'three';
import { fbm3, vnoise3, clamp, sstep, rngFrom } from './noise.js';

const TAU = Math.PI * 2;
const _v = new Vector3(), _v2 = new Vector3(), _c = new Color();

// ------------------------------------------------------------------ geometry plumbing
// Tiny mutable mesh accumulator used by the generators below.
class MD {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  get nv() { return this.p.length / 3; }
  v(x, y, z, nx, ny, nz, u, w, r = 1, g = 1, b = 1) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, w); this.c.push(r, g, b); return this.nv - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); } // a b c d counter-clockwise seen from the front
  geo() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.c, 3));
    g.setIndex(new Uint32BufferAttribute(this.i, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

// Make any geometry merge-compatible: indexed, with normal/uv/color (color defaults to white).
export function normalizeGeo(g) {
  const n = g.attributes.position.count;
  if (!g.index) { const ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new BufferAttribute(ix, 1)); }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.color) g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  g.clearGroups();
  return g;
}

// Concatenate geometries (all normalised) into one. Replaces three/examples mergeGeometries.
export function mergeGeos(list) {
  let nv = 0, ni = 0;
  for (const g of list) { normalizeGeo(g); nv += g.attributes.position.count; ni += g.index.count; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), C = new Float32Array(nv * 3), I = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    P.set(g.attributes.position.array, ov * 3); N.set(g.attributes.normal.array, ov * 3);
    U.set(g.attributes.uv.array, ov * 2); C.set(g.attributes.color.array, ov * 3);
    const ix = g.index.array; for (let k = 0; k < ix.length; k++) I[oi + k] = ix[k] + ov;
    ov += c; oi += ix.length;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(P, 3)); g.setAttribute('normal', new BufferAttribute(N, 3));
  g.setAttribute('uv', new BufferAttribute(U, 2)); g.setAttribute('color', new BufferAttribute(C, 3));
  g.setIndex(new BufferAttribute(I, 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// mergeByMaterial([{geo, mat}] | [Mesh]) → Group with one Mesh per distinct material.
// Geometry of Mesh inputs is baked with its world matrix (call updateMatrixWorld first).
export function mergeByMaterial(list, { castShadow = true, receiveShadow = true } = {}) {
  const by = new Map();
  for (const it of list) {
    let geo = it.geo || it.geometry, mat = it.mat || it.material;
    if (it.isMesh) { geo = geo.clone().applyMatrix4(it.matrixWorld); }
    if (!by.has(mat)) by.set(mat, []);
    by.get(mat).push(geo);
  }
  const grp = new Group();
  for (const [mat, geos] of by) {
    const m = new Mesh(mergeGeos(geos), mat);
    m.castShadow = castShadow; m.receiveShadow = receiveShadow; m.matrixAutoUpdate = false;
    grp.add(m);
  }
  return grp;
}

// ------------------------------------------------------------------ primitives
// Coordinates along one box axis (half extent a) on the outer face: bevel rows use tan() spacing so the
// projected normals sweep evenly through the 45° each face owns; interior rows every `step` m so
// vertex grime/AO have vertices to live on.
function bevelAxis(a, r, seg, step) {
  const ai = a - r, out = [];
  if (r > 0) for (let k = seg; k >= 1; k--) out.push(-ai - r * Math.tan((k / seg) * Math.PI / 4));
  const n = Math.max(1, Math.ceil((2 * ai) / step));
  for (let i = 0; i <= n; i++) out.push(-ai + (2 * ai * i) / n);
  if (r > 0) for (let k = 1; k <= seg; k++) out.push(ai + r * Math.tan((k / seg) * Math.PI / 4));
  return out;
}
const FACES = [ // normal, u axis, v axis (u × v = normal)
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
const axisOf = (v) => (v[0] ? 0 : v[1] ? 1 : 2);

// Rounded box centred on the origin. r = edge radius (default 8 mm), seg = rows per bevel quadrant,
// step = interior subdivision (m). Vertices of the flat box are pushed out from the inner box, so
// edges are true quarter-cylinders and corners true sphere octants, normals exact.
export function roundedBox(w, h, d, r = 0.008, seg = 2, step = 0.6) {
  const half = [w / 2, h / 2, d / 2];
  r = Math.min(r, 0.49 * Math.min(w, h, d));
  if (r <= 0) seg = 0; else seg = Math.max(1, seg);
  const inner = half.map((a) => a - r);
  const md = new MD(), lists = half.map((a) => bevelAxis(a, r, seg, step));
  const p = [0, 0, 0], q = [0, 0, 0];
  for (const [N, U, V] of FACES) {
    const k = axisOf(N), ku = axisOf(U), kv = axisOf(V), su = U[ku], sv = V[kv];
    const Lu = lists[ku], Lv = lists[kv], base = md.nv;
    for (let j = 0; j < Lv.length; j++) for (let i = 0; i < Lu.length; i++) {
      p[k] = N[k] * half[k]; p[ku] = su * Lu[i]; p[kv] = sv * Lv[j];
      let dx = 0, dy = 0, dz = 0;
      for (let a = 0; a < 3; a++) q[a] = clamp(p[a], -inner[a], inner[a]);
      dx = p[0] - q[0]; dy = p[1] - q[1]; dz = p[2] - q[2];
      const l = Math.hypot(dx, dy, dz);
      let nx = N[0], ny = N[1], nz = N[2], x = p[0], y = p[1], z = p[2];
      if (l > 1e-9 && r > 0) { nx = dx / l; ny = dy / l; nz = dz / l; x = q[0] + nx * r; y = q[1] + ny * r; z = q[2] + nz * r; }
      const pos = [x, y, z];
      md.v(x, y, z, nx, ny, nz, su * pos[ku] + half[ku], sv * pos[kv] + half[kv]);
    }
    const nu = Lu.length;
    for (let j = 0; j < Lv.length - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a = base + j * nu + i; md.quad(a, a + 1, a + nu + 1, a + nu);
    }
  }
  return md.geo();
}

// Box with metric UVs and no bevel (for hidden/interior parts).
export const box = (w, h, d, step = 1e9) => roundedBox(w, h, d, 0, 0, step);

// 2D polygon (array of [x,y], any winding) + holes extruded along +Z with a small bevel
// (default 1.4 mm — gun/hardware scale; use 3-8 mm for structural parts). Result centred on z.
export function extrudeBevel(points, { holes = [], depth = 0.05, bevel = 0.0014, bevelSeg = 2, curveSeg = 12 } = {}) {
  const sh = new Shape(points.map(([x, y]) => new Vector2(x, y)));
  for (const h of holes) sh.holes.push(new Path(h.map(([x, y]) => new Vector2(x, y))));
  bevel = Math.min(bevel, depth * 0.45);
  const g = new ExtrudeGeometry(sh, {
    depth: Math.max(1e-4, depth - 2 * bevel), steps: 1, curveSegments: curveSeg,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: bevelSeg,
  });
  g.translate(0, 0, -(depth - 2 * bevel) / 2);
  return normalizeGeo(g);
}
// Circle/regular polygon helper for extrude holes and profiles: n points, CCW.
export const circle = (r, n = 16, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * TAU), cy + r * Math.sin((i / n) * TAU)]);

// Lathe a profile [[r, y], ...] (bottom → top) around Y. Corners sharper than `crease` degrees get
// split normals; smooth runs get averaged normals. UV u = arc length at the widest radius, v = profile length.
export function lathe(profile, { seg = 24, phi0 = 0, phiLen = TAU, crease = 35 } = {}) {
  const n = profile.length, rings = [];
  const segN = (i) => { // outward normal of profile segment i → i+1
    const dx = profile[i + 1][0] - profile[i][0], dy = profile[i + 1][1] - profile[i][1], l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l];
  };
  let arc = 0, rMax = 0;
  const cosC = Math.cos((crease * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    if (i > 0) arc += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
    rMax = Math.max(rMax, profile[i][0]);
    const a = i > 0 ? segN(i - 1) : null, b = i < n - 1 ? segN(i) : null;
    if (a && b && a[0] * b[0] + a[1] * b[1] < cosC) { rings.push({ i, n: a, v: arc }, { i, n: b, v: arc, split: true }); }
    else { const m = a && b ? [a[0] + b[0], a[1] + b[1]] : a || b, l = Math.hypot(m[0], m[1]) || 1; rings.push({ i, n: [m[0] / l, m[1] / l], v: arc }); }
  }
  const md = new MD(), uScale = Math.max(rMax, 1e-3);
  for (const R of rings) {
    const [r, y] = profile[R.i];
    for (let j = 0; j <= seg; j++) {
      const ph = phi0 + (phiLen * j) / seg, s = Math.sin(ph), c = Math.cos(ph);
      md.v(r * s, y, r * c, R.n[0] * s, R.n[1], R.n[0] * c, ph * uScale, R.v);
    }
  }
  const W = seg + 1;
  for (let k = 0; k < rings.length - 1; k++) {
    if (rings[k + 1].split) continue; // zero-height band between split normals
    for (let j = 0; j < seg; j++) { const a = k * W + j; md.quad(a, a + 1, a + W + 1, a + W); }
  }
  return md.geo();
}

// Parallel-transport frames along a polyline (array of Vector3). Returns {T, N, B, L} arrays.
function frames(pts, closed) {
  const n = pts.length, T = [], N = [], B = [], L = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    T.push(new Vector3().subVectors(b, a).normalize());
    if (i > 0) L.push(L[i - 1] + pts[i].distanceTo(pts[i - 1]));
  }
  const up = Math.abs(T[0].y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  N.push(new Vector3().crossVectors(up, T[0]).normalize()); // N horizontal-ish for near-horizontal paths
  for (let i = 1; i < n; i++) {
    const v = N[i - 1].clone().addScaledVector(T[i], -T[i].dot(N[i - 1]));
    if (v.lengthSq() < 1e-10) v.copy(N[i - 1]);
    N.push(v.normalize());
  }
  for (let i = 0; i < n; i++) B.push(new Vector3().crossVectors(T[i], N[i]));
  return { T, N, B, L };
}
const toV3 = (p) => (p.isVector3 ? p.clone() : new Vector3(p[0], p[1], p[2]));

// Sweep a 2D profile (CCW loop of [x,y] in the N/B plane) along a path. opts:
//  closed: path loops; caps: cap open ends (closed profile); smooth: averaged profile normals (tubes) vs
//  flat-shaded profile edges (beams, mouldings); scale(t∈[0,1]) → profile scale (tapering branches);
//  curve: resample the path as a Catmull-Rom spline with `samples` points.
export function sweep(profile, path, { closed = false, caps = true, smooth = false, scale = null, curve = false, samples = 0 } = {}) {
  let pts = path.map(toV3);
  if (curve && pts.length > 2) pts = new CatmullRomCurve3(pts, closed, 'centripetal').getSpacedPoints(samples || pts.length * 8).slice(0, closed ? -1 : undefined);
  const F = frames(pts, closed), np = profile.length, total = F.L[F.L.length - 1] || 1;
  // per-profile-vertex columns: smooth → one column per point; flat → two per point (one per adjacent edge)
  const cols = []; let arc = 0;
  const eN = (i) => { const a = profile[i], b = profile[(i + 1) % np], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
  for (let i = 0; i <= np; i++) {
    const ii = i % np;
    if (i > 0) arc += Math.hypot(profile[ii][0] - profile[i - 1][0], profile[ii][1] - profile[i - 1][1]);
    if (smooth) { const a = eN((ii - 1 + np) % np), b = eN(ii), l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1; cols.push({ p: profile[ii], n: [(a[0] + b[0]) / l, (a[1] + b[1]) / l], u: arc }); }
    else {
      if (i > 0) cols.push({ p: profile[ii], n: eN((ii - 1 + np) % np), u: arc, end: true });
      if (i < np) cols.push({ p: profile[ii], n: eN(ii), u: arc });
    }
  }
  const md = new MD(), W = cols.length, rows = pts.length + (closed ? 1 : 0);
  for (let r = 0; r < rows; r++) {
    const k = r % pts.length, P = pts[k], N = F.N[k], B = F.B[k];
    const t = closed ? r / pts.length : F.L[k] / total, s = scale ? scale(t) : 1;
    const vv = r === pts.length ? total + pts[pts.length - 1].distanceTo(pts[0]) : F.L[k];
    for (const c of cols) {
      const x = c.p[0] * s, y = c.p[1] * s;
      md.v(P.x + N.x * x + B.x * y, P.y + N.y * x + B.y * y, P.z + N.z * x + B.z * y,
        N.x * c.n[0] + B.x * c.n[1], N.y * c.n[0] + B.y * c.n[1], N.z * c.n[0] + B.z * c.n[1], c.u * s, vv);
    }
  }
  for (let r = 0; r < rows - 1; r++) for (let j = 0; j < W - 1; j++) {
    if (!smooth && j % 2 === 1) continue; // flat: columns come in (start,end) pairs per edge
    const a = r * W + j; md.quad(a, a + 1, a + W + 1, a + W);
  }
  if (caps && !closed) {
    const tris = ShapeUtils.triangulateShape(profile.map(([x, y]) => new Vector2(x, y)), []);
    for (const end of [0, pts.length - 1]) {
      const P = pts[end], N = F.N[end], B = F.B[end], T = F.T[end], sg = end === 0 ? -1 : 1;
      const s = scale ? scale(end === 0 ? 0 : 1) : 1, base = md.nv;
      for (const [x0, y0] of profile) { const x = x0 * s, y = y0 * s; md.v(P.x + N.x * x + B.x * y, P.y + N.y * x + B.y * y, P.z + N.z * x + B.z * y, T.x * sg, T.y * sg, T.z * sg, x, y); }
      for (const t of tris) { // earcut orientation is not guaranteed: orient by signed area (CCW = faces +T)
        const [a, b, c] = t, A = profile[a], B = profile[b], Cc = profile[c];
        const ccw = (B[0] - A[0]) * (Cc[1] - A[1]) - (B[1] - A[1]) * (Cc[0] - A[0]) > 0;
        (sg > 0) === ccw ? md.tri(base + a, base + b, base + c) : md.tri(base + a, base + c, base + b);
      }
    }
  }
  return md.geo();
}

// Round tube along a path. radius may be a function r(t) for taper (t = 0..1 along the path).
export function tube(path, radius = 0.03, { radial = 10, closed = false, caps = true, curve = false, samples = 0 } = {}) {
  const r0 = typeof radius === 'function' ? 1 : radius;
  return sweep(circle(r0, radial), path, { closed, caps, smooth: true, curve, samples, scale: typeof radius === 'function' ? radius : null });
}

// Profile strip: a 2D polyline profile [[x, z], ...] (x across, z = out of the wall, +z front) extruded
// up Y over height h. Flat-shaded per segment unless smooth. Used for corrugated/ribbed/panelled sheet.
export function profileStrip(profile, h, { smooth = false, ystep = 0.5, back = 0 } = {}) {
  const md = new MD(), ny = Math.max(1, Math.ceil(h / ystep)), cols = [];
  let arc = 0;
  const eN = (i) => { const a = profile[i], b = profile[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
  for (let i = 0; i < profile.length; i++) {
    if (i > 0) arc += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
    if (smooth) { const a = i > 0 ? eN(i - 1) : eN(i), b = i < profile.length - 1 ? eN(i) : a, l = Math.hypot(a[0] + b[0], a[1] + b[1]); cols.push({ p: profile[i], n: [(a[0] + b[0]) / l, (a[1] + b[1]) / l], u: arc }); }
    else { if (i > 0) cols.push({ p: profile[i], n: eN(i - 1), u: arc }); if (i < profile.length - 1) cols.push({ p: profile[i], n: eN(i), u: arc }); }
  }
  const W = cols.length;
  for (let j = 0; j <= ny; j++) { const y = (h * j) / ny; for (const c of cols) md.v(c.p[0], y, c.p[1], c.n[0], 0, c.n[1], c.u, y); }
  for (let j = 0; j < ny; j++) for (let i = 0; i < W - 1; i += smooth ? 1 : 2) { const a = j * W + i; md.quad(a, a + 1, a + W + 1, a + W); }
  if (back) { // flat back face at z = -back
    const x0 = profile[0][0], x1 = profile[profile.length - 1][0], b = md.nv;
    md.v(x1, 0, -back, 0, 0, -1, 0, 0); md.v(x0, 0, -back, 0, 0, -1, x1 - x0, 0); md.v(x0, h, -back, 0, 0, -1, x1 - x0, h); md.v(x1, h, -back, 0, 0, -1, 0, h);
    md.quad(b, b + 1, b + 2, b + 3);
  }
  return md.geo();
}

// Wall/sheet profiles (x from 0..w, z depth). kind: 'trapezoid' (container/cladding), 'sine'
// (corrugated roofing), 'rib' (standing seam), 'panel' (flat panels with V-groove seams every pitch).
// Each corner gets a 6 mm chamfer so it reads as pressed steel, not paper.
export function sheetProfile(w, { kind = 'trapezoid', pitch = 0.28, depth = 0.036, chamfer = 0.006 } = {}) {
  const pts = [], n = Math.max(1, Math.round(w / pitch)), P = w / n;
  if (kind === 'sine') { const m = n * 8; for (let i = 0; i <= m; i++) { const x = (w * i) / m; pts.push([x, depth * 0.5 * Math.cos((x / P) * TAU)]); } return { pts, smooth: true }; }
  const add = (x, z) => { const l = pts[pts.length - 1]; if (!l || Math.abs(l[0] - x) > 1e-6 || Math.abs(l[1] - z) > 1e-6) pts.push([x, z]); };
  const corner = (x, z, x0, z0, x1, z1) => { // chamfered corner at (x,z) between incoming dir and outgoing dir
    let a = Math.hypot(x - x0, z - z0) || 1, b = Math.hypot(x1 - x, z1 - z) || 1;
    add(x - ((x - x0) / a) * chamfer, z - ((z - z0) / a) * chamfer); add(x + ((x1 - x) / b) * chamfer, z + ((z1 - z) / b) * chamfer);
  };
  for (let i = 0; i < n; i++) {
    const x = i * P;
    if (kind === 'trapezoid') { // outer flat 38%, slopes 12%, inner flat 38%
      const k = [[x, depth / 2], [x + P * 0.38, depth / 2], [x + P * 0.5, -depth / 2], [x + P * 0.88, -depth / 2], [x + P, depth / 2]];
      if (i === 0) add(k[0][0], k[0][1]);
      for (let j = 1; j < 4; j++) corner(k[j][0], k[j][1], k[j - 1][0], k[j - 1][1], k[j + 1][0], k[j + 1][1]);
      if (i === n - 1) add(k[4][0], k[4][1]);
    } else if (kind === 'rib') { // flat with a 30 mm standing rib
      const rw = 0.03;
      const k = [[x, 0], [x + P / 2 - rw, 0], [x + P / 2 - rw * 0.6, depth], [x + P / 2 + rw * 0.6, depth], [x + P / 2 + rw, 0], [x + P, 0]];
      if (i === 0) add(k[0][0], k[0][1]);
      for (let j = 1; j < 5; j++) corner(k[j][0], k[j][1], k[j - 1][0], k[j - 1][1], k[j + 1][0], k[j + 1][1]);
      if (i === n - 1) add(k[5][0], k[5][1]);
    } else { // panel: V groove at each seam
      const g = 0.012;
      const k = [[x, 0], [x + P - g, 0], [x + P, -depth], [x + P + g, 0]];
      if (i === 0) add(k[0][0], k[0][1]);
      if (i < n - 1) { corner(k[1][0], k[1][1], k[0][0], k[0][1], k[2][0], k[2][1]); add(k[2][0], k[2][1]); corner(k[3][0], k[3][1], k[2][0], k[2][1], x + P + 0.1, 0); }
      else add(x + P, 0);
    }
  }
  return { pts, smooth: false };
}
// Wall panel w×h, front face +Z, x from 0..w, y from 0..h.
export function panelWall(w, h, opts = {}) {
  const { pts, smooth } = sheetProfile(w, opts);
  return profileStrip(pts, h, { smooth, ystep: opts.ystep || 0.5, back: opts.back ?? (opts.depth ?? 0.036) / 2 + 0.002 });
}

// ------------------------------------------------------------------ the Kit builder
// Matrix stack + per-material buckets + part registry (for contact AO).
export class Kit {
  constructor() { this.buckets = new Map(); this.stack = [new Matrix4()]; this.parts = []; this.tint = null; }
  get m() { return this.stack[this.stack.length - 1]; }
  // push(x,y,z, ry, rx, rz [radians]) → composes onto the current matrix
  push(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) {
    const m = new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz, 'YXZ')), new Vector3(s, s, s));
    this.stack.push(this.m.clone().multiply(m)); return this;
  }
  pushMatrix(m) { this.stack.push(this.m.clone().multiply(m)); return this; }
  pop() { if (this.stack.length > 1) this.stack.pop(); return this; }
  // add geometry under the current matrix. o: {at:[x,y,z], rot:[rx,ry,rz], color, occ}
  // occ: occluder shape for bakeAO in LOCAL space: 'box' (bounding box) | false | {r, y0, y1} cylinder
  add(geo, mat = 'default', o = {}) {
    normalizeGeo(geo);
    const lm = new Matrix4();
    if (o.at || o.rot) lm.compose(new Vector3(...(o.at || [0, 0, 0])), new Quaternion().setFromEuler(new Euler(...(o.rot || [0, 0, 0]), 'YXZ')), new Vector3(1, 1, 1));
    const M = this.m.clone().multiply(lm);
    const col = o.color ?? this.tint;
    if (col != null) {
      _c.set(col); const c = geo.attributes.color.array;
      for (let i = 0; i < c.length; i += 3) { c[i] *= _c.r; c[i + 1] *= _c.g; c[i + 2] *= _c.b; }
    }
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (o.occ !== false) this.parts.push({ inv: M.clone().invert(), bb: geo.boundingBox.clone(), cyl: o.occ && o.occ.r ? o.occ : null, wbb: geo.boundingBox.clone().applyMatrix4(M) });
    geo.applyMatrix4(M);
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(geo);
    return geo;
  }
  // convenience wrappers (centred on `at`)
  box(w, h, d, mat, o = {}) { // seg: 2 rows per bevel quadrant for r ≥ 8 mm, else 1 (small bevels need no more)
    const r = o.r ?? 0.008; return this.add(roundedBox(w, h, d, r, o.seg ?? (r >= 0.008 ? 2 : 1), o.step ?? 0.6), mat, o);
  }
  cyl(r, h, mat, o = {}) { // capped cylinder with bevelled rims, base at at.y - h/2
    const b = Math.min(o.bevel ?? 0.004, r * 0.3, h * 0.3), y0 = -h / 2;
    return this.add(lathe([[0, y0], [r - b, y0], [r, y0 + b], [r, -y0 - b], [r - b, -y0], [0, -y0]], { seg: o.seg || 16, crease: 30 }), mat, { ...o, occ: { r, y0, y1: -y0 } });
  }
  tube(path, r, mat, o = {}) { return this.add(tube(path, r, o), mat, { ...o, occ: false }); }
  bar(a, b, w, h, mat, o = {}) { // rounded bar between two points a→b (w across, h up)
    const A = new Vector3(...a), B = new Vector3(...b), L = A.distanceTo(B);
    const g = roundedBox(w, h, L, o.r ?? 0.004, 2, o.step ?? 0.6);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), B.clone().sub(A).normalize());
    const m = new Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new Vector3(1, 1, 1));
    this.pushMatrix(m); const r = this.add(g, mat, o); this.pop(); return r;
  }
  // Contact ambient occlusion between parts (and the ground plane y = ground), baked to vertex colour.
  // For each vertex, `samples` cosine-hemisphere probes at up to `radius` m; a probe inside another
  // part's box/cylinder (or below ground) counts as occluded. ~0.2 s per 100k verts at 10 samples.
  bakeAO({ radius = 0.35, samples = 10, strength = 0.75, ground = null, cell = 1.0, keys = null } = {}) {
    const grid = new Map(), key = (x, y, z) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
    this.parts.forEach((pt, i) => {
      const a = pt.wbb.min, b = pt.wbb.max;
      for (let x = Math.floor(a.x / cell); x <= Math.floor(b.x / cell); x++) for (let y = Math.floor(a.y / cell); y <= Math.floor(b.y / cell); y++) for (let z = Math.floor(a.z / cell); z <= Math.floor(b.z / cell); z++) {
        const k = key(x, y, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
      }
    });
    const dirs = []; // fixed cosine-weighted hemisphere set around +Z, rotated per vertex
    for (let i = 0; i < samples; i++) { const u = (i + 0.5) / samples, ph = i * 2.39996, r = Math.sqrt(u); dirs.push([r * Math.cos(ph), r * Math.sin(ph), Math.sqrt(1 - u), 0.35 + 0.65 * ((i * 0.618) % 1)]); }
    const p = new Vector3(), n = new Vector3(), t = new Vector3(), bt = new Vector3(), s = new Vector3(), l = new Vector3();
    const inside = (pt, w) => {
      l.copy(w).applyMatrix4(pt.inv);
      if (pt.cyl) return l.y > pt.cyl.y0 && l.y < pt.cyl.y1 && l.x * l.x + l.z * l.z < pt.cyl.r * pt.cyl.r;
      return pt.bb.containsPoint(l);
    };
    for (const [mk, geos] of this.buckets) {
      if (keys && !keys.includes(mk)) continue;
      for (const g of geos) {
        const P = g.attributes.position.array, N = g.attributes.normal.array, C = g.attributes.color.array;
        for (let v = 0; v < P.length / 3; v++) {
          p.fromArray(P, v * 3); n.fromArray(N, v * 3);
          p.addScaledVector(n, 0.004); // step off the surface so the own part (convex) never self-occludes
          t.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize(); bt.crossVectors(n, t);
          const rot = (v * 0.7548) % 1 * TAU, cr = Math.cos(rot), sr = Math.sin(rot);
          let occ = 0;
          for (const d of dirs) {
            const dx = d[0] * cr - d[1] * sr, dy = d[0] * sr + d[1] * cr, dist = d[3] * radius;
            s.copy(p).addScaledVector(t, dx * dist).addScaledVector(bt, dy * dist).addScaledVector(n, d[2] * dist);
            if (ground !== null && s.y < ground) { occ++; continue; }
            const cand = grid.get(key(Math.floor(s.x / cell), Math.floor(s.y / cell), Math.floor(s.z / cell)));
            if (cand) for (const i of cand) if (inside(this.parts[i], s)) { occ++; break; }
          }
          const ao = 1 - strength * (occ / samples);
          C[v * 3] *= ao; C[v * 3 + 1] *= ao; C[v * 3 + 2] *= ao;
        }
      }
    }
    return this;
  }
  // Apply vertexGrime to every bucket (or only `keys`).
  grime(opts = {}, keys = null) { for (const [k, geos] of this.buckets) if (!keys || keys.includes(k)) for (const g of geos) vertexGrime(g, opts); return this; }
  // Build → Group with one Mesh per material key. mats: { key: Material }. Unknown keys use mats.default.
  build(mats, { castShadow = true, receiveShadow = true } = {}) {
    const grp = new Group();
    for (const [k, geos] of this.buckets) {
      const mat = mats[k] || mats.default; if (!mat) throw new Error('kit: no material for key ' + k);
      const m = new Mesh(mergeGeos(geos), mat); m.name = 'kit:' + k;
      m.castShadow = castShadow; m.receiveShadow = receiveShadow; m.matrixAutoUpdate = false;
      grp.add(m);
    }
    return grp;
  }
}

// Bake AO-ish darkening/grime into vertex colours (multiplies). Either pass fn(p, n) → multiplier
// (number or [r,g,b]), or options for the default recipe:
//   base: ground height; foot: dirt band height (m); down: darkening of down-facing faces;
//   streak: vertical rain-streak grime on walls; dirt: dirt colour multiplier; scale: noise scale (1/m).
export function vertexGrime(geo, fn = {}) {
  const P = geo.attributes.position.array, N = geo.attributes.normal.array, C = geo.attributes.color.array;
  const o = typeof fn === 'function' ? null : { base: 0, foot: 0.45, down: 0.35, streak: 0.35, dirt: [0.62, 0.55, 0.45], scale: 1.0, seed: 3, ...fn };
  for (let v = 0; v < P.length / 3; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    let r, g, b;
    if (!o) { const m = fn(x, y, z, nx, ny, nz); if (typeof m === 'number') r = g = b = m; else [r, g, b] = m; }
    else {
      const h = y - o.base;
      const foot = (1 - sstep(0, o.foot, h)) * (0.6 + 0.4 * fbm3(x * 3 * o.scale, y * 3, z * 3 * o.scale, 3, o.seed)); // splash dirt band
      const dn = Math.max(0, -ny) * o.down;                                       // underside occlusion
      const vert = 1 - Math.abs(ny);                                               // walls only
      const st = vert * o.streak * sstep(0.45, 0.8, vnoise3(x * 6 * o.scale + z * 6 * o.scale, y * 0.35, 0, o.seed + 9)) * (0.5 + 0.5 * sstep(0.2, 2.5, h)); // streaks run down from tops
      const blot = 0.88 + 0.12 * fbm3(x * 0.9 * o.scale, y * 0.9, z * 0.9 * o.scale, 3, o.seed + 4); // macro value variation
      const dk = (1 - dn) * (1 - st * 0.55) * blot;
      r = dk * (1 - foot * (1 - o.dirt[0])); g = dk * (1 - foot * (1 - o.dirt[1])); b = dk * (1 - foot * (1 - o.dirt[2]));
    }
    C[v * 3] *= r; C[v * 3 + 1] *= g; C[v * 3 + 2] *= b;
  }
  geo.attributes.color.needsUpdate = true;
  return geo;
}

// ------------------------------------------------------------------ props (real dimensions, base at y=0)
// All props write into a Kit at its current matrix. `o.color` tints paint/vertex colour.

// I-beam profile (IPE-like): h height, b flange width, tw web, tf flange, along +Z, length L. Centred.
export function iBeamGeo(L, { h = 0.3, b = 0.15, tw = 0.0071, tf = 0.0107, bevel = 0.0025 } = {}) {
  const x = b / 2, y = h / 2, w = tw / 2;
  const pts = [[-x, -y], [x, -y], [x, -y + tf], [w, -y + tf], [w, y - tf], [x, y - tf], [x, y], [-x, y], [-x, y - tf], [-w, y - tf], [-w, -y + tf], [-x, -y + tf]];
  return extrudeBevel(pts, { depth: L, bevel });
}
export function girder(k, L, o = {}) { // horizontal I-beam along X, bottom at y=0
  const h = o.h || 0.3; k.add(iBeamGeo(L, o), o.mat || 'steel', { at: [0, h / 2, 0], rot: [0, Math.PI / 2, 0], color: o.color });
}
// Lattice girder (Warren truss) along X: two box chords + diagonal bars. L length, h height.
export function latticeGirder(k, L, { h = 0.6, w = 0.08, bay = 0.6, mat = 'steel', color } = {}) {
  k.bar([-L / 2, w / 2, 0], [L / 2, w / 2, 0], w, w, mat, { color }); k.bar([-L / 2, h - w / 2, 0], [L / 2, h - w / 2, 0], w, w, mat, { color });
  const n = Math.max(1, Math.round(L / bay));
  for (let i = 0; i < n; i++) {
    const x0 = -L / 2 + (L * i) / n, x1 = -L / 2 + (L * (i + 1)) / n, up = i % 2 === 0;
    k.bar([x0, up ? w : h - w, 0], [x1, up ? h - w : w, 0], w * 0.55, w * 0.55, mat, { color });
  }
}

// Pipe run with real elbows (bend radius = 1.5 D default) and flanges at the ends/every `flangeEvery` m.
export function pipeRun(k, points, { r = 0.08, bend = 3 * r, flangeEvery = 6, mat = 'steel', color, radial = 16 } = {}) {
  const P = points.map(toV3), path = [P[0]];
  for (let i = 1; i < P.length - 1; i++) { // replace each corner by a circular arc tangent to both legs
    const a = P[i - 1], c = P[i], b = P[i + 1];
    const d0 = c.clone().sub(a).normalize(), d1 = b.clone().sub(c).normalize(), ang = Math.acos(clamp(d0.dot(d1), -1, 1));
    if (ang < 1e-3) { path.push(c); continue; }
    const t = bend * Math.tan(ang / 2), s0 = c.clone().addScaledVector(d0, -t), s1 = c.clone().addScaledVector(d1, t);
    const steps = Math.max(4, Math.ceil(ang / 0.15));
    for (let j = 0; j <= steps; j++) { // quadratic Bezier through the corner ≈ circular arc (good to <1% at 90°)
      const u = j / steps, w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
      path.push(new Vector3().addScaledVector(s0, w0).addScaledVector(c, w1).addScaledVector(s1, w2));
    }
  }
  path.push(P[P.length - 1]);
  k.add(tube(path, r, { radial }), mat, { color, occ: false });
  // flanges: lathe discs placed on straight legs
  const fl = lathe([[r * 0.98, -0.012], [r * 1.65, -0.012], [r * 1.7, -0.008], [r * 1.7, 0.008], [r * 1.65, 0.012], [r * 0.98, 0.012]], { seg: radial + 4, crease: 30 });
  const place = (pos, dir) => {
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
    k.pushMatrix(new Matrix4().compose(pos, q, new Vector3(1, 1, 1))); k.add(fl.clone(), mat, { color, occ: false }); k.pop();
  };
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], d = b.clone().sub(a), L = d.length(); d.normalize();
    const n = Math.floor(L / flangeEvery);
    if (i === 0) place(a.clone().addScaledVector(d, 0.012), d);
    if (i === P.length - 2) place(b.clone().addScaledVector(d, -0.012), d);
    for (let j = 1; j <= n; j++) if (j * flangeEvery < L - 0.5) place(a.clone().addScaledVector(d, j * flangeEvery), d);
  }
}

// Steel stair along +Z rising +Y: n steps of rise×run, width w; chequer-plate treads, channel stringers.
export function stairs(k, { n = 8, rise = 0.18, run = 0.27, w = 0.9, mat = 'steel', color, rails = true } = {}) {
  const H = n * rise, L = n * run, sw = 0.012, sh = 0.2;
  for (let i = 0; i < n; i++) k.box(w - 2 * sw, 0.03, run + 0.02, mat, { at: [0, (i + 1) * rise - 0.015, i * run + run / 2], color });
  const ang = Math.atan2(H, L), sl = Math.hypot(H, L);
  for (const sx of [-1, 1]) {
    k.push(sx * (w / 2 - sw / 2), H / 2 - sh * 0.3, L / 2, 0, -ang);
    k.box(sw, sh, sl + 0.2, mat, { color, r: 0.003 }); k.pop();
  }
  if (rails) for (const sx of [-1, 1]) railing(k, [[sx * (w / 2 + 0.03), rise, 0.1], [sx * (w / 2 + 0.03), H, L]], { h: 0.95, postEvery: 1.2, mat, color, toe: false });
}

// Handrail along a polyline of floor points (top rail at h, knee rail at h/2, posts, toe board).
export function railing(k, points, { h = 1.1, postEvery = 1.5, r = 0.022, mat = 'steel', color, toe = true } = {}) {
  const P = points.map(toV3), up = (y) => P.map((p) => new Vector3(p.x, p.y + y, p.z));
  k.add(tube(up(h), r, { radial: 10 }), mat, { color, occ: false });
  k.add(tube(up(h * 0.5), r * 0.8, { radial: 8 }), mat, { color, occ: false });
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], L = a.distanceTo(b), n = Math.max(1, Math.ceil(L / postEvery));
    for (let j = 0; j <= n; j++) {
      if (j === n && i < P.length - 2) continue;
      const p = a.clone().lerp(b, j / n);
      k.add(tube([p, new Vector3(p.x, p.y + h + r, p.z)], r, { radial: 10 }), mat, { color, occ: false });
    }
    if (toe) k.bar([a.x, a.y + 0.05, a.z], [b.x, b.y + 0.05, b.z], 0.006, 0.1, mat, { color, r: 0.002 });
  }
}

// Fence along X from 0..L. kind 'palisade' (pointed steel pales) | 'rail' (pipe rails).
export function fence(k, L, { h = 2.0, kind = 'palisade', postEvery = 2.75, mat = 'steel', color } = {}) {
  const n = Math.max(1, Math.round(L / postEvery)), seg = L / n;
  for (let i = 0; i <= n; i++) k.box(0.08, h + 0.05, 0.08, mat, { at: [i * seg, (h + 0.05) / 2, 0], color, r: 0.004 });
  if (kind === 'rail') { for (const y of [h * 0.35, h * 0.95]) k.add(tube([[0, y, 0.06], [L, y, 0.06]], 0.024), mat, { color, occ: false }); return; }
  for (const y of [0.35, h - 0.35]) k.box(L, 0.05, 0.05, mat, { at: [L / 2, y, 0.065], color, r: 0.003 });
  // W-section pale: extrude the outline of a pale front view (3 points on top) and stand it up
  const pw = 0.068, pale = extrudeBevel([[-pw / 2, 0], [pw / 2, 0], [pw / 2, h - 0.06], [pw / 4, h - 0.02], [0, h], [-pw / 4, h - 0.02], [-pw / 2, h - 0.06]], { depth: 0.012, bevel: 0.002 });
  const np = Math.floor(L / 0.13);
  for (let i = 0; i < np; i++) k.add(pale.clone(), mat, { at: [((i + 0.5) * L) / np, 0.02, 0.1], color });
}

// Fixed ladder (rails flat bar, round rungs every 0.28 m), height h, width w, against -Z.
export function ladder(k, h, { w = 0.45, mat = 'steel', color, cage = false } = {}) {
  for (const sx of [-1, 1]) k.box(0.012, h, 0.065, mat, { at: [sx * w / 2, h / 2, 0], color, r: 0.003 });
  for (let y = 0.28; y < h - 0.05; y += 0.28) k.add(tube([[-w / 2, y, 0], [w / 2, y, 0]], 0.0125, { radial: 8 }), mat, { color, occ: false });
  if (cage) for (let y = 2.2; y < h; y += 0.9) {
    const arc = []; for (let i = 0; i <= 12; i++) { const a = Math.PI * (i / 12); arc.push([Math.cos(a) * (w / 2 + 0.05), y, -Math.sin(a) * 0.7 + 0.0]); }
    k.add(sweep([[-0.025, -0.004], [0.025, -0.004], [0.025, 0.004], [-0.025, 0.004]], arc), mat, { color, occ: false });
  }
}

// Wooden crate w×h×d: planked sides with gaps, edge battens, diagonal brace, dark core behind gaps.
export function crate(k, { w = 1.0, h = 0.8, d = 0.8, mat = 'wood', color = 0xc8a070, seed = 1 } = {}) {
  const rnd = rngFrom(seed), pt = 0.018, pw = 0.12, gap = 0.008;
  k.box(w - 2 * pt, h - 2 * pt, d - 2 * pt, mat, { at: [0, h / 2, 0], color: 0x3a2a1c, r: 0.002 }); // dark interior
  const plankCol = () => _c.set(color).multiplyScalar(0.8 + 0.35 * rnd()).getHex();
  const side = (len, ht, place) => { const n = Math.max(1, Math.round(ht / (pw + gap))), ph = ht / n - gap; for (let i = 0; i < n; i++) place(gap / 2 + i * (ph + gap) + ph / 2, ph, len); };
  side(w, h, (y, ph) => { for (const sz of [-1, 1]) k.box(w - 0.004, ph, pt, mat, { at: [0, y, sz * (d / 2 - pt / 2)], color: plankCol(), r: 0.003 }); });
  side(d, h, (y, ph) => { for (const sx of [-1, 1]) k.box(pt, ph, d - 2 * pt, mat, { at: [sx * (w / 2 - pt / 2), y, 0], color: plankCol(), r: 0.003 }); });
  { const n = Math.round(d / (pw + gap)), ph = d / n - gap; for (let i = 0; i < n; i++) k.box(w - 0.004, pt, ph, mat, { at: [0, h - pt / 2, -d / 2 + gap / 2 + i * (ph + gap) + ph / 2], color: plankCol(), r: 0.003 }); }
  const bt = 0.022, bw = 0.07; // battens on the outside of the w faces
  for (const sz of [-1, 1]) {
    const z = sz * (d / 2 + bt / 2);
    for (const sx of [-1, 1]) k.box(bw, h, bt, mat, { at: [sx * (w / 2 - bw / 2), h / 2, z], color: plankCol(), r: 0.004 });
    for (const y of [bw / 2, h - bw / 2]) k.box(w - 2 * bw, bw, bt, mat, { at: [0, y, z], color: plankCol(), r: 0.004 });
    k.bar([-w / 2 + bw, bw, z], [w / 2 - bw, h - bw, z], bw * 0.9, bt * 0.9, mat, { color: plankCol(), r: 0.004 });
  }
}

// 200 L steel drum: Ø 572 mm × 851 mm, two rolling hoops, chime rims, bung caps on the lid.
export function barrel(k, { mat = 'paint', color = 0x8a2a1e, seg = 28 } = {}) {
  const R = 0.286, H = 0.851, h1 = H / 3, h2 = (2 * H) / 3, hb = 0.012, hw = 0.022;
  const hoop = (y) => [[R, y - hw], [R + hb * 0.5, y - hw * 0.5], [R + hb * 0.6, y], [R + hb * 0.5, y + hw * 0.5], [R, y + hw]];
  const prof = [[0, 0.012], [R - 0.012, 0.012], [R - 0.004, 0], [R + 0.004, 0.004], [R + 0.006, 0.016], [R, 0.03], ...hoop(h1), ...hoop(h2), [R, H - 0.03], [R + 0.006, H - 0.016], [R + 0.004, H - 0.004], [R - 0.004, H], [R - 0.012, H - 0.012], [R - 0.02, H - 0.016], [0, H - 0.016]];
  k.add(lathe(prof, { seg, crease: 50 }), mat, { color, occ: { r: R, y0: 0, y1: H } });
  for (const [x, z, rr] of [[0.17, 0.06, 0.03], [-0.15, -0.09, 0.022]]) k.cyl(rr, 0.014, 'steel', { at: [x, H - 0.012, z], seg: 12 });
}

// EUR pallet 1200×800×144 mm: 3 bottom boards, 9 blocks, 3 stringer boards, 5 top boards.
export function pallet(k, { mat = 'wood', color = 0xb89a72, seed = 2 } = {}) {
  const rnd = rngFrom(seed), col = () => _c.set(color).multiplyScalar(0.82 + 0.3 * rnd()).getHex(), t = 0.022;
  for (const z of [-0.3275, 0, 0.3275]) k.box(1.2, t, z === 0 ? 0.145 : 0.1, mat, { at: [0, t / 2, z], color: col(), r: 0.003 });
  for (const x of [-0.5275, 0, 0.5275]) for (const z of [-0.3275, 0, 0.3275]) k.box(0.145, 0.078, z === 0 ? 0.145 : 0.1, mat, { at: [x, t + 0.039, z], color: col(), r: 0.004 });
  for (const x of [-0.5275, 0, 0.5275]) k.box(0.145, t, 0.8, mat, { at: [x, t + 0.078 + t / 2, 0], color: col(), r: 0.003 });
  const tops = [[-0.3275, 0.145], [-0.17, 0.1], [0, 0.145], [0.17, 0.1], [0.3275, 0.145]];
  for (const [z, w] of tops) k.box(1.2, t, w, mat, { at: [0, 0.144 - t / 2, z], color: col(), r: 0.003 });
}

// ISO-style shipping box (generic; no branding): len 6.058 (20') or 12.192 (40') × 2.438 × 2.591 m.
// Trapezoid-corrugated sides and front, shallow-corrugated roof, corner posts, rails, corner castings,
// door end at +X with 4 lock bars, handles and cam keepers.
export function container(k, { len = 6.058, w = 2.438, h = 2.591, color = 0x2f5d7c, mat = 'paint', hw = 'steel' } = {}) {
  const cp = 0.16, rail = 0.16, hx = len / 2, hz = w / 2;
  const C = color;
  // side walls (+Z / -Z): corrugated sheet between posts and rails
  const sl = len - 2 * cp, sh = h - 2 * rail;
  for (const sz of [1, -1]) {
    k.push(sz > 0 ? -sl / 2 : sl / 2, rail, sz * (hz - 0.03), sz > 0 ? 0 : Math.PI);
    k.add(panelWall(sl, sh, { kind: 'trapezoid', pitch: 0.278, depth: 0.036, ystep: 0.6 }), mat, { color: C }); k.pop();
  }
  // front end (-X) corrugated
  k.push(-hx + 0.03, rail, -(hz - cp), -Math.PI / 2); k.add(panelWall(w - 2 * cp, sh, { kind: 'trapezoid', pitch: 0.25, depth: 0.04 }), mat, { color: C }); k.pop();
  // roof: shallow sine corrugation along X, sheet facing up
  k.push(-hx + cp, h - 0.045, hz - 0.05, 0, -Math.PI / 2); // sheet x → length, sheet y → -Z, front → +Y
  k.add(panelWall(len - 2 * cp, w - 0.1, { kind: 'sine', pitch: 0.35, depth: 0.018, ystep: 0.8, back: 0 }), mat, { color: C, occ: false }); k.pop();
  k.box(len - 0.1, 0.03, w - 0.1, 'dark', { at: [0, 0.12, 0], occ: false }); // floor
  // frame: corner posts, top/bottom side rails, end rails
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(cp, h, cp, mat, { at: [sx * (hx - cp / 2), h / 2, sz * (hz - cp / 2)], color: C, r: 0.01 });
  for (const sz of [-1, 1]) { k.box(len - 2 * cp, rail * 0.75, 0.1, mat, { at: [0, h - rail * 0.375, sz * (hz - 0.05)], color: C, r: 0.01 }); k.box(len - 2 * cp, rail, 0.12, mat, { at: [0, rail / 2, sz * (hz - 0.06)], color: C, r: 0.01 }); }
  for (const sx of [-1, 1]) { k.box(cp, rail, w - 2 * cp, mat, { at: [sx * (hx - cp / 2), h - rail / 2, 0], color: C, r: 0.01 }); k.box(cp, rail * 1.3, w - 2 * cp, mat, { at: [sx * (hx - cp / 2), rail * 0.65, 0], color: C, r: 0.01 }); }
  // corner castings (darker, slightly proud)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0.059, h - 0.059]) k.box(0.178, 0.118, 0.162, mat, { at: [sx * (hx - 0.089 + 0.004), y, sz * (hz - 0.081 + 0.004)], color: _c.set(C).multiplyScalar(0.7).getHex(), r: 0.012 });
  // doors at +X: two leaves with vertical pressed panels, lock bars
  const dw = (w - 2 * cp) / 2, dh = sh;
  for (const sd of [-1, 1]) {
    k.push(hx - 0.02, rail, sd > 0 ? dw + 0.002 : -0.002, Math.PI / 2); // sheet x → -Z
    k.add(panelWall(dw, dh, { kind: 'rib', pitch: dw / 4, depth: 0.025 }), mat, { color: C }); k.pop();
    const z0 = sd * (dw * 0.5);
    for (const f of [0.22, 0.78]) {
      const z = z0 + sd * (f - 0.5) * dw * 0.8, x = hx + 0.03;
      k.add(tube([[x, rail + 0.04, z], [x, h - rail - 0.04, z]], 0.017, { radial: 10 }), hw, { occ: false });
      for (const y of [rail + 0.08, h - rail - 0.08]) k.box(0.05, 0.07, 0.07, hw, { at: [x - 0.01, y, z], r: 0.006 });
      for (const y of [0.5, 1.2, 1.9]) k.box(0.025, 0.03, 0.06, hw, { at: [x - 0.012, y + rail, z], r: 0.004 });
      k.add(tube([[x + 0.01, 1.05, z], [x + 0.06, 1.05, z], [x + 0.06, 1.05, z + sd * 0.32]], 0.012, { radial: 8 }), hw, { occ: false });
    }
    for (const y of [0.5, h * 0.5, h - 0.5]) k.box(0.02, 0.14, 0.05, hw, { at: [hx + 0.005, y, sd * (dw - 0.06)], r: 0.004 }); // hinges
  }
}

// Window frame w×h (opening) in the XY plane, facing +Z: frame of profile depth, mullions, glass,
// sill. Keys: frame mat (default 'paint'), 'glass'.
export function windowFrame(k, w, h, { depth = 0.1, f = 0.06, cols = 2, rows = 2, mat = 'paint', color = 0xd8d4cc, glass = true, sill = true } = {}) {
  k.box(w + 2 * f, f, depth, mat, { at: [0, h + f / 2, 0], color, r: 0.006 });
  k.box(w + 2 * f, f, depth, mat, { at: [0, -f / 2, 0], color, r: 0.006 });
  for (const sx of [-1, 1]) k.box(f, h, depth, mat, { at: [sx * (w / 2 + f / 2), h / 2, 0], color, r: 0.006 });
  const m = f * 0.5;
  for (let i = 1; i < cols; i++) k.box(m, h, depth * 0.7, mat, { at: [-w / 2 + (w * i) / cols, h / 2, 0], color, r: 0.004 });
  for (let j = 1; j < rows; j++) k.box(w, m, depth * 0.7, mat, { at: [0, (h * j) / rows, 0], color, r: 0.004 });
  if (glass) k.box(w, h, 0.006, 'glass', { at: [0, h / 2, -0.01], r: 0, occ: false });
  if (sill) k.box(w + 2 * f + 0.08, 0.04, depth + 0.08, 'concrete', { at: [0, -f - 0.02, 0.04], color: 0xb0aaa0, r: 0.008 });
}

// Utility: random-but-plausible paint colours for containers (desaturated industrial palette, sRGB hex).
export const PAINT = [0x2f5d7c, 0x8a2f24, 0x6f7a3a, 0xb8862e, 0x3e4b55, 0x9a5a2a, 0x2c6a5c, 0x7b2f3e, 0xc8c2b4, 0x556b7a];
