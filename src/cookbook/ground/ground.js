// Wet ground: puddles, damp gradient, oil films, rain ripples and planar-reflected puddles, as a patch on
// any MeshStandardMaterial / MeshPhysicalMaterial used on a horizontal ground plane.
//
//   const mask = createGroundMask({ extent: [80, 80], center: [0, 0], seed: 7 });
//   const refl = createPlanarReflection(G, { height: 0, hide: [groundMesh] });   // optional (mirror puddles)
//   const gnd  = patchGround(groundMat, { mask, refl, base: 'asphalt' });
//   gnd.uniforms.uGrWater.value = 0.18;   // fraction of the area under standing water (0..~0.5)
//   gnd.uniforms.uGrRain.value  = 1.0;    // ripple-ring intensity (0 = no rain)
//
// Model (one continuous gradient, so there is never a hard "wet decal" edge):
//   mask.r = depression depth, RANK-NORMALISED: d > 1 - water ⇔ the cell is under water, so `uGrWater` is literally
//            the puddle area fraction. Around each puddle a soaked band (d within 0.10 of the water line), then
//            general dampness (mask.g * uGrWet), then dry. Roughness follows wetness 0.72 → 0.05.
//   mask.b = oil (thin-film iridescence on standing water, darker damp stain on dry ground)
//   mask.a = wear (tyre lanes: polished, darker, collect a bit more water)
// Sampled bicubically (B-spline, 4 bilinear taps) + world-space noise below the texel size, so neither the
// texels nor the puddle outlines ever look blocky.
//
// Reads: ART.surface.wet (default uGrWet), ART.weather.kind/amount (default uGrRain), G.quality.tier
// (ripple layers: low 1, med 2, high/ultra 3; asphalt detail octaves).
import { DataTexture, RGBAFormat, HalfFloatType, LinearFilter, RepeatWrapping, ClampToEdgeWrapping, Vector4, DataUtils, Vector3, Color } from 'three';
import { patch } from '../engine/patch.js';

// ---------------------------------------------------------------------------------------------------- mask
// seeded value-noise in JS (tileable not required: the mask covers a finite area)
function makeNoise(rand) {
  const P = 256, perm = new Uint8Array(P * 2), val = new Float32Array(P);
  for (let i = 0; i < P; i++) { perm[i] = i; val[i] = rand(); }
  for (let i = P - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < P; i++) perm[i + P] = perm[i];
  const s = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const a = val[perm[X + perm[Y]]], b = val[perm[X + 1 + perm[Y]]], c = val[perm[X + perm[Y + 1]]], d = val[perm[X + 1 + perm[Y + 1]]];
    const u = s(xf), v = s(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;   // [0,1]
  };
  const fbm = (x, y, oct = 5) => { let a = 0, w = 0.5, t = 0; for (let i = 0; i < oct; i++) { a += w * n2(x, y); t += w; x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; w *= 0.5; } return a / t; };
  return { n2, fbm };
}

// Rank-normalise a Float32Array in place to a uniform [0,1] distribution (keeps order → keeps shapes).
function rankNormalise(a) {
  const n = a.length, idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((i, j) => a[i] - a[j]);
  for (let r = 0; r < n; r++) a[idx[r]] = r / (n - 1);
}

/**
 * JS-generated, seeded mask texture (HalfFloat RGBA, bilinear; the shader adds bicubic + sub-texel noise).
 * @param {object} o
 *  extent [x,z] metres covered, center [x,z], size texels (default 512 → 15 cm/texel on 80 m),
 *  seed, puddleScale (m, typical puddle size), lanes: [{ axis:'x'|'z', at, width, spacing }] tyre-wear lanes,
 *  oilSpots count, dryRects [[x0,z0,x1,z1]...] areas that never hold water (under roofs, raised kerbs).
 * @returns {{ texture, xform: Vector4, size, data, sampleDepth(x,z) }}
 */
