// Gerstner-wave sea as a patched MeshStandardMaterial (so env reflections, the sun's GGX highlight, shadows,
// the atmos fog patch and any other cookbook patch work unchanged).
//
//   const sea = createSea(G, { level: -1.8 });                 // deep open sea
//   const sea = createSea(G, { level: 0, floor: { glsl: 'float seaFloorY(vec2 p){ return p.x*0.05 - 8.0; }',
//                                                 js: (x, z) => x * 0.05 - 8 } });   // beach: shallow water is see-through
//   boat.position.y = sea.heightAt(x, z, G.t);                  // buoyancy: SAME wave sum as the GPU
//   sea.normalAt(x, z, G.t, outVec3);                           // for tilting floating things
//
// What it does
//  - vertex: sum of N (default 8) Gerstner waves, deep-water dispersion ω = √(g·k), choppiness Q split so that
//    Σ Qᵢkᵢaᵢ ≤ Q (no loops). Waves shorter than ~6 grid spacings fade out (the grid gets coarser with distance).
//  - grid: one radial mesh with exponentially growing rings (0.25 m at the camera → ~70 m at 2 km), re-centred on
//    the camera every frame; the waves are evaluated in WORLD space so recentring never makes them swim.
//  - fragment: per-pixel normal from the analytic derivatives of all vertex waves + 12 short detail waves. Each wave
//    fades when a pixel covers it, and its slope variance is moved into roughness (Toksvig-style), so the sun glitter
//    path stays bright but never sparkles/aliases at distance.
//  - Fresnel/env: three's physical shading (F0 0.02, env = scene.environment = G.env). Optional planar reflection.
//  - absorption: water depth from `floor` (analytic), view path through the water → transmittance T; scattered
//    colour × (1−T) + the seabed seen through (premultiplied blend: alpha = 1 − T(1−F)). Deep water ⇒ opaque.
//  - foam: Gerstner Jacobian (crests that fold) + shoreline (depth < 0.5 m), broken up by animated cellular noise.
//  - sun light through wave crests (sub-surface glow, golden hour).
//
// Reads ART.weather.wind (direction of waves) if `windDir` not given. Tier: low uses 4 vertex waves / 6 detail.
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, Vector3, Vector4, Color, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, NormalBlending } from 'three';
import { patch } from '../engine/patch.js';

const GRAV = 9.81;

/**
 * Build a wave set. Deterministic for a seed. Returned arrays are what both GPU and JS evaluate.
 * @returns {{ vtx: Array<{dx,dz,k,a,w,q,ph,L}>, det: Array }}
 */
export function makeWaves({ seed = 3, windDir = 0, count = 8, detail = 12, L0 = 48, falloff = 0.66, steep = 0.09, chop = 0.65, spread = 0.9, detailSteep = 0.08 } = {}) {
  let s = seed >>> 0 || 1;
  const rand = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const mk = (L, steepness, spr) => {
    const k = (2 * Math.PI) / L, ang = windDir + (rand() - 0.5) * spr;
    return { dx: Math.cos(ang), dz: Math.sin(ang), k, a: (steepness * (0.7 + 0.6 * rand())) / k, w: Math.sqrt(GRAV * k), q: 0, ph: rand() * 6.2832, L };
  };
  const vtx = [];
  for (let i = 0; i < count; i++) vtx.push(mk(L0 * Math.pow(falloff, i), steep, spread * (0.6 + i * 0.12)));
  // split the choppiness budget: Σ q k a = chop (GPU Gems ch.1 "Q_i = Q / (w_i A_i N)")
  for (const w of vtx) w.q = chop / (w.k * w.a * vtx.length);
  const det = [];
  const Ld = vtx[vtx.length - 1].L * 0.7;
  for (let i = 0; i < detail; i++) det.push(mk(Ld * Math.pow(0.74, i), detailSteep, 2.6));
  return { vtx, det };
}

