// Offline, sample-by-sample synthesis into Float32Arrays, inside yielding generators so a game boot
// stays responsive (the runner time-slices them, ~6 ms per slice). No AudioContext is needed to
// render: only `toAudioBuffer` touches WebAudio. That is what lets meter.js test everything headless.
//
//   import { render, runJobs, toAudioBuffer } from './synth.js';
//   const [res] = await runJobs([render(recipe, { sr: 44100, seed: 7 })]);
//   const buf = toAudioBuffer(ctx, res);
//
// RECIPE FORMAT (all times in seconds, all frequencies in Hz):
// {
//   dur: 1.2,                 // length of the sound (loop length for loops)
//   sr: 44100,                // optional, overrides the runner's rate (32000..48000 is sensible)
//   peakDb: -3,               // normalise the final peak to this (meter requires <= -1 dBFS)
//   loop: 0.25 | 'wrap',      // number = seamless crossfade length; 'wrap' = render `tail` extra and fold it into the head
//   tail: 2,                  // with loop:'wrap', how much release to fold back (music, periodic loops)
//   layers: [ LAYER, ... ],   // summed
//   fx: [ FX, ... ],          // applied to the sum, per channel
//   fadeOut: 0.01,            // anti-click fade at the end (one-shots only)
// }
// LAYER: { type: 'osc'|'noise'|'partials'|'crackle'|'impulse'|'custom', start, dur, amp, pan(-1..1),
//          env: {a,h,d,s,r} | PARAM,  filters: [{type:'lp'|'hp'|'bp'|'notch'|'peak'|'lowshelf'|'highshelf', f:PARAM, q, gain}],
//          drive: k (tanh waveshaper), fold: k (wavefolder), am: {f, depth}, stereo: true (independent noise per channel)
//   osc:      wave 'sine'|'saw'|'square'|'tri'|'pulse', freq: PARAM, pw: 0.5, fm: {ratio, index: PARAM, wave}, voices: n, detune: cents
//   noise:    color 'white'|'pink'|'brown'
//   partials: freq: PARAM (base), modes: [[ratio, amp, t60], ...]   (modal metal/glass/wood resonators)
//   crackle:  rate: PARAM (impulses per second), grain: seconds (decay of each grain), jitter of amplitude
//   impulse:  a single-sample click (good to excite filters/combs)
//   custom:   gen: function*(out={L,R}, i0, n, sr, rng) — write samples yourself, yield every few thousand }
// PARAM: number | [[t,v],...] (piecewise linear) | {from, to, time, curve:'exp'|'lin'|k} | (t) => v
// ENV {a,h,d,s,r}: a = linear attack, h = hold, d = time to fall 60 dB toward s, r = release at the end (linear)
// FX: {type:'echo', time, fb, mix, lp} | {type:'comb', delay, fb, damp, mix} | {type:'allpass', delay, g}
//     | {type:'drive', k} | {type:'lp'|'hp'|..., f, q} | {type:'dcblock'} | {type:'width', amt} (stereo decorrelation)

export const SR = 44100;
const TAU = Math.PI * 2;

export const mulberry32 = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------- parameters (compiled to t => value) ----------
export function P(spec) {
  if (spec == null) return () => 0;
  if (typeof spec === 'number') return () => spec;
  if (typeof spec === 'function') return spec;
  if (Array.isArray(spec)) {
    const pts = spec;
    return (t) => {
      if (t <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        if (t < pts[i][0]) { const [t0, v0] = pts[i - 1], [t1, v1] = pts[i]; return v0 + (v1 - v0) * (t - t0) / (t1 - t0); }
      }
      return pts[pts.length - 1][1];
    };
  }
  const { from, to, time = 1, curve = 'exp', delay = 0 } = spec;
  if (curve === 'exp' && from > 0 && to > 0) {
    const r = Math.log(to / from);
    return (t) => { const x = Math.min(1, Math.max(0, (t - delay) / time)); return from * Math.exp(r * x); };
  }
  const k = typeof curve === 'number' ? curve : 1;
  return (t) => { const x = Math.min(1, Math.max(0, (t - delay) / time)); return from + (to - from) * Math.pow(x, k); };
}