export function createGroundMask(o = {}) {
  const { extent = [80, 80], center = [0, 0], size = 512, seed = 1, puddleScale = 3.5, oilSpots = 10,
    lanes = [{ axis: 'x', at: 0, width: 0.45, spacing: 1.7 }], dryRects = [] } = o;
  let s = seed >>> 0 || 1;
  const rand = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const { fbm, n2 } = makeNoise(rand);
  const N = size, depth = new Float32Array(N * N), damp = new Float32Array(N * N), oil = new Float32Array(N * N), wear = new Float32Array(N * N);
  const x0 = center[0] - extent[0] / 2, z0 = center[1] - extent[1] / 2, dx = extent[0] / N, dz = extent[1] / N;
  const spots = [];
  for (let i = 0; i < oilSpots; i++) spots.push([x0 + rand() * extent[0], z0 + rand() * extent[1], 0.4 + rand() * 1.4, rand() * Math.PI]);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = x0 + (i + 0.5) * dx, z = z0 + (j + 0.5) * dz, k = j * N + i;
    // domain-warped fbm: puddles are irregular blobs, connected along low "valleys"
    const wx = (fbm(x * 0.07 + 5.2, z * 0.07 + 1.3, 3) - 0.5) * 6, wz = (fbm(x * 0.07 + 9.7, z * 0.07 + 7.1, 3) - 0.5) * 6;
    let d = fbm((x + wx) / puddleScale, (z + wz) / puddleScale, 5);
    d += 0.25 * fbm(x / (puddleScale * 5), z / (puddleScale * 5), 3);  // large slow tilt: puddles cluster
    // tyre lanes: worn grooves collect water
    let w = 0;
    for (const L of lanes) {
      const c = L.axis === 'x' ? z : x, along = L.axis === 'x' ? x : z;
      for (const sgn of [-1, 1]) {
        const off = Math.abs(c - (L.at + sgn * L.spacing * 0.5));
        const jitter = (n2(along * 0.15, sgn * 13) - 0.5) * 0.25;
        w = Math.max(w, Math.exp(-((off + jitter) ** 2) / (2 * (L.width * 0.5) ** 2)));
      }
    }
    d += w * 0.12;
    for (const r of dryRects) if (x > r[0] && x < r[2] && z > r[1] && z < r[3]) d -= 2;
    depth[k] = d;
    wear[k] = w * (0.6 + 0.4 * n2(x * 0.6, z * 0.6));
    damp[k] = Math.min(1, Math.max(0, fbm(x * 0.11 + 31, z * 0.11 + 11, 4) * 1.5 - 0.25));
    // oil: stretched blobs with a streaky core
    let ov = 0;
    for (const sp of spots) {
      const ax = x - sp[0], az = z - sp[1], c = Math.cos(sp[3]), si = Math.sin(sp[3]);
      const u = (ax * c + az * si) / (sp[2] * 1.8), v = (-ax * si + az * c) / sp[2];
      ov = Math.max(ov, Math.exp(-(u * u + v * v) * 2.0) * (0.55 + 0.45 * n2(x * 2.1, z * 2.1)));
    }
    oil[k] = ov;
  }
  rankNormalise(depth);
  const data = new Uint16Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    data[k * 4] = DataUtils.toHalfFloat(depth[k]);
    data[k * 4 + 1] = DataUtils.toHalfFloat(damp[k]);
    data[k * 4 + 2] = DataUtils.toHalfFloat(oil[k]);
    data[k * 4 + 3] = DataUtils.toHalfFloat(wear[k]);
  }
  const texture = new DataTexture(data, N, N, RGBAFormat, HalfFloatType);
  texture.magFilter = LinearFilter; texture.minFilter = LinearFilter; texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  texture.name = 'groundMask';
  // world → mask uv: uv = (xz - xform.xy) * xform.zw
  const xform = new Vector4(x0, z0, 1 / extent[0], 1 / extent[1]);
  const sampleDepth = (x, z) => {
    const i = Math.min(N - 1, Math.max(0, Math.floor((x - x0) / dx))), j = Math.min(N - 1, Math.max(0, Math.floor((z - z0) / dz)));
    return depth[j * N + i];
  };
  return { texture, xform, size: N, depth, sampleDepth };
}

