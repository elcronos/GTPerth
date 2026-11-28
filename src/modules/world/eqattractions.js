// Elizabeth Quay attractions: the Venetian carousel at The Landing and the BHP Water Park.
// Carousel (Development WA, visitperth, buggybuddys, WA Govt 2016): hand-built in the Veneto, northern Italy; horses
// and carriages, entirely hand-painted with Venetian scenes on a blue-and-white canopy, LED-lit, up to 43 riders
// (≈ a two-row, 10 m machine), with a ticket box. OSM node attraction=carousel at (82.9, -197.8).
// Water park (BHP / Development WA): an open interactive water feature of synchronised jets and lights over the Pinjah
// mosaic (water winding through the playground, small blue circles for Hyde Park Lake and Lake Monger), which drains to
// an event space for 800; amphitheatre-style tiered timber decking with shade. No roof. OSM node leisure=water_park at
// (10.4, -206.0), opposite the Elizabeth Quay train station.
import { Group, Mesh, MeshStandardMaterial, MeshBasicMaterial, CanvasTexture, SRGBColorSpace, RepeatWrapping, BufferGeometry, Float32BufferAttribute,
  ShaderMaterial, AdditiveBlending, Color, DoubleSide, CylinderGeometry, InstancedMesh, InstancedBufferAttribute, Object3D, Vector3 } from 'three';
import { Kit, lathe, tube } from '../../cookbook/geo/kit.js';
import { PLACES, PROMENADE_Y } from '../../map.js';

const TAU = Math.PI * 2;
function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 4; return t; }

// four hand-painted style panels (sky, lagoon, arches, gondola silhouettes) in gold frames: a 4x1 atlas
function panelAtlas() {
  return canvas(1024, 256, (g, W, H) => {
    for (let i = 0; i < 4; i++) {
      const x0 = i * 256, sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, ['#7fb6e6', '#f3c38a', '#9cc9ef', '#e9a77d'][i]); sky.addColorStop(0.62, ['#d8ecf8', '#f7e3c0', '#e6f2fb', '#f6d6b8'][i]); sky.addColorStop(1, '#2f6e9c');
      g.fillStyle = sky; g.fillRect(x0, 0, 256, H);
      g.fillStyle = 'rgba(255,255,255,0.7)'; for (let c = 0; c < 3; c++) { g.beginPath(); g.ellipse(x0 + 40 + c * 80, 50 + (c % 2) * 18, 34, 10, 0, 0, TAU); g.fill(); }
      g.fillStyle = ['#8a5a3c', '#b07a4a', '#7a6a5a', '#a0603a'][i];   // waterfront palazzi / campanile silhouettes
      for (let b = 0; b < 6; b++) { const bx = x0 + 10 + b * 40, bh = 40 + ((b * 37 + i * 11) % 50); g.fillRect(bx, 165 - bh, 34, bh); g.fillStyle = 'rgba(40,30,20,0.35)'; for (let w = 0; w < 3; w++) g.fillRect(bx + 5 + w * 10, 170 - bh + 10, 5, 9); g.fillStyle = ['#8a5a3c', '#b07a4a', '#7a6a5a', '#a0603a'][i]; }
      if (i === 2) { g.fillRect(x0 + 120, 40, 18, 130); g.beginPath(); g.moveTo(x0 + 116, 40); g.lineTo(x0 + 129, 14); g.lineTo(x0 + 142, 40); g.fill(); }
      g.fillStyle = '#245a82'; g.fillRect(x0, 165, 256, H - 165);
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2; for (let r = 0; r < 5; r++) { g.beginPath(); g.moveTo(x0 + 10 + r * 50, 190 + (r % 2) * 20); g.lineTo(x0 + 40 + r * 50, 190 + (r % 2) * 20); g.stroke(); }
      g.fillStyle = '#111'; g.beginPath(); g.ellipse(x0 + 160 - i * 20, 205, 46, 6, -0.05, 0, TAU); g.fill(); g.fillRect(x0 + 200 - i * 20, 180, 3, 26);   // gondola
      g.strokeStyle = '#d8b04a'; g.lineWidth = 14; g.strokeRect(x0 + 7, 7, 242, H - 14); g.strokeStyle = '#8a6a1c'; g.lineWidth = 3; g.strokeRect(x0 + 15, 15, 226, H - 30);
    }
  });
}
// the Pinjah-inspired mosaic: deep blue tesserae, a winding pale-blue water course strewn with dots (a river of stars),
// two small bright circles for the lakes (an interpretation, not a reproduction of the artwork)
function mosaicTex() {
  return canvas(1024, 1024, (g, W, H) => {
    let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) { const v = r(); g.fillStyle = `hsl(${212 + v * 14},${55 + v * 15}%,${17 + v * 9}%)`; g.fillRect(x, y, 7, 7); }
    const path = (t) => [W * (0.08 + 0.84 * t), H * (0.5 + 0.28 * Math.sin(t * TAU * 1.25 + 0.6) + 0.08 * Math.sin(t * TAU * 3.1))];
    for (let i = 0; i < 2600; i++) { const t = r(), [px, py] = path(t), off = (r() - 0.5) * 150 * (0.6 + 0.4 * Math.sin(t * 9)); const x = px, y = py + off, d = Math.abs(off) / 75;
      g.fillStyle = d < 0.5 ? `hsl(${195 + r() * 15},70%,${62 + r() * 18}%)` : r() < 0.3 ? '#f2e6c4' : `hsl(${200 + r() * 10},60%,${48 + r() * 12}%)`; g.fillRect(Math.round(x / 8) * 8, Math.round(y / 8) * 8, 7, 7); }
    for (const [cx, cy, rr] of [[W * 0.25, H * 0.22, 70], [W * 0.74, H * 0.8, 58]]) for (let k = 0; k < 5; k++) { const R = rr - k * 13; for (let a = 0; a < TAU; a += 8 / R) { g.fillStyle = k % 2 ? '#f4e9c8' : '#4fb6ea'; g.fillRect(Math.round((cx + Math.cos(a) * R) / 8) * 8, Math.round((cy + Math.sin(a) * R) / 8) * 8, 7, 7); } }
    for (let i = 0; i < 400; i++) { g.fillStyle = r() < 0.5 ? '#f6efd8' : '#9fd7f2'; g.fillRect(Math.round(r() * W / 8) * 8, Math.round(r() * H / 8) * 8, 7, 7); }
    g.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = 7; y < H; y += 8) g.fillRect(0, y, W, 1); for (let x = 7; x < W; x += 8) g.fillRect(x, 0, 1, H);   // grout
  });
}

