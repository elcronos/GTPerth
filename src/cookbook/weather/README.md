# weather/ — rain, snow, dust motes, lightning

Checked on an isolated showcase page during development (rain, snow, dust and storm variants; not included in this repo).

## Files
| file | purpose |
|---|---|
| `rain.js` | 9k camera-wrapped velocity streaks + 900 puddle-biased splash crowns + `RAIN_LENS_GLSL` for post |
| `snow.js` | turbulent flakes + shared `uSnow` accumulation; `patchSnowCover` minimal cover patch |
| `dust.js` | floating motes lit only where the sun shadow map says "lit" (sun shafts), HG forward scatter |
| `lightning.js` | seeded multi-stroke flashes → `uFlash`, env intensity, flash light, `lightning`/`thunder` events |

All particles: one instanced draw each, positions computed in the vertex shader from a seed + time (no CPU sim, zero
per-frame allocation), `userData.noReflect = true`, fogged with `lighting/atmos` (`atmosTransmittance` for additive
rain/dust, `atmosApply` for alpha-blended snow). `fogUniforms(G)` installs atmos if nobody did.

## API
```js
createRain(G, { count=9000, box=[36,18,36], fall=8.5, wind=ART.weather.wind, shutter=0.03, width=0.0012, minPx,
                amount=ART.weather.amount, groundY=0, mask, ground /*patchGround result*/, splashes=900,
                splashSize=0.07, splashRadius=11, splashRate=3.2, shelters=[[x0,y0,z0,x1,y1,z1]×≤4],
                brightness=2.2, splashBrightness=0.8, ambient=[.22,.24,.28], seed })
  → { mesh, splashes, uniforms, splashUniforms, lightUniforms:{uRAmb,uRSun,uRSunDir,uRFlash}, amount (get/set), update, dispose }
RAIN_LENS_GLSL   // vec3 rainLens(vec2 uv, float t, float amount, float aspect) → xy uv offset, z drop mask
DROP_LIGHT_GLSL  // vec3 dropLight(viewDir): ambient + 2-lobe HG toward the sun
createSnow(G, { count=9000, box=[30,16,30], fall=1, wind, size=0.02, minPx=1.5, amount, turbulence=1,
                cover=ART.surface.snow, settle=40 /*s to reach cover*/, groundY, ambient, opacity=0.9 })
  → { mesh, uniforms, uSnow, cover, amount, update, dispose }
patchSnowCover(material, { sharpness=0.25 })   // only if materials/ weathering patch is not used
createDust(G, { count=2500, box=[14,6,14], size=0.0025, minPx=1, gain=2.5, amount=1, drift, ambient, shadow=true })
createLightning(G, { interval=[18,45], seed, envBoost=5, lightIntensity=12, color, strength=1, auto=true, light=true })
  → { strike(t?), flash (get), uFlash, light, update, dispose }    // emits G 'lightning' {dist,azim}, 'thunder' {dist}
```

## Wire into a game
```js
installAtmos(G);                                                // lighting/atmos (fog for particles)
const rain = createRain(G, { groundY: 0, mask, ground: gnd });  // mask/gnd from ground/ → splashes prefer puddles
const storm = createLightning(G, { interval: [20, 50] });
G.on('thunder', (e) => audio.thunder(e.dist));
// inside a building: rain.amount = 0 or pass shelters; snow: createSnow(G,{cover:0.7}) + materials read uSnow
```

## Look rules baked in (keep them)
- **No streak aliasing**: width never below `minPx` (0.85 px med/low, 1.25 px high/ultra); when the true width is smaller
  the alpha is scaled by true/clamped width (energy conserving). Same rule (by area) for snow/dust/splashes; splashes
  under 3 px fade out. Drops fade at the wrap-box faces and within 0.35–1.6 m of the lens (no popping, no giant smears).
- Rain brightness = sky ambient + sun × HG (g 0.86 + 0.35 lobes): rain glows toward the low sun, nearly vanishes
  with the sun behind you — exactly like real back-lit rain.
- Splashes: 3 candidate positions per life cycle, keep the wettest (mask depth vs `uGrWater`) → ~3× more in puddles.

## Tuning
- Heavier rain: `amount` 1, `count` 14000; longer streaks: `shutter` 0.04; more visible: `brightness` 3.
- Snow cover speed: `settle`; flake size `size` 0.015–0.03; gusts: `turbulence` 1.5.
- Dust only shows in sun-lit air: needs `G.sun.light.castShadow` and a rendered shadow map; `gain` 2–5.
- Lightning: `strength` < 1 for distant storms; the sky reacts only if the sky shader reads `uFlash`.

## Cost (desktop)
| system | high | low |
|---|---|---|
| rain streaks | 9k quads, 1 call | 3.6k |
| splashes | 900 quads, 1 call | 360 |
| snow / dust | 9k / 2.5k quads | ×0.4 |
| lightning | 0 GPU (1 extra directional light while flashing) | same |
Counts scale with tier (low .4, med .7, high 1, ultra 1.3). All additive/alpha, no depth write → fill-rate bound only
when the camera is inside dense near-field rain.

## Pitfalls
- Particles must be direct scene children (they are) so planar reflection can hide them.
- The flash light adds a shader variant (one more directional light) the first time it is created → create lightning at
  boot, not at the first strike.
- `uSnow`/`uFlash` are shared patch uniforms: only materials compiled after the module created them declare them
  automatically (create weather before patching materials, or `sharedUniform` them at boot).
