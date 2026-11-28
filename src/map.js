// Real-location layout of Elizabeth Quay, Perth Water and South Perth, in metres.
// Frame: origin = Elizabeth Quay Bridge midpoint (-31.95922, 115.85587). +x = east, +z = SOUTH, +y = up.
// Conversions used: 1° lat = 110.95 km, 1° lon = 94.43 km (at -31.96°). Water level y = 0.
// Sources: Wikipedia coordinates (Barrack St Jetty, Mends St Jetty, Narrows Bridge, Central Park, Brookfield Place,
// 108 St Georges, Allendale Square, EQ station, Convention Centre), structurae (EQ Bridge), CTBUH heights.
export const LL0 = { lat: -31.95922, lon: 115.85587 };
export const ll = (lat, lon) => [(lon - LL0.lon) * 94430, (LL0.lat - lat) * 110950];

// ---------------------------------------------------------------- shorelines (from OpenStreetMap, see osm_land.js)
import { SHORE_N, SHORE_S, HEIRISSON as HEIR_RING, EQ_ISLAND } from './osm_land.js';
import { OSM_ROADS } from './osm_data.js';
import { KP_HEIGHT } from './assets/osm_height.js';
// CBD / Kings Park land: north of Perth Water (the Elizabeth Quay inlet is a notch in it), closed far to the north.
export const NORTH_LAND = [[-2600, SHORE_N[0][1]], ...SHORE_N, [2600, SHORE_N[SHORE_N.length - 1][1]], [2600, -2600], [-2600, -2600]];
// South Perth: from the Kwinana Freeway shore round Mill Point and Point Belches, past Mends Street, along Sir James
// Mitchell Park to the Causeway; closed far to the south.
export const SOUTH_LAND = [[SHORE_S[0][0], 2600], ...SHORE_S, [2600, SHORE_S[SHORE_S.length - 1][1]], [2600, 2600]];
export const HEIRISSON = HEIR_RING;
export { SHORE_N, SHORE_S };
// Island in the inlet mouth (The Island Brew House / Florence Hummerston Kiosk): real outline + a circle summary
export const ISLAND_POLY = EQ_ISLAND;
export const ISLAND = (() => { let x = 0, z = 0; for (const p of EQ_ISLAND) { x += p[0]; z += p[1]; } x /= EQ_ISLAND.length; z /= EQ_ISLAND.length;
  let r = 0; for (const p of EQ_ISLAND) r += Math.hypot(p[0] - x, p[1] - z); return { x, z, r: (r / EQ_ISLAND.length) * 0.92 }; })();
const bboxOf = (P) => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const p of P) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); } return [a, b, c, d]; };
const BB_I = bboxOf(EQ_ISLAND), BB_H = bboxOf(HEIR_RING);

