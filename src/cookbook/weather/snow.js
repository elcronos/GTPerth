// Snow: instanced flakes in a camera-wrapped box with layered turbulence (each flake sways, spirals and gusts),
// soft round sprites with energy-conserving minimum pixel size, lit by sky + sun (wrap + weak forward lobe),
// fogged with lighting/atmos. Accumulation is a shared uniform `uSnow` (0..1) that ramps while it snows;
// materials/patch-weathering reads it to whiten up-facing surfaces. `patchSnowCover()` below is a minimal
// stand-alone version of that effect for scenes without the weathering patch.
//
//   const snow = createSnow(G, { amount: 0.8, cover: 0.7 });   // cover = uSnow target, reached after `settle` s
//   patchSnowCover(groundMat);                                  // only if materials/patch-weathering is NOT used
import { InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial, NormalBlending, Vector3, Vector2, Color } from 'three';
import { ATMOS_DECL, ATMOS_GLSL } from '../lighting/atmos.glsl.js';
import { sharedUniform, patch } from '../engine/patch.js';
import { fogUniforms } from './rain.js';

const TIER_COUNT = { low: 0.4, med: 0.7, high: 1.0, ultra: 1.3 };

const SNOW_VS = (FOG) => /*glsl*/`
attribute vec2 corner;
attribute vec4 aSeed;
uniform float uT;
uniform vec3 uBox;
uniform vec3 uWind;
uniform float uFall;
uniform float uSize;
uniform float uMinPx;
uniform vec2 uRes;
uniform float uAmount;
uniform float uGroundY;
uniform float uTurb;
uniform vec3 uAmbS;
uniform vec3 uSunS;
uniform vec3 uSunDirS;
varying vec2 vUv;
varying float vA;
varying vec3 vCol;
${FOG}
void main() {
  float sp = 0.75 + 0.5 * aSeed.w;                       // big flakes fall a bit faster
  vec3 base = aSeed.xyz * uBox + vec3(uWind.x, -uFall * sp, uWind.z) * uT;
  // turbulence: per-flake sway + spiral + slow spatial gust field (cheap stand-in for curl noise)
  float ph = aSeed.w * 6.2831;
  vec3 tb = vec3(sin(uT * (0.7 + aSeed.x) + ph) * 0.35 + sin(uT * 2.3 + ph * 3.0) * 0.08,
                 sin(uT * 1.1 + ph * 2.0) * 0.12,
                 cos(uT * (0.6 + aSeed.y) + ph) * 0.35 + cos(uT * 2.7 + ph * 5.0) * 0.08);
  vec3 g = base * 0.07;
  tb.xz += vec2(sin(g.y + uT * 0.31 + sin(g.z * 1.7)), cos(g.x * 1.3 + uT * 0.27 + sin(g.y))) * 1.2;
  vec3 p = base + tb * uTurb;
  vec3 c = cameraPosition + vec3(0.0, uBox.y * 0.2, 0.0);
  p = mod(p - c + 0.5 * uBox, uBox) - 0.5 * uBox + c;
  float alive = step(aSeed.w, uAmount) * step(uGroundY, p.y);
  vec4 cp = projectionMatrix * viewMatrix * vec4(p, 1.0);
  if (cp.w < 0.15 || alive < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
  float size = uSize * (0.5 + aSeed.w);
  vec2 hr = 0.5 * uRes;
  float px = size * projectionMatrix[1][1] * hr.y / cp.w;
  float P = max(px, uMinPx);
  float energy = (px * px) / (P * P);                    // area ratio: sub-pixel flakes dim, never flicker
  gl_Position = cp + vec4(corner * P / hr * cp.w, 0.0, 0.0);
  vec3 lp = abs(p - c) / (0.5 * uBox);
  float edge = 1.0 - smoothstep(0.75, 1.0, max(lp.x, max(lp.y, lp.z)));
  float dist = length(p - cameraPosition);
  vA = energy * edge * smoothstep(0.5, 1.6, dist);      // flakes at the lens would be huge blurry discs
  vUv = corner;
  vec3 vd = normalize(p - cameraPosition);
  float mu = dot(vd, uSunDirS);
  float sunUp = smoothstep(-0.05, 0.08, uSunDirS.y);
  // ice crystals: diffuse-ish (0.6) plus a mild forward glow when back-lit
  vec3 L = uAmbS + uSunS * (0.12 + 0.25 * pow(max(mu, 0.0), 6.0)) * sunUp;
  vCol = atmosApply(L * 0.85, p, cameraPosition);
}
`;
const SNOW_FS = /*glsl*/`
uniform float uOpacity;
varying vec2 vUv;
varying float vA;
varying vec3 vCol;
void main() {
  float r = length(vUv);
  float a = smoothstep(1.0, 0.35, r) * vA * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol, a);
}
`;

