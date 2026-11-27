// Tuned SFX presets (recipes for synth.js), usable across genres. Every preset is a function
// (rnd, variant) => recipe so variants differ (footsteps ×4, impacts ×3 ...). Loudness is set by peakDb
// (relative mix): weapons ~-1.5, impacts ~-4, steps ~-10, UI ~-12, beds ~-8 — buses/volumes do the rest.
//
//   import { buildBank, PRESETS } from './sfx.js';
//   const bank = await buildBank(mixer.ctx, { sr: 44100 });   // { rifle: [AudioBuffer, AudioBuffer], step_concrete: [x4], ... }
//   mixer.addBank(bank);  mixer.play('rifle', { pos: muzzlePos, send: 0.5 });
//
// Design notes (why they sound like the real thing):
//  - gunshots = 3 parts: transient crack (HP white noise, <15 ms, slightly driven), body (pink noise LP-swept
//    5 kHz→400 Hz + pitch-dropping sine thump), tail (brown noise, slow LP sweep, slap echoes). Mechanics click on top.
//  - impacts on hard surfaces = modal resonators (`partials`, inharmonic ratios) excited by a short noise click.
//  - footsteps = heel click + body thump + surface texture (crackle grains for grass/snow, ring modes for metal).
//  - loops use `loop: seconds` (equal-power crossfade) or 'wrap' (periodic content) so they never click.
import { render, runJobs, toAudioBuffer } from './synth.js';

const j = (rnd, a, b) => a + (b - a) * rnd(); // jitter helper

function gunshot(rnd, o) {
  const body = o.body, tail = o.tail;
  return {
    dur: o.dur, peakDb: o.peakDb ?? -1.5,
    layers: [
      // crack: broadband transient, what makes it read as a gun not a door slam
      { type: 'noise', color: 'white', dur: 0.014, env: { a: 0.0002, d: 0.012 }, filters: [{ type: 'hp', f: o.crackHp ?? 1500 }], amp: o.crack ?? 1.0, drive: 2.5 },
      { type: 'impulse', dur: 0.002, amp: 0.8, filters: [{ type: 'bp', f: 2500, q: 0.7 }] },
      // body: chest-punch
      { type: 'noise', color: 'pink', dur: body * 1.6, env: { a: 0.0006, d: body }, filters: [{ type: 'lp', f: { from: o.bodyHi ?? 5000, to: o.bodyLo ?? 380, time: body * 0.7 }, q: 0.9 }], amp: 1.6, drive: 3 },
      { type: 'osc', wave: 'sine', freq: { from: o.thumpHi ?? 170, to: o.thumpLo ?? 46, time: 0.08 }, dur: body * 1.8, env: { a: 0.0008, d: body * 1.2 }, amp: o.thump ?? 1.1, drive: 2 },
      // tail: the environment answering
      { type: 'noise', color: 'brown', stereo: true, start: 0.006, dur: o.dur - 0.01, env: { a: 0.015, d: tail }, filters: [{ type: 'lp', f: { from: o.tailHi ?? 2400, to: 220, time: tail * 0.8 } }, { type: 'hp', f: 55 }], amp: o.tailAmp ?? 0.9 },
      // mechanism
      { type: 'noise', color: 'white', start: o.mech ?? 0.05 + j(rnd, 0, 0.012), dur: 0.03, env: { a: 0.0004, d: 0.02 }, filters: [{ type: 'bp', f: j(rnd, 2800, 3600), q: 5 }], amp: 0.22 },
      ...(o.extra || []),
    ],
    fx: [{ type: 'echo', time: j(rnd, 0.12, 0.16), fb: 0.22, mix: o.slap ?? 0.2, lp: 1600 }, { type: 'echo', time: j(rnd, 0.29, 0.36), fb: 0.12, mix: (o.slap ?? 0.2) * 0.6, lp: 900 }, { type: 'width', amt: 0.4 }],
  };
}

