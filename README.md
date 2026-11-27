# GRAND THEFT PERTH

A GTA VI–style tribute set on a real-scale replica of Elizabeth Quay, Perth Water, Kings Park and South Perth,
built as a single self-contained HTML file with three.js.

**Play:** https://elcronos.github.io/GTPerth/

Steal the Transperth ferry from the Elizabeth Quay terminal and take it across Perth Water to Mends Street Jetty
with the Water Police on your tail. The sun follows the real solar path for Perth (midday → midnight).

## Controls
WASD move · Shift sprint · Mouse look · F/E enter or exit vehicles · Click/J punch · H horn · Esc pause

URL options: `?time=18.5` (start at 18:30), `?timescale=120`, `?q=low|med|high`.

## Build
```
npm ci
node build.mjs        # → dist/index.html (single file)
```
Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/pages.yml`).

## Credits
- Map data © OpenStreetMap contributors (ODbL): shorelines, streets, building footprints and heights, landuse.
- People: Microsoft Rocketbox avatars (MIT). Vehicles: generated with Tripo.
- three.js (MIT). Fonts: Anton, Barlow Condensed, Inter (OFL).
- Fan tribute, not affiliated with Rockstar Games or Take-Two.
