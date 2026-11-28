// Elizabeth Quay and Perth Water landmarks, modelled from published dimensions:
//  Bell Tower (Swan Bells, 82.5 m: concrete bell chamber in 30 m copper sails + glass spire of spokes)
//  Spanda (29 m, six nested white carbon-fibre arches)    Elizabeth Quay Bridge (110 m S-deck, two leaning 22 m arches)
//  First Contact (5 m cast aluminium bird-in-a-boat)      Florence Hummerston Kiosk (1927, on the island)
//  Elizabeth Quay Jetty (Transperth ferry terminal)       Barrack Street Jetty (piers 1-5)
//  Mends Street Jetty (South Perth)                       The Narrows Bridge (3 parallel decks)
//  Old Mill (1835 tower mill)                             State War Memorial obelisk (Kings Park)
import { CatmullRomCurve3, Vector3, CanvasTexture, SRGBColorSpace, Mesh, PlaneGeometry, MeshBasicMaterial } from 'three';
import { Kit, lathe, tube, roundedBox, sweep, extrudeBevel } from '../../cookbook/geo/kit.js';
import { BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, Color } from 'three';
import { boxSweep, sailBlade } from './shapes.js';
import { heightAt, isLand, PLACES, ISLAND, NARROWS, PROMENADE_Y, MENDS, mendsW } from '../../map.js';

const V = (x, y, z) => new Vector3(x, y, z);

function bellTower(k) {
  // Photo-matched (Commons refs, N / S / street views): an octagonal teal glass shaft ~10 m across that holds its
  // width to ~25 m then tapers to 65 m, banded by steel balcony rings low down and a lit bell-chamber band at
  // ~31 m; a silver needle carries it to 82.5 m. Two copper "sail" groups (east + west), each three fanned
  // ogive blades with sharp tips (36 / 31 / 27 m) that lean in onto the glass; open slots face N and S.
  const [x, z] = PLACES.bellTower, y = heightAt(x, z);
  k.push(x, y, z, 0.0);
  k.cyl(17, 0.6, 'limestone', { at: [0, 0.3, 0], seg: 48 });
  k.cyl(14.5, 0.2, 'water', { at: [0, 0.68, 0], seg: 48 });
  const y0 = 0.6;
  const SH = [[5.0, 0], [5.0, 4], [4.9, 12], [4.65, 22], [4.25, 30], [3.65, 38], [2.7, 47], [1.6, 56], [0.55, 65]];
  const R = (h) => { for (let i = 1; i < SH.length; i++) if (h <= SH[i][1]) { const a = SH[i - 1], b = SH[i], t = (h - a[1]) / (b[1] - a[1]); return a[0] + (b[0] - a[0]) * t; } return 0.5; };
  k.add(lathe([[0, 0], ...SH, [0, 65]], { seg: 8, phi0: Math.PI / 8, crease: 20 }), 'teal', { at: [0, y0, 0], occ: false });
  // bell chamber: a lighter glazed band (lit at night)
  k.add(lathe([[R(29.2) + 0.06, 29.2], [R(33.6) + 0.06, 33.6]], { seg: 8, phi0: Math.PI / 8 }), 'glassLight', { at: [0, y0, 0], occ: false });
  // balcony rings low on the shaft, lighter transoms higher up
  for (let h = 3.4; h < 30; h += 3.6) { const r = R(h); k.add(lathe([[r + 0.02, h - 0.12], [r + 0.55, h - 0.08], [r + 0.55, h + 0.08], [r + 0.02, h + 0.12]], { seg: 8, phi0: Math.PI / 8, crease: 40 }), 'steel', { at: [0, y0, 0], occ: false }); }
  for (let h = 34; h < 64; h += 2.4) { const r = R(h); k.add(lathe([[r + 0.02, h], [r + 0.12, h + 0.08], [r + 0.02, h + 0.16]], { seg: 8, phi0: Math.PI / 8 }), 'steel', { at: [0, y0, 0], occ: false }); }
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i / 8) * Math.PI * 2; const pts = []; for (let h = 0; h <= 65; h += 5) { const r = R(h) + 0.04; pts.push([Math.sin(a) * r, y0 + h, Math.cos(a) * r]); } k.add(tube(pts, 0.07, { radial: 4 }), 'steel', { occ: false }); }
  // diagonal lattice on the upper glass (the photographed diamond grid)
  for (let i = 0; i < 8; i++) for (const sg of [-1, 1]) { const pts = []; for (let h = 34; h <= 64; h += 1.5) { const a = Math.PI / 8 + (i / 8) * Math.PI * 2 + sg * (h - 34) * 0.045; const r = R(h) + 0.05; pts.push([Math.sin(a) * r, y0 + h, Math.cos(a) * r]); } k.add(tube(pts, 0.035, { radial: 3 }), 'steel', { occ: false }); }
  // silver needle
  k.add(lathe([[0.62, 0], [0.42, 4], [0.3, 8], [0.18, 12.5], [0.03, 17.5]], { seg: 10 }), 'alu', { at: [0, y0 + 65, 0] });
  for (const h of [2.5, 6, 9.5]) k.cyl(0.62 - h * 0.036, 0.18, 'alu', { at: [0, y0 + 65 + h, 0], seg: 10 });
  // copper sails
  for (const az of [Math.PI / 2, -Math.PI / 2]) {
    const south = -Math.sign(az);
    for (const [Ht, dc, hw0, off] of [[36, 0, 1.0, 0], [31.5, 0.42 * south, 0.8, 0.3], [27.5, -0.42 * south, 0.8, 0.3]]) {
      // egg profile: r 7.6 at the plaza, widest (8.9) ~6 m up, ogive onto the glass at the tip
      const rr = (h) => { const u = Math.min(1, h / Ht); const ogive = Math.pow(Math.cos(u * Math.PI / 2), 0.8); return R(h) + 0.5 + 0.9 * Math.pow(Math.min(1, h / Ht), 1.5) + off + (8.4 - R(0)) * ogive * (0.86 + 0.42 * Math.sin(Math.min(1, u * 3.2) * Math.PI / 2) * (1 - u * 0.6)); };
      const hw = (h) => hw0 * Math.pow(Math.max(0, 1 - Math.pow(h / Ht, 2.2)), 0.6) + 0.012;
      k.add(sailBlade({ H: Ht, r: rr, c: () => az + dc, hw, thick: 0.22, rows: 44, cols: 20 }), 'copper', { at: [0, y0, 0] });
    }
  }
  k.pop();
}

function spanda(k) {
  // Six egg-shaped hoops (tall, legs converging at the foot) standing in a row along a north-south axis, the
  // largest (29 m) on the city side, each ~0.75× the previous, spacing tightening toward the smallest.
  const [x, z] = PLACES.spanda, y = heightAt(x, z);
  k.push(x, y, z, 0);
  const H = [29, 21.8, 16.4, 12.3, 9.2, 6.9]; const D = [0, 2.8, 5.0, 6.7, 8.0, 9.0];
  for (let i = 0; i < 6; i++) {
    // egg-shaped loop, open at the foot where both legs come together (legs a hand-span apart)
    const h = H[i], w = h * 0.74, eps = 0.13, y0 = (1 + Math.sin(-Math.PI / 2 + eps)) / 2;
    const pts = []; for (let j = 0; j <= 48; j++) { const s = -Math.PI / 2 + eps + (Math.PI * 2 - 2 * eps) * (j / 48);
      const yy = ((1 + Math.sin(s)) / 2 - y0) / (1 - y0); pts.push([(w / 2) * Math.cos(s) * (0.82 + 0.3 * yy), h * yy, D[i]]); }
    const r = 0.36 * Math.pow(h / 29, 0.55);
    k.add(tube(pts, r, { radial: 14, curve: true, samples: 96 }), 'white', { occ: false });
    k.box(Math.abs(pts[0][0]) * 2 + r * 4, 0.1, r * 4, 'steel', { at: [0, 0.05, D[i]], r: 0.03 });
  }
  k.pop();
}

