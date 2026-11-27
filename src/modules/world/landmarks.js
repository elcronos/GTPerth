// Elizabeth Quay and Perth Water landmarks, modelled from published dimensions:
//  Bell Tower (Swan Bells, 82.5 m: concrete bell chamber in 30 m copper sails + glass spire of spokes)
//  Spanda (29 m, six nested white carbon-fibre arches)    Elizabeth Quay Bridge (110 m S-deck, two leaning 22 m arches)
//  First Contact (5 m cast aluminium bird-in-a-boat)      Florence Hummerston Kiosk (1927, on the island)
//  Elizabeth Quay Jetty (Transperth ferry terminal)       Barrack Street Jetty (piers 1-5)
//  Mends Street Jetty (South Perth)                       The Narrows Bridge (3 parallel decks)
//  Old Mill (1835 tower mill)                             State War Memorial obelisk (Kings Park)
import { CatmullRomCurve3, Vector3, CanvasTexture, SRGBColorSpace, Mesh, PlaneGeometry, MeshBasicMaterial } from 'three';
import { Kit, lathe, tube, roundedBox, sweep, extrudeBevel } from '../../cookbook/geo/kit.js';
import { boxSweep, sailBlade } from './shapes.js';
import { heightAt, PLACES, ISLAND, NARROWS, PROMENADE_Y } from '../../map.js';

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

function mendsJetty(k) {
  const [x0, z0] = PLACES.mendsJetty, [x1, z1] = PLACES.mendsHead;
  const len = Math.hypot(x1 - x0, z1 - z0) + 4, ry = Math.atan2(x0 - x1, z0 - z1);
  k.push((x0 + x1) / 2, 0, (z0 + z1) / 2, ry);
  k.box(4.6, 0.35, len, 'timberDeck', { at: [0, 1.6, 0], r: 0.02 });
  for (let j = -8; j <= 8; j++) for (const s of [-2, 2]) k.cyl(0.2, 4, 'pile', { at: [s, -0.5, j * 3] });
  for (let j = -len / 2; j <= len / 2; j += 2.5) for (const s of [-2.35, 2.35]) k.bar([s, 1.75, j], [s, 2.7, j], 0.05, 0.05, 'steel');
  k.tube([[2.35, 2.7, -len / 2], [2.35, 2.7, len / 2]], 0.035, 'steel'); k.tube([[-2.35, 2.7, -len / 2], [-2.35, 2.7, len / 2]], 0.035, 'steel');
  // shelter at the head (new 2023 shelter) + floating pontoon extension
  k.box(4.4, 0.2, 9, 'canopy', { at: [0, 4.7, -len / 2 + 6], r: 0.04 });
  for (const s of [-1.9, 1.9]) for (const t of [-3.5, 0, 3.5]) k.cyl(0.08, 3.0, 'steel', { at: [s, 3.2, -len / 2 + 6 + t] });
  k.box(4.0, 2.2, 0.08, 'glass', { at: [0, 2.9, -len / 2 + 9.5], r: 0.01 });
  k.box(8, 0.9, 14, 'concrete', { at: [-1, 0.25, -len / 2 - 6], r: 0.05 });
  k.box(7.6, 0.05, 13.6, 'timberDeck', { at: [-1, 0.73, -len / 2 - 6], r: 0.01 });
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
  bellTower(k); spanda(k); const bridge = eqBridge(k); firstContact(k); kiosk(k); eqJetty(k); barrackJetty(k); mendsJetty(k);
  narrows(k); oldMill(k); warMemorial(k); brookfieldCrown(k);
  // short bridge: island → Barrack Square
  k.bar([100, PROMENADE_Y + 0.25, 3], [127, PROMENADE_Y + 0.25, 6], 4.5, 0.5, 'timberDeck');
  for (const s of [-1, 1]) k.bar([100, PROMENADE_Y + 1.3, 3 + s * 2.2], [127, PROMENADE_Y + 1.3, 6 + s * 2.2], 0.06, 0.06, 'steel');
  k.bakeAO({ radius: 0.6, samples: 8, strength: 0.6, ground: PROMENADE_Y - 0.05 });
  const group = k.build(mats);
  for (const s of bhpSign()) group.add(s);
  return { group, bridge };
}
