// Bench fly-through: flies the camera along a PATH of poses and reports frame-time statistics.
//   installBench(G, { path: PATH });          // PATH = [[x,y,z,tx,ty,tz], ...] from src/contracts.js
//   const rep = await G.bench({ seconds: 20 }); // or open the page with #bench (auto-runs after ready)
// Report (also window.__bench when done): { avg, p50, p95, p99, max, frames, seconds, scale, scaleMin, tier,
//   tierEnd, calls, tris, errors, renderer, dynres }. tools/bench.mjs reads window.__bench.
// The first `warm` seconds are flown but not measured. Frame times come from rAF timestamps (what the player sees).
import { CatmullRomCurve3, Vector3 } from 'three';
import { rendererString } from './harness.js';

export function installBench(G, { path, seconds = 20, warm = 1.5 } = {}) {
  const pos = new Vector3(), tgt = new Vector3();
  G.bench = (o = {}) => new Promise((resolve) => {
    const P = o.path || path || G.PATH;
    const secs = o.seconds || +(G.params.get('benchs') || 0) || seconds;
    if (!P || P.length < 2) { const r = { error: 'no PATH (need >= 2 poses)' }; window.__bench = r; return resolve(r); }
    const cp = new CatmullRomCurve3(P.map((k) => new Vector3(k[0], k[1], k[2])), false, 'centripetal');
    const ct = new CatmullRomCurve3(P.map((k) => new Vector3(k[3], k[4], k[5])), false, 'centripetal');
    const cap = Math.ceil((secs + warm) * 400);
    const ms = new Float32Array(cap);
    let n = 0, t = 0, last = 0, scaleSum = 0, scaleMin = 1, calls = 0, tris = 0, samples = 0;
    const tier0 = G.quality.tier, err0 = G.errors.length;
    window.__bench = null; window.__benchRunning = true;
    const fly = (dt) => {
      t += dt;
      const u = Math.min(1, t / (secs + warm));
      cp.getPointAt(u, pos); ct.getPointAt(u, tgt);
      G.camera.position.copy(pos); G.camera.lookAt(tgt); G.camera.updateMatrixWorld();
      G.camLocked = true;
    };
    G.on('update', fly);
    const frame = (now) => {
      if (last && t > warm && n < cap) {
        ms[n++] = now - last;
        scaleSum += G.quality.scale; scaleMin = Math.min(scaleMin, G.quality.scale);
        const i = G.renderer.info.render; calls = Math.max(calls, G.frameCalls ?? i.calls); tris = Math.max(tris, G.frameTris ?? i.triangles); samples++;
      }
      last = now;
      if (t < secs + warm) return requestAnimationFrame(frame);
      G.off('update', fly);
      const s = Array.from(ms.subarray(0, n)).sort((a, b) => a - b);
      const q = (f) => +(s[Math.min(n - 1, Math.floor(f * (n - 1)))] || 0).toFixed(2);
      const avg = s.reduce((a, b) => a + b, 0) / Math.max(1, n);
      const r = {
        avg: +avg.toFixed(2), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +(s[n - 1] || 0).toFixed(2), fps: +(1000 / avg).toFixed(1),
        frames: n, seconds: secs, scale: +(scaleSum / Math.max(1, samples)).toFixed(3), scaleMin, tier: tier0, tierEnd: G.quality.tier,
        calls, tris, errors: G.errors.slice(err0, err0 + 10), renderer: rendererString(G.renderer),
        dynres: G.quality.dynres ? G.quality.dynres.history.slice(-10) : null,
      };
      window.__bench = r; window.__benchRunning = false;
      console.info('[bench]', JSON.stringify(r));
      resolve(r);
    };
    requestAnimationFrame(frame);
  });
  if (location.hash === '#bench') G.on('ready', () => setTimeout(() => G.bench(), 300));
  return G.bench;
}
