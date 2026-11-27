// Phone smoke test: landscape touch viewport, tap to start, drag the left stick, tap ENTER near a car, screenshot.
import { chromium } from 'playwright';
import { startServer } from '../serve.mjs';
const s = await startServer('/home/claude/perth/dist/index.html');
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog'] });
const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); const logs = []; p.on('pageerror', (e) => logs.push(e.message));
await p.goto(s.url + '?dynres=0&q=low');
await p.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
await p.waitForTimeout(3000);
await p.screenshot({ path: 'shots/mobile_title.jpg', quality: 80 });
await p.touchscreen.tap(420, 200);
await p.waitForTimeout(6000);
const cdp = await ctx.newCDPSession(p);
const before = await p.evaluate(() => [window.__G.game.player.x, window.__G.game.player.z]);
const t = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
await t('touchStart', 150, 280); for (let i = 1; i <= 6; i++) { await t('touchMove', 150, 280 - i * 10); await p.waitForTimeout(150); }
await p.waitForTimeout(6000);
await p.screenshot({ path: 'shots/mobile_play.jpg', quality: 80 });
await t('touchEnd');
const after = await p.evaluate(() => [window.__G.game.player.x, window.__G.game.player.z, window.__G.game.state.mode, document.body.className, window.__errors.length]);
console.log(JSON.stringify({ before, after, logs: logs.slice(0, 3) }));
await b.close(); s.close();