function impactHard(rnd, f0, modes, o = {}) {
  return {
    dur: o.dur ?? 0.7, peakDb: o.peakDb ?? -4,
    layers: [
      { type: 'noise', color: 'white', dur: 0.02, env: { a: 0.0002, d: 0.015 }, filters: [{ type: 'bp', f: o.clickF ?? 4000, q: 0.8 }], amp: 1 },
      { type: 'partials', freq: f0 * j(rnd, 0.85, 1.15), modes, inharm: 0.04, env: { a: 0.0003, d: o.ring ?? 0.6 }, amp: o.ringAmp ?? 0.5 },
      { type: 'noise', color: 'pink', dur: 0.08, env: { a: 0.0005, d: 0.05 }, filters: [{ type: 'lp', f: o.thudF ?? 900 }], amp: o.thud ?? 0.8, drive: 1.5 },
      ...(o.extra || []),
    ],
    fx: [{ type: 'width', amt: 0.25 }],
  };
}

// footstep factory. surface: concrete | metal | grass | snow
function step(surface) {
  return (rnd) => {
    const L = [];
    const heelT = j(rnd, 0, 0.004), toeT = j(rnd, 0.045, 0.075);
    if (surface === 'concrete' || surface === 'metal') {
      L.push({ type: 'noise', color: 'white', start: heelT, dur: 0.02, env: { a: 0.0003, d: 0.012 }, filters: [{ type: 'bp', f: j(rnd, 1800, 2600), q: 1.2 }], amp: 0.7 });
      L.push({ type: 'noise', color: 'pink', start: heelT, dur: 0.09, env: { a: 0.001, d: 0.05 }, filters: [{ type: 'lp', f: j(rnd, 260, 380) }], amp: 1.4 });
      L.push({ type: 'noise', color: 'white', start: toeT, dur: 0.07, env: { a: 0.004, d: 0.05 }, filters: [{ type: 'bp', f: j(rnd, 3000, 4500), q: 0.9 }], amp: 0.18 }); // scuff
      L.push({ type: 'noise', color: 'pink', start: toeT, dur: 0.05, env: { a: 0.001, d: 0.03 }, filters: [{ type: 'lp', f: 500 }], amp: 0.5 });
      if (surface === 'metal') L.push({ type: 'partials', start: heelT, dur: 0.4, freq: j(rnd, 280, 420), modes: [[1, 1, 0.35], [2.41, 0.6, 0.22], [3.93, 0.4, 0.15], [5.6, 0.25, 0.1]], inharm: 0.05, env: { a: 0.0005, d: 0.3 }, amp: 0.22 });
    } else if (surface === 'grass') {
      L.push({ type: 'noise', color: 'pink', start: heelT, dur: 0.08, env: { a: 0.004, d: 0.06 }, filters: [{ type: 'lp', f: 300 }], amp: 0.8 });
      L.push({ type: 'crackle', rate: { from: 1800, to: 200, time: 0.15 }, grain: 0.0012, start: heelT, dur: 0.2, env: { a: 0.01, d: 0.16 }, filters: [{ type: 'hp', f: 1800 }, { type: 'lp', f: 7000 }], amp: 0.5 });
      L.push({ type: 'noise', color: 'white', start: heelT + 0.01, dur: 0.18, env: { a: 0.03, d: 0.12 }, filters: [{ type: 'bp', f: j(rnd, 2500, 4000), q: 0.6 }], amp: 0.12 });
    } else { // snow: compacting crunch = dense band-limited grains + low thud
      L.push({ type: 'noise', color: 'pink', start: heelT, dur: 0.1, env: { a: 0.006, d: 0.07 }, filters: [{ type: 'lp', f: 260 }], amp: 0.9 });
      L.push({ type: 'crackle', rate: { from: 5000, to: 900, time: 0.18 }, grain: 0.0018, start: heelT + 0.005, dur: 0.24, env: { a: 0.02, d: 0.2 }, filters: [{ type: 'bp', f: j(rnd, 1400, 2200), q: 0.7 }], amp: 0.7 });
      L.push({ type: 'crackle', rate: 600, grain: 0.004, start: toeT, dur: 0.12, env: { a: 0.01, d: 0.1 }, filters: [{ type: 'bp', f: 900, q: 1 }], amp: 0.4 });
    }
    return { dur: 0.45, peakDb: -10 + j(rnd, -1.5, 0), layers: L };
  };
}

