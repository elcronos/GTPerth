// Procedural music stems from a chord progression, rendered offline (time-sliced) and mixed live by intensity.
// Five stems, same length, all loop seamlessly ('wrap' folds release tails into the head):
//   pad (detuned saws, voice-led, slow filter), bass (saw+sub, 8th/16th pattern), pulse (16th arpeggio, ping-pong echo),
//   drums (synth kick/snare/hats, fill on the last bar), tension (minor-2nd tremolo cluster, tritone glass, riser).
//
//   import { buildMusic, createMusic, SONGS } from './music.js';
//   const stems = await buildMusic(mixer.ctx, SONGS.dusk);          // ~0.5-1.5 s of sliced CPU at boot
//   const music = createMusic(mixer, stems); music.start(); music.setIntensity(0.7, 2);
// Intensity map: 0 = pad only (explore), ~0.3 + bass, ~0.5 + pulse, ~0.7 + drums, 1.0 + tension (combat peak).
import { render, runJobs, toAudioBuffer, Osc, Biquad, Noise, midiToHz } from './synth.js';

export const SONGS = {
  // i - VI - III - VII  then  i - VI - iv - V  (Aeolian with a harmonic-minor turnaround): dark, driving
  dusk: { bpm: 96, beatsPerChord: 4, chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'] },
  // ambient / exploration
  calm: { bpm: 72, beatsPerChord: 8, chords: ['Fmaj7', 'Am7', 'Dm9', 'Csus2'] },
  // tense synth-wave chase
  chase: { bpm: 128, beatsPerChord: 4, chords: ['Em', 'C', 'D', 'Bm'] },
};

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUAL = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14],
  sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6], 5: [0, 7] };
export function parseChord(name) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(name);
  if (!m) throw new Error('bad chord ' + name);
  const root = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  return { root, iv: QUAL[m[3]] || QUAL[''] };
}

function timeline(song) {
  const spb = 60 / song.bpm, cd = song.beatsPerChord * spb;
  const chords = song.chords.map((c, i) => ({ ...parseChord(c), t: i * cd, d: cd }));
  return { spb, cd, chords, loop: chords.length * cd, step: spb / 4, bars: chords.length * song.beatsPerChord / 4 };
}
// voice-leading: place each chord tone in the octave nearest the previous voicing's centre
function voiceLead(chords, lo = 52, centre = 62) {
  let c = centre;
  return chords.map((ch) => {
    const notes = ch.iv.slice(0, 4).map((iv) => { const pc = (ch.root + iv) % 12; let n = lo + ((pc - lo) % 12 + 12) % 12; while (n + 6 < c) n += 12; while (n - 6 > c) n -= 12; return n; });
    c = notes.reduce((a, b) => a + b, 0) / notes.length * 0.5 + centre * 0.5;
    return notes;
  });
}
// write one note with a per-sample function into out (L/R gains)
function* note(out, sr, t0, dur, gl, gr, fn) {
  const i0 = Math.round(t0 * sr), n = Math.min(Math.round(dur * sr), out.L.length - i0);
  for (let i = 0; i < n; i++) { const v = fn(i / sr); out.L[i0 + i] += v * gl; out.R[i0 + i] += v * gr; if ((i & 4095) === 4095) yield; }
}

