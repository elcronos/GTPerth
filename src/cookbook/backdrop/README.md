# backdrop/ — far field + world boundary

`farfield.js`. The distance must never look empty and the world must never end in a visible edge.

## API
- `createFarfield(G, {layers = FARFIELD_PRESETS.industrial, center=[0,0], winColor, add=true})` (alias `create`) →
  `{group, layers, update, dispose}`. Adds to `G.scene`, registers `update` on `G.on('update')` (allocation-free).
  Each layer: `{kind:'mountains'|'skyline'|'treeline', radius, height, base, follow (0 fixed … 1 travels with camera),
  windows (lit fraction, skyline), body/top (linear radiance, already sky-lit), rim, fogScale (apparent fog distance
  multiplier), seed, rough (mountains), winColor}`.
- Presets: `FARFIELD_PRESETS.industrial` (mountains 1150 m + skyline 640 m + treeline 330 m), `.wilderness`, `.city`.
- `boundaryBerm({inner, crestR, outer, crest, drop, base, heightAt, material})` annulus continuing the terrain edge, rising to
  a crest then sinking `drop` m below the base by `outer` (put outer beyond `fogDistance`). From inside you see a hill line, from
  above it melts into fog.
- `horizonSkirt({r0, r1, y, material})` flat ring under the far layers so no sky shows under their feet.
- `fogDistance(sigma, T=0.02)` metres until fog transmittance drops to T (lower bound; height fog only extends it).

## How it works
Open cylinders (BackSide, transparent, depthWrite) with a procedural profile `h(arc length)`: ridged fbm massifs,
building cells with rooftop plant/masts, or crown bumps/conifer spikes. Coverage is 4× supersampled across the pixel
(`fwidth` of arc length) → no stair-stepped building edges. Windows: 3.2 m floors × 2.4 m bays, hashed lit cells, faded to
their average glow before they alias. Rim on the sun side of crests, flat sun on faces when the sun is behind the camera.
Fog: `atmosApply()` from `lighting/atmos.glsl.js` evaluated at `cam + (p-cam)*fogScale` — identical maths to every other
material, so layers separate by aerial perspective. If `installAtmos(G)` was not called, the same uniform names are
registered with neutral golden-hour defaults.

## Wire into a game
```js
import { createFarfield, FARFIELD_PRESETS, boundaryBerm, horizonSkirt } from './backdrop/farfield.js';
installAtmos(G);                                    // lighting owner, first
createFarfield(G, { layers: FARFIELD_PRESETS.industrial });
scene.add(boundaryBerm({ inner: 218, crestR: 230, outer: 520, crest: 4, drop: 60, heightAt: T.heightAt, material: groundMat }));
scene.add(horizonSkirt({ r0: 500, r1: 1700, y: -55, material: groundMat }));
```
Keep `camera.far` ≥ the largest ring radius × 1.3 (core default 1500 m covers the presets).

## ART knobs
Reads the shared atmos uniforms (`ART.fog`, sun) only; layer colours are art-directed per preset. Window colour default
(3.2, 2.0, 0.95) HDR: raise ×2–3 for dusk/night, `windows` .05 day … .35 night.

## Tuning
- Layer separation: each nearer layer darker (`body`) and less fogged (`fogScale` .7 far → 1.0 near). If a ring vanishes,
  lower its `fogScale` before raising its colour.
- Terrain rim (`erodedHeight` bowl) higher than the treeline ring `height+base` hides it — keep the bowl ≤ ~10 m or move the ring out.
- Parallax: `follow` .85 mountains / .4 skyline / 0 treeline.

## Cost / tiers
3 draws; ring segments 128/192/256/320 by tier; fragment cost ~5 profile evals per covered pixel (only ring pixels). Berm 7k tris, skirt 0.5k.

## Pitfalls
- The atan seam at ±π: `fwidth` is clamped; do not remove the clamp (a one-pixel glitch column otherwise).
- Rings are transparent: they draw after opaques (sky included) and blend over the sky; keep their `renderOrder` < other transparents.
- Do not patchAtmos the rings (`userData.noAtmos`), they already call `atmosApply`.
