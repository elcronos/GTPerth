// Mission "THE ZOO RUN": steal the Transperth ferry MV Tricia from the Elizabeth Quay Jetty and take it across
// Perth Water to Mends Street Jetty, South Perth, with the Water Police on your tail. Win: berth at Mends Street.
// Lose: WASTED (you or the ferry destroyed) / BUSTED. Then free roam.
import { PLACES } from '../../map.js';

export const REWARD = 50000;
export function createMission(G, { hud, getPlayer, ferry, wanted, events }) {
  const M = { step: 'intro', t: 0, done: false };
  const ROUTE_TO_JETTY = [[40, -212], [24, -198], [12, -160], [8, -127]];
  const ROUTE_TO_MENDS = [[60, -90], [30, -30], [0, 40], [-60, 300], [-160, 950], [-182, 1235]];
  const at = (x, z, r) => { const p = getPlayer(); const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z; return Math.hypot(px - x, pz - z) < r; };
  M.start = () => {
    M.step = 'goto'; M.t = 0; M.done = false;
    setTimeout(() => hud.message('SHAZ', 'Oi. The zoo ferry is sitting at the <b>Elizabeth Quay Jetty</b>. Get it to <b>Mends Street</b>. Fifty grand, cash. Try not to sink it.', 'S'), 900);
    hud.objective('Go to the <b>Elizabeth Quay Jetty</b>.');
    hud.target = [8, -127]; hud.route = ROUTE_TO_JETTY;
  };
  M.onBoardFerry = () => {
    if (M.step !== 'goto' && M.step !== 'reboard') return;
    const first = M.step === 'goto';
    M.step = 'cross'; M.t = 0;
    hud.objective('Take the ferry to <b>Mends Street Jetty</b>, South Perth.');
    hud.target = [PLACES.mendsHead[0], PLACES.mendsHead[1]]; hud.route = ROUTE_TO_MENDS;
    if (first) {
      wanted.setMin(2);
      hud.goLive(26);
      setTimeout(() => hud.message('SHAZ', 'Water Police are already on the radio. Out under the bridge and floor it.', 'S'), 2500);
      setTimeout(() => hud.message('TRANSPERTH ALERT', 'Elizabeth Quay – Mends St ferry service suspended due to an incident. Please use the 30/31 bus.', 'T'), 9000);
    }
  };
  M.onLeaveFerry = () => { if (M.step === 'cross') { M.step = 'reboard'; hud.objective('Get back on the <i>ferry</i>.'); hud.target = [ferry.x, ferry.z]; hud.route = [[ferry.x, ferry.z]]; } };
  M.onBerth = (where) => {   // the skipper left the helm and the ferry was tied up at a berth
    if (M.step === 'cross' && where === 'mends') { M.step = 'passed'; M.done = true; hud.objective(''); hud.route = null; hud.target = null; events.onPassed?.(); }
  };
  M.fail = (kind) => { if (M.step === 'failed' || M.step === 'passed') return; M.prev = M.step; M.step = 'failed'; hud.objective(''); hud.route = null; hud.target = null; events.onFail?.(kind); };
  M.update = (dt) => {
    M.t += dt;
    const p = getPlayer();
    if (M.step === 'goto' || M.step === 'reboard') {
      if (M.step === 'reboard') { hud.target = [ferry.x, ferry.z]; hud.route = [[ferry.x, ferry.z]]; }
    }
    if (M.step === 'cross') {
      if (ferry.health <= 0) { M.fail('ferry'); return; }
      const [hx, hz] = PLACES.mendsHead;
      const d = Math.hypot(ferry.x - hx, ferry.z - hz);
      if (d < 70) hud.objective(`Berth at <b>Mends Street Jetty</b> &mdash; slow down. <u>${Math.round(Math.abs(ferry.speed) * 3.6)} km/h</u>`);
      if (d < 34 && Math.abs(ferry.speed) < 4.2 && p.vehicle === ferry) {
        M.step = 'passed'; M.done = true;
        hud.objective(''); hud.route = null; hud.target = null;
        events.onPassed?.();
      }
    }
    // blips
    const bl = [];
    if (M.step === 'goto') bl.push({ x: PLACES.ferryDock[0], z: PLACES.ferryDock[1], kind: 'mission' });
    if (M.step === 'cross') bl.push({ x: PLACES.mendsHead[0], z: PLACES.mendsHead[1], kind: 'mission' });
    if (M.step === 'reboard' || M.step === 'goto') bl.push({ x: ferry.x, z: ferry.z, kind: 'ferry' });
    M.blips = bl;
  };
  return M;
}
