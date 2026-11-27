// Rain: ~9k velocity-stretched streaks in a box that wraps around the camera, back-lit by the sun (Henyey-
// Greenstein forward lobe: rain glows when you look toward the sun), puddle-biased splash crowns on the ground,
// optional lens drops (GLSL for the post pass). Everything is one draw call each, vertex-pulled from a seed, so
// nothing is simulated on the CPU and the hot path allocates nothing.
//
//   const rain = createRain(G, { groundY: 0, mask, ground: gnd });   // mask/ground: ground.js → splashes prefer puddles
//   rain.amount = 0.8;                                               // 0..1 (fraction of drops alive), live
//   // lens drops: the post owner pastes RAIN_LENS_GLSL and offsets its scene UV:
//   //   vec3 ld = rainLens(uv, uTime, uRainLens, aspect); uv += ld.xy; col *= 1.0 - 0.15*ld.z;
//
// Anti-aliasing rule: a streak is never thinner than `minPx` (0.75 px default, 1.0 on high/ultra); when its true
// width is smaller its alpha is scaled by true/clamped width, so total energy is constant and nothing flickers.
// Particles are fogged with lighting/atmos (transmittance only — they are additive).
// Hidden in planar reflections (userData.noReflect). Shelters: up to 4 AABBs where rain is killed (interiors).
import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial, AdditiveBlending,
  Vector3, Vector2, Vector4, Color,
} from 'three';
import { ATMOS_DECL, ATMOS_GLSL } from '../lighting/atmos.glsl.js';
import { atmosUniforms, installAtmos } from '../lighting/atmos.js';
import { GROUND_MASK_GLSL } from '../ground/ground.js';

export function fogUniforms(G) {
  try { return atmosUniforms(); } catch (e) { installAtmos(G); return atmosUniforms(); }
}

const TIER_COUNT = { low: 0.4, med: 0.7, high: 1.0, ultra: 1.3 };

// shared lighting for water particles: ambient (sky) + sun HG forward lobe
export const DROP_LIGHT_GLSL = /*glsl*/`
uniform vec3 uRAmb;
uniform vec3 uRSun;
uniform vec3 uRSunDir;
uniform float uRFlash;
float rainHG(float mu, float g) { float g2 = g * g; return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5); }
vec3 dropLight(vec3 viewDir) {
  float mu = dot(viewDir, uRSunDir);
  // two lobes: tight forward glint through the drop + broad haze; normalised HG×4π (mean 1)
  float ph = 0.55 * rainHG(mu, 0.86) + 0.45 * rainHG(mu, 0.35);
  float sunUp = smoothstep(-0.05, 0.08, uRSunDir.y);
  return uRAmb * (1.0 + uRFlash * 6.0) + uRSun * ph * 0.05 * sunUp;
}
`;

