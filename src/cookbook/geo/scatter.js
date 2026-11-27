// Instanced scatter + vegetation/rock generators.
//   const pts = poissonDisk({ x0: -60, z0: -60, w: 120, h: 120, r: 3, rng });
//   const rocks = scatter(G, { parts: [{ geo: rockGeo({ seed: 3 }), material: rockMat }], points: pts,
//     heightAt: T.heightAt, normalAt: T.normalAt, slope: [0, 35], scale: [0.3, 1.2], align: 0.7, fade: [60, 90] });
//   scene.add(rocks.group);      // rocks.update() is registered on G 'update' automatically (cell visibility)
//
// Distance LOD is a FADE, never a pop: each instance shrinks to nothing over its own randomised window
// inside [near, far] (density thins gradually), and grass blades widen with distance (widen) so the
// thinned field still covers the ground. Cells beyond `far` are hidden on the CPU (no per-frame allocs).
// Foliage sway goes through engine/patch.js ('sway' key) and is applied to the shadow depth material too.
import {
  InstancedMesh, Group, Matrix4, Quaternion, Vector3, Color, BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute,
  MeshDepthMaterial, RGBADepthPacking, DataTexture, RGBAFormat, UnsignedByteType, SRGBColorSpace, LinearFilter,
  LinearMipmapLinearFilter, RepeatWrapping, DoubleSide,
} from 'three';
import { patch, after, sharedUniform } from '../engine/patch.js';
import { rngFrom, fbm3, vnoise3, clamp, mix, sstep } from './noise.js';
import { lathe, tube, mergeGeos, normalizeGeo } from './kit.js';

const TAU = Math.PI * 2;

// ------------------------------------------------------------------ placement
// Bridson poisson-disk sampling in a rectangle. Returns Float32Array [x0,z0, x1,z1, ...].
// accept(x, z, rnd) → bool lets masks reject candidates (they still block neighbours only if accepted).
export function poissonDisk({ x0 = 0, z0 = 0, w = 100, h = 100, r = 2, rng = rngFrom(1), k = 24, accept = null, max = 2e5 } = {}) {
  const cs = r / Math.SQRT2, gw = Math.ceil(w / cs), gh = Math.ceil(h / cs), grid = new Int32Array(gw * gh).fill(-1);
  const pts = [], active = [];
  const put = (x, z) => { const i = pts.length / 2; pts.push(x, z); active.push(i); grid[Math.floor(x / cs) + Math.floor(z / cs) * gw] = i; };
  const ok = (x, z) => {
    if (x < 0 || z < 0 || x >= w || z >= h) return false;
    const gx = Math.floor(x / cs), gz = Math.floor(z / cs);
    for (let j = Math.max(0, gz - 2); j <= Math.min(gh - 1, gz + 2); j++) for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
      const p = grid[i + j * gw]; if (p < 0) continue;
      const dx = pts[p * 2] - x, dz = pts[p * 2 + 1] - z; if (dx * dx + dz * dz < r * r) return false;
    }
    return true;
  };
  put(rng() * w, rng() * h);
  while (active.length && pts.length / 2 < max) {
    const ai = Math.floor(rng() * active.length), a = active[ai], ax = pts[a * 2], az = pts[a * 2 + 1];
    let found = false;
    for (let t = 0; t < k; t++) {
      const ang = rng() * TAU, d = r * (1 + rng()), x = ax + Math.cos(ang) * d, z = az + Math.sin(ang) * d;
      if (ok(x, z)) { put(x, z); found = true; break; }
    }
    if (!found) { active[ai] = active[active.length - 1]; active.pop(); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i += 2) { const x = pts[i] + x0, z = pts[i + 1] + z0; if (!accept || accept(x, z, rng)) out.push(x, z); }
  return new Float32Array(out);
}

// ------------------------------------------------------------------ shader patches
export const windUniform = () => sharedUniform('uWind', 'vec3', new Vector3(1.5, 0, 0.4));

