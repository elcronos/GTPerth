# decals/ — canvas-2D signage, stencils, labels, hazard stripes

`canvas-text.js`. Load-time only. Text + wear is the cheapest realism cue: every yard/port/bunker needs IDs, warnings and
plates. Distress is seeded by an FNV hash of the text, so a sign always wears the same way and no two signs match.
No web fonts (single-file games run offline): condensed system stacks in `FONTS`; stencil bridges are cut procedurally.

## API
| export | what |
|---|---|
| `signCanvas({w,h (m), ppm=320, bg, fg, border, stripes, lines:[{text,size(frac of h),color,font,stencil}], rivets, wear=.45, dirt=.35, seed})` | plate with border, centred lines, optional hazard band, rivets, grime, wear |
| `stencilCanvas({text, h (letter m), ppm=400, color, wear=.4, overspray=.35})` | spray stencil on transparent bg (container IDs, "NO STEP") |
| `labelCanvas({rows:[[k,v]], w, ppm, color, wear, plate})` | data plate rows (MAX GROSS 30480 KG …) |
| `numberCanvas({text, h, color, box, wear})` | bay / column numbers |
| `hazardCanvas({w,h,ppm,wear})` | yellow/black 45° band |
| `stencilText(ctx,text,x,y,size,{font,color,spacing,bridge,align})`, `hazardStripes(ctx,x,y,w,h,{pitch,a,b})`, `fitText` | drawing helpers for custom canvases |
| `distress(canvas,{amount,seed,edge,chips,scratches,specks})`, `grime(canvas,{amount,seed,color})` | wear passes (destination-out / source-atop) |
| `DecalAtlas(size=2048,pad=8)`: `.add(name, canvas)`, `.finish(renderer)` → texture, `.uv(name)` | shelf packer; shrinks entries uniformly if they do not fit |
| `canvasTexture(canvas, renderer)` | sRGB, trilinear mips, anisotropy ≤ 8, premultiplied upload |
| `decalGeo(atlas,name,w,h?)`, `decalMaterial(tex,{roughness,metalness,key})`, `decalMesh(atlas,name,w,h?)`, `unpremultiply(mat)` | plane facing +Z mapped to the atlas rect; material: blended, depthWrite off, polygonOffset −2, 'unpremul' patch |

## Wire into a game
```js
import { DecalAtlas, signCanvas, stencilCanvas, decalMesh } from './decals/canvas-text.js';
import { patchAtmos } from './lighting/atmos.js';
const atlas = new DecalAtlas(2048);
atlas.add('gate', signCanvas({ w: 2.4, h: 1.1, lines: [{ text: 'TERMINAL B' }, { text: 'GATE 4', color: '#9a1e14' }], stripes: true }));
atlas.add('id1', stencilCanvas({ text: 'GNRU 304512 3', h: 0.2 }));
atlas.finish(G.renderer);
const m = decalMesh(atlas, 'id1', 1.9); m.position.set(x, 2.2, z + 1.211); scene.add(m);   // 2-5 mm off the surface
patchAtmos(m.material);   // decals must be fogged like everything else (once per shared material)
```

## Tuning
- Print density: `ppm` 300–400 px/m reads crisp at 2 m; atlas 2048² holds ~15 signs. Text height ≥ 0.1 m or it shimmers past 15 m.
- `wear` .3 fresh … .7 derelict; `edge` biases wear to the borders (plates), keep low (.1–.2) on stencils.
- Rough/metal: paper/paint .6/0, enamel plate .35/0.

## Cost
Each canvas: 5–40 ms (per-pixel fbm wear on the CPU; ~1 ms per 10k px). Draw: one call per decal (share one atlas material); all decals sort in the transparent pass (`renderOrder 2`).

## Pitfalls
- Decals are transparent, so they need `patchAtmos` (or they glow through fog) and `vertexColors=false` (shared material).
- On corrugated/curved surfaces a flat decal floats over troughs: place it 4 mm in front of the crests, small sizes only.
- Never set `premultipliedAlpha` on the material: the texture is premultiplied and the 'unpremul' patch divides it back (correct filtering, correct fog).
- System font fallback differs per OS (DIN Condensed on macOS, Bahnschrift on Windows, Arial Narrow/Impact elsewhere); keep text short and use `fitText` widths.
