// Quality: tier detection, dynamic resolution with hysteresis, shader warmup, WebGL context loss/restore.
//
//   const Q = createQuality(G);              // detects tier (unless ?q=), installs dynres + context guard
//   ...build scene...
//   await Q.warmup({ extras: [{ material: sparkMat, kind: 'points' }] });  // behind the loading screen
//   G.markReady();                            // dynres ignores the first 5 s after this
//
// Reads/writes G.quality = { tier, scale, settings, maxTier, pinned, pixelRatio, dynres:{...}, contextLosses }.
// Emits G.emit('quality', G.quality, 'scale'|'tier') on change. 'contextrestored' is emitted by core.js; the guard here
// listens to it (re-warm, clear the recorded loss) like every other GPU baker.
//
// Design rules (each one fixes a real failure seen in shipped browser games):
//  - an early hitch must NEVER lock the session low: evidence before ready+5 s is ignored, single frames
//    > 250 ms (tab switch, GC, compile) are dropped, and the tier climbs back up when the GPU has headroom;
//  - scale moves in 0.05 steps in [tier.minScale (0.6-0.8), 1]; down needs 2 bad 1 s windows in a row, up needs 3
//    good ones, and a step that failed in the last 10 s needs 8 (stops the vsync 60↔30 ping-pong);
//  - "good" means p75 < 1.04 × budget, NOT "< 80 % of budget": on a vsync-locked display frames never go below
//    the refresh interval, so an 80 % rule would never scale back up;
//  - a tier change needs 3 s sustained at the floor scale (down) or 10 s of big headroom (p75 < 0.7 × budget) at
//    full scale (up), with >= 10 s between tier changes; a tier-up that gets undone within 60 s doubles the evidence
//    needed next time (max 8×). The tier never rises above the detected/initial tier.
//  - the settled tier/scale is saved to localStorage 15 s after ready, with a crash canary: a boot that never got
//    there (crash/hang/GPU reset) starts one tier lower next time.
import { Mesh, InstancedMesh, Points, BoxGeometry, BufferGeometry, Float32BufferAttribute, Object3D } from 'three';

// Per-tier knobs other systems read via G.quality.settings (or switch on G.quality.tier directly).
//  pixelCap: max drawing-buffer megapixels (after dpr*scale) · shadow: shadow map size · pcssTaps: PCF taps (0 = plain PCF)
//  volSteps: volumetric ray-march steps (0 = off) · ao: SSAO on · bloomMips · msaa: HDR target samples
//  aniso: texture anisotropy · particles: particle count multiplier · drawDist: far-field multiplier
export const TIERS = {
// Post-chain specifics (msaa, AO taps, vol steps actually used) are decided by POST_TIERS in post/pipeline.js;
// the values here are what non-post systems should size themselves from. minScale = dynres floor for the tier.
  low:   { pixelCap: 1.0, minScale: 0.6, shadow: 1024, pcssTaps: 0,  volSteps: 16, ao: false, bloomMips: 4, msaa: 0, aniso: 2,  particles: 0.4, drawDist: 0.6, lights: 2 },
  med:   { pixelCap: 1.5, minScale: 0.6, shadow: 2048, pcssTaps: 8,  volSteps: 16, ao: true,  bloomMips: 5, msaa: 2, aniso: 4,  particles: 0.7, drawDist: 0.8, lights: 4 },
  high:  { pixelCap: 2.3, minScale: 0.7, shadow: 2048, pcssTaps: 16, volSteps: 20, ao: true,  bloomMips: 6, msaa: 4, aniso: 8,  particles: 1.0, drawDist: 1.0, lights: 6 },
  ultra: { pixelCap: 3.7, minScale: 0.8, shadow: 4096, pcssTaps: 32, volSteps: 24, ao: true,  bloomMips: 6, msaa: 4, aniso: 16, particles: 1.3, drawDist: 1.2, lights: 8 },
};
export const TIER_ORDER = ['low', 'med', 'high', 'ultra'];
const tierIdx = (t) => Math.max(0, TIER_ORDER.indexOf(t));

