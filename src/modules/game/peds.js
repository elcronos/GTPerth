// Pedestrians: Rocketbox people strolling the Elizabeth Quay promenade, The Landing, Barrack Square and the South
// Perth foreshore; idlers taking photos / on their phones at the water's edge; joggers on the river path.
// They flee from danger, get knocked down by cars (fling + sprawl) and by punches, and report crimes (witnesses).
import { MathUtils } from 'three';
import { Character } from './character.js';
import { FEMALE, MALE, PLAYER_AVATAR } from './avatars.js';
import { heightAt, isLand, PROMENADE_Y, SHORE_N, SHORE_S, alongShore, nearRoad } from '../../map.js';
import { groundAt } from './player.js';

// walkable waypoint loops (promenades), metres
// walking loops and loiter spots follow the real promenades (shorelines from OSM)
const sh = (P, x0, x1, step, inset, f) => alongShore(P, x0, x1, step, inset, f).map((p) => [p[0], p[1]]);
const LOOPS = {
  eq: sh(SHORE_N, -75, 330, 14, 8.5, (x, z) => z > -225 && z < 90),   // clear of the bench / lamp line (3.5 m inset)
  landing: sh(SHORE_N, 20, 150, 9, 9, (x, z) => z < -150 && z > -230),
  west: sh(SHORE_N, -460, -70, 24, 11, (x, z) => z > -120),
  barrack: sh(SHORE_N, 140, 330, 10, 10, (x, z) => z > -40 && z < 120),
  south: sh(SHORE_S, -430, 200, 22, 12),
  sgt: (() => {   // St Georges Terrace footpaths: east along the north side, back along the south side
    const C = [[-264, -618], [57, -498], [251, -433], [367, -388]], out = [[], []];
    for (let i = 0; i < C.length - 1; i++) { const [ax, az] = C[i], [bx, bz] = C[i + 1], L = Math.hypot(bx - ax, bz - az), nx = (bz - az) / L, nz = -(bx - ax) / L;
      for (let d = 0; d < L; d += 12) for (const [k, s] of [[0, 1], [1, -1]]) { const px = ax + (bx - ax) * d / L, pz = az + (bz - az) * d / L; let o = 6; while (o < 22 && nearRoad(px + nx * o * s, pz + nz * o * s)) o += 1; o += 1.2; out[k].push([px + nx * o * s, pz + nz * o * s]); } }
    return [...out[0], ...out[1].reverse()];
  })(),
};
const IDLE_SPOTS = alongShore(SHORE_N, -70, 300, 37, 2.2, (x, z) => z > -215 && z < 90).concat(alongShore(SHORE_S, -320, -100, 30, 3))
  .map((p) => [p[0], p[1], Math.atan2(-p[3], -p[4])]).filter((_, i) => i % 2 === 0).slice(0, 24);