function horse(k, coat, mane) {
  // stylised fairground galloper, ~1.6 m nose to tail, facing +x, saddle at y 0
  const C = coat;
  k.add(lathe([[0, -0.5], [0.16, -0.46], [0.22, -0.2], [0.23, 0.15], [0.19, 0.42], [0, 0.5]], { seg: 10 }), 'horse', { rot: [0, 0, Math.PI / 2], color: C });   // barrel
  k.bar([0.38, 0.05, 0], [0.62, 0.42, 0], 0.18, 0.22, 'horse', { color: C, r: 0.07 });                     // neck
  k.bar([0.6, 0.45, 0], [0.86, 0.32, 0], 0.15, 0.2, 'horse', { color: C, r: 0.06 });                       // head
  k.bar([0.42, 0.18, 0], [0.62, 0.52, 0], 0.06, 0.24, 'horse', { color: mane, r: 0.02 });                   // mane
  for (const [hx, a0, a1] of [[0.32, -0.9, -0.3], [-0.32, 0.5, 0.9]]) for (const sz of [-0.09, 0.09]) {   // legs: front reaching, hind kicked
    const kx = hx + Math.sin(a0) * 0.28, ky = -0.12 - Math.cos(a0) * 0.28;
    k.bar([hx, -0.08, sz], [kx, ky, sz], 0.08, 0.08, 'horse', { color: C, r: 0.03 }); k.bar([kx, ky, sz], [kx + Math.sin(a1) * 0.26, ky - Math.cos(a1) * 0.26, sz], 0.065, 0.065, 'horse', { color: C, r: 0.025 });
  }
  k.bar([-0.46, 0.06, 0], [-0.72, -0.3, 0], 0.07, 0.12, 'horse', { color: mane, r: 0.03 });                 // tail
  k.box(0.42, 0.06, 0.36, 'gold', { at: [0, 0.2, 0], r: 0.02 }); k.box(0.36, 0.14, 0.4, 'carRed', { at: [0, 0.14, 0], r: 0.03 });   // saddle + cloth
}

