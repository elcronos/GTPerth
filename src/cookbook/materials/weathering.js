// World-space weathering for any MeshStandardMaterial / MeshPhysicalMaterial, via engine/patch.js.
//
//   import { initWeathering, patchWeathering, setWeather } from './weathering.js';
//   initWeathering(G);                                  // shared uniforms from G.ART.surface
//   patchWeathering(mat, { porosity: 0.9 });            // every material in the scene
//   setWeather({ wet: 1 });                             // runtime change (e.g. rain starts) — no recompiles
//
// What it adds (in this order, all in world space so nothing tiles with the texture):
//   1. macro variation  — low-frequency value/hue/roughness noise (0.1-1.7 cycles/m) + grime in crevices
//   2. edge wear        — curvature from screen derivatives of the world normal (bevels, rounded edges) lightens
//                         and polishes edges (opts.edge; good on painted metal and plastic)
//   3. dust             — settles on up-facing faces and in crevices (baked height from normalMap alpha)
//   4. rain wetness     — up-facing faces wet (darkened by porosity, saturated, roughness -> 0.06-0.15), vertical
//                         streaks on walls, damp splash band within ~0.55 m of uWthGround, standing water in low
//                         spots of the baked height, undersides stay dry
//   5. rain beads       — 3-8 mm droplets (dome normal + gloss), faded out by fwidth before they alias
//   6. snow             — fills crevices first, then covers up-facing faces; flattens normals
//   7. specular AA      — Tokuyoshi-Kaplanyan normal-variance roughness widening from screen-space derivatives of
//                         the final normal + Toksvig from the mip-averaged normal-map length. Kills moire/sparkle on
//                         corrugation, bevels, beads. (Also available alone: patchSpecAA.)
//
// Shared uniforms (sharedUniform, one value for every patched material):
//   uWet, uDust, uSnow (0..1), uMacro (0..1, ART.surface.macroVar), uWthGround (world Y of the ground), uSpecAA (1)
// Per-material multipliers (material.userData.wth.a / .b, Vector4):
//   a = (wet, dust, snow, edge)   b = (porosity, beads, macro, edgeMetal)
import { Vector4 } from 'three';
import { patch, sharedUniform } from '../engine/patch.js';
import { NOISE_GLSL } from './noise.glsl.js';

export const W = {
  wet: sharedUniform('uWet', 'float', 0),
  dust: sharedUniform('uDust', 'float', 0),
  snow: sharedUniform('uSnow', 'float', 0),
  macro: sharedUniform('uMacro', 'float', 0.25),
  ground: sharedUniform('uWthGround', 'float', 0),
  specAA: sharedUniform('uSpecAA', 'float', 1),
};

// Per-material multiplier presets (merged under explicit opts). makeMaterial picks 'ground' for ground-class surfaces.
//   prop      — the defaults: everything on
//   ground    — terrain / floors / roads: no dust (up-facing dust would turn the whole terrain beige; dusty ground is
//               an albedo choice, not a coating), no beads (a water film, not droplets, sits on flat ground)
//   sheltered — under a roof / indoors: no rain, no snow, light dust
export const WEATHER_PRESETS = {
  prop: {},
  ground: { dust: 0, beads: 0 },
  sheltered: { wet: 0, snow: 0, beads: 0, dust: 0.5 },
};

export function initWeathering(G) {
  const s = (G && G.ART && G.ART.surface) || {};
  setWeather({ wet: s.wet ?? 0, dust: s.dust ?? 0, snow: s.snow ?? 0, macro: s.macroVar ?? 0.25 });
  return W;
}
export function setWeather({ wet, dust, snow, macro, ground, specAA } = {}) {
  if (wet !== undefined) W.wet.value = wet;
  if (dust !== undefined) W.dust.value = dust;
  if (snow !== undefined) W.snow.value = snow;
  if (macro !== undefined) W.macro.value = macro;
  if (ground !== undefined) W.ground.value = ground;
  if (specAA !== undefined) W.specAA.value = specAA;
}

