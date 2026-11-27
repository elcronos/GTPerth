# water/ — Gerstner sea, caustics

Checked on an isolated showcase page during development (a beach and a quay with caustics through shallow water; not included in this repo).

## Files
| file | purpose |
|---|---|
| `sea.js` | Gerstner ocean on a camera-centred radial grid, patched MeshStandardMaterial; JS `heightAt` for buoyancy |
| `caustics.js` | animated 512² caustic texture + `patchCaustics` ('under' seabed / 'over' reflected light on walls) |

## API
```js
makeWaves({ seed=3, windDir=0 /*rad*/, count=8, detail=12, L0=48, falloff=0.66, steep=0.09, chop=0.65, spread=0.9, detailSteep=0.08 })
  → { vtx:[{dx,dz,k,a,w,q,ph,L}], det:[...] }        // ω = √(g·k), Σ q·k·a = chop
createSea(G, { level=0, waves, waveOpts, windDir=atan2(ART.weather.wind),
               floor:{ glsl:'float seaFloorY(vec2 p){...}', js:(x,z)=>y }, // optional; omitted = opaque deep sea
               scatter=[.010,.050,.060], absorb=[.40,.10,.07], foam=1, envIntensity=1, refl, far=2400, rings, segs })
  → { mesh, material, uniforms, waves, level, heightAt(x,z,t=G.t), normalAt(x,z,t,out), update(), dispose() }
createCaustics(G, { size=512, every })            → { texture, update, rebake, dispose }  // renders on 'update'; rebake() runs itself on G.on('contextrestored')
patchCaustics(material, caus, { G, mode='under'|'over', waterY, scale=3.3 /*m per tile*/, strength=1,
                                fadeFar=60, maxDepth=6 /*under*/, reach=2.5 /*over*/, wetten=true })
```

## Wire into a game
```js
const sea = createSea(G, { level: -2.4 });                       // adds itself to the scene, follows any camera
patchAtmos(sea.material);                                         // fog (lighting/atmos)
boat.position.y = sea.heightAt(boat.position.x, boat.position.z) - draft;   // every frame, same maths as the GPU
// shallow water + beach: give the SAME floor to the sea (GLSL) and to your seabed mesh (JS)
const caus = createCaustics(G);
patchCaustics(sandMat, caus, { G, mode: 'under', waterY: -2.4 });
patchCaustics(pierMat, caus, { G, mode: 'over',  waterY: -2.4 });
```

## How it works
- Waves are baked into GLSL as constants (rebuild the sea to change them). Vertex: 8 Gerstner waves, each faded out
  when shorter than ~6 local grid spacings (radial grid spacing ≈ 0.0255·(r + a)), so far geometry never aliases.
  Grid recentres on the rendering camera in `onBeforeRender`; waves are world-space → no swimming.
- Fragment normal: analytic derivatives of all 8 + 12 detail waves at the undisplaced point; each wave fades with pixel
  footprint and its lost slope variance goes into roughness (`sqrt(0.035² + 1.6·lost)`), i.e. **glitter AA**: the sun path
  widens instead of sparkling.
- Shore mode (floor given): water depth → view path (Snell) → transmittance T; alpha = 1 − T(1−F) with premultiplied
  blend (One, OneMinusSrcAlpha), so reflections stay full strength while the seabed shows through. Waves shrink in
  water shallower than 4 m (`seaShallow`) so they never poke through the sand.
- Foam: Jacobian of the Gerstner sum (folding crests) + a breathing swash band (depth < ~0.1-0.17 m), textured as a
  bubbly film with random-size holes on a warped drifting lattice, broken into patches.
- Crest glow: sun-facing forward scatter through thin crests (teal) added to indirect diffuse.
- Caustics: pattern from the classic tileable iterated-warp caustic (adapted from MIT-licensed code, Copyright (c) 2026 Maksymilian Dendura (see THIRD_PARTY_NOTICES.md); starting
  the sum at 1 gives dark water + bright filaments, texture mean ≈ 0.19 → ×5 so the sun's energy is conserved).
  'under' projects along the **refracted** sun, multiplies sun direct diffuse only (shadows stay dark), darkens/wets
  submerged and swash-zone albedo. 'over' projects along the mirrored sun and adds a dancing reflected term that falls off
  over `reach` metres above the water. Both fade to their mean beyond `fadeFar`.

## Tuning
- Calmer sea: `waveOpts:{ steep: 0.06 }`; choppier: `chop: 0.8` (≤ 1 or crests loop). Bigger swell: `L0: 80`.
- Max crest height ≈ Σa ≈ 1–1.5 m at defaults: keep quays/ground ≥ 2 m above `level`.
- Water colour: `scatter` (deep body colour, linear, small numbers), `absorb` (mean drives see-through depth; 0.19/m ≈ clear).
- Too milky near the shore at sunset = correct Fresnel of a bright sky; darken the sky or lower `envIntensity`.
- Caustic size: `scale` 2–5 m per tile; strength 0.6–1.5.

## Cost
| tier | grid (rings×segs) | waves vtx/detail | caustic tex |
|---|---|---|---|
| low | 150×256 (77k tris) | 4 / 6 | 256², every 2nd frame |
| med–ultra | 230×400 (184k tris) | 8 / 12 | 512², every frame |
One draw call for the sea, one tiny fullscreen pass for caustics (~0.1 ms).

## Pitfalls
- The radial grid's triangles must face +Y (they do); if you rebuild it, keep CCW-from-above winding or only folded crests render.
- The camera must stay above the surface (FrontSide only; no underwater rendering here).
- `floor.glsl` and `floor.js` must be the same function or foam/transparency won't match your seabed mesh.
- `heightAt` matches the GPU exactly only near the camera (far waves are faded on the GPU for AA).
