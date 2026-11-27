# post/: HDR post-processing chain (three r180, WebGL2, no EffectComposer)

Files: `pipeline.js` (createPost and the frame graph), `shaders.js` (GLSL for every pass), `fullscreen.js` (the fullscreen-triangle helper every pass uses).
Checked on an isolated showcase page during development (not included in this repo).

## Frame graph (runs inside `G.render()`)
```
emit('prerender') → scene → HalfFloat MSAA(0/2/4) + DepthTexture        [full res × G.quality.scale]
  → [overlay: view model drawn into depthRange(0,0.05)]
  → [zFull: current-frame full-res linear depth R32F]   (only when post.transparent / posttransparent / params.zFull)
  → [after-opaque: emit('posttransparent') + post.transparent drawn into the HDR target, depth-tested]
  → linear depth R32F (half) → SSAO (8/12/16 taps) → bilateral H+V (half)
  → volumetric shafts: 16-24 IGN-jittered steps through G.sun.light.shadow.map → bilateral H+V (half)
      atmos mode (lighting/atmos installed): only the shadowed-sun correction of the analytic fog, see below
  → composite: joint-bilateral upsample, AO weighted toward dim pixels, col*T + inscatter (full HDR)
  → [camera motion blur: depth reprojected with last frame's view-projection, 8 taps]   (off by default)
  → bloom: 6 × 13-tap down (Karis on level 0; alpha = soft-knee thresholded luma)
  → eye adaptation: 7×5 centre-weighted log-average of level 2 → 1×1 ping-pong, tau
  → bloom: 5 × 9-tap tent up (lerp by bloomScatter) → [anamorphic streak, 3 passes]
  → tonemap mix(ACES Hill, AgX, agxMix) → lookPower → sat → luma S-curve → split tone → vignette
    (chromatic aberration is sampled first, bloom/dirt/streak are added before exposure)
  → final to canvas: [final hooks: rain-lens drops] FXAA 3.11 (luma in alpha) + luma-only sharpen
    + luminance-weighted grain + TPDF dither
```

## API
```js
import { createPost, POST_TIERS } from './post/pipeline.js';
const post = createPost(G, {
  overlay, streak, adaptKey, volMaxDist,
  volMode,        // 'auto' (default) | 'standalone'. auto = atmos mode when installAtmos(G) ran
  motionBlur,     // false (default) | true (= shutter 0.5) | shutter number. Racing / flight genres
  rainLensGLSL,   // RAIN_LENS_GLSL from weather/rain.js: compiles the lens drops into the final pass
  rainLens,       // initial params.rainLens (0 = dry)
  finalHooks,     // [{ decl, pre, uv, color, uniforms }] custom GLSL pasted into the final pass (see below)
  zFull,          // true: refresh targets.zFull every frame even with nothing in post.transparent
});                        // sets G.post and G.render
post.render();             // called by core's loop via G.render. Do not call it yourself.
post.setSize(w, h);        // optional manual override. It auto-sizes every frame to G.width*G.dpr*G.quality.scale
post.params                // live knobs (below). Mutate at runtime, they are read every frame
post.targets               // { scene, depth, comp, ldr, zHalf, zFull, ao, vol, bloomDown[], bloomUp[], adapt[] }
post.transparent           // a THREE.Scene drawn after opaque into the HDR target (soft particles, glass, FX)
post.useTransparentEvent() // call once if you draw in G.on('posttransparent', (renderer, camera, post) => ...)
post.atmosVol              // true when the volumetrics run in atmos mode
post.resetAdaptation()     // snap the exposure on the next frame and drop the motion-blur history (teleport / cut)
post.resetMotion()         // only drop the motion-blur history (camera cut without an exposure snap)
post.dispose()
```

