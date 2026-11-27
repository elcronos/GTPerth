# GRAND THEFT PERTH — SPEC

**Genre:** open-world action vertical slice (third person, on foot / car / boat), GTA VI tribute.
**Concept:** steal the Transperth ferry at Elizabeth Quay and run it across Perth Water to Mends Street, South Perth,
with WA Police and the Water Police chasing. Real-location replica of Elizabeth Quay, Barrack Square, the CBD
skyline, Kings Park escarpment, The Narrows and the South Perth foreshore at late-November golden hour.

## Priorities
1. Real location fidelity (positions from coordinates, heights from CTBUH/Wikipedia; landmarks modelled from
   published dimensions: Bell Tower 82.5 m, Spanda 29 m, EQ Bridge 110 m S-deck + two 22 m arches, MV Tricia 23.7 m).
2. GTA VI look & UX: golden-hour Leonida grade; HUD = rounded minimap with pink GPS route, thin pink health bar,
   wanted stars + unit strip, cash card, phone notifications, livestream chat, WASTED/BUSTED/MISSION PASSED.
3. Realistic humans: Microsoft Rocketbox avatars (MIT), animated (walk/run/sprint/idle/phone/photo).
4. Short, finishable loop (5-10 min) with win, lose and restart.

## Scope / constraints
- Single HTML file. User-approved deviation from the skill: real human models embedded (≈5 MB base64), web fonts (OFL).
  Budget raised to 9 MB; everything else procedural.
- three.js r180, cookbook render stack (HDR post, atmos fog, PCSS, sky env, baked PBR, weathering, Gerstner water).

## Gameplay
- On foot: walk/run/sprint, jump, swim, punch; third-person orbit camera with collision.
- Cars: jack any car (RHD, left-hand traffic), arcade physics with handbrake drift; hit pedestrians (fling + sprawl).
- Ferry: buoyant catamaran physics, thrust/rudder/bow thrusters, wake; shore collisions; hull health.
- Wanted 0-5: witnesses, police LOS search (stars blink), patrol cars ram, officers chase/arrest/shoot, Water Police launch.
- Mission THE ZOO RUN: go to EQ Jetty → hijack ferry (2★, livestream) → berth at Mends St (< 15 km/h) → $50,000.
- Lose: WASTED (health 0 or ferry destroyed) / BUSTED → respawn at The Landing, mission restarts. Free roam after.

## Verification
- G1 boot captures 0 errors (SwiftShader in cloud; real GPU perf unverified).
- G3 playtest.json: walk, punch, hijack ferry, drive, win, WASTED, respawn, BUSTED, pause.
- G2 blind critic on 6 poses + 2 yaws.

## DONE WHEN
Playable start→win and start→lose→restart, 0 runtime errors, critic majors addressed where feasible.