// Sway: offset ∝ wind · gust(t, phase) · (y/height)^power, computed in world space then brought into
// instance-local space (instanceMatrix = R·s → inverse = transpose/s²). Works for non-instanced meshes too.
// amp: metres of tip motion per m/s of wind; freq: rad/s; flutter: per-vertex leaf jitter (m).
export function swayPatch(material, { amp = 0.05, freq = 1.6, power = 1.5, height = 1, flutter = 0 } = {}) {
  windUniform();
  const u = { value: [amp, freq, power, height] }, fl = { value: flutter };
  patch(material, 'sway', (s) => {
    s.uniforms.uSway = u; s.uniforms.uFlutter = fl;
    // declarations go after <common> (never match 'void main() {': the GLSL minifier rewrites it inside templates)
    s.vertexShader = after(s.vertexShader, '#include <common>', 'uniform float uSway[4];\nuniform float uFlutter;');
    s.vertexShader = after(s.vertexShader, '#include <begin_vertex>', /*glsl*/`
{
  #ifdef USE_INSTANCING
  mat4 swI = modelMatrix * instanceMatrix;
  #else
  mat4 swI = modelMatrix;
  #endif
  vec3 swO = swI[3].xyz;
  float swPh = dot(swO.xz, vec2(0.37, 0.23));
  float swH = pow(max(transformed.y, 0.0) / uSway[3], uSway[2]);
  float gust = 0.65 + 0.35 * sin(uTime * 0.53 + swPh * 0.21) * sin(uTime * 0.31 + swPh * 0.13);
  float wv = 0.55 * sin(uTime * uSway[1] + swPh) + 0.25 * sin(uTime * uSway[1] * 2.31 + swPh * 1.7) + 0.45;
  vec3 off = vec3(uWind.x, 0.0, uWind.z) * (uSway[0] * gust * wv * swH);
  off += uFlutter * swH * sin(uTime * 7.0 + dot(transformed, vec3(9.1, 7.3, 8.7)) + swPh) * vec3(0.7, 0.5, 0.6);
  off.y -= 0.35 * length(off.xz) * swH;
  mat3 swM = mat3(swI);
  transformed += (transpose(swM) * off) / max(dot(swM[0], swM[0]), 1e-6);
}`);
  });
  material.userData.sway = u;
  return material;
}

// Foliage lighting for DoubleSide leaf cards / grass: keep the authored (spherical / bent-up) normal on
// BOTH faces instead of three's back-face flip (no black undersides), and add cheap sun translucency
// (leaves glow when backlit — the golden-hour cue). trans: strength (0 = off).
export function foliagePatch(material, { trans = 0.35 } = {}) {
  const u = { value: trans };
  patch(material, 'foliage', (s) => {
    s.uniforms.uTrans = u;
    s.fragmentShader = after(s.fragmentShader, '#include <common>', 'uniform float uTrans;');
    s.fragmentShader = after(s.fragmentShader, '#include <normal_fragment_begin>', /*glsl*/`
#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
  normal *= faceDirection;
  nonPerturbedNormal = normal;
#endif`);
    s.fragmentShader = after(s.fragmentShader, '#include <lights_fragment_end>', /*glsl*/`
#if NUM_DIR_LIGHTS > 0
{
  vec3 trV = normalize( vViewPosition );
  float trK = pow( max( dot( -trV, directionalLights[ 0 ].direction ), 0.0 ), 3.0 );
  reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[ 0 ].color * ( trK * uTrans + 0.06 * uTrans );
}
#endif`);
  });
  return material;
}

// Distance fade for instanced meshes: per-instance shrink window inside [near, far]; widen = extra
// horizontal scale at `far` (1 = none; grass 1.8) to keep coverage while density thins.
export function fadePatch(material, near = 30, far = 45, widen = 1) {
  const u = { value: [near, far, widen] };
  material.userData.fade = u;
  patch(material, 'fade', (s) => {
    s.uniforms.uFade = u;
    s.vertexShader = after(s.vertexShader, '#include <common>', 'uniform float uFade[3];');
    s.vertexShader = after(s.vertexShader, '#include <begin_vertex>', /*glsl*/`
#ifdef USE_INSTANCING
{
  vec3 fO = (modelMatrix * instanceMatrix[3]).xyz;
  float fD = distance(fO, cameraPosition);
  float fH = fract(sin(float(gl_InstanceID) * 12.9898 + fO.x * 0.618) * 43758.5453);
  float fW = (uFade[1] - uFade[0]) * 0.35 + 0.001;
  float fS = uFade[0] + fH * (uFade[1] - uFade[0] - fW);
  float fK = 1.0 - smoothstep(fS, fS + fW, fD);
  float fWide = mix(1.0, uFade[2], smoothstep(uFade[0] * 0.3, uFade[1], fD));
  transformed.xz *= fK * fWide;
  transformed.y *= fK;
}
#endif`);
  });
  return material;
}

