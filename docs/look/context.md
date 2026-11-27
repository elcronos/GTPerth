# Context for look-dev lanes and critics — Grand Theft Perth

Repo: /home/claude/perth (three.js r180, esbuild; `node build.mjs` → dist/). Game: GTA VI tribute set on the real
Elizabeth Quay / Perth Water / South Perth / Kings Park, built from OpenStreetMap geometry (real footprints, heights,
shorelines). The concept is fixed; this phase is AESTHETICS ONLY: make it look like a AAA open-world game
(GTA VI golden-hour realism), on desktop high tier and on phones (low tier, 844x390 landscape touch).

Style target: GTA VI trailers — low warm back-lit sun, long soft shadows, humid haze warm toward the sun and blue in
shadow/distance, mirror-like water and glass, dense palms/street trees, lived-in streets, filmic grade (rich
sunlit saturation, teal shadows, gentle bloom). Location truth: Perth photos in docs/look/refs/*.jpg
(eq2 = EQ from the bridge, tricia1 = ferry + EQ Bridge arches, bell_c = Bell Tower, kpview = CBD from Kings Park).
Look bible: docs/look/look-bible.json. Rubric: docs/look/style-rubric.json (13 dimensions, 1-10).
Pass: overall >= 7.5 and no dimension < 6.

Renderer facts: shots come from SwiftShader (software GL) — judge the image, not the frame rate. Shots use
`?shot=1` (HUD hidden) except `phone_hud`. Views are listed in tools/qa/views.json; each shot is
<round dir>/<view id>.jpg plus shots.json (tris, calls, sun elevation `el`, player screen box).

Key source files: src/modules/world/{index.js (materials), towers.js (OSM buildings + facade styles), facade.js
(facade shader: curtain wall / punched / ribbon / fins / resi), ground.js + surfaces.js (pavers, lawn, bush),
props.js (trees, lamps, benches, boats), landmarks.js (Bell Tower, EQ Bridge, Spanda, jetties), roads.js,
daycycle.js (sun/sky/fog/exposure keyframes by sun elevation)}, src/cookbook/* (atmos, sky, PCSS shadows, post:
AO/volumetrics/bloom/adaptation/grade, planar water reflection), src/modules/game/{character.js, player.js, peds.js,
traffic.js, hud.js}, src/ui/ui.css.