const RAIN_VS = (LIGHT, FOG) => /*glsl*/`
attribute vec2 corner;      // x: side -1..1, y: 0 head, 1 tail
attribute vec4 aSeed;
uniform float uT;
uniform vec3 uBox;
uniform vec3 uBoxOff;
uniform vec3 uVel;
uniform float uSpeedVar;
uniform float uShutter;
uniform float uWidth;
uniform float uMinPx;
uniform vec2 uRes;
uniform float uAmount;
uniform float uGroundY;
uniform vec4 uShelterMin[4];
uniform vec4 uShelterMax[4];
varying vec2 vC;
varying float vA;
varying vec3 vCol;
${LIGHT}
${FOG}
bool sheltered(vec3 p) {
  for (int i = 0; i < 4; i++) {
    if (uShelterMin[i].w > 0.5 && all(greaterThan(p, uShelterMin[i].xyz)) && all(lessThan(p, uShelterMax[i].xyz))) return true;
  }
  return false;
}
void main() {
  vec3 vel = uVel * (1.0 + (aSeed.w - 0.5) * uSpeedVar);
  // world position moving with time, wrapped into a box centred near the camera
  vec3 c = cameraPosition + uBoxOff;
  vec3 p = aSeed.xyz * uBox + vel * uT;
  p = mod(p - c + 0.5 * uBox, uBox) - 0.5 * uBox + c;
  vec3 a = p;                                // head
  vec3 b = p - vel * uShutter;               // tail: where the drop was one shutter time ago
  float alive = step(aSeed.w, uAmount) * step(uGroundY, a.y);
  if (sheltered(a)) alive = 0.0;
  b.y = max(b.y, uGroundY);
  vec4 ca = projectionMatrix * viewMatrix * vec4(a, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(b, 1.0);
  // behind / too close to the camera: collapse
  if (ca.w < 0.2 || cb.w < 0.2 || alive < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
  vec2 hr = 0.5 * uRes;
  vec2 sa = ca.xy / ca.w * hr;
  vec2 sb = cb.xy / cb.w * hr;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(0.0, -1.0);
  vec2 perp = vec2(-dir.y, dir.x);
  // true width in pixels at this depth, clamped to minPx with energy conservation
  float wpx = uWidth * projectionMatrix[1][1] * hr.y / ca.w;
  float W = max(wpx, uMinPx);
  float energy = wpx / W;
  float isTail = corner.y;
  vec2 s = mix(sa, sb, isTail) + perp * corner.x * W * 0.5 + dir * (isTail * 2.0 - 1.0) * W * 0.5;
  vec4 cc = mix(ca, cb, isTail);
  gl_Position = vec4(s / hr * cc.w, cc.z, cc.w);
  // fade at the box faces (no popping when drops wrap) and very close to the lens
  vec3 lp = abs(p - c) / (0.5 * uBox);
  float edge = 1.0 - smoothstep(0.75, 1.0, max(lp.x, max(lp.y, lp.z)));
  float dist = length(a - cameraPosition);
  float nearF = smoothstep(0.35, 1.6, dist);
  // a streak shorter than its width still covers W×W: scale so long and short streaks carry the same energy
  float lenF = min(1.0, (len + W) / max(W * 2.0, 1.0));
  vA = energy * edge * nearF * lenF;
  vC = corner;
  vec3 vd = normalize(a - cameraPosition);
  vCol = dropLight(vd) * atmosTransmittance(a, cameraPosition);
}
`;

