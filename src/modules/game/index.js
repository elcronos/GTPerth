// Game orchestration: title flyover → playing ⇄ paused; WASTED / BUSTED / MISSION PASSED sequences; vehicle
// entry/exit; crime → wanted; harness/debug hooks (__G.game) and ?show=chase for the action pose.
import { CatmullRomCurve3, Vector3, BoxGeometry, MeshStandardMaterial, Mesh, Color } from 'three';
import { PATH, PLAYER } from '../../contracts.js';
import { PLACES, isLand, ROADS, mendsBerth } from '../../map.js';
import { loadAvatars, MALE } from './avatars.js';
import { loadModels } from './models.js';
import { createCollision } from './collide.js';
import { createPlayer, groundAt } from './player.js';
import { createParkedRows } from './parked.js';
import { createJobs } from './jobs.js';
import { Character } from './character.js';
import { makeCarMaterials, CAR_COLORS } from './vehicles.js';
import { boatMaterials, buildFerry, buildPoliceBoat, Boat } from './boats.js';
import { createTraffic } from './traffic.js';
import { createPeds } from './peds.js';
import { createPolice } from './police.js';
import { createHUD } from './hud.js';
import { createAudio } from './audio.js';
import { createMission, REWARD } from './mission.js';
import { createTouchControls } from './touch.js';