function reloadSeq() {
  // mag release click, mag out slide, mag in clack, bolt pull + release. ~1.3 s
  const click = (t, f, a, d = 0.015) => ({ type: 'noise', color: 'white', start: t, dur: d * 2, env: { a: 0.0002, d }, filters: [{ type: 'bp', f, q: 3 }], amp: a });
  const ring = (t, f, a) => ({ type: 'partials', start: t, dur: 0.2, freq: f, modes: [[1, 1, 0.12], [2.7, 0.5, 0.08], [5.1, 0.3, 0.05]], env: { a: 0.0003, d: 0.12 }, amp: a });
  const slide = (t, d, f0, f1, a) => ({ type: 'noise', color: 'white', start: t, dur: d, env: { a: d * 0.3, d: d * 0.8 }, filters: [{ type: 'bp', f: { from: f0, to: f1, time: d }, q: 2 }], amp: a });
  return (rnd) => ({
    dur: 1.35, peakDb: -6,
    layers: [
      click(0.0, 3200, 0.6), ring(0.0, 1900, 0.2),
      slide(0.04, 0.12, 1500, 900, 0.25),
      click(0.48, 2200, 0.8), click(0.5, 1200, 0.9, 0.02), ring(0.49, 1300, 0.3), // mag seated
      { type: 'noise', color: 'pink', start: 0.49, dur: 0.06, env: { a: 0.001, d: 0.04 }, filters: [{ type: 'lp', f: 450 }], amp: 0.8 },
      slide(0.86, 0.1, 1200, 2600, 0.35), click(0.95, 2800, 0.6), // bolt back
      click(1.08, 1800, 1.0, 0.02), ring(1.08, 1500, 0.35), click(1.1, 3800, 0.5), // bolt forward
    ],
    fx: [{ type: 'width', amt: 0.2 }],
  });
}

