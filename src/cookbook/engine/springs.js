// Damped springs for game feel (weapon sway/recoil, camera bob, UI motion), integrated in fixed sub-steps so they
// behave the same at 30, 60 or 144 fps and never explode on a long frame.
//
//   const kick = new Spring(520, 30);          // stiffness k (1/s²), damping c (1/s)  — tested weapon spring values:
//   kick.impulse(1.5);                         //   recoil z (520,30) pitch (380,26) yaw (300,22) roll (300,20)
//   kick.update(dt); mesh.position.z = kick.x; //   sway (110,15) jump/land (140,13) bump (600,30)
//   const sway = new Spring3(110, 15);  sway.target.set(lookX, lookY, 0); sway.update(dt); // vector version
//   Spring.fromFreq(2.5, 0.6)                  // or by feel: 2.5 Hz natural frequency, damping ratio 0.6
//
// Critically damped means c = 2*sqrt(k). c < 2√k overshoots (bouncy), c > 2√k is sluggish.
// All methods are allocation-free.
import { Vector3 } from 'three';

export const SUBSTEP = 1 / 125; // 8 ms

export class Spring {
  constructor(k = 300, c = 20, x = 0) { this.k = k; this.c = c; this.x = x; this.v = 0; this.target = x; }
  static fromFreq(hz, zeta = 1, x = 0) { const w = 2 * Math.PI * hz; return new Spring(w * w, 2 * zeta * w, x); }
  impulse(dv) { this.v += dv; return this; }           // add velocity (recoil kick)
  set(x) { this.x = x; this.v = 0; this.target = x; return this; } // snap, no motion
  update(dt) {
    // semi-implicit Euler in ≤8 ms sub-steps; dt clamped so a 2 s stall cannot inject energy
    let rem = Math.min(dt, 0.1);
    while (rem > 1e-6) {
      const h = Math.min(SUBSTEP, rem);
      this.v += (-this.k * (this.x - this.target) - this.c * this.v) * h;
      this.x += this.v * h;
      rem -= h;
    }
    return this.x;
  }
  get settled() { return Math.abs(this.x - this.target) < 1e-4 && Math.abs(this.v) < 1e-3; }
}

export class Spring3 {
  constructor(k = 300, c = 20) { this.k = k; this.c = c; this.x = new Vector3(); this.v = new Vector3(); this.target = new Vector3(); }
  static fromFreq(hz, zeta = 1) { const w = 2 * Math.PI * hz; return new Spring3(w * w, 2 * zeta * w); }
  impulse(dx, dy, dz) { this.v.x += dx; this.v.y += dy; this.v.z += dz; return this; }
  set(x, y, z) { this.x.set(x, y, z); this.target.set(x, y, z); this.v.set(0, 0, 0); return this; }
  update(dt) {
    const k = this.k, c = this.c, x = this.x, v = this.v, t = this.target;
    let rem = Math.min(dt, 0.1);
    while (rem > 1e-6) {
      const h = Math.min(SUBSTEP, rem);
      v.x += (-k * (x.x - t.x) - c * v.x) * h; v.y += (-k * (x.y - t.y) - c * v.y) * h; v.z += (-k * (x.z - t.z) - c * v.z) * h;
      x.x += v.x * h; x.y += v.y * h; x.z += v.z * h;
      rem -= h;
    }
    return x;
  }
}

// Frame-rate independent exponential smoothing: move `a` toward `b`, closing (1 - e^-λdt) of the gap.
// λ ≈ 1/time-constant; λ = 10 closes 63% in 0.1 s. Use for camera follow, FOV, exposure, volume fades.
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export function dampV3(a, b, lambda, dt) { return a.lerp(b, 1 - Math.exp(-lambda * dt)); }
// Angle version: shortest way round (radians).
export function dampAngle(a, b, lambda, dt) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-lambda * dt));
}

// Quintic smootherstep (C2 continuous) — for keyframed motion (reloads, door opens, camera moves).
export const smoother = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));
