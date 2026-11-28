// Street jobs from Shaz after THE ZOO RUN: short, repeatable GTA-style gigs that use the systems already in the
// game (stealing cars, the wanted level, melee) so there is always something to do minute to minute.
//   BOOST      steal a marked car and drop it at a lock-up, under 10 km/h, without wrecking it
//   HEAT       get spotted (2 stars) and lose the cops within the time limit
//   COLLECT    a bloke owes Shaz money: find him and knock him out, then grab the cash
import { ROADS, isLand } from '../../map.js';

const DROPS = [[274, -149, 'the lock-up on Barrack Street'], [-156, -392, 'the Mounts Bay Road car park'], [568, -83, 'the Terrace Road lay-by']];
const roadPts = []; for (const r of ROADS) if (r.traffic !== false) for (const p of r.pts) if (isLand(p[0], p[1])) roadPts.push(p);

export function createJobs(G, { hud, getPlayer, traffic, peds, wanted, events }) {
  const J = { active: null, wait: 25, count: 0, blips: [] };
  const pos = () => { const p = getPlayer(); return p.vehicle ? [p.vehicle.x, p.vehicle.z] : [p.x, p.z]; };
  const pay = (amount, title) => {
    hud.big('passed', 'JOB DONE', `${title}  ·  +$${amount.toLocaleString('en-AU')}`, 4); hud.addCash(amount); events.onPaid?.(amount);
    J.active = null; J.wait = 30; J.count++; hud.objective(''); hud.route = null; hud.target = null;
  };
  const fail = (why) => { hud.message('SHAZ', why, 'S'); J.active = null; J.wait = 35; hud.objective(''); hud.route = null; hud.target = null; };
  function offer() {
    const [px, pz] = pos(), kinds = ['boost', 'heat', 'collect'], kind = kinds[J.count % 3];
    if (kind === 'boost') {
      const cars = traffic.cars.filter((c) => !c.police && c.K && !c.K.bus && !c.wrecked && Math.hypot(c.x - px, c.z - pz) > 60 && Math.hypot(c.x - px, c.z - pz) < 320);
      if (!cars.length) { J.wait = 10; return; }
      const car = cars[Math.floor(Math.random() * cars.length)]; car.keep = true;
      const drop = DROPS.slice().sort((a, b) => Math.hypot(b[0] - car.x, b[1] - car.z) - Math.hypot(a[0] - car.x, a[1] - car.z))[0];
      J.active = { kind, car, drop, t: 0, stage: 'steal', pay: 1500 + Math.round(Math.random() * 15) * 100 };
      hud.message('SHAZ', `Got a buyer for a car. It's the one I marked. Bring it to <b>${drop[2]}</b> in one piece.`, 'S');
      hud.objective('Steal the <b>marked car</b>.');
    } else if (kind === 'heat') {
      J.active = { kind, t: 0, stage: 'get', limit: 120, pay: 2500 };
      hud.message('SHAZ', 'Need the cops looking the other way for a bit. Make some noise, then <b>lose them</b>.', 'S');
      hud.objective('Get a <b>2-star</b> wanted level &mdash; jack a car, rough someone up in front of the cops.');
    } else {
      const cand = peds.list.filter((q) => q.ch.state === 'ok' && q.kind !== 'idle' && q.ch.root.visible && Math.hypot(q.ch.position.x - px, q.ch.position.z - pz) > 25 && Math.hypot(q.ch.position.x - px, q.ch.position.z - pz) < 120);
      if (!cand.length) { J.wait = 10; return; }
      const mark = cand[Math.floor(Math.random() * cand.length)]; mark.hp = 140; mark.fled = true; mark.isMark = true;
      J.active = { kind, mark, t: 0, stage: 'find', pay: 1000 + Math.round(Math.random() * 10) * 100 };
      hud.message('SHAZ', 'Bloke on the foreshore owes me. <b>Flatten him</b> and take what\'s mine.', 'S');
      hud.objective('Knock out the <b>mark</b>.');
    }
  }
  J.update = (dt, missionDone) => {
    J.blips = [];
    if (!missionDone) return;
    const A = J.active, p = getPlayer();
    if (!A) { J.wait -= dt; if (J.wait <= 0 && !wanted.stars) offer(); return; }
    A.t += dt;
    const [px, pz] = pos();
    if (A.kind === 'boost') {
      const c = A.car;
      if (c.wrecked || c.sunk || c.health <= 0 || !traffic.cars.includes(c)) { c.keep = false; return fail('Car\'s gone. Buyer walked. Forget it.'); }
      if (A.t > 240) { c.keep = false; return fail('Took too long. Buyer bought elsewhere.'); }
      if (A.stage === 'steal') {
        J.blips.push({ x: c.x, z: c.z, kind: 'mission' }); hud.target = [c.x, c.z]; hud.route = [[c.x, c.z]];
        if (p.vehicle === c) { A.stage = 'drop'; hud.objective(`Deliver the car to <b>${A.drop[2]}</b>.`); if (Math.random() < 0.5) wanted.setMin(1); }
      } else {
        J.blips.push({ x: A.drop[0], z: A.drop[1], kind: 'mission' }); hud.target = [A.drop[0], A.drop[1]]; hud.route = [[A.drop[0], A.drop[1]]];
        if (p.vehicle !== c) { A.stage = 'steal'; hud.objective('Get back in the <b>marked car</b>.'); }
        else if (Math.hypot(c.x - A.drop[0], c.z - A.drop[1]) < 7 && Math.abs(c.speed) < 2.8) { if (wanted.stars) hud.objective('Lose the <b>cops</b> first.'); else { c.keep = false; pay(A.pay, 'BOOSTED'); } }
      }
    } else if (A.kind === 'heat') {
      if (A.stage === 'get') { if (wanted.stars >= 2) { A.stage = 'lose'; A.t = 0; hud.objective(`Lose the cops. <u>${A.limit}s</u>`); } }
      else {
        const left = Math.max(0, Math.ceil(A.limit - A.t)); hud.objective(`Lose the cops. <u>${left}s</u>`);
        if (!wanted.stars) pay(A.pay, 'HEAT DROPPED'); else if (left <= 0) fail('Too slow. Cops are all over my street now. Cheers.');
      }
    } else if (A.kind === 'collect') {
      const m = A.mark;
      if (A.stage === 'find') {
        J.blips.push({ x: m.ch.position.x, z: m.ch.position.z, kind: 'mission' }); hud.target = [m.ch.position.x, m.ch.position.z]; hud.route = [[m.ch.position.x, m.ch.position.z]];
        if (m.ch.state === 'ok' && !m.fight && Math.hypot(m.ch.position.x - px, m.ch.position.z - pz) < 6) { m.fight = { t: 0, cd: 0.6, side: 'L' }; m.state = 'fight'; hud.message('SHAZ', 'He\'s seen you. Don\'t let him get away.', 'S'); }
        if (m.ch.state !== 'ok') { A.stage = 'grab'; A.t = 0; hud.objective('Take the <b>cash</b> off him.'); }
        if (A.t > 150) fail('He legged it. Next time.');
      } else { J.blips.push({ x: m.ch.position.x, z: m.ch.position.z, kind: 'mission' }); if (Math.hypot(m.ch.position.x - px, m.ch.position.z - pz) < 1.8 && !p.vehicle) { m.isMark = false; pay(A.pay, 'DEBT COLLECTED'); } else if (A.t > 60) fail('Someone else got to his wallet first.'); }
    }
  };
  J.cancel = () => { if (J.active) { J.active = null; J.wait = 20; hud.objective(''); hud.route = null; hud.target = null; } };
  return J;
}
