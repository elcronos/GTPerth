// Interior reflection/irradiance probes: a CubeCamera captured inside a room, PMREM-filtered, then assigned
// as material.envMap to the materials of that interior, so they stop reflecting the bright outdoor sky.
// Optional box projection (parallax-corrected cubemap) makes floor/wall reflections line up with the room.
//
//   import { createProbe } from './lighting/probes.js';
//   const probe = createProbe(G, { position: [x, 1.4, z], box: roomBox3, size: 128 });
//   probe.assign(roomGroup, { intensity: 1.0, boxProject: true }); // every material under roomGroup
//   probe.capture();   // (re)capture: after the level is built and shadows rendered; again if lights change
//
// Cost: capture = 6 scene renders at size² + PMREM (~2-6 ms). Never per frame; call on load / on change.
// After G.on('contextrestored') a probe that was captured re-captures itself (same bounces) 3 frames later, so
// the env re-bake and the forced shadow update land first.
import { CubeCamera, WebGLCubeRenderTarget, HalfFloatType, PMREMGenerator, Vector3, ShaderChunk, LinearMipmapLinearFilter } from 'three';
import { patch } from '../engine/patch.js';

const SIZE = { low: 64, med: 128, high: 128, ultra: 256 };

const BOX_PROJECT = /*glsl*/`
reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
{
  // parallax-corrected cubemap: intersect the reflection ray with the probe's box, look up from the probe centre
  vec3 bmx = (uProbeMax - vProbeW) / reflectVec;
  vec3 bmn = (uProbeMin - vProbeW) / reflectVec;
  vec3 fa = max(bmx, bmn);
  float tb = min(min(fa.x, fa.y), fa.z);
  vec3 hitP = vProbeW + reflectVec * tb;
  // blend back to the plain direction as roughness grows (blurred lobes are not parallax-accurate anyway)
  reflectVec = normalize(mix(hitP - uProbePos, reflectVec, clamp(roughness * 1.5 - 0.3, 0.0, 1.0)));
}`;

export function createProbe(G, { position = [0, 1.5, 0], box = null, size, near = 0.05, far = 200, hide = [] } = {}) {
  const cubeRT = new WebGLCubeRenderTarget(size || SIZE[G.quality.tier] || 128, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
  const cam = new CubeCamera(near, far, cubeRT);
  cam.position.fromArray(position);
  const pmrem = new PMREMGenerator(G.renderer);
  let rt = null;
  const uPos = { value: new Vector3().fromArray(position) };
  const uMin = { value: box ? box.min.clone() : new Vector3(-1e4, -1e4, -1e4) };
  const uMax = { value: box ? box.max.clone() : new Vector3(1e4, 1e4, 1e4) };
  const assigned = [];
  let lastBounces = 0, pending = 0;
  const onRestore = () => { if (lastBounces) pending = 3; };
  const onUpdate = () => { if (pending && --pending === 0) api.capture(lastBounces); };
  G.on('contextrestored', onRestore);
  G.on('update', onUpdate);

  const api = {
    texture: null, camera: cam, position: cam.position,
    // bounces: capture N times so interior materials see themselves lit by the probe (1 = see outdoor env)
    capture(bounces = 2) {
      lastBounces = bounces;
      for (const o of hide) o.visible = false;
      for (let b = 0; b < bounces; b++) {
        cam.update(G.renderer, G.scene);
        const next = pmrem.fromCubemap(cubeRT.texture, rt || null);
        rt = next;
        api.texture = rt.texture;
        for (const m of assigned) { m.envMap = rt.texture; }
      }
      for (const o of hide) o.visible = true;
      return api.texture;
    },
    // assign to every material under root (or an array of materials)
    assign(target, { intensity = 1.0, boxProject = !!box } = {}) {
      const mats = [];
      if (Array.isArray(target)) mats.push(...target);
      else target.traverse((o) => { const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; mats.push(...ms); });
      for (const m of mats) {
        if (m.isShaderMaterial || !('envMap' in m) || assigned.includes(m)) continue;
        assigned.push(m);
        m.envMap = api.texture; m.envMapIntensity = intensity;
        m.userData.interior = true;
        if (boxProject && m.isMeshStandardMaterial) patchBoxProject(m, uPos, uMin, uMax);
        m.needsUpdate = true;
      }
      return api;
    },
    contains(p) { return !!box && box.containsPoint(p); },
    update() {},
    dispose() { G.off('contextrestored', onRestore); G.off('update', onUpdate); cubeRT.dispose(); if (rt) rt.dispose(); pmrem.dispose(); },
  };
  return api;
}

function patchBoxProject(m, uPos, uMin, uMax) {
  patch(m, 'probeBox', (shader) => {
    shader.uniforms.uProbePos = uPos; shader.uniforms.uProbeMin = uMin; shader.uniforms.uProbeMax = uMax;
    const chunk = ShaderChunk.envmap_physical_pars_fragment.replace('reflectVec = inverseTransformDirection( reflectVec, viewMatrix );', BOX_PROJECT);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vProbeW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvProbeW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vProbeW;\nuniform vec3 uProbePos;\nuniform vec3 uProbeMin;\nuniform vec3 uProbeMax;')
      .replace('#include <envmap_physical_pars_fragment>', chunk);
  });
}