// EQ Bridge: S-shaped deck (plan), crown ~6.3 m for the ferry channel; arches meet at the centre pier ("M")
export function bridgeCurve() {
  // traced from OSM: First Contact landing (west) → gentle S → the island's south-west shore
  return new CatmullRomCurve3([V(-66, 0, -26), V(-42, 0, -12), V(-24, 0, 1), V(-7, 0, 12), V(13, 0, 23), V(28, 0, 32), V(39, 0, 42)], false, 'centripetal');
}
export function bridgeDeckY(t) { return PROMENADE_Y + 0.2 + 4.1 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.75); }
function eqBridge(k) {
  const C = bridgeCurve(); const N = 90;
  const pts = C.getSpacedPoints(N);
  const side = [], left = [], right = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = pts[i], tg = C.getTangentAt(t); const nx = tg.z, nz = -tg.x; const y = bridgeDeckY(t);
    left.push([p.x + nx * 2.3, y, p.z + nz * 2.3]); right.push([p.x - nx * 2.3, y, p.z - nz * 2.3]); side.push([p.x, y, p.z]);
  }
  // deck: timber top + white steel box girder (sweep a trapezoid profile along the deck path)
  const prof = [[-2.4, 0.06], [2.4, 0.06], [1.9, -0.65], [-1.9, -0.65]];
  k.add(sweep(prof, side, { smooth: false, caps: true }), 'deckSteel');
  k.add(sweep([[-2.25, 0.12], [2.25, 0.12], [2.25, 0.05], [-2.25, 0.05]], side, { caps: true }), 'timber');
  // mesh balustrades (handrail tubes + posts)
  for (const edge of [left, right]) {
    k.add(tube(edge.map((p) => [p[0], p[1] + 1.15, p[2]]), 0.04, { radial: 8 }), 'steel', { occ: false });
    k.add(tube(edge.map((p) => [p[0], p[1] + 0.12, p[2]]), 0.03, { radial: 6 }), 'steel', { occ: false });
    k.add(tube(edge.map((p) => [p[0], p[1] - 0.05, p[2]]), 0.06, { radial: 5 }), 'ledPurple', { occ: false });   // LED strip (purple at night)
    for (let i = 0; i < edge.length; i += 2) k.bar([edge[i][0], edge[i][1] + 0.1, edge[i][2]], [edge[i][0], edge[i][1] + 1.15, edge[i][2]], 0.04, 0.04, 'steel');
  }
  // the two arches: A from the west landing to the centre pier leaning north, B from the centre pier to the island leaning south
  const P0 = C.getPointAt(0.19), Pm = C.getPointAt(0.5), P1 = C.getPointAt(0.81);
  const arch = (A, B, lean, H) => {
    // photo-matched: white rectangular box section (1.5 m wide x 1.0 m deep at the crown, deeper at the feet),
    // springing from white steel piers just above the water, leaning slightly off vertical
    const pts = [], vp = []; const ax = new Vector3().subVectors(B, A); ax.y = 0; ax.normalize();
    const n = new Vector3(ax.z, 0, -ax.x);
    for (let s = 0; s <= 48; s++) {
      const t = s / 48, h = H * Math.pow(Math.max(0, 1 - (2 * t - 1) ** 2), 0.56);
      const p = A.clone().lerp(B, t); p.y = 0.6 + h * Math.cos(lean); p.addScaledVector(n, h * Math.sin(lean));
      pts.push([p.x, p.y, p.z]); vp.push(p);
    }
    const side = n.clone().multiplyScalar(Math.cos(lean)).add(new Vector3(0, -Math.sin(lean), 0)).normalize();
    k.add(boxSweep(vp, side, (t) => 1.5 + 0.5 * Math.pow(Math.abs(t - 0.5) * 2, 3), (t) => 1.0 + 1.1 * Math.pow(Math.abs(t - 0.5) * 2, 3)), 'archWhite', { occ: false });
    for (const P of [A, B]) { // faceted white pier under each foot
      k.add(lathe([[1.6, 0], [1.25, 1.0], [0.9, 1.4], [0, 1.4]], { seg: 4, phi0: Math.PI / 4, crease: 30 }), 'white', { at: [P.x, -0.6, P.z] });
      k.cyl(1.7, 2.2, 'bridgeConc', { at: [P.x, -1.4, P.z], seg: 4 });
    }
    return { pts, A, B, n };
  };
  const a1 = arch(V(P0.x, 0, P0.z), V(Pm.x, 0, Pm.z), 0.12, 21.5);
  const a2 = arch(V(Pm.x, 0, Pm.z), V(P1.x, 0, P1.z), -0.12, 23.5);
  // cable hangers from each arch down to the nearest deck edge
  for (const a of [a1, a2]) {
    for (let s = 3; s <= 45; s += 2) {
      const ap = a.pts[s];
      let best = 0, bd = 1e9; for (let i = 0; i <= N; i++) { const e = (a === a1 ? left : right)[i]; const d = (e[0] - ap[0]) ** 2 + (e[2] - ap[2]) ** 2; if (d < bd) { bd = d; best = i; } }
      const e = (a === a1 ? left : right)[best];
      if (ap[1] > e[1] + 1.5) k.add(tube([[ap[0], ap[1], ap[2]], [e[0], e[1] + 0.2, e[2]]], 0.025, { radial: 4 }), 'steel', { occ: false });
    }
  }
  // concrete piers framing the navigation channel + centre pier
  // (deck carried by the arch-foot piers)
  return { left, right };
}

function firstContact(k) {
  const [x, z] = PLACES.firstContact, y = heightAt(x, z);
  k.push(x, y, z, 0.6);
  k.box(4.2, 0.6, 1.6, 'granite', { at: [0, 0.3, 0], r: 0.05 });
  k.add(lathe([[0, 0], [0.9, 0.1], [1.25, 0.6], [1.3, 0.9], [0, 0.9]], { seg: 20 }), 'alu', { at: [0, 0.6, 0] });
  k.add(roundedBox(3.6, 0.7, 1.2, 0.3, 3), 'alu', { at: [0, 1.0, 0] });            // boat
  k.add(tube([[0.6, 1.3, 0], [0.8, 2.6, 0.05], [0.4, 3.8, 0.1], [0.0, 4.6, 0.0], [-0.5, 4.8, 0]], (r) => 0.32 - 0.22 * r, { radial: 12, curve: true, samples: 30 }), 'alu', { occ: false }); // bird neck/head
  k.add(roundedBox(1.3, 1.4, 0.8, 0.35, 3), 'alu', { at: [0.5, 1.9, 0] });           // body
  k.add(roundedBox(0.7, 0.12, 0.2, 0.05, 2), 'alu', { at: [-0.85, 4.75, 0] });       // beak
  k.pop();
}

