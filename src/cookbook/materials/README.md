# materials/: baked procedural PBR, weathering, triplanar

GPU-baked tileable texture sets (18 surfaces) plus one world-space weathering patch for every material: macro
variation, rain wetness, beads, dust, snow, edge wear and specular AA. No image files. All 18 surfaces bake in about
270 ms on an M1 Max, shader compile included.

## Files / exports
| file | exports |
|---|---|
| `library.js` | `initMaterials(G)`, `makeMaterial(name, opts) → MeshStandardMaterial`, `getSurfaceSet(name, opts)`, `MATERIAL_NAMES` |
| `bake.js` | `bakeSurface(renderer, {surf, lib?, size=1024, scale=1, depth=0.01, params={}, key?}) → {map, normalMap, roughnessMap, metalnessMap, aoMap, dispose()}`, `BAKE_SIZE`, `SURF_STRUCT`, `clearBakeCache()`, `bakeCacheSize()`, `rebakeAll(renderer)` (each set also has `rebake()`) |
| `surfaces.glsl.js` | `SURFACES[name] = {glsl, scale, depth, tint, porosity, emissive?, ground?, note}`, `SURF_LIB` (helpers), `SURFACE_NAMES` |
| `weathering.js` | `initWeathering(G)`, `setWeather({wet,dust,snow,macro,ground,specAA})`, `patchWeathering(mat, opts)`, `patchSpecAA(mat)`, `WEATHER_PRESETS` (prop / ground / sheltered), `W` (shared uniforms), `ensureWorldVaryings(shader)`, `ensureNoise(shader)` |
| `triplanar.js` | `patchTriplanar(mat, scaleMeters=2, {blend=0.6, sharp=4})` |
| `noise.glsl.js` | `NOISE_GLSL`: pcg3d hash, `vnoise[P]`, `gnoise[P]`, `fbm[P]`, `ridged[P]`, `voronoi[P]` (F1, F2, edge, id), `voronoiF1`, `vnoise3`, `fbm3`, `ign`. `*P` = periodic. Include-guarded. |

Surfaces (metres per tile): asphalt 2, concrete 4 (2 m slabs), painted_metal 2, rust 1, corrugated 2 (0.29 m pitch),
galvanised 1 (2.5 cm spangle), wood_planks 2 (0.2 m boards, knots), weathered_wood 2 (0.25 m × 2 m boards), tarp 1, plastic 1, rubber 0.5, rock 4, sand 2,
snow 2, ice 2, forest_ground 2, brick 1.8 (215×65 mm), emissive_panel 1 (4×4 tiles).

## Wire into a game
```js
import { initMaterials, makeMaterial } from './materials/library.js';
import { setWeather } from './materials/weathering.js';
initMaterials(G);                       // after createCore: renderer, G.quality.tier -> bake size, ART.surface -> uWet/uDust/uSnow/uMacro
const mats = {
  quay:  makeMaterial('concrete'),
  box:   makeMaterial('corrugated', { tint: 0x8c2f1e }),         // tint = material.color on masked texels (paint)
  box2:  makeMaterial('corrugated', { tint: 0x1f4d6b }),         // same bake, different colour
  cliff: makeMaterial('rock', { triplanar: true }),              // no UVs needed
  lamp:  makeMaterial('emissive_panel', { emissive: 0xffd6a0, emissiveIntensity: 4 }),
  dry:   makeMaterial('wood_planks', { weather: 'sheltered' }),  // under a roof: no rain/snow, light dust
  yard:  makeMaterial('asphalt'),                                // ground-class: 'ground' preset (no dust, no beads)
};
setWeather({ wet: 1, ground: 0 });      // at runtime, no recompile (ground = world Y for the splash band)
```
Make geometry UVs metric (1 UV = 1 m: rounded boxes, extrusions, terrain). Use `scale` to change metres per tile.
To weather a non-library material (a car paint, for example), call `patchWeathering(mat, { porosity: 0.2 })`. Apply
`patchSpecAA(mat)` on its own to any glossy or normal-mapped material.

**Your own surface:** write `void surf(vec2 uv, inout Surf s)`. Use only the periodic helpers (`nfbm`, `nvor`,
`fq(perMetre)` …) so the result tiles. Fill `s.albedo/height/ao/rough/metal/mask/emit`, then call
`bakeSurface(R, { surf: myGlsl, lib: SURF_LIB, scale, depth })`. `isoLine(field, widthM)` gives anti-aliased cracks at
a metric width.

