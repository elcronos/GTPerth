// Far field: the distance must never look empty or end in a visible edge.
//  - createFarfield(G, opts): 2-3 concentric silhouette rings (mountains / skyline / treeline) drawn by a
//    procedural shader on open cylinders. Silhouettes are 4x supersampled across the pixel (no stair-stepping
//    on building edges), windows light procedurally, the sun-side tops get a rim, and everything goes through
//    the SAME atmosApply() as the rest of the world (lighting/atmos.glsl.js), so layers separate by aerial
//    perspective. follow (0..1) = how much a ring travels with the camera: 1 = skybox-like, 0 = fixed → parallax.
//  - boundaryBerm(opts): annulus that rises to a crest (the world boundary) and then sinks below the horizon
//    beyond the fog distance, so the world edge is never seen.  horizonSkirt(): flat ring under the far layers.
//  - fogDistance(sigma, T): distance at which the fog leaves transmittance T (place boundaries beyond it).
//
//   const ff = createFarfield(G, { layers: FARFIELD_PRESETS.industrial });   // adds to G.scene, auto-updates
//
// Needs lighting/atmos installAtmos(G) for the real fog; if it was not installed, the same uniform names are
// registered here with neutral golden-hour defaults (placeholder), so the shader still compiles and fogs.
import { Mesh, Group, ShaderMaterial, CylinderGeometry, BackSide, Vector3, BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Color } from 'three';
import { patchUniforms, sharedUniform } from '../engine/patch.js';
import { ATMOS_DECL, ATMOS_GLSL } from '../lighting/atmos.glsl.js';
import { fbm2, sstep, mix, clamp } from '../geo/noise.js';

const NAMES = ['uSunDir', 'uSunColor', 'uFogSigma', 'uFogScatter', 'uFogFalloff', 'uFogBase', 'uFogSunInscatter', 'uFogStart'];
function ensureAtmos(G) {
  if (patchUniforms.uFogSigma) return;
  const f = { sigma: [0.0035, 0.0045, 0.0065], scatter: [0.78, 0.6, 0.46], heightFalloff: 0.05, baseHeight: 0, sunInscatter: 1, start: 4, ...((G && G.ART && G.ART.fog) || {}) };
  const s = G && G.sun;
  sharedUniform('uSunDir', 'vec3', s ? s.dir.clone() : new Vector3(0.3, 0.2, -0.9).normalize());
  sharedUniform('uSunColor', 'vec3', s ? new Vector3(s.color.r, s.color.g, s.color.b).multiplyScalar(s.intensity) : new Vector3(6, 4.5, 3));
  sharedUniform('uFogSigma', 'vec3', new Vector3().fromArray(f.sigma));
  sharedUniform('uFogScatter', 'vec3', new Vector3().fromArray(f.scatter));
  sharedUniform('uFogFalloff', 'float', f.heightFalloff);
  sharedUniform('uFogBase', 'float', f.baseHeight);
  sharedUniform('uFogSunInscatter', 'float', f.sunInscatter);
  sharedUniform('uFogStart', 'float', f.start);
}

// Distance at which per-metre extinction `sigma` (smallest channel) leaves transmittance T. Height fog only
// makes it longer, so this is a safe lower bound for "things beyond here are invisible".
export const fogDistance = (sigma, T = 0.02) => -Math.log(T) / Math.min(...(Array.isArray(sigma) ? sigma : [sigma]));

