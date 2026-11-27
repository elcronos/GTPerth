#!/usr/bin/env node
// STATE.json for resumable runs: the lead (or any agent after a context reset) reads it first and continues
// from the recorded phase/round instead of starting over. Atomic writes (tmp + rename).
//   node state.mjs init --name "Harbour Run" [--file STATE.json]
//   node state.mjs show                              pretty summary
//   node state.mjs get [dot.path]                    JSON value (whole state without a path)
//   node state.mjs set dot.path <json|string>        e.g. set look.locked true · set spec "SPEC.md"
//   node state.mjs phase <name>                      spec | contracts | lookdev | build | critic | perf | ship | done
//   node state.mjs round next                        increments round, stamps time
//   node state.mjs score <number> [--shots dir] [--build dist/x.html]   records a critic score; keeps best-so-far
//   node state.mjs gate <G1|G2|G3|G4|size> <pass|fail> ["note"]
//   node state.mjs defect add "text" [--sev blocker|major|minor] [--owner world] [--pose 3]
//   node state.mjs defect close <id> ["how"]
//   node state.mjs defects                           open defects, most severe first
// import { load, save, update } from './state.mjs' for programmatic use.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

const SEV = { blocker: 0, major: 1, minor: 2 };
export const blank = (name = 'game') => ({
  name, phase: 'spec', round: 0, created: new Date().toISOString(), updated: null,
  best: { score: null, round: null, shots: null, build: null }, scores: [],
  gates: { G1: null, G2: null, G3: null, G4: null, size: null },
  defects: [], nextDefect: 1, notes: [],
});
export function load(file = 'STATE.json') { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; }
export function save(s, file = 'STATE.json') {
  s.updated = new Date().toISOString();
  writeFileSync(file + '.tmp', JSON.stringify(s, null, 2)); renameSync(file + '.tmp', file);
  return s;
}
export function update(fn, file = 'STATE.json') { const s = load(file) || blank(); fn(s); return save(s, file); }
const getPath = (o, p) => (p ? p.split('.').reduce((a, k) => (a == null ? a : a[k]), o) : o);
const setPath = (o, p, v) => { const ks = p.split('.'); let a = o; for (const k of ks.slice(0, -1)) a = a[k] ??= {}; a[ks.at(-1)] = v; };
const parseVal = (v) => { try { return JSON.parse(v); } catch { return v; } };

if (process.argv[1] && process.argv[1].endsWith('state.mjs')) {
  const argv = process.argv.slice(2);
  const flags = {}, pos = [];
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1]; i++; } else pos.push(argv[i]); }
  const file = flags.file || 'STATE.json';
  const [cmd, a, b, c] = pos;
  const need = () => { const s = load(file); if (!s) { console.error(`${file} not found — run: node state.mjs init --name X`); process.exit(1); } return s; };
  const now = () => new Date().toISOString();
  let s;
  switch (cmd) {
    case 'init': if (load(file) && !flags.force) { console.error(`${file} exists (use --force)`); process.exit(1); } save(blank(flags.name), file); console.log(`created ${file}`); break;
    case 'get': console.log(JSON.stringify(getPath(need(), a), null, 2)); break;
    case 'set': s = need(); setPath(s, a, parseVal(b)); save(s, file); console.log(`${a} = ${JSON.stringify(getPath(s, a))}`); break;
    case 'phase': s = need(); s.phase = a; s.notes.push({ t: now(), note: 'phase → ' + a }); save(s, file); console.log('phase', a); break;
    case 'round': s = need(); if (a === 'next') { s.round++; s.notes.push({ t: now(), note: 'round ' + s.round }); } save(s, file); console.log('round', s.round); break;
    case 'score': {
      s = need(); const v = +a; s.scores.push({ round: s.round, score: v, t: now(), shots: flags.shots || null });
      if (s.best.score == null || v > s.best.score) s.best = { score: v, round: s.round, shots: flags.shots || null, build: flags.build || null };
      save(s, file); console.log(`score ${v} (best ${s.best.score} @ round ${s.best.round})`); break;
    }
    case 'gate': s = need(); s.gates[a] = { pass: b === 'pass', note: c || '', round: s.round, t: now() }; save(s, file); console.log(`${a} ${b}`); break;
    case 'defect':
      s = need();
      if (a === 'add') { const d = { id: s.nextDefect++, text: b, sev: flags.sev || 'major', owner: flags.owner || null, pose: flags.pose || null, round: s.round, open: true, t: now() }; s.defects.push(d); console.log(`defect #${d.id} added`); }
      else if (a === 'close') { const d = s.defects.find((x) => x.id === +b); if (!d) { console.error('no defect ' + b); process.exit(1); } d.open = false; d.closed = { round: s.round, how: c || '', t: now() }; console.log(`defect #${d.id} closed`); }
      save(s, file); break;
    case 'defects': {
      s = need(); const open = s.defects.filter((d) => d.open).sort((x, y) => SEV[x.sev] - SEV[y.sev]);
      for (const d of open) console.log(`#${d.id} [${d.sev}]${d.owner ? ' (' + d.owner + ')' : ''}${d.pose ? ' pose ' + d.pose : ''} ${d.text}`);
      if (!open.length) console.log('no open defects'); break;
    }
    case 'show': case undefined: {
      s = need(); const open = s.defects.filter((d) => d.open);
      console.log(`${s.name}  phase ${s.phase}  round ${s.round}  best ${s.best.score ?? '—'}${s.best.round != null ? ' @r' + s.best.round : ''}`);
      console.log('gates: ' + Object.entries(s.gates).map(([k, v]) => `${k}:${v ? (v.pass ? 'pass' : 'FAIL') : '—'}`).join('  '));
      console.log(`open defects: ${open.length} (${open.filter((d) => d.sev === 'blocker').length} blockers)`);
      break;
    }
    default: console.error('unknown command ' + cmd); process.exit(1);
  }
}