// --- shared shader plumbing (also used by triplanar.js) -----------------------------------------------
// world position + world geometric normal varyings (instancing/batching aware)
export function ensureWorldVaryings(shader) {
  if (!shader.vertexShader.includes('vWthPos')) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWthPos;\nvarying vec3 vWthN;')
      .replace('#include <project_vertex>', /*glsl*/`#include <project_vertex>
  {
    vec4 wthW = vec4(transformed, 1.0);
#ifdef USE_BATCHING
    wthW = batchingMatrix * wthW;
#endif
#ifdef USE_INSTANCING
    wthW = instanceMatrix * wthW;
#endif
    vWthPos = (modelMatrix * wthW).xyz;
    vWthN = inverseTransformDirection(transformedNormal, viewMatrix);
  }`);
  }
  if (!shader.fragmentShader.includes('vWthPos')) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vWthPos;\nvarying vec3 vWthN;\nfloat matNLen = 1.0;\nfloat matTpH = 0.5;\n');
  }
}
export function ensureNoise(shader) {
  if (!shader.fragmentShader.includes('NZ_LIB')) shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + NOISE_GLSL);
}

const WEATHER_FRAG = /*glsl*/`
{
  vec3 wP = vWthPos;
  vec3 wN = normalize(vWthN);
#ifdef DOUBLE_SIDED
  wN *= faceDirection;
#endif
  float wH = 0.5;
#if defined( USE_NORMALMAP_TANGENTSPACE ) && !defined( MAT_TRIPLANAR )
  vec4 wNT = texture2D(normalMap, vNormalMapUv);
  wH = wNT.a; matNLen = length(wNT.xyz * 2.0 - 1.0);
#endif
#ifdef MAT_TRIPLANAR
  wH = matTpH;
#endif
  // 1. macro variation
  float mA = vnoise3(wP * 0.11), mB = vnoise3(wP * 0.37 + 17.0), mC = vnoise3(wP * 1.7 + 5.0);
  float mk = uMacro * uWthB.z;
  diffuseColor.rgb *= 1.0 + mk * (mA * 0.6 + mB * 0.4 - 0.5) * 0.8;
  diffuseColor.rgb *= mix(vec3(1.0), vec3(1.07, 1.0, 0.9), clamp((mB - 0.5) * 3.0 * mk, -1.0, 1.0));
  float grime = smoothstep(0.5, 0.85, mA * 0.45 + mC * 0.3 + (1.0 - wH) * 0.4) * mk;
  diffuseColor.rgb *= 1.0 - grime * 0.5;
  roughnessFactor = clamp(roughnessFactor * (1.0 + mk * (mB - 0.5) * 0.6) + grime * 0.08, 0.0, 1.0);
  // 2. edge wear (curvature in 1/m from derivatives; ~1/radius on bevels)
  if (uWthA.w > 0.0) {
    float curv = length(fwidth(wN)) / max(length(fwidth(wP)), 1e-5);
    float edge = smoothstep(20.0, 60.0, curv) * smoothstep(0.4, 0.62, mC * 0.6 + vnoise3(wP * 14.0) * 0.4) * uWthA.w;
    float el = dot(diffuseColor.rgb, vec3(0.333));
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(el * 1.5 + 0.06), vec3(0.5), uWthB.w), edge * 0.75);
    roughnessFactor = mix(roughnessFactor, 0.35, edge * 0.6);
    metalnessFactor = mix(metalnessFactor, 1.0, edge * uWthB.w);
  }
  // 3. dust
  float dust = clamp(uDust * uWthA.y * (smoothstep(0.05, 0.8, wN.y + (mB - 0.5) * 0.6) * (0.7 + 0.9 * mC) + (0.55 - wH) * 0.8), 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.40, 0.35, 0.29) * (0.85 + 0.3 * mC), dust);
  roughnessFactor = mix(roughnessFactor, 0.95, dust);
  metalnessFactor *= 1.0 - dust;
  // 4. rain wetness
  float up = smoothstep(0.15, 0.85, wN.y);
  float expo = smoothstep(-0.4, -0.05, wN.y);
  vec3 wT = normalize(vec3(-wN.z, 0.0, wN.x) + vec3(1e-4, 0.0, 0.0));
  float sh = dot(wP, wT);
  float st = vnoise3(vec3(sh * 8.0, wP.y * 0.6, 3.1)) * vnoise3(vec3(sh * 27.0, wP.y * 1.4, 9.7));
  st = smoothstep(0.1, 0.4, st) * smoothstep(0.25, 0.65, vnoise3(vec3(sh * 1.3, wP.y * 0.22, 1.7)));
  float Wt = uWet * uWthA.x * expo;
  float wet = Wt * mix(0.55 + 0.45 * st, 0.9 + 0.25 * (mA - 0.5), up);
  float band = (1.0 - smoothstep(0.0, 0.55, wP.y - uWthGround)) * (1.0 - up);
  wet = clamp(max(wet, Wt * band * 0.95), 0.0, 1.0);
  float level = 0.16 + 0.22 * uWet + (mA - 0.5) * 0.3;
  float pool = Wt * up * smoothstep(0.0, 0.05, level - wH);
  float poro = uWthB.x * (1.0 - metalnessFactor * 0.8);
  float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  // a thin film already makes the surface glossy: roughness/darkening saturate early (wk), coverage stays smooth
  float wk = smoothstep(0.0, 0.55, wet);
  diffuseColor.rgb = max(mix(vec3(lum), diffuseColor.rgb, 1.0 + 0.4 * wk * poro), 0.0);
  diffuseColor.rgb *= 1.0 - (0.5 * wk + 0.15 * pool) * poro;
  // rough porous stuff (rock, asphalt) gets glossy but not mirror-like until water pools: target depends on dry roughness
  float wetR = mix(mix(0.14, 0.05, up), 0.4, roughnessFactor * roughnessFactor * 0.55);
  roughnessFactor = mix(roughnessFactor, wetR, wk * (0.75 + 0.25 * up));
  roughnessFactor = mix(roughnessFactor, 0.025, pool);
  // the water film is smooth: flatten the specular normal and its mip variance (diffuse relief stays visible
  // through albedo/AO). Without this, specular AA would widen roughness right back up on bumpy wet ground.
  float film = max(wk * mix(0.35, 0.75, up), pool);
  normal = normalize(mix(normal, nonPerturbedNormal, film));
  matNLen = mix(matNLen, 1.0, film);
  // 5. beads (branch on uniforms only, so derivatives inside stay defined)
  if (uWet * uWthA.x * uWthB.y > 0.01) {
    float bf = clamp(1.0 - length(fwidth(wP)) * 150.0, 0.0, 1.0);
    vec3 aN = abs(wN);
    vec2 bp = aN.y > max(aN.x, aN.z) ? wP.xz : (aN.x > aN.z ? wP.zy : wP.xy);
    vec2 v1 = voronoiF1(bp * 170.0, 0.85, 41.0);
    float r1 = 0.16 + 0.22 * v1.y;
    float bead = (1.0 - smoothstep(r1 - 0.07, r1, v1.x)) * step(0.4, v1.y);
    bead *= bf * uWthB.y * Wt * clamp(0.3 + 0.7 * (1.0 - up) + 0.5 * st, 0.0, 1.0) * (1.0 - pool);
    // dome height (metres) -> screen-space bump (Mikkelsen surface gradient)
    float hb = sqrt(max(1.0 - (v1.x / r1) * (v1.x / r1), 0.0)) * bead * 0.0015;
    vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
    vec3 R1 = cross(sy, normal), R2 = cross(normal, sx);
    float det = dot(sx, R1);
    vec3 grad = sign(det) * (dFdx(hb) * R1 + dFdy(hb) * R2);
    normal = normalize(mix(normal, normalize(abs(det) * normal - grad), bf));
    roughnessFactor = mix(roughnessFactor, 0.04, bead);
    diffuseColor.rgb *= 1.0 - 0.15 * bead * poro;
  }
  // 6. snow
  float cover = wN.y * 1.25 - 0.2 + (mB - 0.5) * 0.5 + (0.5 - wH) * 0.6;
  float snowE = cover + uSnow * uWthA.z * 1.6 - 1.6;
  float snowA = smoothstep(0.0, 0.1, snowE) * step(0.001, uSnow * uWthA.z);
  // thin snow at the cover edge / in a thin layer scatters blue; settled snow ~0.78 keeps grading under a hard sun
  vec3 snowC = mix(vec3(0.58, 0.67, 0.80), vec3(0.78, 0.80, 0.84), smoothstep(0.0, 0.35, snowE)) * (0.92 + 0.1 * mC) * (0.96 + 0.06 * mA);
  diffuseColor.rgb = mix(diffuseColor.rgb, snowC, snowA);
  roughnessFactor = mix(roughnessFactor, 0.62, snowA);
  metalnessFactor *= 1.0 - snowA;
  normal = normalize(mix(normal, nonPerturbedNormal, snowA * 0.85));
  // soft world-space lumps in the snow layer so it is not a flat white sheet (gradient of cheap 3D noise)
  if (uSnow * uWthA.z > 0.001) {
    vec3 sp = wP * 6.0;
    float n0 = vnoise3(sp);
    vec3 g = vec3(vnoise3(sp + vec3(0.15, 0.0, 0.0)), vnoise3(sp + vec3(0.0, 0.15, 0.0)), vnoise3(sp + vec3(0.0, 0.0, 0.15))) - n0;
    vec3 gv = (viewMatrix * vec4(g - wN * dot(g, wN), 0.0)).xyz;
    normal = normalize(normal - gv * 1.6 * snowA);
  }
}
`;