function kiosk(k) {
  // Florence Hummerston Kiosk (1928, rebuilt on the island): Federation Arts & Crafts — red face brick with
  // arched multi-pane timber windows, a roughcast frieze, red Marseille-tile hipped roofs with flanking wings,
  // and a central octagonal clerestory lantern with its own tiled cap. Photo-matched (Commons, Feb 2016).
  const x = ISLAND.x + 4, z = ISLAND.z - 10, y = PROMENADE_Y;
  k.push(x, y, z, 0.35);
  k.box(23, 0.3, 14, 'limestone', { at: [0, 0.15, 0], r: 0.03 });
  const block = (cx, cz, w, d, h, roofH, eave) => {
    k.box(w, h, d, 'brick', { at: [cx, 0.3 + h / 2, cz], r: 0.04 });
    k.box(w + 0.12, 0.7, d + 0.12, 'render', { at: [cx, 0.3 + h - 0.35, cz], r: 0.03 });          // roughcast frieze
    k.box(w + 0.2, 0.18, d + 0.2, 'brick', { at: [cx, 0.3 + 0.9, cz], r: 0.02 });                 // sill course
    k.add(lathe([[Math.SQRT2 * (Math.max(w, d) / 2 + eave), 0], [Math.SQRT2 * (Math.max(w, d) / 2 + eave) * 0.08, roofH], [0, roofH]], { seg: 4, phi0: Math.PI / 4, crease: 10 })
      .scale(w >= d ? 1 : (w + 2 * eave) / (d + 2 * eave), 1, w >= d ? (d + 2 * eave) / (w + 2 * eave) : 1), 'tile', { at: [cx, 0.3 + h, cz] });
    // arched windows on the long faces
    const n = Math.max(1, Math.floor(w / 2.6));
    for (let i = 0; i < n; i++) for (const s of [-1, 1]) {
      const wx = cx - w / 2 + (i + 0.5) * (w / n), wz = cz + s * (d / 2 + 0.02);
      k.box(1.3, 1.5, 0.1, 'glassDark', { at: [wx, 1.95, wz], r: 0.01 });
      k.cyl(0.65, 0.1, 'glassDark', { at: [wx, 2.7, wz], rot: [Math.PI / 2, 0, 0], seg: 16 });
      k.cyl(0.8, 0.06, 'brick', { at: [wx, 2.7, wz - s * 0.03], rot: [Math.PI / 2, 0, 0], seg: 16 });
      for (const mx of [-0.33, 0, 0.33]) k.box(0.05, 2.1, 0.12, 'woodDark', { at: [wx + mx, 2.2, wz], r: 0.005 });
      k.box(1.35, 0.06, 0.12, 'woodDark', { at: [wx, 2.35, wz], r: 0.005 });
    }
  };
  block(0, 0, 11, 9, 3.6, 2.6, 0.7);                 // main hall
  block(-8.2, 0.6, 6, 7, 3.1, 2.2, 0.6);             // west wing
  block(8.2, 0.6, 6, 7, 3.1, 2.2, 0.6);              // east wing
  // octagonal clerestory lantern on the main ridge
  const ly = 0.3 + 3.6 + 1.6;
  k.add(lathe([[0, 0], [2.6, 0], [2.6, 1.7], [0, 1.7]], { seg: 8, phi0: Math.PI / 8, crease: 20 }), 'render', { at: [0, ly, 0] });
  k.add(lathe([[2.64, 0.35], [2.64, 1.45]], { seg: 8, phi0: Math.PI / 8 }), 'glassDark', { at: [0, ly, 0], occ: false });
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i / 8) * Math.PI * 2 + Math.PI / 8; k.box(0.12, 1.2, 0.12, 'woodDark', { at: [Math.sin(a) * 2.62, ly + 0.9, Math.cos(a) * 2.62], r: 0.01 }); }
  k.add(lathe([[3.4, 0], [0.3, 1.3], [0, 1.35]], { seg: 8, phi0: Math.PI / 8, crease: 10 }), 'tile', { at: [0, ly + 1.7, 0] });
  // brick piers + verandah on the river (south) side
  for (let i = -2; i <= 2; i++) k.box(0.55, 3.2, 0.55, 'brick', { at: [i * 2.4, 1.9, 5.3], r: 0.03 });
  k.box(12.4, 0.35, 1.9, 'tile', { at: [0, 3.65, 5.0], r: 0.05, rot: [-0.22, 0, 0] });
  k.pop();
}

function eqJetty(k) {
  const [x, z] = PLACES.eqJetty, [dx, dz] = PLACES.eqJettyDir, ry = Math.atan2(-dx, -dz);
  // floating pontoon (concrete) along the west shore, gangway, the sculpted wave canopy on raked posts
  k.push(x, 0, z, ry);
  k.box(5, 1.0, 46, 'concrete', { at: [0, 0.2, 0], r: 0.08 });
  k.box(4.6, 0.06, 45.6, 'timberDeck', { at: [0, 0.73, 0], r: 0.01 });
  for (let i = -3; i <= 3; i++) { k.cyl(0.35, 3.0, 'concrete', { at: [2.8, -0.8, i * 7] }); k.cyl(0.12, 3.2, 'steel', { at: [-2.0, 2.3, i * 7] }); k.cyl(0.12, 3.2, 'steel', { at: [2.0, 2.3, i * 7] }); }
  for (let i = 0; i < 12; i++) { // cambered fins, alternately tilted, rising and falling like a wave
    const fz = -20.9 + i * 3.8, fy = 3.9 + 0.55 * Math.sin(i * 0.9), tilt = (i % 2 ? 1 : -1) * 0.16;
    const fin = []; for (let j = 0; j <= 10; j++) { const u = j / 10 - 0.5; fin.push([u * 7.4, 0.55 * (1 - 4 * u * u) + 0.25 * u]); }
    for (let j = 10; j >= 0; j--) { const u = j / 10 - 0.5; fin.push([u * 7.4, 0.55 * (1 - 4 * u * u) + 0.25 * u - 0.12 - 0.1 * (1 - 4 * u * u)]); }
    k.add(extrudeBevel(fin, { depth: 4.3, bevel: 0.04, bevelSeg: 2 }), 'canopyBlue', { at: [0.3, fy, fz], rot: [tilt, 0.06 * Math.sin(i), 0] });
  }
  k.box(5.0, 1.0, 0.1, 'sign', { at: [0, 3.2, 23.1], r: 0.02 });
  // fenders on the berth face
  for (let i = -10; i <= 10; i++) k.box(0.3, 0.8, 0.6, 'rubber', { at: [2.6, 0.5, i * 2.1] });
  k.pop();
  // gangways to the promenade (local: −x is the shore)
  k.push(x, 0, z, ry);
  for (const gz of [-14, 10]) k.bar([-9, PROMENADE_Y + 0.05, gz], [-2.2, 0.75, gz], 2.0, 0.12, 'alu');
  k.pop();
  // ticket shelter on the quay
  k.push(x - 14, PROMENADE_Y, z - 2, ry);
  k.box(3.2, 2.6, 6, 'glass', { at: [0, 1.3, 0], r: 0.03 }); k.box(3.8, 0.2, 7, 'canopy', { at: [0, 2.75, 0], r: 0.05 });
  k.pop();
}

function barrackJetty(k) {
  // the five Barrack Street jetties (No. 1–5) as mapped: base at Barrack Square, raked ~20° with the city grid
  const P = [[[121.8, 53.2], [101.6, 109.8]], [[162.3, 59.3], [140.1, 126.9]], [[197.8, 81.5], [176.5, 138.0]], [[239.3, 85.5], [217.1, 144.1]], [[273.8, 85.5], [259.6, 140.1]]];
  P.forEach(([a, b]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) + 3, ry = Math.atan2(b[0] - a[0], b[1] - a[1]);
    k.push((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2, ry);
    k.box(5.5, 0.35, len, 'timberDeck', { at: [0, 1.65, 0], r: 0.02 });
    for (let j = -Math.floor(len / 6); j <= Math.floor(len / 6); j++) for (const s of [-2.4, 2.4]) k.cyl(0.22, 4.4, 'pile', { at: [s, -0.6, j * 3] });
    k.tube([[2.7, 2.7, -len / 2], [2.7, 2.7, len / 2]], 0.035, 'steel'); k.tube([[-2.7, 2.7, -len / 2], [-2.7, 2.7, len / 2]], 0.035, 'steel');
    for (let j = -len / 2; j <= len / 2; j += 2.5) for (const s of [-2.7, 2.7]) k.bar([s, 1.8, j], [s, 2.7, j], 0.05, 0.05, 'steel');
    k.box(5, 0.2, 7, 'canopy', { at: [0, 4.6, len / 2 - 5], r: 0.04 }); for (const s of [-2, 2]) for (const t of [-2.5, 2.5]) k.cyl(0.08, 2.8, 'steel', { at: [s, 3.2, len / 2 - 5 + t] });
    k.pop();
  });
  // jetty pavilions (cafes / ticket offices) at the base, pitched roofs
  for (const [x, z, w] of [[150, 44, 14], [215, 62, 16], [262, 70, 12]]) {
    k.push(x, PROMENADE_Y, z, 0.36);
    k.box(w, 3.6, 8, 'render', { at: [0, 1.8, 0], r: 0.05 });
    k.box(w - 1, 2.4, 0.08, 'glassDark', { at: [0, 1.5, 4.03], r: 0.01 });
    k.add(lathe([[w * 0.72, 0], [0.4, 2.2], [0, 2.25]], { seg: 4, phi0: Math.PI / 4, crease: 10 }).scale(1, 1, 8 / w), 'roofMetal', { at: [0, 3.6, 0] });
    k.pop();
  }
}

