// Real-location layout of Elizabeth Quay, Perth Water and South Perth, in metres.
// Frame: origin = Elizabeth Quay Bridge midpoint (-31.95922, 115.85587). +x = east, +z = SOUTH, +y = up.
// Conversions used: 1° lat = 110.95 km, 1° lon = 94.43 km (at -31.96°). Water level y = 0.
// Sources: Wikipedia coordinates (Barrack St Jetty, Mends St Jetty, Narrows Bridge, Central Park, Brookfield Place,
// 108 St Georges, Allendale Square, EQ station, Convention Centre), structurae (EQ Bridge), CTBUH heights.
export const LL0 = { lat: -31.95922, lon: 115.85587 };
export const ll = (lat, lon) => [(lon - LL0.lon) * 94430, (LL0.lat - lat) * 110950];

// ---------------------------------------------------------------- shorelines (closed land polygons, CCW from above)
// CBD / Kings Park land: north of Perth Water. The Elizabeth Quay inlet is a hole cut into it.
export const NORTH_LAND = [
  [-2600, 900], [-1700, 520], [-1300, 420], [-1050, 345], [-905, 300],          // Mounts Bay → Narrows north abutment
  [-800, 250], [-680, 185], [-560, 125], [-440, 82], [-330, 52], [-230, 33], [-140, 22], [-72, 16],   // Mounts Bay Rd shore
  [-62, 6],                                                                         // EQ bridge west abutment (SW corner)
  // the inlet is a notch in the land: up the west shore (ferry jetty), along The Landing, down the east shore
  [-62, -142], [-56, -154], [-44, -160], [62, -160], [72, -154], [76, -144], [76, -12], [80, -1],
  [88, 4], [96, 22], [140, 30], [178, 32], [270, 36], [340, 34], [520, 26], [800, 12], [1200, -6], [1700, -30], [2600, -60],
  [2600, -2600], [-2600, -2600],
];
// The inlet (water), for reference: a notch in NORTH_LAND, ~2.4 ha: x -62..76, z -160..6, mouth to the south.
export const INLET = [[-62, 6], [-62, -142], [-56, -154], [-44, -160], [62, -160], [72, -154], [76, -144], [76, -12], [80, -1], [40, 6]];
// Island in the inlet mouth (Florence Hummerston Kiosk), connected east by a short bridge.
export const ISLAND = { x: 58, z: 14, r: 19 };

// South Perth land (Mill Point → Mends Street → Coode Street).
export const SOUTH_LAND = [
  [-2600, 2600], [-2600, 900], [-1400, 760], [-1000, 640], [-860, 585], [-800, 600], [-740, 660], [-690, 740],
  [-620, 860], [-540, 980], [-430, 1100], [-320, 1196], [-230, 1258], [-193, 1274], [-120, 1286], [0, 1298],
  [200, 1322], [420, 1352], [800, 1404], [1400, 1460], [2600, 1520], [2600, 2600],
];
// Heirisson-side far shore is outside the play area; water extends east under fog.

