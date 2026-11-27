// A walking, running, falling human: AnimationMixer locomotion blend (idle/walk/run/sprint by speed, time-scaled to
// the ground speed so feet don't skate), one-shot gestures (phone, photo, wave, cower), a procedural knock-down
// (fling arc → sprawled pose with limbs splayed → optional get-up) and a procedural punch.
import { AnimationMixer, LoopRepeat, LoopOnce, Group, Vector3, Quaternion, Euler, MathUtils } from 'three';

const CLIP_SPEED = { walk: 1.42, stroll: 1.05, run: 3.7, sprint: 6.0 };
const _q = new Quaternion(), _e = new Euler(), _v = new Vector3(), _w = new Vector3();
const LOCO = ['walk', 'stroll', 'run', 'sprint'];
// Foot phase of a locomotion clip: normalized time of the left heel strike (left foot furthest ahead of the right),
// so walk/run/sprint can be blended in step instead of scissoring. Measured once per clip on the instance skeleton.
const PHASE = new WeakMap();
let _axis = null;
function footPhase(obj, clip, bones) {
  if (PHASE.has(clip)) return PHASE.get(clip);
  const L = bones.Bip01_L_Foot, R = bones.Bip01_R_Foot, H = bones.Bip01;
  if (!L || !R || !H) { PHASE.set(clip, 0); return 0; }
  const m = new AnimationMixer(obj), a = m.clipAction(clip); a.play();
  const N = 40, d = [];
  for (let i = 0; i < N; i++) {
    m.setTime((i / N) * clip.duration); obj.updateMatrixWorld(true);
    L.getWorldPosition(_v); R.getWorldPosition(_w); obj.worldToLocal(_v); obj.worldToLocal(_w);
    d.push([_v.x - _w.x, _v.z - _w.z]);
  }
  if (!_axis) { // principal axis of the left-right foot separation (same skeleton for every clip, so one axis)
    let xx = 0, zz = 0, xz = 0; for (const [x, z] of d) { xx += x * x; zz += z * z; xz += x * z; }
    const t = 0.5 * Math.atan2(2 * xz, xx - zz); _axis = [Math.cos(t), Math.sin(t)];
  }
  let best = -1e9, bi = 0; d.forEach(([x, z], i) => { const p = x * _axis[0] + z * _axis[1]; if (p > best) { best = p; bi = i; } });
  a.stop(); m.uncacheRoot(obj);
  const ph = bi / N; PHASE.set(clip, ph); return ph;
}

