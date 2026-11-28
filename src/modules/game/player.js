// Player: on-foot third-person controller (camera-relative movement, walk/run/sprint, jump, swim, punch), the
// GTA-style orbit camera (shoulder offset, collision pull-in, speed FOV, look-behind) and vehicle control mapping.
import { Vector3, MathUtils } from 'three';
import { PLAYER } from '../../contracts.js';
import { heightAt, isLand, PROMENADE_Y, deckAt } from '../../map.js';
import { Character } from './character.js';
import { bridgeCurve, bridgeDeckY } from '../world/landmarks.js';

const _v = new Vector3(), _t = new Vector3();
const BRIDGE = bridgeCurve(); const BPTS = BRIDGE.getSpacedPoints(90);
// walkable height: terrain, or the EQ bridge deck when standing on it
export function groundAt(x, z, y = 0) {
  let best = 1e9, bi = 0;
  for (let i = 0; i < BPTS.length; i += 2) { const d = (BPTS[i].x - x) ** 2 + (BPTS[i].z - z) ** 2; if (d < best) { best = d; bi = i; } }
  if (best < 2.4 * 2.4) { const by = bridgeDeckY(bi / 90) + 0.12; if (y > by - 1.2) return { y: by, water: false }; }
  if (isLand(x, z)) return { y: heightAt(x, z), water: false };
  const dy = deckAt(x, z); if (dy !== null) return { y: dy, water: false };
  return { y: -1.15, water: true };
}

