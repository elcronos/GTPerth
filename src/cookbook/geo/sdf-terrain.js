/*! Portions adapted from MIT-licensed code, Copyright (c) 2026 Maksymilian Dendura. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
// Terrain builders.
//  A) SDF volume terrain (overhangs, arches, caves): density from primitives with smooth min/max,
//     domain-warped fbm and strata → flood-fill out specks → surface nets → one Mesh per XZ culling cell.
//     Pattern adapted from MIT-licensed code, Copyright (c) 2026 Maksymilian Dendura (see THIRD_PARTY_NOTICES.md); CPU-evaluated here (no compute in WebGL2).
//  B) Heightfield terrain (fast, most games): erosion-ish fbm (derivative-damped, IQ style) + ridges,
//     flattened play areas, chunked into cells, exact heightAt() for prop placement.
//
//   const T = terrain({ size: 240, res: 1, fn: erodedHeight({ amp: 14, flats: [{ x: 0, z: 0, r: 30, h: 0 }] }) });
//   scene.add(T.group); T.heightAt(x, z); T.normalAt(x, z, outV3);
//
// Both put metric UVs (world x,z) and a cavity/AO multiplier in vertex colour (r=g=b), plus slope in
// nothing extra: materials read the normal. Load-time only.
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Mesh, Group, Vector3 } from 'three';
import { patch, after } from '../engine/patch.js';
import { surfaceNets, sampler3, floodFillSolid } from './surface-nets.js';
import { fbm2, fbm3, vnoise3, ridged2, ihash, clamp, mix, sstep } from './noise.js';

// ------------------------------------------------------------------ SDF primitives (negative inside)
export const sdSphere = (x, y, z, c, r) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r;
export const sdBox = (x, y, z, c, h, r = 0) => {
  const qx = Math.abs(x - c[0]) - h[0] + r, qy = Math.abs(y - c[1]) - h[1] + r, qz = Math.abs(z - c[2]) - h[2] + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};
export const sdCapsule = (x, y, z, a, b, r) => {
  const pax = x - a[0], pay = y - a[1], paz = z - a[2], bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = clamp((pax * bax + pay * bay + paz * baz) / Math.max(bax * bax + bay * bay + baz * baz, 1e-6), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
};
// torus in the plane given by axis 'y' (lying) or 'z' (standing arch), major R, minor r
export const sdTorus = (x, y, z, c, R, r, axis = 'z') => {
  const dx = x - c[0], dy = y - c[1], dz = z - c[2];
  const q = axis === 'y' ? Math.hypot(dx, dz) - R : Math.hypot(dx, dy) - R;
  return Math.hypot(q, axis === 'y' ? dy : dz) - r;
};
// polynomial smooth min/max (k = blend width in metres)
export const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };

// Density function from a spec. Returns f(x,y,z) → density (>0 solid), in metres (SDF-like).
//  ground: {y, amp, freq} column heightfield (cached per column, so cheap), or {fn(x,z)} to sit the volume on
//          an existing heightfield (e.g. terrain().heightAt, lowered ~0.3 m so the two surfaces never z-fight)
//  warp:   {amp, freq}   2D domain warp of the ground and the primitives
//  prims:  [{type:'capsule'|'sphere'|'box'|'torus', a,b,r | c,r | c,h | c,R,r,axis, op:'add'|'sub', k}]
//  rough:  {amp, freq}   3D fbm displacement, only evaluated within `band` m of the surface
//  strata: {amp, freq}   horizontal ledges abs(fract(y·f)-.5) — reads as sedimentary rock
export function sdfDensity({ seed = 7, ground = { y: 0, amp: 4, freq: 0.03 }, warp = { amp: 6, freq: 0.03 }, prims = [], rough = { amp: 1.2, freq: 0.22 }, strata = { amp: 0.35, freq: 0.9 }, band = 4 } = {}) {
  const colCache = new Map();
  const col = (x, z) => { // [warped x, warped z, ground height] per column, memoised
    const key = Math.round(x * 64) * 100003 + Math.round(z * 64);
    let c = colCache.get(key);
    if (!c) {
      const wx = x + warp.amp * (fbm2(x * warp.freq, z * warp.freq, 3, seed) - 0.5) * 2;
      const wz = z + warp.amp * (fbm2(x * warp.freq + 31, z * warp.freq + 17, 3, seed + 1) - 0.5) * 2;
      c = [wx, wz, ground.fn ? ground.fn(x, z) : ground.y + ground.amp * (fbm2(wx * ground.freq, wz * ground.freq, 4, seed + 2) - 0.5) * 2];
      colCache.set(key, c);
    }
    return c;
  };
  return (x, y, z) => {
    const [qx, qz, gh] = col(x, z);
    let d = y - gh; // negative below ground = solid
    for (const p of prims) {
      let e;
      if (p.type === 'capsule') e = sdCapsule(qx, y, qz, p.a, p.b, p.r);
      else if (p.type === 'sphere') e = sdSphere(qx, y, qz, p.c, p.r);
      else if (p.type === 'box') e = sdBox(qx, y, qz, p.c, p.h, p.round || 0);
      else e = sdTorus(qx, y, qz, p.c, p.R, p.r, p.axis);
      d = p.op === 'sub' ? smax(d, -e, p.k ?? 2) : smin(d, e, p.k ?? 2);
    }
    if (Math.abs(d) < band) {
      const rk = ground.fn ? sstep(-0.5, 2.5, y - gh) : 1; // on a host heightfield only the primitives get rough
      d += rk * rough.amp * (fbm3(qx * rough.freq, y * rough.freq, qz * rough.freq, 3, seed + 3) - 0.5) * 2;
      d += rk * strata.amp * (Math.abs(((y * strata.freq + 0.6 * vnoise3(qx * 0.05, 0, qz * 0.05, seed)) % 1 + 1) % 1 - 0.5) - 0.25) * 4;
    }
    return -d;
  };
}

// Sample a density function on a grid. min: world corner, dims: [nx,ny,nz], voxel: metres.
export function sampleField(fn, { min = [-32, -8, -32], dims = [129, 41, 129], voxel = 0.5 } = {}) {
  const [nx, ny, nz] = dims, D = new Float32Array(nx * ny * nz);
  let i = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, i++) {
    let d = fn(min[0] + x * voxel, min[1] + y * voxel, min[2] + z * voxel);
    if (x === 0 || z === 0 || x === nx - 1 || z === nz - 1 || y === ny - 1) d = Math.min(d, -0.01); // close the volume: walls are air
    if (y === 0) d = Math.max(d, 0.01);                                                          // floor is solid
    D[i] = d;
  }
  return { D, nx, ny, nz, min, voxel };
}

// Build SDF terrain meshes. Returns { group, meshes, field, density(x,y,z), heightAt(x,z) }.
// cell = culling cell size (m). ao: sample openness at 1.5/4 m along the normal into vertex colour.
// Tier guide: voxel 0.75 (low) / 0.5 (med-high) / 0.35 (ultra); cost ∝ 1/voxel³.
export function buildSdfTerrain(fn, { min = [-32, -8, -32], size = [64, 20, 64], voxel = 0.5, cell = 16, flood = true, ao = true, material = null } = {}) {
  const dims = size.map((s) => Math.round(s / voxel) + 1);
  const field = sampleField(fn, { min, dims, voxel });
  const { D, nx, ny, nz } = field;
  if (flood) field.removed = floodFillSolid(D, nx, ny, nz);
  const sn = surfaceNets(D, nx, ny, nz), smp = sampler3(D, nx, ny, nz);
  const wd = (x, y, z) => smp((x - min[0]) / voxel, (y - min[1]) / voxel, (z - min[2]) / voxel); // world-space density
  const nv = sn.nv, P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
  for (let k = 0; k < nv; k++) {
    const gx = sn.pos[k * 3], gy = sn.pos[k * 3 + 1], gz = sn.pos[k * 3 + 2], e = 0.8;
    let ax = smp(gx - e, gy, gz) - smp(gx + e, gy, gz), ay = smp(gx, gy - e, gz) - smp(gx, gy + e, gz), az = smp(gx, gy, gz - e) - smp(gx, gy, gz + e);
    const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
    const X = min[0] + gx * voxel, Y = min[1] + gy * voxel, Z = min[2] + gz * voxel;
    P.set([X, Y, Z], k * 3); N.set([ax, ay, az], k * 3); U[k * 2] = X; U[k * 2 + 1] = Z;
    let o = 1;
    if (ao) { // openness: an open flat surface has density ≈ -r at distance r along its normal
      const a1 = clamp(-wd(X + ax * 1.5, Y + ay * 1.5, Z + az * 1.5) / 1.5, 0, 1), a2 = clamp(-wd(X + ax * 4, Y + ay * 4, Z + az * 4) / 4, 0, 1);
      o = 0.3 + 0.7 * Math.pow(0.5 * a1 + 0.5 * a2, 1.3);
    }
    C[k * 3] = C[k * 3 + 1] = C[k * 3 + 2] = o;
  }
  // bucket quads (6 indices each) into XZ cells, one geometry per non-empty cell
  const cx = Math.max(1, Math.ceil(size[0] / cell)), cz = Math.max(1, Math.ceil(size[2] / cell)), buckets = Array.from({ length: cx * cz }, () => []);
  for (let q = 0; q < sn.ni / 6; q++) {
    const a = sn.idx[q * 6] * 3, i = clamp(Math.floor((P[a] - min[0]) / cell), 0, cx - 1), j = clamp(Math.floor((P[a + 2] - min[2]) / cell), 0, cz - 1);
    buckets[i + cx * j].push(q);
  }
  const group = new Group(), meshes = [];
  for (const qs of buckets) {
    if (!qs.length) continue;
    const remap = new Map(), p = [], n = [], c = [], u = [], ix = [];
    for (const q of qs) for (let j = 0; j < 6; j++) {
      const v = sn.idx[q * 6 + j];
      let r = remap.get(v);
      if (r === undefined) { r = remap.size; remap.set(v, r); p.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); n.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); c.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]); u.push(U[v * 2], U[v * 2 + 1]); }
      ix.push(r);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(p, 3)); g.setAttribute('normal', new Float32BufferAttribute(n, 3));
    g.setAttribute('color', new Float32BufferAttribute(c, 3)); g.setAttribute('uv', new Float32BufferAttribute(u, 2));
    g.setIndex(new Uint32BufferAttribute(ix, 1)); g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new Mesh(g, material); m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false;
    group.add(m); meshes.push(m);
  }
  // heightAt: march down from the top of the volume to the first solid sample, then bisect
  const top = min[1] + size[1];
  const heightAt = (x, z) => {
    let y = top, step = voxel;
    while (y > min[1] && wd(x, y, z) <= 0) y -= step;
    let lo = y, hi = y + step;
    for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (wd(x, m, z) > 0) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  return { group, meshes, field, density: wd, heightAt, tris: sn.ni / 3 };
}

// ------------------------------------------------------------------ heightfield terrain
// 2D value noise with analytic derivatives (quintic fade) → [v, dv/dx, dv/dz] in out
const fq = (t) => t * t * t * (t * (t * 6 - 15) + 10), dfq = (t) => 30 * t * t * (t * (t - 2) + 1);
function vnoised(x, z, s, out) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fq(fx), w = fq(fz), du = dfq(fx), dw = dfq(fz);
  const a = ihash(ix, iz, 0, s), b = ihash(ix + 1, iz, 0, s), c = ihash(ix, iz + 1, 0, s), d = ihash(ix + 1, iz + 1, 0, s);
  const k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  out[0] = a + k1 * u + k2 * w + k4 * u * w;
  out[1] = du * (k1 + k4 * w); out[2] = dw * (k2 + k4 * u);
  return out;
}
const _nd = [0, 0, 0];
// Erosion-ish height function. Derivative damping (sum += a·n/(1+|∇|²)) leaves smooth valleys and
// sharp detailed slopes like hydraulic erosion; ridged noise adds crests; flats carve play areas.
//  flats: [{x, z, r, h, edge}] → height h inside radius r, blended over `edge` m.
//  bowl: raise the terrain toward the rim (hides the world edge behind hills), { r0, r1, h }.
export function erodedHeight({ seed = 1, amp = 16, freq = 0.006, octaves = 7, ridge = 0.35, ridgeFreq = 0.012, base = 0, flats = [], bowl = null, detail = 0.25 } = {}) {
  return (x, z) => {
    let px = x * freq, pz = z * freq, a = 1, sum = 0, dx = 0, dz = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      vnoised(px, pz, seed + i, _nd);
      dx += _nd[1]; dz += _nd[2];
      sum += (a * (_nd[0] - 0.5) * 2) / (1 + dx * dx + dz * dz);
      norm += a; a *= 0.5;
      const nx = px * 0.8 - pz * 0.6, nz = px * 0.6 + pz * 0.8; px = nx * 2.0 + 13.7; pz = nz * 2.0 + 7.3;
    }
    let h = sum / norm;
    if (ridge > 0) h = mix(h, (ridged2(x * ridgeFreq, z * ridgeFreq, 5, seed + 50) - 0.35) * 2, ridge);
    h = base + amp * h + detail * (fbm2(x * 0.35, z * 0.35, 3, seed + 90) - 0.5); // ground-scale bumps (cm–dm)
    if (bowl) { const r = Math.hypot(x, z); h += bowl.h * sstep(bowl.r0, bowl.r1, r); }
    for (const f of flats) {
      const d = Math.hypot(x - f.x, z - f.z), t = sstep(f.r, f.r + (f.edge ?? 12), d);
      h = mix(f.h + (f.noise ?? 0.08) * (fbm2(x * 0.5, z * 0.5, 2, seed + 70) - 0.5), h, t);
    }
    return h;
  };
}

// Heightfield terrain centred at (cx, cz): size (m), res = vertex spacing (m), fn(x,z) → y.
// cells: chunks per side (frustum culling granularity). Returns { group, meshes, heightAt, normalAt, grid }.
// Vertex colour = cavity (Laplacian) darkening, 0.55..1 — gullies get darker, crests stay bright.
export function terrain({ size = 200, res = 1, fn = erodedHeight(), cells = 4, cx = 0, cz = 0, material = null, cavity = 0.9 } = {}) {
  const n = Math.round(size / res), step = size / n, x0 = cx - size / 2, z0 = cz - size / 2, W = n + 1;
  const H = new Float32Array(W * W);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) H[i + j * W] = fn(x0 + i * step, z0 + j * step);
  const h = (i, j) => H[clamp(i, 0, n) + clamp(j, 0, n) * W];
  const group = new Group(), meshes = [], per = Math.ceil(n / cells);
  for (let cj = 0; cj < cells; cj++) for (let ci = 0; ci < cells; ci++) {
    const i0 = ci * per, j0 = cj * per, i1 = Math.min(n, i0 + per), j1 = Math.min(n, j0 + per);
    if (i0 >= i1 || j0 >= j1) continue;
    const w = i1 - i0 + 1, p = [], nn = [], c = [], u = [], ix = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const X = x0 + i * step, Z = z0 + j * step, Y = h(i, j);
      const gx = (h(i + 1, j) - h(i - 1, j)) / (2 * step), gz = (h(i, j + 1) - h(i, j - 1)) / (2 * step), l = Math.hypot(gx, 1, gz);
      p.push(X, Y, Z); nn.push(-gx / l, 1 / l, -gz / l); u.push(X, Z);
      // cavity: Laplacian over ±2 cells (concave → positive → darker)
      const lap = (h(i + 2, j) + h(i - 2, j) + h(i, j + 2) + h(i, j - 2) - 4 * Y) / (4 * step * step);
      const o = clamp(1 - lap * cavity * 4, 0.55, 1.0) * (0.92 + 0.08 * clamp(1 - Math.hypot(gx, gz), 0, 1));
      c.push(o, o, o);
    }
    for (let j = 0; j < j1 - j0; j++) for (let i = 0; i < i1 - i0; i++) {
      const a = i + j * w, b = a + 1, d = a + w, e = d + 1;
      ix.push(a, d, b, b, d, e); // diagonal b–d; heightAt() uses the same split
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(p, 3)); g.setAttribute('normal', new Float32BufferAttribute(nn, 3));
    g.setAttribute('color', new Float32BufferAttribute(c, 3)); g.setAttribute('uv', new Float32BufferAttribute(u, 2));
    g.setIndex(new Uint32BufferAttribute(ix, 1)); g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new Mesh(g, material); m.receiveShadow = true; m.castShadow = true; m.matrixAutoUpdate = false;
    group.add(m); meshes.push(m);
  }
  // exact height of the rendered triangles (props sit on the mesh, not on fn)
  const heightAt = (x, z) => {
    const fx = clamp((x - x0) / step, 0, n - 1e-4), fz = clamp((z - z0) / step, 0, n - 1e-4), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = h(i, j), b = h(i + 1, j), d = h(i, j + 1), e = h(i + 1, j + 1);
    return u + v <= 1 ? a + (b - a) * u + (d - a) * v : e + (d - e) * (1 - u) + (b - e) * (1 - v);
  };
  const normalAt = (x, z, out = new Vector3()) => {
    const e = step; return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
  };
  return { group, meshes, heightAt, normalAt, grid: H, n, step, x0, z0, size };
}

// ------------------------------------------------------------------ terrain tint patch
// Recolours any terrain material by a world-space slope/height/noise splat: grass on flats, dry patches by
// macro noise, rock/dirt on slopes > ~25°. The texture's luminance is kept as detail (albedo = target ·
// lum/ref), so one generic ground texture reads as a landscape. Colours are LINEAR ALBEDOS; ref = the
// texture's mean luminance (forest_ground ≈ 0.12). Match `grass` to your grass blades' average colour so the
// grass fade-out distance is invisible.
// amount: 0 = untouched texture, 1 = fully recoloured (default .85 keeps some of the texture's own hue).
//   patchTerrainTint(mat, { grass: [0.12,0.17,0.045], dry: [0.3,0.25,0.14], rock: [0.26,0.25,0.23], slope: [0.2,0.42] })
export function patchTerrainTint(material, { grass = [0.12, 0.17, 0.045], dry = [0.3, 0.25, 0.14], rock = [0.26, 0.25, 0.23], slope = [0.2, 0.42], scale = 0.06, snowLine = 1e9, amount = 0.85, ref = 0.12 } = {}) {
  const U = {
    uTtGrass: { value: new Vector3(...grass) }, uTtDry: { value: new Vector3(...dry) }, uTtRock: { value: new Vector3(...rock) },
    uTtP: { value: [slope[0], slope[1], scale, snowLine, amount, ref] },
  };
  material.userData.terrainTint = U;
  return patch(material, 'terrainTint', (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = after(s.vertexShader, '#include <common>', 'varying vec3 vTtW;\nvarying vec3 vTtN;');
    s.vertexShader = after(s.vertexShader, '#include <worldpos_vertex>', /*glsl*/`
  vTtW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vTtN = normalize(mat3(modelMatrix) * objectNormal);`);
    s.fragmentShader = after(s.fragmentShader, '#include <common>', /*glsl*/`
varying vec3 vTtW;
varying vec3 vTtN;
uniform vec3 uTtGrass;
uniform vec3 uTtDry;
uniform vec3 uTtRock;
uniform float uTtP[6];
float ttHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float ttNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ttHash(i), ttHash(i + vec2(1.0, 0.0)), f.x), mix(ttHash(i + vec2(0.0, 1.0)), ttHash(i + 1.0), f.x), f.y); }
float ttFbm(vec2 p) { return 0.5 * ttNoise(p) + 0.3 * ttNoise(p * 2.13 + 7.1) + 0.2 * ttNoise(p * 4.37 + 3.3); }`);
    s.fragmentShader = after(s.fragmentShader, '#include <color_fragment>', /*glsl*/`
{
  vec3 tn = normalize(vTtN);
  float macro = ttFbm(vTtW.xz * uTtP[2]);
  float fine = ttNoise(vTtW.xz * uTtP[2] * 9.0);
  float sl = 1.0 - tn.y + (fine - 0.5) * 0.08;
  vec3 c = uTtGrass * mix(0.78, 1.18, ttNoise(vTtW.xz * uTtP[2] * 3.0));
  c = mix(c, uTtDry, smoothstep(0.48, 0.72, macro) * 0.85);
  c = mix(c, uTtRock, smoothstep(uTtP[0], uTtP[1], sl));
  c = mix(c, vec3(0.8), smoothstep(uTtP[3], uTtP[3] + 6.0, vTtW.y + fine * 4.0) * smoothstep(0.5, 0.2, sl));
  float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(diffuseColor.rgb, c * clamp(lum / uTtP[5], 0.3, 2.2), uTtP[4]);
}`);
  });
}
