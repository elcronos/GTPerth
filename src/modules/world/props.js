// Set dressing: trees (London planes on Barrack St, eucalypts in Kings Park and the foreshores, Washingtonia palms),
// street lights, benches, bollards, moored boats, black swans, Fifteen The Esplanade hoarding, the Landing carousel.
import {
  Group, InstancedMesh, Matrix4, Quaternion, Vector3, Euler, MeshStandardMaterial, DoubleSide, CanvasTexture, SRGBColorSpace,
  Color, BufferGeometry, Float32BufferAttribute, Mesh, BoxGeometry, ConeGeometry,
} from 'three';
import { scatter, treeGeo, leafTexture, foliagePatch, poissonDisk, bushGeo } from '../../cookbook/geo/scatter.js';
import { Kit, tube, lathe, roundedBox, mergeGeos, normalizeGeo } from '../../cookbook/geo/kit.js';
import { rngFrom } from '../../cookbook/geo/noise.js';
import { heightAt, isLand, ROADS, PLACES, PROMENADE_Y, distPoly, ISLAND, SHORE_N, SHORE_S, nearRoad, alongShore } from '../../map.js';

// ---------------------------------------------------------------- palm
function frondTexture() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
  g.translate(s / 2, s); const rnd = rngFrom(9);
  for (let i = 0; i < 42; i++) { // pinnate leaflets fanning off a central rib
    const t = i / 42, y = -t * s * 0.95, L = s * 0.48 * Math.sin(Math.PI * (0.15 + 0.85 * t)) * (0.85 + 0.3 * rnd());
    for (const sd of [-1, 1]) {
      g.save(); g.translate(0, y); g.rotate(sd * (0.9 + 0.3 * t) + (rnd() - 0.5) * 0.15);
      const lv = 0.7 + 0.5 * rnd(); g.fillStyle = `rgb(${(58 * lv) | 0},${(92 * lv) | 0},${(38 * lv) | 0})`;
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(L * 0.5, -5, L, -2); g.quadraticCurveTo(L * 0.5, 3, 0, 2); g.fill(); g.restore();
    }
  }
  g.strokeStyle = 'rgb(90,90,50)'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -s * 0.95); g.stroke();
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 4; return t;
}
function palmGeo(seed, H = 14) {
  const rnd = rngFrom(seed);
  const lean = [(rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.2];
  const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([lean[0] * t * t, t * H, lean[1] * t * t]); }
  const trunk = tube(pts, (t) => 0.32 * (1 - 0.35 * t) + 0.04 * Math.sin(t * 90), { radial: 9, curve: true, samples: 40 });
  // skirt of dead fronds (Washingtonia petticoat) + crown
  const top = pts[12];
  const cards = { p: [], n: [], u: [], i: [] };
  const n = 16;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rnd() * 0.3, droop = 0.2 + rnd() * 0.9, L = 3.6 + rnd() * 1.0, W = 1.4;
    const base = cards.p.length / 3;
    const dir = [Math.cos(a), Math.sin(a)];
    const segs = 4;
    for (let sgi = 0; sgi <= segs; sgi++) {
      const t = sgi / segs, r = t * L, y = Math.sin(t * 1.2) * 0.9 - droop * t * t * 2.2;
      const cx = top[0] + dir[0] * r, cz = top[2] + dir[1] * r, cy = top[1] + y;
      const sx = -dir[1] * W * 0.5 * (1 - 0.6 * t), sz = dir[0] * W * 0.5 * (1 - 0.6 * t);
      cards.p.push(cx - sx, cy, cz - sz, cx + sx, cy, cz + sz);
      cards.n.push(0, 1, 0, 0, 1, 0);
      cards.u.push(0, t, 1, t);
      if (sgi > 0) { const b = base + (sgi - 1) * 2; cards.i.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
  }
  const fg = new BufferGeometry();
  fg.setAttribute('position', new Float32BufferAttribute(cards.p, 3)); fg.setAttribute('normal', new Float32BufferAttribute(cards.n, 3));
  fg.setAttribute('uv', new Float32BufferAttribute(cards.u, 2)); fg.setIndex(cards.i); normalizeGeo(fg);
  const skirt = tube([[top[0], top[1] - 2.6, top[2]], [top[0], top[1] - 0.2, top[2]]], (t) => 0.55 + 0.25 * t, { radial: 10 });
  return { trunk: mergeGeos([trunk, skirt]), fronds: fg };
}

// ---------------------------------------------------------------- street furniture (Kit, instanced by matrix list)
function lampGeo() { // Perth CBD-style tapered pole with a slim LED head
  const k = new Kit();
  k.cyl(0.11, 7.8, 'steel', { at: [0, 3.9, 0], seg: 8 });
  k.box(0.9, 0.12, 0.3, 'steel', { at: [0.4, 7.8, 0], r: 0.03 });
  k.box(0.6, 0.04, 0.22, 'lamp', { at: [0.55, 7.72, 0], r: 0.01 });
  return k;
}
function benchGeo() {
  const k = new Kit();
  k.box(1.9, 0.08, 0.5, 'timber', { at: [0, 0.45, 0], r: 0.01 });
  k.box(1.9, 0.4, 0.06, 'timber', { at: [0, 0.75, -0.22], r: 0.01 });
  for (const x of [-0.8, 0.8]) k.box(0.08, 0.45, 0.5, 'steel', { at: [x, 0.22, 0], r: 0.01 });
  return k;
}
function instanced(G, kit, mats, list, name) {
  const g = new Group(); g.name = name;
  for (const [key, geos] of kit.buckets) {
    const geo = mergeGeos(geos); const im = new InstancedMesh(geo, mats[key] || mats.default, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    im.castShadow = true; im.receiveShadow = true; g.add(im);
  }
  return g;
}
const _m = new Matrix4(), _q = new Quaternion(), _e = new Euler(), _v = new Vector3(), _s = new Vector3(1, 1, 1);
const M = (x, y, z, ry = 0, s = 1) => new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(0, ry, 0)), new Vector3(s, s, s));

