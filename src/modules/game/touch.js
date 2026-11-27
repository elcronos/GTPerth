// Phone / tablet controls in the GTA mobile style: the move stick appears wherever the left thumb lands (input.js
// twin-stick), the right half of the screen drags the camera, and a thumb arc of context buttons sits bottom-right:
//   on foot:  ENTER/HIJACK (when a car or the ferry is near) · PUNCH · JUMP · SPRINT (hold)
//   driving:  EXIT · HORN · BRAKE (hold, handbrake) — the stick is throttle / brake / steering
// plus a pause button top-right and a "rotate your phone" card in portrait.
export function createTouchControls(G, { input, ctx }) {
  const root = document.getElementById('ui');
  const coarse = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const wrap = document.createElement('div'); wrap.className = 'tc'; wrap.hidden = true; root.appendChild(wrap);
  const rot = document.createElement('div'); rot.className = 'tc-rotate'; rot.innerHTML = '<b>&#x21bb;</b><span>Turn your phone sideways</span>'; root.appendChild(rot);
  const held = new Set();
  const mk = (id, label, cls, mode) => {
    const b = document.createElement('div'); b.className = 'tc-btn ' + cls; b.dataset.id = id; b.innerHTML = `<span>${label}</span>`;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.setPointerCapture(e.pointerId); b.classList.add('on'); b._down = true; b.onPress?.(); });
    const up = () => { b.classList.remove('on'); b._down = false; b.onRelease?.(); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    wrap.appendChild(b); return b;
  };
  const bAction = mk('action', 'ENTER', 'act');
  const bPunch = mk('punch', 'PUNCH', 'b2');
  const bJump = mk('jump', 'JUMP', 'b3');
  const bSprint = mk('sprint', 'SPRINT', 'b4');
  const bPause = mk('pause', '&#10074;&#10074;', 'pause');
  bAction.onPress = () => input.press('interact');
  bPunch.onPress = () => { const c = ctx(); input.press(c.inVehicle ? 'horn' : 'fire'); };
  bJump.onPress = () => { if (!ctx().inVehicle) input.press('jump'); };
  bPause.onPress = () => input.press('pause');
  // holds (sprint on foot, handbrake in a car) are refreshed every frame while the finger is down
  G.on('preupdate', () => {
    if (bSprint._down) input.hold('sprint', 120);
    if (bJump._down && ctx().inVehicle) input.hold('jump', 120);
  });
  let shown = false;
  const show = () => { if (shown) return; shown = true; document.body.classList.add('touch'); wrap.hidden = false; };
  if (coarse) show();
  addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') show(); }, { capture: true });
  // context labels (cheap DOM writes only on change)
  let last = '';
  G.on('update', () => {
    if (!shown) return;
    const c = ctx();
    wrap.hidden = c.mode !== 'playing';
    const key = [c.inVehicle, c.canEnter, c.isFerry, c.hijack].join();
    if (key === last) return; last = key;
    bAction.firstChild.textContent = c.inVehicle ? 'EXIT' : c.hijack ? 'HIJACK' : 'ENTER';
    bAction.classList.toggle('dim', !c.inVehicle && !c.canEnter);
    bPunch.firstChild.textContent = c.inVehicle ? (c.isFerry ? 'HORN' : 'HORN') : 'PUNCH';
    bJump.firstChild.textContent = c.inVehicle ? (c.isFerry ? '—' : 'BRAKE') : 'JUMP';
    bJump.classList.toggle('dim', c.inVehicle && c.isFerry);
    bSprint.hidden = c.inVehicle;
  });
  // landscape hint
  const orient = () => rot.classList.toggle('show', shown && innerHeight > innerWidth * 1.1);
  addEventListener('resize', orient); G.on('update', () => { if ((G.frame & 31) === 0) orient(); });
  return { show, get active() { return shown; } };
}