// --- PRESETS: name -> { variants, make(rnd, v) } ---
export const PRESETS = {
  rifle: { variants: 2, make: (r) => gunshot(r, { dur: 1.8, body: 0.16, tail: 1.3 }) },
  pistol: { variants: 2, make: (r) => gunshot(r, { dur: 1.1, body: 0.09, tail: 0.75, bodyLo: 520, thumpHi: 220, thumpLo: 70, thump: 0.7, tailAmp: 0.6, tailHi: 2800, crackHp: 2000 }) },
  shotgun: { variants: 2, make: (r) => gunshot(r, { dur: 2.2, body: 0.24, tail: 1.6, bodyLo: 260, thumpHi: 130, thumpLo: 36, thump: 1.5, tailAmp: 1.1, tailHi: 1800, slap: 0.26, mech: 0.6,
    extra: [{ type: 'noise', color: 'pink', start: 0.004, dur: 0.2, env: { a: 0.001, d: 0.14 }, filters: [{ type: 'lp', f: 2000 }], amp: 0.8, drive: 2 }] }) },
  explosion_near: { variants: 2, make: (r) => ({
    dur: 4.5, peakDb: -1.2,
    layers: [
      { type: 'noise', color: 'white', dur: 0.03, env: { a: 0.0002, d: 0.025 }, filters: [{ type: 'hp', f: 900 }], amp: 1.0, drive: 3 },
      { type: 'osc', wave: 'sine', freq: { from: 85, to: 24, time: 0.6 }, dur: 2.2, env: { a: 0.002, d: 1.6 }, amp: 1.6, drive: 2.5 },
      { type: 'noise', color: 'brown', stereo: true, dur: 4.4, env: { a: 0.004, d: 3.2 }, filters: [{ type: 'lp', f: { from: 4000, to: 140, time: 2.2 } }, { type: 'hp', f: 22 }], amp: 2.2, drive: 2.5 },
      { type: 'noise', color: 'pink', stereo: true, start: 0.02, dur: 1.2, env: { a: 0.01, d: 0.9 }, filters: [{ type: 'bp', f: { from: 1800, to: 300, time: 0.9 }, q: 0.6 }], amp: 0.9 },
      // debris rattle & crackle falling back
      { type: 'crackle', start: 0.35, dur: 2.5, rate: { from: 260, to: 10, time: 2.4 }, grain: 0.006, env: { a: 0.2, d: 2.2 }, filters: [{ type: 'bp', f: j(r, 1400, 2400), q: 0.8 }], amp: 0.25 },
    ],
    fx: [{ type: 'echo', time: j(r, 0.22, 0.3), fb: 0.3, mix: 0.25, lp: 700 }, { type: 'width', amt: 0.5 }],
  }) },
  explosion_far: { variants: 2, make: (r) => ({
    // distance eats the highs and smears the transient; long rolling echoes off terrain
    dur: 5, peakDb: -3,
    layers: [
      { type: 'osc', wave: 'sine', freq: { from: 60, to: 28, time: 0.8 }, dur: 2.5, env: { a: 0.03, d: 2 }, amp: 1.2, drive: 1.5 },
      { type: 'noise', color: 'brown', stereo: true, dur: 4.9, env: { a: 0.05, d: 3.8 }, filters: [{ type: 'lp', f: { from: 700, to: 120, time: 3 } }, { type: 'hp', f: 20 }], amp: 2.0, drive: 1.5 },
    ],
    fx: [{ type: 'echo', time: j(r, 0.45, 0.7), fb: 0.45, mix: 0.4, lp: 400 }, { type: 'width', amt: 0.6 }],
  }) },
  impact_metal: { variants: 3, make: (r) => impactHard(r, 820, [[1, 1, 0.7], [2.32, 0.7, 0.5], [4.25, 0.5, 0.32], [6.63, 0.35, 0.2], [9.38, 0.2, 0.12]], { clickF: 5000, ringAmp: 0.55, thud: 0.4 }) },
  impact_concrete: { variants: 3, make: (r) => impactHard(r, 1400, [[1, 0.6, 0.05], [1.7, 0.4, 0.04]], { dur: 0.45, ringAmp: 0.25, thudF: 700, thud: 1.0, clickF: 3000,
    extra: [{ type: 'crackle', start: 0.005, dur: 0.3, rate: { from: 3000, to: 100, time: 0.25 }, grain: 0.0015, env: { a: 0.002, d: 0.22 }, filters: [{ type: 'bp', f: 2600, q: 0.7 }], amp: 0.5 }] }) },
  impact_flesh: { variants: 3, make: (r) => ({
    dur: 0.4, peakDb: -4,
    layers: [
      { type: 'osc', wave: 'sine', freq: { from: 110, to: 55, time: 0.1 }, dur: 0.2, env: { a: 0.001, d: 0.12 }, amp: 1.0 },
      { type: 'noise', color: 'pink', dur: 0.15, env: { a: 0.001, d: 0.08 }, filters: [{ type: 'lp', f: 600 }], amp: 1.2, drive: 1.5 },
      { type: 'noise', color: 'white', start: 0.01, dur: 0.2, env: { a: 0.004, d: 0.13 }, filters: [{ type: 'bp', f: { from: j(r, 1300, 1700), to: 350, time: 0.15 }, q: 4 }], amp: 0.6 }, // wet squelch
    ],
  }) },
  step_concrete: { variants: 4, make: step('concrete') },
  step_metal: { variants: 4, make: step('metal') },
  step_grass: { variants: 4, make: step('grass') },
  step_snow: { variants: 4, make: step('snow') },
  reload: { variants: 1, make: reloadSeq() },
  dry_click: { variants: 1, make: () => ({ dur: 0.15, peakDb: -8, layers: [
    { type: 'noise', color: 'white', dur: 0.02, env: { a: 0.0002, d: 0.01 }, filters: [{ type: 'bp', f: 3500, q: 3 }], amp: 1 },
    { type: 'partials', dur: 0.12, freq: 2100, modes: [[1, 1, 0.06], [2.6, 0.5, 0.04]], amp: 0.3 }] }) },
  ui_click: { variants: 1, make: () => ({ dur: 0.06, peakDb: -12, layers: [
    { type: 'osc', wave: 'sine', freq: { from: 2400, to: 1600, time: 0.02 }, dur: 0.05, env: { a: 0.0005, d: 0.03 }, amp: 1 },
    { type: 'noise', color: 'white', dur: 0.006, env: { a: 0.0001, d: 0.005 }, filters: [{ type: 'hp', f: 5000 }], amp: 0.4 }] }) },
  ui_hover: { variants: 1, make: () => ({ dur: 0.08, peakDb: -18, layers: [
    { type: 'osc', wave: 'sine', freq: 3200, dur: 0.07, env: { a: 0.004, d: 0.05 }, amp: 1 }] }) },
  ui_confirm: { variants: 1, make: () => ({ dur: 0.45, peakDb: -10, layers: [
    { type: 'osc', wave: 'sine', freq: 659.3, fm: { ratio: 3.5, index: { from: 2, to: 0.01, time: 0.2 } }, dur: 0.2, env: { a: 0.002, d: 0.25 }, amp: 0.8 },
    { type: 'osc', wave: 'sine', freq: 987.8, fm: { ratio: 3.5, index: { from: 2, to: 0.01, time: 0.2 } }, start: 0.08, dur: 0.37, env: { a: 0.002, d: 0.35 }, amp: 0.8 }],
    fx: [{ type: 'echo', time: 0.11, fb: 0.2, mix: 0.18, lp: 4000 }] }) },
  pickup: { variants: 1, make: () => ({ dur: 0.6, peakDb: -9, layers: [0, 4, 7, 12].map((s, i) => (
    { type: 'osc', wave: 'tri', freq: 523.25 * Math.pow(2, s / 12), start: i * 0.055, dur: 0.6 - i * 0.055, env: { a: 0.002, d: 0.3 }, amp: 0.6, fm: { ratio: 2, index: 0.6 } })),
    fx: [{ type: 'echo', time: 0.09, fb: 0.25, mix: 0.2, lp: 5000 }, { type: 'width', amt: 0.4 }] }) },
  alarm: { variants: 1, make: () => ({
    // European two-tone klaxon, 1.2 s period, loopable
    dur: 1.2, loop: 'wrap', tail: 0.05, peakDb: -6,
    layers: [
      { type: 'osc', wave: 'saw', freq: [[0, 440], [0.598, 440], [0.602, 587], [1.2, 587]], dur: 1.2, env: { a: 0.002, s: 1, r: 0.002 }, amp: 0.6, filters: [{ type: 'bp', f: 1400, q: 0.7 }, { type: 'peak', f: 2600, q: 2, gain: 6 }], drive: 1.6 },
      { type: 'osc', wave: 'square', freq: [[0, 442], [0.598, 442], [0.602, 590], [1.2, 590]], dur: 1.2, env: { a: 0.002, s: 1, r: 0.002 }, amp: 0.2, filters: [{ type: 'lp', f: 2000 }] },
    ],
  }) },
  drone_hum: { variants: 1, make: () => ({
    // 50 Hz mains / machinery hum: harmonic stack + slow beating + rumble. 4 s = 200 cycles -> periodic
    dur: 4, loop: 0.5, peakDb: -9,
    layers: [
      ...[[1, 0.8], [2, 1], [3, 0.5], [4, 0.35], [6, 0.18], [8, 0.08]].map(([h, a], i) => ({ type: 'osc', wave: 'sine', freq: 50 * h + (i % 2 ? 0.25 : -0.25), env: { a: 0.01, s: 1, r: 0.01 }, amp: a * 0.5, pan: i % 2 ? 0.3 : -0.3 })),
      { type: 'noise', color: 'brown', stereo: true, env: { a: 0.01, s: 1, r: 0.01 }, filters: [{ type: 'lp', f: 200 }], amp: 0.6, am: { f: 0.25, depth: 0.3 } },
    ],
  }) },
  engine_idle: { variants: 1, make: (r) => engine(r, 900, 0.2) },
  engine_high: { variants: 1, make: (r) => engine(r, 900, 1.0) },
  wind: { variants: 1, make: () => ({
    dur: 10, loop: 2, peakDb: -9,
    layers: [
      { type: 'noise', color: 'pink', stereo: true, env: { a: 0.01, s: 1, r: 0.01 }, filters: [{ type: 'bp', f: (t) => 500 + 300 * Math.sin(t * 0.7) + 180 * Math.sin(t * 1.9 + 1), q: 0.8 }], amp: 1, am: { f: 0.13, depth: 0.5 } },
      { type: 'noise', color: 'brown', stereo: true, env: { a: 0.01, s: 1, r: 0.01 }, filters: [{ type: 'lp', f: 300 }], amp: 0.8, am: { f: 0.21, depth: 0.4 } },
      // whistle around edges: narrow resonance gliding slowly
      { type: 'noise', color: 'white', env: { a: 0.01, s: 1, r: 0.01 }, filters: [{ type: 'bp', f: (t) => 1300 + 250 * Math.sin(t * 0.45), q: 18 }], amp: 0.5, am: { f: 0.1, depth: 0.85 } },
    ],
    fx: [{ type: 'width', amt: 0.5 }],
  }) },
  rain: { variants: 1, make: () => ({
    dur: 8, loop: 1, peakDb: -9,
    layers: [
      { type: 'noise', color: 'pink', stereo: true, env: { a: 0.01, s: 1, r: 0.01 }, filters: [{ type: 'hp', f: 400 }, { type: 'lp', f: 7000 }], amp: 0.6 },
      // droplets: crackle grains through two bands (near ticks, far patter)
      { type: 'crackle', rate: 900, grain: 0.0009, env: { a: 0.01, s: 1, r: 0.01 }, filters: [{ type: 'hp', f: 2500 }], amp: 0.6, pan: -0.4 },
      { type: 'crackle', rate: 900, grain: 0.0009, env: { a: 0.01, s: 1, r: 0.01 }, filters: [{ type: 'hp', f: 2500 }], amp: 0.6, pan: 0.4 },
      { type: 'crackle', rate: 60, grain: 0.006, env: { a: 0.01, s: 1, r: 0.01 }, filters: [{ type: 'bp', f: 1200, q: 1.5 }], amp: 0.5 }, // drips on puddles
    ],
    fx: [{ type: 'width', amt: 0.3 }],
  }) },
  sea: { variants: 1, make: () => ({
    // two 7 s wave cycles: swell (brown, LP follows amplitude) + wash/hiss on the break
    dur: 14, loop: 2, peakDb: -8,
    layers: [
      { type: 'noise', color: 'brown', stereo: true, env: (t) => 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 7 - 1.2), 2), filters: [{ type: 'lp', f: (t) => 250 + 700 * Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 7 - 1.2), 3) }], amp: 1.4 },
      { type: 'noise', color: 'pink', stereo: true, env: (t) => 0.05 + 0.6 * Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 / 7 - 2.2)), 4), filters: [{ type: 'hp', f: 900 }, { type: 'lp', f: 6000 }], amp: 0.6 },
    ],
    fx: [{ type: 'width', amt: 0.5 }],
  }) },
  growl: { variants: 2, make: (r) => ({
    // creature: rough pulse source with jittery pitch -> vowel formants 'aa' -> drive
    dur: 1.6, peakDb: -3,
    layers: [
      { type: 'osc', wave: 'saw', voices: 3, detune: 25, freq: (t) => (70 + 20 * Math.sin(t * 7.3) + 12 * Math.sin(t * 23)) * (1 + 0.3 * Math.sin(Math.min(t, 1.6) * 1.9)), env: { a: 0.12, h: 0.5, d: 1.2 }, am: { f: 31, depth: 0.6 },
        filters: [{ type: 'peak', f: j(r, 600, 780), q: 3, gain: 14 }, { type: 'peak', f: j(r, 1050, 1250), q: 4, gain: 10 }, { type: 'lp', f: 2600 }], amp: 0.6, drive: 2.5 },
      { type: 'noise', color: 'pink', env: { a: 0.1, h: 0.5, d: 1.0 }, filters: [{ type: 'bp', f: 700, q: 2 }], amp: 0.5, am: { f: 27, depth: 0.7 } },
    ],
    fx: [{ type: 'width', amt: 0.3 }],
  }) },
  laser: { variants: 2, make: (r) => ({
    dur: 0.45, peakDb: -4,
    layers: [
      { type: 'osc', wave: 'saw', freq: { from: j(r, 2200, 2800), to: 180, time: 0.3 }, fm: { ratio: 0.5, index: 1.5 }, dur: 0.4, env: { a: 0.001, d: 0.35 }, amp: 0.5, filters: [{ type: 'lp', f: { from: 9000, to: 1200, time: 0.3 } }] },
      { type: 'osc', wave: 'sine', freq: { from: 1400, to: 90, time: 0.25 }, dur: 0.35, env: { a: 0.001, d: 0.3 }, amp: 0.7 },
      { type: 'noise', color: 'white', dur: 0.03, env: { a: 0.0003, d: 0.02 }, filters: [{ type: 'hp', f: 3000 }], amp: 0.5 },
    ],
    fx: [{ type: 'comb', delay: 0.004, fb: 0.6, mix: 0.35 }, { type: 'echo', time: 0.08, fb: 0.3, mix: 0.2, lp: 3000 }],
  }) },
  whoosh: { variants: 2, make: (r) => ({
    dur: 0.7, peakDb: -6,
    layers: [{ type: 'noise', color: 'pink', stereo: true, env: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.65)), 2), filters: [{ type: 'bp', f: (t) => 300 + j(r, 1200, 1600) * Math.sin(Math.PI * Math.min(1, t / 0.65)), q: 1.4 }], amp: 1.2 }],
    fx: [{ type: 'width', amt: 0.4 }],
  }) },
  ricochet: { variants: 2, make: (r) => ({
    dur: 0.8, peakDb: -6,
    layers: [
      { type: 'noise', color: 'white', dur: 0.01, env: { a: 0.0002, d: 0.008 }, filters: [{ type: 'hp', f: 3000 }], amp: 0.6 },
      { type: 'osc', wave: 'sine', freq: (t) => j(r, 3200, 4200) * Math.exp(-t * 1.8) * (1 + 0.04 * Math.sin(t * 70)), dur: 0.75, env: { a: 0.003, d: 0.6 }, amp: 0.5 },
      { type: 'noise', color: 'white', dur: 0.6, env: { a: 0.005, d: 0.4 }, filters: [{ type: 'bp', f: { from: 4000, to: 1500, time: 0.6 }, q: 6 }], amp: 0.3 },
    ],
    fx: [{ type: 'echo', time: 0.13, fb: 0.2, mix: 0.2, lp: 2500 }],
  }) },
  whiz: { variants: 2, make: () => ({ // bullet passing by: short band-noise doppler dip
    dur: 0.25, peakDb: -7,
    layers: [{ type: 'noise', color: 'white', env: (t) => Math.exp(-Math.pow((t - 0.06) / 0.03, 2)), filters: [{ type: 'bp', f: { from: 5000, to: 1800, time: 0.12 }, q: 3 }], amp: 1 }],
  }) },
};

