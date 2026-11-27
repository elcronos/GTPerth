# lighting/ — sky, IBL, one shared fog, PCSS shadows, probes, practical lights

Checked on an isolated showcase page during development (not included in this repo), A/B-ing a lowered dusk sun,
stock PCF against PCSS, and interior probes on/off.

## Boot order (copy this)
```js
import { installPCSS, fitSunShadow, createShadowScheduler } from './lighting/pcss.js';
import { installAtmos, patchAtmos } from './lighting/atmos.js';
import { createSky } from './lighting/sky.js';
import { createEnvFromSky } from './lighting/env-from-sky.js';
import { createProbe } from './lighting/probes.js';
import { createLights } from './lighting/lights.js';

const G = createCore({ ART });          // (createQuality(G) first if you use it: PCSS reads G.quality.settings)
installPCSS({ G });                     // 1. BEFORE any material compiles (patches a global ShaderChunk)
installAtmos(G);                        // 2. shared sun/fog uniforms from ART.fog + G.sun
const sky = createSky(G);               // 3. adds the sky mesh
const env = createEnvFromSky(G, sky);   //    G.env + scene.environment(+Intensity = ART.ambient.envIntensity)
// ... build the level; call patchAtmos(mat) on EVERY world material (or patchAtmosTree(root)) ...
fitSunShadow(G, levelBox3);             // ortho sun shadow fitted to the level (+ long low-sun shadow tips)
const shadows = createShadowScheduler(G, { mode: 'static' }); // shadows.invalidate() when casters/sun change
const lights = createLights(G);         // practical lamps (budget per tier)
lights.add({ position: [x, 3.4, z], kind: 'pole' });
const probe = createProbe(G, { position: [rx, 1.5, rz], box: roomBox3 });
probe.assign(roomGroup);                // interior materials only (own material instances!)
G.on('update', ((n = 0) => () => { if (++n === 4) probe.capture(); })()); // after shadows rendered
createPost(G);                          // post/pipeline.js tonemaps (no post: renderer.toneMapping = ACESFilmic works too)
```
Never set `scene.fog`. Never add a HemisphereLight/AmbientLight for fill: the sky env is the fill.

## API
| File | Export | Notes |
|---|---|---|
| atmos.glsl.js | `ATMOS_DECL`, `ATMOS_GLSL` | GLSL: `vec3 atmosApply(vec3 col, vec3 wpos, vec3 cam)`, `vec3 atmosTransmittance(wpos, cam)`, `atmosTau`, `atmosInscatter(rd)`, `atmosTwilight()` |
| atmos.js | `installAtmos(G)` | registers shared uniforms `uSunDir uSunColor uFogSigma uFogScatter uFogFalloff uFogBase uFogSunInscatter uFogStart` (engine/patch.js `sharedUniform`) |
| | `syncAtmos(G)` | copy `G.sun` (dir/color/intensity) into uniforms + sun light; zero-alloc, per frame OK |
| | `patchAtmos(mat, {additive})` | built-in materials; `additive:true` = transmittance only (glows, decals) |
| | `patchAtmosTree(root)` | patch everything under root (skips ShaderMaterials, auto-additive) |
| | `atmosUniforms()` | the shared uniform objects for custom `ShaderMaterial`s |
| sky.js | `createSky(G, {diskRadiance=60, envClamp=6, far, addToScene})` | → `{mesh, material, makeProxy(), dispose}`; `SKY_FS` exported. `far` (legacy) overrides `ART.sky.fogFar`/`fogged`. Reads shared `uFlash` (weather/lightning.js) + `'lightning'` `{azim}` events: cold in-cloud flash |
| env-from-sky.js | `createEnvFromSky(G, sky, {size, intensity, height=1.7, setScene})` | → `{texture, renderTarget, bake()}`; emits `'env'`; re-bakes on `'contextrestored'` |
| pcss.js | `installPCSS({G, tier, lightSize=0.012, maxPenumbra=0.45, search=30})` | replaces `getShadow()`; `setPCSSTier(G, tier)` recompiles |
| | `fitSunShadow(G, box3, mapSize?, {margin=2, maxShadowLen=60})` | texel-snapped ortho fit; sets bias/normalBias + PCSS metric data |
| | `createShadowScheduler(G, {mode:'static'|'dynamic', every=2})` | `.invalidate(frames)`; core has `shadowMap.autoUpdate=false`; re-renders on `'contextrestored'` |
| | `casterBounds(root)`, `pcssData`, `PCSS_TIERS`, `setShadowMapSize(light, n)` | |
| probes.js | `createProbe(G, {position, box, size, near, far, hide})` | → `{capture(bounces=2), assign(rootOrMats, {intensity, boxProject}), contains(p), texture}`; a captured probe re-captures 3 frames after `'contextrestored'` |
| lights.js | `createLights(G, {budget})` → `.add(opts)` | opts: `position, kind:'pole'|'wall'|'pendant'|'none', type:'point'|'spot', target, color, intensity(cd, 60), range, angle, penumbra, real, pool:true|false|'always', poolRadius, albedo, halo, haloStrength, flicker, castShadow, groundY, rotationY` |