const FF_VS = /*glsl*/`
varying vec3 vW;
varying vec2 vRing;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vRing = position.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FF_FS = /*glsl*/`
varying vec3 vW;
varying vec2 vRing;
uniform float uKind;
uniform float uRadius;
uniform float uBase;
uniform float uHeight;
uniform float uSeed;
uniform float uWindows;
uniform float uRim;
uniform float uFogScale;
uniform vec3 uBody;
uniform vec3 uBodyTop;
uniform vec3 uWinColor;
uniform float uRough;
` + ATMOS_DECL + ATMOS_GLSL + /*glsl*/`
float ffHash(float n) { return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453); }
float ffHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 74.7) * 43758.5453); }
float ffNoise(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(ffHash(i), ffHash(i + 1.0), f); }
float ffFbm(float x) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * ffNoise(x); x = x * 2.03 + 7.1; a *= 0.5; } return s / 0.97; }
float ffRidge(float x) { float s = 0.0; float a = 0.5; float pr = 1.0; for (int i = 0; i < 6; i++) { float n = 1.0 - abs(ffNoise(x) * 2.0 - 1.0); n *= n; s += a * n * pr; pr = clamp(n * 1.7, 0.0, 1.0); x = x * 2.11 + 3.3; a *= 0.5; } return s / 0.97; }
// building cell along the arc: returns (height, cell start, cell width, id)
vec4 ffBuilding(float s) {
  float w0 = 26.0;
  float c = floor(s / w0);
  float j = ffHash(c * 3.1);
  // split some cells into two narrower towers
  float split = step(0.55, j);
  float local = s - c * w0;
  float sub = split * step(w0 * (0.35 + 0.3 * ffHash(c * 5.7)), local);
  float id = c * 2.0 + sub;
  float r = ffHash(id * 1.7 + 0.3);
  float cluster = 0.35 + 0.65 * ffFbm(s * 0.0035);
  float h = uHeight * cluster * (0.25 + 0.75 * r * r);
  h *= step(0.12, ffHash(id * 9.1));                         // gaps
  float x0 = c * w0 + sub * w0 * (0.35 + 0.3 * ffHash(c * 5.7));
  float wd = split > 0.5 ? (sub > 0.5 ? w0 - (x0 - c * w0) : w0 * (0.35 + 0.3 * ffHash(c * 5.7))) : w0;
  return vec4(h, x0, wd, id);
}
// silhouette height (m above uBase) at arc length s (metres around the ring)
float ffProfile(float s) {
  float u = s / uRadius;                       // radians
  if (uKind < 0.5) {                           // mountains: ridged fbm, broad massifs
    float m = ffRidge(u * 3.2 * uRough + 1.0) * 0.75 + ffFbm(u * 1.3) * 0.45;
    return uHeight * clamp(m * 0.9 - 0.08, 0.04, 1.2);
  } else if (uKind < 1.5) {                    // skyline: blocks + rooftop kit
    vec4 b = ffBuilding(s);
    float h = b.x;
    float lx = s - b.y;
    float roof = step(0.7, ffHash(b.w * 4.3)) * step(abs(lx - b.z * 0.5), b.z * 0.18) * 4.0;          // plant room
    float mast = step(0.86, ffHash(b.w * 7.7)) * step(abs(lx - b.z * 0.3), 0.5) * uHeight * 0.25;     // antenna
    float inset = step(lx, 1.2) + step(b.z - 1.2, lx);                                                   // parapet notch
    return h > 0.0 ? h + roof + mast - inset * 0.8 : 0.0;
  } else {                                     // treeline: crown bumps on rolling ground, some conifers
    float ground = uHeight * 0.35 * ffFbm(s * 0.01);
    float cw = 7.0;
    float c = floor(s / cw);
    float x = (s - c * cw) / cw * 2.0 - 1.0;
    float th = uHeight * (0.55 + 0.45 * ffHash(c * 2.3));
    float con = step(0.6, ffHash(c * 4.9));
    float crown = mix(sqrt(max(0.0, 1.0 - x * x)), max(0.0, 1.0 - abs(x)) * 1.3, con);
    return ground + th * (0.55 + 0.45 * crown) + uHeight * 0.06 * ffNoise(s * 0.9);
  }
}
void main() {
  float ang = atan(vRing.y, vRing.x);
  float s = (ang + 3.14159265) * uRadius;
  float y = vW.y - uBase;
  // 4 sub-samples across the pixel footprint along the arc (AA for vertical building/trunk edges)
  float ds = min(fwidth(s), 40.0); // clamp: atan() wraps at ±pi
  float dy = max(fwidth(y), 1e-3);
  float cov = 0.0;
  float hC = ffProfile(s);
  for (int i = 0; i < 4; i++) {
    float h = ffProfile(s + (float(i) - 1.5) * 0.25 * ds);
    cov += clamp((h - y) / dy + 0.5, 0.0, 1.0);
  }
  cov *= 0.25;
  if (cov < 0.002) discard;
  // body: darker at the foot, lighter toward the top (sky fill)
  float t = clamp(y / max(hC, 1.0), 0.0, 1.0);
  vec3 col = mix(uBody, uBodyTop, t * t);
  vec3 vd = normalize(vW - cameraPosition);
  vec2 sxz = normalize(uSunDir.xz + 1e-5);
  float toSun = dot(normalize(vd.xz), sxz);
  // sun behind the layer → rim on the crest; sun behind the camera → faces catch flat sun
  float rim = exp(-max(hC - y, 0.0) / (2.0 + uHeight * 0.03)) * pow(max(toSun, 0.0), 3.0);
  col += uSunColor * 0.02 * uRim * rim;
  col += uBodyTop * uSunColor * 0.015 * max(-toSun, 0.0) * max(uSunDir.y, 0.0) * 4.0;
  if (uKind > 0.5 && uKind < 1.5 && uWindows > 0.0) {   // windows: 3.2 m floors, 2.4 m bays
    vec4 b = ffBuilding(s);
    float lx = s - b.y;
    vec2 g = vec2(lx / 2.4, y / 3.2);
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.75);
    win *= step(1.0, cell.y) * step(y, b.x - 1.5) * step(1.0, lx) * step(lx, b.z - 1.0);
    float lit = step(1.0 - uWindows, ffHash2(cell + b.w * 17.0));
    float warm = ffHash2(cell * 1.3 + 5.0);
    vec3 wc = uWinColor * mix(vec3(1.0), vec3(0.75, 0.85, 1.1), step(0.75, warm)) * (0.5 + warm);
    // windows fade before they alias (cell smaller than ~3 px)
    float aaw = 1.0 - smoothstep(0.25, 0.6, ds / 2.4);
    col += wc * win * lit * aaw;
    col += uWinColor * 0.02 * uWindows * (1.0 - aaw) * step(y, b.x - 1.5); // their average glow far away
  }
  // fog at an apparent distance (art knob uFogScale) along the true view ray
  vec3 fw = cameraPosition + (vW - cameraPosition) * uFogScale;
  col = atmosApply(col, fw, cameraPosition);
  gl_FragColor = vec4(col, cov);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Layer presets (linear radiance colours, already "lit" by the sky; fog does the rest).
