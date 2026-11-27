# templates/three — single-file three.js game skeleton

Copy this folder to the new game, copy `cookbook/three/` to `src/cookbook/` and `tools/` to `tools/`, then `npm i` (or
symlink a shared `node_modules`). `node build.mjs` → `dist/index.html`. Verified end-to-end during development
(build 803 KB raw / 237 KB gz with every cookbook system wired, capture 0 errors on the 6 POSES, playtest PASS; a
snow + lightning ART variant also captures with 0 errors).

| File | Purpose |
|---|---|
| `package.json` | three 0.180.0, esbuild 0.25.0, playwright, pngjs, jpeg-js; `gameTitle` → `{{TITLE}}`; npm scripts for build/shots/bench/playtest/size |
| `build.mjs` | esbuild IIFE bundle of `src/main.js` + minified `src/ui/ui.css` into `template.html`; GLSL minified by `glsl-min.mjs`; three's MIT `@license` kept (legalComments `eof`, banner fallback); fails on `data:` image/audio/video/font blobs or > 2 MB; prints raw/gz, three.js total and top-15 inputs. `--readable` (no minify, GLSL untouched), `--out dist/agent-x.html` (per-agent builds), `--entry`, `--title` |
| `template.html` | canvas `#c`, `#ui` (title / pause / settings / HUD skeleton with `data-act` buttons and `data-bind` slots), `#boot` loader (bar + message), `/*CSS*/` `/*SCRIPT*/` slots. Everything `.ui` is hidden under `html.shot` |
| `src/main.js` | boot stages wiring EVERY cookbook system in the mandatory order: core → quality → pcss → atmos → sky → env → materials → world → ground (mask + `patchGround` + planar reflection) → water (sea + caustics on the quay) → backdrop (far-field rings) → scatter → decals → lights → `finalizeMaterials` (engine/finalize.js: atmos + weathering on every world material) → shadows → [hero/actors] → fx (pools + steam vent) → weather (rain/snow by `ART.weather.kind`, dust motes, lightning when `ART.weather.lightning`) → probes (shed interior, assigned) → post → audio (mixer; bank + music + ambience rendered after ready; thunder hook) → input → player → ui → warm-up → probe capture → ready. Cookbook systems self-update, so their stage results are marked `selfUpdating` (`own()`). `?show=<module>` uses that module's `showcase(G)` camera |
| `src/art.js` | sample ART (rainy golden-hour harbour), schema in CONTRACT.md. Optional `weather.lightning: true` (+ `lightningInterval: [min, max]` s) adds the storm |
| `src/contracts.js` | `SEED`, `POSES[6]`, `PATH` (title flyover + bench), `WORLD` bounds, `PLAYER` dims/feel |
| `src/modules/_stub.js` | `STUBS[name](G)` — API-shaped no-ops used by boot when a non-critical stage throws (one per main.js stage) |
| `src/modules/world.js` | sample quay yard built with `geo/kit.js` + `materials/library.js`; returns `{root, ground, quay, shed: {group, box, probeAt}, anchors: {lamps, vent, signs, wallLine}, colliders, bounds}` — replace with the level, keep the shape (main.js dresses the anchors) |
| `src/modules/player.js` | FPS controller: input → yaw/pitch, accel walk/sprint/crouch, jump, gravity, circle-vs-AABB + step-up, spring head bob/landing |
| `src/modules/ui.js` | state machine `title → playing ⇄ paused`, `settings` (quality/sens/fov/volume/invertY, localStorage), title flyover along PATH, `ui.set(bind, value)` |
| `src/ui/ui.css` | dark game-UI tokens (`--ink --accent --panel --font-display ...`), title/pause/settings/HUD/boot styles |
| `playtest.json` | sample bot script for `tools/playtest.mjs` (move, look, jump, pause/resume, no stubs) |

Rules: add every new system as its own `boot.stage(...)` (non-critical + stub unless the game cannot run without it);
pass FX/enemy/decal materials that are not in the scene at boot to `boot.finish({ extras })`; keep `?autostart=1` and
`?shot=1` skipping the title. Commands: `node build.mjs && node tools/capture.mjs --url dist/index.html --out shots/r01 --poses "<POSES>" --critic`,
`node tools/bench.mjs --url dist/index.html --gate "avg<=12.5,p99<=20,max<=33"`, `node tools/playtest.mjs --url dist/index.html --script playtest.json`.
