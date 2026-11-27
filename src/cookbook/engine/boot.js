// Staged boot loader: each system is built in a named, timed stage behind the loading screen. A non-critical
// stage that throws is replaced by its stub so ONE broken module never kills the game; a critical one shows a fatal
// screen. Results land in __stats().modules = [{name, ms, ok, stub}] (a shipped build must have no stub:true).
//
//   const boot = createBoot(G, { stubs: STUBS });                        // STUBS from src/modules/_stub.js
//   const sky   = await boot.stage('sky', () => createSky(G), { msg: 'Lighting the sky', at: 0.15 });
//   const world = await boot.stage('world', () => createWorld(G), { critical: true, msg: 'Raising the cranes' });
//   await boot.finish({ warmup: true, extras: [{ material: fx.material, kind: 'points' }] });  // → markReady
//
// stage(name, fn, opts):
//   fn            sync or async; its return value is the module ({update(dt,t), dispose(), ...api} or anything)
//   critical      true → failure is fatal (renderer, world). Default false → stub fallback.
//   msg, at       loading-bar message and progress (0..1). `at` defaults to evenly spaced.
//   stub          (G) => fallback module; default opts.stubs[name], else {}.
//   expectFail    record the fallback but do not push to G.errors (only for demos/tests of the fallback path).
// Modules with update() are run every frame in stage order by a crash-isolating runner (engine/loop.js);
// modules that register their own G.on('update') must set `selfUpdating: true` (input.js and quality.js do).
import { createModuleRunner } from './loop.js';

export function createBoot(G, opts = {}) {
  const { stubs = {}, slowMs = 150, root = document.getElementById('boot') } = opts;
  const modules = [];
  const runner = createModuleRunner(G);
  let runnerOn = false, n = 0;
  G.mods ||= {};
  G.boot = { modules, runner };
  (G.statsHooks ||= []).push(() => ({ modules, stubs: modules.filter((m) => m.stub).length }));

  // loading screen hooks: template.html provides #boot .boot-bar>i and #boot .boot-msg; otherwise a minimal one
  let el = root;
  if (!el) {
    el = document.createElement('div'); el.id = 'boot'; el.className = 'ui';
    el.innerHTML = '<div class="boot-msg"></div><div class="boot-bar"><i></i></div>';
    el.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding-bottom:12vh;gap:10px;background:#07080a;color:#cfc8bb;font:500 12px system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;z-index:100;transition:opacity .8s';
    el.querySelector('.boot-bar').style.cssText = 'width:min(320px,60vw);height:2px;background:rgba(255,255,255,.12)';
    el.querySelector('i').style.cssText = 'display:block;height:100%;width:0;background:#e8b778;transition:width .25s';
    document.body.appendChild(el);
  }
  const bar = el.querySelector('.boot-bar > i, .boot-bar i'), msgEl = el.querySelector('.boot-msg');
  const progress = (at, msg) => { if (bar) bar.style.width = (Math.min(1, at) * 100).toFixed(1) + '%'; if (msg && msgEl) msgEl.textContent = msg; };
  // give the browser a chance to paint the bar between stages (rAF can stall in background tabs → timeout)
  const yieldFrame = () => new Promise((r) => { let done = false; const f = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 50); });

  async function stage(name, fn, o = {}) {
    const at = o.at ?? Math.min(0.9, 0.05 + n++ * 0.08);
    progress(at, o.msg || name);
    await yieldFrame();
    const t0 = performance.now();
    let mod, rec;
    try {
      mod = await fn();
      rec = { name, ms: Math.round(performance.now() - t0), ok: true, stub: false };
    } catch (err) {
      const msg = String(err && err.message || err).slice(0, 300);
      rec = { name, ms: Math.round(performance.now() - t0), ok: false, stub: !o.critical, error: msg };
      modules.push(rec);
      if (o.critical) {
        const text = `[boot] critical module "${name}" failed: ${msg}`;
        G.errors.push(text); console.error(text, err);
        window.__fatal = text;
        el.classList.add('fatal');
        if (msgEl) msgEl.textContent = `Failed to start: ${name} — ${msg}`;
        throw err;
      }
      const text = `[boot] module "${name}" failed, using stub: ${msg}`;
      if (o.expectFail) console.warn(text); else { G.errors.push(text); console.error(text, err); }
      const sf = o.stub || stubs[name];
      try { mod = sf ? sf(G) : {}; } catch (e2) { mod = {}; }
      if (mod && typeof mod === 'object') mod.isStub = true;
      return register(name, mod);
    }
    modules.push(rec);
    if (rec.ms > slowMs) console.info(`[boot] ${name} ${rec.ms}ms`);
    return register(name, mod);
  }
  function register(name, mod) {
    G.mods[name] = mod;
    if (mod && typeof mod.update === 'function' && !mod.selfUpdating) {
      runner.add(name, mod);
      if (!runnerOn) { runnerOn = true; G.on('update', runner.update); }
    }
    return mod;
  }

  // warmup (optional) → hide loading screen → markReady (or opts.onReady, e.g. showcase G.ready)
  async function finish(f = {}) {
    if (f.warmup !== false && G.qualityCtl) {
      await stage('warmup', () => G.qualityCtl.warmup({ extras: f.extras || [] }), { msg: f.warmupMsg || 'Compiling shaders', at: 0.95 });
    }
    progress(1, f.doneMsg || '');
    G.bootMs = Math.round(performance.now());
    await yieldFrame();
    el.style.opacity = '0'; el.style.pointerEvents = 'none';
    setTimeout(() => { el.style.display = 'none'; }, 900);
    if (f.onReady) f.onReady();
    else { if (!G.markReady) G.start(); requestAnimationFrame(() => requestAnimationFrame(() => G.markReady())); }
  }
  return { stage, finish, progress, modules, runner, el };
}