// ADSR with an exponential decay defined by T60 (time to fall 60 dB) — the natural shape for percussive sounds.
export function envelope(spec, dur) {
  if (spec == null) return () => 1;
  if (typeof spec === 'number' || Array.isArray(spec) || typeof spec === 'function' || 'from' in spec) return P(spec);
  const a = spec.a ?? 0.002, h = spec.h ?? 0, d = spec.d ?? 1e9, s = spec.s ?? 0, r = spec.r ?? Math.min(0.01, dur * 0.1);
  const relT = dur - r;
  const k = 6.9078 / Math.max(1e-4, d);
  const level = (t) => {
    if (t < a) return t / a;
    const x = t - a - h;
    return x < 0 ? 1 : s + (1 - s) * Math.exp(-k * x);
  };
  return (t) => {
    if (t < 0 || t > dur) return 0;
    if (t > relT) return level(relT) * (dur - t) / r;
    return level(t);
  };
}

// ---------- oscillators (phase accumulator, polyBLEP anti-aliased saw/square) ----------
const blep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
export class Osc {
  constructor(wave = 'sine', phase = 0, pw = 0.5) { this.wave = wave; this.p = phase; this.pw = pw; this.tri = 0; }
  next(f, sr, pm = 0) {
    const dt = Math.min(0.49, Math.abs(f) / sr);
    let p = this.p + pm; p -= Math.floor(p);
    let y;
    switch (this.wave) {
      case 'sine': y = Math.sin(TAU * p); break;
      case 'saw': y = 2 * p - 1 - blep(p, dt); break;
      case 'square': case 'pulse': {
        const pw = this.pw;
        y = (p < pw ? 1 : -1) + blep(p, dt) - blep((p + 1 - pw) % 1, dt);
        break;
      }
      case 'tri': y = 4 * Math.abs(p - 0.5) - 1; break;
      default: y = Math.sin(TAU * p);
    }
    this.p += dt; if (this.p >= 1) this.p -= 1;
    return y;
  }
}

// ---------- noise ----------
export class Noise {
  constructor(color = 'white', rnd = Math.random) { this.c = color; this.r = rnd; this.b = new Float64Array(7); this.br = 0; }
  next() {
    const w = this.r() * 2 - 1;
    if (this.c === 'white') return w;
    if (this.c === 'brown') { this.br = (this.br + 0.02 * w) / 1.02; return this.br * 3.5; }
    // pink: Paul Kellet's refined filter (-3 dB/oct within 0.05 dB above 9 Hz)
    const b = this.b;
    b[0] = 0.99886 * b[0] + w * 0.0555179; b[1] = 0.99332 * b[1] + w * 0.0750759;
    b[2] = 0.969 * b[2] + w * 0.153852; b[3] = 0.8665 * b[3] + w * 0.3104856;
    b[4] = 0.55 * b[4] + w * 0.5329522; b[5] = -0.7616 * b[5] - w * 0.016898;
    const y = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362;
    b[6] = w * 0.115926;
    return y * 0.11;
  }
}

