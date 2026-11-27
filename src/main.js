// Game entry: staged boot (engine/boot.js) wiring EVERY cookbook system in the mandatory order
// (references/pipeline-order.md §2):
//   core → quality → pcss → atmos → sky → env → materials → world → ground (+ planar reflection) → water (sea +
//   caustics) → backdrop (far field) → props (scatter, decals, practical lights) → finalize (atmos + weathering on
//   every world material) → shadows → [hero, actors] → fx → weather → probes (assign) → post → audio → input → player →
//   ui → warm-up → probe capture → markReady.
// Each stage is timed and listed in __stats().modules; non-critical failures fall back to src/modules/_stub.js.
// Cookbook systems register their own G.on('update'), so their stage results are marked `selfUpdating` (own()) —
// otherwise the boot runner would update them a second time.
// The cookbook lives in src/cookbook/ (copied by the skill) — import from './cookbook/...'.
import { MeshStandardMaterial, Color } from 'three';
import { createCore } from './cookbook/engine/core.js';
import { createBoot } from './cookbook/engine/boot.js';
import { createQuality } from './cookbook/engine/quality.js';
import { createInput } from './cookbook/engine/input.js';
import { installBench } from './cookbook/engine/bench.js';
import { finalizeMaterials } from './cookbook/engine/finalize.js';
import { installPCSS, fitSunShadow, createShadowScheduler, casterBounds } from './cookbook/lighting/pcss.js';
import { installAtmos } from './cookbook/lighting/atmos.js';
import { createSky } from './cookbook/lighting/sky.js';
import { createEnvFromSky } from './cookbook/lighting/env-from-sky.js';
import { createLights } from './cookbook/lighting/lights.js';
import { createProbe } from './cookbook/lighting/probes.js';
import { initMaterials, makeMaterial } from './cookbook/materials/library.js';
import { createGroundMask, patchGround } from './cookbook/ground/ground.js';
import { createPlanarReflection } from './cookbook/ground/planar-reflection.js';
import { createSea } from './cookbook/water/sea.js';
import { createCaustics, patchCaustics } from './cookbook/water/caustics.js';
import { createFarfield, FARFIELD_PRESETS } from './cookbook/backdrop/farfield.js';
import { scatter, poissonDisk, rockGeo } from './cookbook/geo/scatter.js';
import { rngFrom } from './cookbook/geo/noise.js';
import { DecalAtlas, signCanvas, stencilCanvas, decalMesh } from './cookbook/decals/canvas-text.js';
import { createFX } from './cookbook/fx/index.js';
import { createRain } from './cookbook/weather/rain.js';
import { createSnow, patchSnowCover } from './cookbook/weather/snow.js';
import { createDust } from './cookbook/weather/dust.js';
import { createLightning } from './cookbook/weather/lightning.js';
import { createPost } from './cookbook/post/pipeline.js';
import { createMixer } from './cookbook/audio/mixer.js';
import { buildBank } from './cookbook/audio/sfx.js';
import { buildMusic, createMusic, SONGS } from './cookbook/audio/music.js';
import { ART } from './art.js';
import { POSES, PATH, WORLD, PLAYER, SEED } from './contracts.js';
import { STUBS } from './modules/_stub.js';
import * as World from './modules/world.js';
import * as Player from './modules/player.js';
import * as UI from './modules/ui.js';

const SHOWCASES = { world: World }; // ?show=<name> → that module's showcase(G) camera (add yours)
const own = (m) => { if (m && typeof m === 'object') m.selfUpdating = true; return m; }; // system runs on its own G.on('update')

