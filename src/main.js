// GRAND THEFT PERTH — entry. Staged boot (engine/boot.js) in the mandatory order (references/pipeline-order.md §2):
// core → quality → pcss → atmos → sky → env → materials → world (land, roads, skyline, landmarks, water, far field,
// props) → finalize → shadows (camera-following sun shadow) → avatars → player → vehicles → traffic → peds → police →
// mission → fx → post → audio → input → hud → warm-up → ready.
import { Box3, Vector3 } from 'three';
import { createCore } from './cookbook/engine/core.js';
import { createBoot } from './cookbook/engine/boot.js';
import { createQuality } from './cookbook/engine/quality.js';
import { createInput, DEFAULT_BINDINGS } from './cookbook/engine/input.js';
import { installBench } from './cookbook/engine/bench.js';
import { finalizeMaterials } from './cookbook/engine/finalize.js';
import { installPCSS, fitSunShadow, createShadowScheduler } from './cookbook/lighting/pcss.js';
import { installAtmos } from './cookbook/lighting/atmos.js';
import { createSky } from './cookbook/lighting/sky.js';
import { createEnvFromSky } from './cookbook/lighting/env-from-sky.js';
import { initMaterials } from './cookbook/materials/library.js';
import { createFX } from './cookbook/fx/index.js';
import { createPost } from './cookbook/post/pipeline.js';
import { ART } from './art.js';
import { POSES, PATH, WORLD, PLAYER, SEED } from './contracts.js';
import { STUBS } from './modules/_stub.js';
import * as World from './modules/world/index.js';
import * as Game from './modules/game/index.js';

const own = (m) => { if (m && typeof m === 'object') m.selfUpdating = true; return m; };

async function main() {
  const G = createCore({ canvas: document.getElementById('c'), ART, fov: PLAYER.fov, far: 9000 });
  G.camera.near = 0.12; G.camera.updateProjectionMatrix();
  Object.assign(G, { POSES, PATH, WORLD });
  installBench(G, { path: PATH });
  G.start();
  const boot = createBoot(G, { stubs: STUBS });
  const stage = boot.stage;

  const Q = await stage('quality', () => createQuality(G, { storageKey: 'gtperth.q' }), { critical: true, msg: 'Waking the renderer', at: 0.03 });
  await stage('pcss', () => { installPCSS({ G, tier: G.quality.tier, lightSize: 0.010 }); return {}; }, { msg: 'Softening the shadows', at: 0.06 });
  await stage('atmos', () => installAtmos(G) || {}, { critical: true, msg: 'Mixing the sea breeze', at: 0.09 });
  const sky = await stage('sky', () => own(createSky(G, { far: 8000 })), { msg: 'Painting the sunset', at: 0.12 });
  await stage('env', () => own(createEnvFromSky(G, sky)), { msg: 'Catching the golden hour', at: 0.15 });

  const mats = await stage('materials', () => { World.registerSurfaces(); initMaterials(G); return World.makeWorldMaterials(); }, { critical: true, msg: 'Quarrying limestone', at: 0.22 });
  const world = await stage('world', () => World.create(G, { mats }), { critical: true, msg: 'Building Elizabeth Quay', at: 0.4 });
  G.world = world;
  finalizeMaterials(G, G.scene);

  // camera-following sun shadow (the map is 2.5 km; the shadow box tracks the action)
  const shadows = await stage('shadows', () => {
    const box = new Box3(); const c = new Vector3(); let last = new Vector3(1e9, 0, 0);
    const S = createShadowScheduler(G, { mode: 'dynamic', every: 2 });
    const fit = (force) => {
      const f = G.focus || G.camera.position;
      c.set(f.x, 0, f.z);
      if (!force && c.distanceTo(last) < 12) return;
      last.copy(c);
      const r = G.shadowRadius || 120;
      box.min.set(c.x - r, -2, c.z - r); box.max.set(c.x + r, 60, c.z + r);
      fitSunShadow(G, box, G.quality.settings.shadow, { margin: 4, maxShadowLen: 160 });
      S.invalidate?.(2);
    };
    fit(true);
    G.on('update', () => fit(false));
    G.on('camset', () => fit(true));
    return own({ ...S, fit });
  }, { msg: 'Stretching the shadows', at: 0.5 });

  const fx = await stage('fx', () => { const f = createFX(G); f.setGround(WORLD.groundY, (x, z) => world.heightAt(x, z)); return own(f); }, { msg: 'Priming the pools', at: 0.55 });
  await stage('post', () => createPost(G, { motionBlur: G.params.has('shot') ? false : 0.3 }), { msg: 'Grading the film', at: 0.6 });

  const input = await stage('input', () => createInput(G, { root: document.getElementById('ui'), bindings: { ...DEFAULT_BINDINGS, interact: ['KeyF', 'KeyE'], horn: ['KeyH'], fire: ['Mouse0', 'KeyJ'] } }), { critical: true, msg: 'Finding the controls', at: 0.65 });
  await stage('game', () => Game.create(G, { input, world, mats, fx, quality: Q, shadows, stage }), { msg: 'Waking up Perth', at: 0.7 });

  finalizeMaterials(G, G.scene);
  G.camera.position.fromArray(POSES[0]); G.camera.lookAt(POSES[0][3], POSES[0][4], POSES[0][5]);
  await stage('warmup', () => Q.warmup({ extras: G.warmExtras || [] }), { msg: 'Compiling shaders', at: 0.95 });
  await boot.finish({ warmup: false });
}

main().catch((e) => {
  const msg = 'main: ' + (e && e.message || e);
  (window.__errors ||= []).push(msg); window.__fatal = window.__fatal || msg; console.error(e);
});