// Shadow depth material that carries the same sway/fade so shadows move with the foliage.
export function depthFor(material, sway, fade) {
  const d = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  if (sway) swayPatch(d, sway);
  if (fade) fadePatch(d, fade[0], fade[1], fade[2] ?? 1);
  return d;
}

// ------------------------------------------------------------------ scatter
// Per-tier thinning (fraction of points kept) and fade-distance scale, applied by scatter() unless tiered:false.
export const SCATTER_TIERS = { low: { keep: 0.4, fade: 0.6 }, med: { keep: 0.7, fade: 0.8 }, high: { keep: 1, fade: 1 }, ultra: { keep: 1, fade: 1.25 } };
const _m = new Matrix4(), _q = new Quaternion(), _q2 = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _n = new Vector3(), _up = new Vector3(0, 1, 0), _c = new Color();
// opts:
//  parts: [{geo, material}] — all share the instance transforms (trunk + leaves, rock, ...)
//  points: Float32Array [x,z,...] (or area {x0,z0,w,h} + r for poisson)
//  heightAt(x,z), normalAt(x,z,out) — ground; slope: [minDeg,maxDeg]; height: [minY,maxY]
//  mask(x,z,rnd) → probability 0..1 (density map); scale: [min,max]; scaleY: [min,max] extra Y multiplier
//  align: 0 upright … 1 follow ground normal; sink: metres pushed into the ground (× scale)
//  tint: {color, h, s, l} per-instance HSL jitter around color; fade: [near, far, widen]; cell: grid size (m)
//  sway: {amp, freq, power, height, flutter} or false;  shadow: cast shadows
export function scatter(G, o) {
  const rng = rngFrom(o.seed ?? 1);
  const pts = o.points || poissonDisk({ ...o.area, r: o.r || 2, rng });
  const slope = o.slope || [0, 90], hr = o.height || [-1e9, 1e9], sc = o.scale || [1, 1], sy = o.scaleY || [1, 1];
  const cosMin = Math.cos((slope[1] * Math.PI) / 180), cosMax = Math.cos((slope[0] * Math.PI) / 180);
  const wu = windUniform(); // ART.weather.wind → shared uWind (copied once; the game may animate wu.value)
  if (G?.ART?.weather?.wind && !wu.fromArt) { wu.value.fromArray(G.ART.weather.wind); wu.fromArt = true; }
  const tq = o.tiered === false ? SCATTER_TIERS.high : SCATTER_TIERS[G?.quality?.tier] || SCATTER_TIERS.high;
  const cell = o.cell || 24, buckets = new Map();
  const fade = o.fade ? [o.fade[0] * tq.fade, o.fade[1] * tq.fade, o.fade[2] ?? 1] : null;
  const base = new Color(o.tint?.color ?? 0xffffff), hsl = { h: 0, s: 0, l: 0 }; base.getHSL(hsl);
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], z = pts[i + 1], r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng(), r5 = rng();
    const y = o.heightAt ? o.heightAt(x, z) : 0;
    if (y < hr[0] || y > hr[1]) continue;
    if (o.normalAt) o.normalAt(x, z, _n); else _n.set(0, 1, 0);
    if (_n.y < cosMin || _n.y > cosMax + 1e-6) continue;
    if (o.mask && r5 > o.mask(x, z, rng)) continue;
    if (tq.keep < 1 && ((i * 0.6180339887) % 1) > tq.keep) continue; // deterministic thinning per tier
    const s = mix(sc[0], sc[1], r1 * r1); // bias toward small: many small, few big
    _q.setFromAxisAngle(_up, r2 * TAU);
    if (o.align) { _q2.setFromUnitVectors(_up, _n); _q2.slerp(_q.clone().identity(), 1 - o.align); _q.premultiply(_q2); }
    if (o.tilt) { _q2.setFromAxisAngle(_s.set(r3 - 0.5, 0, r4 - 0.5).normalize(), (r3 - 0.5) * o.tilt); _q.premultiply(_q2); }
    _p.set(x, y - (o.sink || 0) * s, z); _s.set(s, s * mix(sy[0], sy[1], r3), s);
    const key = Math.floor(x / cell) * 65536 + Math.floor(z / cell);
    if (!buckets.has(key)) buckets.set(key, { cx: (Math.floor(x / cell) + 0.5) * cell, cz: (Math.floor(z / cell) + 0.5) * cell, m: [], c: [] });
    const b = buckets.get(key);
    b.m.push(_m.compose(_p, _q, _s).clone());
    const t = o.tint || {};
    _c.setHSL(hsl.h + (r4 - 0.5) * 2 * (t.h ?? 0), clamp(hsl.s + (r2 - 0.5) * 2 * (t.s ?? 0), 0, 1), clamp(hsl.l + (r5 - 0.5) * 2 * (t.l ?? 0), 0, 1));
    b.c.push(_c.clone());
  }
  for (const p of o.parts) { // fade/sway uniforms live on the material: one material per distinct fade/sway
    const sig = JSON.stringify([fade, o.sway || null]), prev = p.material.userData.scatterSig;
    if (prev && prev !== sig) console.warn('scatter: material "' + (p.material.name || p.material.type) + '" reused with a different fade/sway — the last call wins; use one material per scatter setting');
    p.material.userData.scatterSig = sig;
    if (o.sway) swayPatch(p.material, o.sway);
    if (fade) fadePatch(p.material, fade[0], fade[1], fade[2] ?? 1);
  }
  const depths = o.parts.map((p) => (o.shadow !== false ? depthFor(p.material, o.sway, fade) : null));
  const group = new Group(), cells = [];
  let count = 0;
  for (const b of buckets.values()) {
    const meshes = o.parts.map((p, pi) => {
      const im = new InstancedMesh(p.geo, p.material, b.m.length);
      b.m.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, b.c[i]); });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere(); im.castShadow = o.shadow !== false; im.receiveShadow = true;
      if (depths[pi]) im.customDepthMaterial = depths[pi];
      im.matrixAutoUpdate = false; group.add(im); return im;
    });
    count += b.m.length;
    cells.push({ x: b.cx, z: b.cz, meshes });
  }
  const R = cell * 0.75, far = fade ? fade[1] : Infinity;
  const update = () => { // hide cells entirely beyond the fade distance (no allocations)
    if (far === Infinity) return;
    const cp = G.camera.position;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], d = Math.hypot(c.x - cp.x, c.z - cp.z) - R, vis = d < far;
      for (let j = 0; j < c.meshes.length; j++) c.meshes[j].visible = vis;
    }
  };
  if (G && G.on) G.on('update', update);
  return { group, count, cells, update, dispose() { group.traverse((m) => m.isInstancedMesh && m.dispose()); } };
}