async function main() {
  // 1. core + harness first, so every later error is captured (the boot screen covers the canvas meanwhile)
  const G = createCore({ canvas: document.getElementById('c'), ART, fov: PLAYER.fov, far: 2000 });
  Object.assign(G, { POSES, PATH, WORLD });
  installBench(G, { path: PATH });
  G.start();
  const boot = createBoot(G, { stubs: STUBS });
  const stage = boot.stage;
  const wx = ART.weather || {};

  // 2. quality: tier (renderer string / ?q=), dynres, context-loss guard. Everything after sizes itself from it.
  const Q = await stage('quality', () => createQuality(G), { critical: true, msg: 'Waking the renderer', at: 0.03 });

  // 3-5. global chunk patches BEFORE any material compiles; then sky → env (materials compile against the env)
  await stage('pcss', () => { installPCSS({ G, tier: G.quality.tier }); return {}; }, { msg: 'Softening the shadows', at: 0.06 });
  await stage('atmos', () => installAtmos(G) || {}, { critical: true, msg: 'Mixing the haze', at: 0.09 });
  const sky = await stage('sky', () => own(createSky(G)), { msg: 'Lighting the sky', at: 0.12 });
  await stage('env', () => own(createEnvFromSky(G, sky)), { msg: 'Catching the light', at: 0.15 });

  // 6. materials: GPU-baked PBR sets (cached per surface) + shared weathering uniforms from ART.surface.
  //    ground: no weathering (ground/ground.js has its own wet model); shed*: own instances for the interior probe.
  const mats = await stage('materials', () => {
    initMaterials(G);
    return {
      ground: makeMaterial('concrete', { weather: false }), concrete: makeMaterial('concrete'), quay: makeMaterial('concrete'),
      wood: makeMaterial('wood_planks'), paint: makeMaterial('painted_metal'), steel: makeMaterial('galvanised'), rubber: makeMaterial('rubber'),
      shedConcrete: makeMaterial('concrete', { weather: 'sheltered' }), shedSteel: makeMaterial('galvanised', { weather: 'sheltered' }),
      rock: makeMaterial('rock', { triplanar: true }),
    };
  }, { msg: 'Mixing paint, rust and rain', at: 0.22, stub: flatMaterials });

  // 7. world / level layout (critical: no world, no game)
  const world = await stage('world', () => World.create(G, { mats }), { critical: true, msg: 'Laying out the yard', at: 0.3 });
  const A = world.anchors || {};

  // 8. ground (puddle mask + mirror puddles) and water (sea + caustics on the quay wall)
  const ground = await stage('ground', () => {
    const b = world.bounds, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const mask = createGroundMask({ extent: [b.max.x - b.min.x, b.max.z - b.min.z], center: [cx, cz], size: 512, seed: SEED,
      lanes: [{ axis: 'z', at: 0.5, width: 0.5, spacing: 1.8 }] });
    const refl = createPlanarReflection(G, { height: WORLD.groundY, hide: [world.ground] });
    const wet = ART.surface?.wet ?? 0;
    const gnd = patchGround(world.ground.material, { G, mask, refl, base: 'none', water: wx.kind === 'rain' ? 0.18 : wet > 0.3 ? 0.08 : 0 });
    return own({ mask, refl, gnd, uniforms: gnd.uniforms });
  }, { msg: 'Filling the puddles', at: 0.36 });
  const water = await stage('water', () => {
    const sea = createSea(G, { level: WORLD.seaY }); // ground.refl mirrors y = groundY only: the sea keeps env reflections
    const caus = createCaustics(G);
    if (world.quay) world.quay.traverse((o) => { if (o.material) patchCaustics(o.material, caus, { G, mode: 'over', waterY: WORLD.seaY }); });
    return own({ sea, caustics: caus, heightAt: (x, z) => sea.heightAt(x, z, G.t) });
  }, { msg: 'Letting the tide in', at: 0.4 });
  void water;

  // 9. backdrop: ≥ 2 parallax silhouette rings in the same fog (never an empty or hard-edged horizon)
  await stage('backdrop', () => own(createFarfield(G, { layers: FARFIELD_PRESETS.industrial })), { msg: 'Raising the skyline', at: 0.44 });

  // 10. props: scatter (rubble along the wall), decals (signage), practical lights (real lights within the tier budget)
  await stage('scatter', () => {
    const L = A.wallLine; if (!L) return {};
    const rng = rngFrom(SEED);
    const pts = poissonDisk({ x0: L.x0, z0: L.z, w: L.x1 - L.x0, h: 1.4, r: 0.9, rng });
    const s = scatter(G, { parts: [{ geo: rockGeo({ seed: 3, radius: 0.22 }), material: mats.rock }], points: pts, scale: [0.4, 1.3], sink: 0.08, seed: SEED });
    G.scene.add(s.group);
    return own(s);
  }, { msg: 'Sweeping the rubble', at: 0.47 });
  await stage('decals', () => {
    const atlas = new DecalAtlas(1024);
    atlas.add('gate', signCanvas({ lines: [{ text: 'BAY 4' }, { text: 'NO UNAUTHORISED ENTRY', size: 0.16 }] }));
    atlas.add('bay', stencilCanvas({ text: 'B4-0271' }));
    atlas.finish(G.renderer);
    for (const d of A.signs || []) { const m = decalMesh(atlas, d.name, d.w); m.position.fromArray(d.pos); m.rotation.y = d.rotY || 0; G.scene.add(m); }
    return { atlas };
  }, { msg: 'Stencilling the walls', at: 0.5 });
  await stage('lights', () => {
    const lights = createLights(G);
    for (const p of A.lamps || []) lights.add({ position: [p[0], p[1] + 4.2, p[2]], kind: 'pole', intensity: 60, groundY: p[1] });
    return own(lights);
  }, { msg: 'Switching on the lamps', at: 0.53 });

  // 11. finalize: atmos fog + weathering on every built-in world material that lacks them (one pass, idempotent)
  finalizeMaterials(G, G.scene);

  // 12. sun shadow fitted to the finished casters; static scheduler (invalidate() when something big moves)
  await stage('shadows', () => {
    fitSunShadow(G, casterBounds(world.root), G.quality.settings.shadow);
    return own(createShadowScheduler(G, { mode: 'static' }));
  }, { msg: 'Casting shadows', at: 0.58 });

  // 13-14. hero object and actors go here — each its own stage (non-critical, with a stub)

  // 15. FX pools (preallocated) + a steam vent; weather (rain/snow by ART.weather.kind, dust motes in the sun
  //     shafts, lightning when ART.weather.lightning)
  const fx = await stage('fx', () => {
    const f = createFX(G);
    f.setGround(WORLD.groundY);
    if (A.vent) f.emitter({ pos: { x: A.vent[0], y: A.vent[1], z: A.vent[2] }, dir: { x: 0.1, y: 1, z: 0.05 }, kind: 'steam', rate: 10, size: 0.22, speed: 1.2 });
    f.prewarm(3);
    return own(f);
  }, { msg: 'Priming the pools', at: 0.64 });
  const weather = await stage('weather', () => {
    const w = { rain: null, snow: null, dust: null, lightning: null };
    const amt = wx.amount ?? 0.7;
    if (wx.kind === 'rain') w.rain = createRain(G, { groundY: WORLD.groundY, mask: ground.mask, ground: ground.gnd || undefined, amount: amt });
    if (wx.kind === 'snow') {
      w.snow = createSnow(G, { amount: amt, cover: ART.surface?.snow || 0.6 });
      if (world.ground?.material) patchSnowCover(world.ground.material); // the ground skips weathering (own wet model)
    }
    w.dust = createDust(G, { count: wx.kind === 'dust' ? 4000 : 1200, box: [16, 7, 16] });
    w.dust.amount = wx.kind === 'dust' ? 1 : 0.5;
    if (wx.lightning) w.lightning = createLightning(G, { interval: wx.lightningInterval || [18, 45] });
    return own(w);
  }, { msg: 'Calling the weather', at: 0.7 });

  // 16. interior probe for the shed: assigned now (so the warm-up compiles its box-projected programs), CAPTURED after
  //     the warm-up below — a capture before it compiles every program synchronously for the cube camera (seconds).
  const probe = await stage('probes', () => {
    if (!world.shed) return {};
    const p = createProbe(G, { position: world.shed.probeAt, box: world.shed.box, hide: [weather.rain?.mesh, weather.rain?.splashes, weather.snow?.mesh, weather.dust?.mesh].filter(Boolean) });
    p.assign(world.shed.group, { intensity: 1.0 });
    return own(p);
  }, { msg: 'Lighting the shed', at: 0.74 });

  // 17. post: HDR chain → G.post, G.render
  await stage('post', () => createPost(G), { msg: 'Grading the film', at: 0.78 });

  // 18. audio graph starts suspended until the first gesture (mixer arms unlock itself). Sound banks and music stems
  //     render time-sliced AFTER ready, so they never delay the first frame; ambience + thunder hook in when done.
  await stage('audio', () => {
    const mixer = createMixer({ volume: 0.8 });
    const A_ = { mixer, music: null, update() { mixer.update(G.camera); }, setVolume(v) { mixer.master.gain.value = v; },
      play: (name, o) => (mixer.ctx.state === 'running' && mixer.has(name) ? mixer.play(name, o) : null), unlock: () => mixer.unlock() };
    G.on('ready', () => (async () => {
      mixer.addBank(await buildBank(mixer.ctx, { sr: Math.min(48000, mixer.ctx.sampleRate) }));
      const stems = await buildMusic(mixer.ctx, SONGS.dusk);
      await mixer.setEnv('outdoor');
      const start = () => {
        A_.music = createMusic(mixer, stems, { intensity: 0.2 }); A_.music.start();
        if (wx.kind === 'rain') A_.play('rain', { loop: true, bus: 'ambience', gain: 0.5 * (wx.amount ?? 0.7) });
        A_.play('wind', { loop: true, bus: 'ambience', gain: 0.25 });
        A_.play('sea', { loop: true, bus: 'ambience', gain: 0.3 });
      };
      if (mixer.ctx.state === 'running') start(); else mixer.unlocked.then(start);
    })().catch((e) => G.errors.push('audio: ' + (e && e.message || e))));
    G.on('thunder', (e) => { A_.play('explosion_far', { gain: Math.max(0.2, 1 - e.dist / 4000), send: 0.8, rate: 0.6 }); });
    return A_;
  }, { msg: 'Tuning the radio', at: 0.82 });

  // 19. input → player → ui (input latches on G "preupdate", so it is fresh for every update listener)
  const input = await stage('input', () => createInput(G, { root: document.getElementById('ui') }), { critical: true, msg: 'Finding the controls', at: 0.86 });
  const player = await stage('player', () => Player.create(G, { input, colliders: world.colliders }), { msg: 'Waking up', at: 0.89 });
  await stage('ui', () => UI.create(G, { input, player, quality: Q, path: PATH }), { msg: 'Printing the manifest', at: 0.92 });

  // ?show=<module>: isolate a module's showcase camera
  const show = SHOWCASES[G.params.get('show')];
  if (show?.showcase) { const s = show.showcase(G); G.on('ready', () => window.__setCam(s.cam, s.target)); }

  // 20-21. last finalize pass (anything added since), warm-up (compileAsync + one frame of every permutation; pass
  //        FX/enemy materials not yet in the scene as extras; FX pools are in the scene already), probe capture → ready
  finalizeMaterials(G, G.scene);
  G.camera.position.fromArray(POSES[0]); G.camera.lookAt(POSES[0][3], POSES[0][4], POSES[0][5]);
  await stage('warmup', () => Q.warmup({ extras: [] }), { msg: 'Compiling shaders', at: 0.95 });
  await stage('probe-capture', () => { probe.capture?.(2); return {}; }, { msg: 'Lighting the shed', at: 0.98 });
  await boot.finish({ warmup: false });
}

function flatMaterials() {
  const m = (c, r = 0.8, mt = 0) => new MeshStandardMaterial({ color: new Color(c), roughness: r, metalness: mt });
  return { ground: m(0x555049, 0.9), concrete: m(0x77706a), quay: m(0x77706a), wood: m(0x7a5a3a), paint: m(0x7d2219, 0.5), steel: m(0x8a8f96, 0.4, 1),
    rubber: m(0x111111, 0.9), shedConcrete: m(0x77706a), shedSteel: m(0x8a8f96, 0.4, 1), rock: m(0x5a5650, 0.9) };
}

main().catch((e) => {
  const msg = 'main: ' + (e && e.message || e);
  (window.__errors ||= []).push(msg); window.__fatal = window.__fatal || msg; console.error(e);
});