let VIS_R = 220, SHADOW_R = 60;
export function createPeds(G, { avatars, col }) {
  const list = [];
  const pool = [...FEMALE.filter((n) => n !== PLAYER_AVATAR), ...MALE];
  let ai = 0;
  const pick = () => pool[(ai++) % pool.length];
  function add(kind, x, z, zone, opts = {}) {
    let nm = opts.avatar;
    if (!nm) { for (let k = 0; k < 8; k++) { nm = pick(); if (!list.some((q) => q.avatar === nm && Math.hypot(q.ch.root.position.x - x, q.ch.root.position.z - z) < 30)) break; } }   // no twins side by side
    const inst = avatars.instance(nm);
    const ch = new Character(G, inst);
    G.scene.add(ch.root);
    ch.root.position.set(x, groundAt(x, z).y, z);
    const p = { avatar: nm, ch, kind, zone, path: LOOPS[zone], wp: 0, dir: Math.random() < 0.5 ? 1 : -1, speed: 0, cruise: kind === 'jog' ? 3.2 + Math.random() * 0.8 : 1.1 + Math.random() * 0.45,
      state: 'walk', t: 0, fleeT: 0, from: null, yaw: Math.random() * 6.28, idleYaw: opts.yaw ?? 0, gesture: opts.gesture || null, dead: false, witnessed: 0 };
    if (p.path) { // nearest waypoint
      let b = 1e9; p.path.forEach((w, i) => { const d = Math.hypot(w[0] - x, w[1] - z); if (d < b) { b = d; p.wp = i; } });
    }
    if (kind === 'idle') { p.state = 'idle'; p.yaw = p.idleYaw; if (p.gesture) ch.playGesture(p.gesture); }
    ch.walkStyle = kind === 'stroll' ? 'stroll' : 'walk';
    list.push(p);
    return p;
  }
  // populate
  const R = () => Math.random();
  const busy = G.quality.tier === 'high' || G.quality.tier === 'ultra';
  VIS_R = busy ? 220 : 140; SHADOW_R = busy ? 35 : 25;   // lived-in promenade on desktop; phones keep the light crowd
  for (let i = 0; i < (busy ? 22 : 10); i++) { const L = LOOPS.eq, w = L[Math.floor(R() * L.length)]; add(R() < 0.4 ? 'stroll' : 'walk', w[0] + (R() - 0.5) * 4, w[1] + (R() - 0.5) * 4, 'eq'); }
  for (let i = 0; i < (busy ? 8 : 4); i++) { const L = LOOPS.landing, w = L[Math.floor(R() * L.length)]; add('stroll', w[0], w[1], 'landing'); }
  for (let i = 0; i < 3; i++) { const L = LOOPS.west, w = L[Math.floor(R() * L.length)]; add('jog', w[0], w[1], 'west', { avatar: i % 2 ? 'Sports_Male_04' : 'Sports_Female_02' }); }
  for (let i = 0; i < (busy ? 24 : 6); i++) { const L = LOOPS.sgt, w = L[Math.floor(R() * L.length)]; add(R() < 0.3 ? 'stroll' : 'walk', w[0], w[1], 'sgt').ch.root.userData.noReflect = true; }   // CBD walkers never reach the river mirror
  for (let i = 0; i < (busy ? 7 : 4); i++) { const L = LOOPS.barrack, w = L[Math.floor(R() * L.length)]; add('walk', w[0], w[1], 'barrack'); }
  for (let i = 0; i < 7; i++) { const L = LOOPS.south, w = L[Math.floor(R() * L.length)]; add(R() < 0.5 ? 'stroll' : 'walk', w[0], w[1], 'south'); }
  IDLE_SPOTS.forEach(([x, z, yaw], i) => { if (!busy && i >= 16) return; const g = ['photo', 'phone', 'look', null][i % 4]; add('idle', x, z, null, { yaw, gesture: g, avatar: g === 'photo' ? FEMALE[(i % 4) + 1] : g === 'phone' ? MALE[(i % 5)] : undefined }); });

  const S = { list, onHit: null, onFlee: null };
  // prime for a photo/fly camera: move most walkers of the loops near the focus onto waypoints 12-140 m ahead, in view
  // move anyone standing in the camera-to-player sightline (or on the player) to a waypoint well away
  S.clearView = (camPos, pl) => {
    const ax = camPos.x, az = camPos.z, wx = pl.x - ax, wz = pl.z - az, l2 = wx * wx + wz * wz || 1;
    for (const p of list) {
      const q = p.ch.root.position, t = Math.max(0, Math.min(1.5, ((q.x - ax) * wx + (q.z - az) * wz) / l2));
      const qd = Math.hypot(q.x - (ax + wx * t), q.z - (az + wz * t)), pd = Math.hypot(q.x - pl.x, q.z - pl.z);
      if (qd > 2.5 && pd > 3) continue;
      const P = p.path || LOOPS.eq; const far = P.filter(([x, z]) => { const dp = Math.hypot(x - pl.x, z - pl.z), dx = x - ax, dz = z - az, dl = Math.hypot(dx, dz) || 1; const tt = (dx * wx + dz * wz) / l2, cd = Math.hypot(x - (ax + wx * tt), z - (az + wz * tt));
        return dp > 6 && dl > 10 && dl < 60 && (dx * wx + dz * wz) / (dl * Math.sqrt(l2)) > 0.6 && cd > 3; });   // stay in shot, out of the sightline
      if (!far.length) continue; const w = far[Math.floor(Math.random() * far.length)];
      q.set(w[0], groundAt(w[0], w[1]).y, w[1]); if (p.path) p.wp = p.path.indexOf(w); if (p.kind === 'idle') { p.kind = 'walk'; p.state = 'walk'; p.path = P; p.wp = P.indexOf(w); }
    }
  };
  // top-up for the opening shot: make sure a handful of walkers are in view (8-55 m ahead), off the sightline
  S.topUp = (camPos, pl, want) => {
    const fx = pl.x - camPos.x, fz = pl.z - camPos.z, fl = Math.hypot(fx, fz) || 1, ux = fx / fl, uz = fz / fl;
    const inView = (x, z) => { const dx = x - camPos.x, dz = z - camPos.z, dep = dx * ux + dz * uz, lat = Math.abs(-dx * uz + dz * ux); return dep > 8 && dep < 55 && lat < 0.5 * dep && lat > 2.5; };
    const depthOf = (x, z) => (x - camPos.x) * ux + (z - camPos.z) * uz;
    const BANDS = [[8, 20, 2], [20, 35, 2], [35, 55, 3]];   // spread the crowd in depth instead of one knot
    const count = (b) => list.filter((p) => { const q = p.ch.root.position, d = depthOf(q.x, q.z); return p.kind !== 'idle' && inView(q.x, q.z) && d >= b[0] && d < b[1]; }).length;
    const free = (x, z) => Math.hypot(x - pl.x, z - pl.z) > 4 && !list.some((q) => Math.hypot(q.ch.root.position.x - x, q.ch.root.position.z - z) < 3.5);
    let n = list.filter((p) => p.kind !== 'idle' && inView(p.ch.root.position.x, p.ch.root.position.z)).length;
    for (const b of BANDS) {
      let have = count(b);
      for (const p of list) {
        if (n >= want || have >= b[2]) break;
        if (!p.path || p.kind === 'idle' || p.zone === 'sgt' || inView(p.ch.root.position.x, p.ch.root.position.z)) continue;
        const cand = (LOOPS.eq.concat(LOOPS.landing)).filter(([x, z]) => inView(x, z) && depthOf(x, z) >= b[0] && depthOf(x, z) < b[1] && free(x, z)); if (!cand.length) break;
        const w = cand[Math.floor(Math.random() * cand.length)];
        p.path = LOOPS.eq.includes(w) ? LOOPS.eq : LOOPS.landing; p.zone = p.path === LOOPS.eq ? 'eq' : 'landing'; p.wp = p.path.indexOf(w); p.dir = Math.random() < 0.5 ? 1 : -1;
        p.ch.root.position.set(w[0], groundAt(w[0], w[1]).y, w[1]); n++; have++;
      }
    }
  };
  S.prime = (focus, camPos, camFwd) => {
    for (const p of list) {
      if (!p.path || p.kind === 'idle' || Math.random() > 0.95) continue;
      const cand = p.path.filter(([x, z]) => { const d = Math.hypot(x - focus.x, z - focus.z), dx = x - camPos.x, dz = z - camPos.z, dl = Math.hypot(dx, dz) || 1;
        return d < 140 && dl > 12 && (dx * camFwd.x + dz * camFwd.z) / dl > 0.35; });
      if (!cand.length) continue;
      const w = cand[Math.floor(Math.random() * cand.length)]; p.ch.root.position.set(w[0] + (Math.random() - 0.5) * 2, groundAt(w[0], w[1]).y, w[1] + (Math.random() - 0.5) * 2);
      p.wp = p.path.indexOf(w);
    }
  };
  S.scare = (x, z, r = 18, dur = 6) => { for (const p of list) { if (p.ch.state !== 'ok') continue; const d = Math.hypot(p.ch.position.x - x, p.ch.position.z - z); if (d < r) { p.state = 'flee'; p.fleeT = dur * (0.7 + Math.random() * 0.6); p.from = [x, z]; p.ch.stopGesture(); } } };
  S.hitByVehicle = (car) => {
    const fx = Math.cos(car.h), fz = Math.sin(car.h), v = car.speed;
    for (const p of list) {
      if (p.ch.state !== 'ok' && !(p.ch.state === 'down' && Math.abs(v) > 6)) continue;
      const dx = p.ch.position.x - car.x, dz = p.ch.position.z - car.z;
      const a = dx * fx + dz * fz, s = -dx * fz + dz * fx;
      if (Math.abs(a) < car.K.L / 2 + 0.35 && Math.abs(s) < car.K.W / 2 + 0.3 && Math.abs(p.ch.position.y - car.y) < 2) {
        const sp = Math.abs(v);
        if (p.ch.knockDown(car.vx * 0.85 + (-fz * Math.sign(s)) * 1.2, car.vz * 0.85 + (fx * Math.sign(s)) * 1.2, sp > 13 ? 1 : 0.6)) {
          p.dead = p.ch.fall.dead; S.onHit?.(p, 'vehicle', sp, car);
          car.vx *= 0.92; car.vz *= 0.92;
          S.scare(p.ch.position.x, p.ch.position.z, 30, 8);
        }
      }
    }
  };
  S.punchAt = (x, z, yaw) => {
    const fx = Math.sin(yaw), fz = Math.cos(yaw); let hit = null;
    for (const p of list) {
      if (p.ch.state !== 'ok') continue;
      const dx = p.ch.position.x - x, dz = p.ch.position.z - z, a = dx * fx + dz * fz, s = Math.abs(-dx * fz + dz * fx);
      if (a > 0.2 && a < 1.5 && s < 0.7) { hit = p; break; }
    }
    if (hit) { hit.ch.knockDown(fx * 3.5, fz * 3.5, 0.3); S.onHit?.(hit, 'punch', 4); S.scare(x, z, 20, 7); }
    return hit;
  };
  S.update = (dt, player) => {
    const px = player.vehicle ? player.vehicle.x : player.x, pz = player.vehicle ? player.vehicle.z : player.z;
    for (const p of list) {
      const ch = p.ch, pos = ch.position;
      const d2p = Math.hypot(pos.x - px, pos.z - pz);
      const vf = G.camLocked && G.focus ? Math.hypot(pos.x - G.focus.x, pos.z - G.focus.z) : d2p;   // photo cams: visibility follows the view
      const vis = vf < VIS_R; ch.root.visible = vis;
      if (!vis) continue;
      const sh = vf < SHADOW_R; if (ch._sh !== sh) { ch._sh = sh; ch.inst.obj.traverse((o) => { if (o.isMesh) o.castShadow = sh; }); }   // only near people cast sun shadows (shadow-pass calls)
      if (ch.state !== 'ok') { ch.update(dt, groundAt(pos.x, pos.z, pos.y).y); continue; }
      // danger: fast vehicle heading at them, or the player sprinting at them with a car
      let target = 0;
      if (p.state === 'flee') {
        p.fleeT -= dt;
        const fx = pos.x - p.from[0], fz = pos.z - p.from[1]; const l = Math.hypot(fx, fz) || 1;
        p.yaw = lerpAngle(p.yaw, Math.atan2(fx / l, fz / l), Math.min(1, 6 * dt));
        target = 5.2;
        if (p.fleeT <= 0) { p.state = p.kind === 'idle' ? 'idle' : 'walk'; }
      } else if (p.state === 'idle') {
        target = 0; p.yaw = lerpAngle(p.yaw, p.idleYaw, Math.min(1, 2 * dt));
        if (p.gesture && !ch.gesture) ch.playGesture(p.gesture);
      } else if (p.path) {
        const w = p.path[p.wp];
        const dx = w[0] - pos.x, dz = w[1] - pos.z, d = Math.hypot(dx, dz);
        if (d < 2.2) { p.wp = (p.wp + p.dir + p.path.length) % p.path.length; if (Math.random() < 0.08) { p.dir *= -1; } }
        p.yaw = lerpAngle(p.yaw, Math.atan2(dx, dz), Math.min(1, 3 * dt));
        target = p.cruise;
        // keep apart from the player
        if (!player.vehicle && d2p < 1.4) target *= 0.3;
      }
      p.speed += (target - p.speed) * Math.min(1, 4 * dt);
      let nx = pos.x + Math.sin(p.yaw) * p.speed * dt, nz = pos.z + Math.cos(p.yaw) * p.speed * dt;
      const c = col.circleVsWorld(nx, nz, 0.3); if (c.hit) { nx = c.x; nz = c.z; if (p.state === 'flee') p.yaw += 0.6; }
      if (!isLand(nx, nz) && !onBridge(nx, nz)) { nx = pos.x; nz = pos.z; p.yaw += Math.PI * 0.5; if (p.path) p.wp = (p.wp + p.dir + p.path.length) % p.path.length; }
      // camera bubble: walkers step around the lens instead of filling it (GTA keeps a clear near field)
      { const cp = G.camera.position, cx = nx - cp.x, cz = nz - cp.z, cd = Math.hypot(cx, cz);
        if (cd < 2.0 && cd > 1e-3) { const k = (2.0 - cd) * 0.8 * dt; nx += (cx / cd) * k * 3; nz += (cz / cd) * k * 3; p.speed *= 0.97; } }
      // keep the camera-to-player sightline clear (walkers must never bury the player in the frame)
      if (!player.vehicle && !G.camLocked) {
        const cp = G.camera.position, ax = cp.x, az = cp.z, bx0 = player.x, bz0 = player.z, vx = bx0 - ax, vz = bz0 - az, vl = Math.hypot(vx, vz) || 1;
        const bx = bx0 + vx / vl * 2, bz = bz0 + vz / vl * 2, wx = bx - ax, wz = bz - az, l2 = wx * wx + wz * wz || 1;
        const t = Math.max(0, Math.min(1, ((nx - ax) * wx + (nz - az) * wz) / l2)), qx = nx - (ax + wx * t), qz = nz - (az + wz * t), qd = Math.hypot(qx, qz);
        if (qd < 1.8 && qd > 1e-3) { const k = (1.8 - qd) * 2.4 * dt; nx += qx / qd * k; nz += qz / qd * k; p.speed *= 0.9; }
        const pd = Math.hypot(nx - bx0, nz - bz0); if (pd < 2.5 && pd > 1e-3) { const k = (2.5 - pd) * 1.6 * dt; nx += (nx - bx0) / pd * k; nz += (nz - bz0) / pd * k; }
      }
      // separation from other peds
      for (const o of list) if (o !== p && o.ch.root.visible) { const ox = nx - o.ch.position.x, oz = nz - o.ch.position.z, od = Math.hypot(ox, oz); if (od < 0.7 && od > 1e-3) { nx += (ox / od) * (0.7 - od) * 0.5; nz += (oz / od) * (0.7 - od) * 0.5; } }
      pos.x = nx; pos.z = nz;
      ch.speed = p.speed; ch.root.rotation.y = p.yaw;
      ch.update(dt, groundAt(nx, nz, pos.y).y);
    }
  };
  return S;
}
function lerpAngle(a, b, t) { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * t; }
function onBridge(x, z) { return groundAt(x, z, 3).y > 2.5; }