// ---------------------------------------------------------------- Mends Street Jetty, South Perth
// Rebuilt from references: OSM (the jetty line and the Mister Walker building footprint on its shore end); the DBCA
// referral for the PTA upgrade (2020/2581: a piecemeal timber deck of varying surfaces, the walkway past Mister Walker
// is a pinch point, a west-side contingency berth); PTA (works finished Jan 2023: a ramp down to a floating boarding
// platform, passenger gates, better weather cover); City of South Perth Connect South (a plate-aluminium numbat shade
// canopy, 23.5 m long, 6.5 m tall, 5.6 m wide, on the foreshore piazza at the jetty foot).
// Jetty frame: s = metres out from the shore end, o = metres east of the jetty line (Kit local x = -o, z = s).
function faceGeo(faces) {
  // flat-shaded polygon list → geometry (each face: [[x,y,z]...] convex, outward CCW); uv in metres on the face plane
  const pos = [], nor = [], uv = [];
  for (const F of faces) {
    const A = new Vector3(...F[0]), n = new Vector3().subVectors(new Vector3(...F[1]), A).cross(new Vector3().subVectors(new Vector3(...F[2]), A)).normalize();
    const t = Math.abs(n.y) > 0.95 ? new Vector3(1, 0, 0) : new Vector3(-n.z, 0, n.x).normalize(), bt = new Vector3().crossVectors(n, t);
    for (let i = 1; i < F.length - 1; i++) for (const q of [F[0], F[i], F[i + 1]]) { const v = new Vector3(...q); pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); uv.push(v.dot(t), v.dot(bt)); }
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}
function hipRoof(W, D, H, eave) { // W across x, D along z (D ≥ W), eaves at y = 0, ridge along z
  const a = W / 2 + eave, b = D / 2 + eave, r = Math.max(0.01, b - a);
  const E = [[-a, 0, -b], [a, 0, -b], [a, 0, b], [-a, 0, b]], R0 = [0, H, -r], R1 = [0, H, r];
  return faceGeo([[E[1], E[2], R1, R0], [E[3], E[0], R0, R1], [E[0], E[1], R0], [E[2], E[3], R1], [E[0], E[3], E[2], E[1]]]);
}
// faceted shell through cross-sections {x, y, a (half-width z), b (half-height)}, angles th0..th1 (0 = +z side, π/2 = top)
function shellGeo(S, th0, th1, seg, inner = 0) {
  const faces = [], P = (c, th, k = 1) => [c.x, c.y + c.b * k * Math.sin(th), c.a * k * Math.cos(th)];
  for (let i = 0; i < S.length - 1; i++) for (let j = 0; j < seg; j++) {
    const t0 = th0 + ((th1 - th0) * j) / seg, t1 = th0 + ((th1 - th0) * (j + 1)) / seg, c0 = S[i], c1 = S[i + 1];
    faces.push([P(c0, t0), P(c0, t1), P(c1, t1), P(c1, t0)]);
    if (inner) { const k0 = 1 - inner / Math.min(c0.a, c0.b), k1 = 1 - inner / Math.min(c1.a, c1.b); faces.push([P(c0, t0, k0), P(c1, t0, k1), P(c1, t1, k1), P(c0, t1, k0)]); }
  }
  return faceGeo(faces);
}
function mendsJetty(k, lamps, cols) {
  const [x0, z0] = PLACES.mendsJetty, [x1, z1] = PLACES.mendsHead;
  const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
  const DT = MENDS.deck, PY = MENDS.pontoon;
  const W = (s, o) => mendsW(s, o), wet = (s, o) => !isLand(...W(s, o));
  k.push(x0, 0, z0, Math.atan2(ux, uz));
  const B = (wo, h, ds, mat, s, o, y, opt = {}) => k.box(wo, h, ds, mat, { r: 0, ...opt, at: [-o, y, s] });
  const bar = (s0, o0, y0, s1, o1, y1, w, h, mat, opt) => k.bar([-o0, y0, s0], [-o1, y1, s1], w, h, mat, opt);
  const colRect = (s0, o0, s1, o1, t = 0.12) => { const ds = s1 - s0, d_o = o1 - o0, l = Math.hypot(ds, d_o) || 1, ns = -d_o / l * t, no = ds / l * t;
    cols.push({ poly: [W(s0 - ns, o0 - no), W(s1 - ns, o1 - no), W(s1 + ns, o1 + no), W(s0 + ns, o0 + no)] }); };

  // --- deck, stringers, headstocks and timber piles (piles only where the deck is over water)
  const deck = (s0, s1, o0, o1, tone = 0xffffff) => B(o1 - o0, 0.14, s1 - s0, 'timberDeck', (s0 + s1) / 2, (o0 + o1) / 2, DT - 0.07, { color: tone });
  const subs = (s0, s1, o0, o1, bay = 3.4) => {
    const n = Math.max(2, Math.round((o1 - o0) / 2.4)), po = Array.from({ length: n + 1 }, (_, i) => o0 + 0.25 + ((o1 - o0 - 0.5) * i) / n);
    for (const o of po) B(0.2, 0.28, s1 - s0, 'pile', (s0 + s1) / 2, o, DT - 0.28, { r: 0.01 });
    for (let s = s0 + 0.6, bi = 0; s <= s1 - 0.3; s += bay, bi++) {
      if (!wet(s, (o0 + o1) / 2) && !wet(s, o0) && !wet(s, o1)) continue;
      B(o1 - o0 + 0.3, 0.3, 0.32, 'pile', s, (o0 + o1) / 2, DT - 0.57, { r: 0.015 });
      for (const o of po) if (wet(s, o)) k.cyl(0.17, DT - 0.72 + 1.8, 'pile', { at: [-o, (DT - 0.72 - 1.8) / 2, s], seg: 8 });
      if (bi % 2 === 0) bar(s, po[0], -0.5, s, po[po.length - 1], DT - 0.8, 0.09, 0.16, 'pile');
    }
  };
  // patchwork: the trunk was re-decked in sections over the years (DBCA: "piecemeal, varying surfaces")
  const TONES = [0xffffff, 0xe6ddd2, 0xf4ece2, 0xd6cabb, 0xeee4d6];
  deck(-3, 24, -4.0, -1.3, 0xe6ddd2); subs(-3, 24, -4.0, -1.3);                       // pinch walkway past Mister Walker
  deck(18.5, 35.4, -1.3, 11.3, 0xf4ece2); subs(18.5, 35.4, -1.3, 11.3);                   // terrace off the building's river end
  for (let s = 18, i = 0; s < 70; s += 7.4, i++) deck(s, Math.min(70, s + 7.4), -2.7, 2.3, TONES[i % TONES.length]);
  subs(35.4, 70, -2.7, 2.3);
  deck(70, 82, -5, 5, 0xe0d6c8); subs(70, 82, -5, 5, 3.0);                             // jetty head (ferry stop)
  // the shore platform under Mister Walker and its terrace stands on the river: timber skirt + pile line, not a quay wall
  const skirt = (s0, o0, s1, o1) => { const l = Math.hypot(s1 - s0, o1 - o0), n = Math.round(l / 1.7);
    bar(s0, o0, DT - 1.45, s1, o1, DT - 1.45, 0.08, 2.9, 'pile');
    for (let i = 0; i <= n; i++) { const t = i / n; k.cyl(0.19, DT + 1.2, 'pile', { at: [-(o0 + (o1 - o0) * t) - Math.sign(o1 - o0 || 0) * 0, (DT - 1.2) / 2 - 0.15, s0 + (s1 - s0) * t], seg: 8 }); } };
  skirt(2, 12.9, 18.6, 12.9); skirt(18.6, 12.9, 18.6, 11.4); skirt(18.6, 11.4, 35.5, 11.4); skirt(35.5, 11.4, 35.5, -1.3);
  skirt(6.5, -5.5, 10, -4.9); skirt(10, -4.9, 13, -4.1); skirt(13, -4.1, 24, -4.1);
  // edge fascias along the trunk (dark, wet-stained)
  for (const o of [-2.72, 2.32]) B(0.06, 0.32, 36, 'pile', 52, o, DT - 0.16);

  // --- heritage balustrade: white timber posts, two white rails, a dark stained handrail
  const rail = (s0, o0, s1, o1) => {
    const l = Math.hypot(s1 - s0, o1 - o0), n = Math.max(1, Math.round(l / 2.0));
    for (let i = 0; i <= n; i++) { const t = i / n; B(0.11, 1.04, 0.11, 'white', s0 + (s1 - s0) * t, o0 + (o1 - o0) * t, DT + 0.52, { r: 0.012 }); }
    for (const y of [0.34, 0.68]) bar(s0, o0, DT + y, s1, o1, DT + y, 0.05, 0.07, 'white');
    bar(s0, o0, DT + 1.07, s1, o1, DT + 1.07, 0.15, 0.06, 'woodDark', { r: 0.01 });
    colRect(s0, o0, s1, o1);
  };
  rail(2, -4.0, 24, -4.0);                       // walkway, river side
  rail(24, -4.0, 24, -2.7);
  rail(24, -2.7, 70, -2.7); rail(35.4, 2.3, 70, 2.3);
  rail(18.5, 11.3, 35.4, 11.3); rail(35.4, 11.3, 35.4, 2.3);   // terrace
  rail(70, 2.3, 70, 5); rail(70, 5, 82, 5);       // head, east side (the west side is the contingency berth)
  rail(70, -2.7, 70, -5);
  rail(82, 5, 82, 1.45); rail(82, -5, 82, -1.45);
  // contingency berth on the head's west face: fenders, bollards
  for (let s = 71; s <= 81; s += 2) B(0.3, 1.2, 0.5, 'rubber', s, -5.15, DT - 0.75, { r: 0.04 });
  for (const s of [72, 80]) k.cyl(0.16, 0.45, 'granite', { at: [5 - 0.4, DT + 0.22, s], seg: 10 });
  colRect(70, -5.2, 82, -5.2);
  // planters split the public trunk from the restaurant terrace
  for (let s = 20.5; s < 34.5; s += 3.1) { B(0.7, 0.55, 2.4, 'woodDark', s, 2.65, DT + 0.27, { r: 0.02 }); k.box(0.6, 0.55, 2.2, 'sign', { at: [-2.65, DT + 0.72, s], r: 0.22 }); }

  // --- Mister Walker (OSM footprint; single storey, white weatherboard, charcoal hipped iron roof, glazed river ends)
  { const s0 = -3, s1 = 18.5, o0 = -1.3, o1 = 12.2, cs = (s0 + s1) / 2, co = (o0 + o1) / 2, Wd = o1 - o0, Dd = s1 - s0, WH = 3.7;
    B(Wd + 0.3, 0.3, Dd + 0.3, 'concrete', cs, co, DT - 0.1);                                // floor slab edge
    B(Wd - 0.12, WH, Dd - 0.12, 'render', cs, co, DT + WH / 2);                            // core
    for (let y = DT + 0.35; y < DT + WH - 0.05; y += 0.19) {                               // lapped weatherboards
      B(0.03, 0.205, Dd, 'white', cs, o0 - 0.02, y, { rot: [0, 0, 0.08] });                 // west (walkway) face
      B(Wd, 0.205, 0.03, 'white', s0 - 0.02, co, y, { rot: [0.08, 0, 0] });                 // south (shore) face
      if (y > DT + 2.85) { B(Wd, 0.205, 0.03, 'white', s1 + 0.02, co, y, { rot: [-0.08, 0, 0] }); B(0.03, 0.205, Dd, 'white', cs, o1 + 0.02, y, { rot: [0, 0, -0.08] }); }
    }
    B(0.06, 0.32, Dd + 0.1, 'woodDark', cs, o0 - 0.04, DT + 0.16); B(Wd + 0.1, 0.32, 0.06, 'woodDark', s0 - 0.04, co, DT + 0.16);   // plinth boards
    // west face: double-hung windows with white architraves
    for (let s = s0 + 2.4; s < s1 - 1.5; s += 3.4) { B(0.06, 1.5, 1.5, 'winWarm', s, o0 - 0.06, DT + 1.75); B(0.09, 0.08, 1.75, 'white', s, o0 - 0.08, DT + 2.55); B(0.09, 0.1, 1.75, 'white', s, o0 - 0.08, DT + 0.95);
      for (const d of [-0.8, 0, 0.8]) B(0.09, 1.55, 0.07, 'white', s + d, o0 - 0.08, DT + 1.75); B(0.09, 0.05, 1.5, 'white', s, o0 - 0.08, DT + 1.78); }
    // shore face: glazed entry + servery
    B(2.6, 2.4, 0.06, 'winWarm', s0 - 0.06, 2.2, DT + 1.2); for (const d of [-1.3, 0, 1.3]) B(0.08, 2.45, 0.09, 'white', s0 - 0.08, 2.2 + d, DT + 1.22); B(2.75, 0.1, 0.09, 'white', s0 - 0.08, 2.2, DT + 2.45);
    B(3.6, 1.2, 0.06, 'winWarm', s0 - 0.06, 7.8, DT + 1.6); B(3.8, 0.08, 0.5, 'timber', s0 - 0.3, 7.8, DT + 1.0);
    // river ends (north, east): full-height glazed bi-folds under the verandah
    B(Wd - 0.4, 2.75, 0.06, 'winWarm', s1 + 0.04, co, DT + 1.4); for (let o = o0 + 0.2; o <= o1 - 0.15; o += 1.12) B(0.07, 2.78, 0.1, 'white', s1 + 0.07, o, DT + 1.4); B(Wd, 0.12, 0.12, 'white', s1 + 0.07, co, DT + 2.8);
    B(0.06, 2.75, Dd - 0.4, 'winWarm', cs, o1 + 0.04, DT + 1.4); for (let s = s0 + 0.2; s <= s1 - 0.15; s += 1.12) B(0.1, 2.78, 0.07, 'white', s, o1 + 0.07, DT + 1.4); B(0.12, 0.12, Dd, 'white', cs, o1 + 0.07, DT + 2.8);
    // roof: charcoal hipped corrugated iron, white fascia + gutters, ridge capping, two roof vents
    k.add(hipRoof(Wd, Dd, 2.6, 0.55), 'roofMetal', { at: [-co, DT + WH, cs], color: 0x5c6064 });
    B(Wd + 1.14, 0.22, 0.12, 'white', s0 - 0.6, co, DT + WH - 0.05); B(Wd + 1.14, 0.22, 0.12, 'white', s1 + 0.6, co, DT + WH - 0.05);
    B(0.12, 0.22, Dd + 1.2, 'white', cs, o0 - 0.6, DT + WH - 0.05); B(0.12, 0.22, Dd + 1.2, 'white', cs, o1 + 0.6, DT + WH - 0.05);
    B(0.22, 0.08, Dd - Wd + 0.2, 'alu', cs, co, DT + WH + 2.62);
    for (const d of [-3, 3]) k.cyl(0.32, 0.5, 'alu', { at: [-co, DT + WH + 2.55, cs + d], seg: 10 });
    // verandah on the river ends: skillion roofs on slender white posts
    B(Wd + 3.0, 0.1, 3.0, 'roofMetal', s1 + 1.5, co + 1.5, DT + WH - 0.35, { rot: [0.17, 0, 0], color: 0x6a6e72 });
    B(3.0, 0.1, Dd, 'roofMetal', cs, o1 + 1.5, DT + WH - 0.35, { rot: [0, 0, 0.17], color: 0x6a6e72 });
    for (let o = o0 + 0.2; o <= o1 + 3; o += 3.3) B(0.12, WH - 0.6, 0.12, 'white', s1 + 2.85, o, DT + (WH - 0.6) / 2, { r: 0.01 });
    for (let s = s0 + 0.5; s <= s1 + 2.9; s += 3.6) B(0.12, WH - 0.6, 0.12, 'white', s, o1 + 2.85, DT + (WH - 0.6) / 2, { r: 0.01 });
    B(Wd + 3.0, 0.16, 0.1, 'white', s1 + 2.9, co + 1.5, DT + WH - 0.62); B(0.1, 0.16, Dd + 2.9, 'white', cs + 1.45, o1 + 2.9, DT + WH - 0.62);
  }
  // terrace furniture: market umbrellas over timber tables
  for (let s = 22; s < 34; s += 3.6) for (let o = 4.4; o < 10.6; o += 2.6) {
    k.cyl(0.035, 2.4, 'steel', { at: [-o, DT + 1.2, s], seg: 6 });
    k.add(lathe([[1.35, 0], [0.9, 0.22], [0, 0.48]], { seg: 8 }), 'canopy', { at: [-o, DT + 2.15, s], occ: false });
    k.cyl(0.42, 0.05, 'timber', { at: [-o, DT + 0.74, s], seg: 12 }); k.cyl(0.05, 0.72, 'steel', { at: [-o, DT + 0.36, s], seg: 6 });
    for (const d of [-0.75, 0.75]) B(0.42, 0.45, 0.42, 'woodDark', s + d, o, DT + 0.23, { r: 0.02 });
  }

  // --- heritage lamp standards (black cast posts, lantern heads) along the trunk, on the head and the terrace
  const lamp = (s, o) => {
    k.cyl(0.15, 0.5, 'granite', { at: [-o, DT + 0.25, s], seg: 10 }); k.cyl(0.055, 3.6, 'granite', { at: [-o, DT + 2.1, s], seg: 8 });
    k.add(lathe([[0.06, 0], [0.2, 0.1], [0.2, 0.14], [0, 0.14]], { seg: 6, crease: 20 }), 'granite', { at: [-o, DT + 3.85, s] });              // collar
    k.add(lathe([[0, 0], [0.15, 0], [0.21, 0.46], [0, 0.46]], { seg: 6, crease: 20 }), 'lantern', { at: [-o, DT + 3.99, s], occ: false });      // glass
    k.add(lathe([[0.3, 0], [0.26, 0.05], [0.05, 0.28], [0.03, 0.42], [0, 0.44]], { seg: 6, crease: 20 }), 'granite', { at: [-o, DT + 4.45, s] }); // roof + finial
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; k.bar([-o + Math.sin(a) * 0.15, DT + 3.99, s + Math.cos(a) * 0.15], [-o + Math.sin(a) * 0.21, DT + 4.45, s + Math.cos(a) * 0.21], 0.025, 0.025, 'granite'); }
    const [wx, wz] = W(s, o); lamps.push([wx, DT, wz]); cols.push({ circle: [wx, wz, 0.2] });
  };
  for (let s = 22, i = 0; s < 70; s += 12, i++) lamp(s, i % 2 ? 2.05 : -2.45);
  lamp(71, 4.6); lamp(81, -4.6); lamp(-1.5, -3.75); lamp(35.0, 11.0);
  // benches facing the city along the trunk
  for (const s of [40, 52, 64]) { B(0.5, 0.08, 1.8, 'timber', s, -2.15, DT + 0.45); B(0.08, 0.45, 1.8, 'timber', s, -2.42, DT + 0.75, { rot: [0, 0, -0.18] }); for (const d of [-0.7, 0.7]) B(0.4, 0.42, 0.08, 'granite', s + d, -2.2, DT + 0.21); }

  // --- Transperth ferry stop on the head: charcoal posts, white mono-pitch roof with a green fascia, glass screens
  { const sc = 75.5, oc = 2.6, gr = 0x585d62;
    for (const s of [sc - 3.4, sc + 3.4]) for (const o of [oc - 1.7, oc + 1.7]) { B(0.14, 2.9, 0.14, 'steel', s, o, DT + 1.45, { color: gr, r: 0.01 }); const [wx, wz] = W(s, o); cols.push({ circle: [wx, wz, 0.15] }); }
    B(4.6, 0.16, 8.4, 'canopy', sc, oc, DT + 3.0, { rot: [0, 0, -0.07] }); B(4.7, 0.34, 0.08, 'sign', sc - 4.22, oc, DT + 2.98); B(4.7, 0.34, 0.08, 'sign', sc + 4.22, oc, DT + 2.98);
    B(0.06, 0.34, 8.5, 'sign', sc, oc - 2.33, DT + 3.12); B(0.06, 0.34, 8.5, 'sign', sc, oc + 2.33, DT + 2.82);
    B(0.05, 2.1, 6.6, 'glass', sc, oc + 1.72, DT + 1.2); B(3.3, 2.1, 0.05, 'glass', sc + 3.42, oc, DT + 1.2);
    B(0.5, 0.07, 5.2, 'timber', sc, oc + 1.35, DT + 0.46); for (const d of [-2, 0, 2]) B(0.42, 0.44, 0.08, 'steel', sc + d, oc + 1.35, DT + 0.22, { color: gr });
    B(0.08, 1.3, 0.9, 'sign', sc - 4.3, -3.4, DT + 1.9); B(0.08, 1.25, 0.08, 'steel', sc - 4.3, -3.4, DT + 0.62, { color: gr });   // service board
  }
  // passenger gates at the top of the ramp
  for (const o of [-1.45, 1.45]) B(0.26, 1.25, 0.26, 'alu', 82, o, DT + 0.62, { r: 0.03 });
  B(1.15, 0.95, 0.04, 'alu', 82.45, -0.85, DT + 0.6, { rot: [0, 0.9, 0] }); B(1.15, 0.95, 0.04, 'alu', 82.45, 0.85, DT + 0.6, { rot: [0, -0.9, 0] });
  // ramp (gangway) down to the floating platform, with its own roof (weather protection)
  bar(82, 0, DT - 0.06, 96, 0, PY + 0.04, 2.5, 0.14, 'alu');
  for (const o of [-1.2, 1.2]) { bar(82, o, DT + 0.15, 96, o, PY + 0.25, 0.08, 0.34, 'alu'); k.tube([[-o, DT + 1.02, 82], [-o, PY + 1.02, 96]], 0.035, 'steel'); k.tube([[-o, DT + 0.55, 82], [-o, PY + 0.55, 96]], 0.02, 'steel'); colRect(82, o * 1.06, 96, o * 1.06); }
  for (let i = 0; i <= 4; i++) { const t = i / 4, s = 82 + 14 * t, y = DT + (PY - DT) * t; for (const o of [-1.45, 1.45]) B(0.1, 2.75, 0.1, 'steel', s, o, y + 1.38, { color: 0x585d62 }); }
  bar(82, 0, DT + 2.8, 96, 0, PY + 2.8, 3.3, 0.1, 'canopy'); bar(82, 1.63, DT + 2.72, 96, 1.63, PY + 2.72, 0.06, 0.26, 'sign'); bar(82, -1.63, DT + 2.72, 96, -1.63, PY + 2.72, 0.06, 0.26, 'sign');
  // floating boarding platform: concrete pontoon on two guide piles, composite deck, berth face to the west
  B(5.2, 1.1, 20, 'concrete', 106, 0, PY - 0.55, { r: 0.08 }); B(5.0, 0.04, 19.8, 'timberDeck', 106, 0, PY + 0.0, { color: 0xb8b0a6 });
  B(0.12, 0.05, 19.8, 'white', 106, -2.4, PY + 0.03, { color: 0xffc830 });                       // yellow edge strip
  for (let s = 97; s <= 115; s += 2) B(0.26, 0.55, 0.9, 'rubber', s, -2.72, PY - 0.3, { r: 0.05 });
  for (const s of [98.5, 106, 113.5]) k.cyl(0.15, 0.42, 'granite', { at: [2.15, PY + 0.21, s], seg: 10 });
  rail(96, 2.5, 116, 2.5); rail(116, 2.5, 116, -1.5);
  for (const s of [99.5, 112.5]) { k.cyl(0.42, 7.2, 'steel', { at: [-3.45, 0.6, s], seg: 14, color: 0x9aa0a6 }); B(1.1, 0.5, 1.2, 'steel', s, 3.0, PY - 0.2, { r: 0.03 }); k.cyl(0.46, 0.16, 'steel', { at: [-3.45, 4.2, s], seg: 14 });
    const [wx, wz] = W(s, 3.45); cols.push({ circle: [wx, wz, 0.5] }); }
  // waiting canopy on the platform + life-ring
  { const sc = 100.5; for (const s of [sc - 2.6, sc + 2.6]) for (const o of [0.4, 2.2]) B(0.12, 2.7, 0.12, 'steel', s, o, PY + 1.35, { color: 0x585d62 });
    B(2.6, 0.14, 6.0, 'canopy', sc, 1.3, PY + 2.75); B(2.7, 0.3, 0.06, 'sign', sc - 3.02, 1.3, PY + 2.7); B(2.7, 0.3, 0.06, 'sign', sc + 3.02, 1.3, PY + 2.7);
    B(0.45, 0.07, 4.2, 'timber', sc, 2.05, PY + 0.46); }
  k.cyl(0.36, 0.1, 'white', { at: [-2.3, PY + 1.3, 108.5], rot: [0, 0, Math.PI / 2], seg: 14, color: 0xff6a20 });
  B(0.06, 1.6, 0.06, 'steel', 108.5, 2.42, PY + 0.8);
  lamp(115, 2.2);
  k.pop();
  // the building as a solid footprint (collision, minimap, keeps props out)
  return { name: 'Mister Walker', h: 9, pts: [W(-3, -1.3), W(18.5, -1.3), W(18.5, 12.2), W(-3, 12.2)] };
}
// Connect South numbat canopy: a faceted plate-aluminium numbat standing over the piazza, open underneath for shade
function numbatCanopy(k, cols) {
  const [x, z] = PLACES.numbat, y = heightAt(x, z);
  k.push(x, y, z, -0.306);                      // long axis along the shore, nose toward the jetty foot
  const body = [{ x: 7.0, y: 3.1, a: 1.7, b: 1.9 }, { x: 5.4, y: 3.2, a: 2.3, b: 2.6 }, { x: 3.0, y: 3.3, a: 2.7, b: 3.05 }, { x: 0.0, y: 3.3, a: 2.8, b: 3.15 },
    { x: -3.0, y: 3.25, a: 2.75, b: 3.05 }, { x: -5.4, y: 3.15, a: 2.35, b: 2.7 }, { x: -7.2, y: 3.1, a: 1.6, b: 2.0 }];
  k.add(shellGeo(body, -0.14, Math.PI + 0.14, 9, 0.12), 'numbat', { occ: false });
  const head = [{ x: 5.4, y: 3.9, a: 1.55, b: 1.6 }, { x: 6.9, y: 3.95, a: 1.5, b: 1.5 }, { x: 8.2, y: 3.6, a: 1.0, b: 0.95 }, { x: 9.3, y: 3.25, a: 0.45, b: 0.42 }, { x: 10.0, y: 3.05, a: 0.12, b: 0.12 }];
  k.add(shellGeo(head, 0, Math.PI * 2, 10), 'numbat', { occ: false });
  const tail = [{ x: -6.2, y: 4.3, a: 0.8, b: 0.9 }, { x: -7.8, y: 4.75, a: 1.35, b: 1.25 }, { x: -9.6, y: 5.05, a: 1.6, b: 1.35 }, { x: -11.2, y: 5.2, a: 1.4, b: 1.15 }, { x: -12.4, y: 5.25, a: 0.8, b: 0.7 }, { x: -13.0, y: 5.25, a: 0.15, b: 0.15 }];
  k.add(shellGeo(tail, 0, Math.PI * 2, 10), 'numbat', { occ: false });
  // white back stripes across the rump (the numbat's banding), ears, eyes, dark eye-stripe
  const at = (xx) => { for (let i = 0; i < body.length - 1; i++) { const p = body[i], q = body[i + 1]; if (xx <= p.x && xx >= q.x) { const t = (p.x - xx) / (p.x - q.x); return { x: xx, y: p.y + (q.y - p.y) * t, a: p.a + (q.a - p.a) * t, b: p.b + (q.b - p.b) * t }; } } return body[body.length - 1]; };
  for (const sx of [-1.2, -2.4, -3.6, -4.8, -6.0]) { const c0 = at(sx + 0.25), c1 = at(sx - 0.25); for (const c of [c0, c1]) { c.a += 0.04; c.b += 0.04; } k.add(shellGeo([c0, c1], 0.45, Math.PI - 0.45, 6), 'white', { occ: false }); }
  for (const sz of [-1, 1]) {
    k.add(extrudeBevel([[-0.55, 0], [0.5, 0], [0.1, 1.25]], { depth: 0.1, bevel: 0.03 }), 'numbat', { at: [6.0, 5.2, sz * 0.95], rot: [0, sz * 0.35, sz * -0.3] });
    k.cyl(0.32, 0.06, 'white', { at: [7.7, 4.15, sz * 1.1], rot: [Math.PI / 2, 0, 0], seg: 12, color: 0xd8cfc0 });      // pale eye ring
    k.cyl(0.18, 0.1, 'granite', { at: [7.7, 4.15, sz * 1.15], rot: [Math.PI / 2, 0, 0], seg: 10 });
    k.add(shellGeo([{ x: 9.4, y: 3.5, a: 0.05, b: 0.05 }, { x: 6.6, y: 4.2, a: 0.1, b: 0.1 }], 0, Math.PI * 2, 5), 'granite', { at: [0, 0, sz * 0.95], occ: false });
  }
  // four plate legs, splayed, on granite pads (the canopy's supports)
  for (const lx of [4.2, -4.6]) for (const sz of [-1, 1]) { const c = at(lx), ey = c.y - c.b * Math.sin(0.14), ez = c.a * Math.cos(0.14) - 0.15;
    k.bar([lx, ey + 0.4, sz * ez], [lx + (lx > 0 ? 0.5 : -0.5), 0.08, sz * (ez + 0.55)], 0.85, 0.22, 'numbat');
    k.box(1.3, 0.16, 1.0, 'granite', { at: [lx + (lx > 0 ? 0.5 : -0.5), 0.08, sz * (ez + 0.55)], r: 0.03 });
    const lp = new Vector3(lx + (lx > 0 ? 0.5 : -0.5), 0, sz * (ez + 0.55)).applyAxisAngle(new Vector3(0, 1, 0), -0.306); cols.push({ circle: [x + lp.x, z + lp.z, 0.5] });
  }
  // benches in its shade
  for (const bz of [-1.2, 1.2]) { k.box(4.2, 0.1, 0.5, 'timber', { at: [-0.5, 0.46, bz] }); for (const d of [-1.6, 1.6]) k.box(0.08, 0.42, 0.42, 'granite', { at: [-0.5 + d, 0.21, bz] }); }
  k.pop();
}

