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
| play-r2 | shots/play2 | 5.45 | responsiveness 5.0, npc 5.0, fun_loop 5.0 |
| play-r3 | shots/play3 | 5.99 | npc 5.7, fun_loop 5.7, responsiveness 5.8 |
| play-r4 | shots/play4 | 6.37 | fun_loop 6.0, locomotion 6.1 (no dimension below 6) |

## After play-r3 (captured in play-r4)
- Punch approach is a movement input (13 m/s² burst, steers, out-runs a walker) with queued presses; the lunge is a
  4 m/s step-in with a back-step when crowded. Stop transitions low-pass the clip root speed (max 14 m/s² braking);
  blocked frames ease out. Edge probe in 0.15 m steps from 0.25 m along facing + stick. Bodies: slide round at speed.
- Idle → walk starts on the passing pose; airborne legs hold the take-off stride; shorter walk stop; tighter fight camera.
- Bystanders 55 % flee / 25 % cower / 20 % film; assaults reported by a witness phone call after 4 s (stop the caller
  and nobody calls). Sprint knockdowns are assaults; some victims come back for a fight. Block feedback, haptics.
- COLLECT message spam fixed; job cars/marks released on cancel/fail; phone HUD re-laid out.

## After play-r4
- Lunge replaces carried speed (closing speed = max(carried, lunge) ≤ 4 m/s); approach brakes into range
  (v = √(18·(d−1.1))) and hands over at 2.3 m against walkers; legs follow the real body speed in a lunge.
- Idle weight rate-limited (no one-frame foot pop); phase reset only on genuine standing starts.
- Presses made mid-swing chain instead of expiring; chains clear when the target is down.
- Edge brake bisects the edge and never re-accelerates toward it; lateral slide past bodies even mid-stumble.
- Witness calls: only walk/idle/film/cower bystanders away from the player, never the mark; the assault flag times out
  after 45 s; calls pause outside play and clear with wanted.reset / respawn. Fighters answer straight after a stagger;
  damage is rolled per hit (KO in 3-5). Phone HUD: live panel and place toast moved clear of the bars/stars; ENTER
  hidden when there is nothing to enter.
- Open (next round): walk_start/run_start clips for standing starts, phase-matched stop entry, landing foot IK,
  punchable cops, street jobs before the ferry mission.
