#!/usr/bin/env node
/**
 * Screenshot matrix for a 3D web game (generic; copy into tools/qa/ of the game repo).
 *
 *   node tools/qa/shot-matrix.mjs --config tools/qa/shots.config.json [--preset lookdev] [--base http://localhost:3201]
 *                                  [--out $QA_OUT/shots] [--only view1,view2] [--dry]
 *
 * Captures every combination of profile x tier x time x view x state defined in the config (or in a
 * preset that narrows it), using the dev hook contract (default window.__GAME__):
 *   ready (bool), camera.set({pos,look,fov}), camera.project(id) -> {x,y,w,h} in CSS px (optional),
 *   teleport(x,z,yaw) (optional), time.set(h) + time.speed(0) (optional), setTier(name) (optional),
 *   renderInfo() -> Promise (optional, awaited), lampAudit() (optional), buildHash (optional),
 *   views (optional map of named poses).
 * Views come from cfg.viewsFile (e.g. the project's views.json, path relative to the config) merged with
 * cfg.views (cfg.views wins on the same id), so views.json stays the single source of truth for poses.
 * Per view: cfg.resetExpr runs before every view (closes any open dialogue / menu), pose.openExpr after the
 * pose is set, pose.closeExpr after the screenshot(s). cfg.textSelectors records the CSS-px rects of matching
 * visible elements into meta.textBoxes (UI contrast and min text size checks in frame_metrics.py).
 * Lamp audit: in the `night` preset (or any preset / config with "lampAudit": true) the hook's lampAudit()
 * runs once per page after the first time is set, and its result is written as `lampAudit` on the first shot
 * line of that page (orphan emissive lamps with no light source within 1.5 m fail frame_metrics check).
 * Each shot writes <out>/<id>.png and one line in <out>/shots.jsonl with renderer, tier, time, renderInfo and
 * the projected boxes, so scripts/frame_metrics.py can measure regions. With flickerPair the camera is moved
 * by `flickerOffset` metres and a second PNG <id>__b.png is taken for temporal z-fight diffs.
 *
 * Runs from the repo root so `playwright` resolves from ./node_modules. Never writes into the source tree
 * unless --out says so (a dev server reloads on new files). Exit code 1 if any shot failed.
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

const cfgPath = arg('config', 'tools/qa/shots.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const preset = arg('preset') ? cfg.presets?.[arg('preset')] : null;
if (arg('preset') && !preset) throw new Error(`preset ${arg('preset')} not in ${cfgPath}`);
const pick = (key) => (preset && preset[key]) ?? cfg[key];
function loadViewsFile(rel) {
  if (!rel) return {};
  const f = path.resolve(path.dirname(cfgPath), rel);
  if (!fs.existsSync(f)) { console.warn(`WARNING viewsFile ${f} not found; using cfg.views only`); return {}; }
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return j.views && typeof j.views === 'object' ? j.views : j; // accepts {views:{...}} or a flat map
}
const viewsFromFile = loadViewsFile(cfg.viewsFile);
const allViews = Object.assign({}, viewsFromFile, cfg.views ?? {});
const doLampAudit = !!(preset?.lampAudit ?? cfg.lampAudit ?? arg('preset') === 'night');

const base = arg('base', cfg.baseUrl ?? 'http://localhost:3201');
const out = path.resolve(arg('out', cfg.out ?? path.join(process.env.QA_OUT ?? os.tmpdir(), 'shots')));
const hook = cfg.hook ?? '__GAME__';
const only = arg('only')?.split(',');
const profileIds = preset?.profiles ?? cfg.profiles.map((x) => x.id);
const profiles = cfg.profiles.filter((p) => profileIds.includes(p.id));
const tiers = pick('tiers') ?? ['high'];
const times = pick('times') ?? [null];
const states = pick('states') ?? ['fresh'];
let views = preset?.views ?? Object.keys(allViews);
const missingViews = views.filter((v) => !allViews[v]);
if (missingViews.length) console.warn(`WARNING views not defined (falling back to camera.setView): ${missingViews.join(', ')}`);
if (only) views = views.filter((v) => only.includes(v));
const settleMs = cfg.settleMs ?? 1200;
const readyTimeout = cfg.readyTimeoutMs ?? 180000;

fs.mkdirSync(out, { recursive: true });

function findChrome() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  const cache = process.platform === 'darwin' ? '~/Library/Caches/ms-playwright' : '~/.cache/ms-playwright';
  const name = process.platform === 'darwin' ? "\\( -name 'Google Chrome for Testing' -o -name Chromium \\) -path '*MacOS*'" : "\\( -name chrome -o -name chromium \\)";
  try {
    return execSync(`find ${cache} -type f -perm -u+x ${name} 2>/dev/null | grep -v headless | sort | tail -1`, { shell: '/bin/bash' }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

const gpuArgs = cfg.gpuArgs ?? (process.platform === 'darwin'
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist']);

const total = profiles.length * tiers.length * times.length * views.length * states.length;
console.log(`shot-matrix: ${total} shots -> ${out}`);
if (flag('dry')) process.exit(0);

const { chromium } = await import(path.resolve(process.cwd(), 'node_modules/playwright/index.mjs'));
const browser = await chromium.launch({ executablePath: findChrome(), headless: !flag('headed'), args: gpuArgs });
const log = fs.createWriteStream(path.join(out, 'shots.jsonl'), { flags: 'a' });
const failures = [];

function urlFor(tier, view, time) {
  const u = new URL(cfg.route ?? '/', base);
  if (tier) u.searchParams.set(cfg.params?.tier ?? 'quality', tier);
  if (cfg.params?.view && view) u.searchParams.set(cfg.params.view, view);
  if (cfg.params?.time && time != null) u.searchParams.set(cfg.params.time, String(time));
  for (const [k, v] of Object.entries(cfg.extraParams ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

for (const prof of profiles) {
  for (const state of states) {
    const ctx = await browser.newContext({
      viewport: { width: prof.width, height: prof.height },
      deviceScaleFactor: prof.dpr ?? 1,
      isMobile: !!prof.mobile,
      hasTouch: !!prof.touch,
      userAgent: prof.userAgent,
    });
    const seed = cfg.stateSeeds?.[state];
    if (seed?.localStorage) {
      await ctx.addInitScript((entries) => {
        try {
          for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        } catch {}
      }, seed.localStorage);
    }
    for (const tier of tiers) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      try {
        await page.goto(urlFor(tier, views[0], times[0]), { waitUntil: 'domcontentloaded', timeout: readyTimeout });
        await page.waitForFunction((h) => !!window[h]?.ready, hook, { timeout: readyTimeout });
        if (cfg.enterExpr) await page.evaluate(cfg.enterExpr);
        if (seed?.afterReadyExpr) await page.evaluate(seed.afterReadyExpr);
      } catch (e) {
        failures.push(`${prof.id}/${state}/${tier}: not ready: ${e.message}`);
        await page.close();
        continue;
      }
      const renderer = await page.evaluate(() => {
        const c = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
        const ext = c && c.getExtension('WEBGL_debug_renderer_info');
        return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
      });
      if (/swiftshader|llvmpipe/i.test(renderer)) console.warn(`WARNING software renderer: ${renderer} (numbers and shading are not representative)`);
      await page.evaluate(([h, t]) => window[h]?.setTier?.(t), [hook, tier]);
      let lampAudit = null;
      let lampAuditPending = doLampAudit;
      for (const time of times) {
        // freeze the day cycle right after setting the hour so a running clock does not drift between views
        if (time != null) await page.evaluate(([h, t]) => { window[h]?.time?.set?.(t); window[h]?.time?.speed?.(0); }, [hook, time]);
        if (lampAuditPending) {
          await page.waitForTimeout(settleMs);
          lampAudit = await page.evaluate((h) => window[h]?.lampAudit?.() ?? { ok: null, error: 'hook has no lampAudit()' }, hook).catch((e) => ({ ok: null, error: e.message }));
          lampAuditPending = false;
          if (lampAudit?.ok === false) console.warn(`\nlampAudit ${prof.id}/${tier}: ${lampAudit.orphans.length} orphan lamp(s)`);
        }
        for (const view of views) {
          const pose = allViews[view];
          const id = [view, prof.id, tier, time == null ? 'static' : String(time).padStart(2, '0'), state].join('__');
          try {
            if (cfg.resetExpr) await page.evaluate(cfg.resetExpr);
            await page.evaluate(([h, v, p]) => {
              const g = window[h];
              if (p?.teleport && g.teleport) g.teleport(p.teleport.x, p.teleport.z, p.teleport.yaw);
              if (p?.camera && g.camera?.set) g.camera.set(p.camera);
              else if (g.camera?.setView) g.camera.setView(v);
            }, [hook, view, pose]);
            if (pose?.openExpr) await page.evaluate(pose.openExpr);
            await page.waitForTimeout(pose?.settleMs ?? settleMs);
            const file = path.join(out, `${id}.png`);
            await page.screenshot({ path: file });
            const meta = await page.evaluate(async ([h, boxes, sels]) => {
              const g = window[h];
              const projected = {};
              for (const b of boxes ?? []) projected[b] = g.camera?.project?.(b) ?? null;
              const textBoxes = [];
              for (const sel of sels ?? []) {
                for (const el of document.querySelectorAll(sel)) {
                  const r = el.getBoundingClientRect();
                  const cs = getComputedStyle(el);
                  if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
                  if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
                  textBoxes.push({ sel, x: r.left, y: r.top, w: r.width, h: r.height, fontPx: parseFloat(cs.fontSize) || null, text: (el.textContent ?? '').trim().slice(0, 60) });
                }
              }
              const renderInfo = (await g.renderInfo?.()) ?? null; // async: one full frame incl. post-processing
              return { renderInfo, buildHash: g.buildHash ?? document.documentElement.dataset.build ?? null, boxes: projected, textBoxes };
            }, [hook, pose?.boxes ?? cfg.defaultBoxes, cfg.textSelectors ?? []]);
            let fileB = null;
            if (cfg.flickerPair && pose?.camera) {
              const d = cfg.flickerOffset ?? 0.01;
              await page.evaluate(([h, p, dd]) => {
                const c = { ...p.camera, pos: [p.camera.pos[0] + dd, p.camera.pos[1], p.camera.pos[2]] };
                window[h].camera.set(c);
              }, [hook, pose, d]);
              await page.waitForTimeout(250);
              fileB = path.join(out, `${id}__b.png`);
              await page.screenshot({ path: fileB });
            }
            const extra = {};
            if (lampAudit) { extra.lampAudit = lampAudit; lampAudit = null; }
            if (pose?.lodPair) extra.lodPair = pose.lodPair;
            log.write(JSON.stringify({ id, file, fileB, view, profile: prof.id, dpr: prof.dpr ?? 1, tier, time, state, renderer, url: page.url(), errors: errors.splice(0), ...meta, ...extra }) + '\n');
            process.stdout.write('.');
            if (pose?.closeExpr) await page.evaluate(pose.closeExpr).catch((e) => failures.push(`${id}: closeExpr: ${e.message}`));
          } catch (e) {
            failures.push(`${id}: ${e.message}`);
            process.stdout.write('x');
          }
        }
      }
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
log.end();
console.log(`\nshots: ${total - failures.length}/${total} ok; index ${path.join(out, 'shots.jsonl')}`);
if (failures.length) {
  console.log(failures.map((f) => `  FAIL ${f}`).join('\n'));
  process.exit(1);
}