export class Character {
  constructor(G, inst, { scale = 1 } = {}) {
    this.G = G; this.inst = inst;
    this.root = new Group();                 // world transform (position on the ground, heading)
    this.body = new Group();                 // local tilt for falls
    this.root.add(this.body); this.body.add(inst.obj);
    inst.obj.scale.multiplyScalar(scale);
    this.mixer = new AnimationMixer(inst.obj);
    this.clips = inst.clips;
    this.act = {};
    for (const k of ['idle', 'walk', 'run', 'sprint', 'stroll']) if (this.clips[k]) {
      const a = this.mixer.clipAction(this.clips[k]); a.setLoop(LoopRepeat, Infinity); a.enabled = true; a.setEffectiveWeight(0); a.play(); this.act[k] = a;
    }
    if (!this.act.stroll) this.act.stroll = this.act.walk;
    this.bones0 = {}; inst.obj.traverse((o) => { if (o.isBone) this.bones0[o.name] = o; });
    this.ph = {}; for (const k of LOCO) if (this.act[k]) this.ph[k] = footPhase(inst.obj, this.act[k].getClip(), this.bones0);
    this.lean = { roll: 0, pitch: 0 };
    this.act.idle?.setEffectiveWeight(1);
    this.speed = 0; this.heading = 0; this.state = 'ok';   // ok | down | dead
    this.gesture = null; this.gestureT = 0;
    this.downT = 0; this.fall = null; this.punchT = 1;
    this.bones = {};
    inst.obj.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.walkStyle = 'walk';
    this.phase = Math.random() * 10;
    this.mixer.update(this.phase);
  }
  get position() { return this.root.position; }
  setHeading(h) { this.heading = h; this.root.rotation.y = h; }
  playGesture(name, loop = true) {
    if (!this.clips[name]) return;
    if (this.gesture?.name === name) return;
    this.stopGesture();
    const a = this.mixer.clipAction(this.clips[name]); a.reset(); a.setLoop(loop ? LoopRepeat : LoopOnce, Infinity); a.clampWhenFinished = !loop;
    a.setEffectiveWeight(1); a.fadeIn(0.35); a.play(); this.gesture = { name, a };
  }
  stopGesture() { if (this.gesture) { this.gesture.a.fadeOut(0.3); this.gesture = null; } }
  punch() { if (this.punchT >= 1 && this.state === 'ok') { this.punchT = 0; return true; } return false; }
  // impulse: {x,z} m/s of the hit; severity 0..1 (1 = killed)
  knockDown(ix, iz, severity = 0.6) {
    if (this.state !== 'ok') { if (this.fall) { this.fall.vx += ix * 0.4; this.fall.vz += iz * 0.4; } return false; }
    this.stopGesture();
    const sp = Math.hypot(ix, iz) || 1;
    this.state = 'down'; this.downT = 0;
    this.fall = { vx: ix, vz: iz, vy: Math.min(6, 1.2 + sp * 0.32), y: 0, t: 0, axisX: -iz / sp, axisZ: ix / sp, spin: (Math.random() - 0.5) * 6, rot: 0, dead: severity >= 1 || sp > 15, side: Math.random() < 0.5 ? 1 : -1 };
    this.speed = 0;
    return true;
  }
  getUp() { if (this.state === 'down' && this.fall && !this.fall.dead) { this.fall.getUp = 0; } }
  update(dt, groundY) {
    const G = this.G;
    if (this.state === 'ok') {
      // locomotion weights by speed
      const v = this.speed;
      const style = this.walkStyle;
      const wIdle = MathUtils.clamp(1 - v / 0.6, 0, 1);
      let wWalk = 0, wRun = 0, wSpr = 0;
      if (v < 2.6) wWalk = 1 - wIdle; else if (v < 4.6) { const t = (v - 2.6) / 2.0; wWalk = 1 - t; wRun = t; } else { const t = MathUtils.clamp((v - 4.6) / 1.4, 0, 1); wRun = 1 - t; wSpr = t; }
      if (v >= 2.6 && v < 4.6) { /* already */ }
      const g = this.gesture ? 0.0 : 1;
      this.act.idle?.setEffectiveWeight(wIdle * g + (this.gesture ? 0 : 0));
      const walkA = style === 'stroll' ? this.act.stroll : this.act.walk;
      const otherW = style === 'stroll' ? this.act.walk : this.act.stroll;
      if (otherW && otherW !== walkA) otherW.setEffectiveWeight(0);
      walkA?.setEffectiveWeight(wWalk);
      this.act.run?.setEffectiveWeight(wRun);
      this.act.sprint?.setEffectiveWeight(wSpr);
      if (this.gesture) { for (const k of ['walk', 'run', 'sprint', 'stroll']) this.act[k]?.setEffectiveWeight(0); this.act.idle?.setEffectiveWeight(0); }
      // time-scale clips to ground speed
      const ws = style === 'stroll' ? CLIP_SPEED.stroll : CLIP_SPEED.walk;
      if (walkA) walkA.timeScale = v > 0.05 ? MathUtils.clamp(v / ws, 0.5, 1.6) : 1;
      if (this.act.run) this.act.run.timeScale = MathUtils.clamp(v / CLIP_SPEED.run, 0.7, 1.4);
      if (this.act.sprint) this.act.sprint.timeScale = MathUtils.clamp(v / CLIP_SPEED.sprint, 0.8, 1.3);
      // keep every locomotion clip in step with the dominant one (feet hit the ground together across the blend)
      let lead = null, lw = 0.02;
      for (const k of LOCO) { const a = this.act[k]; if (a && a.getEffectiveWeight() > lw) { lw = a.getEffectiveWeight(); lead = k; } }
      this.mixer.update(dt);
      if (lead && !this.gesture) {
        const A = this.act[lead], dur = A.getClip().duration;
        const phase = ((A.time / dur - this.ph[lead]) % 1 + 1) % 1;
        for (const k of LOCO) { const a = this.act[k]; if (!a || k === lead || a === A) continue; const d2 = a.getClip().duration; a.time = ((phase + this.ph[k]) % 1) * d2; }
      }
      this.root.position.y = groundY;
      this.body.rotation.set(this.lean.pitch, 0, this.lean.roll); this.body.position.set(0, 0, 0);
      this.inst.obj.rotation.set(0, 0, 0);
      this.applyPunch(dt);
    } else {
      // fall: ballistic arc + tip over onto the back/side, then lie sprawled
      const f = this.fall;
      this.mixer.update(dt * 0.15);
      f.t += dt;
      if (f.getUp !== undefined) {
        f.getUp += dt;
        const k = MathUtils.clamp(f.getUp / 1.1, 0, 1), e = k * k * (3 - 2 * k);
        this.body.quaternion.copy(f.restQ || this.body.quaternion).slerp(_q.identity(), e);
        this.body.position.y = (1 - e) * 0.12;
        this.sprawl(1 - e);
        if (k >= 1) { this.state = 'ok'; this.fall = null; this.body.quaternion.identity(); this.body.position.set(0, 0, 0); this.recoverT = 0; }
        this.root.position.y = groundY;
        return;
      }
      const air = f.y > 0 || f.vy > 0;
      if (air) { f.vy -= 18 * dt; f.y = Math.max(0, f.y + f.vy * dt); if (f.y === 0 && f.vy < 0) { f.vy = 0; } }
      const drag = air ? 0.2 : 4.5;
      f.vx -= f.vx * Math.min(1, drag * dt); f.vz -= f.vz * Math.min(1, drag * dt);
      this.root.position.x += f.vx * dt; this.root.position.z += f.vz * dt;
      this.root.position.y = groundY + f.y;
      f.rot = Math.min(Math.PI / 2, f.rot + dt * 5.5);
      // tip over: rotate the body around the horizontal axis perpendicular to the hit, pivoting at the feet
      _v.set(f.axisX, 0, f.axisZ);
      // axis is in world space; convert to root-local (root has heading)
      _v.applyAxisAngle(new Vector3(0, 1, 0), -this.root.rotation.y);
      this.body.quaternion.setFromAxisAngle(_v, f.rot);
      _q.setFromAxisAngle(new Vector3(0, 1, 0), f.spin * Math.min(1, f.t) * 0.3);
      this.body.quaternion.premultiply(_q);
      this.body.position.y = 0.12 * Math.min(1, f.rot / (Math.PI / 2));
      f.restQ = this.body.quaternion.clone();
      this.sprawl(Math.min(1, f.t * 3));
      this.downT += dt;
      if (!f.dead && this.downT > 4.5 && !air) this.getUp();
    }
  }
  sprawl(k) {
    if (k <= 0) return;
    const B = this.bones, s = this.fall ? this.fall.side : 1;
    const rot = (n, x, y, z) => { const b = B[n]; if (!b) return; _e.set(x * k, y * k, z * k); _q.setFromEuler(_e); b.quaternion.multiply(_q); };
    rot('Bip01_L_UpperArm', 0, -0.9 * s, 0.6); rot('Bip01_R_UpperArm', 0, 0.9 * s, -0.6);
    rot('Bip01_L_Forearm', 0, -0.6, 0); rot('Bip01_R_Forearm', 0, 0.6, 0);
    rot('Bip01_L_Thigh', 0.25, 0, 0.25 * s); rot('Bip01_R_Thigh', -0.15, 0, -0.35 * s);
    rot('Bip01_L_Calf', 0, 0, -0.6); rot('Bip01_R_Calf', 0, 0, -0.25);
    rot('Bip01_Head', 0.3 * s, 0, 0.2);
  }
  applyPunch(dt) {
    if (this.punchT >= 1) return;
    this.punchT = Math.min(1, this.punchT + dt * 3.2);
    const k = Math.sin(this.punchT * Math.PI);
    const B = this.bones;
    const rot = (n, x, y, z) => { const b = B[n]; if (!b) return; _e.set(x * k, y * k, z * k); _q.setFromEuler(_e); b.quaternion.multiply(_q); };
    rot('Bip01_R_UpperArm', 0, -1.1, -0.9); rot('Bip01_R_Forearm', 0, 1.2, 0); rot('Bip01_Spine1', 0, 0, 0); rot('Bip01_Spine', 0.0, -0.35, 0);
  }
}
