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
  if (!L || !R || !H) { const r = { ph: 0, spd: 0 }; PHASE.set(clip, r); return r; }
  const m = new AnimationMixer(obj), a = m.clipAction(clip); a.play();
  const N = 60, d = [], wl = [], wr = [];
  for (let i = 0; i < N; i++) {
    m.setTime((i / N) * clip.duration); obj.updateMatrixWorld(true);
    L.getWorldPosition(_v); R.getWorldPosition(_w); wl.push(_v.clone()); wr.push(_w.clone()); obj.worldToLocal(_v); obj.worldToLocal(_w);
    d.push([_v.x - _w.x, _v.z - _w.z]);
  }
  if (!_axis) { // principal axis of the left-right foot separation (same skeleton for every clip, so one axis)
    let xx = 0, zz = 0, xz = 0; for (const [x, z] of d) { xx += x * x; zz += z * z; xz += x * z; }
    const t = 0.5 * Math.atan2(2 * xz, xx - zz); _axis = [Math.cos(t), Math.sin(t)];
  }
  let best = -1e9, bi = 0; d.forEach(([x, z], i) => { const p = x * _axis[0] + z * _axis[1]; if (p > best) { best = p; bi = i; } });
  // native ground speed of the clip: how fast the planted (lower) foot sweeps backwards under the body. Time-scaling
  // the clip by v / spd keeps the stance foot still on the ground (no skating) at any blend speed.
  const minY = Math.min(...wl.map((q) => q.y), ...wr.map((q) => q.y)), dt = clip.duration / N, vs = [];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    for (const F of [wl, wr]) if (F[i].y < minY + 0.035 && F[j].y < minY + 0.035) vs.push(Math.hypot(F[j].x - F[i].x, F[j].z - F[i].z) / dt);
  }
  vs.sort((u, v) => u - v);
  const spd = vs.length >= 4 ? vs[Math.floor(vs.length * 0.5)] : 0;
  a.stop(); m.uncacheRoot(obj);
  const r = { ph: bi / N, spd }; PHASE.set(clip, r); return r;
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
    this.ph = {}; this.spd = {}; for (const k of LOCO) if (this.act[k]) { const r = footPhase(inst.obj, this.act[k].getClip(), this.bones0); this.ph[k] = r.ph; const cs = this.act[k].getClip().userData?.speed; this.spd[k] = cs > 0.3 ? cs : r.spd > 0.3 ? r.spd : CLIP_SPEED[k]; }
    this.lean = { roll: 0, pitch: 0 };
    this.act.idle?.setEffectiveWeight(1);
    this.speed = 0; this.heading = 0; this.state = 'ok';   // ok | down | dead
    this.gesture = null; this.gestureT = 0;
    this.downT = 0; this.fall = null; this.punchT = 1;
    // upper-body procedural layer (player + fighting peds): punches, guard, hit flinch, swim / jump poses
    this.atk = null; this.guardW = 0; this.guardTarget = 0; this.flinchT = 1; this.flinchDir = new Vector3(); this.swimW = 0; this.airW = 0; this.landT = 1; this.lookYaw = 0;
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
  // root-motion transitions (start / stop): the clip plays in place, the owner moves the body by transDelta
  playTrans(name, { start = 0, rate = 1 } = {}) {
    const c = this.clips[name]; if (!c || !c.userData?.rootZ || this.state !== 'ok') return false;
    this.stopTrans(0.1);
    const a = this.mixer.clipAction(c); a.reset(); a.setLoop(LoopOnce, 1); a.clampWhenFinished = true; a.setEffectiveWeight(0); a.timeScale = rate; a.time = start; a.play();
    this.trans = { name, a, dur: c.duration, rz: c.userData.rootZ, prevZ: rootAt(c.userData.rootZ, start), w: 0, fade: 0.14 }; this.transDelta = 0; return true;
  }
  // blend weights are ramped by hand (not mixer fades) so locomotion + transition always sum to 1: no bind-pose flash
  stopTrans(fade = 0.2) { if (!this.trans) return; if (this.transOut) this.transOut.a.setEffectiveWeight(0), this.transOut.a.stop(); this.transOut = { a: this.trans.a, w: this.trans.w, fade }; this.trans = null; this.transDelta = 0; }
  get transT() { return this.trans ? this.trans.a.time / this.trans.dur : 1; }
  punch() { return this.attack('R'); }
  // a punch: side 'L' (jab / hook) or 'R' (cross); target() → world Vector3 to strike (head of the victim) or null
  attack(side, { dur = 0.46, target = null, kind = 'jab' } = {}) {
    if (this.state !== 'ok' || (this.atk && this.atk.t < 0.62)) return false;
    this.atk = { side, t: 0, dur, target, kind }; this.punchT = 0; return true;
  }
  get atkPhase() { return this.atk ? this.atk.t : 1; }
  flinch(dx, dz, sev = 0.8) { this.flinchT = 0; this.flinchSev = sev; this.flinchDir.set(dx, 0, dz).normalize(); }
  // impulse: {x,z} m/s of the hit; severity 0..1 (1 = killed)
  knockDown(ix, iz, severity = 0.6) {
    if (this.state !== 'ok') { if (this.fall) { this.fall.vx += ix * 0.4; this.fall.vz += iz * 0.4; } return false; }
    this.stopGesture();
    const sp = Math.hypot(ix, iz) || 1;
    this.state = 'down'; this.downT = 0;
    this.fall = { vx: ix, vz: iz, vy: sp < 6 ? 0.4 + sp * 0.2 : Math.min(6, 1.2 + sp * 0.32), y: 0, t: 0, axisX: -iz / sp, axisZ: ix / sp, spin: (Math.random() - 0.5) * 6, rot: 0, dead: severity >= 1 || sp > 15, side: Math.random() < 0.5 ? 1 : -1 };
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
      this.wIdleS = Math.max(1 - MathUtils.smoothstep(v, 0.05, 0.9), (this.wIdleS ?? 1) - dt / 0.12);   // idle never vanishes in one frame
      const wIdle = this.wIdleS;
      // setting off from a stand: start the cycle just after the left heel strike (left foot planted under the hips,
      // right foot passing) so the first frames step instead of dragging both feet out of the idle stance
      if (v > 0.05 && this.wasIdle && wIdle > 0.95) for (const k of LOCO) { const a = this.act[k]; if (a) a.time = ((this.ph[k] + 0.22) % 1) * a.getClip().duration; }
      this.wasIdle = v <= 0.05;
      let wWalk = 0, wRun = 0, wSpr = 0;
      // gait thresholds from the clips' own measured ground speeds: each clip plays near its natural cadence
      const w1 = (this.spd.walk || 1.4) * 1.2, r0 = (this.spd.run || 3.6) * 0.8, r1 = (this.spd.run || 3.6) * 1.15, s1 = (this.spd.sprint || 6) * 0.9;
      if (v < w1) wWalk = 1 - wIdle; else if (v < r0) { const t = (v - w1) / (r0 - w1); wWalk = 1 - t; wRun = t; } else if (v < r1) wRun = 1; else { const t = MathUtils.clamp((v - r1) / Math.max(0.3, s1 - r1), 0, 1); wRun = 1 - t; wSpr = t; }
      const g = this.gesture ? 0.0 : 1;
      this.act.idle?.setEffectiveWeight(wIdle * g + (this.gesture ? 0 : 0));
      const walkA = style === 'stroll' ? this.act.stroll : this.act.walk;
      const otherW = style === 'stroll' ? this.act.walk : this.act.stroll;
      if (otherW && otherW !== walkA) otherW.setEffectiveWeight(0);
      walkA?.setEffectiveWeight(wWalk);
      this.act.run?.setEffectiveWeight(wRun);
      this.act.sprint?.setEffectiveWeight(wSpr);
      if (this.gesture) { for (const k of ['walk', 'run', 'sprint', 'stroll']) this.act[k]?.setEffectiveWeight(0); this.act.idle?.setEffectiveWeight(0); }
      if (this.trans) { this.trans.w = Math.min(1, this.trans.w + dt / this.trans.fade); this.trans.a.setEffectiveWeight(this.trans.w); }
      if (this.transOut) { const O = this.transOut; O.w -= dt / O.fade; if (O.w <= 0) { O.a.setEffectiveWeight(0); O.a.stop(); this.transOut = null; } else O.a.setEffectiveWeight(O.w); }
      { const wt = (this.trans ? this.trans.w : 0) + (this.transOut ? this.transOut.w : 0);
        if (wt > 0) for (const k of ['idle', 'walk', 'run', 'sprint', 'stroll']) { const a = this.act[k]; if (a) a.setEffectiveWeight(a.getEffectiveWeight() * Math.max(0, 1 - wt)); } }
      // time-scale clips to ground speed
      const ws = style === 'stroll' ? this.spd.stroll : this.spd.walk;
      if (walkA) walkA.timeScale = (v > 0.05 ? MathUtils.clamp(v / ws, 0.35, 2.2) : 1) * (this.reverse ? -1 : 1);   // reverse: stepping backwards
      if (this.act.run) this.act.run.timeScale = MathUtils.clamp(v / this.spd.run, 0.55, 1.7);
      if (this.act.sprint) this.act.sprint.timeScale = MathUtils.clamp(v / this.spd.sprint, 0.7, 1.5);
      if (this.airW > 0.3) { const fz = Math.max(0.05, 1 - this.airW); for (const k of ['walk', 'stroll', 'run', 'sprint']) if (this.act[k]) this.act[k].timeScale *= fz; }   // airborne: hold the take-off stride
      // keep every locomotion clip in step with the dominant one (feet hit the ground together across the blend)
      let lead = null, lw = 0.02;
      for (const k of LOCO) { const a = this.act[k]; if (a && a.getEffectiveWeight() > lw) { lw = a.getEffectiveWeight(); lead = k; } }
      this.mixer.update(dt);
      if (this.trans) {   // root path of the transition clip → metres to move along the heading this frame
        const T = this.trans, z = rootAt(T.rz, Math.min(T.a.time, T.dur));
        this.transDelta = Math.max(0, z - T.prevZ); T.prevZ = z;
        if (T.a.time >= T.dur - 1e-3) this.stopTrans(0.3);
      }
      if (lead && !this.gesture) {
        const A = this.act[lead], dur = A.getClip().duration;
        const phase = ((A.time / dur - this.ph[lead]) % 1 + 1) % 1;
        // footfalls from the gait phase (left heel strike at 0, right at 0.5): frame-rate independent
        if (this.onFootstep && v > 0.35 && !this.trans) { const lp = this.lastPhase ?? phase, crossed = (a, b, x) => (a <= b ? a < x && x <= b : a < x || x <= b);
          if (Math.abs(phase - lp) < 0.5 || phase < lp) { if (crossed(lp, phase, 0.001)) this.onFootstep('l'); if (crossed(lp, phase, 0.5)) this.onFootstep('r'); } }
        this.lastPhase = phase;
        for (const k of LOCO) { const a = this.act[k]; if (!a || k === lead || a === A) continue; const d2 = a.getClip().duration; a.time = ((phase + this.ph[k]) % 1) * d2; }
      }
      this.root.position.y = groundY;
      this.body.rotation.set(this.lean.pitch, 0, this.lean.roll); this.body.position.set(0, 0, 0);
      this.inst.obj.rotation.set(0, 0, 0);
      this.upperBody(dt);
    } else {
      // fall: ballistic arc + tip over onto the back/side, then lie sprawled
      const f = this.fall;
      this.mixer.update(dt * 0.15);
      f.t += dt;
      if (f.getUp !== undefined) {   // staged get-up: roll to sitting, then push up to standing
        f.getUp += dt;
        const k = MathUtils.clamp(f.getUp / 1.5, 0, 1);
        const u1 = MathUtils.smoothstep(k, 0, 0.5), u2 = MathUtils.smoothstep(k, 0.5, 1);
        const remain = 1 - 0.65 * u1 - 0.35 * u2, h = 0.15 + 0.2 * u1 + 0.6 * u2;
        this.body.quaternion.copy(_q.identity()).slerp(f.restQ || this.body.quaternion, remain);
        pelvisPivot(this.body, h);
        this.sprawl(remain * 0.8);
        if (k < 0.6) { for (const sd of ['L', 'R']) { const T = this.bones[`Bip01_${sd}_Thigh`], C = this.bones[`Bip01_${sd}_Calf`]; T && T.rotateZ(0.9 * (1 - u2)); C && C.rotateZ(-1.4 * (1 - u2)); } }
        if (k >= 1) { this.state = 'ok'; this.fall = null; this.body.quaternion.identity(); this.body.position.set(0, 0, 0); this.recoverT = 0; }
        this.root.position.y = groundY;
        return;
      }
      const air = f.y > 0 || f.vy > 0;
      if (air) { f.vy -= 18 * dt; f.y = Math.max(0, f.y + f.vy * dt); if (f.y === 0 && f.vy < 0) { f.vy = 0; } }
      const drag = air ? 0.2 : f.rot > 1.2 ? 14 : 4.5;
      f.vx -= f.vx * Math.min(1, drag * dt); f.vz -= f.vz * Math.min(1, drag * dt);
      this.root.position.x += f.vx * dt; this.root.position.z += f.vz * dt;
      this.root.position.y = groundY + f.y;
      // knees buckle first (0.18 s), then the body tips over about the hips and settles on the ground
      const buckle = MathUtils.clamp(f.t / 0.18, 0, 1);
      if (f.t > 0.1) f.rot = Math.min(Math.PI / 2, f.rot + dt * 4.2);
      // tip over: rotate the body around the horizontal axis perpendicular to the hit, pivoting at the feet
      _v.set(f.axisX, 0, f.axisZ);
      // axis is in world space; convert to root-local (root has heading)
      _v.applyAxisAngle(new Vector3(0, 1, 0), -this.root.rotation.y);
      this.body.quaternion.setFromAxisAngle(_v, f.rot);
      _q.setFromAxisAngle(new Vector3(0, 1, 0), f.spin * Math.min(1, f.t) * 0.3);
      this.body.quaternion.premultiply(_q);
      const kk = Math.min(1, f.rot / (Math.PI / 2));
      pelvisPivot(this.body, 0.95 - 0.3 * buckle * (1 - kk) - 0.8 * kk);
      f.restQ = this.body.quaternion.clone();
      this.sprawl(Math.min(1, f.t * 3), MathUtils.smoothstep(kk, 0.5, 1));
      if (f.t < 0.3) for (const sd of ['L', 'R']) { const U = this.bones[`Bip01_${sd}_UpperArm`]; U && U.rotateZ(0.8 * Math.sin(f.t / 0.3 * Math.PI)); }   // arms reach to break the fall
      if (kk < 0.8) for (const sd of ['L', 'R']) { const T = this.bones[`Bip01_${sd}_Thigh`], C = this.bones[`Bip01_${sd}_Calf`]; T && T.rotateZ(0.7 * buckle * (1 - kk)); C && C.rotateZ(-1.1 * buckle * (1 - kk)); }
      this.downT += dt;
      if (!f.dead && this.downT > 4.5 && !air) this.getUp();
    }
  }
  sprawl(k, ka = k) {
    if (k <= 0) return;
    const B = this.bones, s = this.fall ? this.fall.side : 1;
    const rot = (n, x, y, z, kk = k) => { const b = B[n]; if (!b) return; _e.set(x * kk, y * kk, z * kk); _q.setFromEuler(_e); b.quaternion.multiply(_q); };
    rot('Bip01_L_UpperArm', 0, -0.55 * s, 0.4, ka); rot('Bip01_R_UpperArm', 0, 0.55 * s, -0.4, ka);
    rot('Bip01_L_Forearm', 0, -0.6, 0, ka); rot('Bip01_R_Forearm', 0, 0.6, 0, ka);
    // legs lie nearly straight (local z is hip / knee flexion on the Biped rig: a big z sends a leg up in the air)
    rot('Bip01_L_Thigh', 0.22, 0, 0.12); rot('Bip01_R_Thigh', -0.14, 0, 0.04);
    rot('Bip01_L_Calf', 0, 0, -0.35); rot('Bip01_R_Calf', 0, 0, -0.12);
    rot('Bip01_Head', 0.3 * s, 0, 0.2);
  }
  // ---- upper-body layer, applied after the clip pose: spine twist, two-bone arm IK (guard / punch), flinch, fists
  upperBody(dt) {
    const B = this.bones;
    if (this.atk) { this.atk.t += dt / this.atk.dur; if (this.atk.t >= 1) this.atk = null; }
    this.punchT = this.atk ? this.atk.t : 1;
    this.guardW += (this.guardTarget * MathUtils.clamp(1.4 - this.speed / 3, 0, 1) - this.guardW) * Math.min(1, 7 * dt);
    if (this.flinchT < 1) this.flinchT = Math.min(1, this.flinchT + dt / 0.5);
    if (this.landT < 1) this.landT = Math.min(1, this.landT + dt / 0.28);
    const atkE = this.atk ? punchCurve(this.atk.t) : 0;
    const active = (this.climbW || 0) > 0.02 || this.guardW > 0.02 || this.atk || this.flinchT < 1 || this.swimW > 0.02 || this.airW > 0.02 || this.landT < 1 || Math.abs(this.lookYaw) > 0.02;
    if (!active || !B.Bip01_R_UpperArm) return;
    this.root.updateMatrixWorld(true);
    const h = this.root.rotation.y, fwd = _f.set(Math.sin(h), 0, Math.cos(h)), right = _r.set(-Math.cos(h), 0, Math.sin(h));
    // head anticipates the turn
    if (Math.abs(this.lookYaw) > 0.02) { worldRot(B.Bip01_Neck, UP, this.lookYaw * 0.4); worldRot(B.Bip01_Head, UP, this.lookYaw * 0.6); }
    // swimming: torso near horizontal, head up, arms in a breaststroke cycle
    if (this.swimW > 0.02) {
      const k = this.swimW, ph = (this.G.t * 1.6) % 1, sweep = Math.sin(ph * Math.PI * 2);
      worldRot(B.Bip01_Spine, right, -0.25 * k); worldRot(B.Bip01_Neck, right, 0.5 * k); worldRot(B.Bip01_Head, right, 0.45 * k);
      for (const [sd, sg] of [['L', -1], ['R', 1]]) {
        const S = bonePos(B[`Bip01_${sd}_UpperArm`], _S), T = _T.copy(S).addScaledVector(fwd, 0.35 + 0.25 * sweep).addScaledVector(right, sg * (0.15 + 0.3 * Math.max(0, -sweep))).addScaledVector(UP, -0.12);
        armIK(B, sd, T, k, _p.copy(UP).multiplyScalar(-0.3).addScaledVector(right, sg).addScaledVector(fwd, -0.4));
      }
      for (const sd of ['L', 'R']) worldRot(B[`Bip01_${sd}_Thigh`], right, 0.25 * k * Math.sin(ph * Math.PI * 2 + (sd === 'L' ? 0 : Math.PI)));
      return;
    }
    if (this.climbW > 0.02) { // pulling up a ledge: both hands on the edge above, knees up
      for (const [sd, sg] of [['L', -1], ['R', 1]]) { const S = bonePos(B[`Bip01_${sd}_UpperArm`], _S), T = _T.copy(S).addScaledVector(fwd, 0.35).addScaledVector(UP, 0.35 * this.climbW).addScaledVector(right, -sg * 0.05); armIK(B, sd, T, this.climbW, _p.copy(UP).multiplyScalar(-1).addScaledVector(fwd, -0.5)); }
      for (const sd of ['L', 'R']) { worldRot(B[`Bip01_${sd}_Thigh`], right, 0.9 * this.climbW); worldRot(B[`Bip01_${sd}_Calf`], right, -1.2 * this.climbW); }
    }
    // airborne: knees tucked, arms out for balance; landing: a quick crouch absorbs the impact
    const tuck = this.airW + (this.landT < 1 ? Math.sin(this.landT * Math.PI) * 0.6 : 0);
    if (tuck > 0.02) {
      for (const sd of ['L', 'R']) { worldRot(B[`Bip01_${sd}_Thigh`], right, 0.55 * tuck); worldRot(B[`Bip01_${sd}_Calf`], right, -0.9 * tuck); }
      if (this.airW > 0.02) for (const [sd, sg] of [['L', -1], ['R', 1]]) worldRot(B[`Bip01_${sd}_UpperArm`], fwd, sg * -0.45 * this.airW);
    }
    // flinch: the upper body snaps away from the blow and recovers
    if (this.flinchT < 1) {
      const fk = Math.sin(this.flinchT * Math.PI) * Math.pow(1 - this.flinchT, 0.5), ax = _a.crossVectors(UP, this.flinchDir).normalize();
      const sv = this.flinchSev ?? 0.8; worldRot(B.Bip01_Spine1, ax, 0.4 * fk * sv); worldRot(B.Bip01_Spine2, ax, 0.3 * fk * sv); worldRot(B.Bip01_Head, ax, 0.7 * fk * sv);
      if (!this.atk && this.flinchT < 0.6) { const ak = Math.sin(Math.min(1, this.flinchT / 0.6) * Math.PI) * sv; for (const [sd, sg] of [['L', -1], ['R', 1]]) worldRot(B[`Bip01_${sd}_UpperArm`], right, -0.5 * ak); }   // arms come up to cover
    }
    // guard + punch
    const g = Math.max(this.guardW, this.atk ? 1 : 0);
    if (g < 0.02) return;
    // fighting stance: knees soften, hips drop, weight on the balls of the feet (standing only)
    const st = this.guardW * MathUtils.clamp(1 - this.speed / 1.2, 0, 1);
    if (st > 0.02) {
      this.body.position.y -= 0.05 * st; this.body.updateMatrixWorld(true);
      for (const sd of ['L', 'R']) { worldRot(B[`Bip01_${sd}_Thigh`], right, 0.3 * st); worldRot(B[`Bip01_${sd}_Calf`], right, -0.55 * st); worldRot(B[`Bip01_${sd}_Foot`], right, 0.25 * st); }
      worldRot(B.Bip01_Spine1, right, 0.08 * st);
    }
    const side = this.atk?.side, sgn = side === 'R' ? 1 : -1;
    if (this.atk) { // twist the torso into the punch, lean in
      const tw = (this.atk.kind === 'hook' ? 0.55 : 0.38) * atkE * sgn;
      worldRot(B.Bip01_Spine, UP, tw * 0.3); worldRot(B.Bip01_Spine1, UP, tw * 0.35); worldRot(B.Bip01_Spine2, UP, tw * 0.35);
      worldRot(B.Bip01_Spine1, right, -0.12 * atkE);
    }
    for (const [sd, sg] of [['L', -1], ['R', 1]]) {
      const S = bonePos(B[`Bip01_${sd}_UpperArm`], _S);
      // guard: fist in front of the chin, elbow tucked down
      const guard = _G.copy(S).addScaledVector(fwd, 0.30).addScaledVector(UP, 0.05).addScaledVector(right, -sg * 0.14);
      let T = guard, w = g;
      if (this.atk && sd === side) {
        const tgt = this.atk.target?.();
        const strike = tgt ? _T.copy(tgt).addScaledVector(fwd, -0.08).addScaledVector(UP, -0.06) : _T.copy(S).addScaledVector(fwd, 0.62).addScaledVector(right, -sg * 0.12).addScaledVector(UP, 0.03);
        if (this.atk.kind === 'hook') strike.addScaledVector(right, sg * 0.08);
        const dS = _d2.subVectors(strike, S); const reach = 0.6; if (dS.length() > reach) strike.copy(S).addScaledVector(dS.normalize(), reach);
        T = _T2.copy(guard).lerp(strike, Math.max(0, atkE)); if (atkE < 0) T.addScaledVector(fwd, 0.08 * atkE);
        w = 1;
      }
      const pole = _p.copy(UP).multiplyScalar(-1).addScaledVector(right, sg * (this.atk?.kind === 'hook' && sd === side ? 1.4 : 0.35)).addScaledVector(fwd, -0.15);
      armIK(B, sd, T, w, pole);
      fist(B, sd, w);
    }
  }
}
// punch extension over normalized time: wind back, snap out (ease-out), hold, recover
function punchCurve(t) {
  if (t < 0.22) return -0.25 * Math.sin((t / 0.22) * Math.PI * 0.5);
  if (t < 0.42) { const u = (t - 0.22) / 0.2; return -0.25 + 1.25 * (1 - Math.pow(1 - u, 3)); }
  if (t < 0.55) return 1;
  const u = (t - 0.55) / 0.45; return 1 - u * u * (3 - 2 * u);
}
// root path of a transition clip at time t (pairs t, z)
function rootAt(rz, t) { for (let i = 2; i < rz.length; i += 2) if (rz[i] >= t) { const u = (t - rz[i - 2]) / ((rz[i] - rz[i - 2]) || 1); return rz[i - 1] + (rz[i + 1] - rz[i - 1]) * u; } return rz[rz.length - 1]; }
// rotate the body about the hips (not the feet): keep the pelvis at height h above the root
const _pp = new Vector3();
function pelvisPivot(body, h) { _pp.set(0, 0.95, 0).applyQuaternion(body.quaternion); body.position.set(-_pp.x, h - _pp.y, -_pp.z); }
const UP = new Vector3(0, 1, 0), _f = new Vector3(), _r = new Vector3(), _a = new Vector3(), _p = new Vector3(), _S = new Vector3(), _T = new Vector3(), _T2 = new Vector3(), _G = new Vector3(), _d2 = new Vector3();
const _E2 = new Vector3(), _H2 = new Vector3(), _dir = new Vector3(), _n = new Vector3(), _from = new Vector3(), _to = new Vector3(), _qa = new Quaternion(), _qw = new Quaternion(), _qp = new Quaternion();
function bonePos(b, out) { return b.getWorldPosition(out); }
// rotate a bone by a world-space delta (axis-angle or from→to), keeping its children attached
function applyWorldDelta(bone, dq) {
  bone.getWorldQuaternion(_qw); _qw.premultiply(dq);
  bone.parent.getWorldQuaternion(_qp); bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateMatrixWorld(true);
}
function worldRot(bone, axis, ang) { if (!bone || Math.abs(ang) < 1e-4) return; applyWorldDelta(bone, _qa.setFromAxisAngle(axis, ang)); }
function turnBone(bone, from, to, w) { _qa.setFromUnitVectors(from.normalize(), to.normalize()); if (w < 1) _qa.slerp(_qp.identity(), 1 - w); applyWorldDelta(bone, _qa); }
// analytic two-bone IK: shoulder → elbow → hand reaches T, elbow bent toward the pole
function armIK(B, sd, T, w, pole) {
  const U = B[`Bip01_${sd}_UpperArm`], F = B[`Bip01_${sd}_Forearm`], H = B[`Bip01_${sd}_Hand`]; if (!U || !F || !H || w < 0.01) return;
  const S = U.getWorldPosition(_S2), E = F.getWorldPosition(_E2), Hp = H.getWorldPosition(_H2);
  const a = S.distanceTo(E), b = E.distanceTo(Hp);
  _dir.subVectors(T, S); let d = _dir.length(); if (d < 1e-4) return; _dir.multiplyScalar(1 / d);
  d = MathUtils.clamp(d, Math.abs(a - b) + 0.02, (a + b) * 0.995);
  const cosA = MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  _n.copy(pole).addScaledVector(_dir, -pole.dot(_dir)); if (_n.lengthSq() < 1e-6) _n.set(0, -1, 0); _n.normalize();
  const Ew = _to.copy(S).addScaledVector(_dir, a * cosA).addScaledVector(_n, a * sinA);
  turnBone(U, _from.subVectors(E, S), Ew.sub(S), w);
  F.getWorldPosition(E); H.getWorldPosition(Hp);
  const Tc = _to.copy(S).addScaledVector(_dir, d);
  turnBone(F, _from.subVectors(Hp, E), Tc.sub(E), w);
}
const _S2 = new Vector3();
// curl the fingers into a fist (axis across the knuckles; sign chosen so the tips close toward the thumb side)
const FIST_SIGN = new Map();
function fist(B, sd, w) {
  if (w < 0.05) return;
  const a = B[`Bip01_${sd}_Finger1`], z = B[`Bip01_${sd}_Finger4`], th = B[`Bip01_${sd}_Finger0`]; if (!a || !z || !th) return;
  const pa = a.getWorldPosition(new Vector3()), pz = z.getWorldPosition(new Vector3()), axis = pa.clone().sub(pz).normalize();
  let sg = FIST_SIGN.get(a);
  if (sg === undefined) { // probe once: which way brings the index tip toward the thumb base?
    const c = B[`Bip01_${sd}_Finger11`], pt = th.getWorldPosition(new Vector3()), q0 = a.quaternion.clone();
    const d0 = c.getWorldPosition(new Vector3()).distanceTo(pt); worldRot(a, axis, 0.6); const d1 = c.getWorldPosition(new Vector3()).distanceTo(pt);
    a.quaternion.copy(q0); a.updateMatrixWorld(true); sg = d1 < d0 ? 1 : -1; FIST_SIGN.set(a, sg);
  }
  for (const f of ['1', '2', '3', '4']) for (const [j, k] of [['', 1.1], ['1', 1.3], ['2', 0.9]]) worldRot(B[`Bip01_${sd}_Finger${f}${j}`], axis, sg * k * w);
}
