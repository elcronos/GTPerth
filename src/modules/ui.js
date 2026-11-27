// UI state machine over the DOM in template.html: title (live PATH flyover) → playing ⇄ paused, settings.
//   create(G, { input, player, quality, path }) → { state, setState(s), set(bind, value), update }
//   ui.set('objective', 'Reach the crane'); ui.set('health', 0.6); ui.set('prompt', '[E] Open')
// ?shot=1 or ?autostart=1 skips the title (captures/bots). Settings persist in localStorage (try/catch).
// Sets G.paused while not playing (player/actors should idle on it).
import { CatmullRomCurve3, Vector3 } from 'three';

const KEY = 'onefile.settings.v1';
export function create(G, { input, player, quality, path }) {
  const $ = (s) => document.querySelector(s);
  const el = { ui: $('#ui'), title: $('#title'), pause: $('#pause'), settings: $('#settings'), hud: $('#hud') };
  const binds = {}; document.querySelectorAll('[data-bind]').forEach((n) => { binds[n.dataset.bind] = n; });
  const settings = { quality: 'auto', sens: 1, fov: G.camera.fov, volume: 0.8, invertY: false };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* blocked storage */ }
  const U = { state: 'boot', settings };
  let back = 'title';

  function apply() {
    input.sens = 0.0022 * settings.sens; input.invertY = !!settings.invertY;
    G.camera.fov = +settings.fov; G.camera.updateProjectionMatrix();
    if (settings.quality !== 'auto' && quality && settings.quality !== G.quality.tier) { G.quality.pinned = true; quality.setTier(settings.quality, 'settings'); }
    if (settings.quality === 'auto' && G.quality.pinned && !G.params.get('q')) G.quality.pinned = false;
    G.mods?.audio?.setVolume?.(+settings.volume);
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }
  const form = el.settings?.querySelector('form');
  if (form) {
    for (const k in settings) { const f = form.elements[k]; if (!f) continue; if (f.type === 'checkbox') f.checked = !!settings[k]; else f.value = settings[k]; }
    form.addEventListener('input', () => {
      for (const k in settings) { const f = form.elements[k]; if (!f) continue; settings[k] = f.type === 'checkbox' ? f.checked : f.type === 'range' ? +f.value : f.value; }
      apply();
    });
  }
  apply();

  U.setState = (s) => {
    if (s === U.state) return;
    const prev = U.state; U.state = s; el.ui.dataset.state = s;
    el.title.hidden = s !== 'title'; el.pause.hidden = s !== 'paused'; el.settings.hidden = s !== 'settings'; el.hud.hidden = s !== 'playing';
    G.paused = s !== 'playing';
    input.enabled = s === 'playing';
    if (player) player.enabled = s === 'playing';
    if (s === 'playing' && prev !== 'playing' && !G.params.get('shot') && input.mode === 'lock') input.requestLock();
    if (s === 'playing' && prev === 'title' && player) G.camLocked = false;
    if (s !== 'playing' && document.pointerLockElement) document.exitPointerLock();
    G.emit('ui:state', s, prev);
  };
  U.set = (k, v) => {
    const n = binds[k]; if (!n) return;
    if (k === 'health') n.style.width = Math.max(0, Math.min(1, v)) * 100 + '%';
    else if (k === 'damage') n.style.opacity = String(v);
    else n.textContent = v ?? '';
  };

  el.ui.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
    if (act === 'start' || act === 'resume') U.setState('playing');
    else if (act === 'settings') { back = U.state; U.setState('settings'); }
    else if (act === 'back') U.setState(back);
    else if (act === 'restart') { G.emit('restart'); U.setState('playing'); }
  });
  G.on('input:unlock', () => { if (U.state === 'playing' && input.mode === 'lock') U.setState('paused'); });

  // title flyover along PATH (slow, looping); bench/captures that lock the camera win
  const P = path && path.length > 1 ? path : null;
  const cp = P && new CatmullRomCurve3(P.map((k) => new Vector3(k[0], k[1], k[2])), true, 'centripetal');
  const ct = P && new CatmullRomCurve3(P.map((k) => new Vector3(k[3], k[4], k[5])), true, 'centripetal');
  const a = new Vector3(), b = new Vector3();
  let flyT = 0;
  U.update = (dt) => {
    if (input.pressed('pause')) { if (U.state === 'playing') U.setState('paused'); else if (U.state === 'paused') U.setState('playing'); }
    if (U.state === 'title' && cp && !G.camLocked) {
      flyT = (flyT + dt / 60) % 1;
      cp.getPointAt(flyT, a); ct.getPointAt(flyT, b);
      G.camera.position.copy(a); G.camera.lookAt(b);
    }
  };
  const auto = G.params.get('shot') || G.params.get('autostart');
  G.on('ready', () => U.setState(auto ? 'playing' : 'title'));
  return U;
}
