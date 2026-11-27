// First-person player: input (engine/input.js) → yaw/pitch, accelerated walk/sprint/crouch, jump, gravity,
// circle-vs-AABB collision against world colliders, spring-driven head bob + landing dip (engine/springs.js).
//   create(G, { input, colliders }) → { update, position, yaw, pitch, teleport(pos, yaw), velocity, grounded }
// Respects G.camLocked (captures/bench own the camera) and G.paused. Allocation-free update.
import { Vector3, Euler } from 'three';
import { Spring, damp } from '../cookbook/engine/springs.js';
import { PLAYER as P, WORLD } from '../contracts.js';

export function create(G, { input, colliders = [] }) {
  const pos = new Vector3().fromArray(P.spawn), vel = new Vector3(), wish = new Vector3();
  const e = new Euler(0, 0, 0, 'YXZ');
  const S = { position: pos, velocity: vel, yaw: P.spawnYaw, pitch: 0, grounded: true, eye: P.eye, enabled: true };
  const bob = new Spring(140, 13), land = new Spring(140, 13);
  let phase = 0, wasGrounded = true;

  function collide() {
    const r = P.radius;
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (pos.y + P.height < b.min.y || pos.y > b.max.y - 0.35) {
        // standing on top (step-up 35 cm)
        if (pos.y <= b.max.y && pos.y > b.max.y - 0.35 && pos.x > b.min.x - r * 0.5 && pos.x < b.max.x + r * 0.5 && pos.z > b.min.z - r * 0.5 && pos.z < b.max.z + r * 0.5 && vel.y <= 0) {
          pos.y = b.max.y; vel.y = 0; S.grounded = true;
        }
        continue;
      }
      const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x)), cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
      const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), push = (r - d) / d; pos.x += dx * push; pos.z += dz * push; }
      else { // centre inside the box: push out along the shallowest axis
        const ox = Math.min(pos.x - b.min.x, b.max.x - pos.x), oz = Math.min(pos.z - b.min.z, b.max.z - pos.z);
        if (ox < oz) pos.x = pos.x - b.min.x < b.max.x - pos.x ? b.min.x - r : b.max.x + r; else pos.z = pos.z - b.min.z < b.max.z - pos.z ? b.min.z - r : b.max.z + r;
      }
    }
  }

  S.update = (dt) => {
    if (!S.enabled || G.paused) return;
    S.yaw -= input.lookX; S.pitch = Math.max(-1.5, Math.min(1.5, S.pitch - input.lookY));
    const crouch = input.down('crouch'), sprint = input.down('sprint') && !crouch && input.move.y > 0.2;
    const speed = crouch ? P.crouch : sprint ? P.sprint : P.walk;
    const sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
    wish.set(input.move.x * cy - input.move.y * sy, 0, -input.move.x * sy - input.move.y * cy).multiplyScalar(speed);
    const a = S.grounded ? P.accel : P.airAccel;
    vel.x = damp(vel.x, wish.x, a / Math.max(1, speed), dt); vel.z = damp(vel.z, wish.z, a / Math.max(1, speed), dt);
    if (S.grounded && input.pressed('jump')) { vel.y = P.jump; S.grounded = false; }
    vel.y -= P.gravity * dt;
    pos.addScaledVector(vel, dt);
    S.grounded = false;
    if (pos.y <= WORLD.groundY) { pos.y = WORLD.groundY; vel.y = 0; S.grounded = true; }
    collide();
    pos.x = Math.max(WORLD.min[0], Math.min(WORLD.max[0], pos.x)); pos.z = Math.max(WORLD.min[2], Math.min(WORLD.max[2], pos.z));
    if (S.grounded && !wasGrounded) land.impulse(-2.2);
    wasGrounded = S.grounded;
    // head bob (phase rate grows with speed) + landing dip, both springs → no pops
    const hs = Math.hypot(vel.x, vel.z);
    phase += dt * (5.2 + 1.55 * hs) * (S.grounded && hs > 0.5 ? 1 : 0);
    bob.target = S.grounded ? Math.sin(phase * 2) * 0.035 * Math.min(1, hs / P.walk) : 0;
    bob.update(dt); land.update(dt);
    S.eye = damp(S.eye, crouch ? P.crouchEye : P.eye, 12, dt);
    if (G.camLocked) return;
    G.camera.position.set(pos.x, pos.y + S.eye + bob.x + land.x * 0.1, pos.z);
    e.set(S.pitch, S.yaw, Math.sin(phase) * 0.004 * Math.min(1, hs / P.walk));
    G.camera.quaternion.setFromEuler(e);
  };
  S.teleport = (p, yaw = S.yaw) => { pos.fromArray(p); vel.set(0, 0, 0); S.yaw = yaw; S.pitch = 0; };
  return S;
}