const STEMS = {
  pad(song, T, sr) {
    const voicing = voiceLead(T.chords), rel = 1.6;
    return { dur: T.loop, loop: 'wrap', tail: rel + 0.5, peakDb: -9,
      layers: [{ type: 'custom', gen: function* (out, i0, n, sr, r) {
        for (let c = 0; c < T.chords.length; c++) {
          const ch = T.chords[c];
          for (const [k, m] of voicing[c].entries()) {
            for (const [d, pan] of [[-9, -0.7], [0, 0], [8, 0.7]]) {
              const o = new Osc('saw', r()), f = midiToHz(m) * Math.pow(2, d / 1200), a = 0.9, s = ch.d;
              const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
              yield* note(out, sr, ch.t, s + rel, gl, gr, (t) => o.next(f, sr) * (t < a ? t / a : t < s ? 1 : Math.max(0, 1 - (t - s) / rel)) * (k === 0 ? 0.8 : 0.6));
            }
          }
        }
        // slow filter sweep (period = loop/2 so it stays seamless)
        for (const x of [out.L, out.R]) {
          const bq = new Biquad('lp', 800, 0.9, sr);
          for (let i = 0; i < x.length; i++) {
            if ((i & 31) === 0) bq.set('lp', 650 + 550 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * i / sr / T.loop)), 0.9, sr);
            x[i] = bq.process(x[i]); if ((i & 8191) === 8191) yield;
          }
        }
      } }],
      fx: [{ type: 'echo', time: T.spb * 0.75, fb: 0.35, mix: 0.25, lp: 2500 }, { type: 'width', amt: 0.4 }] };
  },
  bass(song, T, sr) {
    const pat = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0];
    return { dur: T.loop, loop: 'wrap', tail: 0.5, peakDb: -8,
      layers: [{ type: 'custom', gen: function* (out, i0, n, sr, r) {
        const steps = Math.round(T.loop / T.step);
        for (let s = 0; s < steps; s++) {
          if (!pat[s % 16]) continue;
          const t0 = s * T.step, ch = T.chords.find((c) => t0 >= c.t && t0 < c.t + c.d) || T.chords[0];
          let len = 1; while (len < 4 && !pat[(s + len) % 16]) len++;
          const m = 36 + ((ch.root - 0 + 12) % 12) + (ch.root > 6 ? -12 : 0) + ((s % 16) === 10 ? 12 : 0);
          const f = midiToHz(m), o = new Osc('saw', 0), sub = new Osc('sine', 0), bq = new Biquad('lp', 900, 2.5, sr), d = len * T.step * 0.92;
          let i = 0;
          yield* note(out, sr, t0, d + 0.02, 1, 1, (t) => {
            if ((i++ & 15) === 0) bq.set('lp', 220 + 1100 * Math.exp(-t * 14), 2.5, sr);
            const e = Math.min(1, t / 0.004) * (t < d ? 1 : Math.max(0, 1 - (t - d) / 0.02));
            return (bq.process(o.next(f, sr)) * 0.7 + sub.next(f, sr) * 0.6) * e;
          });
        }
      } }],
      fx: [{ type: 'drive', k: 1.6 }] };
  },
  pulse(song, T, sr) {
    return { dur: T.loop, loop: 'wrap', tail: 2, peakDb: -12,
      layers: [{ type: 'custom', gen: function* (out, i0, n, sr, r) {
        const steps = Math.round(T.loop / T.step), seq = [0, 1, 2, 3, 2, 1, 2, 4];
        for (let s = 0; s < steps; s++) {
          const t0 = s * T.step, ch = T.chords.find((c) => t0 >= c.t && t0 < c.t + c.d) || T.chords[0];
          const tones = ch.iv.slice(0, 3).map((iv) => ch.root + iv);
          const k = seq[s % 8], m = 62 + ((tones[k % 3] - 2 + 24) % 12) + 12 * Math.floor(k / 3);
          const o = new Osc('pulse', 0, 0.28), f = midiToHz(m), bq = new Biquad('lp', 2600, 1.2, sr), acc = s % 4 === 0 ? 1 : 0.65;
          yield* note(out, sr, t0, 0.32, 1, 1, (t) => bq.process(o.next(f, sr)) * Math.min(1, t / 0.002) * Math.exp(-t * 16) * acc);
        }
      } }],
      fx: [{ type: 'echo', time: T.step * 3, fb: 0.4, mix: 0.35, lp: 3000 }, { type: 'width', amt: 0.6 }] };
  },
  drums(song, T, sr) {
    const K = [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0], S = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1], H = [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1];
    return { dur: T.loop, loop: 'wrap', tail: 0.6, peakDb: -6,
      layers: [{ type: 'custom', gen: function* (out, i0, n, sr, r) {
        const steps = Math.round(T.loop / T.step), last = steps - 16;
        for (let s = 0; s < steps; s++) {
          const t0 = s * T.step, q = s % 16, fill = s >= last + 12;
          if (K[q]) { const o = new Osc('sine', 0); yield* note(out, sr, t0, 0.45, 1, 1, (t) => Math.sin(2 * Math.PI * (50 * t + 90 / 35 * (1 - Math.exp(-35 * t)))) * Math.exp(-t * 9) * 1.2 + (t < 0.003 ? (r() - 0.5) * 0.6 : 0)); }
          if (S[q] || (fill && s % 1 === 0)) {
            const nz = new Noise('white', r), hp = new Biquad('hp', 1100, 0.7, sr), acc = fill ? 0.35 + 0.5 * (s - last - 12) / 4 : 1;
            yield* note(out, sr, t0, 0.3, 0.9, 1, (t) => (hp.process(nz.next()) * Math.exp(-t * 22) * 0.8 + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 40) * 0.7) * acc);
          }
          if (H[q]) {
            const nz = new Noise('white', r), hp = new Biquad('hp', 7500, 0.7, sr), open = q === 14, acc = q % 4 === 2 ? 0.8 : 0.45;
            yield* note(out, sr, t0, open ? 0.3 : 0.08, 0.8, 1.1, (t) => hp.process(nz.next()) * Math.exp(-t * (open ? 12 : 60)) * acc);
          }
        }
      } }],
      fx: [{ type: 'drive', k: 1.3 }, { type: 'echo', time: 0.031, fb: 0.1, mix: 0.12, lp: 6000 }, { type: 'width', amt: 0.2 }] };
  },
  tension(song, T, sr) {
    const root = 38 + T.chords[0].root; // low cluster around the tonic
    const trem = Math.max(1, Math.round(7 * T.loop)) / T.loop; // integer cycles per loop -> seamless
    return { dur: T.loop, loop: 'wrap', tail: 0.3, peakDb: -10,
      layers: [
        { type: 'osc', wave: 'saw', voices: 2, detune: 12, freq: midiToHz(root), env: { a: 0.01, s: 1, r: 0.01 }, am: { f: trem, depth: 0.7 }, filters: [{ type: 'bp', f: 420, q: 1.2 }], amp: 0.6, pan: -0.3 },
        { type: 'osc', wave: 'saw', voices: 2, detune: 12, freq: midiToHz(root + 1), env: { a: 0.01, s: 1, r: 0.01 }, am: { f: trem, depth: 0.7 }, filters: [{ type: 'bp', f: 460, q: 1.2 }], amp: 0.6, pan: 0.3 },
        { type: 'osc', wave: 'sine', freq: (t) => midiToHz(root + 36) * (1 + 0.003 * Math.sin(2 * Math.PI * t * 4 / T.loop * 5)), env: { a: 0.01, s: 1, r: 0.01 }, amp: 0.14, pan: -0.6 },
        { type: 'osc', wave: 'sine', freq: midiToHz(root + 42), env: { a: 0.01, s: 1, r: 0.01 }, amp: 0.1, pan: 0.6, am: { f: 2 / T.loop, depth: 0.8 } },
        // riser over the last two bars into the downbeat
        { type: 'noise', color: 'pink', stereo: true, start: T.loop - 8 * T.spb, dur: 8 * T.spb, env: (t) => Math.pow(t / (8 * T.spb), 3) * (t > 8 * T.spb - 0.03 ? (8 * T.spb - t) / 0.03 : 1),
          filters: [{ type: 'bp', f: { from: 300, to: 5000, time: 8 * T.spb }, q: 2 }], amp: 0.9 },
      ],
      fx: [{ type: 'width', amt: 0.4 }] };
  },
};
export const STEM_NAMES = Object.keys(STEMS);