export function pointInPoly(x, z, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], zi = P[i][1], xj = P[j][0], zj = P[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
export function isLand(x, z) {
  if (pointInPoly(x, z, SOUTH_LAND)) return true;
  const dx = x - ISLAND.x, dz = z - ISLAND.z; if (dx * dx + dz * dz < ISLAND.r * ISLAND.r) return true;
  return pointInPoly(x, z, NORTH_LAND);
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// distance to a polyline
export function distPoly(x, z, P) {
  let best = 1e9;
  for (let i = 0; i < P.length - 1; i++) {
    const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1];
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
    const ex = ax + vx * t - x, ez = az + vz * t - z; const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
// Kings Park escarpment toe (Mounts Bay Road side) — the cliff rises inland of this line.
export const ESCARPMENT = [[-380, -260], [-470, -150], [-560, -40], [-660, 60], [-780, 140], [-900, 210], [-1100, 280], [-1500, 380]];
export const PROMENADE_Y = 2.2;     // quay / promenade level above water

// Ground height (metres) on land. Flat promenade near the water, CBD rising to St Georges Terrace, Kings Park on Mount Eliza.
export function heightAt(x, z) {
  if (z > 400) { // South Perth: gentle rise inland
    return PROMENADE_Y + 0.6 + 5 * smooth(1320, 1700, z + 0.15 * x);
  }
  let h = PROMENADE_Y;
  // CBD rise to St Georges Terrace (~15 m)
  h += 12.5 * smooth(-215, -560, z) * smooth(-520, -330, x);
  // Kings Park (Mount Eliza): 60 m plateau behind the escarpment
  if (x < -330) {
    const d = distPoly(x, z, ESCARPMENT);
    const inland = z < escarpZ(x) ? 1 : 0;
    const t = inland ? smooth(15, 140, d) : 0;
    const n = Math.sin(x * 0.021) * Math.cos(z * 0.017) * 3 + Math.sin(x * 0.07 + z * 0.05) * 1.2;
    h = h * (1 - t) + (58 + n) * t;
  }
  return h;
}
function escarpZ(x) { // z of the escarpment line at x (it is a function of x)
  const P = ESCARPMENT;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    if ((x <= a[0] && x >= b[0])) { const t = (x - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * t; }
  }
  return x > P[0][0] ? P[0][1] : P[P.length - 1][1];
}

// ---------------------------------------------------------------- roads (centrelines, width m, lanes). Left-hand traffic.
export const ROADS = [
  { name: 'Riverside Drive', w: 14, lanes: 4, pts: [[125, -62], [220, -74], [340, -76], [600, -74], [900, -76], [1300, -84], [1900, -96]] },
  { name: 'Barrack Street', w: 13, lanes: 3, pts: [[125, -62], [125, -198], [125, -262], [125, -420], [125, -760]] },
  { name: 'Geoffrey Bolton Avenue', w: 9, lanes: 2, pts: [[125, -198], [40, -198], [-36, -198]] },
  { name: 'The Esplanade', w: 11, lanes: 2, pts: [[125, -262], [40, -262], [-36, -262]] },
  { name: 'William Street', w: 14, lanes: 4, pts: [[-36, -198], [-36, -262], [-36, -420], [-36, -760]] },
  { name: 'Mounts Bay Road', w: 16, lanes: 4, pts: [[-36, -232], [-150, -232], [-300, -205], [-440, -128], [-590, -26], [-740, 72], [-860, 150], [-1000, 210], [-1300, 300], [-1700, 420]] },
  { name: 'St Georges Terrace', w: 18, lanes: 4, pts: [[-700, -525], [-36, -512], [125, -505], [500, -490], [900, -475]] },
  { name: 'Hay Street', w: 12, lanes: 2, pts: [[-700, -650], [-36, -640], [125, -636], [900, -610]] },
  // South Perth
  { name: 'South Perth Esplanade', w: 9, lanes: 2, pts: [[-520, 1110], [-400, 1205], [-280, 1290], [-193, 1330], [-60, 1345], [200, 1372], [600, 1425], [1200, 1490]] },
  { name: 'Mends Street', w: 12, lanes: 2, pts: [[-193, 1330], [-188, 1420], [-182, 1560], [-175, 1900]] },
  { name: 'Mill Point Road', w: 12, lanes: 2, pts: [[-780, 760], [-700, 860], [-610, 990], [-480, 1140], [-360, 1260], [-250, 1360], [-188, 1420], [0, 1450], [300, 1480], [800, 1520], [1400, 1560]] },
];
// Narrows Bridge (two road decks + rail between), north end → south end
export const NARROWS = { a: [-905, 262], b: [-806, 640], width: 30 };
// Kwinana Freeway continues south of the Narrows
export const FREEWAY = [[-806, 640], [-760, 800], [-720, 1000], [-700, 1300], [-690, 1800]];

// ---------------------------------------------------------------- key places
export const PLACES = {
  spawn: [8, PROMENADE_Y, -170],          // The Landing, in front of Spanda, facing the inlet
  spanda: [6, -184],
  eqJetty: [-58, -78],                      // ferry terminal on the inlet's west shore
  ferryDock: [-46.5, -80],                  // ferry centre when berthed (bow north)
  bellTower: [214, -24],          // -31.958903, 115.858243 (Barrack Square)
  barrackJetty: [225, 34],
  mendsJetty: [-193, 1270],                 // shore end; head at z ≈ 1224
  mendsHead: [-193, 1222],
  firstContact: [-54, -4],
  waterPark: [-84, -190],
  oldMill: [-830, 772],
  warMemorial: [-945, 140],
};

// Named zones for the location toast (first match wins)
export const ZONES = [
  { name: 'Elizabeth Quay', sub: 'Perth CBD', test: (x, z) => x > -140 && x < 150 && z > -280 && z < 30 },
  { name: 'Barrack Square', sub: 'Perth CBD', test: (x, z) => x >= 150 && x < 330 && z > -120 && z < 60 },
  { name: 'Mends Street', sub: 'South Perth', test: (x, z) => z > 1180 && x > -420 && x < 80 },
  { name: 'Sir James Mitchell Park', sub: 'South Perth', test: (x, z) => z > 900 && isLand(x, z) },
  { name: 'Kings Park', sub: 'Mount Eliza', test: (x, z) => x < -420 && heightAt(x, z) > 25 },
  { name: 'The Narrows', sub: 'Swan River', test: (x, z) => x < -700 && z > 150 && z < 700 },
  { name: 'Perth Water', sub: 'Swan River', test: (x, z) => !isLand(x, z) },
  { name: 'St Georges Terrace', sub: 'Perth CBD', test: (x, z) => z < -420 },
  { name: 'Perth CBD', sub: 'Western Australia', test: () => true },
];
