# STATUS — look-first-3d on Grand Theft Perth

Phase: P4 look-dev loop (critic rounds). Concept fixed by the user (GTA VI tribute, real Perth). Priority: AAA aesthetics.
Gate decisions taken without a question round (user asked not to be interrupted): hero frame = Elizabeth Quay inlet at
golden hour (18:15, sun 9°), desktop high tier + phone low tier both first-class, Poly Haven not available (procedural
materials only), SwiftShader renders only (no GPU perf numbers in this workspace).

## Rounds (two independent opus critics, per-dimension minimum)
| round | shots | overall | lowest dims |
|---|---|---|---|
| look-r1 | shots/r0 | 4.54 | vegetation 3.5, architecture/materials/real_game 4 |
| look-r2 | shots/r1 | 5.00 | vegetation 4.0, architecture/artefacts/real_game 4.5 |
| look-r3 | shots/r2 | 5.23 | vegetation/architecture/artefacts 4.5 |
| look-r4 | shots/r3 | 5.35 | vegetation 4.5, palette/materials/mobile/artefacts/real_game 5 |

Pass rule: overall >= 7.5 and no dimension < 6. Reviews: docs/reviews/look-rN-{A,B}.json, reduced look-rN.json.

## Root causes found by the loop
- Roads, kerbs and quay walls rendered black: vertex-colour materials on geometry without a colour attribute.
- Window "TV static": per-building seed attribute interpolated with ~1e-4 jitter, amplified by hash functions.
- Mid-distance towers read cream: one-sided AA ramp widened every mullion (fcBand).
- Road paint erased: shader patch anchored before the material library's PBR tint.
- BHP tower body missing from OSM (only crown slivers as parts); restored.
- SSAO dark frame border: normals from clamped neighbours at the image edge.

## QA tooling
tools/qa/shoot.mjs + views.json (12 views, real game camera rig), metrics.py (luma, player box, palette dE),
tris.mjs (per-group triangle breakdown), one.mjs (single debug frame), playtest (15/15 after spawn move).
