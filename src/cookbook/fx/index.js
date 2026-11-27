// FX system: one call wires every pool (billboards: fire/smoke/glow/ring, streaks: sparks/tracers, muzzle,
// decals, casings, light pool) and exposes gameplay-level verbs. Zero allocation per frame.
//
//   import { createFX } from './fx/index.js';
//   const fx = createFX(G);                          // after installAtmos(G) + createPost(G) if you use them
//   fx.muzzle(pos, dir, 'rifle'); fx.tracer(pos, hitPoint); fx.impact(hitPoint, hitNormal, 'metal');
//   fx.casing(ejectPos, ejectVel); fx.explosion(p, { scale: 1 }); const vent = fx.emitter({ pos, dir, kind: 'steam' });
// All verbs take Vector3-likes ({x,y,z}) — no arrays allocated. fx.timeScale = 0 freezes everything (stills).
import { Vector3 } from 'three';
import { createFxUniforms, TIER_SCALE } from './common.js';
import { createAtlases } from './atlas.js';
import { createBillboards, makeSpec, KIND } from './billboards.js';
import { createStreaks } from './streaks.js';
import { createMuzzle } from './muzzle.js';
import { createDecals } from './decals.js';
import { createCasings } from './casings.js';
import { createLightPool } from './lights.js';

export { KIND };
const _v = new Vector3(), _t1 = new Vector3(), _t2 = new Vector3(), _n = new Vector3(), _e = new Vector3(), _r = new Vector3();
const rand = Math.random;

// random unit vector inside a cone of half-angle ~spread (radians-ish) around n (unit)
function coneDir(n, spread, out) {
  _t1.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
  _t2.copy(n).cross(_t1);
  const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * spread;
  return out.copy(n).addScaledVector(_t1, Math.cos(a) * r).addScaledVector(_t2, Math.sin(a) * r).normalize();
}

// Surface presets for impact(): what a bullet does to each material
export const IMPACTS = {
  metal: { sparks: [10, 22], sparkSpeed: 6, dust: [0.42, 0.4, 0.38], dustN: 1, dustSize: 0.3, dustOpacity: 0.3, decal: 'metal', glow: 0.25, light: 3 },
  concrete: { sparks: [0, 3], sparkSpeed: 5, dust: [0.46, 0.43, 0.39], dustN: 3, dustOpacity: 0.42, decal: 'hole', glow: 0, light: 0 },
  dirt: { sparks: [0, 0], sparkSpeed: 0, dust: [0.36, 0.29, 0.21], dustN: 4, decal: null, glow: 0, light: 0 },
  wood: { sparks: [0, 0], sparkSpeed: 0, dust: [0.55, 0.44, 0.3], dustN: 2, decal: 'hole', glow: 0, light: 0 },
  flesh: { sparks: [0, 0], sparkSpeed: 0, dust: [0.22, 0.015, 0.015], dustN: 3, decal: null, glow: 0, light: 0 },
};

