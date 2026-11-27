# fx/ — muzzle flash, sparks, tracers, explosions, smoke/steam, decals, casings

One `createFX(G)` builds every pool (5 draw calls total, all instanced, zero allocation per frame) and
exposes gameplay verbs. Particles are premultiplied-alpha (ONE, ONE_MINUS_SRC_ALPHA): alpha = coverage,
rgb = radiance × coverage, so additive fire and absorbing smoke share one blend mode and one sorted draw.
Fogged with the shared `ATMOS_GLSL` (lighting/atmos) when `installAtmos(G)` ran; no-op otherwise.

## API
```js
import { createFX } from './fx/index.js';
const fx = createFX(G, { onCasingBounce: (x, y, z, speed, kind) => {} });  // after installAtmos + createPost
fx.setGround(0 /* y */, (x, z) => terrainHeight(x, z) /* optional */);
fx.muzzle(pos, dir, 'rifle' | 'pistol' | 'smg' | 'shotgun', { scale, light: true, smoke: true });
fx.tracer(from, to, { speed: 380, length: 6, width: 0.02 });       // every 3rd-5th round looks right
fx.impact(hit, normal, 'metal' | 'concrete' | 'dirt' | 'wood' | 'flesh', { dir: bulletDir, decal: true });
fx.casing(ejectPos, ejectVel, 'rifle' | 'pistol' | 'shotgun');      // vel ≈ right*2.6 + up*1.8 - fwd*0.6 m/s
fx.explosion(pos, { scale: 1, smoke, debris, decal, ring, normal });  // emits G 'fx:shake' (amount, pos)
fx.sparks(pos, normal, { count, speed, spread, life, heat, size, bright });
fx.smoke(pos, { count, size, grow, life, color, opacity, spread, vel, rise });
fx.decal(pos, normal, 'hole' | 'metal' | 'scorch', size);
const e = fx.emitter({ pos, dir, kind: 'steam' | 'smoke' | 'fire' | 'dust', rate, size, speed }); e.stop(); e.set(x, y, z);
fx.prewarm(3);           // run emitters before the first frame (no pop-in on stills / level start)
fx.timeScale = 0;        // freeze everything (photo mode, deterministic captures)
fx.setDepth(tex);        // linear view-depth texture (metres) for soft particles; default auto = G.post.targets.zHalf
fx.lights.flash(x, y, z, r, g, b, candela, life, distance, flicker);   // the shared flash-light pool
fx.puff(...) / fx.glow(...) low-level billboard spawns; fx.stats(); fx.dispose()
```
All verbs take Vector3-likes (`{x,y,z}`); nothing allocates except `explosion()` (one-off object literals).
Files: `common.js` (Pool, FX_GLSL: heat ramp, soft fade, fog hookup) · `atlas.js` (GPU-baked fireball flipbook 8×8 +
16 smoke puffs, texel = heat, opacity, normal.xy) · `billboards.js` (fire/puff/glow/ring, sorted back-to-front, lit by
sun wrap + HG forward scatter + sky/ground ambient) · `streaks.js` (sparks + tracers, screen-space capsules, min 1.25 px
with energy-conserving fade, gravity/drag/bounce/cooling) · `muzzle.js` · `decals.js` (lit MeshStandard, canvas atlas,
ring buffer, polygonOffset, hot-metal glow ~1 s) · `casings.js` (lathed brass, spin, bounce, settle) · `lights.js` (fixed PointLight pool).

## Defaults that matter (physically plausible, tuned on the dusk range showcase)
- Muzzle: rifle plume ≈ 0.14 m long, 45 ms (2–3 frames), orange with a yellow core, 90 cd light 6 m radius, 50 ms.
  It is 3 crossed quads + a front disc with edge-on fades: **not** a star sprite. Do not scale it up to "read" — bloom does that.
- Explosion (scale 1): flash glow 0.12 s, 9 flipbook fireballs 1–1.6 s that cool to soot, smoke column 5–9 s rolling out of
  the top (+ fire-lit under-glow), ground dust skirt, shock ring 16 m in 0.7 s, 45 debris sparks, 2600 cd light 0.9 s, 4.5 m scorch.
- Impacts: metal = 10–22 ricochet sparks + glow + hot decal + small light; concrete = 3 dust puffs + 0–3 sparks + hole.

## ART knobs read
`G.sun.dir/color/intensity` (particle lighting), `ART.sky.zenith/horizon/groundTint` × `ART.ambient.skyIntensity`
(particle ambient: `fx.params.ambientUp/Down` are live Vector3s), the atmosphere uniforms, `G.quality.tier`.
`fx.U.uFxExposureComp.value` scales every emissive fx at once; `fx.params.lightScale` all flash lights.

## Cost per tier (`G.quality.tier`)
| tier | atlas (fire / puff) | bake steps | caps ×(billboards 384, streaks 1024, decals 256, casings 48) | flash lights |
|---|---|---|---|---|
| low | 512 / 256 | 20 | ×0.4 | 2 |
| med | 1024 / 512 | 32 | ×0.7 | 3 |
| high | 1024 / 512 | 32 | ×1 | 4 |
| ultra | 2048 / 1024 | 44 | ×1.3 | 6 |
Bake: once at create (≈10–30 ms GPU). Per frame: CPU sim + insertion sort of live billboards (~0.1 ms at 300), 5 draws.
Smoke overdraw is the real cost: an explosion close to the camera fills the screen with ~20 layers — on low use `scale ≤ 1`.

## Pitfalls
- Create fx AFTER `installAtmos(G)` (fog is chosen at compile time) and after `createPost` (soft depth auto-detect).
- Light count is fixed at creation (changing it recompiles all lit materials). The pool steals the oldest light.
- Soft particles use the post's previous-frame half-res depth: fine for smoke; fast camera cuts may show one frame of hard edge.
- Particles are not shadowed by the sun (smoke in the shade of a wall is still sun-lit) — lower `opacity`/albedo for
  interior emitters or set `fx.U.uFxSun` yourself per zone.
- Decals are flat quads: put them on planar static surfaces only; size ≤ the face. `fx.decals.clear()` on level reset.
- Casings/decals live in world space; call `fx.setGround` with your terrain height function or they sink/float.
- Sorting is per pool (fire+smoke sort together); other transparent systems (rain, glass) are not interleaved.