const SPECAA_FRAG = /*glsl*/`
{
  // Tokuyoshi & Kaplanyan 2019 (normal-variance kernel) + Toksvig/vMF from mip-shortened normal-map length
  vec3 dnx = dFdx(normal), dny = dFdy(normal);
  float kvar = min(2.0 * 0.159 * (dot(dnx, dnx) + dot(dny, dny)), 0.12);
  float r = clamp(matNLen, 0.05, 1.0);
  float tok = 2.0 * (1.0 - r * r) / max(3.0 * r - r * r * r, 1e-3);
  float a = material.roughness * material.roughness;
  float a2 = clamp(a * a + uSpecAA * (kvar + tok), 0.0, 1.0);
  material.roughness = sqrt(sqrt(a2));
}
`;

/** Specular anti-aliasing alone (any MeshStandard/Physical material). */
export function patchSpecAA(material) {
  return patch(material, 'specaa', (shader) => {
    ensureWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + SPECAA_FRAG);
  });
}

/**
 * @param material MeshStandardMaterial / MeshPhysicalMaterial
 * @param o { preset?: 'prop'|'ground'|'sheltered', wet=1, dust=1, snow=1, edge=0, porosity=0.8, beads=1, macro=1,
 *          edgeMetal=0, specAA=true }
 *          (multipliers on the shared uWet/uDust/uSnow/uMacro amounts)
 */
export function patchWeathering(material, o = {}) {
  if (o.preset) o = { ...(WEATHER_PRESETS[o.preset] || {}), ...o };
  const a = new Vector4(o.wet ?? 1, o.dust ?? 1, o.snow ?? 1, o.edge ?? 0);
  const b = new Vector4(o.porosity ?? 0.8, o.beads ?? 1, o.macro ?? 1, o.edgeMetal ?? 0);
  const ua = { value: a }, ub = { value: b };
  material.userData.wth = { a, b };
  patch(material, 'wth', (shader) => {
    ensureWorldVaryings(shader);
    ensureNoise(shader);
    shader.uniforms.uWthA = ua; shader.uniforms.uWthB = ub;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uWthA;\nuniform vec4 uWthB;')
      .replace('#include <emissivemap_fragment>', WEATHER_FRAG + '#include <emissivemap_fragment>');
  });
  if (o.specAA !== false) patchSpecAA(material);
  return material;
}