// Engine: 4-stroke, 4 cylinders -> firing frequency = rpm/60*2. Pulse train through an exhaust resonance,
// per-cylinder level differences give the "lope". The loop holds an integer number of firing cycles so
// playbackRate = rpm/baseRpm keeps it seamless. `load` (0..1) adds roughness/drive/intake noise.
function engine(rnd, baseRpm, load) {
  const ff = baseRpm / 60 * 2, cycles = Math.round(2 * ff), dur = cycles / ff;
  const cyl = [1, 0.82 + rnd() * 0.1, 0.95, 0.78 + rnd() * 0.1];
  return {
    dur, loop: 'wrap', tail: 0.05, peakDb: -7,
    layers: [
      { type: 'custom', gen: function* (out, i0, n, sr, r) {
        let k = 0;
        const per = sr / ff;
        for (let c = 0; c * per < n; c++) {
          const s0 = Math.round(c * per), a = cyl[c % 4] * (0.85 + 0.3 * r() * load);
          for (let i = 0; i < per * 0.6 && s0 + i < out.L.length; i++) {
            const t = i / sr, v = a * Math.exp(-t * (180 - 60 * load)) * Math.sin(2 * Math.PI * (ff * 2.2) * t + 0.3);
            out.L[s0 + i] += v; out.R[s0 + i] += v;
          }
          if (++k % 32 === 0) yield;
        }
      } },
      { type: 'noise', color: 'pink', env: { a: 0.001, s: 1, r: 0.001 }, filters: [{ type: 'bp', f: 1800, q: 0.7 }], amp: 0.05 + 0.15 * load },
    ],
    fx: [{ type: 'lp', f: 900 + 1400 * load, q: 1.2 }, { type: 'peak', f: ff * 3, q: 3, gain: 6 }, { type: 'drive', k: 1.5 + 2.5 * load }, { type: 'hp', f: 25 }],
  };
}