export function createAttractions(G, { mats, colliders, lamps }) {
  const group = new Group(); group.name = 'eq-attractions';
  const atlas = panelAtlas();
  const M = { ...mats,
    gold: new MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.3, metalness: 0.95, vertexColors: true }),
    carCream: new MeshStandardMaterial({ color: 0xf3ecdc, roughness: 0.45, vertexColors: true }),
    carBlue: new MeshStandardMaterial({ color: 0x2a5a9c, roughness: 0.45, vertexColors: true }),
    carRed: new MeshStandardMaterial({ color: 0x9c1c24, roughness: 0.5, vertexColors: true }),
    horse: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, vertexColors: true }),
    bulb: new MeshStandardMaterial({ color: 0xfff1c8, emissive: new Color(1, 0.86, 0.55), emissiveIntensity: 0.6, roughness: 0.3, vertexColors: true }) };
  (G.nightMats ||= []).push({ mat: M.bulb, day: 0.6, night: 6 });

  // ------------------------------------------------------------ carousel
  const [cx, cz] = PLACES.carousel, y0 = PROMENADE_Y, R = 5.0;
  const st = new Kit();   // static: plinth, steps, ticket box
  st.cyl(R + 0.5, 0.18, 'limestone', { at: [cx, y0 + 0.09, cz], seg: 40 });
  st.cyl(R + 0.15, 0.36, 'carBlue', { at: [cx, y0 + 0.36, cz], seg: 40 });
  for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i - 1) * 0.12; st.box(1.6, 0.18, 0.5, 'limestone', { at: [cx + Math.cos(a) * (R + 0.55), y0 + 0.27, cz + Math.sin(a) * (R + 0.55)], rot: [0, -a + Math.PI / 2, 0], r: 0.02 }); }
  { const tx = cx + 7.4, tz = cz - 2.5;   // ticket box: small cream kiosk with a blue roof and a gold finial
    st.box(1.8, 2.3, 1.6, 'carCream', { at: [tx, y0 + 1.15, tz], r: 0.04 }); st.box(1.2, 0.8, 0.05, 'glass', { at: [tx, y0 + 1.5, tz - 0.81] });
    st.add(lathe([[1.3, 0], [0.2, 0.9], [0, 1.0]], { seg: 4, phi0: Math.PI / 4 }), 'carBlue', { at: [tx, y0 + 2.3, tz] }); st.cyl(0.06, 0.5, 'gold', { at: [tx, y0 + 3.5, tz] });
    colliders.push({ circle: [tx, tz, 1.2] }); }
  st.bakeAO({ radius: 0.5, samples: 6, strength: 0.5, ground: y0 - 0.02 });
  group.add(st.build(M));
  colliders.push({ circle: [cx, cz, R + 0.3] });
  // rotating part: platform deck, centre drum, horses on twisted brass poles, two carriages, canopy with rounding board
  const rot = new Kit(), Hc = 3.25;
  rot.cyl(R, 0.06, 'timberDeck', { at: [0, 0.57, 0], seg: 40 });
  rot.cyl(1.25, Hc, 'carCream', { at: [0, 0.6 + Hc / 2, 0], seg: 16 });                                     // drum
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; rot.box(0.08, Hc - 0.2, 0.08, 'gold', { at: [Math.cos(a) * 1.28, 0.6 + Hc / 2, Math.sin(a) * 1.28] }); }
  const COATS = [0xf6f2ea, 0x2a2622, 0x8a5a3a, 0xe8dcc8, 0x5a3a2a, 0xf6f2ea, 0xb08a5a, 0x3a3836];
  const hkA = new Kit(), hkB = new Kit(); let hn = 0;   // gallopers in two phase groups (one rises as the other falls)
  for (const [rr, n] of [[4.15, 14], [2.75, 10]]) for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (rr < 3 ? 0.31 : 0);
    if (rr > 4 && (i === 3 || i === 10)) {   // carriages on the outer ring
      rot.push(Math.cos(a) * rr, 0.6, Math.sin(a) * rr, -a);
      rot.box(1.1, 0.45, 1.5, 'carBlue', { at: [0, 0.32, 0], r: 0.08 }); rot.box(0.12, 0.9, 1.5, 'carCream', { at: [-0.5, 0.75, 0], r: 0.05 }); rot.box(0.9, 0.08, 1.3, 'carRed', { at: [0, 0.6, 0], r: 0.03 });
      for (const s of [-1, 1]) rot.add(lathe([[0, 0], [0.5, 0.1], [0.55, 0.6], [0, 0.65]], { seg: 10 }), 'gold', { at: [0, 0.2, s * 0.76], rot: [Math.PI / 2, 0, 0] });
      rot.pop(); continue;
    }
    const hx = Math.cos(a) * rr, hz = Math.sin(a) * rr, hk = hn++ % 2 ? hkB : hkA;
    rot.add(tube([[hx, 0.6, hz], [hx, 0.6 + Hc, hz]], 0.035, { radial: 6 }), 'gold', { occ: false });
    hk.push(hx, 0, hz, -a + Math.PI / 2); horse(hk, COATS[(i + (rr < 3 ? 3 : 0)) % COATS.length], i % 3 ? 0x1a1612 : 0xd8c8a8); hk.pop();
  }
  // canopy: rounding board of painted panels + bulbs, scalloped valance, low blue-and-white striped cone, lantern, finial
  const TOP = 0.6 + Hc;
  rot.cyl(R + 0.15, 0.12, 'carCream', { at: [0, TOP, 0], seg: 40 });
  for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; rot.box(0.12, 0.95, 0.14, 'gold', { at: [Math.cos(a) * (R + 0.2), TOP + 0.5, Math.sin(a) * (R + 0.2)] }); }
  for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU; rot.add(lathe([[0, 0], [0.35, 0], [0, -0.32]], { seg: 6 }), 'carBlue', { at: [Math.cos(a) * (R + 0.18), TOP - 0.02, Math.sin(a) * (R + 0.18)] }); }   // valance scallops
  for (let i = 0; i < 64; i++) { const a = (i / 64) * TAU; rot.cyl(0.05, 0.05, 'bulb', { at: [Math.cos(a) * (R + 0.24), TOP + 1.02, Math.sin(a) * (R + 0.24)], seg: 6 }); rot.cyl(0.045, 0.05, 'bulb', { at: [Math.cos(a) * (R + 0.24), TOP + 0.03, Math.sin(a) * (R + 0.24)], seg: 6 }); }
  const cone = []; for (let i = 0; i < 16; i++) { const a0 = (i / 16) * TAU, a1 = ((i + 1) / 16) * TAU; cone.push([a0, a1, i % 2]); }
  for (const [a0, a1, odd] of cone) {   // striped roof gores
    const P = (a, rr, yy) => [Math.cos(a) * rr, yy, Math.sin(a) * rr];
    const g = new BufferGeometry(); const v = [...P(a0, R + 0.25, TOP + 1.05), ...P(a1, R + 0.25, TOP + 1.05), ...P((a0 + a1) / 2, 0.9, TOP + 2.45)];
    g.setAttribute('position', new Float32BufferAttribute(v, 3)); g.computeVertexNormals(); g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    rot.add(g, odd ? 'carBlue' : 'carCream', { occ: false });
  }
  rot.add(lathe([[0.95, 0], [0.9, 0.55], [0.5, 0.75], [0.12, 1.25], [0, 1.3]], { seg: 16 }), 'carCream', { at: [0, TOP + 2.4, 0] });   // lantern dome
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; rot.cyl(0.05, 0.05, 'bulb', { at: [Math.cos(a) * 0.93, TOP + 2.75, Math.sin(a) * 0.93], seg: 6 }); }
  rot.cyl(0.04, 0.8, 'gold', { at: [0, TOP + 4.0, 0] }); rot.add(lathe([[0, 0], [0.12, 0.08], [0, 0.3]], { seg: 10 }), 'gold', { at: [0, TOP + 3.6, 0] });
  rot.box(0.6, 0.35, 0.02, 'carRed', { at: [0.32, TOP + 4.2, 0] });   // pennant
  const carousel = rot.build(M); carousel.position.set(cx, y0, cz); group.add(carousel);
  const bob = [hkA.build(M), hkB.build(M)]; bob[1].userData.ph = 0.5; bob[0].userData.ph = 0; for (const b of bob) carousel.add(b);
  // painted panels: 24 on the rounding board (outward), 8 on the drum
  { const pos = [], uv = [], add = (a, rr, yb, yt, w, idx, inward) => { const c = Math.cos(a), s = Math.sin(a), tx = -s, tz = c, u0 = idx * 0.25 + 0.01, u1 = u0 + 0.23;
      const p = (sx, yy) => [c * rr + tx * sx, yy, s * rr + tz * sx]; const A = p(-w / 2, yb), B = p(w / 2, yb), C = p(w / 2, yt), D = p(-w / 2, yt);
      // seen from outside, +t runs to the viewer's left: B is bottom-left, A bottom-right (CCW, image upright)
      const q = inward ? [A, B, C, A, C, D] : [B, A, D, B, D, C], quv = [[u0, 0], [u1, 0], [u1, 1], [u0, 0], [u1, 1], [u0, 1]];
      for (const v of q) pos.push(...v); for (const t of quv) uv.push(...t); };
    for (let i = 0; i < 24; i++) add(((i + 0.5) / 24) * TAU, R + 0.29, TOP + 0.12, TOP + 0.93, 1.18, i % 4, false);
    for (let i = 0; i < 8; i++) add(((i + 0.5) / 8) * TAU, 1.27, 1.2, 3.2, 0.9, (i + 1) % 4, false);
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    const pm = new MeshStandardMaterial({ map: atlas, roughness: 0.55, emissive: new Color(1, 0.92, 0.8), emissiveMap: atlas, emissiveIntensity: 0.05 });
    (G.nightMats ||= []).push({ mat: pm, day: 0.05, night: 0.45 });
    const pmesh = new Mesh(g, pm); pmesh.castShadow = false; carousel.add(pmesh); }
  carousel.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; lamps.push([cx + Math.cos(a) * 3.5, y0, cz + Math.sin(a) * 3.5]); }

  // ------------------------------------------------------------ BHP water park
  const [wx, wz] = PLACES.waterPark, [dx, dz] = PLACES.eqJettyDir, ry = Math.atan2(-dx, -dz), PW = 26, PD = 16;
  const wk = new Kit(); wk.push(wx, y0, wz, ry);
  wk.box(PW + 1.2, 0.1, PD + 1.2, 'limestone', { at: [0, -0.02, 0], r: 0.02 });                                    // granite surround
  for (let t = 0; t < 3; t++) wk.box(PW + 1.2, 0.42 * (t + 1), 1.1, 'timber', { at: [0, 0.21 * (t + 1) - 0.02, -PD / 2 - 1.15 - t * 1.1], r: 0.02 });   // tiered decking (north side)
  for (let i = -2; i <= 2; i++) {   // shade over the tiers: tensioned sails between raked masts
    const sx = i * 5.4; wk.cyl(0.09, 6.2, 'steel', { at: [sx - 2.3, 3.1, -PD / 2 - 5.6] });
    { const v = new Vector3(sx - 2.3, 0, -PD / 2 - 5.6).applyAxisAngle(new Vector3(0, 1, 0), ry); colliders.push({ circle: [wx + v.x, wz + v.z, 0.2] }); }
    const g = new BufferGeometry(), P = [[sx - 2.3, 6.1, -PD / 2 - 5.6], [sx + 2.6, 4.3, -PD / 2 - 5.2], [sx + 0.3, 4.6, -PD / 2 - 0.9], [sx - 2.3, 6.1, -PD / 2 - 5.6], [sx + 0.3, 4.6, -PD / 2 - 0.9], [sx - 2.4, 3.9, -PD / 2 - 1.6]];
    g.setAttribute('position', new Float32BufferAttribute(P.flat(), 3)); g.computeVertexNormals(); g.setAttribute('uv', new Float32BufferAttribute(new Array(12).fill(0), 2));
    wk.add(g, 'sailcloth', { occ: false });
  }
  wk.pop();
  wk.bakeAO({ radius: 0.5, samples: 6, strength: 0.5, ground: y0 - 0.02 });
  group.add(wk.build(M));
  { const corners = [[-PW / 2 - 0.6, -PD / 2 - 4.0], [PW / 2 + 0.6, -PD / 2 - 4.0], [PW / 2 + 0.6, -PD / 2 - 0.6], [-PW / 2 - 0.6, -PD / 2 - 0.6]].map(([ax, az]) => { const v = new Vector3(ax, 0, az).applyAxisAngle(new Vector3(0, 1, 0), ry); return [wx + v.x, wz + v.z]; });
    colliders.push({ poly: corners, h: 1.7 }); }   // the tiers (climbable low steps are kept solid: no stair physics yet)
  // mosaic pad: wet, glossy, the pattern under a film of water
  const mt = mosaicTex(); mt.wrapS = mt.wrapT = RepeatWrapping;
  const pad = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ map: mt, roughness: 0.42, metalness: 0.0, color: 0xffffff, envMapIntensity: 0.35 }));
  // CCW seen from above
  { const h = PW / 2, d = PD / 2; pad.geometry.setAttribute('position', new Float32BufferAttribute([-h, 0, -d, h, 0, d, h, 0, -d, -h, 0, -d, -h, 0, d, h, 0, d], 3)); pad.geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1].map((v, i) => (i % 2 ? v * (PD / PW) : v)), 2)); pad.geometry.setAttribute('normal', new Float32BufferAttribute(new Array(18).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3)); }
  pad.position.set(wx, y0 + 0.04, wz); pad.rotation.y = ry; pad.receiveShadow = true; group.add(pad);
  // jets: a grid of nozzles; columns of water whose heights follow choreographed patterns (all, waves, chase, random)
  const NX = 9, NZ = 5, jets = new InstancedMesh(new CylinderGeometry(0.035, 0.08, 1, 6, 4, true).translate(0, 0.5, 0), new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    uniforms: { uTime: { value: 0 }, uOn: { value: 1 } },
    vertexShader: `uniform float uTime; uniform float uOn; attribute float aId; varying float vY; varying float vA;
      float hh(float n){ return fract(sin(n*91.7)*43758.5); }
      void main(){ float t = uTime; float mode = floor(mod(t / 8.0, 4.0)); vec2 g = vec2(mod(aId, 9.0), floor(aId / 9.0));
        float h = mode < 0.5 ? 1.0 : mode < 1.5 ? 0.5 + 0.5 * sin(t * 3.0 - g.x * 0.8) : mode < 2.5 ? step(0.5, fract(t * 0.6 - (g.x + g.y * 9.0) / 45.0)) : step(0.45, hh(aId + floor(t * 1.5)));
        h *= (1.6 + 0.9 * hh(aId)) * uOn; vec3 p = position; p.y *= max(h, 0.001); p.xz *= 1.0 + p.y * 0.4; vY = position.y; vA = step(0.05, h);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0); }`,
    fragmentShader: `varying float vY; varying float vA; void main(){ float a = (0.55 - 0.35 * vY) * vA; gl_FragColor = vec4(vec3(0.75, 0.88, 1.0) * a, a); }` }), NX * NZ);
  { const o = new Object3D(), ids = new Float32Array(NX * NZ); let n = 0;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const v = new Vector3((i - (NX - 1) / 2) * 2.6, 0, (j - (NZ - 1) / 2) * 2.8).applyAxisAngle(new Vector3(0, 1, 0), ry); o.position.set(wx + v.x, y0 + 0.05, wz + v.z); o.updateMatrix(); jets.setMatrixAt(n, o.matrix); ids[n] = n; n++; }
    jets.geometry.setAttribute('aId', new InstancedBufferAttribute(ids, 1)); jets.frustumCulled = false; group.add(jets); }
  for (const [ax, az] of [[-8, -4], [8, -4], [-8, 4], [8, 4]]) { const v = new Vector3(ax, 0, az).applyAxisAngle(new Vector3(0, 1, 0), ry); lamps.push([wx + v.x, y0, wz + v.z]); }

  G.on('update', (dt, t) => {
    carousel.rotation.y -= dt * 0.42;   // ~6 rpm
    for (const b of bob) b.position.y = 1.5 + 0.2 * Math.sin(t * 2.6 + b.userData.ph * TAU);
    jets.material.uniforms.uTime.value = t;
  });
  return { group };
}
