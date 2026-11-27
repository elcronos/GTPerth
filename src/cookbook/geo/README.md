# geo/ — geometry kit, terrain, scatter

All builders are load-time only (zero per-frame work except `scatter().update`, allocation-free).
Every output is an indexed `BufferGeometry` with `position / normal / uv / color`; **UVs are metric (1 uv = 1 m)**,
so `materials/library.js` sets tile at the right physical size. Vertex colour carries baked AO/grime: set
`material.vertexColors = true` on every material that renders kit/terrain/scatter geometry.
Checked on an isolated showcase page during development (not included in this repo).

## Files
| file | purpose |
|---|---|
| `noise.js` | CPU value noise / fbm / ridged, `rngFrom(seed)` (mulberry32), `fnv(str)` |
| `kit.js` | primitives, `Kit` builder (matrix stack, merge by material, contact AO, grime), real-scale props |
| `surface-nets.js` | `surfaceNets(D,nx,ny,nz)`, `sampler3`, `floodFillSolid` (adapted from MIT-licensed code, Copyright (c) 2026 Maksymilian Dendura (see THIRD_PARTY_NOTICES.md)) |
| `sdf-terrain.js` | SDF prims + `sdfDensity` + `buildSdfTerrain` (caves/arches), heightfield `terrain` + `erodedHeight`, `patchTerrainTint` |
| `scatter.js` | `poissonDisk`, `scatter` (InstancedMesh per cell, masks, jitter, fade LOD, sway), rock/grass/tree/bush generators, leaf atlas |

## kit.js
Primitives (centred on origin unless noted):
- `roundedBox(w,h,d, r=0.008, seg=2, step=0.6)` true quarter-cylinder edges, exact normals; `step` = interior subdivision so AO/grime have vertices.
- `extrudeBevel(points[[x,y]], {holes, depth, bevel=1.4mm, bevelSeg, curveSeg})` along Z, centred.
- `lathe(profile[[r,y]], {seg, phi0, phiLen, crease=35°})` split normals at sharp profile corners.
- `sweep(profile2D, path, {closed, caps, smooth, scale(t), curve, samples})`, `tube(path, r | r(t), {radial,...})` parallel-transport frames.
- `panelWall(w,h,{kind:'trapezoid'|'sine'|'rib'|'panel', pitch, depth})` real corrugation with 6 mm chamfers (front +Z, x 0..w, y 0..h).
- `iBeamGeo(L,{h,b,tw,tf})`, `circle(r,n)`, `mergeGeos(list)`, `normalizeGeo(g)`, `mergeByMaterial([{geo,mat}]|[Mesh])`, `vertexGrime(geo, fn|opts)`.