// ---------- filters ----------
// RBJ cookbook biquad, transposed direct form II. `set` is cheap enough to call every 16 samples for sweeps.
export class Biquad {
  constructor(type = 'lp', f = 1000, q = 0.707, sr = SR, gain = 0) { this.z1 = 0; this.z2 = 0; this.set(type, f, q, sr, gain); }
  set(type, f, q, sr, gain = 0) {
    f = Math.min(Math.max(f, 10), sr * 0.45); q = Math.max(q || 0.707, 0.05);
    const w = TAU * f / sr, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q), A = Math.pow(10, gain / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'bp': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'peak': b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; break;
      case 'lowshelf': case 'highshelf': {
        const s = 2 * Math.sqrt(A) * al, sg = type === 'lowshelf' ? 1 : -1;
        b0 = A * ((A + 1) - sg * (A - 1) * cw + s); b1 = 2 * sg * A * ((A - 1) - sg * (A + 1) * cw); b2 = A * ((A + 1) - sg * (A - 1) * cw - s);
        a0 = (A + 1) + sg * (A - 1) * cw + s; a1 = -2 * sg * ((A - 1) + sg * (A + 1) * cw); a2 = (A + 1) + sg * (A - 1) * cw - s;
        break;
      }
      default: b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}
export class OnePole { // 6 dB/oct lowpass; hp = x - lp
  constructor(f, sr = SR) { this.y = 0; this.set(f, sr); }
  set(f, sr) { this.a = 1 - Math.exp(-TAU * f / sr); return this; }
  lp(x) { return (this.y += this.a * (x - this.y)); }
  hp(x) { return x - this.lp(x); }
}
export class Comb { // feedback comb with damping (Freeverb style)
  constructor(n, fb = 0.7, damp = 0.2) { this.buf = new Float32Array(Math.max(1, n | 0)); this.i = 0; this.fb = fb; this.d = damp; this.s = 0; }
  process(x) {
    const y = this.buf[this.i];
    this.s = y * (1 - this.d) + this.s * this.d;
    this.buf[this.i] = x + this.s * this.fb;
    if (++this.i >= this.buf.length) this.i = 0;
    return y;
  }
}
export class Allpass { // Schroeder allpass: decorrelates/diffuses without colouring the spectrum
  constructor(n, g = 0.5) { this.buf = new Float32Array(Math.max(1, n | 0)); this.i = 0; this.g = g; }
  process(x) {
    const b = this.buf[this.i], y = -this.g * x + b;
    this.buf[this.i] = x + this.g * y;
    if (++this.i >= this.buf.length) this.i = 0;
    return y;
  }
}
export const softclip = (x, k) => Math.tanh(x * k) / Math.tanh(k);
export const fold = (x, k) => Math.sin(x * k * Math.PI * 0.5);

// ---------- layer rendering ----------
function* renderLayer(L, out, sr, rnd, total) {
  const start = Math.max(0, L.start || 0), dur = Math.min(L.dur ?? total - start, total - start);
  const i0 = Math.round(start * sr), n = Math.min(out.L.length - i0, Math.round(dur * sr));
  if (n <= 0) return;
  if (L.type === 'custom') { yield* L.gen(out, i0, n, sr, rnd); return; }
  const amp = L.amp ?? 1, env = envelope(L.env, dur);
  const pan = L.pan || 0, gl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, gr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
  const stereo = !!L.stereo && L.type === 'noise';
  const mk = () => (L.filters || []).map((f) => ({ bq: new Biquad(f.type, typeof f.f === 'number' ? f.f : 1000, f.q, sr, f.gain), p: P(f.f), type: f.type, q: f.q, gain: f.gain, dyn: typeof f.f !== 'number' }));
  const chains = stereo ? [mk(), mk()] : [mk()];
  const drive = L.drive || 0, fk = L.fold || 0;
  const amF = L.am ? L.am.f : 0, amD = L.am ? L.am.depth : 0;
  let src1, src2, freq, fmOsc, fmRatio, fmIndex, voices, modes;
  switch (L.type) {
    case 'osc': {
      freq = P(L.freq ?? 440);
      const nv = L.voices || 1, det = L.detune || 0;
      voices = [];
      for (let v = 0; v < nv; v++) voices.push({ o: new Osc(L.wave, rnd(), L.pw ?? 0.5), m: nv === 1 ? 1 : Math.pow(2, (det * (v / (nv - 1) * 2 - 1)) / 1200) });
      if (L.fm) { fmOsc = new Osc(L.fm.wave || 'sine'); fmRatio = L.fm.ratio ?? 1; fmIndex = P(L.fm.index ?? 1); }
      break;
    }
    case 'noise': src1 = new Noise(L.color, rnd); src2 = stereo ? new Noise(L.color, rnd) : null; break;
    case 'partials': {
      freq = P(L.freq ?? 440);
      modes = (L.modes || [[1, 1, 0.5]]).map(([r, a, t60]) => ({ o: new Osc('sine', rnd()), r: r * (1 + (rnd() - 0.5) * (L.inharm || 0)), a, k: 6.9078 / t60 }));
      break;
    }
    case 'crackle': freq = P(L.rate ?? 200); break;
  }
  const grainK = L.type === 'crackle' ? Math.exp(-6.9078 / ((L.grain || 0.002) * sr)) : 0;
  let grain = 0, grainSign = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 15) === 0) for (const ch of chains) for (const f of ch) if (f.dyn) f.bq.set(f.type, f.p(t), f.q, sr, f.gain);
    let x = 0, x2 = 0;
    switch (L.type) {
      case 'osc': {
        const f = freq(t);
        let pm = 0;
        if (fmOsc) pm = fmOsc.next(f * fmRatio, sr) * fmIndex(t) / TAU;
        for (const v of voices) x += v.o.next(f * v.m, sr, pm);
        x /= Math.sqrt(voices.length);
        break;
      }
      case 'noise': x = src1.next(); x2 = src2 ? src2.next() : x; break;
      case 'partials': {
        const f = freq(t);
        for (const m of modes) x += m.o.next(f * m.r, sr) * m.a * Math.exp(-m.k * t);
        break;
      }
      case 'crackle': {
        if (rnd() < freq(t) / sr) { grain = 0.3 + 0.7 * rnd(); grainSign = rnd() < 0.5 ? -1 : 1; }
        x = grain * grainSign * (rnd() * 2 - 1 + 0.5 * grainSign); grain *= grainK;
        break;
      }
      case 'impulse': x = i === 0 ? 1 : 0; break;
    }
    if (!stereo) x2 = x;
    let y1 = x, y2 = x2;
    for (const f of chains[0]) y1 = f.bq.process(y1);
    if (stereo) for (const f of chains[1]) y2 = f.bq.process(y2); else y2 = y1;
    let g = env(t) * amp;
    if (amD) g *= 1 - amD * (0.5 + 0.5 * Math.sin(TAU * amF * t));
    y1 *= g; y2 *= g;
    if (drive) { y1 = softclip(y1, drive); y2 = stereo ? softclip(y2, drive) : y1; }
    if (fk) { y1 = fold(y1, fk); y2 = stereo ? fold(y2, fk) : y1; }
    out.L[i0 + i] += y1 * gl; out.R[i0 + i] += y2 * gr;
    if ((i & 2047) === 2047) yield;
  }
}