// ---------------------------------------------------------------------------------------------------- GLSL
// Shared ground GLSL (also pasted by weather/rain.js for puddle-biased splashes).
export const GROUND_MASK_GLSL = /*glsl*/`
uniform sampler2D uGrMask;
uniform vec4 uGrXf;
uniform float uGrMaskSize;
uniform float uGrWater;
// B-spline bicubic from 4 bilinear taps (smooth, no texel diamonds)
vec4 grCubic(sampler2D tex, vec2 uv, float n) {
  vec2 st = uv * n - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / n;
  vec2 h1 = (i + 1.5 + w3 / g1) / n;
  vec4 a = texture(tex, vec2(h0.x, h0.y));
  vec4 b = texture(tex, vec2(h1.x, h0.y));
  vec4 c = texture(tex, vec2(h0.x, h1.y));
  vec4 d = texture(tex, vec2(h1.x, h1.y));
  return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
}
vec2 grMaskUV(vec2 xz) { return (xz - uGrXf.xy) * uGrXf.zw; }
`;

const GROUND_FRAG_GLSL = /*glsl*/`
uniform float uGrWet;
uniform float uGrRain;
uniform float uGrRippleScale;
uniform vec3 uGrWaterTint;
varying vec3 grW;
float grHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 grHash2(vec2 p) { float h = grHash(p); return vec2(h, grHash(p + h + 17.17)); }
float grNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(grHash(i), grHash(i + vec2(1.0, 0.0)), u.x), mix(grHash(i + vec2(0.0, 1.0)), grHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// noise faded to its mean once a pixel covers more than ~half a period (no sparkle/moire at distance)
float grNoiseAA(vec2 p, float fp) { return mix(grNoise(p), 0.5, smoothstep(0.25, 0.7, fp)); }

// Rain ripples: cells of 1/scale m, each spawns a ring at a hashed place/time. Returns the height gradient
// (xz) of the water surface; amplitude decays as the ring grows. 3x3 neighbourhood so rings cross cells.
vec2 grRippleLayer(vec2 p, float t, float seed) {
  vec2 c = floor(p);
  vec2 f = fract(p);
  vec2 g = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 h = grHash2(c + o + seed);
      float life = fract(t * (0.9 + 0.5 * h.y) + h.x * 7.31);
      vec2 d = f - (o + 0.15 + 0.7 * h);        // pixel relative to the drop centre
      float r = length(d) + 1e-4;
      float R = life * 0.85;                     // ring front radius (cell units)
      float x = (r - R) * 18.0;                  // phase across the ring (≈ 3 crests around the front)
      float env = exp(-0.12 * x * x);
      float amp = (1.0 - life) * (1.0 - life) * smoothstep(0.0, 0.04, life);
      // d/dr [ sin(x) * env ] * dx/dr
      float dh = (cos(x) - 0.24 * x * sin(x)) * env * 18.0 * amp;
      g += dh * d / r;
    }
  }
  return g;
}
`;

/**
 * Patch a ground material. Assumes a horizontal plane (world up = +Y).
 * @param {Material} material MeshStandardMaterial/MeshPhysicalMaterial
 * @param {object} o
 *  mask: createGroundMask() result (required) · refl: createPlanarReflection() result (optional)
 *  base: 'asphalt' adds procedural aggregate/tar/stain albedo+roughness+bump; 'none' keeps the material's maps
 *  water (0..1) puddle area fraction · wet (0..1) dampness · rain (0..1) ripples · tier override
 *  waterTint linear colour of standing water body ([0.035,0.032,0.028])
 * @returns {{ uniforms, material }}
 */
