// Look-dev shot matrix for Grand Theft Perth (SwiftShader). One page load, many views.
// usage: node tools/qa/shoot.mjs <outdir> [viewIds,comma] [--q=high] [--w=1280 --h=720] [--html=dist/index.html]
// views.json entries: {id, hour, cam:[ex,ey,ez,tx,ty,tz]} or {id, hour, player:[x,z], look:[x,z], dist, h, fov}
//   hud:true keeps the HUD; phone:true shoots 844x390 touch landscape.
import { chromium } from 'playwright';
import { startServer } from '../serve.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const out = args[0]; mkdirSync(out, { recursive: true });
const pick = args[1] && !args[1].startsWith('--') ? args[1].split(',') : null;
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const views = JSON.parse(readFileSync(new URL('./views.json', import.meta.url))).filter((v) => !pick || pick.includes(v.id));
const s = await startServer('/home/claude/perth/' + (opt.html || 'dist/index.html'));
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog', '--ignore-gpu-blocklist'] });
const rows = [];
async function session(phone) {
  const vp = phone ? { width: 844, height: 390 } : { width: +(opt.w || 1280), height: +(opt.h || 720) };
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: !!phone, isMobile: !!phone });
  const p = await ctx.newPage();
  const logs = []; p.on('pageerror', (e) => logs.push(e.message));
  const q = opt.q || (phone ? 'low' : 'high');
  await p.goto(s.url + '?shot=1&autostart=1&dynres=0&q=' + q);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 1200000 });
  return { p, ctx, logs, q };
}
const groups = [views.filter((v) => !v.phone), views.filter((v) => v.phone)];
for (const [gi, list] of groups.entries()) {
  if (!list.length) continue;
  const S = await session(gi === 1);
  for (const v of list) {
    const t0 = Date.now();
    await S.p.evaluate((v) => {
      const G = window.__G;
      document.documentElement.classList.toggle('shot', !v.hud);
      G.clock.set(+v.hour);
      if (v.player) {
        const [x, z] = v.player, [lx, lz] = v.look; const yaw = Math.atan2(lx - x, lz - z);
        const P = G.game.player;
        P.teleport(x, z, yaw);
        // the real game camera rig frames the shot (shoulder offset, pitch, collision), not a harness pose
        G.camLocked = false; P.camYaw = yaw + Math.PI; P.camPitch = v.pitch ?? 0.10; P.camPos.set(0, 0, 0); P.camTarget.set(0, 0, 0);
        for (let i = 0; i < 40; i++) P.updateCamera(1 / 30, 'foot');
        G.game.peds?.clearView?.(G.camera.position, P); G.game.peds?.topUp?.(G.camera.position, P, G.quality.tier === 'low' ? 3 : 8);
      } else if (v.cam) { const c = v.cam.slice(); G.camLocked = true; if (v.rel) { const gy = G.game.groundY?.(c[0], c[2]) ?? 0; c[1] += gy; c[4] += gy; } window.__setCam(c.slice(0, 3), c.slice(3, 6));
        const f = G.camera.getWorldDirection(G.camera.position.clone()); const fx = c[0] + f.x * 45, fz = c[2] + f.z * 45;
        G.focus = { x: fx, y: 0, z: fz }; G.game.traffic?.prime?.({ x: fx, z: fz }); G.game.peds?.prime?.({ x: fx, z: fz }, G.camera.position, f); }
      if (v.fov) { G.camera.fov = v.fov; G.camera.updateProjectionMatrix(); }
      G.game.parked?.update?.(1, G.camera.position, true);   // near parked cars swap to the scanned LOD
      G.post?.resetAdaptation?.();
    }, v);
    await S.p.waitForTimeout(v.wait || 8000);
    await S.p.evaluate(() => { const G = window.__G; G.renderer.shadowMap.needsUpdate = true; });   // fresh shadow map after moving people
    await S.p.waitForTimeout(2500);
    const file = `${out}/${v.id}.jpg`;
    await S.p.screenshot({ path: file, quality: 88, timeout: 400000 });
    const st = await S.p.evaluate(() => ({ ...window.__stats(), el: +window.__G.clock.state().el.toFixed(1), errs: window.__errors.slice(0, 3) }));
    // player screen box for metrics
    const box = await S.p.evaluate(() => { const G = window.__G, P = G.game.player; const V = G.camera.position.constructor;
      const a = new V(P.x, P.y, P.z).project(G.camera), c = new V(P.x, P.y + 1.75, P.z).project(G.camera);
      return { x: (a.x + 1) / 2, yb: (1 - a.y) / 2, yt: (1 - c.y) / 2 }; });
    const row = { id: v.id, file, hour: v.hour, tier: S.q, profile: gi ? 'phone' : 'desktop', ms: Date.now() - t0, stats: st, player: v.player ? box : null };
    rows.push(row); console.log(v.id, `${((Date.now() - t0) / 1000).toFixed(0)}s`, `tris=${st.tris} calls=${st.calls} el=${st.el}`, st.errs.length ? st.errs : '');
  }
  if (S.logs.length) console.log('pageerrors:', S.logs.slice(0, 4).join(' | '));
  await S.ctx.close();
}
writeFileSync(`${out}/shots.json`, JSON.stringify(rows, null, 1));
await b.close(); s.close();