export const FARFIELD_PRESETS = {
  industrial: [
    { kind: 'mountains', radius: 1150, height: 210, base: -20, follow: 0.85, body: [0.10, 0.10, 0.12], top: [0.20, 0.19, 0.21], rim: 1.0, fogScale: 0.7 },
    { kind: 'skyline', radius: 640, height: 95, base: -6, follow: 0.4, windows: 0.09, body: [0.035, 0.035, 0.04], top: [0.07, 0.065, 0.07], rim: 0.6, fogScale: 0.75 },
    { kind: 'treeline', radius: 330, height: 18, base: 2, follow: 0.0, body: [0.022, 0.03, 0.018], top: [0.05, 0.06, 0.035], rim: 1.4, fogScale: 0.9 },
  ],
  wilderness: [
    { kind: 'mountains', radius: 1200, height: 260, base: -30, follow: 0.9, body: [0.09, 0.10, 0.13], top: [0.22, 0.22, 0.26], rim: 1.0, fogScale: 0.7, rough: 1.3 },
    { kind: 'mountains', radius: 700, height: 110, base: -20, follow: 0.5, body: [0.05, 0.06, 0.06], top: [0.11, 0.12, 0.11], rim: 0.8, fogScale: 0.85, seed: 4, rough: 2.0 },
    { kind: 'treeline', radius: 320, height: 20, base: -6, follow: 0.0, body: [0.02, 0.03, 0.015], top: [0.05, 0.065, 0.03], rim: 1.4 },
  ],
  city: [
    { kind: 'skyline', radius: 1100, height: 220, base: -20, follow: 0.8, windows: 0.3, body: [0.05, 0.05, 0.06], top: [0.10, 0.10, 0.12], rim: 0.6, fogScale: 0.7 },
    { kind: 'skyline', radius: 520, height: 90, base: -10, follow: 0.3, windows: 0.25, body: [0.03, 0.03, 0.035], top: [0.06, 0.06, 0.065], rim: 0.6, seed: 9 },
  ],
};
const KIND = { mountains: 0, skyline: 1, treeline: 2 };
const TIER_SEG = { low: 128, med: 192, high: 256, ultra: 320 };