// ---- tier detection -------------------------------------------------------------------------------------------
// Conservative: unknown desktop GPUs get 'high'; 'ultra' is only ever chosen explicitly (?q=ultra or opts.allowUltra).
export function detectTier(renderer, { allowUltra = false } = {}) {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua) && !/Apple M\d/.test(gpu) && innerWidth < 1100);
  const mem = navigator.deviceMemory || 8; // Chrome only; caps at 8
  const cores = navigator.hardwareConcurrency || 4;
  let tier = 'high', reason = 'desktop default';
  if (/SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu)) { tier = 'low'; reason = 'software renderer'; }
  else if (mobile) { tier = 'low'; reason = 'mobile'; }
  else if (/Mali|Adreno|PowerVR|Intel(?!.*Arc)|UHD Graphics|Iris/i.test(gpu)) { tier = 'med'; reason = 'integrated/mobile GPU'; }
  else if (allowUltra && /RTX\s?[3-5]0[6-9]0|RX\s?[6-9][7-9]00|Apple M\d (Max|Ultra)/i.test(gpu)) { tier = 'ultra'; reason = 'high-end GPU'; }
  if (mem <= 2 || cores <= 2) { tier = 'low'; reason += ', low memory/cores'; }
  else if (mem <= 4 && tierIdx(tier) > 1) { tier = 'med'; reason += ', <=4 GB'; }
  return { tier, reason, gpu, mobile, deviceMemory: mem, cores };
}

