// Atmosphere wiring: shared fog/sun uniforms + the material patch that applies atmosApply() to every
// three.js built-in material. See atmos.glsl.js for the maths.
//
//   import { installAtmos, patchAtmos, atmosUniforms, ATMOS_DECL, ATMOS_GLSL } from './lighting/atmos.js';
//   installAtmos(G);                     // once, after createCore (reads ART.fog + G.sun)
//   patchAtmos(mat);                     // every lit/unlit material in the world
//   patchAtmos(glowMat, { additive: true }); // additive stuff: only attenuate, never add fog colour
//   // custom ShaderMaterial:
//   new ShaderMaterial({ uniforms: { ...atmosUniforms(), ...mine }, fragmentShader: ATMOS_DECL + ATMOS_GLSL + src })
//
// Do NOT also set scene.fog: three's fog_fragment would fog twice.
import { Vector3 } from 'three';
import { patch, sharedUniform, patchUniforms } from '../engine/patch.js';
import { ATMOS_DECL, ATMOS_GLSL } from './atmos.glsl.js';

export { ATMOS_DECL, ATMOS_GLSL };

const NAMES = ['uSunDir', 'uSunColor', 'uFogSigma', 'uFogScatter', 'uFogFalloff', 'uFogBase', 'uFogSunInscatter', 'uFogStart'];

// Defaults used when ART.fog is missing (golden-hour haze).
const FOG_DEFAULT = { sigma: [0.0035, 0.0045, 0.0065], scatter: [0.78, 0.60, 0.46], heightFalloff: 0.05, baseHeight: 0.0, sunInscatter: 1.0, start: 4.0 };

export function installAtmos(G) {
  const f = { ...FOG_DEFAULT, ...(G.ART.fog || {}) };
  sharedUniform('uSunDir', 'vec3', new Vector3());
  sharedUniform('uSunColor', 'vec3', new Vector3());
  sharedUniform('uFogSigma', 'vec3', new Vector3());
  sharedUniform('uFogScatter', 'vec3', new Vector3());
  sharedUniform('uFogFalloff', 'float', 0);
  sharedUniform('uFogBase', 'float', 0);
  sharedUniform('uFogSunInscatter', 'float', 0);
  sharedUniform('uFogStart', 'float', 0);
  patchUniforms.uFogSigma.value.fromArray(f.sigma);
  patchUniforms.uFogScatter.value.fromArray(f.scatter);
  patchUniforms.uFogFalloff.value = f.heightFalloff;
  patchUniforms.uFogBase.value = f.baseHeight;
  patchUniforms.uFogSunInscatter.value = f.sunInscatter;
  patchUniforms.uFogStart.value = f.start;
  syncAtmos(G);
  return patchUniforms;
}

// Copy G.sun (dir/colour/intensity) into the shared uniforms. Call after you move the sun
// (day cycle, lightning flash). Allocation-free, safe per frame.
export function syncAtmos(G) {
  const s = G.sun;
  patchUniforms.uSunDir.value.copy(s.dir);
  patchUniforms.uSunColor.value.set(s.color.r * s.intensity, s.color.g * s.intensity, s.color.b * s.intensity);
  if (s.light) {
    s.light.color.copy(s.color); s.light.intensity = s.intensity;
  }
}

// The shared uniform objects, for spreading into a ShaderMaterial's uniforms (same objects → live updates).
export function atmosUniforms() {
  const o = {};
  for (const n of NAMES) {
    if (!patchUniforms[n]) throw new Error('atmos: call installAtmos(G) before atmosUniforms()');
    o[n] = patchUniforms[n];
  }
  return o;
}

// Patch a built-in material (Standard/Physical/Basic/Lambert/Phong/Toon) so its final linear colour goes
// through atmosApply(). Inserted *before* tonemapping/colorspace (three applies its own fog after them, which
// is wrong for HDR); the <fog_fragment> include is left in place (empty unless scene.fog is set).
//   opts.additive: emissive/additive-blended surfaces only get transmittance (adding fog colour would glow).
export function patchAtmos(material, { additive = false } = {}) {
  material.fog = false;
  return patch(material, additive ? 'atmosAdd' : 'atmos', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAtmosW;')
      .replace('#include <project_vertex>', /*glsl*/`#include <project_vertex>
{
  vec4 aw = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  aw = batchingMatrix * aw;
#endif
#ifdef USE_INSTANCING
  aw = instanceMatrix * aw;
#endif
  vAtmosW = (modelMatrix * aw).xyz;
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAtmosW;\n' + ATMOS_GLSL)
      .replace('#include <tonemapping_fragment>', (additive
        ? 'gl_FragColor.rgb *= atmosTransmittance(vAtmosW, cameraPosition);'
        : 'gl_FragColor.rgb = atmosApply(gl_FragColor.rgb, vAtmosW, cameraPosition);') + '\n#include <tonemapping_fragment>');
  });
}

// Convenience: patch every material under an Object3D (skips ShaderMaterials — they call atmosApply themselves).
export function patchAtmosTree(root, opts) {
  root.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) if (!m.isShaderMaterial && !m.userData.noAtmos) patchAtmos(m, m.blending === 2 /* Additive */ ? { additive: true } : opts);
  });
}
