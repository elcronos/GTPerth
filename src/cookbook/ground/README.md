# ground/ — wet ground, puddles, planar reflection

Checked on an isolated showcase page during development (a wet yard with puddles; not included in this repo).

## Files
| file | purpose |
|---|---|
| `planar-reflection.js` | mirrored camera + oblique near-plane clip → half-res mip-mapped HalfFloat target + world→UV matrix |
| `ground.js` | `createGroundMask` (seeded JS mask) + `patchGround` (wet→dry gradient, puddles, ripples, oil film, asphalt, mirror) |

## API
```js
createPlanarReflection(G, { height = 0, hide = [], scale = null /*override tier*/, clipBias = 0 })
  → { target, camera, uniforms:{uReflTex,uReflMat,uReflOn,uReflLod}, enabled, active, update(), setHeight(y), addHidden(obj), dispose() }
createGroundMask({ extent=[80,80], center=[0,0], size=512, seed=1, puddleScale=3.5, oilSpots=10,
                   lanes=[{axis:'x'|'z', at, width, spacing}], dryRects=[[x0,z0,x1,z1]] })
  → { texture (HalfFloat RGBA), xform: Vector4, size, depth, sampleDepth(x,z) }
patchGround(material, { G, mask /*required*/, refl, base='asphalt'|'none', water=0.16, wet=ART.surface.wet,
                        rain=ART.weather.amount if kind==='rain', rippleScale=3.2, waterTint=[.035,.032,.028], tier })
  → { uniforms: { uGrWater, uGrWet, uGrRain, uGrRippleScale, uGrWaterTint, ... }, material }
GROUND_MASK_GLSL   // bicubic mask sampling (grCubic, grMaskUV) — rain.js pastes it for puddle-biased splashes
PLANAR_GLSL        // uniforms + planarUV(worldPos) for your own shaders
```
Mask channels: **r** depression depth, rank-normalised so `uGrWater` = puddle area fraction · **g** dampness · **b** oil · **a** tyre wear.

## Wire into a game
```js
const groundMat = patchAtmos(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 }));   // white = default asphalt albedo
const ground = new Mesh(new PlaneGeometry(96, 96).rotateX(-Math.PI / 2), groundMat);
ground.receiveShadow = true; G.scene.add(ground);
const mask = createGroundMask({ extent: [96, 96], seed: 7, lanes: [{ axis: 'z', at: 0, width: 0.5, spacing: 1.8 }] });
const refl = createPlanarReflection(G, { height: 0, hide: [ground] });   // create AFTER your camera controller
const gnd  = patchGround(groundMat, { G, mask, refl, base: 'asphalt', water: 0.2 });
// live: gnd.uniforms.uGrWater.value (puddles), .uGrWet.value (damp), .uGrRain.value (ripples); refl.enabled = false indoors
```
Rendering: the reflection renders on `G.emit('prerender')` (post/pipeline.js emits it). With no pipeline it renders itself at
the end of `update` (if no prerender arrived last frame). It hides `hide[]`, any **direct scene child** with
`userData.noReflect = true` (rain/snow/dust/sea set this), and swaps `uReflTex` to a black 1×1 during its own pass, so no
material can create a GL feedback loop.

## How the shading works (stage → three chunk)
1. `map_fragment`: bicubic mask + sub-texel noise on the water line → `grPuddle`, `grSoak` (band within 0.10 of the line),
   `grDamp`; one continuous `grWet`. Asphalt: aggregate at 41/133 per m (faded by footprint), tar patches, lane rubber.
   Wet darkening ×0.5 + saturation; standing water = `waterTint`. Ripples computed here (needed before roughness).
2. `roughnessmap_fragment`: `roughness = mix(0.72, 0.05, grWet)`, puddles 0.03, + unresolved-ripple roughness.
3. `normal_fragment_maps`: dry bump (faded by wetness) + ripple gradient; puddles flatten any normal map.
4. `lights_physical_fragment`: F0 0.05 on water; oil = thin-film interference tint.
5. `lights_fragment_maps`: `radiance = mix(radiance, planar, w)`; LOD = roughness (puddle `r*10+0.25`, damp `2+r*7.5`, minus
   grazing) + `uReflLod`; 3 taps stretched vertically (wet-road streaks); ripple tilt offsets the lookup; edge fade to env.
6. `lights_fragment_end`: clamp direct specular to 40 (sun fireflies on mirror water).

## Tuning
- Puddle area: `uGrWater` 0.1–0.3. Bigger puddles: `puddleScale` 4–6. Keep `wet` ≥ 0.6 for "after rain".
- Mirror too sharp/too soft: change the `lodP` constants in `GR_REFL_INJECT` (ground.js). Ultra tier renders 1×.
- Ripples too busy: `uGrRain` 0.5 or `rippleScale` 2.5 (bigger rings). They fade with pixel footprint (no moiré).
- `base:'none'` if your material already has an asphalt/concrete map: the wetness still applies on top.
- The ground must be a horizontal plane (world up = +Y). For terrain, use materials/ weathering instead.

## Cost (M1-class, 1600×900)
| tier | reflection | ripples | notes |
|---|---|---|---|
| low | off (env only) | 1 layer | 0 extra passes |
| med | 0.5×, no MSAA | 2 layers | +1 scene pass at ¼ pixels |
| high | 0.5×, MSAA 4 | 3 layers | default |
| ultra | 1×, MSAA 4 | 3 layers | sharpest mirror |
Mask generation: ~150 ms at 512² (boot only). The reflection pass costs roughly a quarter of the main pass (draw calls ×1).

## Pitfalls
- Create the reflection **after** the camera controller so the fallback path sees the final camera.
- A material that samples `uReflTex` and is visible in the mirror is fine (texture is swapped), but hide large reflectors
  (`hide`) anyway — they waste the pass.
- Particles must be direct children of the scene with `userData.noReflect` (rain does this) or they double in puddles.
- Do not set `scene.fog`; fog comes from lighting/atmos `patchAtmos(groundMat)`.
