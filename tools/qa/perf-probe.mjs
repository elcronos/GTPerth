#!/usr/bin/env node
/**
 * Perf probe for a 3D web game (generic; copy into tools/qa/).
 *
 *   node tools/qa/perf-probe.mjs --base http://localhost:3301 [--spots tools/qa/perf.spots.json]
 *        [--route /] [--tier-param quality] [--enter "<js expr>"] [--hook __GAME__]
 *        [--tiers low,medium,high] [--runs 3] [--sample 3000] [--viewport 1440x900] [--dpr 2]
 *        [--cpu 4] [--cold] [--sweep] [--tier-switch] [--click [action]] [--click-key <state key>]
 *        [--close "<js expr>"] [--json out.json]
 *
 * The hook (templates/game-hook.ts) is stripped from a normal production build, so build a QA production
 * build that keeps it, into its own dist dir so the deploy build is never overwritten:
 *   NEXT_PUBLIC_QA_HOOK=1 NEXT_DIST_DIR=.next-qa next build && NEXT_DIST_DIR=.next-qa next start -p 3301
 * (Vite: VITE_QA_HOOK=1 vite build --outDir dist-qa && vite preview --outDir dist-qa --port 3301.)
 * Without it the probe times out waiting for window.__GAME__.ready.
 *
 * Protocol (numbers are only comparable when all of these hold):
 *   - run against a QA PRODUCTION build (above), never `next dev`;
 *   - real GPU flags, vsync and frame-rate limit off;
 *   - fixed viewport + DPR; adaptive ladder pinned via __GAME__.pinPerf(0) when available;
 *   - teleport to named spots and set the hour, wait for settle, sample rAF frame times;
 *   - median of N runs; machine load average logged (concurrent lanes make fps a lower bound);
 *   - --cold uses a fresh browser profile per run (shader cache cold) and records time-to-ready;
 *   - --cpu N applies CPU throttling via CDP (phone-like main thread);
 *   - --sweep runs a fast time-of-day sweep and reports the worst frame (light-count or shader
 *     recompiles show up here as multi-hundred-ms frames);
 *   - --enter <expr> runs after ready (same role as shot-matrix enterExpr): spots set while a title menu
 *     is open do not teleport;
 *   - --tier-switch samples rAF while switching high -> low -> high at the first spot and reports
 *     tierSwitch.worstFrameMs (DoD: no frame > 100 ms during a tier switch);
 *   - --click [action] (default 'interact') stamps performance.now(), calls input(action) at the first spot
 *     with "click": true (else the first spot), and reports clickToFeedbackMs = time to the first rAF in
 *     which the state snapshot changed. Use --click-key <key> (e.g. mode, dialogue) to watch one state key;
 *     the whole snapshot can change on its own (player idle motion), which the probe detects and flags as
 *     clickBaselineNoisy. --close <expr> runs afterwards (default input('back')).
 * Output: per tier x spot {p50, p95, p99, worst, longFrames>33ms, fps, renderInfo} plus load and bytes.
 * Spots file: [{"id":"hero","teleport":{"x":0,"z":0,"yaw":0},"time":14}, ...]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const flag = (k) => argv.includes(`--${k}`);
const base = arg('base', 'http://localhost:3301');
const hook = arg('hook', '__GAME__');
const tiers = arg('tiers', 'low,medium,high').split(',');
const runs = Number(arg('runs', 3));
const sampleMs = Number(arg('sample', 3000));
const [vw, vh] = arg('viewport', '1440x900').split('x').map(Number);
const dpr = Number(arg('dpr', 2));
const cpu = Number(arg('cpu', 1));
const route = arg('route', '/');
const tierParam = arg('tier-param', 'quality');
const enterExpr = arg('enter');
const clickAction = flag('click') ? arg('click', 'interact') : null;
const clickKey = arg('click-key');
const closeExpr = arg('close');
const spots = arg('spots') ? JSON.parse(fs.readFileSync(arg('spots'), 'utf8')) : [{ id: 'spawn' }];

function findChrome() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  try {
    const cache = process.platform === 'darwin' ? '~/Library/Caches/ms-playwright' : '~/.cache/ms-playwright';
    return execSync(`find ${cache} -type f -perm -u+x \\( -name 'Google Chrome for Testing' -o -name Chromium -o -name chrome \\) 2>/dev/null | grep -v headless | sort | tail -1`, { shell: '/bin/bash' }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}
const args = [
  ...(process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=vulkan']),
  '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit',
];
const { chromium } = await import(path.resolve(process.cwd(), 'node_modules/playwright/index.mjs'));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (s, p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];

async function openPage(tier) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    executablePath: findChrome(), headless: !flag('headed'), args,
    viewport: { width: vw, height: vh }, deviceScaleFactor: dpr,
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  let bytes = 0;
  page.on('response', async (r) => { const l = Number(r.headers()['content-length'] ?? 0); bytes += l; });
  if (cpu > 1) { const s = await ctx.newCDPSession(page); await s.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
  const t0 = Date.now();
  const u = new URL(route, base); if (tierParam) u.searchParams.set(tierParam, tier);
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction((h) => !!window[h]?.ready, hook, { timeout: 240000 });
  const readyMs = Date.now() - t0;
  if (enterExpr) { await page.evaluate(enterExpr); await page.waitForTimeout(500); }
  await page.evaluate((h) => window[h]?.pinPerf?.(0), hook);
  return { ctx, page, readyMs, bytes: () => bytes, userDir };
}

async function goSpot(page, spot) {
  await page.evaluate(([h, s]) => {
    const g = window[h];
    if (s.teleport) g.teleport?.(s.teleport.x, s.teleport.z, s.teleport.yaw);
    if (s.camera) g.camera?.set?.(s.camera);
    if (s.time != null) { g.time?.set?.(s.time); g.time?.speed?.(0); }
  }, [hook, spot]);
  await page.waitForTimeout(spot.settleMs ?? 1500);
}

// rAF sampling while switching tiers at fixed offsets; worst frame is the freeze a player sees.
async function tierSwitch(page, from) {
  return page.evaluate(([h, hi]) => new Promise((res) => {
    const g = window[h]; const f = []; let last = performance.now(); const t0 = last;
    const plan = [[1000, 'low'], [3500, hi]]; let k = 0;
    const step = (t) => {
      f.push(t - last); last = t;
      if (k < plan.length && t - t0 >= plan[k][0]) { g.setTier?.(plan[k][1]); k++; }
      if (t - t0 < 6500) requestAnimationFrame(step);
      else res({ worstFrameMs: Math.round(Math.max(...f.slice(2))), framesOver100: f.filter((x) => x > 100).length, sequence: `${hi}->low->${hi}` });
    };
    requestAnimationFrame(step);
  }), [hook, from]);
}

// Click-to-feedback latency: time from input(action) to the first rAF where the watched state changed.
async function clickLatency(page) {
  return page.evaluate(([h, action, key]) => new Promise((res) => {
    const g = window[h];
    const snap = () => { try { const s = g.state; return JSON.stringify(key ? s?.[key] : s); } catch { return null; } };
    // baseline: does the watched state change by itself over a few frames?
    const b0 = snap(); let n = 0;
    const base = () => {
      if (++n < 5) return requestAnimationFrame(base);
      const noisy = snap() !== b0;
      const before = snap(); const t0 = performance.now();
      g.input?.(action);
      const watch = (t) => {
        if (snap() !== before) return res({ clickToFeedbackMs: +(t - t0).toFixed(1), clickBaselineNoisy: noisy, action, key: key ?? null });
        if (t - t0 > 3000) return res({ clickToFeedbackMs: null, clickBaselineNoisy: noisy, action, key: key ?? null, error: 'no state change within 3000 ms' });
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(base);
  }), [hook, clickAction, clickKey ?? null]);
}

async function sample(page, ms) {
  return page.evaluate((dur) => new Promise((res) => {
    const f = []; let last = performance.now(); const end = last + dur;
    const step = (t) => { f.push(t - last); last = t; if (t < end) requestAnimationFrame(step); else res(f.slice(2)); };
    requestAnimationFrame(step);
  }), ms);
}

const results = { base, route, viewport: `${vw}x${vh}`, dpr, cpu, runs, load: os.loadavg(), renderer: null, tiers: {} };
for (const tier of tiers) {
  results.tiers[tier] = {};
  const perSpot = Object.fromEntries(spots.map((s) => [s.id, []]));
  const ready = [];
  let page; let session;
  for (let r = 0; r < runs; r++) {
    if (!session || flag('cold')) {
      if (session) { await session.ctx.close(); fs.rmSync(session.userDir, { recursive: true, force: true }); }
      session = await openPage(tier); page = session.page; ready.push(session.readyMs);
      results.renderer ??= await page.evaluate(() => {
        const c = document.createElement('canvas').getContext('webgl2');
        const e = c?.getExtension('WEBGL_debug_renderer_info');
        return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
      });
    }
    for (const spot of spots) {
      await goSpot(page, spot);
      const frames = (await sample(page, sampleMs)).sort((a, b) => a - b);
      const info = await page.evaluate(async (h) => (await window[h]?.renderInfo?.()) ?? null, hook); // async: one full frame incl. post
      perSpot[spot.id].push({ p50: pct(frames, 0.5), p95: pct(frames, 0.95), p99: pct(frames, 0.99), worst: frames.at(-1), long: frames.filter((x) => x > 33).length, n: frames.length, info });
    }
  }
  if (flag('sweep')) {
    const worst = await page.evaluate(([h, ms]) => new Promise((res) => {
      const g = window[h]; let hr = 0; let w = 0; let last = performance.now(); const end = last + ms;
      const step = (t) => { w = Math.max(w, t - last); last = t; hr = (hr + 0.25) % 24; g.time?.set?.(hr); if (t < end) requestAnimationFrame(step); else res(w); };
      requestAnimationFrame(step);
    }), [hook, 8000]);
    results.tiers[tier].sweepWorstFrameMs = Math.round(worst);
  }
  if (clickAction) {
    await goSpot(page, spots.find((s) => s.click) ?? spots[0]);
    results.tiers[tier].click = await clickLatency(page);
    results.tiers[tier].clickToFeedbackMs = results.tiers[tier].click.clickToFeedbackMs;
    await page.evaluate(closeExpr ?? `window[${JSON.stringify(hook)}]?.input?.('back')`);
  }
  for (const [id, rs] of Object.entries(perSpot)) {
    const p50 = median(rs.map((x) => x.p50));
    results.tiers[tier][id] = {
      fps: +(1000 / p50).toFixed(1), p50: +p50.toFixed(2), p95: +median(rs.map((x) => x.p95)).toFixed(2),
      p99: +median(rs.map((x) => x.p99)).toFixed(2), worst: +Math.max(...rs.map((x) => x.worst)).toFixed(1),
      longFrames: median(rs.map((x) => x.long)), renderInfo: rs.at(-1).info,
    };
  }
  results.tiers[tier].readyMs = median(ready);
  results.tiers[tier].bytes = session.bytes();
  await session.ctx.close(); fs.rmSync(session.userDir, { recursive: true, force: true });
}
if (flag('tier-switch')) {
  const hi = tiers.includes('high') ? 'high' : tiers.at(-1);
  const s = await openPage(hi);
  await goSpot(s.page, spots[0]);
  results.tierSwitch = await tierSwitch(s.page, hi);
  results.tierSwitchWorstFrameMs = results.tierSwitch.worstFrameMs;
  if (results.tierSwitch.worstFrameMs > 100) results.tierSwitch.fail = 'frame > 100 ms during tier switch';
  await s.ctx.close(); fs.rmSync(s.userDir, { recursive: true, force: true });
}
if (/swiftshader|llvmpipe/i.test(results.renderer ?? '')) results.warning = 'software renderer: numbers not representative';
const text = JSON.stringify(results, null, 2);
if (arg('json')) fs.writeFileSync(arg('json'), text);
console.log(text);