// ---- main controller ------------------------------------------------------------------------------------------
export function createQuality(G, opts = {}) {
  const {
    budgetMs = 1000 / 60,       // frame budget the controller defends
    downMs = budgetMs * 1.25,   // p75 above this = over budget (≈20.8 ms)
    upMs = budgetMs * 1.04,     // p75 below this = headroom for a scale step up (≈17.4 ms)
    tierUpMs = budgetMs * 0.7,  // p75 below this at scale 1 = headroom for a tier step up
    maxScale = 1, step = 0.05,
    storageKey = 'onefile.quality.v1', // null disables persistence + canary
    ignoreAfterReadyS = 5,      // early hitches (compile, first PMREM, GC) are not evidence
    windowS = 1,                // evaluation window
    applyPixelRatio = true,     // false = the post pipeline reads G.quality.scale itself and sizes its targets
    allowUltra = false,
  } = opts;
  const p = G.params;
  const det = detectTier(G.renderer, { allowUltra });
  const forced = p.get('q');
  const shot = !!p.get('shot');
  const Q = G.quality;
  Q.detected = det;
  Q.tier = TIERS[forced] ? forced : (TIERS[opts.tier] ? opts.tier : det.tier);
  Q.maxTier = Q.tier;                       // auto tier never climbs above where it started
  // persisted settle + crash canary (never in shot mode or with ?q=)
  const store = storageKey && !shot && !TIERS[forced] ? storageKey : null;
  let saved = null;
  if (store) {
    try {
      saved = JSON.parse(localStorage.getItem(store) || 'null');
      if (localStorage.getItem(store + '.canary')) { Q.tier = TIER_ORDER[Math.max(0, tierIdx(Q.tier) - 1)]; Q.canaryTripped = true; saved = null; }
      else if (saved && TIERS[saved.tier] && tierIdx(saved.tier) < tierIdx(Q.tier)) Q.tier = saved.tier;
      localStorage.setItem(store + '.canary', '1');
    } catch (e) { /* storage blocked: run without persistence */ }
  }
  Q.pinned = !!TIERS[forced];               // ?q= pins the tier (scale may still move)
  Q.settings = TIERS[Q.tier];
  Q.scale = saved && saved.tier === Q.tier && saved.scale >= Q.settings.minScale ? Math.min(1, saved.scale) : 1;
  Q.contextLosses = 0;
  const dynOn = !shot && p.get('dynres') !== '0' && opts.dynres !== false;
  const D = Q.dynres = { on: dynOn, p75: 0, avg: 0, over: 0, under: 0, floorWindows: 0, headroomWindows: 0, history: [] };

  // ---- applying scale ----
  // G.dpr becomes min(device dpr, tier pixel cap) — "the dpr actually used" (CONTRACT). Then:
  //  - with a post pipeline (G.post set): post/pipeline.js renders at G.width*G.dpr*G.quality.scale and upscales,
  //    so we only keep the canvas at G.dpr (UI-sharp final pass);
  //  - without one: the canvas itself renders at G.dpr*scale.
  const devDpr = G.dpr;
  let applying = false, postSeen = false;
  const apply = () => {
    postSeen = !!G.post;
    const capPr = Math.sqrt((Q.settings.pixelCap * 1e6) / Math.max(1, G.width * G.height));
    G.dpr = Math.max(0.5, Math.min(devDpr, capPr));
    const pr = applyPixelRatio && !postSeen ? Math.max(0.25, G.dpr * Q.scale) : G.dpr;
    Q.pixelRatio = pr;
    if (Math.abs(G.renderer.getPixelRatio() - pr) < 1e-3) return;
    applying = true;
    G.renderer.setPixelRatio(pr);            // three re-sizes the drawing buffer with the current CSS size
    G.renderer.setSize(G.width, G.height, false);
    G.emit('resize', G.width, G.height);     // anything sized from the buffer re-allocates
    applying = false;
  };
  G.on('resize', () => { if (!applying) { apply(); settleUntil = now() + 1000; } });

  const log = (reason, p75) => {
    D.history.push({ t: +(now() / 1000).toFixed(1), scale: +Q.scale.toFixed(2), tier: Q.tier, p75: +p75.toFixed(2), reason });
    if (D.history.length > 32) D.history.shift();
  };
  const setScale = (s, reason = 'manual', p75 = 0) => {
    s = Math.round(Math.min(maxScale, Math.max(Q.settings.minScale, s)) * 100) / 100;
    if (s === Q.scale) return;
    Q.scale = s; apply(); log(reason, p75); G.emit('quality', Q, 'scale');
  };
  const setTier = (t, reason = 'manual', p75 = 0) => {
    if (!TIERS[t] || t === Q.tier) return;
    Q.tier = t; Q.settings = TIERS[t];
    apply(); log(reason, p75);
    lastTierChange = now(); settleUntil = now() + 2000; // new tier = new shaders/targets: let it settle
    G.emit('quality', Q, 'tier');
  };

  // ---- frame-time sampling (no per-frame allocations) ----
  const N = 240;
  const ring = new Float32Array(N), scratch = new Float32Array(N);
  let n = 0, head = 0, last = 0, windowStart = 0, readyAt = Infinity, settleUntil = 0, lastTierChange = -1e9;
  const failedAt = new Float64Array(9).fill(-1e9); // per scale step (0.6..1.0): time it last failed, for hysteresis
  let fake = null, fakeT = 1e6; // virtual clock used only by _feed() in tests (monotonic across calls)
  let lastTierUp = -1e9, tierBackoff = 1, snap = null, persisted = false;
  const now = () => (fake === null ? performance.now() : fake);
  G.on('ready', () => { readyAt = now(); });
  document.addEventListener('visibilitychange', () => { last = 0; n = 0; settleUntil = now() + 1500; });

  const percentile = (q) => {
    scratch.set(ring); // valid samples are [0, m); the rest is stale from older windows → pushed to the end
    const m = Math.min(n, N);
    if (m < N) for (let i = m; i < N; i++) scratch[i] = Infinity;
    scratch.sort();
    return scratch[Math.min(m - 1, Math.floor(q * (m - 1) + 0.5))];
  };
  const mean = () => { let s = 0; const m = Math.min(n, N); for (let i = 0; i < m; i++) s += ring[i]; return s / Math.max(1, m); };
  const stepIndex = (s) => Math.max(0, Math.round((s - 0.6) / step)); // failure-memory slot per 0.05 step

  function update() {
    const t = now();
    if (!!G.post !== postSeen) apply();
    if (store && t > readyAt + 15000 && fake === null) { // settled: persist + clear the canary (once)
      try { localStorage.setItem(store, JSON.stringify({ tier: Q.tier, scale: Q.scale })); localStorage.removeItem(store + '.canary'); } catch (e) { /* ignore */ }
      readyAt = Infinity; persisted = true;
    }
    const dtMs = last ? t - last : 0;
    last = t;
    if (!D.on || Q.contextLost) return;
    if ((!persisted && t < readyAt + ignoreAfterReadyS * 1000) || t < settleUntil) { n = 0; head = 0; windowStart = t; return; }
    if (dtMs <= 0 || dtMs > 250) return;     // hitch/background frame: not evidence either way
    ring[head] = dtMs; head = (head + 1) % N; n++;
    if (t - windowStart < windowS * 1000 || n < 20) return;
    // ---- evaluate one window ----
    const p75 = percentile(0.75);
    D.p75 = p75; D.avg = mean();
    n = 0; head = 0; windowStart = t;
    const si = stepIndex(Q.scale);
    if (p75 > downMs) { D.over++; D.under = 0; }
    else if (p75 < upMs) { D.under++; D.over = 0; }
    else { D.over = 0; D.under = 0; }
    // scale down: 2 consecutive bad windows
    if (D.over >= 2 && Q.scale > Q.settings.minScale + 1e-3) {
      failedAt[si] = t; setScale(Q.scale - step, 'over budget', p75); D.over = 0; D.under = 0; return;
    }
    // scale up: 3 good windows, or 8 if this next step failed within the last 10 s (hysteresis: stops the
    // 60↔30 fps vsync ping-pong where one step up is exactly what made it miss the budget)
    if (Q.scale < maxScale - 1e-3) {
      const recentFail = t - failedAt[si + 1] < 10000;
      if (D.under >= (recentFail ? 8 : 3)) { setScale(Q.scale + step, 'headroom', p75); D.under = 0; return; }
    }
    if (Q.pinned || opts.autoTier === false) return;
    // tier down: sustained at the floor scale and still over budget
    D.floorWindows = Q.scale <= Q.settings.minScale + 1e-3 && p75 > downMs ? D.floorWindows + 1 : 0;
    if (D.floorWindows >= 3 && t - lastTierChange > 10000 && tierIdx(Q.tier) > 0) {
      if (t - lastTierUp < 60000) tierBackoff = Math.min(8, tierBackoff * 2);
      D.floorWindows = 0; setTier(TIER_ORDER[tierIdx(Q.tier) - 1], 'floor sustained', p75); setScale(0.85, 'tier down reset', p75); return;
    }
    // tier up (reversibility): full scale with big headroom for a long time
    D.headroomWindows = Q.scale >= maxScale - 1e-3 && p75 < tierUpMs ? D.headroomWindows + 1 : 0;
    // backoff: every tier-up that had to be undone within 60 s doubles the evidence needed next time (max 8x)
    if (D.headroomWindows >= 10 * tierBackoff && t - lastTierChange > 10000 && tierIdx(Q.tier) < tierIdx(Q.maxTier)) {
      D.headroomWindows = 0; lastTierUp = t; setTier(TIER_ORDER[tierIdx(Q.tier) + 1], 'headroom sustained', p75); setScale(0.85, 'tier up reset', p75);
    }
  }
  G.on('preupdate', update);
  apply();

  (G.statsHooks ||= []).push(() => ({ dynres: { on: D.on, p75: +D.p75.toFixed(2), scale: Q.scale, tier: Q.tier, maxTier: Q.maxTier, changes: D.history.length }, pixelRatio: +(Q.pixelRatio || 0).toFixed(3) }));

  const guard = installContextGuard(G);
  const api = {
    get tier() { return Q.tier; }, get scale() { return Q.scale; }, get settings() { return Q.settings; },
    detected: det, setScale, setTier, selfUpdating: true, // update runs via G.on('update') already
    warmup: (o) => warmup(G, o), simulateContextLoss: guard.simulate,
    // tests: feed synthetic frame times through the real controller logic (bypasses the ready/settle gates)
    // e.g. Q._feed(30, 600) = ten seconds of 30 ms frames on a virtual clock. Consecutive _feed calls form one test
    // session (failure memory carries over, like real time); Q._endTest() restores the controller's real state,
    // tier and scale. Never call during gameplay.
    _feed(ms, frames = 60) {
      if (!snap) snap = { on: D.on, readyAt, settleUntil, ltc: lastTierChange, ltu: lastTierUp, bo: tierBackoff, fa: failedAt.slice(), tier: Q.tier, scale: Q.scale, hist: D.history.length };
      if (fake === null && fakeT === 1e6) { lastTierChange = -1e9; lastTierUp = -1e9; tierBackoff = 1; failedAt.fill(-1e9); }
      D.on = true; readyAt = -1e9; settleUntil = Math.min(settleUntil, fakeT); fake = fakeT; last = 0;
      for (let i = 0; i < frames; i++) { fake += ms; update(); }
      fakeT = fake + 1; fake = null; last = 0;
      return { scale: Q.scale, tier: Q.tier, p75: +D.p75.toFixed(1) };
    },
    _endTest() {
      if (!snap) return;
      D.on = snap.on; readyAt = snap.readyAt; settleUntil = snap.settleUntil; lastTierChange = snap.ltc; lastTierUp = snap.ltu;
      tierBackoff = snap.bo; failedAt.set(snap.fa); fakeT = 1e6; D.over = D.under = D.floorWindows = D.headroomWindows = 0; n = 0;
      setTier(snap.tier, 'test end'); setScale(snap.scale, 'test end');
      settleUntil = performance.now() + 1000; snap = null;
    },
    dispose() { G.off && G.off('preupdate', update); guard.dispose(); },
  };
  G.qualityCtl = api;
  return api;
}