function narrows(k) {
  const [ax, az] = NARROWS.a, [bx, bz] = NARROWS.b; const L = Math.hypot(bx - ax, bz - az);
  const ang = Math.atan2(bx - ax, bz - az);
  k.push(ax, 0, az, ang);
  // three parallel decks: west road, rail, east road. Deck soffit arcs from 3.5 m at the abutments to 9 m mid-span.
  const yAt = (t) => 3.6 + 5.6 * Math.sin(Math.PI * t);
  for (const [off, w, key] of [[-11, 15, 'bridgeConc'], [0, 6, 'bridgeConc'], [11, 15, 'bridgeConc']]) {
    const path = []; for (let i = 0; i <= 40; i++) { const t = i / 40; path.push([off, yAt(t), t * L]); }
    k.add(sweep([[-w / 2, 0.9], [w / 2, 0.9], [w / 2 - 0.4, -1.4], [-w / 2 + 0.4, -1.4]], path, { caps: true }), key);
    if (key && off !== 0) { // parapets + light poles
      for (const s of [-1, 1]) k.add(tube(path.map((p) => [p[0] + s * (w / 2 - 0.2), p[1] + 1.8, p[2]]), 0.06, { radial: 6 }), 'steel', { occ: false });
      for (let i = 2; i < 40; i += 4) { const p = path[i]; k.cyl(0.1, 9, 'steel', { at: [p[0] + (off > 0 ? 1 : -1) * (w / 2 - 0.6), p[1] + 5.4, p[2]], seg: 6 }); }
    }
  }
  // piers: 4 rows (5 spans: 49 / 70 / 98 / 70 / 49 m)
  for (const f of [49, 119, 217, 287].map((d) => d / 336)) for (const off of [-11, 0, 11]) k.box(off === 0 ? 4 : 10, yAt(f) + 1, 2.4, 'bridgeConc', { at: [off, (yAt(f) - 1.4) / 2 - 1, f * L], r: 0.3 });
  k.pop();
}

