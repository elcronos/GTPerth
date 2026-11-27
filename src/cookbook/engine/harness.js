// Test hooks every game and showcase exposes, so agents can screenshot fixed poses, read stats and
// detect errors without seeing the screen. See cookbook/CONTRACT.md "Harness hooks".
export function installHarness(G) {
  const p = G.params;
  window.__errors = G.errors;
  window.__ready = false;
  window.addEventListener('error', (e) => G.errors.push('error: ' + (e.message || e)));
  window.addEventListener('unhandledrejection', (e) => G.errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));

  window.__setCam = (pos, target) => {
    G.camera.position.fromArray(pos);
    G.camera.lookAt(target[0], target[1], target[2]);
    G.camera.updateMatrixWorld();
    G.camLocked = true; // controllers must respect this
    G.emit('camset', pos, target);
  };
  if (p.get('cam')) {
    const v = p.get('cam').split(',').map(Number);
    G.on('ready', () => window.__setCam(v.slice(0, 3), v.slice(3, 6)));
  }
  if (p.get('shot')) document.documentElement.classList.add('shot'); // CSS hides UI under .shot

  let fpsFrames = 0, fpsT = performance.now(), fps = 0, ms = 0;
  G.on('update', () => {
    fpsFrames++;
    const now = performance.now();
    if (now - fpsT > 500) { fps = (fpsFrames * 1000) / (now - fpsT); ms = 1000 / fps; fpsFrames = 0; fpsT = now; }
  });
  window.__stats = () => {
    const i = G.renderer.info;
    return {
      fps: +fps.toFixed(1), ms: +ms.toFixed(2), calls: G.frameCalls ?? i.render.calls, tris: G.frameTris ?? i.render.triangles, // last full frame
      textures: i.memory.textures, geometries: i.memory.geometries, programs: (i.programs || []).length,
      scale: G.quality.scale, tier: G.quality.tier, errors: G.errors.length, frame: G.frame,
      renderer: rendererString(G.renderer),
      ...extraStats(G),
    };
  };
  G.markReady = () => { window.__ready = true; G.emit('ready'); };
}

// Additive: systems register `G.statsHooks.push(() => ({key: value}))` to extend __stats()
// (boot.js adds `modules`, quality.js adds `dynres`, input.js adds `input`). Hooks must not throw.
function extraStats(G) {
  const out = {};
  for (const f of G.statsHooks || []) { try { Object.assign(out, f()); } catch (e) { /* stats must never throw */ } }
  return out;
}

let _rendererString = null; // cached: the debug extension query is not free
export function rendererString(renderer) {
  if (_rendererString) return _rendererString;
  return (_rendererString = rendererStringRaw(renderer));
}
function rendererStringRaw(renderer) {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}
