// Shared bits for every fx pool: GLSL helpers (heat ramp, soft-depth fade, fog hookup), the shared fx
// uniforms object, the instanced-pool container (zero allocation: swap-remove, typed arrays, update ranges)
// and premultiplied-alpha blending (ONE, ONE_MINUS_SRC_ALPHA): alpha = 0 means purely additive light, so fire,
// smoke and sparks share one blend mode and one rule ("rgb is radiance already multiplied by coverage").
import {
  InstancedBufferGeometry, InstancedBufferAttribute, DynamicDrawUsage, Mesh, CustomBlending, OneFactor,
  OneMinusSrcAlphaFactor, Vector2, Vector3, Texture,
} from 'three';
import { patchUniforms } from '../engine/patch.js';
import { ATMOS_DECL, ATMOS_GLSL } from '../lighting/atmos.glsl.js';

// Fog: if lighting/atmos.js installAtmos(G) ran, particles use THE atmosphere (same as every surface).
// Otherwise these no-op stand-ins keep the shaders compiling.
const ATMOS_STUB = /*glsl*/`
vec3 atmosTransmittance(vec3 wpos, vec3 cam) { return vec3(1.0); }
vec3 atmosInscatter(vec3 rd) { return vec3(0.0); }
`;
export const hasAtmos = () => !!patchUniforms.uFogSigma;
export function fogChunk() { return hasAtmos() ? ATMOS_DECL + ATMOS_GLSL : ATMOS_STUB; }
export function fogUniforms() {
  if (!hasAtmos()) return {};
  const o = {};
  for (const k of ['uSunDir', 'uSunColor', 'uFogSigma', 'uFogScatter', 'uFogFalloff', 'uFogBase', 'uFogSunInscatter', 'uFogStart']) o[k] = patchUniforms[k];
  return o;
}

// One uniforms object shared (by reference) by every fx material → one update per frame for all of them.
export function createFxUniforms() {
  const blank = new Texture();
  return {
    uFxTime: { value: 0 },
    uFxRes: { value: new Vector2(1920, 1080) },       // render-target pixel size (for min-pixel-width streaks)
    uFxDepth: { value: blank },                       // linear view depth (metres), e.g. G.post.targets.zHalf
    uFxSoftOn: { value: 0 },                          // 1 when uFxDepth is valid
    uFxSunDir: { value: new Vector3(0, 1, 0) },
    uFxSun: { value: new Vector3(1, 1, 1) },          // sun radiance (colour * intensity, linear)
    uFxAmbUp: { value: new Vector3(0.3, 0.32, 0.36) }, // ambient radiance from above (sky)
    uFxAmbDown: { value: new Vector3(0.12, 0.1, 0.08) },
    uFxExposureComp: { value: 1 },                    // global multiplier for emissive fx (art knob)
  };
}

export const FX_GLSL = /*glsl*/`
uniform float uFxTime;
uniform vec2 uFxRes;
uniform sampler2D uFxDepth;
uniform float uFxSoftOn;
uniform vec3 uFxSunDir;
uniform vec3 uFxSun;
uniform vec3 uFxAmbUp;
uniform vec3 uFxAmbDown;
uniform float uFxExposureComp;
// temperature ramp for hot things (0 = cold/black, 1 = ~6000K white). HDR, linear.
vec3 fxHeat(float h) {
  h = clamp(h, 0.0, 1.0);
  vec3 c = vec3(smoothstep(0.0, 0.35, h), smoothstep(0.18, 0.75, h) * 0.78, smoothstep(0.55, 1.0, h) * 0.62);
  return c * (0.25 + 9.0 * h * h * h);
}
float fxHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float fxNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), u.x), mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + 1.0), u.x), u.y);
}
// soft-particle fade: 0 where the particle touches opaque geometry, 1 when "softDist" metres in front.
// clip = (clip.x, clip.y, clip.w) of this fragment; viewZ = positive distance along the view axis.
float fxSoft(vec3 clip, float viewZ, float softDist) {
  float f = clamp((viewZ - 0.25) / 0.6, 0.0, 1.0);
  if (uFxSoftOn > 0.5) {
    vec2 uv = clip.xy / clip.z * 0.5 + 0.5;
    // farthest of a 2x2 footprint: the depth source may be half-res / checkerboarded (post zHalf); taking the max
    // avoids dotted holes along silhouettes behind the particle (min would punch them, a single tap flickers)
    vec2 ts = vec2(textureSize(uFxDepth, 0));
    ivec2 c = ivec2(uv * ts - 0.5);
    ivec2 mx = ivec2(ts) - 1;
    float sz = max(max(texelFetch(uFxDepth, clamp(c, ivec2(0), mx), 0).r, texelFetch(uFxDepth, clamp(c + ivec2(1, 0), ivec2(0), mx), 0).r),
                   max(texelFetch(uFxDepth, clamp(c + ivec2(0, 1), ivec2(0), mx), 0).r, texelFetch(uFxDepth, clamp(c + ivec2(1, 1), ivec2(0), mx), 0).r));
    f *= clamp((sz - viewZ) / softDist, 0.0, 1.0);
  }
  return f;
}
`;

// premultiplied-alpha blending for every fx material
export const PREMUL = {
  transparent: true, depthWrite: false, blending: CustomBlending,
  blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: OneFactor, blendDstAlpha: OneMinusSrcAlphaFactor,
};

// Instanced pool: `layout` = { attrName: itemSize } for GPU attributes, `cpu` = { name: itemSize } CPU-only state.
// Live particles are always packed in [0, n): spawn = n++, kill = copy last into the hole.
export class Pool {
  constructor(cap, base, material, layout, cpu = {}) {
    this.cap = cap; this.n = 0;
    const g = new InstancedBufferGeometry();
    g.index = base.index; for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
    this.arrays = {}; this.attrs = [];
    for (const k in layout) {
      const s = layout[k], a = new InstancedBufferAttribute(new Float32Array(cap * s), s);
      a.setUsage(DynamicDrawUsage); g.setAttribute(k, a); this.arrays[k] = a.array; this.attrs.push(a);
    }
    for (const k in cpu) this.arrays[k] = new Float32Array(cap * cpu[k]);
    this.sizes = { ...layout, ...cpu };
    this.keys = Object.keys(this.sizes);
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new Mesh(g, material);
    this.mesh.frustumCulled = false;
  }
  spawn() {
    if (this.n >= this.cap) this.kill(0); // full: recycle the oldest-ish slot (index 0 tends to be oldest)
    return this.n++;
  }
  kill(i) {
    const last = --this.n;
    if (i !== last) for (const k of this.keys) {
      const s = this.sizes[k], a = this.arrays[k];
      for (let c = 0; c < s; c++) a[i * s + c] = a[last * s + c];
    }
  }
  swap(i, j) {
    for (const k of this.keys) {
      const s = this.sizes[k], a = this.arrays[k];
      for (let c = 0; c < s; c++) { const t = a[i * s + c]; a[i * s + c] = a[j * s + c]; a[j * s + c] = t; }
    }
  }
  commit() {
    for (const a of this.attrs) { a.clearUpdateRanges(); if (this.n) a.addUpdateRange(0, this.n * a.itemSize); a.needsUpdate = true; }
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
  }
  dispose() { this.geo.dispose(); this.mesh.material.dispose(); }
}

// tier scaling helper: cap counts per quality tier
export const TIER_SCALE = { low: 0.4, med: 0.7, high: 1, ultra: 1.3 };