export const ENGINE_BASE_RPM = 900;

// Expand presets into render jobs: [{name, variant, gen}]
export function presetJobs({ sr = 44100, only = null, seed = 1 } = {}) {
  const out = [];
  for (const name in PRESETS) {
    if (only && !only.includes(name)) continue;
    const p = PRESETS[name];
    for (let v = 0; v < (p.variants || 1); v++) {
      const s = seed * 131 + v * 7919 + name.length * 31 + name.charCodeAt(0);
      const recipe = p.make(rnd(s), v);
      out.push({ name, variant: v, gen: render(recipe, { sr, seed: s, name: `${name}#${v}` }) });
    }
  }
  return out;
}
const rnd = (s) => { let x = s >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); };

// Render the whole bank (time-sliced). Resolves to { name: AudioBuffer[] } (or raw {L,R,sr} when ctx is null).
export async function buildBank(ctx, { sr = 44100, only = null, budgetMs = 6, onProgress } = {}) {
  const jobs = presetJobs({ sr, only });
  const res = await runJobs(jobs.map((jb) => jb.gen), { budgetMs, onProgress });
  const bank = {};
  jobs.forEach((jb, i) => { (bank[jb.name] ||= [])[jb.variant] = ctx ? toAudioBuffer(ctx, res[i]) : res[i]; });
  return bank;
}