export function pointInPoly(x, z, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], zi = P[i][1], xj = P[j][0], zj = P[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
// land test with a coarse cached grid (the shorelines have ~800 vertices; this is called per frame by peds/boats)
const LG = { x0: -2600, z0: -2600, s: 8, n: 650 }; let LGRID = null;
function isLandExact(x, z) {
  if (x > BB_I[0] && x < BB_I[2] && z > BB_I[1] && z < BB_I[3] && pointInPoly(x, z, EQ_ISLAND)) return true;
  if (x > BB_H[0] && x < BB_H[2] && z > BB_H[1] && z < BB_H[3] && pointInPoly(x, z, HEIR_RING)) return true;
  if (z > 400 && pointInPoly(x, z, SOUTH_LAND)) return true;
  return pointInPoly(x, z, NORTH_LAND);
}
export function isLand(x, z) {
  if (!LGRID) { // 0 water, 1 land, 2 mixed (fall back to the exact test)
    LGRID = new Uint8Array(LG.n * LG.n);
    for (let j = 0; j < LG.n; j++) for (let i = 0; i < LG.n; i++) {
      const x0 = LG.x0 + i * LG.s, z0 = LG.z0 + j * LG.s;
      const a = isLandExact(x0, z0), b = isLandExact(x0 + LG.s, z0), c = isLandExact(x0, z0 + LG.s), d = isLandExact(x0 + LG.s, z0 + LG.s), e = isLandExact(x0 + LG.s / 2, z0 + LG.s / 2);
      LGRID[j * LG.n + i] = a && b && c && d && e ? 1 : !a && !b && !c && !d && !e ? 0 : 2;
    }
  }
  const i = Math.floor((x - LG.x0) / LG.s), j = Math.floor((z - LG.z0) / LG.s);
  if (i < 0 || j < 0 || i >= LG.n || j >= LG.n) return false;
  const v = LGRID[j * LG.n + i];
  return v === 2 ? isLandExact(x, z) : v === 1;
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
export const ESCARPMENT = [[-905, -120], [-960, 60], [-1050, 200], [-1200, 330], [-1500, 520], [-1900, 760]];   // foot of Mount Eliza (Mounts Bay Rd)
export const PROMENADE_Y = 2.2;     // quay / promenade level above water

// Ground height (metres) on land. Flat promenade near the water, CBD rising to St Georges Terrace, Kings Park on
// Mount Eliza (plateau = the park as mapped in OSM, escarpment down to Mounts Bay Road), South Perth rising inland.
let KPD = null;
function kpHeight(x, z) {
  if (!KPD) {
    const bin = atob(KP_HEIGHT.data), n0 = KP_HEIGHT.n, raw = new Float32Array(bin.length); for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
    // 8-bit heights (0.3 m steps) terrace the slopes: one separable 5-tap Gaussian pass (sigma ~1.2 texels) smooths them
    const W = [0.0702, 0.2311, 0.3974, 0.2311, 0.0702], tmp = new Float32Array(raw.length); KPD = new Float32Array(raw.length);
    for (let y = 0; y < n0; y++) for (let x = 0; x < n0; x++) { let a = 0; for (let k = -2; k <= 2; k++) a += W[k + 2] * raw[y * n0 + Math.min(n0 - 1, Math.max(0, x + k))]; tmp[y * n0 + x] = a; }
    for (let y = 0; y < n0; y++) for (let x = 0; x < n0; x++) { let a = 0; for (let k = -2; k <= 2; k++) a += W[k + 2] * tmp[Math.min(n0 - 1, Math.max(0, y + k)) * n0 + x]; KPD[y * n0 + x] = a; }
  }
  const n = KP_HEIGHT.n, u = ((x - KP_HEIGHT.x0) / KP_HEIGHT.size) * n - 0.5, v = ((z - KP_HEIGHT.z0) / KP_HEIGHT.size) * n - 0.5;
  if (u < 0 || v < 0 || u >= n - 1 || v >= n - 1) return u < 0 && z < 700 && z > -900 ? 55 : 0;
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * n + i;
  const a = KPD[k], b = KPD[k + 1], c = KPD[k + n], d = KPD[k + n + 1];
  return ((a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv) * KP_HEIGHT.step;
}
export function heightAt(x, z) {
  if (z > 500 && x > -1100) { // South Perth: gentle rise inland from the foreshore
    return PROMENADE_Y + 0.6 + 6 * smooth(1350, 1800, z + 0.12 * x) + 4 * smooth(1800, 2300, z);
  }
  let h = PROMENADE_Y;
  // CBD rise to St Georges Terrace (~15 m) and on to the railway
  h += 12.5 * smooth(-230, -560, z + 0.36 * x) * smooth(-760, -480, x);
  if (x < -600) h = Math.max(h, PROMENADE_Y + kpHeight(x, z));
  return h;
}

// ---------------------------------------------------------------- roads (centrelines, width m, lanes). Left-hand traffic.
export const ROADS = OSM_ROADS.map((r, i) => ({ name: r.n || 'road ' + i, street: r.n || null, cls: r.c, w: r.w, lanes: r.l, oneway: !!r.o, pts: r.pts, traffic: r.c !== 'm' }));
// Narrows Bridge (two road decks + rail between), north end → south end
export const NARROWS = { a: [-833, 318], b: [-858, 606], width: 34 };
// Kwinana Freeway continues south of the Narrows
export const FREEWAY = [[-858, 606], [-884, 650], [-906, 805], [-912, 1000], [-860, 1165], [-812, 1290], [-810, 1450], [-757, 1600], [-740, 1820], [-715, 1970], [-695, 2300]];

// ---------------------------------------------------------------- key places
export const PLACES = {
  spawn: [52, PROMENADE_Y, -214],          // The Landing (north end of the inlet), facing Spanda and the water
  spanda: [111, -190],
  eqJetty: [15, -127],                      // Elizabeth Quay ferry terminal: pontoon along the inlet's west shore
  eqJettyDir: [0.26, -0.966],               // pontoon axis (south → north)
  ferryDock: [21, -122],                    // ferry centre when berthed (bow north, along the pontoon)
  bellTower: [214, -24],                    // -31.958903, 115.858243 (Barrack Square)
  barrackJetty: [190, 60],
  mendsJetty: [-210, 1338],                 // Mends Street Jetty: shore end (OSM)
  mendsHead: [-186, 1262],                  // jetty head
  firstContact: [-64, -25],                 // west landing of the EQ Bridge
  waterPark: [9, -207],
  oldMill: [-840, 770],
  warMemorial: [-1060, 178],
  zoo: [-203, 1944],
  numbat: [-237.7, 1358.9],                 // Connect South canopies on the Mends St foreshore piazza (OSM ways 1431651035,
  lizard: [-225.9, 1340.7],                 //   1431651034): the numbat toward Mends St, the frilled-neck lizard at the jetty foot
};


// Named zones for the location toast (first match wins)
export const ZONES = [
  { name: 'Elizabeth Quay', sub: 'Perth CBD', test: (x, z) => x > -110 && x < 170 && z > -280 && z < 70 },
  { name: 'Barrack Square', sub: 'Perth CBD', test: (x, z) => x >= 170 && x < 330 && z > -120 && z < 160 },
  { name: 'Mends Street', sub: 'South Perth', test: (x, z) => z > 1200 && x > -400 && x < -60 && z < 1600 },
  { name: 'Perth Zoo', sub: 'South Perth', test: (x, z) => Math.hypot(x + 203, z - 1944) < 180 },
  { name: 'Sir James Mitchell Park', sub: 'South Perth', test: (x, z) => x > -60 && z > 1250 && z < 1800 && isLand(x, z) },
  { name: 'South Perth', sub: 'Mill Point', test: (x, z) => z > 550 && isLand(x, z) },
  { name: 'Kings Park', sub: 'Mount Eliza', test: (x, z) => x < -700 && heightAt(x, z) > 25 },
  { name: 'The Narrows', sub: 'Swan River', test: (x, z) => x < -760 && x > -960 && z > 300 && z < 640 },
  { name: 'Perth Water', sub: 'Swan River', test: (x, z) => !isLand(x, z) },
  { name: 'St Georges Terrace', sub: 'Perth CBD', test: (x, z) => z + 0.36 * x < -420 && z + 0.36 * x > -560 },
  { name: 'Perth CBD', sub: 'Western Australia', test: () => true },
];

// ---------------------------------------------------------------- fast "is there a road here?" raster (2 m)
const RG = { x0: -2100, z0: -1900, s: 2, n: 2150 }; let RGRID = null;
export function nearRoad(x, z) {
  if (!RGRID) {
    RGRID = new Uint8Array(RG.n * RG.n);
    for (const r of ROADS) {
      const hw = r.w / 2 + 1.5;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 1.5);
        for (let k = 0; k <= n; k++) {
          const px = ax + ((bx - ax) * k) / n, pz = az + ((bz - az) * k) / n;
          const i0 = Math.floor((px - hw - RG.x0) / RG.s), i1 = Math.floor((px + hw - RG.x0) / RG.s), j0 = Math.floor((pz - hw - RG.z0) / RG.s), j1 = Math.floor((pz + hw - RG.z0) / RG.s);
          for (let j = Math.max(0, j0); j <= Math.min(RG.n - 1, j1); j++) for (let ii = Math.max(0, i0); ii <= Math.min(RG.n - 1, i1); ii++) {
            const cx = RG.x0 + (ii + 0.5) * RG.s - px, cz = RG.z0 + (j + 0.5) * RG.s - pz; if (cx * cx + cz * cz <= hw * hw) RGRID[j * RG.n + ii] = 1;
          }
        }
      }
    }
  }
  const i = Math.floor((x - RG.x0) / RG.s), j = Math.floor((z - RG.z0) / RG.s);
  return i >= 0 && j >= 0 && i < RG.n && j < RG.n && RGRID[j * RG.n + i] === 1;
}
// a point offset inland from the shoreline polyline, for promenade furniture
export function alongShore(P, x0, x1, step, inset, filter, phase = 0) {
  const out = [];
  let carry = phase;   // spacing runs continuously along the polyline (not restarted at every vertex)
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.5) { carry = Math.max(0, carry - L); continue; }
    let d = carry;
    for (; d < L; d += step) {
      const x = ax + ((bx - ax) * d) / L, z = az + ((bz - az) * d) / L; if (x < x0 || x > x1) continue;
      let nx = (bz - az) / L, nz = -(bx - ax) / L; if (!isLand(x + nx * 3, z + nz * 3)) { nx = -nx; nz = -nz; }
      const p = [x + nx * inset, z + nz * inset, Math.atan2(bx - ax, bz - az), nx, nz];
      if (!filter || filter(p[0], p[1])) out.push(p);
    }
    carry = d - L;
  }
  return out;
}
ROADS.push({ name: 'Kwinana Freeway', cls: 't', w: 26, lanes: 4, pts: FREEWAY, traffic: false });
// Mends Street Jetty frame: s = metres out along the jetty line from the shore end, o = metres east of it
export function mendsW(s, o) {
  const [x0, z0] = PLACES.mendsJetty, [x1, z1] = PLACES.mendsHead, L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
  return [x0 + ux * s - uz * o, z0 + uz * s + ux * o];
}
export const MENDS = { deck: 2.84, pontoon: 0.76 };
// [s0, s1, o, halfWidth, y0, y1?]: pinch walkway past Mister Walker, terrace, trunk, head, ramp, floating platform
const MENDS_DECKS = [[-3, 24, -2.65, 1.35, 2.84], [18.5, 35.4, 5.0, 6.3, 2.84], [18, 72, -0.2, 2.5, 2.84], [70, 82, 0, 5, 2.84],
  [82, 96, 0, 1.25, 2.84, 0.76], [96, 116, 0, 2.6, 0.76]];