export function patchGround(material, o = {}) {
  const G = o.G || (typeof window !== 'undefined' && window.__G);
  const ART = (G && G.ART) || {};
  const tier = o.tier || (G && G.quality.tier) || 'high';
  const rippleLayers = { low: 1, med: 2, high: 3, ultra: 3 }[tier] || 3;
  const weather = ART.weather || {};
  const mask = o.mask;
  if (!mask) throw new Error('patchGround: opts.mask (createGroundMask) is required');
  const uniforms = {
    uGrMask: { value: mask.texture },
    uGrXf: { value: mask.xform },
    uGrMaskSize: { value: mask.size },
    uGrWater: { value: o.water ?? 0.16 },
    uGrWet: { value: o.wet ?? (ART.surface?.wet ?? 0.8) },
    uGrRain: { value: o.rain ?? (weather.kind === 'rain' ? (weather.amount ?? 0.7) : 0) },
    uGrRippleScale: { value: o.rippleScale ?? 3.2 },  // ripple cells per metre
    uGrWaterTint: { value: new Color().fromArray(o.waterTint || [0.035, 0.032, 0.028]) },
  };
  const refl = o.refl;
  if (refl) Object.assign(uniforms, refl.uniforms);
  const asphalt = (o.base || 'asphalt') === 'asphalt';
  const key = `ground${asphalt ? 'A' : ''}${refl ? 'R' : ''}${rippleLayers}`;

  patch(material, key, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let defs = `#define GR_RIPPLE_LAYERS ${rippleLayers}\n`;
    if (asphalt) defs += '#define GR_ASPHALT\n';
    if (refl) defs += '#define GR_REFL\n';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'varying vec3 grW;\n#include <common>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  grW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', defs + '#include <common>\n' + GROUND_MASK_GLSL + GROUND_FRAG_GLSL + (refl ? REFL_DECL : ''))
      // 1. surface state + albedo
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + GR_STATE)
      // 2. roughness: continuous wet → dry gradient
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = grRough;')
      // 3. normal: dry bump, flat water + ripples
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + GR_NORMAL)
      // 4. water F0 + oil thin film
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + GR_SPEC)
      // 5. planar reflection replaces IBL radiance on wet areas
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + (refl ? GR_REFL_INJECT : ''))
      // 6. clamp the sun's GGX peak on mirror water (fireflies)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(40.0));');
  });
  return { uniforms, material };
}

const REFL_DECL = /*glsl*/`
uniform sampler2D uReflTex;
uniform mat4 uReflMat;
uniform float uReflOn;
uniform float uReflLod;
`;