// radial grid: rings r(i) = a(e^{b i} - 1), ring spacing ≈ b(r + a)
function radialGrid(rings, segs, a, b) {
  const pos = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const r = a * (Math.exp(b * i) - 1);
    for (let j = 0; j < segs; j++) {
      const t = (j / segs) * Math.PI * 2;
      pos.push(Math.cos(t) * r, 0, Math.sin(t) * r);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const j1 = (j + 1) % segs, v0 = i * segs + j, v1 = i * segs + j1, v2 = (i + 1) * segs + j, v3 = (i + 1) * segs + j1;
    idx.push(v0, v1, v2, v1, v3, v2);   // counter-clockwise seen from +Y = front face up
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

const fmt = (x) => (Number.isInteger(x) ? x.toFixed(1) : x.toFixed(6));

/**
 * @param {object} o
 *  level (m) · waves (makeWaves result) or waveOpts · windDir (rad; default from ART.weather.wind)
 *  floor: { glsl: 'float seaFloorY(vec2 p){...}', js: (x,z)=>y } (default: flat at level-60 → opaque deep sea)
 *  scatter [r,g,b] linear water-body colour · absorb [r,g,b] 1/m (only its mean drives alpha) · foam (0..1)
 *  refl: createPlanarReflection() at the same height (optional) · far (m) grid radius · rings, segs
 */
export function createSea(G, o = {}) {
  const ART = G.ART || {};
  const tier = G.quality.tier;
  const wind = ART.weather?.wind || [1, 0, 0.3];
  const windDir = o.windDir ?? Math.atan2(wind[2], wind[0]);
  const lowT = tier === 'low';
  const waves = o.waves || makeWaves({ windDir, count: lowT ? 4 : 8, detail: lowT ? 6 : 12, ...(o.waveOpts || {}) });
  const level = o.level ?? 0;
  const floorGLSL = o.floor?.glsl || `float seaFloorY(vec2 p) { return ${fmt(level - 60)}; }`;
  const floorJS = o.floor?.js || (() => level - 60);
  const shore = !!o.floor;

  // grid: inner spacing 0.22 m, reaches `far`
  const far = o.far ?? 2400, rings = o.rings ?? (lowT ? 150 : 230), segs = o.segs ?? (lowT ? 256 : 400);
  const b = 0.0255, a = far / (Math.exp(b * rings) - 1);
  const geo = radialGrid(rings, segs, a, b);
  geo.boundingSphere = null;

  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0.0, envMapIntensity: o.envIntensity ?? 1.0 });
  mat.name = 'sea';
  if (shore) {
    // premultiplied "over": rgb already contains reflection + in-scatter; alpha = how much it hides the seabed
    mat.transparent = true; mat.blending = CustomBlending; mat.blendSrc = OneFactor; mat.blendDst = OneMinusSrcAlphaFactor;
    mat.depthWrite = true;
  } else mat.blending = NormalBlending;

  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.position.y = level;
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;
  mesh.name = 'sea';
  mesh.userData.noReflect = true;
  // recentre on whatever camera renders it (main or mirrored) — waves are world-space, so no swimming
  mesh.onBeforeRender = (r, s, cam) => { mesh.position.x = cam.position.x; mesh.position.z = cam.position.z; mesh.updateMatrixWorld(); };

  const uniforms = {
    uSeaGrid: { value: new Vector4(a, b, 0, 0) },
    uSeaScatter: { value: new Color().fromArray(o.scatter || [0.010, 0.050, 0.060]) },
    uSeaAbsorb: { value: new Vector3().fromArray(o.absorb || [0.40, 0.10, 0.07]) },
    uSeaFoam: { value: o.foam ?? 1.0 },
    uSeaSunDir: { value: new Vector3() },
    uSeaSunCol: { value: new Vector3() },
    uSeaLevel: { value: level },
  };
  if (o.refl) Object.assign(uniforms, o.refl.uniforms);

  const V = waves.vtx, D = waves.det;
  // waves are baked into the GLSL as constants (fast, minifier-safe). Rebuild the sea to change them.
  const vtxSum = V.map((w, i) => `  { float th = ${fmt(w.k)} * dot(vec2(${fmt(w.dx)}, ${fmt(w.dz)}), p) - ${fmt(w.w)} * t + ${fmt(w.ph)};
    float f = smoothstep(sp * 3.0, sp * 6.0, ${fmt(w.L)}) * sh;
    float s = sin(th), c = cos(th), qa = ${fmt(w.q * w.a)} * f;
    disp += vec3(${fmt(w.dx)} * qa * c, ${fmt(w.a)} * f * s, ${fmt(w.dz)} * qa * c);
    jac -= ${fmt(w.q * w.k * w.a)} * f * s; }`).join('\n');
  // normal sum (all waves): n = (-Σ dx k a c, 1 - Σ q k a s, -Σ dz k a c), each faded by pixel footprint
  const nrmTerm = (w, isDet) => `  { float th = ${fmt(w.k)} * dot(vec2(${fmt(w.dx)}, ${fmt(w.dz)}), p) - ${fmt(w.w)} * t + ${fmt(w.ph)};
    float f = 1.0 - smoothstep(${fmt(w.L * 0.18)}, ${fmt(w.L * 0.55)}, fp);
    float ka = ${fmt(w.k * w.a)} * sh;
    float s = sin(th), c = cos(th);
    n.x -= ${fmt(w.dx)} * ka * c * f; n.z -= ${fmt(w.dz)} * ka * c * f; n.y -= ${fmt(isDet ? 0 : w.q * w.k * w.a)} * sh * s * f;
    lost += ka * ka * 0.5 * (1.0 - f); }`;
  const nrmSum = V.map((w) => nrmTerm(w, false)).concat(D.map((w) => nrmTerm(w, true))).join('\n');

  const COMMON = /*glsl*/`
uniform vec4 uSeaGrid;
uniform vec3 uSeaScatter;
uniform vec3 uSeaAbsorb;
uniform float uSeaFoam;
uniform vec3 uSeaSunDir;
uniform vec3 uSeaSunCol;
uniform float uSeaLevel;
varying vec3 vSeaW;
varying vec3 vSeaP;
varying float vSeaJ;
${floorGLSL}
// shoaling-lite: waves shrink in shallow water so they never poke through the seabed
float seaShallow(vec2 p) { return smoothstep(0.0, 4.0, uSeaLevel - seaFloorY(p)) * 0.85 + 0.15 * smoothstep(0.0, 1.0, uSeaLevel - seaFloorY(p)); }
`;
  const VERT_FN = /*glsl*/`
vec3 seaDisp(vec2 p, float t, float sp, out float jac) {
  vec3 disp = vec3(0.0);
  jac = 1.0;
  float sh = seaShallow(p);
${vtxSum}
  return disp;
}
`;
  const FRAG_FN = /*glsl*/`
vec3 seaNormal(vec2 p, float t, float fp, out float lost) {
  vec3 n = vec3(0.0, 1.0, 0.0);
  lost = 0.0;
  float sh = seaShallow(p);
${nrmSum}
  return normalize(n);
}
float seaHash(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
// cellular foam: x = distance to the nearest jittered point (F1), y = that cell's random id
vec2 seaCell(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 h = vec2(seaHash(i + o), seaHash(i + o + 7.7));
      float d = length(o + h - f);
      if (d < d1) { d1 = d; id = seaHash(i + o + 3.3); }
    }
  }
  return vec2(d1, id);
}
float seaVN(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(seaHash(i), seaHash(i + vec2(1.0, 0.0)), u.x), mix(seaHash(i + vec2(0.0, 1.0)), seaHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// foam film with round holes of random sizes (two octaves) → bubbly lace, never a regular tiling
float seaLace(vec2 p) {
  vec2 a = seaCell(p);
  vec2 b = seaCell(p * 2.3 + 5.1);
  float ha = smoothstep(0.22 + 0.4 * a.y, 0.30 + 0.4 * a.y, a.x);
  float hb = smoothstep(0.20 + 0.35 * b.y, 0.28 + 0.35 * b.y, b.x);
  return ha * hb;
}
`;

  patch(mat, 'sea' + V.length + 'x' + D.length + (shore ? 'S' : '') + (o.refl ? 'R' : ''), (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON + VERT_FN)
      .replace('#include <begin_vertex>', /*glsl*/`#include <begin_vertex>
  {
    vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
    float rr = length(transformed.xz);
    float sp = uSeaGrid.y * (rr + uSeaGrid.x);          // local grid spacing (m)
    float jac;
    vec3 d = seaDisp(wp0.xz, uTime, sp, jac);
    transformed += d;
    vSeaP = vec3(wp0.x, d.y, wp0.z);
    vSeaJ = jac;
    vSeaW = wp0 + d;
  }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON + FRAG_FN + (o.refl ? REFL_DECL : ''))
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + SEA_STATE)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = seaRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize(mat3(viewMatrix) * seaN);')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + (o.refl ? SEA_REFL : ''))
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + SEA_END)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + (shore ? '  gl_FragColor.a = seaAlpha;' : '  gl_FragColor.a = 1.0;'));
  });

  const sunDir = G.sun.dir, sunCol = G.sun.color;
  const update = () => {
    uniforms.uSeaSunDir.value.copy(sunDir);
    uniforms.uSeaSunCol.value.set(sunCol.r, sunCol.g, sunCol.b).multiplyScalar(G.sun.intensity);
  };
  update();
  G.on('update', update);

  // --- JS mirror of the vertex sum (buoyancy). Gerstner moves points sideways, so the surface height at (x,z) is
  // the displaced height of the grid point p0 with p0 + disp.xz(p0) = (x,z): solve by fixed-point iteration.
  const disp = (px, pz, t, out) => {
    let dx = 0, dy = 0, dz = 0;
    const depth = level - floorJS(px, pz);
    const sh = smooth(0, 4, depth) * 0.85 + 0.15 * smooth(0, 1, depth);
    for (const w of V) {
      const th = w.k * (w.dx * px + w.dz * pz) - w.w * t + w.ph, s = Math.sin(th), c = Math.cos(th), qa = w.q * w.a * sh;
      dx += w.dx * qa * c; dy += w.a * sh * s; dz += w.dz * qa * c;
    }
    out.set(dx, dy, dz);
    return out;
  };
  const _d = new Vector3();
  const heightAt = (x, z, t = G.t) => {
    let px = x, pz = z;
    for (let i = 0; i < 4; i++) { disp(px, pz, t, _d); px = x - _d.x; pz = z - _d.z; }
    return level + disp(px, pz, t, _d).y;
  };
  const _a = new Vector3(), _b = new Vector3();
  const normalAt = (x, z, t = G.t, out = new Vector3()) => {
    const e = 0.35, h = heightAt(x, z, t);
    _a.set(2 * e, heightAt(x + e, z, t) - heightAt(x - e, z, t), 0);
    _b.set(0, heightAt(x, z + e, t) - heightAt(x, z - e, t), 2 * e);
    void h;
    return out.crossVectors(_b, _a).normalize();
  };

  G.scene.add(mesh);
  return {
    mesh, material: mat, uniforms, waves, level, heightAt, normalAt, update,
    dispose() { geo.dispose(); mat.dispose(); G.scene.remove(mesh); },
  };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const REFL_DECL = /*glsl*/`
uniform sampler2D uReflTex;
uniform mat4 uReflMat;
uniform float uReflOn;
uniform float uReflLod;
`;

const SEA_STATE = /*glsl*/`
  vec2 seaXZ = vSeaP.xz;
  float seaFp = length(fwidth(seaXZ));
  float seaLost;
  vec3 seaN = seaNormal(seaXZ, uTime, seaFp, seaLost);
  // glitter AA: slope variance of faded waves widens the GGX lobe (bright glitter path, no sparkling)
  float seaRough = clamp(sqrt(0.035 * 0.035 + seaLost * 1.6), 0.03, 0.45);
  vec3 seaV = normalize(cameraPosition - vSeaW);
  // depth of water under this point and the refracted view path through it
  float seaDepth = max(uSeaLevel + vSeaP.y - seaFloorY(seaXZ), 0.0);
  float cosI = clamp(dot(seaN, seaV), 0.0, 1.0);
  float cosT = sqrt(1.0 - (1.0 - cosI * cosI) / 1.77);
  float seaPath = seaDepth / max(cosT, 0.2);
  float seaT = exp(-dot(uSeaAbsorb, vec3(0.3333)) * seaPath);
  // foam: folding crests (Jacobian) + shoreline swash, textured as a bubbly film with holes (seaLace),
  // drifting + domain-warped, and broken into patches by slow value noise
  vec2 fq = seaXZ * 2.6 + vec2(uTime * 0.11, uTime * 0.07);
  fq += 0.5 * vec2(sin(fq.y * 0.9 + uTime * 0.21), sin(fq.x * 0.8 - uTime * 0.17));
  float lace = seaLace(fq);
  float patches = smoothstep(0.3, 0.7, seaVN(seaXZ * 0.15 + uTime * 0.01));
  lace *= mix(0.5, 1.0, patches);
  float foamCrest = smoothstep(0.62, 0.25, vSeaJ);
  // swash: the foam line breathes up and down the beach with a slow travelling phase
  float sw = 0.10 + 0.07 * sin(uTime * 0.7 + seaXZ.x * 0.15 - seaXZ.y * 0.05);
  float foamShore = (1.0 - smoothstep(sw * 0.15, sw, seaDepth)) * step(0.001, seaDepth);
  float seaFoamA = clamp(foamCrest * lace * 0.9 + foamShore * max(lace * 0.85, smoothstep(0.85, 1.0, foamShore)), 0.0, 1.0) * uSeaFoam;
  seaFoamA *= 1.0 - smoothstep(0.4, 2.0, seaFp);     // foam texture is sub-pixel far away: drop it
  // water body: in-scattered colour where the seabed is hidden; Fresnel added by three's specular
  diffuseColor.rgb = mix(uSeaScatter * (1.0 - seaT), vec3(0.82), seaFoamA);
  seaRough = mix(seaRough, 0.55, seaFoamA);
  // alpha for the premultiplied blend (shore mode): F ≈ Schlick(0.02)
  float seaF = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
  float seaAlpha = 1.0 - seaT * (1.0 - seaF) * (1.0 - seaFoamA);
`;

const SEA_REFL = /*glsl*/`
#if defined( RE_IndirectSpecular )
  if (uReflOn > 0.5) {
    vec4 rc = uReflMat * vec4(vSeaW + vec3(seaN.x, 0.0, seaN.z) * 1.5, 1.0);
    vec2 ruv = clamp(rc.xy / max(rc.w, 1e-4), vec2(0.002), vec2(0.998));
    vec3 pr = textureLod(uReflTex, ruv, material.roughness * 8.0 + uReflLod).rgb;
    radiance = mix(radiance, min(pr, vec3(60.0)), 0.85);
  }
#endif
`;

const SEA_END = /*glsl*/`
  {
    // light through thin crests toward the camera (looking toward the sun): green-teal glow
    vec3 Vd = -seaV;
    float fwd = pow(clamp(dot(Vd, uSeaSunDir), 0.0, 1.0), 4.0);
    float crest = clamp(vSeaP.y * 0.9 + 0.35, 0.0, 1.0);
    float sunUp = smoothstep(-0.02, 0.1, uSeaSunDir.y);
    reflectedLight.indirectDiffuse += uSeaSunCol * vec3(0.10, 0.55, 0.45) * uSeaScatter * fwd * crest * sunUp * (1.0 - seaFoamA) * 1.5;
    reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(80.0));
  }
`;