// ------------------------------------------------------------------ generators
// Indexed icosphere (shared vertices) — subdivision `detail` (3 → 642 verts).
export function icosphere(detail = 3) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return p.map((c) => c / l); });
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < detail; d++) {
    const cache = new Map(), nf = [];
    const mid = (a, b) => { const k = a < b ? a * 1e6 + b : b * 1e6 + a; let i = cache.get(k); if (i === undefined) { const p = [0, 1, 2].map((j) => v[a][j] + v[b][j]), l = Math.hypot(...p); i = v.length; v.push(p.map((c) => c / l)); cache.set(k, i); } return i; };
    for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  return { v, f };
}

// Rock: icosphere + fbm displacement + flat plane cuts (fractured faces) + flat base.
// Vertex colour: crevices (inward displacement) darker, upward faces lighter (dust/weathering).
export function rockGeo({ seed = 1, radius = 1, detail = 3, cuts = 4, squash = 0.65, noise = 0.32, base = 0.22 } = {}) {
  const rnd = rngFrom(seed * 7919 + 1), { v, f } = icosphere(detail), P = [], D = [];
  const planes = [];
  for (let i = 0; i < cuts; i++) { // plane normals biased sideways/up (rocks fracture along joints)
    const a = rnd() * TAU, el = (rnd() * 0.9 - 0.15) * Math.PI / 2, n = [Math.cos(el) * Math.cos(a), Math.sin(el), Math.cos(el) * Math.sin(a)];
    planes.push([n, radius * (0.5 + 0.3 * rnd())]);
  }
  const so = rnd() * 100;
  for (const p of v) {
    const disp = noise * (fbm3(p[0] * 1.5 + so, p[1] * 1.5, p[2] * 1.5, 4, seed) - 0.5) * 2 + 0.06 * (vnoise3(p[0] * 6 + so, p[1] * 6, p[2] * 6, seed + 5) - 0.5);
    let x = p[0] * radius * (1 + disp), y = p[1] * radius * (1 + disp) * squash, z = p[2] * radius * (1 + disp);
    for (const [n, d] of planes) { const e = x * n[0] + y * n[1] + z * n[2] - d; if (e > 0) { x -= n[0] * e; y -= n[1] * e; z -= n[2] * e; } }
    if (y < -base * radius) y = -base * radius - 0.03 * radius * (fbm3(x * 3, 0, z * 3, 2, seed) - 0.5); // flat-ish base sits in the ground
    P.push(x, y + base * radius, z); D.push(disp);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  g.setIndex(new Uint32BufferAttribute(f.flat(), 1));
  g.computeVertexNormals();
  const N = g.attributes.normal.array, C = [], U = [];
  for (let i = 0; i < P.length / 3; i++) {
    const ny = N[i * 3 + 1], cav = clamp(0.5 + D[i] * 2.2, 0, 1);
    const k = (0.55 + 0.45 * cav) * (0.85 + 0.25 * sstep(0.3, 0.95, ny)) * (P[i * 3 + 1] < 0.08 * radius ? 0.7 : 1);
    C.push(k, k, k);
    const ax = Math.abs(N[i * 3]), az = Math.abs(N[i * 3 + 2]); // dominant-axis planar UVs (metric)
    U.push(ax > az ? P[i * 3 + 2] : P[i * 3], ny > 0.7 ? (ax > az ? P[i * 3] : P[i * 3 + 2]) : P[i * 3 + 1]);
  }
  g.setAttribute('color', new Float32BufferAttribute(C, 3)); g.setAttribute('uv', new Float32BufferAttribute(U, 2));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

// Grass tuft: `blades` curved tapered blades (segs rows each), height h (m), base width w.
// Normals are bent 65 % toward +Y so the tuft shades like a soft volume (no black backsides);
// vertex colour ramps root (AO 0.35) → tip (1.0). Use a DoubleSide material with vertexColors.
export function grassTuftGeo({ seed = 1, blades = 9, h = 0.38, w = 0.028, spread = 0.14, segs = 3, bend = 0.35 } = {}) {
  const rnd = rngFrom(seed), p = [], n = [], c = [], u = [], ix = [];
  for (let b = 0; b < blades; b++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * spread, bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const dir = rnd() * TAU, hh = h * (0.55 + 0.6 * rnd()), lean = bend * (0.4 + rnd()), ww = w * (0.7 + 0.6 * rnd());
    const dx = Math.cos(dir), dz = Math.sin(dir), sx = -dz, sz = dx; // lean direction / blade width axis
    const o = p.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, y = hh * t, off = lean * hh * t * t, wt = ww * (1 - t * 0.92) * 0.5;
      const cx = bx + dx * off, cz = bz + dz * off;
      // blade face normal is horizontal along the lean direction; bend 65 % toward +Y
      const bx2 = dx * 0.35, by2 = 0.65, bz2 = dz * 0.35, l = Math.hypot(bx2, by2, bz2);
      const col = 0.35 + 0.65 * Math.pow(t, 0.8);
      for (const side of [-1, 1]) { p.push(cx + sx * wt * side, y, cz + sz * wt * side); n.push(bx2 / l, by2 / l, bz2 / l); c.push(col, col, col); u.push(0.5 + side * 0.5, t); }
    }
    for (let s = 0; s < segs; s++) { const a0 = o + s * 2; ix.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3)); g.setAttribute('normal', new Float32BufferAttribute(n, 3));
  g.setAttribute('color', new Float32BufferAttribute(c, 3)); g.setAttribute('uv', new Float32BufferAttribute(u, 2));
  g.setIndex(new Uint32BufferAttribute(ix, 1)); g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

// Leaf atlas as a DataTexture with hand-built mips: colour is dilated into transparent texels (no dark
// fringes under alphaTest) and alpha is boosted per mip level so canopies don't go bald at distance.
export function leafTexture({ size = 256, seed = 5, leaves = 70, kind = 'broad' } = {}) {
  const rnd = rngFrom(seed), cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.translate(size / 2, size / 2);
  for (let i = 0; i < leaves; i++) { // leaves arranged on a twig fan: denser in the middle
    const a = rnd() * TAU, r = Math.pow(rnd(), 0.7) * size * 0.4, x = Math.cos(a) * r, y = Math.sin(a) * r;
    const L = size * (kind === 'needle' ? 0.16 : 0.1) * (0.7 + 0.6 * rnd()), W = L * (kind === 'needle' ? 0.12 : 0.45);
    const lv = 0.75 + 0.5 * rnd();
    g.save(); g.translate(x, y); g.rotate(a + (rnd() - 0.5) * 1.2 + Math.PI / 2);
    g.fillStyle = `rgb(${(70 * lv) | 0},${(110 * lv) | 0},${(40 * lv) | 0})`;
    g.beginPath(); g.moveTo(0, -L / 2); g.quadraticCurveTo(W, 0, 0, L / 2); g.quadraticCurveTo(-W, 0, 0, -L / 2); g.fill();
    g.strokeStyle = `rgba(30,45,15,0.5)`; g.lineWidth = Math.max(1, size / 256); g.beginPath(); g.moveTo(0, -L / 2); g.lineTo(0, L / 2); g.stroke();
    g.restore();
  }
  const img = g.getImageData(0, 0, size, size).data;
  // dilate colour into alpha=0 texels (8 passes) — their rgb is what filtering blends at leaf edges
  const rgb = new Float32Array(size * size * 3), A = new Float32Array(size * size), have = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) { A[i] = img[i * 4 + 3] / 255; if (A[i] > 0.05) { have[i] = 1; rgb[i * 3] = img[i * 4] / A[i]; rgb[i * 3 + 1] = img[i * 4 + 1] / A[i]; rgb[i * 3 + 2] = img[i * 4 + 2] / A[i]; } }
  for (let pass = 0; pass < 8; pass++) {
    const nh = have.slice();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = x + y * size; if (have[i]) continue;
      let r = 0, gg = 0, b = 0, k = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue; const j = xx + yy * size; if (have[j]) { r += rgb[j * 3]; gg += rgb[j * 3 + 1]; b += rgb[j * 3 + 2]; k++; } }
      if (k) { rgb[i * 3] = r / k; rgb[i * 3 + 1] = gg / k; rgb[i * 3 + 2] = b / k; nh[i] = 1; }
    }
    have.set(nh);
  }
  for (let i = 0; i < size * size; i++) if (!have[i]) { rgb[i * 3] = 60; rgb[i * 3 + 1] = 95; rgb[i * 3 + 2] = 35; }
  // mip chain (box filter), alpha coverage boost per level
  const mips = []; let w = size, cr = rgb, ca = A;
  for (let lvl = 0; w >= 1; lvl++) {
    const data = new Uint8Array(w * w * 4), boost = 1 + 0.3 * lvl;
    for (let i = 0; i < w * w; i++) { data[i * 4] = cr[i * 3]; data[i * 4 + 1] = cr[i * 3 + 1]; data[i * 4 + 2] = cr[i * 3 + 2]; data[i * 4 + 3] = clamp(ca[i] * boost, 0, 1) * 255; }
    mips.push({ data, width: w, height: w });
    if (w === 1) break;
    const h2 = w >> 1, nr = new Float32Array(h2 * h2 * 3), na = new Float32Array(h2 * h2);
    for (let y = 0; y < h2; y++) for (let x = 0; x < h2; x++) {
      const o = x + y * h2; let sa = 0;
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const j = x * 2 + ox + (y * 2 + oy) * w; sa += ca[j]; for (let c = 0; c < 3; c++) nr[o * 3 + c] += cr[j * 3 + c] * 0.25; }
      na[o] = sa * 0.25;
    }
    cr = nr; ca = na; w = h2;
  }
  const tex = new DataTexture(mips[0].data, size, size, RGBAFormat, UnsignedByteType);
  tex.mipmaps = mips; tex.generateMipmaps = false; tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter; tex.magFilter = LinearFilter; tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
}

