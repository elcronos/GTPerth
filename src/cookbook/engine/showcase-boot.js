// Minimal page boot for cookbook showcase pages and quick look-dev:
//   const G = bootShowcase({ ART });  ...build scene...;  G.ready({cam:[..], target:[..]});
// Gives: core G, free-fly camera (WASD/QE + drag), harness hooks, `?cam=` support.
import { Vector3, Euler } from 'three';
import { createCore } from './core.js';

export function bootShowcase({ ART, fov = 60 } = {}) {
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
  const G = createCore({ ART, fov });
  const keys = new Set();
  const e = new Euler(0, 0, 0, 'YXZ');
  const v = new Vector3();
  let drag = false, lx = 0, ly = 0;
  addEventListener('keydown', (ev) => keys.add(ev.code));
  addEventListener('keyup', (ev) => keys.delete(ev.code));
  G.canvas.addEventListener('mousedown', (ev) => { drag = true; lx = ev.clientX; ly = ev.clientY; });
  addEventListener('mouseup', () => (drag = false));
  addEventListener('mousemove', (ev) => {
    if (!drag) return;
    e.setFromQuaternion(G.camera.quaternion);
    e.y -= (ev.clientX - lx) * 0.004; e.x -= (ev.clientY - ly) * 0.004;
    e.x = Math.max(-1.5, Math.min(1.5, e.x));
    G.camera.quaternion.setFromEuler(e);
    lx = ev.clientX; ly = ev.clientY;
  });
  G.on('update', (dt) => {
    const s = (keys.has('ShiftLeft') ? 20 : 5) * dt;
    v.set((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0), (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0));
    if (v.lengthSq()) G.camera.position.add(v.multiplyScalar(s).applyQuaternion(G.camera.quaternion));
  });
  G.ready = ({ cam = [0, 2, 8], target = [0, 1, 0] } = {}) => {
    G.camera.position.fromArray(cam);
    G.camera.lookAt(...target);
    G.start();
    // let a few frames render (shader compile, adaptation) before signalling ready
    let n = 0;
    const tick = () => (++n > 3 ? G.markReady() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  };
  return G;
}