/**
 * @param {object} o count (6000 × tier) · box · fall m/s (1.0) · wind · size m (0.012) · amount (0..1)
 *  turbulence (1) · cover (uSnow target, ART.surface.snow) · settle (s to reach cover, 40) · groundY
 */
export function createSnow(G, o = {}) {
  const ART = G.ART || {};
  const tier = G.quality.tier;
  const count = Math.round((o.count ?? 9000) * (TIER_COUNT[tier] ?? 1));
  const box = o.box || [30, 16, 30];
  const wind = o.wind || ART.weather?.wind || [0.6, 0, 0.2];
  const uSnow = sharedUniform('uSnow', 'float', 0);
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  let s = (o.seed ?? 5) >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = count;
  const res = new Vector2(1, 1);
  const uniforms = {
    ...fogUniforms(G),
    uT: { value: 0 }, uBox: { value: new Vector3().fromArray(box) }, uWind: { value: new Vector3().fromArray(wind) },
    uFall: { value: o.fall ?? 1.0 }, uSize: { value: o.size ?? 0.02 }, uMinPx: { value: o.minPx ?? 1.5 }, uRes: { value: res },
    uAmount: { value: o.amount ?? ART.weather?.amount ?? 0.7 }, uGroundY: { value: o.groundY ?? -1e4 }, uTurb: { value: o.turbulence ?? 1 },
    uAmbS: { value: new Color().fromArray(o.ambient || [0.55, 0.6, 0.7]) }, uSunS: { value: new Vector3() }, uSunDirS: { value: new Vector3() },
    uOpacity: { value: o.opacity ?? 0.9 },
  };
  const mat = new ShaderMaterial({ uniforms, vertexShader: SNOW_VS(ATMOS_DECL + ATMOS_GLSL), fragmentShader: SNOW_FS, transparent: true, depthWrite: false, blending: NormalBlending });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.userData.noReflect = true; mesh.name = 'snow';
  G.scene.add(mesh);
  const cover = o.cover ?? ART.surface?.snow ?? 0.6, settle = o.settle ?? 40;
  const api = {
    mesh, uniforms, uSnow, cover,
    get amount() { return uniforms.uAmount.value; }, set amount(v) { uniforms.uAmount.value = v; },
  };
  const update = (dt, t) => {
    uniforms.uT.value = t;
    G.renderer.getDrawingBufferSize(res);
    uniforms.uSunDirS.value.copy(G.sun.dir);
    uniforms.uSunS.value.set(G.sun.color.r, G.sun.color.g, G.sun.color.b).multiplyScalar(G.sun.intensity);
    // accumulate toward `cover` while snowing, melt slowly when it stops
    const a = uniforms.uAmount.value, target = a > 0.01 ? api.cover : 0;
    const rate = (target > uSnow.value ? a / settle : 1 / (settle * 3)) * dt;
    uSnow.value += Math.sign(target - uSnow.value) * Math.min(Math.abs(target - uSnow.value), rate);
    mesh.visible = a > 0.001;
  };
  G.on('update', update);
  api.update = update;
  api.dispose = () => { geo.dispose(); mat.dispose(); G.scene.remove(mesh); };
  return api;
}

/** Minimal snow cover from uSnow: up-facing, noise-broken white layer with rougher, brighter BRDF. */
export function patchSnowCover(material, { sharpness = 0.25 } = {}) {
  sharedUniform('uSnow', 'float', 0);
  return patch(material, 'snowCover', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'varying vec3 snW;\nvarying vec3 snN;\n#include <common>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  snW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  snN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `varying vec3 snW;\nvarying vec3 snN;\n#include <common>
float snHash(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float snNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(snHash(i), snHash(i + vec2(1.0, 0.0)), u.x), mix(snHash(i + vec2(0.0, 1.0)), snHash(i + vec2(1.0, 1.0)), u.x), u.y); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  float snN0 = snNoise(snW.xz * 0.7) * 0.6 + snNoise(snW.xz * 3.1) * 0.4;
  float snUp = smoothstep(0.35, 0.8, normalize(snN).y);
  float snCov = smoothstep(1.0 - uSnow - ${sharpness.toFixed(3)}, 1.0 - uSnow + ${sharpness.toFixed(3)}, snN0 * 0.6 + snUp * 0.6) * snUp;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.92), snCov);
  roughnessFactor = mix(roughnessFactor, 0.62, snCov);`);
  });
}
