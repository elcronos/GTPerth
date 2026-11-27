// Lightning: seeded strike events with a realistic multi-stroke flicker (2-4 return strokes in ~0.4 s, each a sharp
// attack and fast exponential decay, with a dim afterglow), driving:
//  - shared uniform `uFlash` (0..~1.5) — sky shaders add a bright cloud-lit term with it (lighting/sky.js, rain.js)
//  - scene.environmentIntensity (ambient/IBL boost) — restored exactly when the flash ends
//  - an optional flash DirectionalLight (cold white, from high above the strike azimuth, no shadows)
//  - G.emit('lightning', { dist, azim }) at strike time, and G.emit('thunder', { dist }) after dist/343 s (audio)
//
//   const lt = createLightning(G, { interval: [18, 45] });
//   lt.strike();         // force one now (cutscenes, captures: ?flash=1 in the showcase)
//   lt.flash             // current value, read-only
import { DirectionalLight, Color } from 'three';
import { sharedUniform } from '../engine/patch.js';

export function createLightning(G, o = {}) {
  const uFlash = sharedUniform('uFlash', 'float', 0);
  let s = (o.seed ?? 21) >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const interval = o.interval || [18, 45];
  const envBoost = o.envBoost ?? 5.0;        // env intensity multiplier at flash = 1
  const lightI = o.lightIntensity ?? 12.0;
  const light = o.light === false ? null : new DirectionalLight(new Color().fromArray(o.color || [0.75, 0.82, 1.0]), 0);
  if (light) { light.castShadow = false; G.scene.add(light, light.target); }
  const strokes = new Float32Array(8);      // start times of the strokes of the current strike
  const amps = new Float32Array(8);
  let n = 0, t0 = -1e9, next = interval[0] + rand() * (interval[1] - interval[0]), baseEnv = null, active = false, thunderAt = -1, dist = 0, azim = 0;
  const evt = { dist: 0, azim: 0 };

  const strike = (atTime = G.t) => {
    t0 = atTime;
    n = 2 + ((rand() * 3) | 0);
    let tt = 0;
    for (let i = 0; i < n; i++) { strokes[i] = tt; amps[i] = (i === 0 ? 1 : 0.45 + 0.55 * rand()); tt += 0.05 + rand() * 0.14; }
    dist = 800 + rand() * 4000; azim = rand() * Math.PI * 2;
    thunderAt = atTime + dist / 343;
    if (light) {
      light.position.set(Math.cos(azim) * 30, 80, Math.sin(azim) * 30).add(G.camera.position);
      light.target.position.copy(G.camera.position);
      light.target.updateMatrixWorld();
    }
    evt.dist = dist; evt.azim = azim;
    G.emit('lightning', evt);
  };

  const update = (dt, t) => {
    if (o.auto !== false && t >= next) { strike(t); next = t + interval[0] + rand() * (interval[1] - interval[0]); }
    const lt = t - t0;
    let f = 0;
    if (lt >= 0 && lt < 2.0) {
      for (let i = 0; i < n; i++) {
        const u = lt - strokes[i];
        if (u >= 0) f += amps[i] * (1 - Math.exp(-u * 200)) * Math.exp(-u * 22);
      }
      f += 0.08 * Math.exp(-lt * 3) * (lt > 0 ? 1 : 0);          // afterglow inside the clouds
      // distant strikes are dimmer (inverse-ish, clamped)
      f *= Math.min(1, 1600 / dist) * (o.strength ?? 1);
    }
    uFlash.value = f;
    if (f > 0.002) {
      if (!active) { baseEnv = G.scene.environmentIntensity; active = true; }
      G.scene.environmentIntensity = baseEnv * (1 + f * envBoost);
      if (light) light.intensity = f * lightI;
    } else if (active) {
      G.scene.environmentIntensity = baseEnv; active = false;
      if (light) light.intensity = 0;
    }
    if (thunderAt > 0 && t >= thunderAt) { evt.dist = dist; G.emit('thunder', evt); thunderAt = -1; }
  };
  G.on('update', update);
  return {
    strike, update, light, uFlash,
    get flash() { return uFlash.value; },
    dispose() { if (light) G.scene.remove(light, light.target); if (active) G.scene.environmentIntensity = baseEnv; },
  };
}