function* applyFx(fx, out, sr, rnd) {
  const chans = [out.L, out.R];
  for (const F of fx || []) {
    if (F.type === 'width') {
      // decorrelate L/R with two different allpass chains, then mix back: wide but mono-compatible
      const amt = F.amt ?? 0.5;
      const apL = [new Allpass(sr * 0.0047, 0.6), new Allpass(sr * 0.0113, 0.6)], apR = [new Allpass(sr * 0.0061, 0.6), new Allpass(sr * 0.0089, 0.6)];
      for (let i = 0; i < out.L.length; i++) {
        let l = out.L[i], r = out.R[i];
        for (const a of apL) l = a.process(l);
        for (const a of apR) r = a.process(r);
        out.L[i] = out.L[i] * (1 - amt) + l * amt; out.R[i] = out.R[i] * (1 - amt) + r * amt;
        if ((i & 8191) === 8191) yield;
      }
      continue;
    }
    for (let c = 0; c < 2; c++) {
      const x = chans[c];
      if (F.type === 'echo') {
        // multi-tap slap echo with lowpassed feedback; R channel slightly longer for width
        const d = Math.round((F.time * (c ? 1.07 : 1)) * sr), buf = new Float32Array(d), lp = new OnePole(F.lp || 3000, sr);
        let j = 0;
        for (let i = 0; i < x.length; i++) {
          const e = buf[j]; buf[j] = x[i] + lp.lp(e) * (F.fb ?? 0.3); if (++j >= d) j = 0;
          x[i] += e * (F.mix ?? 0.3);
          if ((i & 8191) === 8191) yield;
        }
      } else if (F.type === 'comb') {
        const cb = new Comb(F.delay * sr * (c ? 1.03 : 1), F.fb ?? 0.6, F.damp ?? 0.2), mix = F.mix ?? 0.5;
        for (let i = 0; i < x.length; i++) { x[i] = x[i] * (1 - mix) + cb.process(x[i]) * mix; if ((i & 8191) === 8191) yield; }
      } else if (F.type === 'allpass') {
        const ap = new Allpass(F.delay * sr * (c ? 1.05 : 1), F.g ?? 0.5);
        for (let i = 0; i < x.length; i++) { x[i] = ap.process(x[i]); if ((i & 8191) === 8191) yield; }
      } else if (F.type === 'drive') {
        for (let i = 0; i < x.length; i++) x[i] = softclip(x[i], F.k ?? 2);
      } else if (F.type === 'dcblock') {
        let px = 0, py = 0;
        for (let i = 0; i < x.length; i++) { py = x[i] - px + 0.995 * py; px = x[i]; x[i] = py; }
      } else {
        const bq = new Biquad(F.type, F.f, F.q, sr, F.gain);
        for (let i = 0; i < x.length; i++) x[i] = bq.process(x[i]);
      }
    }
    yield;
  }
}

