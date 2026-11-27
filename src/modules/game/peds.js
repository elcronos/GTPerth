// Pedestrians: Rocketbox people strolling the Elizabeth Quay promenade, The Landing, Barrack Square and the South
// Perth foreshore; idlers taking photos / on their phones at the water's edge; joggers on the river path.
// They flee from danger, get knocked down by cars (fling + sprawl) and by punches, and report crimes (witnesses).
import { MathUtils } from 'three';
import { Character } from './character.js';
import { FEMALE, MALE, PLAYER_AVATAR } from './avatars.js';
import { heightAt, isLand, PROMENADE_Y } from '../../map.js';
import { groundAt } from './player.js';

// walkable waypoint loops (promenades), metres
const LOOPS = {
  eq: [[-56, -4], [-56, -40], [-57, -100], [-55, -150], [-40, -168], [0, -170], [40, -170], [68, -160], [82, -120], [82, -60], [86, -20], [100, 10], [150, 18], [210, 22], [270, 26], [320, 32]],
  landing: [[-30, -168], [-10, -176], [20, -178], [45, -174], [60, -168], [30, -186], [-20, -186]],
  west: [[-60, 10], [-110, 14], [-180, 26], [-260, 40], [-340, 56], [-420, 80]],
  barrack: [[150, 0], [180, 20], [230, 26], [280, 20], [240, 0], [190, -10], [150, -22]],
  south: [[-420, 1105], [-330, 1190], [-250, 1252], [-195, 1280], [-130, 1290], [-40, 1302], [60, 1312], [160, 1324]],
};
const IDLE_SPOTS = [[-50, -60, 1.6], [-48, -120, 1.6], [10, -166, 0], [-25, -167, 0], [62, -166, 0], [74, -90, -1.6], [-52, 2, 0.2], [175, 28, 0], [-200, 1278, 3.1], [-180, 1278, 3.1], [-150, 1290, 3.1], [150, 26, 0], [5, -180, 2.8], [-58, -20, 1.6]];

export function createPeds(G, { avatars, col }) {
  const list = [];
  const pool = [...FEMALE.filter((n) => n !== PLAYER_AVATAR), ...MALE];
  let ai = 0;
  const pick = () => pool[(ai++) % pool.length];
  function add(kind, x, z, zone, opts = {}) {
    const inst = avatars.instance(opts.avatar || pick());
    const ch = new Character(G, inst);
    G.scene.add(ch.root);
    ch.root.position.set(x, groundAt(x, z).y, z);
    const p = { ch, kind, zone, path: LOOPS[zone], wp: 0, dir: Math.random() < 0.5 ? 1 : -1, speed: 0, cruise: kind === 'jog' ? 3.2 + Math.random() * 0.8 : 1.1 + Math.random() * 0.45,
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
  for (let i = 0; i < 10; i++) { const L = LOOPS.eq, w = L[Math.floor(R() * L.length)]; add(R() < 0.4 ? 'stroll' : 'walk', w[0] + (R() - 0.5) * 4, w[1] + (R() - 0.5) * 4, 'eq'); }
  for (let i = 0; i < 4; i++) { const L = LOOPS.landing, w = L[Math.floor(R() * L.length)]; add('stroll', w[0], w[1], 'landing'); }
  for (let i = 0; i < 3; i++) { const L = LOOPS.west, w = L[Math.floor(R() * L.length)]; add('jog', w[0], w[1], 'west', { avatar: i % 2 ? 'Sports_Male_04' : 'Sports_Female_02' }); }
  for (let i = 0; i < 4; i++) { const L = LOOPS.barrack, w = L[Math.floor(R() * L.length)]; add('walk', w[0], w[1], 'barrack'); }
  for (let i = 0; i < 7; i++) { const L = LOOPS.south, w = L[Math.floor(R() * L.length)]; add(R() < 0.5 ? 'stroll' : 'walk', w[0], w[1], 'south'); }
  IDLE_SPOTS.forEach(([x, z, yaw], i) => { const g = ['photo', 'phone', 'look', null][i % 4]; add('idle', x, z, null, { yaw, gesture: g, avatar: g === 'photo' ? FEMALE[(i % 4) + 1] : g === 'phone' ? MALE[(i % 5)] : undefined }); });

  const S = { list, onHit: null, onFlee: null };
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
      const vis = d2p < 340; ch.root.visible = vis;
      if (!vis) continue;
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
