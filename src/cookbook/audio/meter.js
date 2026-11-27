// Offline audio meter + self-test. No AudioContext needed (works headless / before the unlock gesture).
//   import { installAudioSelfTest } from './meter.js'; installAudioSelfTest();
//   const r = await window.__audioSelfTest();   // { pass, rows:[{name, peakDb, rmsDb, nan, silent, clip, pass, ms}], ms }
// Pass rule per sound: peak <= -1 dBFS, no NaN/Inf, not silent (RMS > -60 dBFS), no |x| >= 1.
// IRs are checked only for NaN/silence (the ConvolverNode normalises them).
import { runJobs, gainToDb } from './synth.js';
import { presetJobs } from './sfx.js';
import { stemJobs, SONGS } from './music.js';
import { renderIR, IR_KINDS } from './reverb.js';

export function analyse(res) {
  let peak = 0, sum = 0, nan = 0, clip = 0, n = 0;
  for (const x of [res.L, res.R]) for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) { nan++; continue; }
    const a = Math.abs(v); if (a > peak) peak = a; if (a >= 1) clip++;
    sum += v * v; n++;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  return { peakDb: +gainToDb(peak).toFixed(2), rmsDb: +gainToDb(rms).toFixed(1), nan, clip, silent: !(rms > 0.001), dur: +(res.L.length / res.sr).toFixed(2) };
}

export async function audioSelfTest({ sr = 44100, verbose = true } = {}) {
  const t0 = performance.now();
  const jobs = [
    ...presetJobs({ sr }).map((j) => ({ name: `${j.name}#${j.variant}`, gen: j.gen })),
    ...Object.keys(SONGS).flatMap((s) => stemJobs(SONGS[s], { sr: 32000 }).map((j) => ({ name: `music.${s}.${j.name}`, gen: j.gen }))),
    ...Object.keys(IR_KINDS).map((k) => ({ name: 'ir_' + k, gen: renderIR(k, { sr }), ir: true })),
  ];
  const rows = [];
  for (const j of jobs) { // one at a time so each row gets its own timing
    const a = performance.now();
    const [res] = await runJobs([j.gen], { budgetMs: 50 });
    const m = analyse(res);
    const pass = m.nan === 0 && !m.silent && (j.ir || (m.peakDb <= -1 && m.clip === 0));
    rows.push({ name: j.name, ...m, ms: Math.round(performance.now() - a), pass });
  }
  const out = { pass: rows.every((r) => r.pass), count: rows.length, failed: rows.filter((r) => !r.pass).map((r) => r.name), ms: Math.round(performance.now() - t0), rows };
  if (verbose && console.table) console.table(rows);
  return out;
}

export function installAudioSelfTest(opts) {
  window.__audioSelfTest = (o) => audioSelfTest({ ...opts, ...o });
}