function oldMill(k) {
  const [x, z] = PLACES.oldMill, y = heightAt(x, z);
  k.push(x, y, z, 0.5);
  k.add(lathe([[0, 0], [3.4, 0], [2.6, 9.5], [0, 9.5]], { seg: 24 }), 'render');
  k.add(lathe([[2.9, 0], [1.5, 2.2], [0, 3.0]], { seg: 24 }), 'roofMetal', { at: [0, 9.4, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    k.push(0, 10.2, 2.9, 0, 0, a);
    k.box(0.2, 7.5, 0.12, 'woodDark', { at: [0, 3.8, 0], r: 0.02 });
    k.box(1.6, 6.0, 0.05, 'sailcloth', { at: [0.75, 4.2, 0.05], r: 0.01 });
    k.pop();
  }
  k.box(9, 3.2, 6, 'render', { at: [7, 1.6, 0], r: 0.05 });
  k.add(lathe([[6.5, 0], [0.3, 1.8], [0, 1.85]], { seg: 4, phi0: Math.PI / 4 }).scale(1, 1, 0.66), 'roofMetal', { at: [7, 3.2, 0] });
  k.pop();
}

function warMemorial(k) {
  const [x, z] = PLACES.warMemorial, y = heightAt(x, z);
  k.push(x, y, z, 0.3);
  k.box(14, 1.0, 14, 'limestone', { at: [0, 0.5, 0], r: 0.05 });
  k.box(8, 1.2, 8, 'limestone', { at: [0, 1.6, 0], r: 0.05 });
  k.add(lathe([[2.0, 0], [1.7, 14], [1.0, 17.5], [0, 18.5]], { seg: 4, phi0: Math.PI / 4, crease: 20 }), 'limestone', { at: [0, 2.2, 0] });
  k.pop();
}

// Brookfield Place: the open steel exoskeleton crown (~30 m) above the 204 m roof, with the red BHP sign
function brookfieldCrown(k) {
  const x = -102.7, z = -471.4, y = heightAt(x, z) + 203.7, W = 70, D = 30, H = 30;   // on the OSM body (78 x 34.5 m footprint)
  k.push(x, y, z, -0.358);   // Kit yaw is clockwise-negative vs the city grid's +20.5° rake
  const C = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]];
  for (const [cx, cz] of C) k.bar([cx, 0, cz], [cx, H, cz], 0.9, 0.9, 'steel');
  for (const hy of [10, 20, H]) for (let i = 0; i < 4; i++) { const a = C[i], b = C[(i + 1) % 4]; k.bar([a[0], hy, a[1]], [b[0], hy, b[1]], 0.6, 0.7, 'steel'); }
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const x0 = -W / 2 + (i * W) / 4, x1 = x0 + W / 4;
    k.bar([x0, 0, s * D / 2], [x1, H, s * D / 2], 0.45, 0.45, 'steel'); k.bar([x1, 0, s * D / 2], [x0, H, s * D / 2], 0.45, 0.45, 'steel'); }
  for (const s of [-1, 1]) for (let i = 0; i <= 4; i++) { const xx = -W / 2 + (i * W) / 4; k.bar([xx, 0, s * D / 2], [xx, H, s * D / 2], 0.4, 0.4, 'steel'); }
  k.pop();
}
function bhpSign() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d');
  g.fillStyle = '#d4141b'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#fff'; g.font = 'bold 72px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BHP', 128, 52);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  const m = new MeshBasicMaterial({ map: t, color: 0xffffff, fog: true }); const out = [];
  const x = -102.7, z = -471.4, y = heightAt(x, z) + 203.7 + 24, ca = Math.cos(0.358), sa = Math.sin(0.358);
  for (const s of [-1, 1]) { const p = new Mesh(new PlaneGeometry(12, 4.5), m); p.position.set(x - sa * s * 15.6, y, z + ca * s * 15.6); p.rotation.y = (s > 0 ? 0 : Math.PI) - 0.358; out.push(p); }
  return out;
}