// Leaf-card cluster helper: n quads of size s around centre c, normals = direction from `crown` centre
// (spherical normals → the canopy shades as one soft volume, not as flat cards).
function leafCards(md, c, s, n, crown, rnd, aoFn) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, b = (rnd() - 0.5) * Math.PI * 0.9, ax = Math.cos(b) * Math.cos(a), ay = Math.sin(b), az = Math.cos(b) * Math.sin(a);
    // two in-plane axes perpendicular to random normal (ax,ay,az)
    let ux = -az, uy = 0, uz = ax; const lu = Math.hypot(ux, uz) || 1; ux /= lu; uz /= lu;
    const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    const ss = s * (0.75 + 0.5 * rnd()), rot = rnd() * TAU, cr = Math.cos(rot), sr = Math.sin(rot);
    const o = md.p.length / 3;
    for (const [qx, qy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = (qx * cr - qy * sr) * ss * 0.5, ly = (qx * sr + qy * cr) * ss * 0.5;
      const x = c[0] + ux * lx + vx * ly, y = c[1] + uy * lx + vy * ly, z = c[2] + uz * lx + vz * ly;
      let nx = x - crown[0], ny = (y - crown[1]) * 1.4 + 0.4, nz = z - crown[2]; const l = Math.hypot(nx, ny, nz) || 1;
      md.p.push(x, y, z); md.n.push(nx / l, ny / l, nz / l); md.u.push((qx + 1) / 2, (qy + 1) / 2);
      const k = aoFn(x, y, z); md.c.push(k, k, k);
    }
    md.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
}
const mdGeo = (md) => {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(md.p, 3)); g.setAttribute('normal', new Float32BufferAttribute(md.n, 3));
  g.setAttribute('color', new Float32BufferAttribute(md.c, 3)); g.setAttribute('uv', new Float32BufferAttribute(md.u, 2));
  g.setIndex(new Uint32BufferAttribute(md.i, 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
};

// Tree: lathed trunk with root flare and bark furrows, tapered tube branches (2 levels), leaf-card
// clusters at branch tips. Returns { trunk, leaves } geometries (same origin, base at y=0).
// Materials: trunk → MeshStandardMaterial (vertexColors); leaves → leafTexture(), alphaTest .5, DoubleSide.
export function treeGeo({ seed = 1, height = 8, trunkR = 0.22, branches = 9, leafSize = 1.2, density = 1, lean = 0.4 } = {}) {
  const rnd = rngFrom(seed * 31 + 7), H = height, R = trunkR;
  const lx = (rnd() - 0.5) * lean, lz = (rnd() - 0.5) * lean; // gentle lean/curve of the trunk
  const off = (y) => { const t = y / H; return [lx * t * t * H * 0.15, lz * t * t * H * 0.15]; };
  const rows = 10, prof = [];
  for (let i = 0; i <= rows; i++) { const t = i / rows, y = t * H * 0.82; prof.push([R * (1 - 0.72 * t) * (1 + 0.7 * Math.exp(-y * 3.5)), y]); }
  prof.push([0.0, H * 0.84]);
  const trunk = lathe(prof, { seg: 10, crease: 80 });
  const P = trunk.attributes.position.array;
  for (let i = 0; i < P.length; i += 3) { // bark furrows: radial displacement by stretched noise; lean
    const x = P[i], y = P[i + 1], z = P[i + 2], a = Math.atan2(z, x), r = Math.hypot(x, z);
    const f = 1 + 0.09 * (vnoise3(Math.cos(a) * 2.2 + 5, y * 0.55, Math.sin(a) * 2.2, seed) - 0.5) * 2 + 0.05 * (vnoise3(Math.cos(a) * 7, y * 1.6, Math.sin(a) * 7, seed + 3) - 0.5);
    const roots = 1 + 0.35 * Math.exp(-y * 5) * Math.pow(Math.abs(Math.sin(a * 2.5 + seed)), 3);
    const [ox, oz] = off(y);
    P[i] = Math.cos(a) * r * f * roots + ox; P[i + 2] = Math.sin(a) * r * f * roots + oz;
  }
  trunk.computeVertexNormals();
  const parts = [trunk];
  const crown = [off(H * 0.7)[0], H * 0.7, off(H * 0.7)[1]];
  const md = { p: [], n: [], c: [], u: [], i: [] };
  const crownR = H * 0.38;
  const ao = (x, y, z) => { const d = Math.hypot(x - crown[0], (y - crown[1]) * 1.2, z - crown[2]) / crownR; return clamp(0.35 + 0.75 * d, 0.35, 1.05) * (0.8 + 0.2 * sstep(crown[1] - crownR, crown[1] + crownR, y)); };
  const nb = Math.round(branches);
  for (let b = 0; b < nb; b++) {
    const t = 0.38 + 0.5 * (b / nb) + rnd() * 0.05, y0 = H * 0.82 * t, a = b * 2.39996 + rnd() * 0.5;
    const len = H * (0.42 - 0.22 * t) * (0.8 + 0.4 * rnd()), up = 0.35 + 0.5 * t;
    const [ox, oz] = off(y0), br = R * (1 - 0.72 * t) * 0.55;
    const pts = [];
    for (let k = 0; k <= 4; k++) { const s = k / 4; pts.push([ox + Math.cos(a) * len * s, y0 + len * s * up + len * 0.15 * Math.sin(s * Math.PI) - len * 0.1 * s * s, oz + Math.sin(a) * len * s]); }
    parts.push(tube(pts, (s) => br * (1 - 0.8 * s), { radial: 6, curve: true, samples: 8, caps: false }));
    const tip = pts[4];
    for (let sb = 0; sb < 2; sb++) { // twigs
      const s0 = 0.5 + 0.3 * sb, p0 = pts[Math.round(s0 * 4)], a2 = a + (sb ? 0.9 : -0.9) + (rnd() - 0.5) * 0.5, l2 = len * 0.45;
      const p1 = [p0[0] + Math.cos(a2) * l2, p0[1] + l2 * 0.5, p0[2] + Math.sin(a2) * l2];
      parts.push(tube([p0, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 + l2 * 0.1, (p0[2] + p1[2]) / 2], p1], (s) => br * 0.45 * (1 - 0.8 * s), { radial: 4, curve: true, samples: 4, caps: false }));
      leafCards(md, p1, leafSize, Math.round(6 * density), crown, rnd, ao);
    }
    leafCards(md, tip, leafSize * 1.1, Math.round(9 * density), crown, rnd, ao);
    leafCards(md, pts[2], leafSize * 0.9, Math.round(4 * density), crown, rnd, ao);
  }
  // fill the crown so it reads as a mass, not lollipops
  for (let k = 0; k < Math.round(14 * density); k++) {
    const a = rnd() * TAU, e = (rnd() - 0.3) * 1.2, r = crownR * (0.45 + 0.5 * rnd());
    leafCards(md, [crown[0] + Math.cos(a) * Math.cos(e) * r, crown[1] + Math.sin(e) * r * 0.75, crown[2] + Math.sin(a) * Math.cos(e) * r], leafSize, Math.round(5 * density), crown, rnd, ao);
  }
  const wood = mergeGeos(parts);
  const C = wood.attributes.color.array, WP = wood.attributes.position.array;
  for (let i = 0; i < C.length; i += 3) { const y = WP[i + 1], k = 0.55 + 0.45 * sstep(0, 1.5, y); C[i] = C[i + 1] = C[i + 2] = k; } // dark at the base
  return { trunk: wood, leaves: mdGeo(md) };
}

// Bush: ellipsoidal mass of leaf cards on a few stems; returns a single leaves geometry (base y=0).
export function bushGeo({ seed = 1, radius = 0.7, height = 0.9, cards = 40, leafSize = 0.55 } = {}) {
  const rnd = rngFrom(seed * 13 + 3), md = { p: [], n: [], c: [], u: [], i: [] }, crown = [0, height * 0.45, 0];
  const ao = (x, y, z) => clamp(0.5 + 0.6 * Math.hypot(x / radius, (y - crown[1]) / (height * 0.55), z / radius), 0.5, 1.05) * (0.75 + 0.25 * sstep(0, height, y));
  for (let k = 0; k < cards / 4; k++) {
    const a = rnd() * TAU, e = rnd() * Math.PI * 0.5, r = 0.35 + 0.6 * Math.sqrt(rnd());
    leafCards(md, [Math.cos(a) * Math.cos(e) * radius * r, crown[1] + Math.sin(e) * height * 0.5 * r - 0.08, Math.sin(a) * Math.cos(e) * radius * r], leafSize, 4, crown, rnd, ao);
  }
  return mdGeo(md);
}
