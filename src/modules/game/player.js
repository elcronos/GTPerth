// Player: on-foot third-person controller (camera-relative movement, walk/run/sprint, jump, swim, punch), the
// GTA-style orbit camera (shoulder offset, collision pull-in, speed FOV, look-behind) and vehicle control mapping.
import { Vector3, MathUtils } from 'three';
import { PLAYER } from '../../contracts.js';
import { heightAt, isLand, PROMENADE_Y } from '../../map.js';
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
  return { y: -1.15, water: true };
}

export function createPlayer(G, { avatars, input, col, hud }) {
  const inst = avatars.instance('Female_Adult_12');
  const ch = new Character(G, inst);
  G.scene.add(ch.root);
  const P = {
    ch, x: PLAYER.spawn[0], z: PLAYER.spawn[2], y: PLAYER.spawn[1], vy: 0, yaw: PLAYER.spawnYaw, moveYaw: PLAYER.spawnYaw,
    camYaw: PLAYER.spawnYaw + Math.PI, camPitch: 0.12, camDist: PLAYER.camDist, health: 100, armour: 0, stamina: 1,
    vehicle: null, swimming: false, onGround: true, speed: 0, cash: 0, dead: false, busted: false, control: true,
    camPos: new Vector3(), camTarget: new Vector3(), fovKick: 0, lookBehind: false, punchCD: 0,
  };
  ch.root.position.set(P.x, P.y, P.z);
  P.teleport = (x, z, yaw) => { P.x = x; P.z = z; P.y = groundAt(x, z).y; P.vy = 0; P.yaw = P.moveYaw = yaw; P.camYaw = yaw + Math.PI; ch.root.position.set(P.x, P.y, P.z); ch.setHeading(yaw); ch.state = 'ok'; ch.fall = null; ch.body.quaternion.identity(); ch.body.position.set(0, 0, 0); };
  P.teleport(P.x, P.z, P.yaw);

  P.updateOnFoot = (dt) => {
    const mv = input.move; // x strafe, y forward
    const want = P.control && !P.dead ? Math.min(1, Math.hypot(mv.x, mv.y)) : 0;
    const sprint = input.down('sprint') && P.stamina > 0.05;
    let target = 0;
    if (want > 0.05) {
      // camera-relative direction (camera looks along camYaw+π)
      const fwdYaw = P.camYaw + Math.PI;
      const dirYaw = fwdYaw + Math.atan2(mv.x, mv.y);
      P.moveYaw = dirYaw;
      target = P.swimming ? 1.6 : sprint ? PLAYER.sprint : want > 0.7 ? PLAYER.run : PLAYER.walk + (PLAYER.run - PLAYER.walk) * (want - 0.2) / 0.5;
    }
    P.stamina = MathUtils.clamp(P.stamina + (sprint && want > 0.05 ? -0.12 : 0.18) * dt, 0, 1);
    P.speed += (target - P.speed) * Math.min(1, (target > P.speed ? 6 : 9) * dt);
    // turn the body toward movement direction
    let dy = MathUtils.euclideanModulo(P.moveYaw - P.yaw + Math.PI, Math.PI * 2) - Math.PI;
    P.yaw += dy * Math.min(1, PLAYER.turn * dt);
    const vx = Math.sin(P.yaw) * P.speed, vz = Math.cos(P.yaw) * P.speed;
    P.x += vx * dt; P.z += vz * dt;
    const c = col.circleVsWorld(P.x, P.z, PLAYER.radius);
    if (c.hit) { P.x = c.x; P.z = c.z; }
    // ground / water
    const g = groundAt(P.x, P.z, P.y);
    if (input.pressed('jump') && P.onGround && !P.swimming && P.control) { P.vy = PLAYER.jump; P.onGround = false; }
    P.vy -= PLAYER.gravity * dt; P.y += P.vy * dt;
    if (g.water) {
      if (P.y <= -1.15) { if (!P.swimming) { P.swimming = true; P.onSplash?.(); } P.y = -1.15 + Math.sin(G.t * 2) * 0.03; P.vy = 0; P.onGround = true; }
      else P.onGround = false;
    } else {
      // climbing out of the water: allowed where the quay is low enough (ladders/steps)
      if (P.swimming && g.y - P.y > 2.0) { P.x -= vx * dt * 1.05; P.z -= vz * dt * 1.05; }
      else if (P.y <= g.y) { if (P.swimming) P.swimming = false; P.y = g.y; P.vy = 0; P.onGround = true; }
      else P.onGround = P.y - g.y < 0.05;
    }
    ch.speed = P.speed * (P.swimming ? 0.7 : 1);
    ch.walkStyle = 'walk';
    ch.setHeading(P.yaw);
    ch.root.rotation.y = P.yaw;
    ch.root.position.x = P.x; ch.root.position.z = P.z;
    ch.update(dt, P.y);
    // punch
    P.punchCD -= dt;
    if (input.pressed('fire') && P.control && !P.swimming && P.punchCD <= 0 && ch.punch()) { P.punchCD = 0.45; P.onPunch?.(); }
  };

  // ---------------------------------------------------------------- camera
  P.updateCamera = (dt, mode) => {
    const look = P.control ? 1 : 0.2;
    P.camYaw -= input.lookX * look; P.camPitch = MathUtils.clamp(P.camPitch + input.lookY * look, -0.35, 1.1);
    let tx, ty, tz, dist, height, fov = PLAYER.fov;
    if (mode === 'foot') {
      tx = P.x; tz = P.z; ty = P.y + (P.swimming ? 0.6 : 1.55);
      dist = PLAYER.camDist * (P.swimming ? 1.1 : 1); height = 0.25;
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
    const cyaw = P.camYaw, cp = P.camPitch;
    // shoulder offset to the right on foot
    const right = mode === 'foot' ? 0.45 : 0;
    const rx = Math.cos(cyaw) * right, rz = -Math.sin(cyaw) * right;
    _t.set(tx + rx * 0, ty, tz);
    let cx = tx + Math.sin(cyaw) * Math.cos(cp) * dist + rx, cz = tz + Math.cos(cyaw) * Math.cos(cp) * dist + rz;
    let cy = ty + Math.sin(cp) * dist + height;
    // collision pull-in against buildings (2D segment test) and the ground
    const f = col.segment(tx, tz, cx, cz, 1e9, cy);
    if (f < 1) { cx = tx + (cx - tx) * f; cz = tz + (cz - tz) * f; }
    const gy = groundAt(cx, cz, cy).y; if (cy < gy + 0.5) cy = gy + 0.5;
    _v.set(cx, cy, cz);
    const k = Math.min(1, (mode === 'foot' ? 14 : 8) * dt);
    if (P.camPos.lengthSq() === 0) P.camPos.copy(_v);
    P.camPos.lerp(_v, k);
    P.camTarget.lerp(_t.set(tx + rx, ty, tz + rz), Math.min(1, 16 * dt));
    if (P.camTarget.lengthSq() === 0) P.camTarget.set(tx, ty, tz);
    G.camera.position.copy(P.camPos);
    G.camera.lookAt(P.camTarget);
    G.camera.fov += (fov - G.camera.fov) * Math.min(1, 3 * dt);
    G.camera.updateProjectionMatrix();
  };
  return P;
}