// runs after <map_fragment>: computes the wetness state used by all later stages
const GR_STATE = /*glsl*/`
  vec2 grP = grW.xz;
  float grFp = length(fwidth(grP));                 // metres per pixel (footprint)
  vec4 grM = grCubic(uGrMask, grMaskUV(grP), uGrMaskSize);
  // sub-texel detail on the water line so puddle outlines are organic at any distance
  float grD = grM.r + (grNoiseAA(grP * 1.7, grFp * 1.7) - 0.5) * 0.05 + (grNoiseAA(grP * 6.3, grFp * 6.3) - 0.5) * 0.022;
  float grLine = 1.0 - uGrWater;
  float grAw = max(fwidth(grD) * 0.75, 0.003);
  float grPuddle = smoothstep(grLine - grAw, grLine + grAw + 0.006, grD) * step(0.001, uGrWater);
  float grSoak = smoothstep(grLine - 0.10, grLine - 0.005, grD) * step(0.001, uGrWater);
  float grDamp = uGrWet * clamp(0.3 + 0.9 * grM.g + 0.4 * grM.a, 0.0, 1.0);
  // one continuous wetness value: 0 dry · ~0.5 damp · ~0.8 soaked · 1 standing water
  float grWet = max(grPuddle, max(grSoak * 0.82 * max(uGrWet, 0.5), grDamp * 0.55));
  float grOil = grM.b;
  float grBaseRough = 0.72;
  vec3 grBump = vec3(0.0);                          // dry-surface height gradient (x, z) + cavity
#ifdef GR_ASPHALT
  {
    // aggregate (stones) at two scales, faded by footprint; tar-bleed patches; stains; tyre polish
    float a1 = grNoiseAA(grP * 41.0, grFp * 41.0);
    float a2 = grNoiseAA(grP * 133.0, grFp * 133.0);
    float big = grNoise(grP * 0.23) * 0.6 + grNoise(grP * 0.9) * 0.4;
    float tar = smoothstep(0.62, 0.78, grNoise(grP * 0.55 + 13.0));
    float stone = smoothstep(0.55, 0.9, a1) * 0.6 + smoothstep(0.55, 0.95, a2) * 0.4;
    // albedo: fresh-ish asphalt 0.06-0.12, light aggregate up to ~0.16
    vec3 asph = mix(vec3(0.060, 0.058, 0.056), vec3(0.105, 0.100, 0.094), big);
    asph = mix(asph, vec3(0.15, 0.145, 0.138), stone * 0.4);
    asph = mix(asph, vec3(0.035, 0.034, 0.033), tar * 0.6);
    asph = mix(asph, asph * 0.72, grM.a * 0.6);                 // rubber-darkened lanes
    asph *= mix(1.0, 0.62, grOil);
    diffuseColor.rgb *= asph;                                   // material.color tints (default white)
    grBaseRough = mix(0.78, 0.62, stone * 0.5) - grM.a * 0.12 - tar * 0.1;
    // bump from the aggregate noise (finite differences in world space, faded with distance)
    float e = 0.004;
    float hC = grNoise(grP * 41.0) + 0.5 * grNoise(grP * 133.0);
    float hX = grNoise((grP + vec2(e, 0.0)) * 41.0) + 0.5 * grNoise((grP + vec2(e, 0.0)) * 133.0);
    float hZ = grNoise((grP + vec2(0.0, e)) * 41.0) + 0.5 * grNoise((grP + vec2(0.0, e)) * 133.0);
    float bf = (1.0 - smoothstep(0.004, 0.03, grFp)) * 0.0022;
    grBump = vec3((hX - hC) / e * bf, (hZ - hC) / e * bf, stone);
  }
#endif
  // wet darkening (water fills micro-pores: albedo darker + more saturated), standing water: body tint
  float grDark = max(grSoak * 0.85, grDamp * 0.7) * (1.0 - grPuddle);
  vec3 grDry = diffuseColor.rgb;
  float grL = dot(grDry, vec3(0.333));
  vec3 grWetCol = mix(vec3(grL), grDry, 1.25) * 0.5;
  diffuseColor.rgb = mix(grDry, max(grWetCol, vec3(0.0)), grDark);
  diffuseColor.rgb = mix(diffuseColor.rgb, uGrWaterTint + diffuseColor.rgb * 0.25, grPuddle);
  float grRough = mix(grBaseRough, 0.05, grWet);
  grRough = mix(grRough, 0.03, grPuddle);
  // rain ripple gradient (used by the normal and reflection stages)
  vec2 grRip = vec2(0.0);
  {
    float rw = max(grPuddle, grSoak * 0.35) * uGrRain;
    if (rw > 0.001) {
      vec2 rp = grP * uGrRippleScale;
      // footprint: geometric mean of the two axes (at grazing angles the depth axis alone would kill the rings)
      vec2 fw = fwidth(grP);
      float rfp = sqrt(fw.x * fw.y) * uGrRippleScale;
      // ring wavelength ≈ 0.35 cells: fade before the pixel footprint reaches ~1/4 of it
      float aa = 1.0 - smoothstep(0.03, 0.10, rfp);
      grRough += (1.0 - aa) * 0.06 * rw;              // unresolved ripples = rougher water
      if (aa > 0.0) {
        float t = uTime;
        grRip += grRippleLayer(rp, t, 0.0);
#if GR_RIPPLE_LAYERS > 1
        grRip += grRippleLayer(rp * 1.37 + 5.3, t * 1.13, 3.1) * 0.8;
#endif
#if GR_RIPPLE_LAYERS > 2
        grRip += grRippleLayer(rp * 0.71 + 9.1, t * 0.87, 7.7) * 0.9;
#endif
        grRip *= 0.0016 * rw * aa * uGrRippleScale;
      }
    }
  }
`;