export const mendsBerth = () => mendsW(106, -7.2);   // ferry alongside the floating platform's west face
// walkable decks over the water (jetties / pontoons): [ax, az, bx, bz, halfWidth, deckY]
export const DECKS = (() => {
  const [cx, cz] = PLACES.eqJetty, [dx, dz] = PLACES.eqJettyDir;
  const D = [[cx - dx * 23, cz - dz * 23, cx + dx * 23, cz + dz * 23, 2.6, 0.76]];
  // Mends Street Jetty (see landmarks.js mendsJetty): level timber jetty at foreshore height, the 2023 ramp down to the
  // floating boarding platform. Segments in jetty coordinates (s out from the shore end, o east of the jetty line).
  for (const [s0, s1, o, hw, y0, y1] of MENDS_DECKS) { const [ax, az] = mendsW(s0, o), [bx, bz] = mendsW(s1, o); D.push([ax, az, bx, bz, hw, y0, y1]); }
  for (const [a, b] of [[[121.8, 53.2], [101.6, 109.8]], [[162.3, 59.3], [140.1, 126.9]], [[197.8, 81.5], [176.5, 138.0]], [[239.3, 85.5], [217.1, 144.1]], [[273.8, 85.5], [259.6, 140.1]]]) D.push([a[0], a[1], b[0], b[1], 2.8, 1.82]);
  return D;
})();
export function deckAt(x, z) {
  for (const [ax, az, bx, bz, hw, y, y1] of DECKS) {
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz, t = ((x - ax) * vx + (z - az) * vz) / l2;
    if (t < -0.02 || t > 1.02) continue;
    const ex = ax + vx * t - x, ez = az + vz * t - z; if (ex * ex + ez * ez < hw * hw) return y1 === undefined ? y : y + (y1 - y) * Math.min(1, Math.max(0, t));
  }
  return null;
}
