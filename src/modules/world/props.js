// Set dressing: trees (London planes on Barrack St, eucalypts in Kings Park and the foreshores, Washingtonia palms),
// street lights, benches, bollards, moored boats, black swans, Fifteen The Esplanade hoarding, the Landing carousel.
import {
  Group, InstancedMesh, Matrix4, Quaternion, Vector3, Euler, MeshStandardMaterial, DoubleSide, CanvasTexture, SRGBColorSpace,
  Color, BufferGeometry, Float32BufferAttribute, Mesh, BoxGeometry, ConeGeometry, PlaneGeometry, ShaderMaterial, AdditiveBlending, DataTexture, RedFormat, UnsignedByteType, LinearFilter, Vector4,
} from 'three';
import { patchUniforms, patch, sharedUniform } from '../../cookbook/engine/patch.js';
import { lampReceive } from './lampmap.js';
import { scatter, treeGeo, leafTexture, foliagePatch, poissonDisk, bushGeo } from '../../cookbook/geo/scatter.js';
import { Kit, tube, lathe, roundedBox, mergeGeos, normalizeGeo } from '../../cookbook/geo/kit.js';
import { rngFrom } from '../../cookbook/geo/noise.js';
import { PLAYER } from '../../contracts.js';
const PLAYER_SPAWN = PLAYER.spawn;
import { heightAt, isLand, ROADS, PLACES, PROMENADE_Y, distPoly, ISLAND, SHORE_N, SHORE_S, nearRoad, alongShore } from '../../map.js';