// Engine voice with an rpm parameter: two baked loops (idle-load / high-load) played together,
// playbackRate = rpm / ENGINE_BASE_RPM (loops hold whole firing cycles, so they stay seamless at any rate),
// gains crossfade by `load` (0 coasting .. 1 full throttle). Call set() every frame — it only schedules params.
//   const eng = engineVoice(mixer, { follow: car });  eng.set(rpm, throttle);  eng.stop();
export function engineVoice(mixer, { follow = null, pos = null, gain = 1, bus = 'sfx', send = 0.15 } = {}) {
  const o = { loop: true, follow, pos, bus, send, pitchJitter: 0, gain: 0 };
  const lo = mixer.play('engine_idle', o), hi = mixer.play('engine_high', o);
  let lastR = -1, lastL = -1;
  return {
    set(rpm, load = 0.3) {
      const r = Math.max(0.35, Math.min(4.5, rpm / ENGINE_BASE_RPM)), l = Math.max(0, Math.min(1, load));
      if (Math.abs(r - lastR) > 0.004) { lo && lo.setRate(r); hi && hi.setRate(r); lastR = r; }
      if (Math.abs(l - lastL) > 0.01) {
        const v = gain * (0.55 + 0.45 * Math.min(1, r / 3)); // louder as it revs
        lo && lo.setGain(v * Math.cos(l * Math.PI / 2)); hi && hi.setGain(v * Math.sin(l * Math.PI / 2)); lastL = l;
      }
    },
    stop(fade = 0.3) { lo && lo.stop(fade); hi && hi.stop(fade); },
  };
}
