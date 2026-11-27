// usage: node tools/dev/timeshots.mjs <outdir> "<eye x,y,z,target x,y,z>" 12 17.5 19 20 22
import { chromium } from 'playwright';
import { startServer } from '../serve.mjs';
import { mkdirSync } from 'node:fs';
const [out, pose, ...hours] = process.argv.slice(2); mkdirSync(out, { recursive: true });
const c = pose.split(',').map(Number);
const s = await startServer('/home/claude/perth/dist/index.html');
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog'] });
const p = await b.newPage({ viewport: { width: 960, height: 600 } });
const logs = []; p.on('pageerror', (e) => logs.push(e.message));
await p.goto(s.url + '?shot=1&autostart=1&dynres=0');
await p.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
for (const h of hours) {
  await p.evaluate(([c, h]) => { window.__G.clock.set(+h); window.__setCam([c[0], c[1], c[2]], [c[3], c[4], c[5]]); window.__G.post?.resetAdaptation?.(); }, [c, h]);
  await p.waitForTimeout(9000);
  await p.screenshot({ path: `${out}/t${h}.jpg`, quality: 85, timeout: 300000 });
  console.log('shot', h, await p.evaluate(() => JSON.stringify({ el: window.__G.clock.state().el.toFixed(1), err: window.__errors.length })));
}
console.log(logs.slice(0, 5).join('\n'));
await b.close(); s.close();
