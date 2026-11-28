// Gameplay capture for critics: deterministic frame strips (fixed dt, frame-gated loop) of scripted play, with
// per-frame telemetry (position, speed, yaw, feet, punches, water) and derived feel metrics.
// usage: node tools/qa/play.mjs <outdir> [scenario,...] [--q=low] [--w=800 --h=450] [--html=dist/index.html]
// Scenarios: walk, run_turns, sprint_stop, punch, shore, jump, side_walk, side_run, phone
import { chromium } from 'playwright';
import { startServer } from '../serve.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const out = args[0]; mkdirSync(out, { recursive: true });
const pick = args[1] && !args[1].startsWith('--') ? args[1].split(',') : null;
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const DT = 1 / 30;

// spots: open EQ promenade (east edge of the inlet), facing along it (south-west)
const OPEN = { x: 112, z: -168, yaw: -0.71 };
const SC = {
  walk: { dur: 3.6, every: 3, setup: OPEN, input: [[0, 'move', 0, 0.45, 2.2]] },
  run_turns: { dur: 4.4, every: 3, setup: OPEN, input: [[0, 'move', 0, 1, 1.3], [1.3, 'move', 1, 0, 1.2], [2.5, 'move', 0, -1, 1.3]] },
  sprint_stop: { dur: 3.6, every: 3, setup: OPEN, input: [[0, 'move', 0, 1, 2.2], [0, 'hold', 'sprint', 2.2]] },
  punch: { dur: 3.6, every: 2, setup: OPEN, ped: 1.3, input: [[0.3, 'press', 'fire'], [0.9, 'press', 'fire'], [1.5, 'press', 'fire'], [2.1, 'press', 'fire']] },
  punch_approach: { dur: 4.0, every: 3, setup: { x: 104, z: -176, yaw: -0.71 }, ped: 4.0, input: [[0, 'move', 0, 0.6, 1.6], [1.7, 'press', 'fire'], [2.3, 'press', 'fire'], [2.9, 'press', 'fire']] },
  punch_walker: { dur: 3.6, every: 3, setup: { x: 100, z: -178, yaw: -0.71 }, ped: 3.0, walker: true, input: [[0.5, 'press', 'fire'], [1.1, 'press', 'fire'], [1.7, 'press', 'fire'], [2.3, 'press', 'fire']] },
  knockout: { dur: 7.5, every: 6, setup: { x: 96, z: -183, yaw: -0.71 }, ped: 1.3, input: [[0.2, 'press', 'fire'], [0.75, 'press', 'fire'], [1.35, 'press', 'fire'], [1.95, 'press', 'fire']] },
  shove: { dur: 2.6, every: 2, setup: { x: 108, z: -172, yaw: -0.71 }, ped: 4.5, input: [[0, 'move', 0, 1, 2.0], [0, 'hold', 'sprint', 2.0]] },
  shore: { dur: 4.0, every: 4, setup: { x: 112, z: -170, yaw: 0.0 }, input: [[0, 'move', 0, 1, 4.0]] },
  jump: { dur: 2.6, every: 2, setup: OPEN, input: [[0, 'move', 0, 1, 2.6], [0.8, 'press', 'jump']] },
  side_walk: { dur: 2.4, every: 2, setup: OPEN, side: true, input: [[0, 'move', 0, 0.45, 2.4]] },
  side_run: { dur: 2.0, every: 2, setup: OPEN, side: true, input: [[0, 'move', 0, 1, 2.0]] },
  phone: { dur: 2.0, every: 15, setup: OPEN, phone: true, input: [[0, 'move', 0, 0.8, 2.0]] },
};
const names = (pick || Object.keys(SC)).filter((n) => SC[n]);
const s = await startServer('/home/claude/perth/' + (opt.html || 'dist/index.html'));
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog', '--ignore-gpu-blocklist'] });
const report = {};
for (const phone of [false, true]) {
  const list = names.filter((n) => !!SC[n].phone === phone); if (!list.length) continue;
  const vp = phone ? { width: 844, height: 390 } : { width: +(opt.w || 800), height: +(opt.h || 450) };
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(s.url + `?autostart=1&shot=1&dynres=0&mb=0&dt=${DT}&q=${phone ? 'low' : (opt.q || 'low')}`);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 1200000 });
  report.clipSpeeds = await p.evaluate(() => ({ ...window.__G.game.player.ch.spd }));
  console.log('clip speeds', JSON.stringify(report.clipSpeeds));
  await p.evaluate(() => {
    const G = window.__G; document.documentElement.classList.remove('shot'); G.clock.set(16.0);
    window.__tel = []; window.__hits = 0;
    const P = G.game.player, peds = G.game.peds, V = G.camera.position.constructor, a = new V(), c = new V();
    const of = peds.onHit; peds.onHit = (...x) => { window.__hits++; return of?.(...x); };
    G.on('update', () => {
      const B = P.ch.bones; B.Bip01_L_Foot?.getWorldPosition(a); B.Bip01_R_Foot?.getWorldPosition(c);
      const tgt = window.__ped; const tp = tgt ? tgt.ch.root.position : null;
      window.__tel.push({ t: +G.t.toFixed(3), x: P.x, z: P.z, y: P.y, sp: P.speed, yaw: P.yaw, sw: P.swimming, onG: P.onGround,
        lf: [a.x, a.y, a.z], rf: [c.x, c.y, c.z], pT: P.ch.punchT ?? 1, ped: tp ? [tp.x, tp.z, tgt.ch.state] : null, hits: window.__hits });
    });
  });
  for (const n of list) {
    const S = SC[n]; const dir = `${out}/${n}`; mkdirSync(dir, { recursive: true });
    await p.evaluate(([S]) => {
      const G = window.__G, P = G.game.player; window.__input.clear(); window.__gate = 0; G.game.wanted.reset?.(); P.combat.guardT = 0;
      P.teleport(S.setup.x, S.setup.z, S.setup.yaw); P.speed = 0; P.health = 100; G.camLocked = false;
      P.camYaw = S.setup.yaw + Math.PI; P.camPitch = 0.12; P.camPos.set(0, 0, 0); P.camTarget.set(0, 0, 0);
      for (let i = 0; i < 30; i++) P.updateCamera(1 / 30, 'foot');
      window.__ped = null; G.game.peds.clearView?.(G.camera.position, P);
      if (S.ped) { // nearest walker placed in front of the player, standing still
        const fx = Math.sin(S.setup.yaw), fz = Math.cos(S.setup.yaw);
        const q = G.game.peds.list.filter((q) => q.ch.state === 'ok' && q.kind !== 'idle').sort((u, v) => u.ch.root.position.distanceTo(P.ch.root.position) - v.ch.root.position.distanceTo(P.ch.root.position))[0];
        if (q) { q.hp = 100; q.fight = null; q.fled = false; q.assaulted = false; q.ch.root.position.set(S.setup.x + fx * S.ped, P.y, S.setup.z + fz * S.ped); window.__ped = q;
          if (S.walker) { q.state = 'walk'; q.yaw = S.setup.yaw + Math.PI / 2; } else { q.kind = 'idle'; q.state = 'idle'; q.gesture = null; q.idleYaw = S.setup.yaw + Math.PI; q.yaw = q.idleYaw; } }
      }
      if (S.side) { const r = [Math.cos(S.setup.yaw), -Math.sin(S.setup.yaw)], f = [Math.sin(S.setup.yaw), Math.cos(S.setup.yaw)];
        window.__side = { r, f }; } else window.__side = null;
      document.documentElement.classList.toggle('shot', !!S.side);   // side views: no HUD
      window.__tel.length = 0; window.__hits = 0; window.__t0 = G.t;
    }, [S]);
    const frames = Math.round(S.dur / DT); const evs = S.input.slice().sort((u, v) => u[0] - v[0]); let ei = 0, shot = 0;
    for (let f = 0; f <= frames; f++) {
      const t = f * DT;
      while (ei < evs.length && evs[ei][0] <= t + 1e-6) {
        const e = evs[ei++];
        await p.evaluate((e) => { const I = window.__input; if (e[1] === 'move') I.setMove(e[2], e[3], e[4] * 1000); else if (e[1] === 'press') I.press(e[2]); else if (e[1] === 'hold') I.hold(e[2], e[3] * 1000); }, e);
      }
      await p.evaluate(() => { window.__gate = 1; });
      await p.waitForFunction(() => window.__gate === 0, null, { timeout: 120000 });
      if (f % S.every === 0) {
        await p.evaluate(() => { const sd = window.__side; if (!sd) return; const G = window.__G, P = G.game.player;   // side camera tracks the player
          window.__setCam([P.x + sd.r[0] * 4.2, P.y + 1.0, P.z + sd.r[1] * 4.2], [P.x, P.y + 0.9, P.z]); window.__gate = 1; });
        if (S.side) await p.waitForFunction(() => window.__gate === 0, null, { timeout: 120000 });
        await p.screenshot({ path: `${dir}/f${String(shot++).padStart(3, '0')}.jpg`, quality: 80 });
      }
    }
    await p.evaluate(() => { window.__G.camLocked = false; window.__gate = undefined; });
    const tel = await p.evaluate(() => window.__tel.slice());
    // metrics
    const m = { frames: tel.length, endInWater: tel.some((r) => r.sw), hits: tel.length ? tel[tel.length - 1].hits : 0 };
    let slide = 0, slideN = 0, maxW = 0, maxA = 0;
    for (let i = 1; i < tel.length; i++) {
      const A = tel[i - 1], B = tel[i];
      const lo = (r) => (r.lf[1] < r.rf[1] ? 'lf' : 'rf'), k = lo(B);
      if (lo(A) === k && B.sp > 0.3 && B.onG) { slide += Math.hypot(B[k][0] - A[k][0], B[k][2] - A[k][2]) / DT; slideN++; }
      maxW = Math.max(maxW, Math.abs(Math.atan2(Math.sin(B.yaw - A.yaw), Math.cos(B.yaw - A.yaw))) / DT);
      maxA = Math.max(maxA, Math.abs(B.sp - A.sp) / DT);
    }
    m.plantedFootSpeed = slideN ? +(slide / slideN).toFixed(3) : 0; m.maxTurnRate = +maxW.toFixed(2); m.maxAccel = +maxA.toFixed(2);
    m.maxSpeed = +Math.max(0, ...tel.map((r) => r.sp)).toFixed(2);
    if (tel[0]?.ped) m.ped = { start: tel[0].ped, end: tel[tel.length - 1].ped };
    report[n] = m; writeFileSync(`${dir}/telemetry.json`, JSON.stringify(tel));
    try { execFileSync('python3', ['tools/qa/contact_sheet.py', '--out', `${out}/${n}.jpg`, '--cols', '4', '--tile', '320', ...Array.from({ length: shot }, (_, i) => `${dir}/f${String(i).padStart(3, '0')}.jpg`).filter((_, i, a) => a.length <= 16 || i % Math.ceil(a.length / 16) === 0)], { stdio: 'ignore' }); } catch {}
    console.log(n, JSON.stringify(m), errs.length ? errs.slice(0, 2) : '');
  }
  await ctx.close();
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
await b.close(); s.close();
