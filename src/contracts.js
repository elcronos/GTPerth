// Frozen contracts shared by every module owner. Change only through the lead (re-run captures after any change).
//  POSES  6 hero camera poses [x,y,z, tx,ty,tz] — the critic judges exactly these (capture.mjs --poses).
//         Face INTO the low sun for at least 2 of them (backlight = the golden-hour look).
//  PATH   fly-through keys, same format; used by the title screen flyover and #bench (engine/bench.js).
//  WORLD  playable bounds (metres, Y up). Anything outside is set dressing / backdrop hidden by fog.
//  PLAYER body + feel constants read by modules/player.js.
export const SEED = 4207;

export const POSES = [
  [-14.0, 2.2, 14.0, 0.0, 1.4, 0.0],     // 1 establishing, sun behind the scene
  [8.0, 1.7, 9.0, -2.0, 1.2, -3.0],      // 2 eye height, into the sun
  [0.0, 1.7, -12.0, 0.0, 1.5, 4.0],      // 3 reverse angle
  [-6.0, 0.6, 2.0, -2.0, 0.4, -2.0],     // 4 low, ground detail / wet reflections
  [14.0, 6.0, -6.0, 0.0, 1.0, 0.0],      // 5 high overview
  [3.0, 1.7, 3.0, 8.0, 1.8, -8.0],       // 6 hero object close-up
];

export const PATH = [
  [-18, 3.0, 16, 0, 1.5, 0],
  [-4, 2.2, 12, 4, 1.4, -2],
  [10, 2.6, 6, 0, 1.2, -6],
  [12, 3.4, -10, -4, 1.4, 0],
  [-6, 2.4, -14, 0, 1.4, 4],
  [-18, 3.0, 16, 0, 1.5, 0],
];

export const WORLD = { min: [-30, -2, -30], max: [30, 20, 30], groundY: 0, seaY: -1.6 };

export const PLAYER = {
  eye: 1.68, crouchEye: 1.05, radius: 0.32, height: 1.8,
  fov: 74, viewFov: 54,                     // world camera / view-model camera
  walk: 4.2, sprint: 7.0, crouch: 2.2,      // m/s
  accel: 40, airAccel: 6, friction: 10,     // m/s² / 1/s
  jump: 5.2, gravity: 18,                   // m/s, m/s²
  spawn: [-14, 0, 14], spawnYaw: -0.8,
};
