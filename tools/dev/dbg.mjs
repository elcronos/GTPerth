import { chromium } from 'playwright';
import { startServer } from '../serve.mjs';
const s = await startServer('/home/claude/perth/dist/index.html');
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const logs = []; p.on('console', m => { if (m.type() === 'error' || m.type()==='warning') logs.push(m.text().slice(0, 300)); }); p.on('pageerror', e => logs.push('PAGEERR ' + e.message));
await p.goto(s.url + (process.argv[2] || '?autostart=1&dynres=0'));
await p.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
const out = await p.evaluate(process.argv[3] || `(() => { const G = window.__G, g = G.game; const P = g.player; const o = P.ch.inst.obj; const wp = new o.position.constructor(); o.getWorldPosition(wp);
  let sk; o.traverse(n => { if (n.isSkinnedMesh) sk = n; });
  return { player: [P.x, P.y, P.z], root: P.ch.root.position.toArray(), vis: P.ch.root.visible, inScene: !!P.ch.root.parent, objWorld: wp.toArray(), objScale: o.scale.toArray(), skScale: sk && sk.scale.toArray(), bsph: sk && [sk.geometry.boundingSphere.center.toArray(), sk.geometry.boundingSphere.radius],
    peds: g.peds.list.slice(0, 5).map(p => [p.ch.position.toArray().map(v => +v.toFixed(1)), p.ch.root.visible, p.state]), cam: G.camera.position.toArray(), errors: window.__errors }; })()`);
console.log(JSON.stringify(out, null, 1)); console.log(logs.slice(-10).join('\n'));
if (process.argv[4]) await p.screenshot({ path: process.argv[4] });
await b.close(); s.close();