const RAIN_FS = /*glsl*/`
uniform float uOpacity;
varying vec2 vC;
varying float vA;
varying vec3 vCol;
void main() {
  // soft profile across, bright head fading toward the tail
  float across = 1.0 - vC.x * vC.x;
  float along = mix(1.0, 0.35, vC.y);
  float a = across * across * along * vA * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

// ---- splashes: crowns on the ground, positions hashed per life-cycle, biased toward puddles
const SPLASH_VS = (LIGHT, FOG, MASK) => /*glsl*/`
attribute vec2 corner;      // -1..1 quad
attribute vec4 aSeed;
uniform float uT;
uniform float uRadius;
uniform float uGroundY;
uniform float uRate;
uniform float uAmount;
uniform float uMinPx;
uniform vec2 uRes;
uniform float uSize;
uniform float uHasMask;
varying vec2 vUv;
varying float vLife;
varying float vA;
varying vec3 vCol;
varying float vBig;
${LIGHT}
${FOG}
${MASK}
float sh1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  float cyc = uT * uRate + aSeed.w * 17.0;
  float id = floor(cyc);
  float life = fract(cyc);
  vLife = life;
  float S = uRadius * 2.0;
  // 3 candidate positions per cycle; keep the wettest (puddles get ~3x more splashes than dry asphalt)
  vec3 best = vec3(0.0);
  float bestW = -1.0;
  for (int k = 0; k < 3; k++) {
    float kk = float(k);
    vec2 r = vec2(sh1(id * 1.37 + aSeed.x * 91.7 + kk * 7.1), sh1(id * 2.11 + aSeed.y * 53.3 + kk * 3.7));
    vec2 q = r * S + aSeed.xy * S;
    // wrap around the camera (world-fixed while alive)
    vec2 c = cameraPosition.xz;
    q = mod(q - c + 0.5 * S, S) - 0.5 * S + c;
    float w = 0.0;
    if (uHasMask > 0.5) {
      float dd = texture(uGrMask, grMaskUV(q)).r;
      w = smoothstep(1.0 - uGrWater - 0.1, 1.0 - uGrWater + 0.02, dd);
    }
    w += sh1(id + kk * 5.3 + aSeed.z * 11.0) * 0.35;
    if (w > bestW) { bestW = w; best = vec3(q.x, uGroundY, q.y); }
  }
  float wet = clamp(bestW, 0.0, 1.0);
  vBig = wet;
  float alive = step(aSeed.z, uAmount);
  float size = uSize * mix(0.55, 1.0, wet) * (0.7 + 0.6 * aSeed.y);
  // cylindrical billboard standing on the ground, facing the camera
  vec3 toCam = cameraPosition - best;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + 1e-5);
  vec3 wp = best + right * corner.x * size + vec3(0.0, (corner.y * 0.5 + 0.5) * size * 1.1, 0.0);
  vec4 cp = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  float dist = length(toCam);
  float px = size * projectionMatrix[1][1] * 0.5 * uRes.y / max(cp.w, 0.01);
  float energy = clamp(px / 3.0, 0.0, 1.0);    // sub-3px splashes: fade (they would only twinkle)
  vA = alive * energy * (1.0 - smoothstep(uRadius * 0.6, uRadius, dist)) * smoothstep(0.4, 1.2, dist);
  vUv = corner;
  vCol = dropLight(normalize(best - cameraPosition)) * atmosTransmittance(best, cameraPosition);
  gl_Position = (vA > 0.001) ? cp : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const SPLASH_FS = /*glsl*/`
uniform float uOpacity;
varying vec2 vUv;
varying float vLife;
varying float vA;
varying vec3 vCol;
varying float vBig;
float sh1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  // uv: x -1..1 across, y 0 (ground) .. 1 (top) of a ~7 cm billboard
  vec2 p = vec2(vUv.x, vUv.y * 0.5 + 0.5);
  float t = vLife;
  float a = 0.0;
  // secondary droplets thrown out on ballistic arcs (crown break-up); soft gaussian dots, no hard edges
  for (int k = 0; k < 6; k++) {
    float kk = float(k);
    float ang = (kk / 5.0 - 0.5) * 2.4 + (sh1(kk + 3.1 + vBig) - 0.5) * 0.5;
    float v = 1.6 + sh1(kk * 7.7) * 1.4;
    vec2 dp = vec2(sin(ang) * v * t * 0.42, v * cos(ang) * t * 0.55 - 2.2 * t * t);
    float r = 0.075 * (1.0 - 0.5 * t);
    vec2 dd = (p - dp) / r;
    a += exp(-dot(dd, dd)) * step(-0.02, dp.y) * 0.7;
  }
  // low crown sheet early in life: a soft bright band just above the ground, widening
  float cw = 0.15 + t * 0.7;
  float band = exp(-pow((abs(p.x) - cw) / 0.09, 2.0)) * exp(-pow(p.y / (0.12 * (1.0 - t) + 0.02), 2.0));
  a += band * (1.0 - smoothstep(0.0, 0.45, t)) * 0.9;
  // central Worthington jet in puddles (late)
  float jh = 0.5 * vBig * sin(clamp((t - 0.2) * 3.0, 0.0, 3.14159));
  vec2 jd = vec2(p.x / 0.06, (p.y - jh * 0.5) / max(jh * 0.5, 0.01));
  a += exp(-dot(jd, jd)) * vBig * 0.6 * step(0.2, t);
  a = clamp(a, 0.0, 1.0) * (1.0 - t * t) * vA * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

// Lens drops: paste into a full-screen pass. Returns xy = uv offset (refraction through the drop), z = drop mask.
export const RAIN_LENS_GLSL = /*glsl*/`
float rlHash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec3 rainLensLayer(vec2 uv, float t, float cells, float seed) {
  vec2 g = uv * vec2(cells);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = rlHash(id + seed);
  float life = fract(t * (0.05 + 0.1 * h) + h * 13.0);
  // only some cells hold a drop; it appears fast, lingers, then slides off and dries
  float on = step(0.55, rlHash(id + seed + 3.3)) * smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.6, 1.0, life));
  vec2 c = (vec2(rlHash(id + 1.7), rlHash(id + 7.1)) - 0.5) * 0.5;
  c.y += smoothstep(0.55, 1.0, life) * 0.4;      // slide down near the end of its life
  float r = 0.12 + 0.18 * rlHash(id + 9.9);
  vec2 d = f - c;
  d.y *= 1.2;
  float l = length(d) / r;
  float m = smoothstep(1.0, 0.8, l) * on;
  // sphere-cap normal → refraction offset (drops invert & magnify what is behind them)
  vec2 off = -d / r * sqrt(max(1.0 - l * l, 0.0)) * (r / cells) * 1.6;
  return vec3(off * m, m);
}
vec3 rainLens(vec2 uv, float t, float amount, float aspect) {
  vec2 u = vec2(uv.x * aspect, uv.y);
  vec3 a = rainLensLayer(u, t, 7.0, 0.0);
  vec3 b = rainLensLayer(u + 0.37, t * 1.3, 13.0, 5.0);
  vec3 r = a + b * (1.0 - a.z);
  return r * amount;
}
`;

/**
 * @param {object} o count (9000 × tier mult) · box [x,y,z] m · fall m/s · wind [x,y,z] (default ART.weather.wind)
 *  shutter s (streak length = speed × shutter, 0.03) · width m (0.0012) · minPx · amount (ART.weather.amount)
 *  groundY · mask (ground.js mask) + ground (patchGround result, for uGrWater) · splashes count (900 × tier)
 *  splashSize m (0.07) · shelters [[x0,y0,z0,x1,y1,z1], ...] · brightness (2.2) · splashBrightness (0.8) · ambient [r,g,b] (sky irradiance-ish)
 */
export function createRain(G, o = {}) {
  const ART = G.ART || {};
  const tier = G.quality.tier;
  const mult = TIER_COUNT[tier] ?? 1;
  const count = Math.round((o.count ?? 9000) * mult);
  const box = o.box || [36, 18, 36];
  const wind = o.wind || ART.weather?.wind || [1.2, 0, 0.4];
  const fall = o.fall ?? 8.5;
  const fogU = fogUniforms(G);

  const light = {
    uRAmb: { value: new Color().fromArray(o.ambient || [0.22, 0.24, 0.28]) },
    uRSun: { value: new Vector3() },
    uRSunDir: { value: new Vector3() },
    uRFlash: { value: 0 },
  };
  const FOG = ATMOS_DECL + ATMOS_GLSL;

  // --- streaks
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('corner', new BufferAttribute(new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1]), 2));
  geo.setIndex([0, 2, 1, 1, 2, 3]);
  let s = (o.seed ?? 11) >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = count;
  // shelters: w = 1 marks a used slot
  const shMin4 = [], shMax4 = [];
  for (let i = 0; i < 4; i++) {
    const b = o.shelters?.[i] || [0, 0, 0, 0, 0, 0];
    shMin4.push(new Vector4(b[0], b[1], b[2], o.shelters?.[i] ? 1 : 0)); shMax4.push(new Vector4(b[3], b[4], b[5], 0));
  }
  const res = new Vector2(1, 1);
  const common = { uT: { value: 0 }, uRes: { value: res }, uAmount: { value: o.amount ?? ART.weather?.amount ?? 0.8 }, uGroundY: { value: o.groundY ?? 0 }, uOpacity: { value: o.brightness ?? 2.2 } };
  const uniforms = {
    ...fogU, ...light, ...common,
    uBox: { value: new Vector3().fromArray(box) },
    uBoxOff: { value: new Vector3(0, box[1] * 0.25, 0) },
    uVel: { value: new Vector3(wind[0], -fall + (wind[1] || 0), wind[2]) },
    uSpeedVar: { value: 0.35 },
    uShutter: { value: o.shutter ?? 0.03 },
    uWidth: { value: o.width ?? 0.0012 },
    uMinPx: { value: o.minPx ?? (tier === 'high' || tier === 'ultra' ? 1.25 : 0.85) },
    uShelterMin: { value: shMin4 },
    uShelterMax: { value: shMax4 },
  };
  const mat = new ShaderMaterial({
    uniforms, vertexShader: RAIN_VS(DROP_LIGHT_GLSL, FOG), fragmentShader: RAIN_FS,
    transparent: true, depthWrite: false, depthTest: true, blending: AdditiveBlending,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.userData.noReflect = true;
  mesh.name = 'rain';

  // --- splashes
  const sCount = Math.round((o.splashes ?? 900) * mult);
  const sgeo = new InstancedBufferGeometry();
  sgeo.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2));
  sgeo.setIndex([0, 1, 2, 2, 1, 3]);
  const sseeds = new Float32Array(sCount * 4);
  for (let i = 0; i < sseeds.length; i++) sseeds[i] = rand();
  sgeo.setAttribute('aSeed', new InstancedBufferAttribute(sseeds, 4));
  sgeo.instanceCount = sCount;
  const hasMask = !!o.mask;
  const suni = {
    ...fogU, ...light, ...common,
    uRadius: { value: o.splashRadius ?? 11 },
    uRate: { value: o.splashRate ?? 3.2 },
    uMinPx: uniforms.uMinPx,
    uSize: { value: o.splashSize ?? 0.07 },
    uHasMask: { value: hasMask ? 1 : 0 },
    uOpacity: { value: o.splashBrightness ?? 0.8 },
    uGrMask: { value: hasMask ? o.mask.texture : null },
    uGrXf: { value: hasMask ? o.mask.xform : null },
    uGrMaskSize: { value: hasMask ? o.mask.size : 1 },
    uGrWater: o.ground ? o.ground.uniforms.uGrWater : { value: 0.15 },
  };
  const smat = new ShaderMaterial({
    uniforms: suni, vertexShader: SPLASH_VS(DROP_LIGHT_GLSL, FOG, GROUND_MASK_GLSL), fragmentShader: SPLASH_FS,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const smesh = new Mesh(sgeo, smat);
  smesh.frustumCulled = false;
  smesh.renderOrder = 9;
  smesh.userData.noReflect = true;
  smesh.name = 'rainSplash';
  smesh.visible = sCount > 0;

  G.scene.add(mesh, smesh);

  const api = {
    mesh, splashes: smesh, uniforms, splashUniforms: suni, lightUniforms: light,
    get amount() { return common.uAmount.value; }, set amount(v) { common.uAmount.value = v; },
    lens: o.lens ?? 0.0,   // read by the post pass (uRainLens)
  };
  const sd = G.sun.dir, sc = G.sun.color;
  const update = (dt, t) => {
    common.uT.value = t;
    G.renderer.getDrawingBufferSize(res);
    light.uRSunDir.value.copy(sd);
    light.uRSun.value.set(sc.r, sc.g, sc.b).multiplyScalar(G.sun.intensity);
    const on = common.uAmount.value > 0.001;
    mesh.visible = on; smesh.visible = on && sCount > 0;
  };
  G.on('update', update);
  api.update = update;
  api.dispose = () => { geo.dispose(); sgeo.dispose(); mat.dispose(); smat.dispose(); G.scene.remove(mesh, smesh); };
  return api;
}