// ---------------------------------------------------------------- palm
function frondTexture() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
  g.translate(s / 2, s); const rnd = rngFrom(9);
  for (let i = 0; i < 58; i++) { // pinnate leaflets fanning off a central rib
    const t = i / 58, y = -t * s * 0.95, L = s * 0.48 * Math.sin(Math.PI * (0.15 + 0.85 * t)) * (0.85 + 0.3 * rnd());
    for (const sd of [-1, 1]) {
      g.save(); g.translate(0, y); g.rotate(sd * (0.9 + 0.3 * t) + (rnd() - 0.5) * 0.15);
      const lv = 0.7 + 0.5 * rnd(), dry = rnd() < 0.12; g.fillStyle = dry ? `rgb(${(150 * lv) | 0},${(128 * lv) | 0},${(80 * lv) | 0})` : `rgb(${(72 * lv) | 0},${(90 * lv) | 0},${(54 * lv) | 0})`;
      g.beginPath(); g.moveTo(0, -1); g.quadraticCurveTo(L * 0.5, -8, L, -2); g.quadraticCurveTo(L * 0.5, 5, 0, 3); g.fill(); g.restore();
    }
  }
  g.strokeStyle = 'rgb(90,90,50)'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -s * 0.95); g.stroke();
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 4; return t;
}
function palmGeo(seed, H = 14, lo = false) {
  const rnd = rngFrom(seed);
  const lean = [(rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.2];
  const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([lean[0] * t * t, t * (H + 0.6) - 0.6, lean[1] * t * t]); }   // sunk 0.6 m: no floating base on uneven ground
  const trunk = tube(pts, (t) => 0.26 * (1 - 0.25 * t) + 0.08 * Math.max(0, 1 - t * 14) + 0.004 * Math.sin(t * 90), { radial: lo ? 6 : 16, curve: true, samples: lo ? 16 : 40 });
  const top = pts[12];
  const cards = { p: [], n: [], u: [], i: [], c: [] };
  const card = (a, droop, L, W, y0, col, lift = 1.1) => {
    const base = cards.p.length / 3, dir = [Math.cos(a), Math.sin(a)], segs = 4;
    for (let sgi = 0; sgi <= segs; sgi++) {
      const t = sgi / segs, r = t * L, y = y0 + Math.sin(t * 1.6) * lift - droop * t * t * 2.8;
      const cx = top[0] + dir[0] * r, cz = top[2] + dir[1] * r, cy = top[1] + y;
      const sx = -dir[1] * W * 0.5 * (1 - 0.6 * t), sz = dir[0] * W * 0.5 * (1 - 0.6 * t);
      cards.p.push(cx - sx, cy, cz - sz, cx + sx, cy, cz + sz); cards.n.push(0, 1, 0, 0, 1, 0); cards.u.push(0, t, 1, t);
      cards.c.push(...col, ...col);
      if (sgi > 0) { const b = base + (sgi - 1) * 2; cards.i.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
  };
  const n = lo ? 14 : 28;
  for (let k = 0; k < n; k++) card((k / n) * Math.PI * 2 + rnd() * 0.3, 0.2 + rnd() * 0.9, 4.8 + rnd() * 1.4, 2.3, 0, [1, 1, 1]);
  // dead fronds hanging against the trunk (Washingtonia petticoat remnants), straw-brown
  if (!lo) for (let k = 0; k < 14; k++) card((k / 14) * Math.PI * 2 + rnd() * 0.5, 0.7 + rnd() * 0.3, 1.5, 1.7, -0.35, [0.95, 0.62, 0.34], 0.1);   // compact skirt of dead fronds under the crown
  const fg = new BufferGeometry();
  fg.setAttribute('position', new Float32BufferAttribute(cards.p, 3)); fg.setAttribute('normal', new Float32BufferAttribute(cards.n, 3));
  fg.setAttribute('uv', new Float32BufferAttribute(cards.u, 2)); fg.setAttribute('color', new Float32BufferAttribute(cards.c, 3)); fg.setIndex(cards.i); normalizeGeo(fg);
  // trimmed "boot" under the crown, ragged
  const skirt = tube([[top[0], top[1] - 1.3, top[2]], [top[0], top[1] - 0.1, top[2]]], (t) => 0.36 + 0.20 * t + 0.06 * Math.sin(t * 37 + seed), { radial: lo ? 6 : 12 });
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
  const hiT = G.quality.tier === 'high' || G.quality.tier === 'ultra', lo = G.quality.tier === 'low';
  const NR = [], nr = (o) => { group.add(o); NR.push(o); return o; };   // groups the river mirror skips (street trees, bush, shrubs, benches, lamp pools): far from the water, costly to redraw
  const colliders = [];
  // ----- trees
  const leafTex = leafTexture({ size: 256, seed: 5, kind: 'broad' });
  const euTex = leafTexture({ size: 256, seed: 7, kind: 'needle', leaves: 200 });
  const leafMat = (tex, tint) => { const m = new MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: DoubleSide, vertexColors: true, roughness: 0.75, color: new Color(tint) }); foliagePatch(m, { trans: 0.22 }); m.name = 'leaves'; return m; };
  const barkMat = () => {
    const m = new MeshStandardMaterial({ color: 0x6f655a, roughness: 0.9, vertexColors: true }); m.name = 'bark';
    patch(m, 'bark-mottle', (sh) => {   // plane-tree camouflage patches + eucalypt streaks + darker root flare, no textures
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBarkP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBarkP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBarkP;\nfloat bkH(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }\nfloat bkN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(bkH(i), bkH(i + vec2(1, 0)), f.x), mix(bkH(i + vec2(0, 1)), bkH(i + vec2(1, 1)), f.x), f.y); }')
        .replace('#include <color_fragment>', `#include <color_fragment>
  { float a = atan(vBarkP.z, vBarkP.x); float n = bkN(vec2(a * 2.2, vBarkP.y * 2.0)) * 0.65 + bkN(vec2(a * 5.0, vBarkP.y * 5.0)) * 0.35;
    vec3 camo = n < 0.45 ? vec3(1.25, 1.2, 1.02) : n < 0.62 ? vec3(0.86, 0.85, 0.7) : vec3(1.0, 0.97, 0.92);
    float streak = 0.88 + 0.12 * sin(a * 14.0 + bkN(vec2(a, vBarkP.y * 0.6)) * 6.0);
    diffuseColor.rgb *= camo * streak * mix(0.75, 1.0, smoothstep(0.0, 0.6, vBarkP.y)); }`);
    });
    return lampReceive(m);
  };
  const plane = treeGeo({ seed: 3, height: 12, trunkR: 0.3, branches: 10, leafSize: 2.0, density: 1.6 });
  const euc = treeGeo({ seed: 8, height: 16, trunkR: 0.34, branches: 8, leafSize: 2.0, density: 1.1, lean: 0.9 });
  const euc2 = treeGeo({ seed: 12, height: 11, trunkR: 0.25, branches: 7, leafSize: 1.7, density: 1.3, lean: 0.7 });
  const lineTrees = (P, spacing, off, oneSide) => { const pts = []; for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L; for (let d = spacing / 2; d < L; d += spacing) for (const s of (oneSide ? [1] : [-1, 1])) pts.push(a[0] + tx * d + tz * off * s, a[1] + tz * d - tx * off * s); } return pts; };
  // London planes on Barrack Street + The Esplanade, Moreton Bay fig-like big trees around One The Esplanade
  const planePts = []; for (const r of ROADS) { if ((r.cls !== 'p' && r.cls !== 's') || r.oneway && r.lanes < 2 || !r.pts.some((p) => p[1] < -150 && p[1] > -900 && p[0] > -450 && p[0] < 650)) continue; planePts.push(...lineTrees(r.pts, 18, r.w / 2 + 2.2, r.oneway)); }
  { const ok = []; for (let i = 0; i < planePts.length; i += 2) if (!nearRoad(planePts[i], planePts[i + 1])) ok.push(planePts[i], planePts[i + 1]); planePts.length = 0; planePts.push(...ok); }   // never in a carriageway
  const inFoot = (x, z) => footprints.some((f) => { const P = f.pts; let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { if ((P[i][1] > z) !== (P[j][1] > z) && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; } return c; });
  const keep = (arr, pad = 0) => { const o = []; for (let i = 0; i < arr.length; i += 2) if (!inFoot(arr[i], arr[i + 1]) && !inFoot(arr[i] + pad, arr[i + 1]) && !inFoot(arr[i] - pad, arr[i + 1]) && !inFoot(arr[i], arr[i + 1] + pad) && !inFoot(arr[i], arr[i + 1] - pad)) o.push(arr[i], arr[i + 1]); return o; };
  const pm = leafMat(leafTex, 0x9aa476), pb = barkMat();
  nr((scatter(G, { parts: [{ geo: plane.trunk, material: pb }, { geo: plane.leaves, material: pm }], points: keep(planePts, 1.2), heightAt, scale: [0.85, 1.15], tint: { color: 0xffffff, l: 0.08 }, fade: [380, 520], cell: 60, seed: 4, sway: { amp: 0.06, freq: 0.9, height: 12 } }).group));
  // eucalypts: Kings Park bushland (dense), foreshores, Langley Park, South Perth park
  const eucPts = poissonDisk({ x0: -2000, z0: -950, w: 1350, h: 1700, r: 11, rng, accept: (x, z) => { const h = heightAt(x, z); return h > 7 && isLand(x, z) && Math.hypot(x - PLACES.warMemorial[0], z - PLACES.warMemorial[1]) > 70 && !nearRoad(x, z) && !inFoot(x, z); } });
  const parkPts = poissonDisk({ x0: -900, z0: 520, w: 2900, h: 1300, r: 24, rng, accept: (x, z) => isLand(x, z) && z > 520 && distPoly(x, z, SHORE_S) > 10 && distPoly(x, z, SHORE_S) < 170 && !nearRoad(x, z) && !inFoot(x, z) && !(x > -300 && x < -130 && z > 1250 && z < 1400) });
  const langPts = poissonDisk({ x0: 300, z0: -250, w: 1700, h: 900, r: 26, rng, accept: (x, z) => isLand(x, z) && distPoly(x, z, SHORE_N) < 140 && distPoly(x, z, SHORE_N) > 8 && !nearRoad(x, z) && !inFoot(x, z) });
  const foreshore = poissonDisk({ x0: -1400, z0: -350, w: 1300, h: 1000, r: 34, rng, accept: (x, z) => isLand(x, z) && heightAt(x, z) < 8 && distPoly(x, z, SHORE_N) < 120 && !nearRoad(x, z) && !inFoot(x, z) });
  const em = leafMat(euTex, 0x6a7450), eb = barkMat(); eb.color.set(0x8a7e6e);   // eucalypt olive / grey-green (photo-matched)
  group.add(scatter(G, { parts: [{ geo: euc.trunk, material: eb }, { geo: euc.leaves, material: em }], points: [...eucPts, ...parkPts.slice(0, Math.floor(parkPts.length / 4) * 2)], heightAt, scale: [0.7, 1.3], tint: { color: 0xffffff, l: 0.1, h: 0.02 }, fade: hiT ? [900, 1250] : [600, 900], cell: 80, seed: 8, sway: { amp: 0.05, freq: 0.7, height: 16 } }).group);
  const em2 = leafMat(euTex, 0x6a7650), eb2 = barkMat(); eb2.color.set(0x7a6f62);
  group.add(scatter(G, { parts: [{ geo: euc2.trunk, material: eb2 }, { geo: euc2.leaves, material: em2 }], points: [...langPts, ...foreshore, ...parkPts.slice(Math.floor(parkPts.length / 4) * 2)], heightAt, scale: [0.65, 1.6], tint: { color: 0xffffff, l: 0.2, h: 0.03 }, fade: [700, 1000], cell: 80, seed: 9, sway: { amp: 0.05, freq: 0.8, height: 11 } }).group);
  // Kings Park bushland as photographed from the city: a closed, lumpy olive canopy over the whole of Mount Eliza
  // and the escarpment, with a dark shrub understorey. Dense low-cost canopy clumps fill between the full trees.
  const kpAccept = (x, z) => heightAt(x, z) > 6 && isLand(x, z) && Math.hypot(x - PLACES.warMemorial[0], z - PLACES.warMemorial[1]) > 55 && !nearRoad(x, z) && !inFoot(x, z);
  const clumpPts = poissonDisk({ x0: -2000, z0: -950, w: 1350, h: 1700, r: G.quality.tier === 'high' || G.quality.tier === 'ultra' ? 7.5 : 9.5, rng, accept: kpAccept });
  const clump = bushGeo({ seed: 21, radius: 4.8, height: 6.2, cards: hiT ? 64 : lo ? 28 : 48, leafSize: hiT ? 2.5 : lo ? 4.0 : 3.3 });   // 15–20 m jarrah / marri / tuart crowns
  clump.translate(0, 5.6, 0);
  const stem = lathe([[0.26, 0], [0.12, 5.4], [0, 6.0]], { seg: 4, crease: 89 });   // ends inside the crown
  const cm = leafMat(euTex, 0x56604a), cb = barkMat(); cb.color.set(0x463f37);
  nr((scatter(G, { parts: [{ geo: stem, material: cb }, { geo: clump, material: cm }], points: clumpPts, heightAt, scale: [0.95, 1.8], scaleY: [0.75, 1.15], tint: { color: 0xffffff, l: 0.14, h: 0.025 }, fade: hiT ? [1100, 1500] : [800, 1150], cell: 90, seed: 19, sway: { amp: 0.03, freq: 0.6, height: 8 } }).group));
  const shrubPts = poissonDisk({ x0: -2000, z0: -950, w: 1350, h: 1700, r: 8.5, rng, accept: kpAccept });
  const shrub = bushGeo({ seed: 23, radius: 2.1, height: 2.6, cards: 36, leafSize: 1.3 });
  const sm = leafMat(euTex, 0x5f6a44);
  nr((scatter(G, { parts: [{ geo: shrub, material: sm }], points: shrubPts, heightAt, scale: [0.7, 1.4], tint: { color: 0xffffff, l: 0.12 }, fade: [300, 420], cell: 70, seed: 29 }).group));
  // South Perth: street trees and garden trees through the suburbs behind Mill Point Road, plus a band of
  // shady trees along the foreshore path of Sir James Mitchell Park
  const spAccept = (x, z) => isLand(x, z) && z > 520 && !nearRoad(x, z) && !inFoot(x, z) && distPoly(x, z, SHORE_S) > 160;
  const spTrees = poissonDisk({ x0: -1000, z0: 520, w: 3100, h: 1780, r: 19, rng, accept: spAccept });
  const cb2 = barkMat(); cb2.color.set(0x6e6458);
  group.add(scatter(G, { parts: [{ geo: stem, material: cb2 }, { geo: clump, material: leafMat(euTex, 0x66744c) }], points: spTrees, heightAt, scale: [0.8, 1.6], scaleY: [0.9, 1.5], tint: { color: 0xffffff, l: 0.14, h: 0.03 }, fade: [900, 1300], cell: 120, seed: 31 }).group);
  // Washingtonia palms: Barrack Square, Riverside Drive median, Mends Street, South Perth Esplanade
  const fm = new MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.4, side: DoubleSide, vertexColors: true, roughness: 0.7 }); foliagePatch(fm, { trans: 0.16 }); fm.color.set(0xb4bca0); fm.name = 'fronds';
  const trunkMat = (H) => {
    const tm = new MeshStandardMaterial({ color: 0x8c7c68, roughness: 0.95, vertexColors: true }); tm.name = 'palm-trunk';
    patch(tm, 'palm-rings' + H, (sh) => {   // leaf-scar rings every ~16 cm + vertical fibre (instanced: object-space height)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPalmP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPalmP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPalmP;')
        .replace('#include <color_fragment>', `#include <color_fragment>
  { float jit = sin(vPalmP.y * 1.7) * 0.5 + sin(vPalmP.y * 4.3 + 1.3) * 0.3; float rr = fract(vPalmP.y / 0.16 + 0.35 * jit); float ring = 0.92 + 0.08 * smoothstep(0.0, 0.35, rr);
    float fib = 0.975 + 0.025 * sin(atan(vPalmP.z, vPalmP.x) * 16.0 + vPalmP.y * 2.0);
    fib *= mix(0.8, 1.0, smoothstep(0.0, 1.2, vPalmP.y));
    diffuseColor.rgb *= ring * fib * mix(1.0, 0.6, smoothstep(${(H - 1.6).toFixed(1)}, ${(H - 0.6).toFixed(1)}, vPalmP.y)); }`);
    });
    return lampReceive(tm);
  };
  const PALMS = (lo ? [[5, 14]] : [[5, 14], [9, 11], [13, 17]]).map(([sd, H]) => ({ H, g: palmGeo(sd, H, lo), tm: trunkMat(H) }));
  const palmPts = [], eqPalms = [];
  for (const p of alongShore(SHORE_N, 150, 1100, 14, 14, (x, z) => !nearRoad(x, z) && !inFoot(x, z))) palmPts.push(p[0], p[1]);
  // EQ promenade: a palm every 18 m around the inlet, set back from the lamps and benches
  for (const p of alongShore(SHORE_N, -110, 150, 17, 8, (x, z) => z > -215 && z < 80 && !nearRoad(x, z) && !inFoot(x, z) && isLand(x, z) && Math.hypot(x - PLAYER_SPAWN[0], z - PLAYER_SPAWN[2]) > 9, 8.5)) eqPalms.push(p[0], p[1]);
  for (const [x, z] of [[-232, 1352], [-196, 1360], [-250, 1372], [-170, 1378], [-140, 1362], [-268, 1350]]) if (isLand(x, z)) palmPts.push(x, z);
  for (const p of alongShore(SHORE_S, -640, 600, 46, 16, (x, z) => !nearRoad(x, z) && !inFoot(x, z))) palmPts.push(p[0], p[1]);
  // the inlet palms frame the hero view: never thinned by the phone tier
  group.add(scatter(G, { parts: [{ geo: PALMS[0].g.trunk, material: PALMS[0].tm }, { geo: PALMS[0].g.fronds, material: fm }], points: eqPalms, heightAt, scale: [0.85, 1.15], fade: lo ? [160, 240] : [500, 700], cell: 400, seed: 7, tiered: false, sway: { amp: 0.12, freq: 0.8, height: PALMS[0].H, flutter: 0.4 } }).group);
  PALMS.forEach((V, vi) => {   // varied heights: every 3rd palm per variant
    const pts = []; for (let i = 0; i < palmPts.length; i += 2) if ((i / 2) % PALMS.length === vi) pts.push(palmPts[i], palmPts[i + 1]);
    group.add(scatter(G, { parts: [{ geo: V.g.trunk, material: V.tm }, { geo: V.g.fronds, material: fm }], points: pts, heightAt, scale: [0.85, 1.15], fade: [800, 1100], cell: 220, seed: 2 + vi, sway: { amp: 0.12, freq: 0.8, height: V.H, flutter: 0.4 } }).group);
  });

  // ----- street lights along roads + promenades, benches, bollards
  const lampM = [], benchM = [];
  for (const r of ROADS) {
    if (r.cls !== 't' && r.cls !== 'p') continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
      for (let d = 12; d < L; d += 46) for (const s of (r.oneway ? [1] : [-1, 1])) {
        const x = a[0] + tx * d + tz * (r.w / 2 + 0.8) * s, z = a[1] + tz * d - tx * (r.w / 2 + 0.8) * s;
        if (!isLand(x, z)) continue;
        lampM.push(M(x, heightAt(x, z), z, Math.atan2(-tz * s, tx * s) + Math.PI / 2 * 0));
      }
    }
  }
  // EQ promenade lights + benches around the inlet
  let bi = 0;
  // keep the spawn-to-EQ-Bridge sightline clear of lamp poles (they split the arches in the opening frame)
  const sightOK = (x, z) => { const ax = PLAYER_SPAWN[0], az = PLAYER_SPAWN[2], vx = -ax, vz = -10 - az, l2 = vx * vx + vz * vz, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2)); return Math.hypot(ax + vx * t - x, az + vz * t - z) > 3 || t > 0.5; };
  const ghostLamps = [];   // lamps kept out of the sightline still light the plaza (light map only, pool pulled 2 m landward)
  for (const p of alongShore(SHORE_N, -110, 330, 17, 3.5, (x, z) => z > -215 && z < 80 && !inFoot(x, z))) { if (sightOK(p[0], p[1])) lampM.push(M(p[0], PROMENADE_Y, p[1], p[2])); else ghostLamps.push(M(p[0] + p[3] * 2, PROMENADE_Y, p[1] + p[4] * 2, p[2])); if (bi++ % 2 === 0) benchM.push(M(p[0] + Math.sin(p[2] + 1.57) * 2, PROMENADE_Y, p[1] + Math.cos(p[2] + 1.57) * 2, p[2])); }
  const lampMats = { ...mats, lamp: new MeshStandardMaterial({ color: 0x222222, emissive: new Color(1.0, 0.85, 0.6), emissiveIntensity: 0.5, roughness: 0.4 }) };
  (G.nightMats ||= []).push({ mat: lampMats.lamp, day: 0.2, night: 9 });
  group.add(instanced(G, lampGeo(), lampMats, lampM, 'lamps'));
  // night: street-lamp light map — every lamp head splatted (Gaussian, sigma ~5 m) into a 1024² ground texture that the
  // ground and road shaders multiply by their own albedo (keeps the paving texture; no extra draw call)
  {
    const N = 2048, box = [-2000, -1300, 4100, 3600], data = new Uint8Array(N * N);
    const pp = new Vector3(), qq = new Quaternion(), ss = new Vector3(), sig = 3.8;
    const tx = (x) => ((x - box[0]) / box[2]) * N, tz = (z) => ((z - box[1]) / box[3]) * N, px = box[2] / N;
    const R = Math.ceil((sig * 2.6) / px);
    for (const m of [...lampM, ...ghostLamps]) {
      m.decompose(pp, qq, ss); const off = new Vector3(0.55, 0, 0).applyQuaternion(qq);
      const cx = tx(pp.x + off.x), cz = tz(pp.z + off.z), ix = Math.round(cx), iz = Math.round(cz);
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
        const X = ix + i, Z = iz + j; if (X < 0 || Z < 0 || X >= N || Z >= N) continue;
        const d2 = ((X - cx) ** 2 + (Z - cz) ** 2) * px * px, v = Math.round(255 * Math.exp(-d2 / (2 * sig * sig)));
        const k = X + Z * N; if (v > data[k]) data[k] = v;
      }
    }
    const tex = new DataTexture(data, N, N, RedFormat, UnsignedByteType); tex.magFilter = LinearFilter; tex.minFilter = LinearFilter; tex.needsUpdate = true;
    sharedUniform('uLampMap', 'sampler2D', null).value = tex;
    sharedUniform('uLampBox', 'vec4', new Vector4()).value.set(box[0], box[1], box[2], box[3]);
  }
  lampReceive(mats.timber, 1.0); lampReceive(mats.steel, 0.45);
  nr((instanced(G, benchGeo(), mats, benchM, 'benches')));
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
  return { group, colliders, noReflect: NR };
}
