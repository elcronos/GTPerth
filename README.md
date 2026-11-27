# GRAND THEFT PERTH

A GTA VI–style tribute set on a real-scale replica of Elizabeth Quay, Perth Water, Kings Park and South Perth,
built with three.js: one HTML/JS bundle plus a few binary assets (people, vehicles, ground-cover mask).

**Play:** https://elcronos.github.io/GTPerth/

Steal the Transperth ferry from the Elizabeth Quay terminal and take it across Perth Water to Mends Street Jetty
with the Water Police on your tail. The sun follows the real solar path for Perth (midday → midnight).

## Controls
**Desktop:** WASD move · Shift sprint · Mouse look · F/E enter or exit vehicles · Click/J punch · Space jump/handbrake · H horn · Esc pause

**Phone / tablet (landscape):** left thumb anywhere = move stick (push past the ring to sprint) · right thumb = camera · buttons: ENTER/EXIT · PUNCH/HORN · JUMP/BRAKE · SPRINT · pause top-right.

URL options: `?time=18.5` (start at 18:30), `?timescale=120`, `?q=low|med|high`.

## Build
```
npm ci
node build.mjs            # → dist/index.html + dist/assets/
node build.mjs --single   # everything embedded in one HTML file
```
Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/pages.yml`).

## Credits
- Map data © OpenStreetMap contributors (ODbL): shorelines, streets, building footprints and heights, landuse.
- People: Microsoft Rocketbox avatars (MIT). Vehicles: generated with Tripo.
- three.js (MIT). Fonts: Anton, Barlow Condensed, Inter (OFL).
- Fan tribute, not affiliated with Rockstar Games or Take-Two.
