// Generated convolution impulse responses (no IR files). Each IR = pre-delay + sparse early reflections
// + diffuse stereo tail made of two frequency bands with different T60s (highs die faster: air + absorption).
//   import { makeIR, IR_KINDS } from './reverb.js';
//   convolver.buffer = await makeIR(ctx, 'hall');
// Kinds: outdoor (slap echoes off buildings, short sparse tail), hall, room (small room), cave (long, dark, flutter).
import { mulberry32, OnePole, runJobs, toAudioBuffer } from './synth.js';

export const IR_KINDS = {
  //            pre-delay  low T60  high T60  tail level  early reflections [time s, gain]   lowpass of tail  flutter
  outdoor: { pre: 0.012, t60: 1.1, t60hi: 0.45, tail: 0.18, er: [[0.045, 0.5], [0.083, 0.38], [0.141, 0.42], [0.22, 0.3], [0.37, 0.22], [0.55, 0.12]], lp: 5000, dur: 1.6 },
  hall: { pre: 0.022, t60: 2.4, t60hi: 1.3, tail: 0.6, er: [[0.011, 0.5], [0.019, 0.42], [0.027, 0.38], [0.036, 0.33], [0.048, 0.3], [0.061, 0.25], [0.077, 0.2]], lp: 9000, dur: 3.2 },
  room: { pre: 0.004, t60: 0.5, t60hi: 0.3, tail: 0.55, er: [[0.003, 0.6], [0.006, 0.5], [0.009, 0.45], [0.013, 0.4], [0.017, 0.33], [0.022, 0.28]], lp: 11000, dur: 0.8 },
  cave: { pre: 0.035, t60: 4.0, t60hi: 1.4, tail: 0.65, er: [[0.03, 0.5], [0.071, 0.45], [0.112, 0.4], [0.153, 0.32]], lp: 3500, dur: 5, flutter: 0.071 },
};

export function* renderIR(kind = 'hall', { sr = 44100, seed = 3 } = {}) {
  const k = IR_KINDS[kind] || IR_KINDS.hall, n = Math.round(k.dur * sr), r = mulberry32(seed + kind.length * 101);
  const L = new Float32Array(n), R = new Float32Array(n);
  const kl = 6.9078 / k.t60, kh = 6.9078 / k.t60hi;
  for (let c = 0; c < 2; c++) {
    const x = c ? R : L, split = new OnePole(900, sr), lp = new OnePole(k.lp, sr);
    const p0 = Math.round(k.pre * sr);
    for (let i = p0; i < n; i++) {
      const t = (i - p0) / sr, w = r() * 2 - 1;
      const lo = split.lp(w), hi = w - lo;
      // fade the tail in over ~30 ms so the early reflections stay legible
      const fade = Math.min(1, t / 0.03);
      let y = (lo * Math.exp(-kl * t) + hi * Math.exp(-kh * t)) * k.tail * fade;
      if (k.flutter) y *= 1 + 0.5 * Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * t / k.flutter), 6) * Math.exp(-t * 1.2);
      x[i] = lp.lp(y);
      if ((i & 8191) === 8191) yield;
    }
    // early reflections: small band-limited clusters (not single samples: those ring metallic)
    for (const [t, g] of k.er) {
      const i0 = Math.round((k.pre + t * (c ? 1.04 + r() * 0.03 : 1)) * sr);
      for (let j = 0; j < 24 && i0 + j < n; j++) x[i0 + j] += g * (r() * 2 - 1) * Math.exp(-j / 6) * (r() < 0.5 ? -1 : 1);
    }
    yield;
  }
  return { name: 'ir_' + kind, L, R, sr, ir: true };
}

export async function makeIR(ctx, kind = 'hall', opts = {}) {
  const [res] = await runJobs([renderIR(kind, { sr: ctx.sampleRate, ...opts })]);
  return toAudioBuffer(ctx, res);
}
