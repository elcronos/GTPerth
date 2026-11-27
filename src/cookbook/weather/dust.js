// Dust motes: tiny floating particles that only show where the sun reaches them — they read the sun's shadow map,
// so they light up inside sun shafts (doorways, gaps between containers) and vanish in shadow. Forward-scattering
// HG phase: brightest when looking toward the sun. Slow Brownian drift + slight sparkle (tumbling facets).
// Additive, fogged with lighting/atmos (transmittance), hidden in planar reflections.
//
//   const dust = createDust(G, { count: 2500, box: [14, 6, 14] });
//   dust.amount = 1;  // 0..1
// Needs G.sun.light.castShadow = true and a rendered shadow map (lighting/shadows). Without one, motes are lit
// everywhere (set { shadow: false }).
import { InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial, AdditiveBlending, Vector3, Vector2, Matrix4, Color } from 'three';
import { ATMOS_DECL, ATMOS_GLSL } from '../lighting/atmos.glsl.js';
import { fogUniforms } from './rain.js';

const TIER_COUNT = { low: 0.4, med: 0.7, high: 1.0, ultra: 1.3 };

const DUST_VS = (FOG, SHADOW) => /*glsl*/`
#include <packing>
attribute vec2 corner;
attribute vec4 aSeed;
uniform float uT;
uniform vec3 uBox;
uniform float uSize;
uniform float uMinPx;
uniform vec2 uRes;
uniform float uAmount;
uniform vec3 uSunD;
uniform vec3 uSunDirD;
uniform vec3 uAmbD;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMat;
uniform float uHasShadow;
uniform vec3 uDrift;
uniform float uGain;
varying vec2 vUv;
varying float vA;
varying vec3 vCol;
${FOG}
float sunVis(vec3 p) {
  if (uHasShadow < 0.5) return 1.0;
  vec4 sc = uShadowMat * vec4(p, 1.0);
  vec3 s = sc.xyz / sc.w;
  if (any(lessThan(s, vec3(0.0))) || any(greaterThan(s, vec3(1.0)))) return 1.0;
  // 4 taps (shadow edges of shafts stay soft and stable as motes cross them)
  float e = 1.5 / 2048.0;
  float v = 0.0;
  v += step(s.z - 0.002, unpackRGBAToDepth(texture(uShadowMap, s.xy + vec2(-e, -e))));
  v += step(s.z - 0.002, unpackRGBAToDepth(texture(uShadowMap, s.xy + vec2(e, -e))));
  v += step(s.z - 0.002, unpackRGBAToDepth(texture(uShadowMap, s.xy + vec2(-e, e))));
  v += step(s.z - 0.002, unpackRGBAToDepth(texture(uShadowMap, s.xy + vec2(e, e))));
  return v * 0.25;
}
float hgD(float mu, float g) { float g2 = g * g; return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5); }
void main() {
  float ph = aSeed.w * 6.2831;
  // Brownian-ish drift: three incommensurate sines per axis + a slow common breeze
  vec3 w = vec3(sin(uT * 0.21 + ph) + 0.5 * sin(uT * 0.53 + ph * 2.1) + 0.25 * sin(uT * 1.31 + ph * 4.3),
                sin(uT * 0.17 + ph * 1.7) + 0.5 * sin(uT * 0.47 + ph * 3.1),
                cos(uT * 0.19 + ph * 1.3) + 0.5 * cos(uT * 0.61 + ph * 2.7) + 0.25 * cos(uT * 1.13 + ph * 5.1)) * 0.25;
  vec3 p = aSeed.xyz * uBox + w + uDrift * uT;
  vec3 c = cameraPosition;
  p = mod(p - c + 0.5 * uBox, uBox) - 0.5 * uBox + c;
  vec4 cp = projectionMatrix * viewMatrix * vec4(p, 1.0);
  float alive = step(aSeed.w, uAmount);
  if (cp.w < 0.1 || alive < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
  float size = uSize * (0.4 + 1.2 * aSeed.y * aSeed.y);
  vec2 hr = 0.5 * uRes;
  float px = size * projectionMatrix[1][1] * hr.y / cp.w;
  float P = max(px, uMinPx);
  float energy = (px * px) / (P * P);
  gl_Position = cp + vec4(corner * P / hr * cp.w, 0.0, 0.0);
  vec3 lp = abs(p - c) / (0.5 * uBox);
  float edge = 1.0 - smoothstep(0.7, 1.0, max(lp.x, max(lp.y, lp.z)));
  float dist = length(p - c);
  // tumbling flat flakes catch the light now and then (slow, so it reads as glints, not noise)
  float glint = 0.6 + 0.4 * pow(0.5 + 0.5 * sin(uT * (0.8 + 1.7 * aSeed.x) + ph * 7.0), 6.0);
  vec3 vd = normalize(p - c);
  float mu = dot(vd, uSunDirD);
  float vis = sunVis(p);
  vec3 L = uSunD * vis * (0.65 * hgD(mu, 0.75) + 0.35 * hgD(mu, 0.2)) * uGain + uAmbD;
  vA = energy * edge * smoothstep(0.25, 1.0, dist) * glint;
  vUv = corner;
  vCol = L * atmosTransmittance(p, c);
}
`;
const DUST_FS = /*glsl*/`
uniform float uOpacity;
varying vec2 vUv;
varying float vA;
varying vec3 vCol;
void main() {
  float r2 = dot(vUv, vUv);
  float a = exp(-r2 * 3.5) * vA * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

export function createDust(G, o = {}) {
  const tier = G.quality.tier;
  const count = Math.round((o.count ?? 2500) * (TIER_COUNT[tier] ?? 1));
  const box = o.box || [14, 6, 14];
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  let s = (o.seed ?? 9) >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = count;
  const res = new Vector2(1, 1);
  const useShadow = o.shadow ?? true;
  const uniforms = {
    ...fogUniforms(G),
    uT: { value: 0 }, uBox: { value: new Vector3().fromArray(box) }, uSize: { value: o.size ?? 0.0025 },
    uMinPx: { value: o.minPx ?? 1.0 }, uRes: { value: res }, uAmount: { value: o.amount ?? 1 },
    uSunD: { value: new Vector3() }, uSunDirD: { value: new Vector3() }, uAmbD: { value: new Color().fromArray(o.ambient || [0.02, 0.02, 0.022]) },
    uShadowMap: { value: null }, uShadowMat: { value: new Matrix4() }, uHasShadow: { value: 0 },
    uDrift: { value: new Vector3().fromArray(o.drift || [0.05, 0.01, 0.02]) },
    uGain: { value: o.gain ?? 2.5 },   // scattering strength of one mote (art knob)
    uOpacity: { value: o.brightness ?? 1 },
  };
  const mat = new ShaderMaterial({ uniforms, vertexShader: DUST_VS(ATMOS_DECL + ATMOS_GLSL), fragmentShader: DUST_FS, transparent: true, depthWrite: false, blending: AdditiveBlending });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.userData.noReflect = true; mesh.name = 'dust';
  G.scene.add(mesh);
  const api = { mesh, uniforms, get amount() { return uniforms.uAmount.value; }, set amount(v) { uniforms.uAmount.value = v; } };
  const update = (dt, t) => {
    uniforms.uT.value = t;
    G.renderer.getDrawingBufferSize(res);
    uniforms.uSunDirD.value.copy(G.sun.dir);
    uniforms.uSunD.value.set(G.sun.color.r, G.sun.color.g, G.sun.color.b).multiplyScalar(G.sun.intensity);
    const sh = G.sun.light && G.sun.light.shadow;
    const ok = useShadow && sh && sh.map && G.sun.light.castShadow;
    uniforms.uHasShadow.value = ok ? 1 : 0;
    if (ok) { uniforms.uShadowMap.value = sh.map.texture; uniforms.uShadowMat.value.copy(sh.matrix); }
    mesh.visible = uniforms.uAmount.value > 0.001;
  };
  G.on('update', update);
  api.update = update;
  api.dispose = () => { geo.dispose(); mat.dispose(); G.scene.remove(mesh); };
  return api;
}