export function createPlayer(G, { avatars, input, col, hud }) {
  const inst = avatars.instance('Female_Adult_12');
  const ch = new Character(G, inst);
  G.scene.add(ch.root);
  const P = {
    ch, x: PLAYER.spawn[0], z: PLAYER.spawn[2], y: PLAYER.spawn[1], vy: 0, yaw: PLAYER.spawnYaw, moveYaw: PLAYER.spawnYaw,
    camYaw: PLAYER.spawnYaw + Math.PI, camPitch: 0.10, camDist: PLAYER.camDist, health: 100, armour: 0, stamina: 1,
    vehicle: null, swimming: false, onGround: true, speed: 0, cash: 0, dead: false, busted: false, control: true,
    camPos: new Vector3(), camTarget: new Vector3(), fovKick: 0, lookBehind: false, punchCD: 0,
  };
  ch.root.position.set(P.x, P.y, P.z);
  P.teleport = (x, z, yaw) => { P.climb = null; P.speed = 0; P.animSpeed = 0; P.yawRate = 0; ch.stopTrans?.(0); P.x = x; P.z = z; P.y = groundAt(x, z).y; P.vy = 0; P.yaw = P.moveYaw = yaw; P.camYaw = yaw + Math.PI; ch.root.position.set(P.x, P.y, P.z); ch.setHeading(yaw); ch.state = 'ok'; ch.fall = null; ch.body.quaternion.identity(); ch.body.position.set(0, 0, 0); };
  P.teleport(P.x, P.z, P.yaw);
  ch.onFootstep = () => { if (P.onGround && !P.swimming && !P.air) P.onStep?.(ch.speed, deckAt(P.x, P.z) !== null && !isLand(P.x, P.z)); };
  P.shake = 0; G.on('fx:shake', (k = 0.5) => { P.shake = Math.max(P.shake, k); });

  // walkable at (x, z) on foot: land, a deck/jetty or the bridge (the river edge is a wall, not a drop into the water)
  const walkable = (x, z, y) => !groundAt(x, z, y).water;
  P.combat = { next: null, combo: 0, comboT: 0, target: null, lungeT: 0, hit: false, guardT: 0 };
  P.findTarget = null;   // set by the game: (x, z, yaw, range, maxAngle) → ped
  P.lockQuery = (aimYaw = P.yaw) => P.findTarget?.(P.x, P.z, aimYaw, 3.8) || P.findTarget?.(P.x, P.z, aimYaw, 1.6, Math.PI) || null;
  P.yawRate = 0; P.winded = false; P.air = false; P.bodies = null;   // bodies(): { peds, cars } for player-vs-crowd collision
  P.updateOnFoot = (dt) => {
    const mv = input.move; // x strafe, y forward
    const C = P.combat, atk = ch.atk;
    const want = P.control && !P.dead && !P.climb ? Math.min(1, Math.hypot(mv.x, mv.y)) : 0;
    // stamina with hysteresis: empty → winded until 35 % (no on/off flicker at the bottom of the bar)
    if (P.stamina <= 0.02) P.winded = true; else if (P.winded && P.stamina > 0.35) P.winded = false;
    const sprint = input.down('sprint') && !P.winded && !P.swimming;
    let target = 0;
    if (want > 0.08) {
      // camera-relative direction (camera looks along camYaw+π)
      const fwdYaw = P.camYaw + Math.PI;
      P.moveYaw = fwdYaw - Math.atan2(mv.x, mv.y);   // yaw decreases to the viewer's right (x east, z south)
      // analog response: a nudge creeps, half a push walks, a full push jogs
      const w = MathUtils.clamp((want - 0.12) / 0.88, 0, 1);
      target = P.swimming ? 1.3 + w * 0.7 : sprint ? PLAYER.sprint : w < 0.55 ? PLAYER.walk * (0.25 + 0.75 * w / 0.55) : PLAYER.walk + (PLAYER.run - PLAYER.walk) * Math.min(1, (w - 0.55) / 0.3);
    }
    if (atk) target *= 0.25;   // planted while punching
    // punch approach: run in at a locked target as a real movement input (accelerates, steers and brakes like the
    // stick), out-running a walker; presses made on the way are queued into the combo
    let apAcc = 0;
    if (C.approach) {
      const q = C.approach.q, qx = q.ch.position.x - P.x, qz = q.ch.position.z - P.z, d = Math.hypot(qx, qz), bearing = Math.atan2(qx, qz);
      C.approach.t -= dt;
      if (q.ch.state !== 'ok' || (want > 0.3 && Math.cos(P.moveYaw - bearing) < 0)) C.approach = null;
      else if (d < ((q.speed || 0) > 0.5 ? 2.3 : 1.9) || C.approach.t <= 0) { if (d < 2.6) { C.next = 0.1; C.chain = Math.min(2, C.approach.queued || 0); } C.approach = null; }
      else { P.moveYaw = bearing; target = Math.min(PLAYER.run + 0.6, Math.max((q.speed || 0) + 0.8, Math.sqrt(18 * Math.max(0, d - 1.1)))); apAcc = 13; C.guardT = 2.6; }
    }
    P.stamina = MathUtils.clamp(P.stamina + (sprint && want > 0.08 ? -0.12 : 0.16) * dt, 0, 1);
    // yaw: a critically damped angular spring (no one-frame snap to full turn rate); slower at speed and in the air
    let dy = want > 0.08 || apAcc ? MathUtils.euclideanModulo(P.moveYaw - P.yaw + Math.PI, Math.PI * 2) - Math.PI : 0;
    if (C.target && (atk || C.lungeT > 0)) { const t = C.target.ch.position; dy = MathUtils.euclideanModulo(Math.atan2(t.x - P.x, t.z - P.z) - P.yaw + Math.PI, Math.PI * 2) - Math.PI; }
    const turnMax = P.air ? 1.5 : P.swimming ? 2.4 : atk || C.lungeT > 0 ? 11 : MathUtils.lerp(9, 4.5, MathUtils.clamp(P.speed / PLAYER.sprint, 0, 1));
    const kS = atk || C.lungeT > 0 ? 90 : 40, kD = atk || C.lungeT > 0 ? 17 : 10.7;   // omega ~6.3, zeta ~0.85
    P.yawRate += MathUtils.clamp((dy * kS - P.yawRate * kD) * dt, -45 * dt, 45 * dt);
    P.yawRate = MathUtils.clamp(P.yawRate, -turnMax, turnMax);
    if (Math.abs(dy) < 0.004 && Math.abs(P.yawRate) < 0.05) P.yawRate = 0;
    P.yaw += P.yawRate * dt;
    const omega = P.yawRate;
    // sharp direction changes plant-and-pivot; any turn bleeds a little speed
    const pivot = Math.abs(dy) > 1.4 ? MathUtils.clamp(1 - (Math.abs(dy) - 1.4) / 1.2, 0.2, 1) : 1;
    let tgt = target * pivot * (1 - Math.min(0.25, Math.abs(omega) * 0.04));
    // brake into the river edge instead of hitting it like a wall: probe ahead along the facing
    let edgeBrake = false;
    if (!P.swimming && tgt > 0.05) {
      const reach = 0.4 + P.speed * P.speed / 11;   // stopping distance at ~5.5 m/s² plus margin
      for (const yy of want > 0.08 && Math.abs(dy) > 0.05 ? [P.yaw, P.moveYaw] : [P.yaw]) for (let dd = 0.25; dd <= reach + 0.01; dd += 0.15) {
        if (!walkable(P.x + Math.sin(yy) * dd, P.z + Math.cos(yy) * dd, P.y)) {
          let lo = Math.max(0, dd - 0.15), hi = dd; for (let k = 0; k < 4; k++) { const mid = (lo + hi) / 2; if (walkable(P.x + Math.sin(yy) * mid, P.z + Math.cos(yy) * mid, P.y)) lo = mid; else hi = mid; }
          const t2 = Math.sqrt(11 * Math.max(0, lo - 0.45)); if (t2 < tgt) { tgt = t2; edgeBrake = true; } break; }
      }
      if (edgeBrake) tgt = Math.min(tgt, P.speed);   // never speed back up toward the edge
    }
    const acc = P.air ? 1.5 : apAcc && tgt > P.speed ? apAcc : edgeBrake && tgt < P.speed ? 9 : tgt > P.speed ? (P.speed < PLAYER.walk ? 6.0 : 7.0) : (tgt < 0.1 ? 8.5 : 6.5);
    const prev = P.speed;
    P.speed += MathUtils.clamp(tgt - P.speed, -acc * dt, acc * dt);
    // start / stop transitions (root motion): from standing into a walk or jog, and planting to a halt
    // stop transitions (root motion): plant and halt. Entered past the clip's run-in, at a rate matched to the entry
    // speed (no speed pop); never speeds the body up; cancelled by input, attacks, air, or a wall
    P.blockedT = Math.max(0, (P.blockedT || 0) - dt); P.stumbleT = Math.max(0, (P.stumbleT || 0) - dt);
    const trOK = P.onGround && !P.air && !P.swimming && !P.climb && !atk && C.lungeT <= 0 && !P.blockedT;
    if (ch.trans) {
      if (!trOK || want > 0.3) ch.stopTrans(0.15);
      else {   // root speed, low-passed (the clip's root path steps), braking hard on the plant but never in one frame
        P.transRv = (P.transRv ?? prev) + (ch.transDelta / Math.max(dt, 1e-4) - (P.transRv ?? prev)) * 0.5;
        P.speed = Math.min(prev, Math.max(P.transRv, prev - 14 * dt));
        if (P.speed < 0.22) ch.stopTrans(0.2);
      }
    } else if (trOK && want <= 0.08 && prev > 0.6 && (P.hadInput || P.stopPending) && prev <= 4.0) {
      P.stopPending = false; P.transRv = prev;
      if (prev > 2.3) ch.playTrans('run_stop', { start: 0.75, rate: MathUtils.clamp(prev / 2.3, 1, 1.9) });
      else ch.playTrans('walk_stop', { start: 0.2, rate: MathUtils.clamp(prev / 0.8, 1.2, 1.6) });
    }
    if (P.hadInput && want <= 0.08 && prev > 4.0) P.stopPending = true;   // from a sprint: brake normally to a jog first
    if (want > 0.08) P.stopPending = false;
    P.hadInput = want > 0.08;
    const a = (P.speed - prev) / Math.max(dt, 1e-4);
    const L = ch.lean, k = Math.min(1, 6 * dt);
    L.roll += (MathUtils.clamp(-omega * P.speed * 0.02, -0.14, 0.14) - L.roll) * k;
    L.pitch += (MathUtils.clamp(a * 0.012 + (sprint ? 0.06 : 0) + (P.speed > 0.3 ? 0.02 : 0), -0.08, 0.12) - L.pitch) * k;
    if (P.swimming) { L.pitch += (1.05 - L.pitch) * Math.min(1, 3 * dt); L.roll *= 0.9; }
    // head looks into the turn before the body follows
    ch.lookYaw += (MathUtils.clamp(dy * 0.5, -0.6, 0.6) - ch.lookYaw) * Math.min(1, 8 * dt);
    let vx = Math.sin(P.yaw) * P.speed, vz = Math.cos(P.yaw) * P.speed, lungeV = 0;
    // lunge toward the target during the wind-up: scaled to the gap so punches connect, and the legs step it
    if (C.lungeT > 0 && C.target) {
      C.lungeT -= dt; const t = C.target.ch.position, d = Math.hypot(t.x - P.x, t.z - P.z);
      if (d > 1.0) lungeV = Math.min(4.0, (d - 0.95) / Math.max(dt, C.lungeT + dt));
      else if (d < 0.8) lungeV = -Math.min(2.5, (0.85 - d) / 0.1);   // too close: half a step back to throw it
      if (lungeV > 0) { const along = (vx * (t.x - P.x) + vz * (t.z - P.z)) / d; lungeV = Math.max(0, lungeV - Math.max(0, along)); }   // closing speed = max(carried, lunge)
      if (lungeV) { vx += (t.x - P.x) / d * lungeV; vz += (t.z - P.z) / d * lungeV; }
    }
    const ox = P.x, oz = P.z;
    if (P.climb) { // pulling out of the river onto the quay / jetty, or up a ledge
      const c = P.climb; c.t = Math.min(1, c.t + dt / c.dur); const u = c.t;
      P.y = c.y0 + (c.y1 - c.y0) * Math.min(1, u / 0.6); const f = Math.max(0, (u - 0.45) / 0.55);
      P.x = c.x0 + (c.x1 - c.x0) * f; P.z = c.z0 + (c.z1 - c.z0) * f; P.vy = 0;
      if (u >= 1) { P.climb = null; P.swimming = false; P.onGround = true; P.air = false; }
    } else {
      let nx = P.x + vx * dt, nz = P.z + vz * dt;
      // the river edge is solid on foot: slide along it instead of stepping off into the water
      const ok = (x, z) => walkable(x, z, P.y) && (P.swimming || groundAt(x, z, P.y).y - P.y < (P.air ? 0.3 : 0.45));   // and no teleporting up ledges
      if (!P.swimming && !ok(nx, nz)) {
        const g2 = groundAt(nx, nz, P.y);
        if (!g2.water && g2.y - P.y < 1.8 && (input.pressed('jump') || (P.ledgeT = (P.ledgeT || 0) + dt) > 0.3) && P.control) { // vault up the ledge
          P.climb = { t: 0, dur: 0.75, x0: P.x, z0: P.z, y0: P.y, x1: P.x + Math.sin(P.yaw) * 0.7, z1: P.z + Math.cos(P.yaw) * 0.7, y1: g2.y }; P.ledgeT = 0; nx = P.x; nz = P.z; P.speed = 0;
        } else if (ok(nx, P.z)) nz = P.z; else if (ok(P.x, nz)) nx = P.x; else { nx = P.x; nz = P.z; }
      } else P.ledgeT = 0;
      // swimming into a wall/edge: climb out where there is footing
      if (P.swimming && P.speed > 0.5 && P.control && !P.climb) {
        const lx = P.x + Math.sin(P.yaw) * 0.9, lz = P.z + Math.cos(P.yaw) * 0.9, g2 = groundAt(lx, lz, 5);
        if (!g2.water && g2.y < 4.2) { P.climb = { t: 0, dur: 0.9, x0: P.x, z0: P.z, y0: P.y, x1: P.x + Math.sin(P.yaw) * 1.1, z1: P.z + Math.cos(P.yaw) * 1.1, y1: g2.y }; P.speed = 0; }
      }
      if (!P.climb) { P.x = nx; P.z = nz; }
      const c = col.circleVsWorld(P.x, P.z, PLAYER.radius);
      if (c.hit && walkable(c.x, c.z, P.y)) { P.x = c.x; P.z = c.z; }
      // people and cars are solid: push apart; running into a walker shoves them
      const bd = P.bodies?.();
      if (bd) {
        for (const q of bd.peds) {
          if (!q.ch.root.visible) continue;
          if (q.ch.state !== 'ok') {   // a body on the ground: step round it, or stumble over it at speed
            const qp = q.ch.position, dx = P.x - qp.x, dz = P.z - qp.z, d = Math.hypot(dx, dz);
            if (d < 0.45 + PLAYER.radius && d > 1e-4) {
              if (P.speed > 2.5 && !(G.t - (q.stumbledBy ?? -9) < 1.5)) { q.stumbledBy = G.t; P.speed *= 0.7; ch.flinch(-Math.sin(P.yaw), -Math.cos(P.yaw), 0.6); P.stumbleT = 0.4; }
              if (P.speed > 1.2) {   // slide sideways round the body instead of pinning on it (half strength mid-stumble)
                const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw), side = Math.sign(dx * rx + dz * rz) || 1, pen = 0.45 + PLAYER.radius - d, k = P.stumbleT > 0 ? 0.4 : 0.8;
                P.x += rx * side * pen * k; P.z += rz * side * pen * k; } } 
            continue;
          }
          const qp = q.ch.position, dx = P.x - qp.x, dz = P.z - qp.z, d = Math.hypot(dx, dz), m = PLAYER.radius + 0.3;
          if (d < m && d > 1e-4) { const pen = m - d; P.x += dx / d * pen * 0.35; P.z += dz / d * pen * 0.35; qp.x -= dx / d * pen * 0.65; qp.z -= dz / d * pen * 0.65;
            if (P.speed > 2.2 && !q.fight && !((q.shoveT || 0) > G.t)) { P.onShove?.(q, -dx / d, -dz / d, P.speed); P.speed *= 0.6; } }
        }
        for (const v of bd.cars) {
          if (!v.K || v === P.vehicle) continue;
          const fx_ = Math.cos(v.h), fz_ = Math.sin(v.h), dx = P.x - v.x, dz = P.z - v.z, al = dx * fx_ + dz * fz_, sd = -dx * fz_ + dz * fx_;
          const hl = v.K.L / 2 + PLAYER.radius, hw = v.K.W / 2 + PLAYER.radius;
          if (Math.abs(al) < hl && Math.abs(sd) < hw) { const pa = hl - Math.abs(al), ps = hw - Math.abs(sd);
            if (pa < ps) { P.x += fx_ * Math.sign(al) * pa; P.z += fz_ * Math.sign(al) * pa; } else { P.x += -fz_ * Math.sign(sd) * ps; P.z += fx_ * Math.sign(sd) * ps; } }
        }
        if (!walkable(P.x, P.z, P.y)) { P.x = ox; P.z = oz; }
      }
      // ground / water
      const g = groundAt(P.x, P.z, P.y);
      if (input.pressed('jump') && P.onGround && !P.swimming && P.control && !atk && !P.climb) { P.vy = PLAYER.jump; P.onGround = false; P.air = true; }
      P.vy -= PLAYER.gravity * dt; P.y += P.vy * dt;
      if (g.water) {
        const wy = -0.55;   // swim at the surface (head and shoulders out)
        if (P.y <= wy) { if (!P.swimming) { P.swimming = true; P.onSplash?.(); } P.y = wy + Math.sin(G.t * 2.2) * 0.04; P.vy = 0; P.onGround = true; P.air = false; }
        else { P.onGround = false; P.air = true; }
      } else if (P.y <= g.y) {
        if (P.swimming) P.swimming = false;
        if (P.air) { ch.landT = 0; P.onLand?.(-P.vy); if (P.vy < -7) P.speed *= 0.6; }   // touchdown
        P.y = g.y; P.vy = 0; P.onGround = true; P.air = false;
      } else if (P.air || P.y - g.y > 0.05) { P.onGround = false; P.air = true; }
      else { P.y = g.y; P.onGround = true; }   // stepping down a kerb: stick to the ground
      // speed follows what actually happened (walls, edges, crowds): no running on the spot
      const real = Math.hypot(P.x - ox, P.z - oz) / Math.max(dt, 1e-4);
      if (ch.trans && real < P.speed * 0.4) { ch.stopTrans(0.15); P.speed = Math.max(real, P.speed - 14 * dt); P.blockedT = 0.3; }
      else if (!P.climb && real < P.speed * 0.5 && P.speed > 0.05 && !lungeV) P.speed = Math.max(real, P.speed - 14 * dt);
    }
    ch.airW += ((P.air && !P.swimming ? 1 : 0) - ch.airW) * Math.min(1, 10 * dt);
    ch.swimW += ((P.swimming && !P.climb ? 1 : 0) - ch.swimW) * Math.min(1, 4 * dt);
    // turning on the spot steps the feet (a slow walk cycle) instead of skating round on the idle pose
    const turnStep = P.speed < 0.6 && !P.swimming ? MathUtils.clamp(Math.abs(omega) * 0.35, 0, 0.9) : 0;
    const animWant = P.swimming ? 0.9 : Math.max(P.speed, turnStep, lungeV ? Math.min(Math.hypot(vx, vz), 3.0) : 0);
    P.animSpeed = (P.animSpeed ?? 0) + (animWant - (P.animSpeed ?? 0)) * Math.min(1, (animWant < (P.animSpeed ?? 0) && P.lungeWas && !lungeV ? 22 : 14) * dt); P.lungeWas = !!lungeV;
    ch.speed = P.animSpeed;
    ch.walkStyle = 'walk';
    ch.setHeading(P.yaw);
    ch.root.rotation.y = P.yaw;
    ch.root.position.x = P.x; ch.root.position.z = P.z;
    ch.update(dt, P.swimming ? P.y - 0.25 * ch.swimW : P.y);
    // footsteps: heel strike = a foot dropping to its own floor height (learned per foot, the ankle bone never
    // reaches the ground plane)
    ch.climbW = (ch.climbW || 0) + ((P.climb && !P.swimming ? 1 : P.climb ? 1 : 0) - (ch.climbW || 0)) * Math.min(1, 10 * dt);
    // ---- melee: lock-on toward the stick, lunge, jab → cross → hook combo, impact on the extension frame
    P.punchCD -= dt; C.comboT -= dt; C.guardT -= dt;
    ch.guardTarget = C.guardT > 0 ? 1 : 0;
    if (input.pressed('fire') && P.control && !P.swimming && !P.climb) { if (C.approach) C.approach.queued = (C.approach.queued || 0) + 1; else if (ch.atk || C.next != null) C.chain = Math.min(2, (C.chain || 0) + 1); else C.next = 0.3; }   // buffered press; mid-swing presses chain
    if (C.chain > 0 && C.next == null && !C.approach && (!ch.atk || ch.atk.t > 0.55)) { C.next = 0.25; C.chain--; }
    if (C.chain > 0 && C.focus && C.focus.ch.state !== 'ok' && !ch.atk) C.chain = 0;   // target down: no punches at air
    if (C.next != null) { C.next -= dt; if (C.next < 0) C.next = null; }
    if (C.next != null && !C.approach && (!atk || atk.t > 0.62)) {
      if (C.comboT <= 0) C.combo = 0;
      const kind = ['jab', 'cross', 'hook'][C.combo % 3], side = kind === 'cross' ? 'R' : 'L';
      const aimYaw = want > 0.2 ? P.moveYaw : P.yaw;
      const tp = P.lockQuery(aimYaw);
      if (tp && Math.hypot(tp.ch.position.x - P.x, tp.ch.position.z - P.z) > 1.9 && !C.approach && C.comboT <= 0) { C.approach = { q: tp, t: 0.8 }; C.focus = tp; C.next = null; }
    }
    if (C.next != null && !C.approach && (!atk || atk.t > 0.62)) {
      if (C.comboT <= 0) C.combo = 0;
      const kind = ['jab', 'cross', 'hook'][C.combo % 3], side = kind === 'cross' ? 'R' : 'L';
      const aimYaw = want > 0.2 ? P.moveYaw : P.yaw;
      const tp = P.lockQuery(aimYaw);
      const headOf = (q) => () => { const hb = q.ch.bones.Bip01_Head; return hb ? hb.getWorldPosition(_hv) : null; };
      const dT = tp ? Math.hypot(tp.ch.position.x - P.x, tp.ch.position.z - P.z) : 0, ext = MathUtils.clamp((dT - 1.1) / 6.5, 0, 0.32);   // impact waits for the lunge
      if (ch.attack(side, { dur: (kind === 'jab' ? 0.4 : kind === 'cross' ? 0.48 : 0.56) + ext * 2.2, kind, target: tp ? headOf(tp) : null })) {
        if (tp) C.focus = tp;
        C.next = null; C.target = tp; C.hit = false; C.kind = kind; C.lungeT = tp ? MathUtils.clamp((dT - 0.95) / 3.2, 0.12, 0.3) : 0; C.combo++; C.comboT = 0.9; C.guardT = 2.6;
        P.onPunch?.('swing', kind);
      }
    }
    if (ch.atk && !C.hit && ch.atk.t >= 0.4) {
      C.hit = true;
      const t = C.target;
      if (t && t.ch.state === 'ok') {
        const d = Math.hypot(t.ch.position.x - P.x, t.ch.position.z - P.z);
        const ang = Math.abs(MathUtils.euclideanModulo(Math.atan2(t.ch.position.x - P.x, t.ch.position.z - P.z) - P.yaw + Math.PI, Math.PI * 2) - Math.PI);
        if (d < 1.6 && ang < 0.9) P.onPunch?.('hit', C.kind, t);
      }
    }
    if (!ch.atk) C.target = null;
    if (C.guardT <= 0 || (C.focus && (C.focus.ch.state !== 'ok' || C.focus.state === 'flee' || Math.hypot(C.focus.ch.position.x - P.x, C.focus.ch.position.z - P.z) > 5))) C.focus = null;
  };
  const _hv = new Vector3(), _fv = new Vector3(); P.foot = { l: 0, r: 0 }; P.floor = { l: 1, r: 1 }; P.armed = { l: false, r: false };

  // ---------------------------------------------------------------- camera
  P.updateCamera = (dt, mode) => {
    const look = P.control ? 1 : 0.2;
    P.camYaw -= input.lookX * look; P.camPitch = MathUtils.clamp(P.camPitch + input.lookY * look, -0.35, 1.1);
    let tx, ty, tz, dist, height, fov = PLAYER.fov;
    if (mode === 'foot') {
      tx = P.x; tz = P.z; ty = P.y + (P.swimming ? 0.6 : 1.55);
      // GTA-style recentre: when moving with no camera input for a moment, ease round behind the player (faster on
      // touch, where steering with one thumb would otherwise run the player off the side of the screen)
      P.idleLookFoot = Math.abs(input.lookX) + Math.abs(input.lookY) > 0.0005 ? 0 : (P.idleLookFoot || 0) + dt;
      if ((input.mode === 'touch' || input.mode === 'pad') && P.idleLookFoot > 0.8 && P.speed > 1.0 && !P.combat.focus && !P.swimming && Math.abs(input.move.x) < 0.35 * input.move.y && Math.abs(P.yawRate) < 1.0) {
        const behind = P.yaw + Math.PI, d = MathUtils.euclideanModulo(behind - P.camYaw + Math.PI, Math.PI * 2) - Math.PI;
        P.camYaw += d * Math.min(1, 0.9 * dt * Math.min(1, P.speed / 3));
      }
      dist = PLAYER.camDist * (P.swimming ? 1.1 : 1); height = -0.05;
      fov += Math.min(8, Math.max(0, P.speed - 4) * 2.2);
    } else {
      const v = P.vehicle;
      tx = v.x; tz = v.z; ty = v.y + (v.kind === 'ferry' ? 4.8 : v.kind === 'policeboat' ? 2.5 : 1.4);
      dist = v.kind === 'ferry' ? PLAYER.camFerryDist : v.kind === 'policeboat' ? 12 : PLAYER.camVehicleDist;
      height = v.kind === 'ferry' ? 4 : 1.2;
      // auto-recentre behind the vehicle when the mouse is idle
      const behind = Math.PI / 2 - v.h + Math.PI;
      P.idleLook = Math.abs(input.lookX) + Math.abs(input.lookY) > 0.0005 ? 0 : (P.idleLook || 0) + dt;
      if (P.idleLook > 1.2 && Math.abs(v.speed) > 2) {
        const d = MathUtils.euclideanModulo(behind - P.camYaw + Math.PI, Math.PI * 2) - Math.PI;
        P.camYaw += d * Math.min(1, 2.5 * dt);
        P.camPitch += (0.16 - P.camPitch) * Math.min(1, 1.5 * dt);
      }
      fov += Math.min(14, Math.abs(v.speed) * 0.35);
    }
    // melee framing: aim between the player and the opponent, swing round so neither hides the other
    const F = mode === 'foot' ? P.combat.focus : null;
    P.fightK = MathUtils.clamp((P.fightK || 0) + (F ? dt / 0.35 : -dt / 0.8), 0, 1);
    if (F) { const fp = F.ch.position, fy = Math.atan2(fp.x - P.x, fp.z - P.z) + Math.PI + 0.55, d = MathUtils.euclideanModulo(fy - P.camYaw + Math.PI, Math.PI * 2) - Math.PI;
      if (Math.abs(input.lookX) < 0.0005) P.camYaw += MathUtils.clamp(d * 2.5, -1.5, 1.5) * dt; tx += (fp.x - tx) * 0.4 * P.fightK; tz += (fp.z - tz) * 0.4 * P.fightK; }
    if (mode === 'foot') dist = MathUtils.lerp(dist, Math.max(3.4, dist * 0.85), P.fightK);   // fight framing: in close
    const cyaw = P.camYaw, cp = P.camPitch;
    // shoulder offset to the right on foot
    const right = mode === 'foot' ? 0.45 + 0.35 * P.fightK : 0;
    const rx = Math.cos(cyaw) * right, rz = -Math.sin(cyaw) * right;
    _t.set(tx + rx * 0, ty, tz);
    let cx = tx + Math.sin(cyaw) * Math.cos(cp) * dist + rx, cz = tz + Math.cos(cyaw) * Math.cos(cp) * dist + rz;
    let cy = ty + Math.sin(cp) * dist + height;
    // collision pull-in against buildings (2D segment test) and the ground
    const f = col.segment(tx, tz, cx, cz, 1e9, cy);
    if (f < 1) {
      // keep 0.35 m off the wall; when squeezed closer than 1.4 m, rise and look over the head instead of into it
      const fc = Math.max(0, f - 0.35 / dist); cx = tx + (cx - tx) * fc; cz = tz + (cz - tz) * fc;
      const d = fc * dist; if (d < 1.4) cy += (1.4 - d) * 0.9;
    }
    const gg = groundAt(cx, cz, cy), gy = gg.water ? 0.25 : gg.y; if (cy < gy + 0.5) cy = gy + 0.5;
    _v.set(cx, cy, cz);
    const k = Math.min(1, (mode === 'foot' ? 14 : 8) * dt);
    if (P.camPos.lengthSq() === 0) P.camPos.copy(_v);
    P.camPos.lerp(_v, k);
    P.camTarget.lerp(_t.set(tx + rx * 1.35, ty, tz + rz * 1.35), Math.min(1, 16 * dt));   // aim past the shoulder: player sits just left of centre
    if (P.camTarget.lengthSq() === 0) P.camTarget.set(tx, ty, tz);
    G.camera.position.copy(P.camPos);
    G.camera.lookAt(P.camTarget);
    if (P.shake > 0.002) { // impact kick: a short, damped jolt (rotation, not translation, so walls never clip)
      const t = G.t * 38, a = P.shake * 0.022;
      G.camera.rotateX(Math.sin(t) * a); G.camera.rotateY(Math.sin(t * 1.31 + 1.7) * a * 0.8); G.camera.rotateZ(Math.sin(t * 0.77 + 0.4) * a * 0.5);
      P.shake *= Math.exp(-dt * 9);
    }
    G.camera.fov += (fov - G.camera.fov) * Math.min(1, 3 * dt);
    G.camera.updateProjectionMatrix();
  };
  return P;
}
