# STATUS — look-first-3d on Grand Theft Perth

Phase: P1 style target → G0+G1 gate (one question round), then P4 look-dev loop on the hero frame.
Concept fixed by the user (GTA VI tribute, real Perth). Priority: aesthetics first (AAA look).

## Toolchain (P0)
- node 22, Playwright Chrome with SwiftShader only (no real GPU in this cloud workspace) — critics judge SwiftShader
  renders forced to the high tier; real-GPU perf numbers cannot be measured here (LIMITATIONS).
- gltf-transform, python3 + PIL/cv2/skimage; gh (REST only); no Blender.
- Network: tile.openstreetmap.org, api.openstreetmap.org, overpass-api.de (blocked at egress); Poly Haven not yet allowed.

## Plan
- [x] P0 intake + preflight
- [x] P1 look bible draft (docs/look/look-bible.json)
- [ ] G0+G1 round
- [ ] P4 look-dev rounds (2 critics + metrics per round) until overall ≥ 7.5, no dimension < 6, or plateau
- [ ] G2 look approval gallery

## Changed since last update
- Fixed: phone walking stick left/right inverted (camera-relative strafe sign).