export function stemJobs(song = SONGS.dusk, { sr = 32000, seed = 5 } = {}) {
  const T = timeline(song);
  return STEM_NAMES.map((name, i) => ({ name, gen: render(STEMS[name](song, T, sr), { sr, seed: seed + i, name: 'music_' + name }) }));
}

// Resolves { stems: {pad: AudioBuffer, ...}, loop: seconds, bpm }
export async function buildMusic(ctx, song = SONGS.dusk, { sr = 32000, budgetMs = 6, onProgress } = {}) {
  const jobs = stemJobs(song, { sr });
  const res = await runJobs(jobs.map((j) => j.gen), { budgetMs, onProgress });
  const stems = {};
  jobs.forEach((j, i) => (stems[j.name] = ctx ? toAudioBuffer(ctx, res[i]) : res[i]));
  return { stems, loop: timeline(song).loop, bpm: song.bpm };
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const INTENSITY = { // stem gain as a function of intensity 0..1
  pad: (x) => 1 - 0.25 * x, bass: (x) => sstep(0.15, 0.35, x), pulse: (x) => sstep(0.35, 0.6, x) * 0.9,
  drums: (x) => sstep(0.55, 0.8, x), tension: (x) => sstep(0.8, 1.0, x) * 0.9,
};

// Live player: all stems start sample-locked on one ctx time and loop; intensity crossfades gains.
export function createMusic(mixer, music, { intensity = 0.2, gain = 0.8 } = {}) {
  const ctx = mixer.ctx, out = ctx.createGain(); out.gain.value = gain; out.connect(mixer.bus('music'));
  const gains = {}; let srcs = [], cur = intensity;
  for (const n in music.stems) { const g = ctx.createGain(); g.gain.value = INTENSITY[n] ? INTENSITY[n](cur) : 1; g.connect(out); gains[n] = g; }
  return {
    get intensity() { return cur; },
    start(when = ctx.currentTime + 0.05) {
      this.stop(0);
      srcs = Object.entries(music.stems).map(([n, buf]) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(gains[n]); s.start(when); return s; });
    },
    stop(fade = 1) {
      const t = ctx.currentTime;
      for (const s of srcs) { try { s.stop(t + fade); } catch (e) { /* already stopped */ } }
      srcs = [];
    },
    // seconds = crossfade time constant-ish; call any time (e.g. from the game director)
    setIntensity(x, seconds = 2) {
      cur = Math.min(1, Math.max(0, x));
      const t = ctx.currentTime;
      for (const n in gains) gains[n].gain.setTargetAtTime(INTENSITY[n] ? INTENSITY[n](cur) : 1, t, seconds / 3);
    },
    output: out,
  };
}