export function createFX(G, opts = {}) {
  const tier = G.quality?.tier || 'high', k = TIER_SCALE[tier] ?? 1;
  const U = createFxUniforms();
  const atlases = createAtlases(G.renderer, tier);
  const bb = createBillboards(G, U, atlases, { cap: Math.round((opts.billboards ?? 384) * k) });
  const st = createStreaks(G, U, { cap: Math.round((opts.streaks ?? 1024) * k) });
  const mz = createMuzzle(G, U, { cap: 16 });
  const dc = createDecals(G, U, { cap: Math.round((opts.decals ?? 256) * Math.min(1, k + 0.2)) });
  const cs = createCasings(G, { cap: Math.round((opts.casings ?? 48) * k), onBounce: opts.onCasingBounce });
  const lp = createLightPool(G, { count: opts.lights });
  const root = opts.parent || G.scene;
  root.add(bb.mesh, st.mesh, mz.mesh, dc.mesh, cs.mesh);
  const spec = makeSpec();
  const emitters = [];
  // soft particles: depth source (linear metres). Auto-picks G.post.targets.zHalf (previous frame — fine for
  // soft fades) unless opts.depth is given or opts.soft === false.
  let depthTex = opts.depth || null;
  const fx = {
    G, U, atlases, billboards: bb, streaks: st, muzzles: mz, decals: dc, casings: cs, lights: lp,
    timeScale: 1, soft: opts.soft !== false,
    params: { lightScale: 1, ambientUp: U.uFxAmbUp.value, ambientDown: U.uFxAmbDown.value },
    setDepth(tex) { depthTex = tex; },
    setGround(y, fn = null) { st.setGround(y, fn); cs.setGround(y, fn); },

    // --- verbs ---------------------------------------------------------------------------------
    muzzle(p, d, kind = 'rifle', { scale = 1, light = true, smoke = true } = {}) {
      mz.flash(p.x, p.y, p.z, d.x, d.y, d.z, kind, scale);
      if (light) lp.flash(p.x + d.x * 0.1, p.y + d.y * 0.1, p.z + d.z * 0.1, 1, 0.62, 0.32, 90 * scale * fx.params.lightScale, 0.05, 6);
      if (smoke) {
        puff(p.x + d.x * 0.05, p.y + d.y * 0.05, p.z + d.z * 0.05, d.x * 0.9, d.y * 0.9 + 0.15, d.z * 0.9, 0.04 * scale, 0.35 * scale, 1.1, 0.55, 0.55, 0.55, 0.16, 0.3);
      }
    },
    tracer(from, to, { speed = 380, length = 6, width = 0.02, bright = 1 } = {}) {
      st.tracer(from.x, from.y, from.z, to.x, to.y, to.z, speed, length, width, bright);
    },
    sparks(p, n, { count = 16, speed = 7, spread = 0.7, life = 0.7, heat = 1, size = 0.01, bright = 1.2 } = {}) {
      for (let i = 0; i < count; i++) {
        coneDir(n, spread, _v);
        const s = speed * (0.35 + rand() * 0.9);
        st.spark(p.x, p.y, p.z, _v.x * s, _v.y * s, _v.z * s, life * (0.4 + rand() * 0.8), size * (0.6 + rand() * 0.8), heat * (0.75 + rand() * 0.3), bright);
      }
    },
    smoke(p, { count = 4, size = 0.5, grow = 2.5, life = 3, color = [0.5, 0.5, 0.5], opacity = 0.5, spread = 0.3, vel = null, rise = 0.4, emis = 0, heat = 0, kind = KIND.PUFF } = {}) {
      for (let i = 0; i < count; i++) {
        const vx = (vel ? vel.x : 0) + (rand() - 0.5) * spread, vy = (vel ? vel.y : 0) + rand() * spread * 0.5, vz = (vel ? vel.z : 0) + (rand() - 0.5) * spread;
        puff(p.x + (rand() - 0.5) * size * 0.5, p.y + rand() * size * 0.3, p.z + (rand() - 0.5) * size * 0.5, vx, vy, vz, size, size * grow, life * (0.75 + rand() * 0.5), color[0], color[1], color[2], opacity, rise, emis, heat, kind);
      }
    },
    decal(p, n, kind = 'hole', size = 0.09) { dc.add(p.x, p.y, p.z, n.x, n.y, n.z, kind, size); },
    casing(p, v, kind = 'rifle') { cs.eject(p.x, p.y, p.z, v.x, v.y, v.z, kind); },
    // bullet hit: surface = 'metal' | 'concrete' | 'dirt' | 'wood' | 'flesh'
    // dir (optional, unit): incoming bullet direction → sparks favour the ricochet (reflected) direction
    impact(p, n, surface = 'concrete', { decal = true, scale = 1, dir = null } = {}) {
      const S = IMPACTS[surface] || IMPACTS.concrete;
      const ns = S.sparks[0] + ((rand() * (S.sparks[1] - S.sparks[0] + 1)) | 0);
      if (ns) {
        _r.copy(n);
        if (dir) { const d = dir.x * n.x + dir.y * n.y + dir.z * n.z; _r.set(dir.x - 2 * d * n.x, dir.y - 2 * d * n.y, dir.z - 2 * d * n.z).add(n).normalize(); }
        fx.sparks(p, _r, { count: ns, speed: S.sparkSpeed, spread: 0.8, life: 0.5, size: 0.008 });
      }
      if (S.glow) glow(p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02, S.glow * scale, 0.06, 1, 0.6, 0.3, 6);
      if (S.light) lp.flash(p.x + n.x * 0.1, p.y + n.y * 0.1, p.z + n.z * 0.1, 1, 0.6, 0.3, S.light * fx.params.lightScale, 0.05, 3);
      for (let i = 0; i < S.dustN; i++) {
        const sp = 0.6 + rand() * 1.4;
        puff(p.x + n.x * 0.03, p.y + n.y * 0.03, p.z + n.z * 0.03, n.x * sp + (rand() - 0.5) * 0.5, n.y * sp + (rand() - 0.5) * 0.5, n.z * sp + (rand() - 0.5) * 0.5,
          0.06 * scale, (S.dustSize ?? 0.75) * (0.7 + rand() * 0.5) * scale, (S.dustSize ? 0.6 : 1.2) + rand() * 0.9, S.dust[0], S.dust[1], S.dust[2], S.dustOpacity ?? (surface === 'flesh' ? 0.85 : 0.5), -0.1, 0, 0, KIND.PUFF, 2.5);
      }
      if (decal && S.decal) dc.add(p.x, p.y, p.z, n.x, n.y, n.z, S.decal, 0.07 + rand() * 0.04);
    },
    // explosion at p (ground-level centre). scale 1 ≈ grenade / small car-bomb fireball ~5 m.
    explosion(p, { scale = 1, smoke = true, debris = true, decal = true, ring = true, normal = null } = {}) {
      const s = scale, n = normal || _n.set(0, 1, 0);
      lp.flash(p.x, p.y + 1.2 * s, p.z, 1, 0.55, 0.24, 2600 * s * s * fx.params.lightScale, 0.9, 40 * s, 0.35);
      glow(p.x, p.y + 0.8 * s, p.z, 5 * s, 0.12, 1, 0.75, 0.5, 10);
      // fireballs: several flipbook sprites, offset & expanding (one big sprite reads as a sticker)
      const nf = Math.round(9 * Math.sqrt(s));
      for (let i = 0; i < nf; i++) {
        coneDir(n, 1.1, _v); const sp = (2.5 + rand() * 4) * s;
        Object.assign(spec, { x: p.x + _v.x * 0.4 * s, y: p.y + (0.5 + _v.y * 0.6) * s, z: p.z + _v.z * 0.4 * s, vx: _v.x * sp, vy: _v.y * sp * 0.7 + 1.0 * s, vz: _v.z * sp,
          size0: (1.4 + rand() * 0.8) * s, size1: (3.2 + rand() * 1.8) * s, life: 0.9 + rand() * 0.7, kind: KIND.FIRE, variant: 0, rot: rand() * 6.283, spin: (rand() - 0.5) * 0.8,
          r: 0.07, g: 0.062, b: 0.056, opacity: 1, emis: 1.0, heat: 0.95 + rand() * 0.25, heatDecay: 2.2, drag: 2.2, buoy: 2.5, soft: 0.8, fadeIn: 0.03, delay: i < 3 ? 0 : rand() * 0.08 });
        bb.emit(spec);
      }
      if (smoke) { // rising dark column, delayed so it emerges from the fire
        for (let i = 0; i < Math.round(14 * s); i++) {
          // smoke rolls out of the TOP of the fireball (spawned inside it would read as a black hole in the fire)
          coneDir(n, 0.6, _v); const sp = (0.4 + rand() * 1.0) * s, h = rand();
          Object.assign(spec, { x: p.x + _v.x * 0.9 * s, y: p.y + (2.0 + h * 1.6) * s, z: p.z + _v.z * 0.9 * s, vx: _v.x * sp, vy: (1.4 + h * 2.0) * s, vz: _v.z * sp,
            size0: (1.4 + h) * s, size1: (4 + rand() * 3.5) * s, life: 5 + rand() * 4, kind: KIND.PUFF, variant: (rand() * 16) | 0, rot: rand() * 6.283, spin: (rand() - 0.5) * 0.25,
            r: 0.07, g: 0.066, b: 0.062, opacity: 0.92, emis: 1.4, heat: 0, heatDecay: 14, drag: 0.55, buoy: 0.35, soft: 1.5, fadeIn: 0.12, delay: 0.3 + rand() * 0.35 });
          bb.emit(spec);
        }
        // low dust skirt kicked out along the ground
        for (let i = 0; i < Math.round(10 * s); i++) {
          const a = rand() * 6.283, sp = (5 + rand() * 4) * s;
          Object.assign(spec, { x: p.x, y: p.y + 0.3 * s, z: p.z, vx: Math.cos(a) * sp, vy: 0.3, vz: Math.sin(a) * sp, size0: 0.8 * s, size1: (3.5 + rand() * 2) * s, life: 3 + rand() * 2,
            kind: KIND.PUFF, variant: (rand() * 16) | 0, rot: rand() * 6.283, spin: (rand() - 0.5) * 0.3, r: 0.36, g: 0.31, b: 0.25, opacity: 0.55, emis: 0, heat: 0, heatDecay: 0, drag: 1.6, buoy: 0.1, soft: 1.0, fadeIn: 0.05, delay: 0.02 });
          bb.emit(spec);
        }
      }
      if (ring) {
        Object.assign(spec, { x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, size0: 1 * s, size1: 16 * s, life: 0.7, kind: KIND.RING, variant: rand(), rot: rand() * 6.283, spin: 0,
          r: 0.5, g: 0.45, b: 0.38, opacity: 0.5, emis: 0, heat: 0, heatDecay: 0, drag: 0, buoy: 0, soft: 0.3, fadeIn: 0.02, delay: 0 });
        bb.emit(spec);
      }
      if (debris) fx.sparks(_e.set(p.x, p.y + 0.6 * s, p.z), n, { count: Math.round(45 * s), speed: 12 * s, spread: 1.4, life: 1.8, size: 0.02, heat: 0.9, bright: 0.9 });
      if (decal) dc.add(p.x, p.y, p.z, n.x, n.y, n.z, 'scorch', 4.5 * s);
      G.emit('fx:shake', 0.6 * s, p);
    },
    // continuous emitter (steam vent, chimney smoke, burning wreck). Returns a handle (allocated once).
    emitter({ pos, dir = { x: 0, y: 1, z: 0 }, kind = 'steam', rate = 12, size = 0.25, speed = 1.6 } = {}) {
      const K = EMITTERS[kind] || EMITTERS.steam;
      const e = { x: pos.x, y: pos.y, z: pos.z, dx: dir.x, dy: dir.y, dz: dir.z, rate, size, speed, K, acc: 0, on: true,
        stop() { e.on = false; }, start() { e.on = true; }, set(x, y, z) { e.x = x; e.y = y; e.z = z; } };
      emitters.push(e);
      return e;
    },
    // run the continuous emitters for `seconds` before the first frame (stills / level start): no pop-in
    prewarm(seconds = 3, step = 1 / 30) { const ts = fx.timeScale; fx.timeScale = 1; for (let t = 0; t < seconds; t += step) fx.update(step); fx.timeScale = ts; },
    update(dt) {
      dt *= fx.timeScale;
      U.uFxTime.value += dt;
      syncUniforms();
      for (const e of emitters) {
        if (!e.on || dt <= 0) continue;
        e.acc += e.rate * dt;
        while (e.acc >= 1) {
          e.acc -= 1;
          const K = e.K, sp = e.speed * (0.8 + rand() * 0.4);
          puff(e.x, e.y, e.z, e.dx * sp + (rand() - 0.5) * 0.25, e.dy * sp + (rand() - 0.5) * 0.25, e.dz * sp + (rand() - 0.5) * 0.25,
            e.size, e.size * K.grow, K.life * (0.8 + rand() * 0.4), K.c[0], K.c[1], K.c[2], K.opacity, K.rise, K.emis, K.heat, K.kind, K.drag);
        }
      }
      if (dt > 0) { bb.update(dt); st.update(dt); mz.update(dt); cs.update(dt); lp.update(dt); }
    },
    stats: () => ({ billboards: bb.count, streaks: st.count, muzzles: mz.count, decals: dc.count, casings: cs.count }),
    dispose() { for (const m of [bb, st, mz]) { root.remove(m.mesh); m.pool.dispose(); } root.remove(dc.mesh, cs.mesh); dc.dispose(); cs.dispose(); lp.dispose(); atlases.dispose(); },
  };

  function puff(x, y, z, vx, vy, vz, s0, s1, life, r, g, b, opacity, rise, emis = 0, heat = 0, kind = KIND.PUFF, drag = 1.2) {
    spec.x = x; spec.y = y; spec.z = z; spec.vx = vx; spec.vy = vy; spec.vz = vz; spec.size0 = s0; spec.size1 = s1; spec.life = life;
    spec.kind = kind; spec.variant = (rand() * 16) | 0; spec.rot = rand() * 6.283; spec.spin = (rand() - 0.5) * 0.6;
    spec.r = r; spec.g = g; spec.b = b; spec.opacity = opacity; spec.emis = emis; spec.heat = heat; spec.heatDecay = 3;
    spec.drag = drag; spec.buoy = rise; spec.soft = Math.max(0.15, s1 * 0.5); spec.fadeIn = 0.12; spec.delay = 0;
    return bb.emit(spec);
  }
  function glow(x, y, z, size, life, r, g, b, emis) {
    spec.x = x; spec.y = y; spec.z = z; spec.vx = spec.vy = spec.vz = 0; spec.size0 = size; spec.size1 = size * 1.3; spec.life = life;
    spec.kind = KIND.GLOW; spec.variant = 0; spec.rot = 0; spec.spin = 0; spec.r = r; spec.g = g; spec.b = b; spec.opacity = 0;
    spec.emis = emis; spec.heat = 1; spec.heatDecay = 2.5; spec.drag = 0; spec.buoy = 0; spec.soft = Math.min(1, size * 0.3); spec.fadeIn = 0; spec.delay = 0;
    return bb.emit(spec);
  }
  fx.puff = puff; fx.glow = glow;

  const ART = G.ART || {};
  // ambient for particles: the sky dome average (zenith/horizon) above, ground bounce below — the same
  // numbers the sky and env map are built from, so puffs sit in the scene instead of glowing or going black
  const sk = ART.sky || {}, zen = sk.zenith || [0.1, 0.16, 0.28], hor = sk.horizon || [0.85, 0.62, 0.45], gnd = sk.groundTint || [0.2, 0.18, 0.16];
  const skyI = ART.ambient?.skyIntensity ?? 1.6;
  U.uFxAmbUp.value.set((zen[0] + hor[0]) * 0.5 * skyI, (zen[1] + hor[1]) * 0.5 * skyI, (zen[2] + hor[2]) * 0.5 * skyI);
  U.uFxAmbDown.value.set((gnd[0] + hor[0] * 0.15) * skyI, (gnd[1] + hor[1] * 0.15) * skyI, (gnd[2] + hor[2] * 0.15) * skyI);
  function syncUniforms() {
    const R = G.renderer;
    const rt = G.post?.targets?.scene;
    if (rt) U.uFxRes.value.set(rt.width, rt.height); else R.getDrawingBufferSize(U.uFxRes.value);
    U.uFxSunDir.value.copy(G.sun.dir);
    U.uFxSun.value.set(G.sun.color.r * G.sun.intensity, G.sun.color.g * G.sun.intensity, G.sun.color.b * G.sun.intensity);
    const dt = depthTex || (fx.soft && G.post?.targets?.zHalf?.texture) || null;
    U.uFxSoftOn.value = dt ? 1 : 0;
    if (dt) U.uFxDepth.value = dt;
  }
  syncUniforms();
  if (opts.autoUpdate !== false) G.on('update', (dt) => fx.update(dt));
  return fx;
}

// continuous emitter presets
export const EMITTERS = {
  steam: { c: [0.8, 0.82, 0.85], opacity: 0.45, life: 2.8, grow: 5, rise: 0.5, drag: 1.3, emis: 0, heat: 0, kind: KIND.PUFF },
  smoke: { c: [0.16, 0.15, 0.14], opacity: 0.6, life: 6, grow: 7, rise: 0.35, drag: 0.6, emis: 0, heat: 0, kind: KIND.PUFF },
  fire: { c: [0.05, 0.045, 0.04], opacity: 0.75, life: 0.7, grow: 1.5, rise: 3.0, drag: 1.5, emis: 1.0, heat: 0.95, kind: KIND.FIRE },
  dust: { c: [0.5, 0.44, 0.36], opacity: 0.35, life: 3, grow: 4, rise: 0.05, drag: 1, emis: 0, heat: 0, kind: KIND.PUFF },
};