// Render one recipe. Generator: `yield`s often; returns { L, R, sr, peak, gain } when done.
export function* render(recipe, { sr: srDefault = SR, seed = 1, name = '' } = {}) {
  const sr = recipe.sr || srDefault, dur = recipe.dur;
  const loop = recipe.loop, extra = loop === 'wrap' ? (recipe.tail ?? 1) : (typeof loop === 'number' ? loop : 0);
  const total = dur + extra, N = Math.ceil(total * sr), n = Math.round(dur * sr);
  const out = { L: new Float32Array(N), R: new Float32Array(N) };
  const rnd = mulberry32(seed * 9973 + 17);
  for (const L of recipe.layers || []) yield* renderLayer(L, out, sr, rnd, total);
  yield* applyFx(recipe.fx, out, sr, rnd);
  // DC block always (drive/brown noise leave offsets that waste headroom and click on loop)
  for (const x of [out.L, out.R]) { let px = 0, py = 0; for (let i = 0; i < x.length; i++) { py = x[i] - px + 0.9995 * py; px = x[i]; x[i] = py; } }
  let L = out.L, R = out.R;
  if (loop === 'wrap') {
    for (const x of [L, R]) for (let i = n; i < N; i++) x[(i - n) % n] += x[i];
    L = L.slice(0, n); R = R.slice(0, n);
  } else if (typeof loop === 'number' && loop > 0) {
    const X = Math.min(N - n, n);
    for (const x of [L, R]) for (let i = 0; i < X; i++) {
      const u = i / X, a = Math.sin(u * Math.PI / 2), b = Math.cos(u * Math.PI / 2);
      x[i] = x[i] * a + x[n + i] * b; // equal-power: head fades in while the overrun tail fades out
    }
    L = L.slice(0, n); R = R.slice(0, n);
  } else {
    const f = Math.min(n, Math.round((recipe.fadeOut ?? 0.01) * sr));
    for (const x of [L, R]) for (let i = 0; i < f; i++) x[N - 1 - i] *= i / f;
  }
  yield;
  let peak = 0;
  for (const x of [L, R]) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  const gain = peak > 1e-9 && Number.isFinite(peak) ? dbToGain(recipe.peakDb ?? -3) / peak : 1;
  for (const x of [L, R]) for (let i = 0; i < x.length; i++) x[i] *= gain;
  return { name, L, R, sr, peak: peak * gain, gain, loop: !!loop };
}

// ---------- runner: time-sliced, so a boot screen keeps animating ----------
const tick = typeof MessageChannel !== 'undefined'
  ? (() => { const ch = new MessageChannel(), q = []; ch.port1.onmessage = () => q.shift()(); ch.port1.unref && ch.port1.unref(); return (fn) => { q.push(fn); ch.port2.postMessage(0); }; })()
  : (fn) => setTimeout(fn, 0);

// jobs: array of generators (from render()/renderIR()/stem jobs). Resolves to their return values in order.
export function runJobs(jobs, { budgetMs = 6, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const results = new Array(jobs.length);
    let k = 0;
    const slice = () => {
      const t0 = performance.now();
      try {
        while (k < jobs.length && performance.now() - t0 < budgetMs) {
          for (let s = 0; s < 8; s++) {
            const r = jobs[k].next();
            if (r.done) { results[k++] = r.value; onProgress && onProgress(k / jobs.length); break; }
          }
        }
      } catch (e) { reject(e); return; }
      if (k < jobs.length) tick(slice); else resolve(results);
    };
    tick(slice);
  });
}

export function toAudioBuffer(ctx, res) {
  const buf = ctx.createBuffer(2, res.L.length, res.sr);
  buf.copyToChannel(res.L, 0); buf.copyToChannel(res.R, 1);
  return buf;
}