### Volumetrics and lighting/atmos (one fog, not two)
With `installAtmos(G)` every patched material, the sky and the particles already apply the analytic height fog
(`uFogSigma`, `uFogScatter`, `uFogStart`, ... from `lighting/atmos.glsl.js`). That model assumes the whole medium is
sun-lit. In atmos mode the volumetric pass reads the same shared uniform objects and marches the same medium
(same density, same `uFogStart`, same two-lobe phase and the same `0.0125·uFogSunInscatter` sun term). It outputs
the sun in-scatter that the shadowed segments should not have received, as a negative radiance, with transmittance 1:
- the haze and its extinction are applied once, by the materials (so `volAmbient` is 0 and `volDensity`,
  `volExtinction`, `volScatter`, `volG` are ignored);
- the net result is ambient haze plus shadowed sun in-scatter: shafts are the lit gaps between darker shadow volumes;
- outside the shadow frustum the correction is exactly 0, so the frustum edge no longer shows up as a lit wall;
- `params.volShaft` (default 1) scales the correction: 1 is physically exact, 1.5 gives deeper shafts.
To make the whole look hazier or clearer, change `ART.fog.sigma` / `fog.sunInscatter` (the lighting owner's knobs),
not the post params. Without atmos (or with `volMode: 'standalone'`) the pass is the fog itself, as before.

### After-opaque pass and current-frame depth (soft particles)
Every frame with something in `post.transparent` (or after `useTransparentEvent()`, or with `params.zFull`):
1. the opaque scene and overlay are rendered and MSAA is resolved;
2. `targets.zFull` (R32F, full render resolution, positive view distance in metres, same convention as `zHalf`)
   is written from this frame's depth;
3. `G.emit('posttransparent', renderer, camera, post)` runs with the HDR target bound, then `post.transparent` is
   rendered with `G.camera`, depth-tested against the opaque depth.

Soft particles read `zFull` with `texelFetch(tZ, ivec2(gl_FragCoord.xy), 0).r` (same resolution as the target they
draw into) and fade by `(sceneZ - particleZ) / softness`. There is no feedback loop: `zFull` is a separate texture.
Use `depthWrite: false`; objects here get no lights or shadows from `G.scene` (unlit, additive or custom-lit
ShaderMaterials). They are fogged by their own atmos code and sit under the volumetric correction, AO is computed
on opaque depth only. Particles that stay in `G.scene` can still read `zHalf` or `zFull`, but those then hold the
previous frame (one-frame lag on camera cuts).

### Camera motion blur
`createPost(G, { motionBlur: true })` or `params.motionBlur = 0.5` (shutter fraction, 0 = off; URL `?mb=1` / `?mb=0`).
Velocity comes from reprojecting each pixel's depth through the previous frame's view-projection, so only camera
motion blurs (moving objects that the camera follows stay sharp, which suits cockpit / chase cameras). 8 IGN-jittered
taps centred on the pixel, length capped at `params.motionBlurMax` (40 render pixels). The first-person overlay is
never blurred and never smeared into the world. Call `post.resetAdaptation()` or `post.resetMotion()` after a cut.
Cost: one full-res pass with 9 colour and 9 depth taps, only when enabled.

### Rain lens and final-pass hooks
```js
import { RAIN_LENS_GLSL } from './weather/rain.js';
createPost(G, { rainLensGLSL: RAIN_LENS_GLSL });   // compiled in, costs nothing while dry
G.post.params.rainLens = 0.5;                       // 0..1 drop amount (URL ?rainlens=0.5); 1 is very wet
```
The drops refract the frame (the lookup UV moves before FXAA) and dim it by up to 15 %. The post chain does not
import rain.js itself, so games without rain do not bundle it. Generic hooks use the same mechanism:
`finalHooks: [{ decl, pre, uv, color, uniforms }]`, where `decl` is file-scope GLSL, `pre` is declarations at the top
of `main()`, `uv` may modify `vec2 uv`, `color` may modify `vec3 col` (after sharpen, before grain and dither), and
`uniforms` is merged into the material. `uTime` (G.t) and `uAspect` are available.
`opts.overlay = { scene, camera }`: a first-person view model with its own lights and camera (FOV ~54). It is drawn after the world with `gl.depthRange(0, 0.05)`. That works as a depth clear, but it keeps world depth so AO and volumetrics stay correct. The pipeline keeps `overlay.camera.aspect` updated. The view model gets no AO or fog, which is correct.

## Wiring into a game
```js
const G = createCore({ ART });
// ... lighting (sun shadow map!), sky, world ...
createPost(G, { overlay: { scene: vmScene, camera: vmCam } });
G.start();
```
Requirements:
- The sun's `DirectionalLight` must cast shadows, and its shadow camera must be fitted to the playable area. Outside the shadow frustum the fog counts as fully lit, so a frustum that is too small shows up as a straight lit wall in the haze.
- The sky must sit at the far plane (`gl_Position = p.xyww`, depthWrite false). Linear depth ≥ 0.99·far counts as sky (no AO, fog marched to `volMaxDist`).
- Keep `renderer.toneMapping = NoToneMapping`; core does this already. Materials must output linear HDR.
- Systems that need the frame (water refraction) read `G.post.targets.scene.texture` / `.depth`. Soft particles should live in `post.transparent` and read `targets.zFull` (current frame). Systems that render offscreen first (planar reflections) do it on `G.on('prerender')`.

## URL switches
`?post=0` gives the plain ACES bypass for A/B. The others are `?ao=0`, `?vol=0`, `?bloom=0`, `?streak=1`, `?mb=1|0` (motion blur), `?rainlens=<amount>` (needs `rainLensGLSL`), and `?postdbg=ao|vol|trans|depth|bloom|zfull`, which shows that buffer instead of the frame (in atmos mode `vol` shows the magnitude of the removed sun in-scatter). Under `?shot=1` the grain is frozen, so `--shimmer` heatmaps only show real instability.

## ART knobs read (once, into `params`)
| ART | params | notes |
|---|---|---|
| grade.exposure, agxMix, lookPower, sat, contrast, splitShadow, splitHigh, vignette, chroma, grain, sharpen | same names | tonemap/grade/final |
| grade.bloom | bloomStrength | mix weight of the wide veil (0.05-0.08) |
| grade.bloomThreshold | bloomThreshold | soft knee (bloomKnee 0.6×thr). Feeds hotGlow, lensDirt, streak |
| grade.lensDirt | lensDirt | procedural dirt × thresholded bloom |
| grade.adaptMin/Max/Tau | adaptMin/Max/Tau | exposure = clamp(adaptKey/avgLum, min, max)·exposure |
| vol.density | volDensity = density×0.55 | standalone only: scattering per metre at fog.baseHeight |
| vol.g, vol.strength, vol.steps | volG, volStrength, (high tier steps) | standalone: HG forward lobe + fixed 20% back lobe g=-0.25. steps apply to both modes |
| fog.heightFalloff, fog.baseHeight, fog.scatter | volFalloff, volBase, volScatter | standalone only: exp height density, ambient in-scatter tint |
| ambient.skyIntensity | (× volAmbient) | standalone only: ambient haze level (volAmbient 0.12, or 0 when atmos is installed) |
| fog.sigma, start, heightFalloff, baseHeight, sunInscatter | (shared atmos uniforms, live) | atmos mode: read straight from lighting/atmos.js |

Other params: `aoRadius 0.9 m`, `aoIntensity 2.6`, `aoBias 0.06`, `aoStrength 1`, `volMaxDist 80`, `volExtinction 0.5`, `volMode 'auto'`, `volShaft 1`, `motionBlur 0`, `motionBlurMax 40`, `rainLens 0`, `zFull false`, `bloomScatter 0.72`, `hotGlow 0.05`, `streakStrength 0.35`, `streakThreshold 2.2`, `adaptKey 0.20`, `fxaa true`, `adapt true`, and the toggles `enabled/ao/vol/bloom/streak`.

## Tuning tips
- **The image is milky or low-contrast** when facing the sun: with atmos installed that is `ART.fog` (sigma, sunInscatter); post adds no haze of its own. Standalone: lower `volDensity` or `volAmbient` first, then `volMaxDist`. Shafts need occluders and a sun below about 15°.
- **Shafts are too faint in atmos mode:** raise `volShaft` (1.3-1.6) or `fog.sunInscatter`. The shafts can only be as strong as the analytic sun glow they carve.
- **There are no shafts:** the shadow map is missing (`light.castShadow`, `shadowMap.needsUpdate`), or the occluders sit outside the shadow frustum.
- **The scene is too dark or too bright overall:** change `adaptKey` (scene key), not `exposure`. `adaptMin/Max` stop the exposure from pumping on the sun or in dark interiors.
- **AO is too strong in the sun:** this is expected. The AO mix fades on bright pixels because we have no separate ambient buffer. Raise `aoIntensity` for darker contact shadows, and lower `aoRadius` indoors (0.4-0.6).
- **Colour fringes:** `chroma` above 0.002 starts to read as a lens defect. Keep it between 0.0008 and 0.0015.
- **Bloom smears the whole frame:** lower `bloomStrength`. A huge HDR sun disc (×90) plus a 6.5% veil is the intended golden-hour look.

## Cost per tier (1600×900 render, M1 Max class)
| tier | MSAA | AO taps | vol steps | notes |
|---|---|---|---|---|
| low | 0 | off | 16 | FXAA only |
| med | 2 | 8 | 16 | |
| high | 4 | 12 | ART.vol.steps (≥16, default 20) | |
| ultra | 4 | 16 | 24 | |
A full-res frame does about 24 fullscreen passes, most of them at half resolution or smaller. The costliest are the full-res composite, tonemap and final passes, plus the half-res volumetric march (steps × one shadow tap). Dynamic resolution (`G.quality.scale`) resizes every target on the next frame. Changing the tier recompiles AO/vol (a define change) and reallocates the MSAA buffer. Optional passes add: zFull plus the transparent draw (one full-res R32F pass plus your draws), motion blur (one full-res pass), and the rain lens (two hash layers in the final pass, branched off when dry). zFull and the motion-blur target are allocated only when first used.

## Known pitfalls
- MSAA HalfFloat needs `EXT_color_buffer_float`. Every desktop WebGL2 browser has it, but some old mobile GPUs do not, so use `?q=low` there (samples 0).
- The volumetric jitter is static IGN in screen space with no TAA. It is stable when the camera is still, and fine shafts can crawl slightly while it moves. The bilateral blur hides most of that.
- Linear depth is R32F on purpose. Half floats staircase planes beyond about 10 m and produce AO ripples. Half-res passes reconstruct positions at uv = (q + 0.25)/halfRes to match the full-res pixel the depth pass fetched. If you change one, change the other.
- `gl.depthRange` is called directly (three does not track it). Never leave it changed.
- The pipeline sets `renderer.autoClear = false` while it runs and restores it afterwards. Offscreen renders done in `prerender` keep the caller's setting.
- Never sample `targets.scene.texture` while rendering into it. Water and refraction should read `targets.comp` from the previous frame, or render after post. Objects in `post.transparent` may sample `targets.zFull`, never `targets.depth` (on the low tier that texture is attached to the target being drawn).
- The volumetric march stops 0.25 m in front of the surface so its last samples do not print the receiver's shadow-map texel grid (a cross-hatch on walls facing away from the sun).
- Radial light/dark wedges on the ground looking into a low, bright sun are usually real shadow penumbrae from PCSS (check with `?vol=0`). The T8 space-station look (into-sun pose) was checked this way: the wedges are unchanged with `?vol=0`. The volumetric part of that frame was the standalone milky haze plus step-boundary arcs where rays left the 48 m shadow frustum, and atmos mode removes both.
