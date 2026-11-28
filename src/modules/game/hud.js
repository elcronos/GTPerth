// HUD controller (DOM in template.html, styles in ui/ui.css): status bars that fade when calm, wanted stars with
// search blink + unit strip, cash card, GTA VI-style phone notifications and livestream chat, a rotating minimap
// with pink GPS route and blips, mission objective text, world-anchored button prompts, location toast, big
// MISSION PASSED / WASTED / BUSTED cards, damage edge, letterbox.
import { Vector3 } from 'three';
import { NORTH_LAND, SOUTH_LAND, ISLAND, ISLAND_POLY, HEIRISSON, ROADS, ZONES, NARROWS, FREEWAY, heightAt } from '../../map.js';
import { OSM_MASK } from '../../assets/osm_mask.js';

const $ = (s) => document.querySelector(s);
export function createHUD(G, { col, footprints }) {
  const B = {}; document.querySelectorAll('#hud [data-bind], #pause [data-bind]').forEach((n) => { B[n.dataset.bind] = n; });
  const H = { cash: 0, shownCash: 0, calmT: 0, locName: '', locT: 0 };
  // ---------------------------------------------------------------- static map image (0.5 px per metre)
  const MAP = { x0: -2000, z0: -1800, s: 0.5, size: 2100 };
  const map = document.createElement('canvas'); map.width = map.height = MAP.size;
  {
    const g = map.getContext('2d');
    const X = (x) => (x - MAP.x0) * MAP.s, Z = (z) => (z - MAP.z0) * MAP.s;
    g.fillStyle = '#2b4a62'; g.fillRect(0, 0, MAP.size, MAP.size);                 // water
    const poly = (P, c) => { g.fillStyle = c; g.beginPath(); P.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.closePath(); g.fill(); };
    poly(NORTH_LAND, '#3a3f45'); poly(SOUTH_LAND, '#3a3f45');
    poly(ISLAND_POLY, '#3a3f45'); poly(HEIRISSON, '#3a3f45');
    // parks (Kings Park, Langley Park, Sir James Mitchell Park)
    for (let x = -2000; x < -600; x += 8) for (let z = -1000; z < 900; z += 8) if (heightAt(x, z) > 20) { g.fillStyle = '#2f4a34'; g.fillRect(X(x), Z(z), 4.5, 4.5); }
    // parks from the OSM landuse mask (decoded asynchronously, painted under the roads when ready)
    const parks = new Image(); parks.onload = () => { const t = document.createElement('canvas'); t.width = t.height = 512; const tg = t.getContext('2d'); tg.drawImage(parks, 0, 0, 512, 512);
      const d = tg.getImageData(0, 0, 512, 512).data, s = OSM_MASK.size / 512; g.fillStyle = '#34503a';
      for (let j = 0; j < 512; j++) for (let i = 0; i < 512; i++) { const k = (j * 512 + i) * 4; if (d[k] > 120 || d[k + 1] > 120) { const x = OSM_MASK.x0 + i * s, z = OSM_MASK.z0 + j * s; g.fillRect(X(x), Z(z), s * MAP.s + 0.5, s * MAP.s + 0.5); } }
      drawStatic(); };
    parks.src = OSM_MASK.png;
    function drawStatic() {
    // building footprints
    g.fillStyle = '#50565e';
    for (const f of footprints) { g.beginPath(); f.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.closePath(); g.fill(); }
    // roads
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of ROADS) { g.strokeStyle = r.cls === 'm' ? '#7a7f86' : '#9a9fa6'; g.lineWidth = Math.max(2, r.w * MAP.s * 0.8); g.beginPath(); r.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.stroke(); }
    g.strokeStyle = '#a8adb3'; g.lineWidth = 16 * MAP.s; g.beginPath(); g.moveTo(X(NARROWS.a[0]), Z(NARROWS.a[1])); g.lineTo(X(NARROWS.b[0]), Z(NARROWS.b[1])); FREEWAY.forEach((p) => g.lineTo(X(p[0]), Z(p[1]))); g.stroke();
    }
    drawStatic();
  }
  const mc = B.mapcanvas, mx = mc.getContext('2d');
  const blips = [];          // {x,z,kind,flash}
  H.route = null;            // [[x,z]...]
  H.target = null;
  function drawMap(px, pz, heading, camYaw) {
    const W = mc.width, Hh = mc.height, zoom = 1.25; // screen px per map px
    mx.save();
    mx.fillStyle = '#2b4a62'; mx.fillRect(0, 0, W, Hh);
    mx.translate(W / 2, Hh * 0.62);
    mx.rotate(camYaw);                              // camera forward = up
    mx.scale(zoom, zoom);
    mx.translate(-(px - MAP.x0) * MAP.s, -(pz - MAP.z0) * MAP.s);
    mx.drawImage(map, 0, 0);
    // GPS route (pink)
    if (H.route && H.route.length) {
      mx.strokeStyle = '#ff3d8b'; mx.lineWidth = 7 / zoom; mx.lineCap = 'round'; mx.lineJoin = 'round';
      mx.beginPath(); mx.moveTo((px - MAP.x0) * MAP.s, (pz - MAP.z0) * MAP.s);
      for (const p of H.route) mx.lineTo((p[0] - MAP.x0) * MAP.s, (p[1] - MAP.z0) * MAP.s);
      mx.stroke();
    }
    mx.restore();
    // blips (screen-space so icons stay upright)
    const toScreen = (x, z) => {
      const dx = (x - px) * MAP.s * zoom, dz = (z - pz) * MAP.s * zoom; const a = camYaw;
      const sx = dx * Math.cos(a) - dz * Math.sin(a), sy = dx * Math.sin(a) + dz * Math.cos(a);
      return [W / 2 + sx, Hh * 0.62 + sy];
    };
    for (const b of blips) {
      let [sx, sy] = toScreen(b.x, b.z);
      const clamped = sx < 14 || sx > W - 14 || sy < 14 || sy > Hh - 14;
      sx = Math.max(14, Math.min(W - 14, sx)); sy = Math.max(14, Math.min(Hh - 14, sy));
      if (b.kind === 'police') { mx.fillStyle = (G.t * 4 | 0) % 2 ? '#ff2a4a' : '#3a7bff'; mx.beginPath(); mx.arc(sx, sy, 8, 0, 7); mx.fill(); }
      else if (b.kind === 'mission') { mx.fillStyle = '#ffd23f'; mx.strokeStyle = '#000'; mx.lineWidth = 3; mx.beginPath(); mx.arc(sx, sy, clamped ? 9 : 12, 0, 7); mx.fill(); mx.stroke(); }
      else if (b.kind === 'ferry') { mx.fillStyle = '#7fd8ff'; mx.fillRect(sx - 9, sy - 6, 18, 12); }
    }
    // player arrow in a black disc
    const rel = -(heading - (camYaw + Math.PI));
    mx.save(); mx.translate(W / 2, Hh * 0.62);
    mx.fillStyle = 'rgba(0,0,0,.75)'; mx.beginPath(); mx.arc(0, 0, 15, 0, 7); mx.fill();
    mx.rotate(rel); mx.fillStyle = '#fff'; mx.beginPath(); mx.moveTo(0, -11); mx.lineTo(8, 9); mx.lineTo(0, 4); mx.lineTo(-8, 9); mx.closePath(); mx.fill();
    mx.restore();
  }
  H.setBlips = (list) => { blips.length = 0; for (const b of list) blips.push(b); };

  // ---------------------------------------------------------------- notifications
  H.message = (who, text, initial) => {
    const n = document.createElement('div'); n.className = 'msg';
    n.innerHTML = `<div class="av">${initial || who[0]}</div><div><div class="who">${who}</div><div class="txt">${text}</div></div>`;
    B.phone.prepend(n);
    setTimeout(() => n.classList.add('out'), 7500); setTimeout(() => n.remove(), 8200);
    G.emit('hud:msg');
  };
  const chatPool = ['bro STOLE THE ZOO FERRY 💀💀', 'transperth about to send a strongly worded email', 'nah this is so perth', 'free ferry rides lets gooo', 'water police on the way 🚨', 'not the elephant ferry 😭', 'mends st or bust', 'this is the most WA thing ever', 'who let bro cook', 'quokka energy', 'he really said smartrider who', 'ratio + stolen ferry', 'zoo is gonna be closed by the time u get there lol', 'clip it clip it'];
  const names = ['dazza_08', 'shaz.wa', 'quokkaqueen', 'freo_kid', 'perthpete', 'mandurahmate', 'sk8rboi_6000', 'kingspark_karen', 'scarbs_surf', 'joondal_up'];
  let liveT = 0, viewers = 0;
  H.goLive = (dur = 20) => { liveT = dur; viewers = 2300 + Math.random() * 1000; B.live.hidden = false; };
  function liveTick(dt) {
    if (liveT <= 0) { B.live.hidden = true; return; }
    liveT -= dt; viewers += dt * (200 + Math.random() * 900);
    B.viewers.textContent = viewers > 1000 ? (viewers / 1000).toFixed(1) + 'K' : viewers | 0;
    if (Math.random() < dt * 2.2) {
      const p = document.createElement('p'); p.innerHTML = `<b>${names[Math.random() * names.length | 0]}</b>${chatPool[Math.random() * chatPool.length | 0]}`;
      B.chat.append(p); while (B.chat.children.length > 9) B.chat.firstChild.remove();
    }
  }
  // ---------------------------------------------------------------- simple setters
  H.objective = (html) => { B.objective.innerHTML = html || ''; };
  H.vprompt = (html) => { B.vprompt.innerHTML = html || ''; };
  const pv = new Vector3();
  H.prompt3d = (pos, key, text) => {
    if (!pos) { B.prompt3d.classList.remove('on'); return; }
    pv.set(pos.x, pos.y, pos.z).project(G.camera);
    if (pv.z > 1) { B.prompt3d.classList.remove('on'); return; }
    B.prompt3d.style.left = ((pv.x * 0.5 + 0.5) * innerWidth) + 'px'; B.prompt3d.style.top = ((-pv.y * 0.5 + 0.5) * innerHeight) + 'px';
    B.pkey.textContent = key; B.ptext.textContent = text; B.prompt3d.classList.add('on');
  };
  let bigT = 0;
  H.big = (kind, title, sub, dur = 5) => { B.big.className = 'big on ' + kind; B.bigtitle.textContent = title; B.bigsub.textContent = sub || ''; bigT = dur; };
  H.hideBig = () => { B.big.className = 'big'; bigT = 0; };
  let dmgT = 0; H.hit = () => { dmgT = 0.35; B.damage.classList.add('hit'); };
  H.letterbox = (on) => { B.letterbox.classList.toggle('on', on); $('#hud').classList.toggle('cine', on); };
  // melee lock-on marker: a chevron over the target's head with a health pip bar
  const lock = document.createElement('div'); lock.className = 'lockon'; lock.innerHTML = '<i></i><b><u></u></b>'; (B.prompt3d.parentElement || document.body).appendChild(lock);
  H.lockOn = (pos, hp) => {
    if (!pos) { lock.classList.remove('on'); return; }
    pv.set(pos.x, pos.y, pos.z).project(G.camera); if (pv.z > 1) { lock.classList.remove('on'); return; }
    lock.style.left = ((pv.x * 0.5 + 0.5) * innerWidth) + 'px'; lock.style.top = ((-pv.y * 0.5 + 0.5) * innerHeight) + 'px';
    lock.lastChild.firstChild.style.width = Math.max(0, Math.min(100, hp)) + '%'; lock.classList.add('on');
  };
  H.addCash = (n) => { H.cash += n; H.calmT = 0; B.money.classList.add('bump'); setTimeout(() => B.money.classList.remove('bump'), 400); };
  H.setHull = (v) => { if (v == null) { B.hullbar.hidden = true; return; } B.hullbar.hidden = false; B.hull.style.width = Math.max(0, v) + '%'; B.hullbar.classList.toggle('low', v < 30); };
  // ---------------------------------------------------------------- per-frame
  H.update = (dt, { player, wanted, units }) => {
    const v = player.vehicle;
    const px = v ? v.x : player.x, pz = v ? v.z : player.z;
    const heading = v ? (Math.PI / 2 - v.h) : player.yaw;
    drawMap(px, pz, heading, player.camYaw);
    // distance readout to the target
    if (H.target) { const d = Math.hypot(H.target[0] - px, H.target[1] - pz); B.dist.textContent = d > 1000 ? (d / 1000).toFixed(2) + ' km' : Math.round(d) + ' m'; } else B.dist.textContent = '';
    // bars
    B.health.style.width = Math.max(0, player.health) + '%';
    B.health.parentElement.parentElement.classList.toggle('low', player.health < 25);
    B.stamina.style.width = (player.stamina * 100) + '%';
    const calm = wanted.stars === 0 && player.health > 99 && player.stamina > 0.99 && B.hullbar.hidden;
    H.calmT = calm ? H.calmT + dt : 0;
    B.bars.classList.toggle('calm', H.calmT > 4);
    // cash counter roll
    H.shownCash += (H.cash - H.shownCash) * Math.min(1, 6 * dt); if (Math.abs(H.cash - H.shownCash) < 1) H.shownCash = H.cash;
    B.cash.textContent = '$' + Math.round(H.shownCash).toLocaleString('en-AU');
    if (B.clock && G.clock) { const l = G.clock.label(); if (B.clock.textContent !== l) B.clock.textContent = l; }
    B.money.classList.toggle('calm', H.calmT > 6 && H.cash === H.shownCash);
    // wanted
    const stars = B.wanted.querySelectorAll('.stars i');
    stars.forEach((s, i) => s.classList.toggle('on', i < wanted.stars));
    B.wanted.classList.toggle('search', wanted.stars > 0 && !wanted.seen);
    B.wanted.classList.toggle('none', wanted.stars === 0);
    B.minimap.classList.toggle('manhunt', wanted.stars > 0);
    const u = []; if (units.cops) u.push(`<span class="u-cop">OFFICER ×${units.cops}</span>`); if (units.cars) u.push(`<span class="u-car">CAR ×${units.cars}</span>`); if (units.boats) u.push(`<span class="u-boat">BOAT ×${units.boats}</span>`);
    const us = u.join(''); if (B.units.innerHTML !== us) B.units.innerHTML = us;
    // location toast when the zone changes
    const z = ZONES.find((zz) => zz.test(px, pz));
    if (z && z.name !== H.locName) { H.locName = z.name; B.loc1.textContent = z.name; B.loc2.textContent = z.sub; H.locT = 4.5; B['p-loc'] && (B['p-loc'].textContent = z.name); }
    H.locT -= dt; B.loc.classList.toggle('on', H.locT > 0);
    if (bigT > 0) { bigT -= dt; if (bigT <= 0) H.hideBig(); }
    if (dmgT > 0) { dmgT -= dt; if (dmgT <= 0) B.damage.classList.remove('hit'); }
    liveTick(dt);
    if (B['p-cash']) B['p-cash'].textContent = '$' + H.cash.toLocaleString('en-AU');
    if (B['p-wanted']) B['p-wanted'].textContent = wanted.stars ? '★'.repeat(wanted.stars) : '—';
  };
  return H;
}