Custom shaders (sky, backdrop cards, particles, water): `fragmentShader: ATMOS_DECL + ATMOS_GLSL + src`,
`uniforms: { ...atmosUniforms(), ... }`, then `col = atmosApply(col, worldPos, cameraPosition);`. Additive
particles: `col *= atmosTransmittance(worldPos, cameraPosition);`. A far backdrop quad at distance D:
`atmosApply(col, cameraPosition + dir * D, cameraPosition)` — matches the sky exactly.

## ART knobs read
- `ART.sun` (via `G.sun`): dir → shadows, sky, fog sun lobe; `color` = sky sun tint; `color*intensity` = `uSunColor`.
- `ART.sky`: `zenith, horizon, groundTint` (linear HDR radiance ~0.05–1.2), `cloudCover` 0–1, `cloudSharp` 0–1,
  `sunGlow` (aureole), `burnGap` 0–1 (deck opens toward the low sun), `fogFar` (m the shared fog is evaluated to
  on the sky, default 3000), `fogged` (default true; **`false` for airless/space scenes**: the sky skips the fog, so
  black space never becomes a fog-coloured wall, while geometry stays fogged).
- Lightning: `sharedUniform('uFlash')` 0..~1.5 (driven by `weather/lightning.js`) lights the cloud deck from inside
  with a cold flash, strongest toward the strike azimuth; no-op at 0 and in the env bake.
- `ART.fog`: `sigma` (per-channel extinction /m at `baseHeight`; blue > red), `scatter` (fog/horizon radiance —
  **this is the horizon colour you see**), `heightFalloff` (1/m), `baseHeight`, `sunInscatter`, `start` (m).
- `ART.ambient.envIntensity` → `scene.environmentIntensity`.

## Tuning (defaults are tuned for golden hour, sun 8–14°)
- Fog defaults (used when ART.fog is absent): `sigma [0.0035,0.0045,0.0065], falloff 0.05, scatter [0.78,0.60,0.46], start 4`.
  CONTRACT's example `sigma 0.010…0.016` is a rainy-port density (visibility ~80 m) — great for a rainy harbour, milky for a clear plaza.
- Horizon colour = `ART.fog.scatter` (the sky is fully fogged at the horizon). Keep `ART.sky.horizon` close to it.
- Too flat / shadows too bright: lower `envIntensity` (1.0–1.3). Shadows too black: raise it or `scatter`.
- `atmosTwilight()` dims sky+fog ambient automatically below ~11° sun elevation (day cycles need no re-authoring).
- PCSS `lightSize` 0.012 ≈ 1.3× the real sun; 0.02+ gives very soft overcast-style shadows but blurs window patches and
  shows more dither. Max penumbra 0.45 m keeps it from going noisy.
- Lamps: 60 cd at 3.4 m ≈ irradiance 5 at the pool centre (sun ≈ 7.5). Glass emissive auto-scaled to keep hue.
- Re-bake env (`env.bake()`) and probes when the sun moves noticeably; never per frame.

## Cost (M1 Max, 1600×900)
| | low | med | high | ultra |
|---|---|---|---|---|
| shadow map | 1024 | 2048 | 2048 | 4096 |
| PCSS blocker / PCF taps | 0 / 6 | 6 / 10 | 8 / 16 (32 in wide penumbrae) | 12 / 24 (48) |
| env PMREM size | 64 | 128 | 256 | 256 |
| probe cube | 64 | 128 | 128 | 256 |
| real practical lights | 2 | 4 | 8 | 12 (rest → fake pools) |
Sky: one fragment pass of 4 fbm × 6 value-noise octaves (only pixels with no geometry; depth-tested, drawn last). Fog: ~25 ALU per pixel.
Env bake ~2 ms, probe capture ~5 ms (6 scene renders), on load only (and again after a GL context restore).
Shadow map sizes = `engine/quality.js` TIERS[*].shadow (the source of truth; `G.quality.settings.shadow` wins,
`PCSS_TIERS[*].map` is only the fallback with no quality controller). High stays 2048 on purpose: 4096² RGBA depth
is 64 MB plus a 4x caster pass, and PCSS penumbrae hide the coarser texel. Crisper: `?q=ultra` or `fitSunShadow(G, box, 4096)`.

## Pitfalls
- `installPCSS` after a material compiled → that program keeps stock PCF until `material.needsUpdate = true`.
- Spot-light shadows use perspective depth; lights.js sets `shadow.radius = -2` (negative = plain PCF). Do the same
  for your own spot lights, or PCSS will use the sun's metric scale on them.
- `probe.assign` sets `envMap` on the materials you give it: give interiors their OWN material instances.
- Box projection (`boxProject`, default on with `box`) replaces `#include <envmap_physical_pars_fragment>`;
  only Standard/Physical materials.
- Fog is inserted before `#include <tonemapping_fragment>` (not at `<fog_fragment>`, which runs after tonemapping
  and colorspace conversion — wrong for HDR and for a direct-to-canvas fallback).
- Any `pow(x, y)` with x that can be a hair below 0 → NaN → one NaN texel in the sky poisons the whole PMREM
  (all IBL turns black). Clamp before pow in sky/env shaders.
- Don't interpolate `${}` into a `#define` line inside a `/*glsl*/` literal: the minifier trims the space before it.
- `fitSunShadow` box: include everything that casts or receives within the playable area; the far city outside it is
  unshadowed (fog hides it). Low sun → the fit grows by up to `maxShadowLen` along the sun direction.