## ART knobs read
`ART.surface.wet / dust / snow / macroVar` (initial values of `uWet / uDust / uSnow / uMacro`). `G.quality.tier`
sets the bake size: low 512, med and high 1024 (supersampled from 2048), ultra 2048.

## Shared uniforms (other modules)
All are `sharedUniform(name, 'float', …)` from engine/patch.js, so every patched material reads one value.
- `uSnow` 0..1: snow cover. `weather/snow.js` (`createSnow`) ramps it toward `ART.surface.snow` (its `cover`) while it
  snows and melts it after; weathering only reads it. `initMaterials` writes the initial `ART.surface.snow`, so call it
  before `createSnow` (the engine boot order does) or the ramp restarts from that value.
- `uWet` / `uWthGround`: rain wetness and the ground Y of the splash band; puddle/ground code should read the same.
- `uDust`, `uMacro`, `uSpecAA`.

## Context loss
`initMaterials(G)` listens to `G.on('contextrestored')` and calls `rebakeAll(renderer)`: every cached set is re-rendered
into its existing render targets, so materials keep their texture objects and need no rebuild (`G.materialsRebaked`
counts sets). `water/caustics.js` redraws its texture on the same event.

## makeMaterial opts
`tint, scale, rough=1, metal=1` (these multiply the baked values), `normal=1, ao=1, emissive, emissiveIntensity=4,
triplanar (true | {blend, sharp}), weather (false | 'prop' | 'ground' | 'sheltered' | {preset?, wet, dust, snow, edge,
porosity, beads, macro, edgeMetal, specAA}), size, tier, renderer`. The weather multipliers act per material on the
shared amounts; explicit values override the preset. Presets: `prop` (everything on), `ground` (dust 0, beads 0: dust
on up-facing faces would turn terrain beige, and flat ground holds a film, not droplets), `sheltered` (no rain, no snow,
dust 0.5). Ground-class surfaces (`SURFACES[name].ground`: asphalt, sand, snow, ice, forest_ground) default to
`ground`; everything else to `prop`. Concrete is used for walls too, so a concrete floor should pass `weather: 'ground'`.
`mat.userData.weatherPreset` records the choice. Edge wear is on by default (0.6) for painted_metal, corrugated and
plastic. Beads are off on tier low.

## Tuning tips
- Wet look needs something to reflect. Give `scene.environment` structure: sky, buildings, lights. A flat
  gradient env makes wet surfaces read as merely darker. Wet ground facing into the sun is where it shines.
- `porosity` (per surface) controls how much rain darkens a surface: concrete and wood 1, paint 0.25, metal ≈ 0.15.
- On rough porous surfaces, wet roughness stays around 0.2. Only standing water in low baked height (`pool`) goes
  mirror-like. Puddles and planar reflection are the ground owner's job.
- Dirt and grime in a surf program must only darken albedo, never lower `mask`. Otherwise the untinted grey shows
  through as light halos on dark tints (the tarp "clouds" bug).
- Avoid features larger than about 1/3 of a tile inside a surf: they repeat visibly. Large-scale variation comes from
  the world-space macro noise in weathering (`uMacro`, 0.25-0.35).

## Cost
- Bake: about 270 ms for all 18 at high, about 130 ms at low (one-off, done in 256-row bands so the GPU watchdog is
  never hit). Memory per surface: 3 RGBA8 textures with mips, ≈ 5.6 MB at 1024 and 22 MB at 2048. Bake only the
  names you use.
- Runtime per pixel: the weathering block is about 6 `vnoise3` calls plus a 3×3 Voronoi for beads, which is skipped
  when beads or wet are 0. Specular AA adds 2 derivatives. Triplanar adds 9 fetches instead of 4.
- Program count: `pbr|wth|specaa`, plus `triplanar` or `pbr-emit` variants. All materials made from the library share
  about 3 programs.

## Pitfalls
- Apply `patchTriplanar` after the library 'pbr' patch and before weathering (`makeMaterial` does this). It swaps
  `texture2D` with a macro around the map, roughness, metalness and ao includes. A patch that inserts texture code
  right after those includes would sample triplanar too.
- Sphere and cylinder UV seams show tile discontinuities unless the circumference is a whole number of tiles.
- Normal maps follow the OpenGL convention (+Y = +v). The normal-map alpha holds the baked height, which weathering
  reads for pooling, dust and snow. Do not replace it with an alpha-less normal map if you want those effects.
- Specular AA reads the mip-shortened normal length (Toksvig). Do not normalise normal maps after mipmapping.
- Tone mapping: these materials expect an HDR post chain. A showcase without one sets `ACESFilmicToneMapping`.