export function create(G, { mats }) {
  const k = new Kit();
  const lamps = [], colliders = [], footprints = [];
  bellTower(k); spanda(k); const bridge = eqBridge(k); firstContact(k); kiosk(k); eqJetty(k); barrackJetty(k);
  // Mends St precinct in its own meshes: culled by frustum and by distance on phones (1.3 km from the Quay)
  const km = new Kit(); footprints.push(mendsJetty(km, lamps, colliders)); numbatCanopy(km, colliders);
  narrows(k); oldMill(k); warMemorial(k); brookfieldCrown(k);
  // short bridge: island → Barrack Square
  k.bar([100, PROMENADE_Y + 0.25, 3], [127, PROMENADE_Y + 0.25, 6], 4.5, 0.5, 'timberDeck');
  for (const s of [-1, 1]) k.bar([100, PROMENADE_Y + 1.3, 3 + s * 2.2], [127, PROMENADE_Y + 1.3, 6 + s * 2.2], 0.06, 0.06, 'steel');
  k.bakeAO({ radius: 0.6, samples: 8, strength: 0.6, ground: PROMENADE_Y - 0.05 });
  // jetty lanterns + lit restaurant glazing switch on at dusk (same night ramp as the street lamps)
  const lantern = new MeshStandardMaterial({ color: 0x2a2620, emissive: new Color(1.0, 0.82, 0.55), emissiveIntensity: 0.4, roughness: 0.3 });
  const winWarm = new MeshStandardMaterial({ color: 0x0e1012, emissive: new Color(1.0, 0.72, 0.42), emissiveIntensity: 0, roughness: 0.08, metalness: 0.6 });
  (G.nightMats ||= []).push({ mat: lantern, day: 0.2, night: 9 }, { mat: winWarm, day: 0, night: 0.9 });
  const group = k.build({ ...mats, lantern, winWarm });
  km.bakeAO({ radius: 0.6, samples: 8, strength: 0.6, ground: 2.8 });
  const mends = km.build({ ...mats, lantern, winWarm }); mends.name = 'mends-precinct'; group.add(mends);
  for (const s of bhpSign()) group.add(s);
  return { group, bridge, lamps, colliders, footprints, mends };
}