`Kit` builder: `push(x,y,z, ry,rx,rz, s)` / `pop()` / `pushMatrix(m)`, `add(geo, matKey, {at, rot, color, occ})`,
`box(w,h,d,key,{at,r,step,color})`, `cyl(r,h,key,o)`, `bar(a,b,w,h,key)`, `tube(path,r,key)`,
`bakeAO({radius=.35, samples=10, strength=.75, ground, keys})` (contact AO: probes inside other parts' boxes/cylinders or below `ground`),
`grime({base, foot, down, streak, dirt, scale})`, `build({key: Material, default})` → Group, **one Mesh per key**.

Props (write into a Kit at its current matrix, base at y = 0, real dimensions): `container(k,{len,w,h,mat,hw,color})`
(ISO 20' 6.058×2.438×2.591, length along X, doors +X), `crate`, `barrel` (200 L drum), `pallet` (EUR 1200×800×144),
`stairs({n,rise,run,w,rails})` (along +Z), `railing(points,{h})`, `fence(L,{kind:'palisade'|'rail'})` (along X),
`ladder(h,{cage})`, `pipeRun(points,{r,bend,flangeEvery})` (real elbows + flanges), `girder`, `latticeGirder`,
`windowFrame(w,h,{cols,rows,glass,sill})`. Material keys used: `paint steel wood glass concrete dark` (override via `mat`/`hw`).
Colour tints go to vertex colour → one material per *surface type*, not per colour. Paint palette: `PAINT`.

```js
const k = new Kit();
k.push(0, 0, 0, 0.2); container(k, { mat: 'paintBlue', color: 0xffffff }); k.pop();
k.push(4, 0, 2); crate(k); k.pop();
k.bakeAO({ ground: 0 }); k.grime({ base: 0 });
scene.add(k.build({ paintBlue, steel, wood, glass, dark, concrete, default: steel }));
```

## sdf-terrain.js
- `terrain({size, res, fn, cells, cx, cz, material, cavity})` → `{group, meshes, heightAt(x,z), normalAt(x,z,out), grid}`.
  `heightAt` is exact on the rendered triangles (props never float). Vertex colour = Laplacian cavity (gullies darker).
- `erodedHeight({seed, amp, freq, octaves, ridge, ridgeFreq, base, flats:[{x,z,r,h,edge}], bowl:{r0,r1,h}, detail})` derivative-damped fbm (erosion look) + ridges; `flats` carve play areas, `bowl` raises the rim to hide the edge.
- `patchTerrainTint(mat, {grass, dry, rock, slope:[a,b], scale, amount, ref})` world-space recolour (linear albedos): grass on flats, dry by macro noise, rock on slopes. Match `grass` to your blades' average so the grass fade is invisible.
- `sdfDensity({ground:{y,amp,freq}|{fn}, warp, prims:[{type:'capsule'|'sphere'|'box'|'torus', op:'add'|'sub', k}], rough, strata})` → density fn (>0 solid). `ground.fn = (x,z)=>T.heightAt(x,z)-0.4` sits an outcrop/arch on a heightfield (only prims get rough).
- `buildSdfTerrain(fn, {min, size, voxel, cell, flood, ao, material})` → `{group, meshes, density, heightAt, tris}`; flood fill removes floating specks; normals from the density gradient; AO = openness at 1.5/4 m.
- SDF helpers: `sdSphere sdBox sdCapsule sdTorus smin smax`, `sampleField`.

## scatter.js
```js
const pts = poissonDisk({ x0:-100, z0:-100, w:200, h:200, r:3, rng: rngFrom(4), accept:(x,z,r)=>x*x+z*z>900 });
scene.add(scatter(G, { parts:[{ geo: rockGeo({seed:1}), material: rockMat }], points: pts,
  heightAt: T.heightAt, normalAt: T.normalAt, slope:[0,40], scale:[0.3,1.5], align:0.6, sink:0.1,
  tint:{ color:0xffffff, l:0.08 }, fade:[120,170], cell:40 }).group);
```
- `scatter(G, o)` options: `parts` (share transforms: trunk+leaves), `points`|`area+r`, `heightAt/normalAt`, `slope:[minDeg,maxDeg]`,
  `height:[minY,maxY]`, `mask(x,z,rnd)→prob`, `scale`, `scaleY`, `align` (0 upright…1 ground normal), `tilt`, `sink`,
  `tint:{color,h,s,l}` (instanceColor HSL jitter), `fade:[near,far,widen]`, `cell` (culling cell m), `sway:{amp,freq,power,height,flutter}`,
  `shadow` (false for grass), `tiered` (false = ignore tier). Returns `{group, count, cells, update, dispose}`; `update` auto-registers on `G.on('update')`.
- Fade LOD: each instance shrinks to 0 over its own random window in [near,far] (density thins, never pops); `widen` (grass 1.8) fattens survivors. Cells past `far` are hidden on the CPU.
- Patches (via engine/patch.js): `swayPatch(mat,o)` ('sway', world-space wind `uWind` shared uniform, also used for shadow depth), `fadePatch(mat,near,far,widen)` ('fade'), `foliagePatch(mat,{trans})` ('foliage': no back-face normal flip + sun translucency), `depthFor(mat,sway,fade)`.
- Generators: `rockGeo({seed,radius,detail,cuts,squash,noise})` (icosphere+fbm+plane cuts, ~1.3k tris), `grassTuftGeo({blades,h,w,spread,segs})` (~6 tris/blade),
  `treeGeo({seed,height,trunkR,branches,leafSize,density})` → `{trunk, leaves}` (~1.7k + ~0.9k tris), `bushGeo({radius,height,cards})`, `leafTexture({size,seed,kind:'broad'|'needle'})` (DataTexture, colour-dilated, alpha-boosted mips), `icosphere(detail)`.
- Materials: leaves `MeshStandardMaterial({map: leafTexture(), alphaTest: .45, side: DoubleSide, vertexColors: true})` + `foliagePatch`; grass `DoubleSide` + `foliagePatch({trans:.18})`.

## ART knobs read
`ART.weather.wind` → copied into the shared `uWind` (vec3, m/s) by the first `scatter()` call; animate `patchUniforms.uWind.value` for gusts/storms. Nothing else: art direction lives in the colours/materials you pass.

## Quality tiers
`SCATTER_TIERS` (keep fraction, fade scale): low .4/.6, med .7/.8, high 1/1, ultra 1/1.25 — applied automatically from `G.quality.tier`.
Suggested: terrain `res` 2 m low / 1 m else; `buildSdfTerrain` voxel .5 low / .3–.35 high; `bakeAO samples` 6 low / 10 high.

## Cost (M1 Max, V8, measured)
20 containers build 86 ms + bakeAO 415 ms (274k verts) + grime 130 ms · terrain 440 m @1 m 110 ms · SDF 36×18×24 m @0.3 m 190 ms · poisson 150² r .6 140 ms.
GPU: yard showcase ≈ 3–6 M tris, 280–560 draw calls on high (trees dominate: ~2.6k tris each; use fewer/farther-fading trees on low).

## Pitfalls
- **One material per scatter setting**: fade/sway uniforms live on the material; reusing a material with a different `fade` warns and the last call wins (trees went bald when they shared the bush material).
- `vertexColors = true` or the baked AO/grime/cavity is invisible.
- Weathering dust (`ART.surface.dust`) coats every up-facing face incl. terrain — pass `weather:{dust:0}` to the terrain material or it turns beige.
- Kit props sit at y = 0 of the current matrix; a slab top at 0.07 means push y 0.07. Decals on corrugated walls go 4 mm in front of the crests (`hz - 0.008` for containers).
- Never insert GLSL by matching `'void main() {'`: the minifier rewrites that text inside templates. Insert after `#include <common>`.
- `bakeAO` occluders are boxes/cylinders in part-local space; tubes/sweeps do not occlude (set `occ:false` on parts that should not).
- Trees within the fade distance all draw: budget ~2.6k tris each.