// ---- shader warmup ----------------------------------------------------------------------------------------------
// Compiles every program the scene will need BEFORE the player sees it, so first-use hitches never happen in play
// (and never trip dynres). Steps:
//  1. temporarily make hidden objects visible + disable frustum culling (pooled FX, muzzle flashes, off-screen props),
//  2. add one tiny proxy per `extras` entry (materials only used later: { material, kind:'mesh'|'instanced'|'points', geometry? }),
//     with castShadow/receiveShadow on so the shadow permutations compile too,
//  3. renderer.compileAsync(scene, camera) — uses KHR_parallel_shader_compile under the hood,
//  4. one real frame (G.render() = full post chain if present) with shadowMap.needsUpdate, which also compiles
//     shadow-depth programs and post passes that compileAsync cannot see,
//  5. poll every program's COMPLETION_STATUS_KHR (program.isReady()) until all are linked or `timeout` ms.
// frames: 0 = compile-only (used automatically after a context restore; hidden objects are never drawn).
// Returns { ms, programs, proxies, timedOut }.
const _proxyGeo = { box: null, pts: null };
export async function warmup(G, { scene = G.scene, camera = G.camera, extras = [], timeout = 10000, frames = 2 } = {}) {
  const t0 = performance.now();
  const r = G.renderer;
  const touched = [];
  scene.traverse((o) => {
    if (!o.visible || o.frustumCulled) { touched.push(o, o.visible, o.frustumCulled); o.visible = true; o.frustumCulled = false; }
  });
  const holder = new Object3D();
  holder.name = '__warmup';
  _proxyGeo.box ||= new BoxGeometry(0.01, 0.01, 0.01);
  if (!_proxyGeo.pts) { _proxyGeo.pts = new BufferGeometry(); _proxyGeo.pts.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3)); }
  for (const e of extras) {
    const geo = e.geometry || (e.kind === 'points' ? _proxyGeo.pts : _proxyGeo.box);
    const o = e.kind === 'instanced' ? new InstancedMesh(geo, e.material, 1) : e.kind === 'points' ? new Points(geo, e.material) : new Mesh(geo, e.material);
    o.castShadow = e.castShadow !== false; o.receiveShadow = e.receiveShadow !== false; o.frustumCulled = false;
    // in front of the camera so it is inside the shadow camera too; 1 cm, under the loading screen
    o.position.set(0, 0, -1).applyMatrix4(camera.matrixWorld);
    holder.add(o);
  }
  scene.add(holder);
  let timedOut = false, restored = false;
  const restore = () => {
    if (restored) return; restored = true;
    scene.remove(holder);
    for (const o of holder.children) if (o.isInstancedMesh) o.dispose();
    for (let i = 0; i < touched.length; i += 3) { touched[i].visible = touched[i + 1]; touched[i].frustumCulled = touched[i + 2]; }
    r.shadowMap.needsUpdate = true;
  };
  try {
    // compileAsync runs compile() synchronously (programs are created now) and resolves when they have linked
    const p = r.compileAsync ? r.compileAsync(scene, camera) : (r.compile(scene, camera), Promise.resolve());
    if (!frames) restore(); // compile-only mode (mid-game re-warm): never show hidden objects on screen
    await Promise.race([p, new Promise((res) => setTimeout(() => { timedOut = true; res(); }, timeout))]);
    for (let i = 0; i < frames; i++) {
      r.shadowMap.needsUpdate = true;
      if (G.render) G.render(); else r.render(scene, camera);
      await new Promise((res) => requestAnimationFrame(res));
    }
    // poll KHR_parallel_shader_compile for anything still linking (programs created by the frames above)
    const tEnd = t0 + timeout;
    for (;;) {
      const progs = r.info.programs || [];
      let pending = 0;
      for (const pr of progs) if (pr.isReady && !pr.isReady()) pending++;
      if (!pending) break;
      if (performance.now() > tEnd) { timedOut = true; break; }
      await new Promise((res) => setTimeout(res, 16));
    }
  } finally { restore(); }
  G._warmupOpts = { scene, camera, extras, timeout }; // re-used after a context restore (compile-only)
  const res = { ms: Math.round(performance.now() - t0), programs: (r.info.programs || []).length, proxies: extras.length, timedOut };
  G.warmupStats = res;
  return res;
}

