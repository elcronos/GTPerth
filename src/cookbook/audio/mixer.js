// Live WebAudio graph — kept deliberately small (the sounds are pre-rendered by synth.js):
//   voice: BufferSource -> Gain -> [air-absorption lowpass -> HRTF Panner] -> bus  (+ send -> reverb)
//   buses sfx / music / ambience / ui -> duck gain -> master -> limiter (DynamicsCompressor) -> trim -> destination
//   reverb: two ConvolverNodes (crossfade when the environment changes) -> return -> master
//
//   import { createMixer } from './mixer.js';
//   const mixer = createMixer();                     // AudioContext starts suspended; unlock() is armed automatically
//   mixer.addBank(await buildBank(mixer.ctx));       // sfx.js
//   await mixer.setEnv('outdoor');                   // reverb.js IR
//   G.on('update', () => mixer.update(G.camera));    // listener follows the camera (no allocation)
//   mixer.play('rifle', { pos: muzzle, send: 0.4, duck: { db: -6 } });
//   const eng = mixer.play('engine_idle', { loop: true, bus: 'sfx', pos: car.position, follow: car }); eng.setRate(rpm / 900);
import { Vector3 } from 'three';
import { makeIR } from './reverb.js';

const _f = new Vector3(), _u = new Vector3(), _p = new Vector3();

