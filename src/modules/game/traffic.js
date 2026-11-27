// Traffic: AI cars on the real street network (left-hand traffic lanes from roads.js), pure-pursuit steering,
// car-following with gap keeping, stopping for people, junction hand-off to a connecting lane, honking, and
// "jacked" handling (driver bails out and runs). Spawns around the player, despawns far away.
import { Car, CAR_COLORS } from './vehicles.js';

const KINDS = ['sedan', 'sedan', 'hatch', 'suv', 'ute', 'sedan', 'hatch', 'suv'];
export function createTraffic(G, { lanes, M, col, peds, getPlayer }) {
  const cars = [];
  const usable = lanes.filter((l) => !/St Georges|Hay Street|Mill Point|Mends|South Perth/.test(l.road) || true);
  const lens = usable.map((l) => { let s = 0; for (let i = 1; i < l.pts.length; i++) s += Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]); return s; });
  function pointOn(l, d) {
    for (let i = 1; i < l.pts.length; i++) {
      const a = l.pts[i - 1], b = l.pts[i], s = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d <= s) { const t = d / s; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])]; }
      d -= s;
    }
    const a = l.pts[l.pts.length - 2], b = l.pts[l.pts.length - 1];
    return [b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0])];
  }
  function nextLane(l) {
    const e = l.pts[l.pts.length - 1];
    const cands = [];
    usable.forEach((o, i) => { if (o === l) return; const s = o.pts[0]; const d = Math.hypot(s[0] - e[0], s[1] - e[1]); if (d < 22 && !(o.road === l.road)) cands.push(i); });
    // also allow joining mid-lane of a crossing road near the end point
    return cands.length ? cands[Math.floor(Math.random() * cands.length)] : -1;
  }
  function spawn(near, force) {
    // pick a lane point 80-260 m from `near`, off-screen preferred
    for (let tries = 0; tries < 30; tries++) {
      const li = Math.floor(Math.random() * usable.length), l = usable[li];
      const d = Math.random() * lens[li];
      const [x, z, h] = pointOn(l, d);
      const dist = Math.hypot(x - near.x, z - near.z);
      if (!force && (dist < 70 || dist > 300)) continue;
      if (cars.some((c) => Math.hypot(c.x - x, c.z - z) < 14)) continue;
      const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
      const c = new Car(G, kind, CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)], M, col);
      c.place(x, z, h);
      const sp = 9 + Math.random() * 4;
      c.ai = { li, d, cruise: sp }; c.vx = Math.cos(h) * sp * 0.8; c.vz = Math.sin(h) * sp * 0.8;
      cars.push(c);
      return c;
    }
    return null;
  }
  const T = { cars, target: 14, honk: null, onHitPed: null };
  T.update = (dt) => {
    const pl = getPlayer();
    const focus = pl.vehicle ? pl.vehicle : { x: pl.x, z: pl.z };
    // maintain population
    if (cars.filter((c) => c.ai).length < T.target) spawn(focus, false);
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      if (c === pl.vehicle || c.police) { continue; }
      const far = Math.hypot(c.x - focus.x, c.z - focus.z);
      if (far > 420 || c.sunk) { c.dispose(); cars.splice(i, 1); continue; }
      if (c.ai) {
        const ai = c.ai, l = usable[ai.li];
        // progress along the lane
        ai.d += Math.max(0, c.speed) * dt;
        if (ai.d > lens[ai.li] - 6) { const n = nextLane(l); if (n >= 0) { ai.li = n; ai.d = 0; } else { c.dispose(); cars.splice(i, 1); continue; } }
        const look = 7 + Math.max(0, c.speed) * 0.6;
        const [tx, tz] = pointOn(usable[ai.li], Math.min(lens[ai.li], ai.d + look));
        const want = Math.atan2(tz - c.z, tx - c.x);
        let dh = want - c.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        c.steer = Math.max(-1, Math.min(1, dh * 2.2));
        // obstacles ahead: cars, player, peds
        const fx = Math.cos(c.h), fz = Math.sin(c.h);
        let gap = 99;
        const check = (x, z, r) => { const dx = x - c.x, dz = z - c.z; const ahead = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx); if (ahead > 0 && side < 1.8 + r) gap = Math.min(gap, ahead - c.K.L / 2 - r); };
        for (const o of cars) if (o !== c) check(o.x, o.z, o.K.W / 2);
        if (!pl.vehicle) check(pl.x, pl.z, 0.5); else if (pl.vehicle !== c) check(pl.vehicle.x, pl.vehicle.z, 1.2);
        if (peds) for (const p of peds.list) if (p.ch.state === 'ok') check(p.ch.position.x, p.ch.position.z, 0.4);
        const sd = Math.max(0, (gap - 3) * 0.9);
        const target = Math.min(ai.cruise * (1 - Math.min(0.6, Math.abs(dh))), sd);
        const v = c.speed;
        c.throttle = v < target ? Math.min(1, (target - v) * 0.5) : 0;
        c.brake = v > target + 0.5 ? Math.min(1, (v - target) * 0.35) : 0;
        c.hand = 0;
        if (gap < 6 && v < 1 && pl.vehicle && Math.random() < dt * 0.3) T.honk?.(c);
      } else if (!c.driver) { c.throttle = 0; c.brake = 0.3; c.steer = 0; }
      c.update(dt);
      // knock people over
      if (peds && Math.abs(c.speed) > 2.5) peds.hitByVehicle(c);
    }
    // car vs car (and the player's car) — simple circle impulses
    const all = pl.vehicle && pl.vehicle.K ? [...cars.filter((c) => c !== pl.vehicle), pl.vehicle] : cars;
    for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) {
      const A = all[a], B = all[b]; const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz), m = (A.K.L + B.K.L) * 0.32;
      if (d < m && d > 1e-3) {
        const nx = dx / d, nz = dz / d, pen = m - d;
        const ma = A.K.mass, mb = B.K.mass, ta = mb / (ma + mb), tb = ma / (ma + mb);
        A.x -= nx * pen * ta; A.z -= nz * pen * ta; B.x += nx * pen * tb; B.z += nz * pen * tb;
        const rv = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
        if (rv < 0) {
          const j = -1.4 * rv / (1 / ma + 1 / mb);
          A.vx -= (j / ma) * nx; A.vz -= (j / ma) * nz; B.vx += (j / mb) * nx; B.vz += (j / mb) * nz;
          if (-rv > 3) { T.onCrash?.(A, B, -rv); if (A.ai) A.ai.cruise = 0; if (B.ai) B.ai.cruise = 0; }
        }
      }
    }
  };
  T.spawnAt = (kind, x, z, h, color) => { const c = new Car(G, kind, color ?? CAR_COLORS[0], M, col); c.place(x, z, h); cars.push(c); return c; };
  T.prime = (near) => { for (let i = 0; i < T.target; i++) spawn(near, false); };
  T.clear = () => { for (const c of cars) c.dispose(); cars.length = 0; };
  return T;
}
