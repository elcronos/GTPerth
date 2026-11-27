// Image-based lighting that matches the sky: PMREM-filter the procedural sky (sun disk removed, radiance
// clamped so the sun lobe cannot produce fireflies) → G.env and scene.environment.
//
//   import { createEnvFromSky } from './lighting/env-from-sky.js';
//   const env = createEnvFromSky(G, sky);   // bakes immediately; sets G.env, scene.environment(+Intensity)
//   env.bake();                             // re-bake after changing sun/ART.sky (e.g. day cycle: every ~2 s, not every frame)
//
// ART.ambient.envIntensity → scene.environmentIntensity (default 1.8).
// Re-bakes itself on G.on('contextrestored') (render-target contents die with the GL context).
// Cost: one 6-face cube render of the sky + PMREM blur ≈ 1-3 ms on a desktop GPU. Never per frame.
import { Scene, PMREMGenerator, Vector3 } from 'three';

const SIZE = { low: 64, med: 128, high: 256, ultra: 256 };

export function createEnvFromSky(G, sky, opts = {}) {
  const pmrem = new PMREMGenerator(G.renderer);
  const skyScene = new Scene();
  const proxy = sky.makeProxy();
  skyScene.add(proxy);
  const pos = new Vector3(0, opts.height ?? 1.7, 0); // eye height: the fog in the env matches what you see
  let rt = null;
  const api = {
    texture: null,
    bake() {
      const u = sky.material.uniforms;
      const prev = u.uEnv.value;
      u.uEnv.value = 1;
      const size = opts.size || SIZE[G.quality.tier] || 256;
      const next = pmrem.fromScene(skyScene, 0, 0.1, 100, { size, position: pos });
      u.uEnv.value = prev;
      if (rt) rt.dispose();
      rt = next;
      api.texture = rt.texture; api.renderTarget = rt;
      G.env = rt.texture;
      if (opts.setScene !== false) {
        G.scene.environment = rt.texture;
        G.scene.environmentIntensity = opts.intensity ?? G.ART.ambient?.envIntensity ?? 1.8;
      }
      G.emit('env', rt.texture);
      return rt.texture;
    },
    update() {},
    dispose() { G.off('contextrestored', rebake); if (rt) rt.dispose(); pmrem.dispose(); },
  };
  const rebake = () => api.bake();
  G.on('contextrestored', rebake);
  api.bake();
  return api;
}