export function createMixer({ ctx = null, volume = 0.9, maxVoices = 48, autoUnlock = true } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = ctx || new AC({ latencyHint: 'interactive' });
  const master = ctx.createGain(); master.gain.value = volume;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6; limiter.knee.value = 3; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.2;
  const trim = ctx.createGain(); trim.gain.value = 0.95;
  master.connect(limiter); limiter.connect(trim); trim.connect(ctx.destination);

  const buses = {};
  for (const [name, v] of [['sfx', 1], ['music', 0.55], ['ambience', 0.7], ['ui', 0.6]]) {
    const g = ctx.createGain(), duck = ctx.createGain(); g.gain.value = v; g.connect(duck); duck.connect(master);
    buses[name] = { in: g, duck, holdUntil: 0 };
  }
  // reverb: A/B convolvers for click-free environment swaps
  const verbIn = ctx.createGain(), verbOut = ctx.createGain(); verbOut.gain.value = 0.8; verbOut.connect(master);
  const conv = [ctx.createConvolver(), ctx.createConvolver()], convG = [ctx.createGain(), ctx.createGain()];
  conv.forEach((c, i) => { verbIn.connect(c); c.connect(convG[i]); convG[i].connect(verbOut); convG[i].gain.value = 0; });
  let active = 0; const irCache = {};

  const bank = {}, voices = [];
  const M = {
    ctx, master, limiter, buses, bank, env: null,
    bus: (n) => (buses[n] || buses.sfx).in,
    addBank(b) { Object.assign(bank, b); return M; },
    has: (n) => !!bank[n],
    setVolume(bus, v, t = 0.1) { const g = bus === 'master' ? master : buses[bus].in; g.gain.setTargetAtTime(v, ctx.currentTime, t / 3); },
    async setEnv(kind, fade = 0.6) {
      if (M.env === kind) return;
      M.env = kind;
      const buf = irCache[kind] ||= await makeIR(ctx, kind);
      const next = 1 - active, t = ctx.currentTime;
      conv[next].buffer = buf;
      convG[next].gain.setTargetAtTime(1, t, fade / 3); convG[active].gain.setTargetAtTime(0, t, fade / 3);
      active = next;
    },
    // Play a bank sound (random variant) or an AudioBuffer. Returns a voice handle.
    // opts: bus, gain, rate, pitchJitter (fraction), loop, send (reverb 0..1), when (s from now),
    //       pos ([x,y,z] | Vector3) -> HRTF 3D voice, follow (Object3D: position tracked in update()),
    //       refDistance, rolloff, maxDistance, speedOfSound (true: delay by distance/343), duck {bus:'music', db, hold, release}
    play(name, o = {}) {
      const list = typeof name === 'string' ? bank[name] : [name];
      if (!list || !list.length) return null;
      const buf = list[(Math.random() * list.length) | 0];
      if (ctx.state !== 'running') return null; // not unlocked yet: drop (never queue a burst of sounds)
      if (voices.length >= maxVoices) voices.shift().stop(0.02);
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = !!o.loop;
      const pj = o.pitchJitter ?? (o.loop ? 0 : 0.04);
      src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * pj);
      const g = ctx.createGain(); g.gain.value = o.gain ?? 1;
      src.connect(g);
      let node = g, panner = null, air = null, delay = o.when || 0;
      if (o.pos || o.follow) {
        air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.Q.value = 0.5;
        panner = ctx.createPanner();
        panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
        panner.refDistance = o.refDistance ?? 2; panner.rolloffFactor = o.rolloff ?? 1; panner.maxDistance = o.maxDistance ?? 500;
        const p = o.follow ? o.follow.position : o.pos;
        const x = p.x ?? p[0], y = p.y ?? p[1], z = p.z ?? p[2];
        panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z;
        const d = Math.hypot(x - lis.x, y - lis.y, z - lis.z);
        air.frequency.value = airCutoff(d);
        if (o.speedOfSound) delay += d / 343;
        g.connect(air); air.connect(panner); node = panner;
      }
      node.connect(M.bus(o.bus || 'sfx'));
      if (o.send) { const s = ctx.createGain(); s.gain.value = o.send; node.connect(s); s.connect(verbIn); }
      src.start(t + delay);
      if (o.duck) M.duck(o.duck.bus || 'music', o.duck.db ?? -6, o.duck.attack ?? 0.01, o.duck.hold ?? 0.15, o.duck.release ?? 0.6, delay);
      const v = {
        src, gain: g, panner, air, follow: o.follow || null, ended: false,
        stop(fade = 0.05) { if (v.ended) return; const t2 = ctx.currentTime; g.gain.cancelScheduledValues(t2); g.gain.setValueAtTime(g.gain.value, t2); g.gain.linearRampToValueAtTime(0, t2 + fade); try { src.stop(t2 + fade + 0.01); } catch (e) { /* noop */ } },
        setRate(r, tc = 0.05) { src.playbackRate.setTargetAtTime(r, ctx.currentTime, tc); },
        setGain(x, tc = 0.05) { g.gain.setTargetAtTime(x, ctx.currentTime, tc); },
        setPos(x, y, z) { if (!panner) return; panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z; air.frequency.value = airCutoff(Math.hypot(x - lis.x, y - lis.y, z - lis.z)); },
      };
      src.onended = () => { v.ended = true; const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1); try { node.disconnect(); } catch (e) { /* noop */ } };
      voices.push(v);
      return v;
    },
    // Side-chain style ducking of a bus (e.g. music under explosions/dialogue). Re-triggers extend the hold.
    duck(bus = 'music', db = -6, attack = 0.01, hold = 0.15, release = 0.6, delay = 0) {
      const b = buses[bus]; if (!b) return;
      const t = ctx.currentTime + delay, g = b.duck.gain, target = Math.pow(10, db / 20);
      g.cancelScheduledValues(t); g.setTargetAtTime(target, t, attack / 3);
      b.holdUntil = Math.max(b.holdUntil, t + attack + hold);
      g.setTargetAtTime(1, b.holdUntil, release / 3);
    },
    // Per frame: listener = camera; followed voices track their Object3D. Zero allocation.
    update(camera) {
      camera.updateMatrixWorld();
      const e = camera.matrixWorld.elements;
      _p.set(e[12], e[13], e[14]); _f.set(-e[8], -e[9], -e[10]).normalize(); _u.set(e[4], e[5], e[6]).normalize();
      lis.x = _p.x; lis.y = _p.y; lis.z = _p.z;
      const L = ctx.listener;
      if (L.positionX) {
        L.positionX.value = _p.x; L.positionY.value = _p.y; L.positionZ.value = _p.z;
        L.forwardX.value = _f.x; L.forwardY.value = _f.y; L.forwardZ.value = _f.z;
        L.upX.value = _u.x; L.upY.value = _u.y; L.upZ.value = _u.z;
      } else { L.setPosition(_p.x, _p.y, _p.z); L.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z); }
      for (let i = 0; i < voices.length; i++) { const v = voices[i]; if (v.follow) { const q = v.follow.position; v.setPos(q.x, q.y, q.z); } }
    },
    // Browsers start AudioContexts suspended until a user gesture. Resolves once running.
    unlock() {
      if (ctx.state === 'running') return Promise.resolve();
      return new Promise((res) => {
        const go = () => {
          ctx.resume().then(() => {
            const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start();
            for (const ev of EVENTS) removeEventListener(ev, go, true);
            M.onUnlock && M.onUnlock(); res();
          });
        };
        for (const ev of EVENTS) addEventListener(ev, go, true);
      });
    },
    get voiceCount() { return voices.length; },
  };
  const lis = { x: 0, y: 0, z: 0 };
  if (autoUnlock) M.unlocked = M.unlock();
  return M;
}
const EVENTS = ['pointerdown', 'keydown', 'touchend'];
// air absorption: distant sounds lose highs (~ -3 dB/oct above a cutoff falling with distance)
const airCutoff = (d) => Math.max(900, Math.min(20000, 20000 / (1 + d / 30)));
