// Wanted system + WA Police response: stars (0-5) with GTA-style heat, search phase (stars flash once the player
// breaks line of sight), patrol cars that pursue and ram, officers who chase on foot, arrest (BUSTED) and shoot
// from 2 stars, and the Water Police launch on Perth Water.
import { Car } from './vehicles.js';
import { Boat, buildPoliceBoat } from './boats.js';
import { Character } from './character.js';
import { POLICE } from './avatars.js';
import { isLand, heightAt, ROADS } from '../../map.js';
import { groundAt } from './player.js';

export function createPolice(G, { avatars, M, BM, col, sea, traffic, peds, fx, getPlayer, events }) {
  const W = { stars: 0, heat: 0, searchT: 0, seen: true, cars: [], cops: [], boats: [], spawnT: 0, lastSeen: { x: 0, z: 0 }, flash: 0, locked: false };
  const roadPts = []; for (const r of ROADS) for (const p of r.pts) roadPts.push(p);
  W.add = (n, why) => {
    const before = W.stars;
    W.stars = Math.min(5, Math.max(W.stars, 0) + n); W.searchT = 0; W.seen = true;
    if (W.stars > before) events.onStars?.(W.stars, why);
  };
  W.setMin = (n) => { if (W.stars < n) W.add(n - W.stars, 'set'); };
  W.clear = () => { W.stars = 0; W.searchT = 0; for (const c of W.cars) { c.siren = false; } events.onStars?.(0, 'clear'); };
  function spawnCar(pl) {
    const fx_ = pl.x, fz_ = pl.z;
    let best = null;
    for (let i = 0; i < 40; i++) {
      const p = roadPts[Math.floor(Math.random() * roadPts.length)];
      const d = Math.hypot(p[0] - fx_, p[1] - fz_);
      if (d > 90 && d < 260 && isLand(p[0], p[1])) { best = p; break; }
    }
    if (!best) return;
    const c = new Car(G, 'police', 0xf4f4f2, M, col);
    c.place(best[0], best[1], Math.atan2(fz_ - best[1], fx_ - best[0]));
    c.police = true; c.siren = true; c.unit = { state: 'pursue', exitT: 0, cops: [] };
    W.cars.push(c); traffic.cars.push(c);
  }
  function spawnCop(x, z, car) {
    const ch = new Character(G, avatars.instance(POLICE[W.cops.length % POLICE.length]));
    G.scene.add(ch.root); ch.root.position.set(x, groundAt(x, z).y, z);
    const cop = { ch, car, yaw: 0, speed: 0, shootT: 1 + Math.random(), arrestT: 0 };
    W.cops.push(cop); return cop;
  }
  function spawnBoat(pl) {
    // launch from Barrack Street Jetty or from further along Perth Water, out of sight
    const opts = [[240, 220], [-260, 300], [300, 600], [-420, 820], [0, 900]];
    let p = opts[0], bd = 0;
    for (const o of opts) { const d = Math.hypot(o[0] - pl.x, o[1] - pl.z); if (d > 160 && d < 600 && d > bd) { bd = d; p = o; } }
    const b = new Boat(G, 'policeboat', buildPoliceBoat(BM), sea);
    b.place(p[0], p[1], Math.atan2(pl.z - p[1], pl.x - p[0])); b.police = true; b.siren = true;
    W.boats.push(b);
  }
  W.update = (dt) => {
    const pl = getPlayer();
    const px = pl.vehicle ? pl.vehicle.x : pl.x, pz = pl.vehicle ? pl.vehicle.z : pl.z;
    const onWater = pl.vehicle ? (pl.vehicle.kind === 'ferry' || pl.vehicle.kind === 'policeboat') : pl.swimming;
    // line of sight from any unit
    let seen = false;
    for (const u of [...W.cars, ...W.cops.map((c) => ({ x: c.ch.position.x, z: c.ch.position.z })), ...W.boats]) {
      const d = Math.hypot(u.x - px, u.z - pz);
      if (d < 60 + W.stars * 15 && col.segment(u.x, u.z, px, pz, 1e9, 3) >= 1) { seen = true; break; }
    }
    if (W.stars > 0) {
      if (seen || W.locked) { W.searchT = 0; W.lastSeen.x = px; W.lastSeen.z = pz; }
      else { W.searchT += dt; if (W.searchT > 12 + W.stars * 6) { W.clear(); events.onEvaded?.(); } }
      W.seen = seen || W.locked;
    }
    W.flash = W.stars > 0 && !W.seen ? 1 : 0;
    // spawn response
    W.spawnT -= dt;
    const wantCars = onWater ? 0 : Math.min(4, W.stars + (W.stars >= 3 ? 1 : 0));
    const wantBoats = onWater ? Math.min(3, Math.ceil(W.stars / 2) + (W.stars >= 2 ? 1 : 0)) : 0;
    if (W.stars > 0 && W.spawnT <= 0) {
      if (W.cars.filter((c) => !c.wrecked).length < wantCars) spawnCar({ x: px, z: pz });
      if (W.boats.length < wantBoats) spawnBoat({ x: px, z: pz });
      W.spawnT = 3.5;
    }
    // ---- cars: pursue (pure pursuit on the target, ignore lanes), ram, stop near a pedestrian player
    for (let i = W.cars.length - 1; i >= 0; i--) {
      const c = W.cars[i];
      if (c === pl.vehicle) continue;
      const d = Math.hypot(c.x - px, c.z - pz);
      if ((W.stars === 0 && d > 200) || c.sunk || d > 500) { c.dispose(); W.cars.splice(i, 1); const ti = traffic.cars.indexOf(c); if (ti >= 0) traffic.cars.splice(ti, 1); continue; }
      c.ai = null; c.siren = W.stars > 0;
      if (W.stars === 0) { c.throttle = 0; c.brake = 0.5; c.update(dt); continue; }
      const tx = W.seen ? px : W.lastSeen.x, tz = W.seen ? pz : W.lastSeen.z;
      // lead the target a little
      const lead = pl.vehicle ? 0.6 : 0;
      const ax = tx + (pl.vehicle ? pl.vehicle.vx * lead : 0), az = tz + (pl.vehicle ? pl.vehicle.vz * lead : 0);
      let want = Math.atan2(az - c.z, ax - c.x);
      // avoid buildings: probe ahead, steer away from hits
      const probe = col.segment(c.x, c.z, c.x + Math.cos(c.h) * 14, c.z + Math.sin(c.h) * 14, 1e9, 2);
      if (probe < 1) want += 0.9 * (Math.sin(G.t * 0.7 + i) > 0 ? 1 : -1);
      let dh = Math.atan2(Math.sin(want - c.h), Math.cos(want - c.h));
      const v = c.speed;
      if (!pl.vehicle && d < 14) {
        c.throttle = 0; c.brake = 1; c.steer = 0;
        if (Math.abs(v) < 1.5 && c.unit.cops.length === 0) { // officers get out
          for (const s of [1, -1]) { const ox = c.x - Math.sin(c.h) * 1.4 * s, oz = c.z + Math.cos(c.h) * 1.4 * s; c.unit.cops.push(spawnCop(ox, oz, c)); }
        }
      } else if (v < -0.5 && Math.abs(dh) > 2.2) { c.throttle = 1; c.steer = Math.sign(dh); } // stuck reversing → go
      else {
        if (Math.abs(dh) > 2.0 && d < 25) { c.throttle = -1; c.steer = -Math.sign(dh); }
        else { c.throttle = Math.abs(dh) > 1.2 ? 0.55 : 1; c.steer = Math.max(-1, Math.min(1, dh * 2.5)); }
        c.brake = 0; c.hand = Math.abs(dh) > 1.0 && v > 12 ? 1 : 0;
      }
      c.update(dt);
      if (Math.abs(c.speed) > 2.5) peds.hitByVehicle(c);
    }
    // ---- officers on foot: chase, arrest if close, shoot from 2 stars
    for (let i = W.cops.length - 1; i >= 0; i--) {
      const cop = W.cops[i], ch = cop.ch, pos = ch.position;
      const d = Math.hypot(pos.x - px, pos.z - pz);
      if (W.stars === 0 || d > 220) {
        if (d > 120) { G.scene.remove(ch.root); W.cops.splice(i, 1); continue; }
      }
      if (ch.state !== 'ok') { ch.update(dt, groundAt(pos.x, pos.z, pos.y).y); continue; }
      let target = 0;
      if (W.stars > 0) {
        const want = Math.atan2(px - pos.x, pz - pos.z);
        cop.yaw += Math.atan2(Math.sin(want - cop.yaw), Math.cos(want - cop.yaw)) * Math.min(1, 6 * dt);
        target = pl.vehicle ? (d > 6 ? 5.5 : 0) : d > 1.3 ? (d > 10 ? 5.6 : 3.2) : 0;
        // arrest: close to a pedestrian player who isn't sprinting away
        if (!pl.vehicle && d < 1.6 && !pl.swimming) { cop.arrestT += dt; if (cop.arrestT > 1.1 && pl.speed < 4.5) events.onBusted?.(); } else cop.arrestT = Math.max(0, cop.arrestT - dt);
        // shoot
        cop.shootT -= dt;
        if (W.stars >= 2 && d < 32 && d > 3 && cop.shootT <= 0 && col.segment(pos.x, pos.z, px, pz, 1e9, 2) >= 1) {
          cop.shootT = 0.9 + Math.random() * 0.8; target = 0;
          const muzzle = { x: pos.x + Math.sin(cop.yaw) * 0.5, y: pos.y + 1.4, z: pos.z + Math.cos(cop.yaw) * 0.5 };
          fx.muzzle?.(muzzle, { x: Math.sin(cop.yaw), y: 0, z: Math.cos(cop.yaw) }, 'pistol', { light: true });
          events.onShot?.(muzzle, d);
          if (Math.random() < 0.38 - d * 0.006 + W.stars * 0.03) events.onPlayerHit?.(pl.vehicle ? 3 : 7 + Math.random() * 5);
        }
      }
      cop.speed += (target - cop.speed) * Math.min(1, 5 * dt);
      let nx = pos.x + Math.sin(cop.yaw) * cop.speed * dt, nz = pos.z + Math.cos(cop.yaw) * cop.speed * dt;
      const c = col.circleVsWorld(nx, nz, 0.3); if (c.hit) { nx = c.x; nz = c.z; }
      if (!isLand(nx, nz)) { nx = pos.x; nz = pos.z; }
      pos.x = nx; pos.z = nz; ch.speed = cop.speed; ch.root.rotation.y = cop.yaw;
      ch.update(dt, groundAt(nx, nz, pos.y).y);
    }
    // ---- water police: intercept + ram the player's boat
    for (let i = W.boats.length - 1; i >= 0; i--) {
      const b = W.boats[i];
      if (b === pl.vehicle) continue;
      const d = Math.hypot(b.x - px, b.z - pz);
      if ((W.stars === 0 && d > 150) || d > 900) { G.scene.remove(b.root); G.scene.remove(b.wake.mesh); W.boats.splice(i, 1); continue; }
      if (W.stars === 0) { b.throttle = 0.2; b.steer = 0.3; b.update(dt); continue; }
      const tv = pl.vehicle || { vx: 0, vz: 0 };
      const lead = Math.min(3, d / 14);
      const tx = px + tv.vx * lead, tz = pz + tv.vz * lead;
      const want = Math.atan2(tz - b.z, tx - b.x);
      const dh = Math.atan2(Math.sin(want - b.h), Math.cos(want - b.h));
      b.steer = Math.max(-1, Math.min(1, dh * 2)); b.throttle = d < 10 ? 0.6 : 1;
      b.update(dt);
      // ram / contact with the player's boat
      if (pl.vehicle && pl.vehicle.P) {
        const v = pl.vehicle, m = (v.model.L + b.model.L) * 0.3;
        if (d < m) {
          const nx = (v.x - b.x) / (d || 1), nz = (v.z - b.z) / (d || 1); const pen = m - d;
          v.x += nx * pen * 0.25; v.z += nz * pen * 0.25; b.x -= nx * pen * 0.75; b.z -= nz * pen * 0.75;
          const rv = (v.vx - b.vx) * nx + (v.vz - b.vz) * nz;
          if (rv < -1) { const j = -rv; v.vx += nx * j * 0.35; v.vz += nz * j * 0.35; b.vx -= nx * j * 1.2; b.vz -= nz * j * 1.2; v.health -= j * 1.6; events.onRam?.(j, b); }
        }
        // officers on deck shoot at 3 stars
        b.shootT = (b.shootT ?? 2) - dt;
        if (W.stars >= 3 && d < 45 && b.shootT <= 0) { b.shootT = 1.2 + Math.random(); fx.muzzle?.({ x: b.x, y: b.y + 2, z: b.z }, { x: (px - b.x) / d, y: 0, z: (pz - b.z) / d }, 'rifle', { light: true }); events.onShot?.({ x: b.x, y: 2, z: b.z }, d); if (Math.random() < 0.3) events.onPlayerHit?.(4); }
      }
    }
  };
  W.reset = () => {
    for (const c of W.cars) { c.dispose(); const ti = traffic.cars.indexOf(c); if (ti >= 0) traffic.cars.splice(ti, 1); }
    for (const c of W.cops) G.scene.remove(c.ch.root);
    for (const b of W.boats) { G.scene.remove(b.root); G.scene.remove(b.wake.mesh); }
    W.cars.length = 0; W.cops.length = 0; W.boats.length = 0; W.stars = 0; W.searchT = 0;
  };
  return W;
}