export function createFarfield(G, { layers = FARFIELD_PRESETS.industrial, center = [0, 0], winColor = [3.2, 2.0, 0.95], add = true } = {}) {
  ensureAtmos(G);
  const group = new Group(); group.name = 'farfield';
  const atm = {}; for (const n of NAMES) atm[n] = patchUniforms[n];
  const seg = TIER_SEG[G?.quality?.tier] || 256;
  const items = layers.slice().sort((a, b) => b.radius - a.radius).map((L, i) => {
    const h = L.height * 2.2 + 40; // ring tall enough for masts and the hump of the profile
    const geo = new CylinderGeometry(L.radius, L.radius, h, seg, 1, true);
    geo.translate(0, h / 2, 0);
    const mat = new ShaderMaterial({
      vertexShader: FF_VS, fragmentShader: FF_FS, side: BackSide, transparent: true, depthWrite: true,
      uniforms: {
        ...atm,
        uKind: { value: KIND[L.kind] ?? 0 }, uRadius: { value: L.radius }, uBase: { value: L.base ?? -10 },
        uHeight: { value: L.height }, uSeed: { value: L.seed ?? i * 3 + 1 }, uWindows: { value: L.windows ?? 0 }, uRim: { value: L.rim ?? 1 },
        uFogScale: { value: L.fogScale ?? 1 }, uBody: { value: new Color().fromArray(L.body || [0.05, 0.05, 0.06]) },
        uBodyTop: { value: new Color().fromArray(L.top || [0.1, 0.1, 0.11]) }, uWinColor: { value: new Color().fromArray(L.winColor || winColor) },
        uRough: { value: L.rough ?? 1 },
      },
    });
    mat.userData.noAtmos = true;
    const m = new Mesh(geo, mat); m.position.set(center[0], L.base ?? -10, center[1]);
    m.renderOrder = -10 + i; m.frustumCulled = false; m.name = 'farfield:' + L.kind;
    group.add(m);
    return { m, follow: L.follow ?? 0, L };
  });
  if (add && G?.scene) G.scene.add(group);
  const update = () => { // allocation-free: rings follow the camera by their follow factor
    const c = G.camera.position;
    for (let i = 0; i < items.length; i++) { const it = items[i]; it.m.position.x = center[0] + c.x * it.follow; it.m.position.z = center[1] + c.z * it.follow; }
  };
  if (G?.on) G.on('update', update);
  update();
  return { group, layers: items, update, dispose() { for (const it of items) { it.m.geometry.dispose(); it.m.material.dispose(); } } };
}

// Boundary berm: ring from `inner` (meets your terrain at y = heightAt(edge)) rising to `crest` m above it at
// `crestR`, then sinking to `drop` m BELOW the base at `outer` (put outer beyond fogDistance()). The crest is the
// world's visual and physical wall; from inside you never see past it, from a height you see it melt into fog.
export function boundaryBerm({ inner = 120, crestR = 150, outer = 420, crest = 14, drop = 40, base = 0, heightAt = null, seg = 256, rings = 28, seed = 3, material = null } = {}) {
  const p = [], n = [], u = [], c = [], ix = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings, r = mix(inner, outer, Math.pow(t, 1.6));
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y0 = heightAt ? heightAt(Math.cos(a) * inner, Math.sin(a) * inner) : base;
      const nz = fbm2(Math.cos(a) * 6 + seed, Math.sin(a) * 6, 4, seed), cr = crest * (0.6 + 0.8 * nz);
      let y = r < crestR ? y0 + cr * sstep(inner, crestR, r) : mix(y0 + cr, base - drop, sstep(crestR, outer, r));
      y += 2.5 * (fbm2(x * 0.03, z * 0.03, 3, seed + 1) - 0.5) * sstep(inner, crestR, r);
      p.push(x, y, z); u.push(x, z); const k = 0.75 + 0.25 * nz; c.push(k, k, k);
    }
  }
  const W = seg + 1;
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) { const a = j * W + i; ix.push(a, a + 1, a + W, a + 1, a + W + 1, a + W); } // CCW seen from above
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3)); g.setAttribute('uv', new Float32BufferAttribute(u, 2)); g.setAttribute('color', new Float32BufferAttribute(c, 3));
  g.setIndex(new Uint32BufferAttribute(ix, 1)); g.computeVertexNormals(); g.computeBoundingSphere();
  const m = new Mesh(g, material); m.receiveShadow = true; m.name = 'boundaryBerm'; m.matrixAutoUpdate = false;
  return m;
}

// Flat ring at y (default slightly below ground) from r0 to r1: continues the ground under the far layers so
// no sky shows below their feet. Give it the terrain material (atmos patched) — fog turns it into the horizon.
export function horizonSkirt({ r0 = 300, r1 = 1600, y = -2, seg = 128, material = null } = {}) {
  const p = [], u = [], ix = [];
  for (const r of [r0, r1]) for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; p.push(Math.cos(a) * r, y, Math.sin(a) * r); u.push(Math.cos(a) * r, Math.sin(a) * r); }
  const W = seg + 1; for (let i = 0; i < seg; i++) ix.push(i, i + 1, i + W, i + 1, i + W + 1, i + W);
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(p, 3)); g.setAttribute('uv', new Float32BufferAttribute(u, 2));
  g.setIndex(new Uint32BufferAttribute(ix, 1)); g.computeVertexNormals(); g.computeBoundingSphere();
  const m = new Mesh(g, material); m.receiveShadow = false; m.name = 'horizonSkirt'; m.matrixAutoUpdate = false;
  return m;
}

// CONTRACT module shape: create(G, opts) → { update, dispose, group, layers }
export const create = createFarfield;