const GR_NORMAL = /*glsl*/`
  {
    vec2 bg = grBump.xy * (1.0 - grWet * 0.85);       // water fills the texture → smoother
    vec3 nW = normalize(vec3(-(bg.x + grRip.x), 1.0, -(bg.y + grRip.y)));
    vec3 nV = normalize(mat3(viewMatrix) * nW);
    // keep any existing normal map on dry ground, flatten it under water
    normal = normalize(mix(normal, nV, max(grPuddle, 0.6)));
  }
`;

const GR_SPEC = /*glsl*/`
  {
    // water F0 ≈ 0.02; a touch higher (0.05) reads better through the tonemapper
    vec3 f0w = vec3(0.05);
    // oil thin film: interference colours vary with film thickness and view angle
    float th = grOil * 2.2 + grNoise(grP * 0.9) * 0.8 + (1.0 - abs(dot(normal, normalize(vViewPosition)))) * 0.6;
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (th + vec3(0.0, 0.33, 0.67)));
    f0w = mix(f0w, f0w * (0.4 + 1.8 * film), smoothstep(0.15, 0.6, grOil));
    material.specularColor = mix(material.specularColor, f0w, max(grPuddle, grSoak * 0.6));
  }
`;

const GR_REFL_INJECT = /*glsl*/`
#if defined( RE_IndirectSpecular )
  if (uReflOn > 0.5) {
    float r = material.roughness;
    // ripples tilt the reflected ray: shift where we sample the mirror (world-space offset → scales with distance)
    vec3 rp = grW + vec3(grRip.x, 0.0, grRip.y) * 0.6;
    vec4 rc = uReflMat * vec4(rp, 1.0);
    vec2 ruv = rc.xy / max(rc.w, 1e-4);
    vec3 vW = normalize(cameraPosition - grW);
    float graz = pow(1.0 - clamp(vW.y, 0.0, 1.0), 4.0);
    // LOD from roughness: puddles almost mirror, damp ground a soft vertically-stretched sheen
    float lodP = clamp(r * 10.0, 0.0, 6.0) + 0.25;
    float lodD = clamp(2.0 + r * 7.5 - 2.5 * graz, 1.5, 7.5);
    float lod = mix(lodD, lodP, grPuddle) + uReflLod;
    vec2 st = vec2(0.0, r * 0.09);                  // vertical stretch (anisotropic wet-road look)
    vec2 lo = vec2(0.002);
    vec2 hi = vec2(0.998);
    vec3 pr = textureLod(uReflTex, clamp(ruv, lo, hi), lod).rgb * 0.5
            + textureLod(uReflTex, clamp(ruv + st, lo, hi), lod + 0.5).rgb * 0.25
            + textureLod(uReflTex, clamp(ruv - st * 0.5, lo, hi), lod + 0.5).rgb * 0.25;
    pr = min(pr, vec3(60.0));
    // weight: mirror where smooth; rough dry asphalt keeps the (correct, blurrier) env radiance
    float pw = max(1.0 - smoothstep(0.3, 0.7, r), grPuddle);
    // screen edge: the mirror has no data outside its frustum → fade to env
    vec2 eg = smoothstep(vec2(0.0), vec2(0.04), ruv) * smoothstep(vec2(0.0), vec2(0.04), 1.0 - ruv);
    pw *= eg.x * eg.y;
    radiance = mix(radiance, pr, pw);
  }
#endif
`;