// ---------------------------------------------------------------- boats
function boatKit(k, len, color, kind) {
  const w = len * 0.34;
  const hull = lathe([[0, 0], [w * 0.42, 0.15], [w * 0.5, 0.7], [w * 0.5, 1.0], [0, 1.0]], { seg: 16 });
  hull.scale(1, 1, len / w); k.add(hull, 'hull', { color });
  k.box(w * 0.6, 0.9, len * 0.35, 'white', { at: [0, 1.4, -len * 0.05], r: 0.15 });
  k.box(w * 0.55, 0.5, len * 0.2, 'glassDark', { at: [0, 1.75, len * 0.04], r: 0.1 });
  if (kind === 'yacht') { k.cyl(0.08, len * 1.3, 'alu', { at: [0, len * 0.65 + 1, -len * 0.1], seg: 6 }); }
}

export function create(G, { mats, roads, footprints = [] }) {
  const group = new Group(); group.name = 'props';
  const rng = rngFrom(31);
  const colliders = [];
  // ----- trees
  const leafTex = leafTexture({ size: 256, seed: 5, kind: 'broad' });
  const euTex = leafTexture({ size: 256, seed: 7, kind: 'needle', leaves: 120 });
  const leafMat = (tex, tint) => { const m = new MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: DoubleSide, vertexColors: true, roughness: 0.75, color: new Color(tint) }); foliagePatch(m, { trans: 0.35 }); m.name = 'leaves'; return m; };
  const barkMat = () => { const m = new MeshStandardMaterial({ color: 0x8a7a68, roughness: 0.9, vertexColors: true }); m.name = 'bark'; return m; };
  const plane = treeGeo({ seed: 3, height: 12, trunkR: 0.3, branches: 10, leafSize: 1.5, density: 1.1 });
  const euc = treeGeo({ seed: 8, height: 16, trunkR: 0.34, branches: 8, leafSize: 1.8, density: 0.8, lean: 0.9 });
  const euc2 = treeGeo({ seed: 12, height: 11, trunkR: 0.25, branches: 7, leafSize: 1.5, density: 0.9, lean: 0.7 });
  const lineTrees = (P, spacing, off) => { const pts = []; for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L; for (let d = spacing / 2; d < L; d += spacing) for (const s of [-1, 1]) pts.push(a[0] + tx * d + tz * off * s, a[1] + tz * d - tx * off * s); } return pts; };
  // London planes on Barrack Street + The Esplanade, Moreton Bay fig-like big trees around One The Esplanade
  const planePts = []; for (const r of ROADS) { if (r.cls === 'm' || !r.pts.some((p) => p[1] < -150 && p[1] > -1000 && p[0] > -480 && p[0] < 700)) continue; planePts.push(...lineTrees(r.pts, 17, r.w / 2 + 2.4)); }
  const inFoot = (x, z) => footprints.some((f) => { const P = f.pts; let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { if ((P[i][1] > z) !== (P[j][1] > z) && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; } return c; });
  const keep = (arr, pad = 0) => { const o = []; for (let i = 0; i < arr.length; i += 2) if (!inFoot(arr[i], arr[i + 1]) && !inFoot(arr[i] + pad, arr[i + 1]) && !inFoot(arr[i] - pad, arr[i + 1]) && !inFoot(arr[i], arr[i + 1] + pad) && !inFoot(arr[i], arr[i + 1] - pad)) o.push(arr[i], arr[i + 1]); return o; };
  const pm = leafMat(leafTex, 0xb4cc94), pb = barkMat();
  group.add(scatter(G, { parts: [{ geo: plane.trunk, material: pb }, { geo: plane.leaves, material: pm }], points: keep(planePts, 4), heightAt, scale: [0.85, 1.15], tint: { color: 0xffffff, l: 0.08 }, fade: [500, 700], cell: 60, seed: 4, sway: { amp: 0.06, freq: 0.9, height: 12 } }).group);
  // eucalypts: Kings Park bushland (dense), foreshores, Langley Park, South Perth park
  const eucPts = poissonDisk({ x0: -2000, z0: -950, w: 1350, h: 1700, r: 11, rng, accept: (x, z) => { const h = heightAt(x, z); return h > 7 && isLand(x, z) && Math.hypot(x - PLACES.warMemorial[0], z - PLACES.warMemorial[1]) > 70 && !nearRoad(x, z) && !inFoot(x, z); } });
  const parkPts = poissonDisk({ x0: -900, z0: 520, w: 2900, h: 1300, r: 24, rng, accept: (x, z) => isLand(x, z) && z > 520 && distPoly(x, z, SHORE_S) > 10 && distPoly(x, z, SHORE_S) < 170 && !nearRoad(x, z) && !inFoot(x, z) && !(x > -300 && x < -130 && z > 1250 && z < 1400) });
  const langPts = poissonDisk({ x0: 300, z0: -250, w: 1700, h: 900, r: 26, rng, accept: (x, z) => isLand(x, z) && distPoly(x, z, SHORE_N) < 140 && distPoly(x, z, SHORE_N) > 8 && !nearRoad(x, z) && !inFoot(x, z) });
  const foreshore = poissonDisk({ x0: -1400, z0: -350, w: 1300, h: 1000, r: 22, rng, accept: (x, z) => isLand(x, z) && heightAt(x, z) < 8 && distPoly(x, z, SHORE_N) < 120 && !nearRoad(x, z) && !inFoot(x, z) });
  const em = leafMat(euTex, 0x7c8a5c), eb = barkMat(); eb.color.set(0xb8aa98);   // eucalypt olive / grey-green (photo-matched)
  group.add(scatter(G, { parts: [{ geo: euc.trunk, material: eb }, { geo: euc.leaves, material: em }], points: [...eucPts, ...parkPts.slice(0, Math.floor(parkPts.length / 4) * 2)], heightAt, scale: [0.7, 1.3], tint: { color: 0xffffff, l: 0.1, h: 0.02 }, fade: [900, 1300], cell: 80, seed: 8, sway: { amp: 0.05, freq: 0.7, height: 16 } }).group);
  const em2 = leafMat(euTex, 0x8c9a6c), eb2 = barkMat(); eb2.color.set(0xa89a88);
  group.add(scatter(G, { parts: [{ geo: euc2.trunk, material: eb2 }, { geo: euc2.leaves, material: em2 }], points: [...langPts, ...foreshore, ...parkPts.slice(Math.floor(parkPts.length / 4) * 2)], heightAt, scale: [0.8, 1.2], tint: { color: 0xffffff, l: 0.1 }, fade: [700, 1000], cell: 80, seed: 9, sway: { amp: 0.05, freq: 0.8, height: 11 } }).group);
  // Kings Park bushland as photographed from the city: a closed, lumpy olive canopy over the whole of Mount Eliza
  // and the escarpment, with a dark shrub understorey. Dense low-cost canopy clumps fill between the full trees.
  const kpAccept = (x, z) => heightAt(x, z) > 6 && isLand(x, z) && Math.hypot(x - PLACES.warMemorial[0], z - PLACES.warMemorial[1]) > 55 && !nearRoad(x, z) && !inFoot(x, z);
  const clumpPts = poissonDisk({ x0: -2000, z0: -950, w: 1350, h: 1700, r: 9.5, rng, accept: kpAccept });
  const clump = bushGeo({ seed: 21, radius: 4.8, height: 6.2, cards: 48, leafSize: 3.3 });   // 15–20 m jarrah / marri / tuart crowns
  clump.translate(0, 7.5, 0);
  const stem = lathe([[0.3, 0], [0.18, 8], [0, 8.6]], { seg: 4, crease: 89 });
  const cm = leafMat(euTex, 0x6e7c50), cb = barkMat(); cb.color.set(0xb0a490);
  group.add(scatter(G, { parts: [{ geo: stem, material: cb }, { geo: clump, material: cm }], points: clumpPts, heightAt, scale: [0.75, 1.45], scaleY: [0.8, 1.3], tint: { color: 0xffffff, l: 0.14, h: 0.025 }, fade: [1100, 1600], cell: 90, seed: 19, sway: { amp: 0.03, freq: 0.6, height: 8 } }).group);
  const shrubPts = poissonDisk({ x0: -2000, z0: -950, w: 1350, h: 1700, r: 10, rng, accept: kpAccept });
  const shrub = bushGeo({ seed: 23, radius: 1.5, height: 1.6, cards: 36, leafSize: 1.1 });
  const sm = leafMat(euTex, 0x5f6a44);
  group.add(scatter(G, { parts: [{ geo: shrub, material: sm }], points: shrubPts, heightAt, scale: [0.7, 1.4], tint: { color: 0xffffff, l: 0.12 }, fade: [450, 650], cell: 70, seed: 29 }).group);
  // South Perth: street trees and garden trees through the suburbs behind Mill Point Road, plus a band of
  // shady trees along the foreshore path of Sir James Mitchell Park
  const spAccept = (x, z) => isLand(x, z) && z > 520 && !nearRoad(x, z) && !inFoot(x, z) && distPoly(x, z, SHORE_S) > 160;
  const spTrees = poissonDisk({ x0: -1000, z0: 520, w: 3100, h: 1780, r: 19, rng, accept: spAccept });
  const cb2 = barkMat(); cb2.color.set(0xb0a490);
  group.add(scatter(G, { parts: [{ geo: stem, material: cb2 }, { geo: clump, material: leafMat(euTex, 0x7a8a58) }], points: spTrees, heightAt, scale: [0.8, 1.6], scaleY: [0.9, 1.5], tint: { color: 0xffffff, l: 0.14, h: 0.03 }, fade: [1500, 2200], cell: 120, seed: 31 }).group);
  // Washingtonia palms: Barrack Square, Riverside Drive median, Mends Street, South Perth Esplanade
  const palm = palmGeo(5);
  const fm = new MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.4, side: DoubleSide, vertexColors: true, roughness: 0.7 }); foliagePatch(fm, { trans: 0.4 }); fm.name = 'fronds';
  const tm = new MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.95, vertexColors: true }); tm.name = 'palm-trunk';
  const palmPts = [];
  for (const p of alongShore(SHORE_N, 150, 1100, 30, 14, (x, z) => !nearRoad(x, z) && !inFoot(x, z))) palmPts.push(p[0], p[1]);
  for (const [x, z] of [[-232, 1352], [-196, 1360], [-250, 1372], [-170, 1378], [-140, 1362], [-268, 1350]]) if (isLand(x, z)) palmPts.push(x, z);
  for (const p of alongShore(SHORE_S, -640, 600, 46, 16, (x, z) => !nearRoad(x, z) && !inFoot(x, z))) palmPts.push(p[0], p[1]);
  group.add(scatter(G, { parts: [{ geo: palm.trunk, material: tm }, { geo: palm.fronds, material: fm }], points: palmPts, heightAt, scale: [0.85, 1.2], fade: [800, 1100], cell: 80, seed: 2, sway: { amp: 0.12, freq: 0.8, height: 14, flutter: 0.4 } }).group);

  // ----- street lights along roads + promenades, benches, bollards
  const lampM = [], benchM = [];
  for (const r of ROADS) {
    if (r.cls === 'm') continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
      for (let d = 12; d < L; d += 42) for (const s of (r.cls === 's' ? [1] : [-1, 1])) {
        const x = a[0] + tx * d + tz * (r.w / 2 + 0.8) * s, z = a[1] + tz * d - tx * (r.w / 2 + 0.8) * s;
        if (!isLand(x, z)) continue;
        lampM.push(M(x, heightAt(x, z), z, Math.atan2(-tz * s, tx * s) + Math.PI / 2 * 0));
      }
    }
  }
  // EQ promenade lights + benches around the inlet
  for (const p of alongShore(SHORE_N, -110, 330, 26, 3.5, (x, z) => z > -215 && z < 80 && !inFoot(x, z))) { lampM.push(M(p[0], PROMENADE_Y, p[1], p[2])); benchM.push(M(p[0] + Math.sin(p[2] + 1.57) * 2, PROMENADE_Y, p[1] + Math.cos(p[2] + 1.57) * 2, p[2])); }
  const lampMats = { ...mats, lamp: new MeshStandardMaterial({ color: 0x222222, emissive: new Color(1.0, 0.85, 0.6), emissiveIntensity: 0.5, roughness: 0.4 }) };
  (G.nightMats ||= []).push({ mat: lampMats.lamp, day: 0.2, night: 9 });
  group.add(instanced(G, lampGeo(), lampMats, lampM, 'lamps'));
  group.add(instanced(G, benchGeo(), mats, benchM, 'benches'));
  for (const m of lampM) { _v.setFromMatrixPosition(m); colliders.push({ circle: [_v.x, _v.z, 0.25] }); }

  // ----- The Landing furniture: limestone planter benches, bollards, a kiosk umbrella cluster
  const k0 = new Kit();
  for (const [x, z, w] of [[30, -214, 9], [82, -206, 9], [128, -186, 6], [6, -222, 6]]) { k0.box(w, 0.48, 1.6, 'limestone', { at: [x, PROMENADE_Y + 0.24, z], r: 0.06 }); k0.box(w - 0.4, 0.3, 1.2, 'soil', { at: [x, PROMENADE_Y + 0.5, z], r: 0.03 }); colliders.push({ poly: [[x - w / 2, z - 0.8], [x + w / 2, z - 0.8], [x + w / 2, z + 0.8], [x - w / 2, z + 0.8]] }); }
  for (const [x, z] of [[38, -205], [44, -205], [41, -209]]) { k0.cyl(0.05, 2.6, 'steel', { at: [x, PROMENADE_Y + 1.3, z] }); k0.add(lathe([[1.6, 0], [0.1, 0.5], [0, 0.52]], { seg: 8 }), 'canopy', { at: [x, PROMENADE_Y + 2.5, z] }); k0.cyl(0.4, 0.75, 'steel', { at: [x + 0.8, PROMENADE_Y + 0.37, z], seg: 12 }); }
  k0.bakeAO({ radius: 0.5, samples: 6, strength: 0.6, ground: PROMENADE_Y - 0.02 });
  group.add(k0.build({ ...mats, soil: new MeshStandardMaterial({ color: 0x2a3a1a, roughness: 1, vertexColors: true }) }));
  // ----- Landing carousel (west of Spanda) + BHP water park pad + Fifteen The Esplanade hoarding
  const k = new Kit();
  {
    const [sx, sz] = PLACES.spanda; const x = sx - 26, z = sz + 6, y = PROMENADE_Y;
    k.cyl(7, 0.6, 'white', { at: [x, y + 0.3, z], seg: 32 });
    k.add(lathe([[7.6, 0], [4.0, 1.6], [0.6, 2.6], [0, 2.7]], { seg: 32 }), 'canopyRed', { at: [x, y + 4.4, z] });
    k.cyl(0.6, 4.2, 'gold', { at: [x, y + 2.4, z], seg: 16 });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; k.cyl(0.05, 3.8, 'gold', { at: [x + Math.cos(a) * 5.2, y + 2.5, z + Math.sin(a) * 5.2], seg: 6 }); k.box(1.2, 0.8, 0.35, 'white', { at: [x + Math.cos(a) * 5.2, y + 1.6, z + Math.sin(a) * 5.2], r: 0.12 }); }
    colliders.push({ circle: [x, z, 7.4] });
  }
  {
    const [x, z] = PLACES.waterPark; k.box(30, 0.08, 20, 'wetPad', { at: [x, PROMENADE_Y + 0.04, z], r: 0.02 });
    for (let i = 0; i < 4; i++) { k.cyl(0.08, 4.5, 'steel', { at: [x - 12 + i * 8, PROMENADE_Y + 2.3, z - 9] }); }
    k.box(32, 0.1, 22, 'canopy', { at: [x, PROMENADE_Y + 4.6, z], r: 0.05 });
  }
  // ----- moored boats along the inlet's east shore + a few on Perth Water
  const boatCols = [0xf2f2ee, 0x1c2c44, 0xe8e2d4, 0x7a1a14, 0xf5f5f0, 0x2a4a5a];
  for (let i = 0; i < 7; i++) { const t = i / 6; k.push(134 - 30 * t - 7, -0.45, -128 + 78 * t, 0.37 + Math.PI); boatKit(k, 8 + rng() * 5, boatCols[i % 6], i % 3 === 0 ? 'yacht' : 'motor'); k.pop(); }   // along the Ritz pier
  for (const [x, z, r] of [[380, 260, 0.4], [620, 520, 1.2], [-420, 700, 2.0], [150, 900, 0.8], [-300, 280, 2.6]]) { k.push(x, -0.45, z, r); boatKit(k, 11, 0xf2f2ee, 'yacht'); k.pop(); }
  const extra = { ...mats,
    canopyRed: new MeshStandardMaterial({ color: 0x8a1a1a, roughness: 0.6, vertexColors: true }), gold: new MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.35, metalness: 0.9, vertexColors: true }),
    wetPad: new MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.08, metalness: 0.1, vertexColors: true }),
    hoarding: new MeshStandardMaterial({ color: 0x2a5a4a, roughness: 0.8, vertexColors: true }),
    hull: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, vertexColors: true }) };
  k.bakeAO({ radius: 0.5, samples: 6, strength: 0.5, ground: PROMENADE_Y - 0.02 });
  group.add(k.build(extra));
  return { group, colliders };
}
