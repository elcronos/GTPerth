// Frozen contracts (change only through the lead; re-capture after any change).
// Frame: +x east, +z south, y up, metres; origin = Elizabeth Quay Bridge midpoint. Water y = 0, promenade y = 2.2.
export const SEED = 6000;   // Perth postcode

export const POSES = [
  [6, 10.5, 14, -850, 30, 460],            // 1 establishing: from the EQ Bridge over the inlet mouth toward the Narrows + Kings Park
  [53.7, 4.0, -218, 15, 2.2, -127],        // 2 gameplay eye at spawn (third-person cam behind the player at The Landing), toward the ferry terminal
  [62, 4.4, -96, 21, 2.6, -122],           // 3 hero object: MV Tricia berthed at the Elizabeth Quay ferry terminal
  [-215, 3.9, 1352, 40, 72, -400],         // 4 second biome: Mends Street Jetty, South Perth — the postcard view of the CBD skyline
  [-102, 9.0, 330, -150, 1.5, 420],        // 5 action: stolen ferry crossing Perth Water with the Water Police on its tail (?show=chase)
  [8, 4.8, 34, 190, 24, -16],              // 6 reverse angle: Bell Tower, Ritz-Carlton and Barrack Square
];
// Non-composed checks from the spawn: north into the CBD, east toward the Ritz-Carlton.
export const YAWS = [
  [52, 4.0, -216, 80, 40, -460],
  [52, 4.0, -216, 210, 22, -110],
];

// Title flyover (Catmull-Rom). Starts over Perth Water, swings through the inlet past Spanda, rises over the CBD.
export const PATH = [
  [-260, 60, 520, -40, 30, -120],
  [-120, 26, 170, 40, 10, -60],
  [0, 14, 40, 60, 8, -120],
  [50, 9, -60, 70, 18, -190],
  [80, 18, -150, -40, 30, -260],
  [160, 60, -220, -40, 70, -520],
  [100, 110, 120, -240, 30, 320],
  [-260, 60, 520, -40, 30, -120],
];

export const WORLD = { min: [-2000, -5, -1800], max: [2100, 300, 2300], groundY: 2.2, seaY: 0 };

export const PLAYER = {
  height: 1.73, radius: 0.32,
  fov: 62,
  walk: 1.55, run: 4.2, sprint: 6.8,     // m/s (matches the clip root speeds)
  accel: 14, turn: 10,
  jump: 4.6, gravity: 18,
  camDist: 4.4, camHeight: 1.85, camVehicleDist: 8.5, camFerryDist: 22,
  spawn: [52, 2.2, -214], spawnYaw: -0.40,   // The Landing, facing SSW down the inlet toward the ferry terminal
};
