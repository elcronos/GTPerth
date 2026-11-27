# Grand Theft Perth — build report

Single file: `dist/index.html` (~8.4 MB, 4.4 MB gzipped). It runs offline with no external requests.

## What's in it
- **Location.** Elizabeth Quay to South Perth, built on a real-coordinate frame. The origin is the EQ Bridge midpoint and the scale is 1 unit = 1 m.
  - Elizabeth Quay: the inlet, the island, the Landing steps and the EQ Jetty.
  - Riverside Drive, Barrack Street, The Esplanade and William Street.
  - Mounts Bay Road and Kings Park escarpment, the Narrows, and Mends Street Jetty.
- **Landmarks rebuilt from reference photos:**
  - **Bell Tower:** teal glass needle with two copper sails, open front and back.
  - **Spanda:** six egg-shaped hoops whose legs converge at the foot.
  - **EQ Bridge:** S-curve deck with near-upright twin arches.
  - **Brookfield Place:** steel exoskeleton crown and BHP sign.
  - **Others:** Ritz-Carlton and The Towers, Central Park, 108 St Georges and others.
- **Vehicles generated with Tripo, then compressed with meshopt and webp:**
  - Cars: Camry, Corolla hatch, CX-5, HiLux ute, WA Police sedan and city bus.
  - Ferry: MV Tricia, from a photo of the real Transperth ferry.
  - The generated police texture misspelled "POLICE", so a clean blue/white chequer + POLICE band is projected onto the body sides in the shader.
  - White and silver cars are tinted at runtime, so traffic shows varied colours.
- **Humans:** Microsoft Rocketbox avatars (MIT licence), skinned and animated, for the player, pedestrians and police.
- **Gameplay:** the mission is THE ZOO RUN.
  - Steal the ferry at the EQ Jetty, outrun the Water Police and berth at Mends Street for $50,000.
  - You can punch or hit pedestrians and carjack, which raises your wanted level and brings police cars and boats.
  - WASTED and BUSTED screens, then respawn.
- **UI:** in the style of GTA VI.
  - Rotating minimap, health and armour bars, wanted stars, cash, a phone/notification stack and a livestream chat overlay.
  - Location toasts, letterboxed "MISSION PASSED" cards and pause menu.

## Verification
- `playtest.json` runs under SwiftShader and passes all 15 asserts (walk, punch, hijack ferry, wanted ≥ 2, drive, win, reward, lose, respawn, busted, pause and resume).
- Captures of every contract pose report 0 errors. I compared the renders side by side with reference photos (Wikimedia Commons) for the Bell Tower, Spanda, EQ Bridge, ferry and skyline.

## Known gaps
- Lighting is golden hour (the GTA VI look), so the CBD glass reads bronze where midday photos show blue.
- The Tripo cars have their wheels baked into the body, so wheels don't spin or steer visibly.
- The cloud capture machine has no GPU, so frame-rate numbers here aren't meaningful. On a real GPU, use `?q=high` or `?q=low` to pick the quality tier.

## Credits
- three.js (MIT).
- Microsoft Rocketbox avatars (MIT).
- Fonts: Anton, Barlow Condensed and Inter (OFL).
- Vehicle meshes generated with Tripo.
- Reference photos from Wikimedia Commons, used for modelling only and not included in the build.
- Fan tribute. Not affiliated with Rockstar Games or Take-Two.