// ---- context loss / restore --------------------------------------------------------------------------------------
// three.js re-creates its GL state on 'webglcontextrestored' (core.js re-emits it as G 'contextrestored') and re-uploads geometry/textures that still have CPU data.
// What it cannot restore: render-target CONTENTS (PMREM env, baked material textures, shadow maps, history buffers).
// Systems that bake on the GPU must listen to G.on('contextrestored', rebake). A recovered loss is removed from
// G.errors (core.js records it) and counted in G.quality.contextLosses; an unrecovered one stays an error.
export function installContextGuard(G) {
  const c = G.canvas;
  let banner = null;
  const lost = () => {
    G.quality.contextLost = true; G.quality.contextLosses++;
    banner = document.createElement('div');
    banner.className = 'ui ctx-banner';
    banner.textContent = 'Graphics device reset — restoring…';
    banner.style.cssText = 'position:fixed;left:50%;top:40%;transform:translateX(-50%);padding:12px 20px;background:rgba(10,12,16,.85);color:#e8e2d6;font:600 13px system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;border:1px solid rgba(255,255,255,.15);z-index:99';
    document.body.appendChild(banner);
  };
  const restored = () => {
    G.quality.contextLost = false;
    const i = G.errors.indexOf('webglcontextlost');
    if (i >= 0) G.errors.splice(i, 1);
    G.renderer.shadowMap.needsUpdate = true;
    // every program was dropped with the context: re-warm (compile-only, nothing hidden is ever drawn)
    if (G._warmupOpts) warmup(G, { ...G._warmupOpts, frames: 0 }).catch((e) => G.errors.push('re-warmup: ' + e.message));
    banner?.remove(); banner = null;
  };
  c.addEventListener('webglcontextlost', lost);
  G.on('contextrestored', restored); // core.js emits it from the canvas 'webglcontextrestored' event (once)
  const simulate = (ms = 500) => new Promise((res) => {
    const ext = G.renderer.getContext().getExtension('WEBGL_lose_context');
    if (!ext) return res(false);
    ext.loseContext();
    setTimeout(() => { ext.restoreContext(); setTimeout(() => res(true), 100); }, ms);
  });
  return { simulate, dispose() { c.removeEventListener('webglcontextlost', lost); G.off('contextrestored', restored); } };
}
