# Gameplay loop status

Capture: `node tools/qa/play.mjs <out> [scenarios] --html=dist/index.html` — deterministic frame strips (fixed
1/30 s steps, frame-gated loop via `window.__gate`) with per-frame telemetry and feel metrics (planted-foot slip,
turn rate, acceleration, punch hits, water). Rubric: `docs/play/play-rubric.json`. Reviews: `docs/reviews/play-rN-{A,B}.json`
(two independent opus critics: feel/animation and systems/bugs), reduced by per-dimension minimum to `play-rN.json`.

## Root causes found
- Walk/run clips still carried forward root motion: the body moved twice (clip + game) and the hips snapped back each
  cycle; planted feet slid at body speed. Linear root drift is now removed at load and each clip's native ground speed
  is measured (walk 1.21, jog 2.77, sprint 5.38 m/s) to time-scale and pick gaits.
- Punches could never land: walkers were pushed out to 2.5 m from the player (camera sightline + personal space) while
  a punch reached 1.5 m.
- The river edge was not solid on foot (walking off the quay put the player under the water surface).
- The desktop minimap was a fixed 300 px and covered the player on small windows.

## Rounds
| round | build | overall | lowest |
|---|---|---|---|
| play-r1 | shots/play1 | 5.33 | combat 4.5, npc 4.5, feedback 4.5, fun_loop 4.0 |