export async function create(G, { input, world, fx, quality }) {
  const shot = G.params.has('shot'), auto = G.params.has('autostart') || shot;
  const avatars = await loadAvatars(G);
  await loadModels();
  const col = createCollision(world.colliders);
  const M = makeCarMaterials(), BM = boatMaterials();
  (G.nightMats ||= []).push({ mat: M.light, day: 0.3, night: 6 }, { mat: M.tail, day: 0.25, night: 3 });
  const hud = createHUD(G, { col, footprints: world.towers.footprints });
  const audio = createAudio(G); G.mods = { audio };
  const player = createPlayer(G, { avatars, input, col, hud });
  const peds = createPeds(G, { avatars, col });
  const traffic = createTraffic(G, { lanes: world.roads.lanes, M, col, peds, getPlayer: () => player });
  // the ferry, berthed at the Elizabeth Quay Jetty, bow north
  const ferry = new Boat(G, 'ferry', buildFerry(BM), world.sea);
  const dockFerry = () => { ferry.place(PLACES.ferryDock[0], PLACES.ferryDock[1], Math.atan2(PLACES.eqJettyDir[1], PLACES.eqJettyDir[0])); ferry.health = 100; ferry.throttle = 0; ferry.steer = 0; };
  dockFerry();
  // a few parked cars at the kerbs near the Quay (easy to steal)
  const parked = [];
  { const hiP = G.quality.tier === 'high' || G.quality.tier === 'ultra';
    const want = hiP ? [[60, -200, 8], [100, -450, 6], [-60, -560, 6], [300, -250, 5], [-200, 1380, 2]] : [[60, -200, 6], [-200, 1380, 1]];
    for (const [cx, cz, n] of want) {
      let got = 0;
      for (const r of ROADS) { if (got >= n) break; if (r.cls !== 's' && r.cls !== 'm' && !(hiP && r.cls === 'p')) continue;
        for (let i = 0; i < r.pts.length - 1 && got < n; i++) { const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 20) continue;
          const mx = (ax + bx) / 2, mz = (az + bz) / 2, d = Math.hypot(mx - cx, mz - cz); if (d < 40 || d > 240) continue;
          const tx = (bx - ax) / L, tz = (bz - az) / L, off = r.w / 2 - 1.3; // left kerb (left-hand traffic)
          const x = mx + tz * off, z = mz - tx * off; if (!isLand(x, z) || parked.some((p) => Math.hypot(p[0] - x, p[1] - z) < (hiP ? 10 : 30))) continue;
          parked.push([x, z, Math.atan2(tz, tx)]); got++; } } } }
  // static kerbside rows in the CBD (instanced, no physics)
  const parkedRows = G.quality.tier === 'low' ? null : createParkedRows(G, M, { fill: 0.55 });   // phones keep the physics-car handful only
  for (const [x, z, h] of parked) { const c = traffic.spawnAt(['sedan', 'ute', 'suv', 'hatch'][(Math.random() * 4) | 0], x, z, h, CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0]); c.parked = true; }

  const state = { mode: auto ? 'playing' : 'title', t: 0, deadT: 0, timeScale: 1, passedT: 0 };
  const events = {};
  const wanted = createPolice(G, { avatars, M, BM, col, sea: world.sea, traffic, peds, fx, getPlayer: () => player, events });
  const mission = createMission(G, { hud, getPlayer: () => player, ferry, wanted, events });
  const jobs = createJobs(G, { hud, getPlayer: () => player, traffic, peds, wanted, events });
  G.warmExtras = [...avatars.warm];

  // ---------------------------------------------------------------- events
  events.onStars = (n) => { if (n > 0) audio.play('alarm', { gain: 0 }); };
  events.onShot = (pos, d) => audio.play('pistol', { pos: [pos.x, pos.y, pos.z], send: 0.4, gain: 0.8 });
  events.onPlayerHit = (dmg) => { if (state.mode !== 'playing') return; player.health -= dmg; state.sinceHit = 0; hud.hit(); audio.play('impact_flesh', { gain: 0.6 }); };
  events.onRam = (j) => { hud.hit(); audio.play('impact_metal', { pos: [ferry.x, 1, ferry.z], gain: Math.min(1, j / 6) }); G.emit('fx:shake', Math.min(1, j / 8)); };
  events.onBusted = () => fail('busted');
  events.onEvaded = () => hud.message('POLICE SCANNER', 'All units, suspect lost. Resume patrol.', '📻');
  events.onPassed = () => {
    state.passedT = 0.01;
    hud.big('passed', 'MISSION PASSED', 'THE ZOO RUN  ·  +$' + REWARD.toLocaleString('en-AU'), 6);
    hud.addCash(REWARD); audio.play('pickup', { bus: 'ui', gain: 0.8 });
    setTimeout(() => { wanted.clear(); hud.message('SHAZ', 'Legend. Money\'s in. Grab a feed on Mends Street and lie low. Perth\'s yours.', 'S'); hud.objective('Free roam &mdash; <b>Perth</b> is yours.'); setTimeout(() => hud.objective(''), 6000); }, 2500);
  };
  events.onFail = (kind) => fail(kind === 'ferry' ? 'ferry' : kind);
  function fail(kind) {
    if (state.mode !== 'playing') return;
    state.mode = 'dead'; state.deadT = 0; state.deadStart = performance.now(); state.kind = kind; player.control = false;
    if (kind === 'ferry') { fx.explosion?.({ x: ferry.x, y: ferry.y + 2, z: ferry.z }, { scale: 2.2 }); audio.play('explosion_near', { pos: [ferry.x, 2, ferry.z], gain: 1 }); }
    if (kind === 'busted') hud.big('busted', 'BUSTED', 'WA Police', 4.5);
    else hud.big('wasted', 'WASTED', kind === 'ferry' ? 'The ferry went down' : '', 4.5);
    if (kind !== 'busted' && player.ch.state === 'ok' && !player.vehicle) player.ch.knockDown(Math.sin(player.yaw) * -2, Math.cos(player.yaw) * -2, 1);
    if (G.post) { state.savedSat = G.post.params.sat; }
  }
  function respawn() {
    hud.hideBig(); jobs.cancel();
    if (player.vehicle) exitVehicle(true);
    wanted.reset();
    player.health = 100; player.stamina = 1; player.dead = false; player.swimming = false; player.control = true;
    player.teleport(PLAYER.spawn[0], PLAYER.spawn[2], PLAYER.spawnYaw);
    player.camYaw = PLAYER.spawnYaw + Math.PI; player.camPitch = 0.10;
    dockFerry();
    if (G.post) { G.post.params.sat = state.savedSat ?? G.ART.grade.sat; G.post.resetAdaptation?.(); }
    state.mode = 'playing'; state.timeScale = 1;
    if (!mission.done) mission.start();
  }

  // ---------------------------------------------------------------- vehicles
  function nearestCar() {
    let best = null, bd = 3.4;
    for (const c of traffic.cars) { if (c.inWater > 0) continue; const d = Math.hypot(c.x - player.x, c.z - player.z); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  function nearFerry() {
    if (player.vehicle) return false;
    const fx_ = Math.cos(ferry.h), fz_ = Math.sin(ferry.h);
    const dx = player.x - ferry.x, dz = player.z - ferry.z;
    const a = dx * fx_ + dz * fz_, s = -dx * fz_ + dz * fx_;
    return Math.abs(a) < ferry.model.L / 2 + 2 && Math.abs(s) < ferry.model.B / 2 + 5.5;
  }
  function enterVehicle(v) {
    player.vehicle = v; player.ch.root.visible = false; player.speed = 0;
    if (v.ai) { // jacked: the driver bails and runs
      const hx = v.x - Math.sin(v.h) * 1.6, hz = v.z + Math.cos(v.h) * 1.6;
      const p = peds.list.find((pp) => !pp.ch.root.visible && pp.ch.state === 'ok');
      if (p) { p.ch.position.set(hx, groundAt(hx, hz).y, hz); p.state = 'flee'; p.fleeT = 8; p.from = [v.x, v.z]; }
      v.ai = null;
      if (wanted.stars === 0 && Math.random() < 0.35) wanted.add(1, 'jacked');
    }
    if (v.police) { const i = wanted.cars.indexOf(v); if (i >= 0) wanted.cars.splice(i, 1); v.police = false; v.unit = null; v.siren = false; wanted.setMin(2); }
    v.driver = player; v.parked = false;
    audio.setVehicle(v);
    if (v === ferry) mission.onBoardFerry();
    player.camYaw = Math.PI / 2 - v.h + Math.PI;
  }
  function exitVehicle(silent) {
    const v = player.vehicle; if (!v) return;
    v.driver = null; v.throttle = 0; v.steer = 0; v.brake = v.P ? 0 : 0.5;
    // RHD: driver door on the right
    let ox = v.x - Math.sin(v.h) * (v.K ? v.K.W / 2 + 0.8 : 2), oz = v.z + Math.cos(v.h) * (v.K ? v.K.W / 2 + 0.8 : 2);
    if (v === ferry) { // step off onto the jetty / promenade if one is near, else onto the side deck → into the water
      ox = v.x - Math.sin(v.h) * (v.model.B / 2 + 4.5); oz = v.z + Math.cos(v.h) * (v.model.B / 2 + 4.5);
      if (!isLand(ox, oz)) { const ox2 = v.x + Math.sin(v.h) * (v.model.B / 2 + 4.5), oz2 = v.z - Math.cos(v.h) * (v.model.B / 2 + 4.5); if (isLand(ox2, oz2)) { ox = ox2; oz = oz2; } }
    }
    player.vehicle = null; player.ch.root.visible = true;
    player.teleport(ox, oz, Math.PI / 2 - v.h);
    if (!silent) audio.setVehicle(null);
    if (v === ferry) mission.onLeaveFerry();
  }
  function driveInput(v) {
    const mv = input.move;
    if (v.P) { // boat
      v.throttle = mv.y; v.steer = -mv.x;
    } else {
      v.throttle = mv.y > 0.1 ? mv.y : mv.y < -0.1 ? -1 : 0;
      v.brake = mv.y < -0.1 && v.speed > 1 ? 1 : 0;
      v.steer = -mv.x; v.hand = input.down('jump') ? 1 : 0;
      if (input.pressed('horn')) { audio.horn(); peds.scare(v.x, v.z, 14, 3); }
    }
  }

  // ---------------------------------------------------------------- crimes → wanted
  let crimes = 0;
  const copsNear = (x, z, r = 60) => wanted.cars.some((c) => Math.hypot(c.x - x, c.z - z) < r) || wanted.cops.some((c) => Math.hypot(c.ch.position.x - x, c.ch.position.z - z) < r);
  peds.onHit = (p, how, sp) => {
    if (how === 'punch' || how === 'shove') {   // assault: one crime per victim; caps at one star unless police see it
      const ko = p.ch.state !== 'ok';
      if (p.assaulted && !ko) return; if (p.assaulted === 'ko') return; p.assaulted = ko ? 'ko' : true;
      if (copsNear(p.ch.position.x, p.ch.position.z)) wanted.add(1, how);
      else if (wanted.stars === 0 && (ko || Math.random() < 0.4)) wanted.setMin(1);
      return;
    }
    crimes++;
    audio.play(how === 'vehicle' ? 'impact_flesh' : 'impact_flesh', { pos: [p.ch.position.x, 1, p.ch.position.z], gain: how === 'vehicle' ? 1 : 0.6 });
    if (how === 'vehicle' && crimes === 1) hud.goLive(14);
    if (copsNear(p.ch.position.x, p.ch.position.z) || wanted.stars > 0) wanted.add(1, how);
    else if (crimes % 2 === 0 || Math.random() < 0.35) wanted.add(1, how);
  };
  traffic.honk = (c) => audio.horn();
  // melee feel: whoosh on the swing; on contact a hit-stop, a camera kick and a meaty impact
  player.findTarget = (x, z, yaw, r, ang) => peds.findTarget(x, z, yaw, r, ang);
  player.bodies = () => ({ peds: peds.list, cars: traffic.cars });
  player.onShove = (q, fx_, fz_, sp) => { peds.shoved(q, fx_, fz_, sp); };
  peds.onShoved = (q, down) => { audio.play('impact_flesh', { pos: [q.ch.position.x, 1.2, q.ch.position.z], gain: down ? 0.6 : 0.25, rate: 1.3 }); };
  player.onPunch = (what, kind, t) => {
    if (what === 'swing') { audio.play('whoosh', { gain: kind === 'hook' ? 0.42 : 0.3, rate: kind === 'jab' ? 1.25 : 1 }); return; }
    const fx_ = Math.sin(player.yaw), fz_ = Math.cos(player.yaw);
    peds.punched(t, fx_, fz_, kind);
    const ko = t.ch.state !== 'ok';
    state.hitstop = ko ? 0.13 : kind === 'hook' ? 0.1 : 0.07; G.emit('fx:shake', ko ? 0.6 : kind === 'hook' ? 0.45 : 0.25);
    if (ko) { state.slowmo = 0.45; dropCash(t.ch.position.x + fx_ * 0.6, t.ch.position.z + fz_ * 0.6); }   // knockout: slow-mo beat, wallet drop
    audio.play('impact_flesh', { pos: [t.ch.position.x, 1.5, t.ch.position.z], gain: kind === 'hook' ? 1 : 0.75, rate: kind === 'jab' ? 1.2 : 0.95 });
  };
  peds.onPlayerPunched = (p, dx, dz) => {
    if (state.mode !== 'playing') return;
    events.onPlayerHit(7); player.ch.flinch(dx, dz); G.emit('fx:shake', 0.3); state.hitstop = 0.05;
    player.combat.guardT = 2.6;
  };
  player.onSplash = () => audio.play('impact_concrete', { gain: 0.3, rate: 0.5 });
  player.onStep = (v, deck) => audio.play(deck ? 'step_metal' : 'step_concrete', { gain: 0.07 + 0.05 * Math.min(1, v / 6), rate: (deck ? 0.62 : 0.95) + Math.random() * 0.12 });
  player.onLand = (vy = 4) => audio.play('step_concrete', { gain: Math.min(0.5, 0.12 + vy * 0.04), rate: 0.75 });

  const cash = [], _lk = new Vector3(), _up35 = new Vector3(0, 0.38, 0);
  const cashGeo = new BoxGeometry(0.16, 0.02, 0.08), cashMat = new MeshStandardMaterial({ color: 0x3fae5a, emissive: new Color(0.1, 0.5, 0.15), emissiveIntensity: 0.6, roughness: 0.6 });
  function dropCash(x, z) { const m = new Mesh(cashGeo, cashMat); const y = groundAt(x, z).y; m.position.set(x, y + 0.25, z); m.scale.setScalar(1.6); G.scene.add(m); cash.push({ m, y, t: 0, v: 20 + Math.round(Math.random() * 10) * 10 }); }
  // ---------------------------------------------------------------- UI state (title / pause)
  const ui = document.getElementById('ui'), title = document.getElementById('title'), pause = document.getElementById('pause'), hudEl = document.getElementById('hud');
  const setMode = (m) => {
    state.mode = m; ui.dataset.state = m;
    title.hidden = m !== 'title'; pause.hidden = m !== 'paused'; hudEl.hidden = !(m === 'playing' || m === 'dead');
    G.paused = m === 'paused' || m === 'title';
    input.enabled = m === 'playing';
  };
  const startGame = () => {
    if (state.mode !== 'title') return;
    setMode('playing'); mission.start(); hud.letterbox(false);
    player.camPos.set(0, 0, 0);
    // opening shot: nobody in the camera-to-player sightline, a few walkers in view
    { const c = G.camera.position.clone().set(player.x - Math.sin(player.yaw) * 4.4, 0, player.z - Math.cos(player.yaw) * 4.4); peds.clearView?.(c, player); peds.topUp?.(c, player, G.quality.tier === 'low' ? 3 : 8); }
    if (matchMedia('(pointer: coarse)').matches) { try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {}); screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch (e) { /* ignore */ } }
    else { try { G.canvas.requestPointerLock?.(); } catch (e) { /* ignore */ } }
    audio.mixer.unlock?.();
  };
  ui.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'start') startGame();
    if (act === 'resume') setMode('playing');
    if (act === 'restart') { setMode('playing'); mission.done = false; respawn(); }
    if (act === 'controls') pause.querySelector('.controls').hidden = !pause.querySelector('.controls').hidden;
  });
  addEventListener('keydown', (e) => { if (e.code === 'Enter' && state.mode === 'title') startGame(); });
  G.canvas.addEventListener('click', () => { if (state.mode === 'title') startGame(); });
  setMode(state.mode);
  if (auto) { if (!shot) mission.start(); }
  else hud.letterbox(false);

  // ---------------------------------------------------------------- title flyover
  const flyCurve = new CatmullRomCurve3(PATH.map((p) => new Vector3(p[0], p[1], p[2])), true, 'centripetal');
  const flyTgt = new CatmullRomCurve3(PATH.map((p) => new Vector3(p[3], p[4], p[5])), true, 'centripetal');
  const _a = new Vector3(), _b = new Vector3();

  // ---------------------------------------------------------------- ?show=chase (pose 5): ferry mid-river with the Water Police
  if (G.params.get('show') === 'chase') {
    // run the chase for 5 s from 75 m back so the wakes are laid, ending framed by pose 5
    const h = Math.PI * 0.56, dx = Math.cos(h), dz = Math.sin(h);
    ferry.place(-150 - dx * 70, 420 - dz * 70, h);
    const pb = new Boat(G, 'policeboat', buildPoliceBoat(BM), world.sea); pb.place(-150 - dx * 92 + dz * 9, 420 - dz * 92 - dx * 9, h + 0.05);
    wanted.boats.push(pb); wanted.stars = 3;
    ferry.vx = dx * 13; ferry.vz = dz * 13; pb.vx = dx * 15; pb.vz = dz * 15;
    for (let i = 0; i < 150; i++) { ferry.throttle = 1; ferry.update(1 / 30); pb.throttle = 1; pb.steer = 0.04; pb.update(1 / 30); }
    G.game_showChase = true;
  }

  // ---------------------------------------------------------------- main loop
  const tmpFocus = new Vector3();
  G.on('update', (rawDt) => {
    if (state.mode === 'paused') { if (input.pressed('pause')) setMode('playing'); return; }
    let dt = rawDt * state.timeScale;
    if (state.hitstop > 0) { state.hitstop -= rawDt; dt *= 0.06; }   // impact freeze-frame
    else if (state.slowmo > 0) { state.slowmo -= rawDt; dt *= 0.35; }
    // GTA V health: regenerates to half after 6 s without damage
    if (state.mode === 'playing' && !player.dead) { state.sinceHit = (state.sinceHit || 0) + rawDt; if (state.sinceHit > 6 && player.health < 50) player.health = Math.min(50, player.health + 4 * rawDt); }
    state.t += dt;
    if (state.mode === 'title') {
      const u = (G.t * 0.012) % 1;
      flyCurve.getPointAt(u, _a); flyTgt.getPointAt(u, _b);
      if (!G.camLocked) { G.camera.position.copy(_a); G.camera.lookAt(_b); }
      G.focus = _a;
      traffic.update(dt); peds.update(dt, { x: _a.x, z: _a.z, vehicle: null });
      ferry.update(dt);
      return;
    }
    if (state.mode === 'playing' && input.pressed('pause')) { setMode('paused'); return; }
    // vehicles enter/exit
    if (state.mode === 'playing') {
      if (input.pressed('interact')) {
        if (player.vehicle) exitVehicle();
        else if (nearFerry()) enterVehicle(ferry);
        else { const c = nearestCar(); if (c) enterVehicle(c); }
      }
      if (player.vehicle) driveInput(player.vehicle);
    }
    // player
    if (player.vehicle) {
      const v = player.vehicle;
      if (v !== ferry && !v.P) { v.update(dt); if (v.inWater > 1.5) exitVehicle(); }
      player.x = v.x; player.z = v.z; player.y = v.y + 1;
      if (v.K && Math.abs(v.speed) > 2.5) peds.hitByVehicle(v);
    } else player.updateOnFoot(dt);
    if (!G.game_showChase) ferry.update(dt);
    if (ferry.driver !== player) { ferry.throttle *= 0.98; }
    // ferry vs piers/peds pushes are cheap: skip; traffic, people, police, mission
    traffic.update(dt);
    parkedRows?.update?.(dt, G.camera.position);
    // lock-on marker over whoever a punch would hit; cash pickups bob and pay out when walked over
    { const C = player.combat; const t = !player.vehicle && (C.target || (C.guardT > 0 ? player.lockQuery(input.move.length() > 0.2 ? player.moveYaw : player.yaw) : null));
      const hb = t && t.ch.state === 'ok' ? t.ch.bones.Bip01_Head : null; hud.lockOn(hb ? hb.getWorldPosition(_lk).add(_up35) : null, t?.hp ?? 100); }
    for (let i = cash.length - 1; i >= 0; i--) { const c = cash[i]; c.t += dt; c.m.rotation.y += dt * 3; c.m.position.y = c.y + 0.25 + Math.sin(c.t * 4) * 0.05;
      if (!player.vehicle && Math.hypot(player.x - c.m.position.x, player.z - c.m.position.z) < 1.0) { hud.addCash(c.v); audio.play('pickup', { bus: 'ui', gain: 0.5 }); G.scene.remove(c.m); cash.splice(i, 1); }
      else if (c.t > 60) { G.scene.remove(c.m); cash.splice(i, 1); } }
    if (world.landmarks?.mends) { const [mx, mz] = PLACES.mendsJetty, c = G.camera.position; world.landmarks.mends.visible = Math.hypot(c.x - mx, c.z - mz) < (G.quality.tier === 'low' ? 650 : 2600); }
    peds.update(dt, player);
    if (!G.game_showChase) wanted.update(dt);
    mission.update(dt);
    jobs.update(dt, mission.done);
    // health / death
    if (state.mode === 'playing' && player.health <= 0) fail('wasted');
    if (state.mode === 'playing' && ferry.health <= 0 && player.vehicle === ferry) mission.fail('ferry');
    if (state.mode === 'dead') {
      state.deadT = (performance.now() - state.deadStart) / 1000;
      state.timeScale = Math.max(0.25, 1 - state.deadT * 0.6);
      if (G.post) G.post.params.sat = Math.max(0.05, (state.savedSat ?? 1.2) * (1 - Math.min(1, state.deadT * 0.8)));
      if (state.deadT > 5.2) respawn();
    }
    if (state.passedT > 0) { state.passedT += rawDt; }
    // camera
    const mode = player.vehicle ? 'vehicle' : 'foot';
    if (!G.camLocked) player.updateCamera(rawDt, mode);
    if (G.camLocked) { G.camera.getWorldDirection(_b); tmpFocus.set(G.camera.position.x + _b.x * 45, 0, G.camera.position.z + _b.z * 45); }   // photo/fly cams: shadows + traffic follow the view
    else tmpFocus.set(player.vehicle ? player.vehicle.x : player.x, 0, player.vehicle ? player.vehicle.z : player.z);
    G.focus = tmpFocus; G.shadowRadius = (player.vehicle === ferry ? 170 : (G.clock?.state?.()?.el ?? 30) < 15 ? 60 : 90) * (G.quality.tier === 'low' ? 0.55 : 1);
    // prompts
    let p3 = null;
    if (!player.vehicle && state.mode === 'playing') {
      if (nearFerry()) { p3 = { x: ferry.x, y: ferry.y + 5.5, z: ferry.z }; hud.prompt3d(p3, 'F', mission.step === 'goto' ? 'Hijack the ferry' : 'Take the helm'); }
      else { const c = nearestCar(); if (c) { p3 = { x: c.x, y: c.y + 2.1, z: c.z }; hud.prompt3d(p3, 'F', c.ai ? 'Jack car' : 'Enter'); } }
    }
    if (!p3) hud.prompt3d(null);
    hud.vprompt(player.vehicle === ferry && Math.abs(ferry.speed) < 0.5 && mission.step === 'cross' ? '<kbd>W</kbd> Throttle &nbsp; <kbd>A</kbd><kbd>D</kbd> Rudder' : '');
    hud.setHull(player.vehicle === ferry ? ferry.health : null);
    hud.setBlips([...(mission.blips || []), ...(jobs.blips || []), ...wanted.cars.map((c) => ({ x: c.x, z: c.z, kind: 'police' })), ...wanted.boats.map((b) => ({ x: b.x, z: b.z, kind: 'police' }))]);
    hud.update(rawDt, { player, wanted, units: { cops: wanted.cops.length, cars: wanted.cars.length, boats: wanted.boats.length } });
    audio.update(rawDt, { wanted, player });
    const nearest = Math.min(...wanted.cars.map((c) => Math.hypot(c.x - player.x, c.z - player.z)), ...wanted.boats.map((b) => Math.hypot(b.x - player.x, b.z - player.z)), 999);
    audio.setSiren(wanted.stars > 0 && nearest < 200, nearest);
    // beacons flash
    const on = (G.t * 6 | 0) % 2;
    M.blue.emissiveIntensity = on ? 14 : 0.3; M.red.emissiveIntensity = on ? 0.3 : 14;
    BM.blue.emissiveIntensity = on ? 14 : 0.3; BM.red.emissiveIntensity = on ? 0.3 : 14;
    // brake lights
    M.tail.emissiveIntensity = player.vehicle && player.vehicle.brake > 0 ? 3 : 0.4;
  });

  // ---------------------------------------------------------------- debug / playtest hooks
  const touch = createTouchControls(G, { input, ctx: () => { const near = !player.vehicle && (nearFerry() ? 'ferry' : nearestCar()); return { mode: state.mode, inVehicle: !!player.vehicle, isFerry: player.vehicle === ferry, canEnter: !!near, hijack: near === 'ferry' || !!(near && near.ai) }; } });
  // tap anywhere on the title card to start (phones have no Enter key)
  title.addEventListener('click', (e) => { if (!e.target.closest('[data-act]')) startGame(); });
  G.game = {
    player, ferry, traffic, peds, wanted, mission, jobs, hud, state, parked: parkedRows,
    debugWin: () => { if (player.vehicle !== ferry) { if (player.vehicle) exitVehicle(); enterVehicle(ferry); } { const [bx, bz] = mendsBerth(); ferry.place(bx, bz, -1.265); } },
    debugLose: () => { player.health = 0; },
    debugBusted: () => fail('busted'),
    boardFerry: () => { player.teleport(14, -126, Math.PI / 2); enterVehicle(ferry); },
    teleport: (x, z) => player.teleport(x, z, player.yaw),
    groundY: (x, z) => groundAt(x, z, 999).y,
    start: startGame,
  };
  return { update() {} };
}
