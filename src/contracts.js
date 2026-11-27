// Frozen contracts (change only through the lead; re-capture after any change).
// Frame: +x east, +z south, y up, metres; origin = Elizabeth Quay Bridge midpoint. Water y = 0, promenade y = 2.2.
export const SEED = 6000;   // Perth postcode

export const POSES = [
  [34, 10.5, 26, -520, 18, 250],          // 1 establishing INTO the sun: from the bridge over the inlet mouth toward the Narrows + Kings Park
  [8.9, 4.0, -174.3, -24, 2.2, -122],      // 2 gameplay eye at spawn (third-person cam behind the player at The Landing), toward the ferry jetty
  [-24, 4.4, -58, -47, 2.6, -84],          // 3 hero object: MV Tricia berthed at the Elizabeth Quay Jetty, rim-lit by the sun behind it
  [-178, 3.9, 1292, -20, 72, -330],        // 4 second biome: Mends Street Jetty, South Perth — the postcard view of the CBD skyline at golden hour
  [-102, 9.0, 330, -150, 1.5, 420],        // 5 action: stolen ferry crossing Perth Water with the Water Police on its tail (?show=chase)
  [8, 4.8, 34, 190, 24, -16],              // 6 reverse angle AWAY from the sun: Bell Tower, Ritz-Carlton and Barrack Square in full sun
];
// Non-composed checks from the spawn: north into the CBD, east toward the Ritz-Carlton.
export const YAWS = [
  [8, 4.0, -172, 30, 40, -420],
  [8, 4.0, -172, 160, 22, -110],
];

// Title flyover (Catmull-Rom). Starts over Perth Water, swings through the inlet past Spanda, rises over the CBD.
export const PATH = [
  [-260, 60, 520, -40, 30, -120],
  [-120, 26, 170, 0, 10, -60],
  [-30, 14, 40, 20, 8, -120],
  [20, 9, -60, 10, 18, -190],
  [60, 18, -150, -60, 30, -230],
  [140, 60, -200, -40, 70, -520],
  [80, 110, 120, -240, 30, 320],
  [-260, 60, 520, -40, 30, -120],
];

export const WORLD = { min: [-1400, -5, -900], max: [1400, 300, 1800], groundY: 2.2, seaY: 0 };

export const PLAYER = {
  height: 1.73, radius: 0.32,
  fov: 62,
  walk: 1.55, run: 4.2, sprint: 6.8,     // m/s (matches the clip root speeds)
  accel: 14, turn: 10,
  jump: 4.6, gravity: 18,
  camDist: 4.4, camHeight: 1.85, camVehicleDist: 8.5, camFerryDist: 22,
  spawn: [6, 2.2, -170], spawnYaw: -0.59,   // facing SW toward the ferry terminal
};
