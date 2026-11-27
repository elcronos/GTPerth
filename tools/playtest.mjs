#!/usr/bin/env node
// Scripted playtest (G3): drives the game through window.__input (engine/input.js) and __G hooks, asserts state,
// takes screenshots, fails on any __errors.
//   node playtest.mjs --url dist/index.html --script playtest.json [--out shots/playtest] [--w 1280 --h 720] [--query "seed=1"]
// Script (JSON): { "query": "autostart=1", "steps": [ ...step ] }   steps run in order; times are real ms.
//   {"wait": 500}                                  sleep
//   {"waitFor": "__G.mods.ui.state==='playing'", "timeout": 5000}
//   {"hold": "forward", "ms": 1200}                 hold an action (game time) and wait it out
//   {"press": "jump"}                               one-frame press
//   {"move": [x, y], "ms": 800}                     analog move override (x strafe, y forward)
//   {"look": [dx, dy]}  {"lookRad": [yaw, pitch]}   mouse-pixel / radian look deltas
//   {"key": "Escape"}   {"click": [x, y]}           real browser events (UI)
//   {"eval": "expr", "as": "name"}                  evaluate + log; with "as" the value is stored in window.__pt.name
//                                                   so later asserts can compare: {"assert": "__G.mods.player.position.z < __pt.z0"}
//   {"assert": "expr", "msg": "..."}               truthy or the run fails (continues, collects all failures)
//   {"shot": "name"}                                screenshot → <out>/<name>.png
//   {"setCam": [x,y,z,tx,ty,tz]}                    __setCam (locks the camera)
// Exit 0 only if every assert passed, the page became ready, and __errors stayed empty.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, openTarget, launchChrome, withQuery, waitReady } from './_browser.mjs';

const A = parseArgs();
if (!A.url || !A.script) { console.error('usage: playtest.mjs --url <file|http> --script steps.json [--out dir]'); process.exit(1); }
const S = JSON.parse(readFileSync(A.script, 'utf8'));
const out = A.out || path.join(path.dirname(A.script), 'shots', 'playtest');
mkdirSync(out, { recursive: true });
const W = +(A.w || S.w || 1280), H = +(A.h || S.h || 720);
const query = [S.query || 'autostart=1', A.query].filter(Boolean).join('&');

const target = await openTarget(A.url);
const { browser, page, logs } = await launchChrome({ w: W, h: H });
const results = [], fails = [];
const t0 = Date.now();
await page.goto(withQuery(target.url, query));
const ready = await waitReady(page);
if (!ready.ok) fails.push(ready.why);
await page.evaluate(() => { window.__pt = {}; });
const hasInput = await page.evaluate(() => !!window.__input);
if (!hasInput) fails.push('window.__input missing (engine/input.js not created?)');

const ev = (expr) => page.evaluate((e) => { try { return { v: (0, eval)(e) }; } catch (x) { return { err: String(x && x.message || x) }; } }, expr);
for (const [i, st] of (S.steps || []).entries()) {
  const label = `#${i + 1} ${JSON.stringify(st).slice(0, 90)}`;
  try {
    if (st.wait) await page.waitForTimeout(st.wait);
    else if (st.waitFor) {
      const ok = await page.waitForFunction((e) => { try { return !!(0, eval)(e); } catch { return false; } }, st.waitFor, { timeout: st.timeout || 10000 }).then(() => true, () => false);
      if (!ok) fails.push(`${label}: timed out`);
    } else if (st.hold) { await page.evaluate(([a, ms]) => window.__input.hold(a, ms), [st.hold, st.ms || 500]); await page.waitForTimeout((st.ms || 500) + 50); }
    else if (st.press) { await page.evaluate((a) => window.__input.press(a), st.press); await page.waitForTimeout(st.after ?? 100); }
    else if (st.move) { await page.evaluate(([x, y, ms]) => window.__input.setMove(x, y, ms), [st.move[0], st.move[1], st.ms || 500]); await page.waitForTimeout((st.ms || 500) + 50); }
    else if (st.look) await page.evaluate(([x, y]) => window.__input.look(x, y), st.look);
    else if (st.lookRad) await page.evaluate(([x, y]) => window.__input.lookRad(x, y), st.lookRad);
    else if (st.key) await page.keyboard.press(st.key);
    else if (st.click) await page.mouse.click(st.click[0], st.click[1]);
    else if (st.setCam) await page.evaluate((v) => window.__setCam(v.slice(0, 3), v.slice(3, 6)), st.setCam);
    else if (st.shot) await page.screenshot({ path: path.join(out, st.shot + '.png') });
    else if (st.eval) {
      const r = await ev(st.eval);
      if (r.err) fails.push(`${label}: ${r.err}`);
      if (st.as) await page.evaluate(([k, v]) => { window.__pt[k] = v; }, [st.as, r.v]);
      results.push({ step: i + 1, eval: st.eval, value: r.v });
      console.log(`  ${st.as || st.eval} = ${JSON.stringify(r.v)}`);
    } else if (st.assert) {
      const r = await ev(st.assert);
      const ok = !r.err && !!r.v;
      results.push({ step: i + 1, assert: st.assert, ok, msg: st.msg });
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${st.msg || st.assert}${r.err ? ' (' + r.err + ')' : ''}`);
      if (!ok) fails.push(`${label}: ${st.msg || st.assert}`);
    } else fails.push(`${label}: unknown step`);
  } catch (e) { fails.push(`${label}: ${e.message.split('\n')[0]}`); }
  const errs = await page.evaluate(() => (window.__errors || []).length).catch(() => 0);
  if (errs) { fails.push(`${label}: page errors appeared`); break; }
}
const final = await page.evaluate(() => ({ errors: (window.__errors || []).slice(0, 20), stats: window.__stats ? window.__stats() : null, pt: window.__pt }));
await page.screenshot({ path: path.join(out, 'final.png') });
await browser.close(); await target.close();
if (final.errors.length) fails.push(`${final.errors.length} __errors: ${final.errors[0]}`);
const stubs = (final.stats?.modules || []).filter((m) => m.stub).map((m) => m.name);
if (stubs.length && !S.allowStubs) fails.push('stub modules in build: ' + stubs.join(', '));
const report = { url: A.url, query, ms: Date.now() - t0, pass: fails.length === 0, fails, results, errors: final.errors, stats: final.stats, values: final.pt, logs: logs.slice(-30) };
writeFileSync(path.join(out, 'playtest.json'), JSON.stringify(report, null, 2));
console.log(report.pass ? `PASS (${results.filter((r) => 'ok' in r).length} asserts) → ${out}` : 'FAIL:\n  ' + fails.join('\n  '));
process.exit(report.pass ? 0 : 1);
