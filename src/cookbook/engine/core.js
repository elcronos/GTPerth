// Creates the shared G object (see cookbook/CONTRACT.md): renderer, scene, camera, sun, clock, event bus.
// Game boot and showcase pages both start here.
import { WebGLRenderer, Scene, PerspectiveCamera, DirectionalLight, Vector3, Color, NoToneMapping, SRGBColorSpace, PCFShadowMap } from 'three';
import { patchUniforms } from './patch.js';
import { installHarness } from './harness.js';

export const mulberry32 = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const NO_LISTENERS = Object.freeze([]); // shared by every event without listeners: emit() never allocates

export function sunDirFromArt(sun, out = new Vector3()) {
  const e = (sun.elevDeg * Math.PI) / 180, a = (sun.azimDeg * Math.PI) / 180;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
}

export function createCore({ canvas, ART, fov = 60, near = 0.05, far = 1500 } = {}) {
  const params = new URLSearchParams(location.search);
  if (!canvas) { canvas = document.createElement('canvas'); document.body.appendChild(canvas); }
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = NoToneMapping;          // post chain tonemaps
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;         // lighting/pcss.js replaces the filter
  renderer.shadowMap.autoUpdate = false;          // shadows update on demand (lighting/shadows)
  renderer.info.autoReset = false;                // per-FRAME totals (all passes incl. post/shadows); reset in loop()
  const dpr = Math.min(window.devicePixelRatio || 1, params.get('shot') ? 1 : 2);
  renderer.setPixelRatio(dpr);

  const scene = new Scene();
  const camera = new PerspectiveCamera(fov, 16 / 9, near, far);
  const sunDir = sunDirFromArt(ART.sun);
  const light = new DirectionalLight(new Color().fromArray(ART.sun.color), ART.sun.intensity);
  light.castShadow = true;
  scene.add(light, light.target);

  // Event bus. emit() is on the per-frame path ('preupdate', 'update', 'prerender'), so it must not allocate:
  // fixed arity (up to 4 args, no rest/spread array), indexed loop (no iterator), and a shared frozen empty
  // list for events nobody listens to. off() during emit() (a listener removing itself or an earlier one) does not
  // skip the next listener: the live array is walked and the slot re-checked after each call.
  const listeners = Object.create(null);
  const G = {
    renderer, scene, camera, canvas, width: 1, height: 1, dpr,
    t: 0, dt: 1 / 60, frame: 0, ART, params,
    quality: { tier: params.get('q') || 'high', scale: 1 },
    sun: { dir: sunDir, color: new Color().fromArray(ART.sun.color), intensity: ART.sun.intensity, light },
    rng: mulberry32,
    on(e, fn) { (listeners[e] ||= []).push(fn); return fn; },
    emit(e, a, b, c, d) {
      const l = listeners[e] || NO_LISTENERS;
      for (let i = 0; i < l.length; i++) { const fn = l[i]; fn(a, b, c, d); if (l[i] !== fn) i--; } // fn removed itself
    },
    off(e, fn) { const l = listeners[e]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    statsHooks: [],                  // fns returning extra __stats() fields (see harness.js)
    errors: [], post: null, env: null,
    render: null, // set by post pipeline; default plain render
  };
  window.__G = G;

  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || '') + (gl.getProgramInfoLog(program) || '');
    G.errors.push('shader: ' + log.slice(0, 600));
    console.error('[shader]', log);
  };
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); G.errors.push('webglcontextlost'); });
  // three.js rebuilds its GL state on this event; render-target CONTENTS are gone, so GPU bakers (env, material
  // bakes, caustics, probes) listen to G.on('contextrestored') and refill. engine/quality.js listens too (re-warm,
  // clears the recorded loss). Handlers that throw are recorded, never propagated into the browser event.
  canvas.addEventListener('webglcontextrestored', () => {
    try { G.emit('contextrestored'); } catch (err) { G.errors.push('contextrestored handler: ' + (err && err.message || err)); }
  });

  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    G.width = w; G.height = h;
    renderer.setSize(w, h, false);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix();
    G.emit('resize', w, h);
  };
  window.addEventListener('resize', resize);
  resize();

  // fixed dt for deterministic captures: ?dt=0.016667
  const fixedDt = params.get('dt') ? parseFloat(params.get('dt')) : 0;
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    const dt = fixedDt || Math.min((now - last) / 1000, 1 / 20);
    last = now;
    G.dt = dt; G.t += dt; G.frame++;
    patchUniforms.uTime.value = G.t;
    G.frameCalls = renderer.info.render.calls; G.frameTris = renderer.info.render.triangles; // last full frame
    renderer.info.reset();
    try {
      G.emit('preupdate', dt, G.t);   // input latch, frame timing — always before any 'update' listener
      G.emit('update', dt, G.t);
      if (G.render) G.render(); else renderer.render(scene, camera);
    } catch (err) {
      G.errors.push(String(err && err.stack || err).slice(0, 600));
      console.error(err);
    }
    window.__frames = G.frame;
    requestAnimationFrame(loop);
  };
  G.start = () => { installHarness(G); requestAnimationFrame(loop); };
  return G;
}
