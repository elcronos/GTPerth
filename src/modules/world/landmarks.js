// Elizabeth Quay and Perth Water landmarks, modelled from published dimensions:
//  Bell Tower (Swan Bells, 82.5 m: concrete bell chamber in 30 m copper sails + glass spire of spokes)
//  Spanda (29 m, six nested white carbon-fibre arches)    Elizabeth Quay Bridge (110 m S-deck, two leaning 22 m arches)
//  First Contact (5 m cast aluminium bird-in-a-boat)      Florence Hummerston Kiosk (1927, on the island)
//  Elizabeth Quay Jetty (Transperth ferry terminal)       Barrack Street Jetty (piers 1-5)
//  Mends Street Jetty (South Perth)                       The Narrows Bridge (3 parallel decks)
//  Old Mill (1835 tower mill)                             State War Memorial obelisk (Kings Park)
import { CatmullRomCurve3, Vector3, CanvasTexture, SRGBColorSpace, Mesh, PlaneGeometry, MeshBasicMaterial } from 'three';
import { Kit, lathe, tube, roundedBox, sweep, extrudeBevel } from '../../cookbook/geo/kit.js';
import { BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, Color, DataTexture, RepeatWrapping, LinearFilter, DoubleSide } from 'three';
import { patch } from '../../cookbook/engine/patch.js';
import { ensureWorldVaryings } from '../../cookbook/materials/weathering.js';
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

function spanda(k, lamps, cols) {
  // Christian de Vietri, 2016 (Wikipedia / Development WA / ArchDaily): six gloss-white carbon-fibre arches of the same
  // shape, nested in ONE plane around a shared centre and growing exponentially; 29 m high, 16 m wide, 1 m deep. Each
  // arch thickens toward the ground (the feet sit in ~3 m concrete-filled sleeves) and is finest at the apex; the
  // smallest frames a person or two. Uplights at the feet wash the inner faces at night (light radiating from the centre).
  const [x, z] = PLACES.spanda, y = heightAt(x, z), [dx, dz] = PLACES.eqJettyDir;
  k.push(x, y, z, Math.atan2(-dx, -dz));          // the arches face down the inlet to the river
  // Each arch is an egg-shaped loop cut off near its base: widest at ~0.44 of its height, the legs leaning back in so
  // the feet sit at ~60 % of the widest span (all six pairs of feet bunched near the centre, as photographed).
  const N = 6, H0 = 29, W0 = 16, r = Math.pow(H0 / 3.0, 1 / (N - 1)), TH = Math.asin(0.8);
  for (let i = 0; i < N; i++) {
    const sc = Math.pow(r, -i), h = H0 * sc, A = (W0 / 2) * sc, B = h / 1.8, yc = 0.8 * B, pts = [];
    for (let j = 0; j <= 72; j++) { const th = -TH + (Math.PI + 2 * TH) * (j / 72); pts.push([A * Math.cos(th), Math.max(0, yc + B * Math.sin(th)), 0]); }
    const w = 2 * A * 0.6;   // foot spacing
    const r0 = 0.6 * Math.pow(sc, 0.8), r1 = 0.2 * Math.pow(sc, 0.6);
    k.add(tube(pts, (u) => { const m = Math.abs(u - 0.5) * 2; return r1 + (r0 - r1) * Math.pow(m, 2.4); }, { radial: 18, curve: true, samples: 160 }), 'spandaWhite', { occ: false });
    for (const sx of [-1, 1]) {   // foot sleeve flush with the paving + a recessed uplight
      k.cyl(r0 * 1.12, 0.06, 'granite', { at: [sx * w / 2, 0.03, 0], seg: 18 });
      { const fp = new Vector3(sx * w / 2, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), Math.atan2(-dx, -dz)); cols.push({ circle: [x + fp.x, z + fp.z, r0 + 0.1] }); }
      const lp = new Vector3(sx * w * 0.3, 0, 0.6).applyAxisAngle(new Vector3(0, 1, 0), Math.atan2(-dx, -dz)); if (i < 4) lamps.push([x + lp.x, y, z + lp.z]);
    }
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

function eqJetty(k, lamps) {
  // Elizabeth Quay ferry terminal (ARM Architecture + TCL; canopy design & construct Fabritecture / Maffeis, 2015):
  // a floating concrete jetty between piles, sheltered by a ~2,000 m² canopy "inspired by the ripples of water,
  // structured from blue fins and inflatable pillows made of ETFE" printed with Penny Bovell's artwork, on steel columns
  // standing on concrete pylons out of the water, LED-lit at night. Local frame: z along the jetty (+z south, to the
  // river), +x the berth (the ferry ties up on that side), −x the quay wall.
  const [x, z] = PLACES.eqJetty, [dx, dz] = PLACES.eqJettyDir, ry = Math.atan2(-dx, -dz);
  k.push(x, 0, z, ry);
  const L = 48, DY = 0.76;
  // floating jetty: concrete pontoon units with a composite deck, kerb + yellow edge line on the berth side
  for (let i = 0; i < 4; i++) { const zc = -L / 2 + 6 + i * 12; k.box(4.8, 1.0, 11.9, 'concrete', { at: [0, 0.22, zc], r: 0.08 }); }
  k.box(4.6, 0.05, L - 0.4, 'concrete', { at: [0, DY - 0.02, 0], r: 0.01, color: 0xd8d4cc });   // pale grey composite decking
  k.box(0.14, 0.05, L - 0.4, 'white', { at: [2.18, DY + 0.01, 0], color: 0xffc830 });
  for (let i = -11; i <= 11; i++) k.box(0.32, 0.75, 0.9, 'rubber', { at: [2.55, 0.42, i * 2.05], r: 0.05 });
  for (const zz of [-20, -6, 8, 20]) k.cyl(0.14, 0.45, 'granite', { at: [1.9, DY + 0.22, zz], seg: 10 });
  // guide piles through the pontoon + the canopy's concrete pylons in the water on the quay side
  for (const zz of [-17, 17]) { k.cyl(0.36, 6, 'steel', { at: [-2.75, 0.8, zz], seg: 14, color: 0x9aa0a6 }); k.cyl(0.42, 0.15, 'steel', { at: [-2.75, 3.8, zz], seg: 14 }); k.box(0.7, 0.5, 1.2, 'steel', { at: [-2.45, 0.6, zz], r: 0.03, color: 0x6a7076 }); }   // guide piles outside the deck, with the pontoon's pile collars
  const COLS = [-21, -14, -7, 0, 7, 14, 21];
  for (const zz of COLS) { k.cyl(0.55, 3.2, 'concrete', { at: [-3.4, -0.9, zz], seg: 16 }); k.cyl(0.6, 0.12, 'concrete', { at: [-3.4, 0.76, zz], seg: 16 }); }
  // raked twin steel columns (blue) up to a longitudinal box beam; cantilever arms out over the berth
  const RY = 5.1;
  for (const zz of COLS) {
    for (const s of [-1, 1]) k.bar([-3.4, 0.8, zz + s * 0.35], [-2.6, RY - 0.4, zz + s * 0.9], 0.24, 0.24, 'canopyBlue', { r: 0.03 });
    k.bar([-3.0, RY - 0.35, zz], [4.9, RY + 0.1, zz], 0.18, 0.45, 'canopyBlue', { r: 0.02 });
  }
  k.bar([-2.6, RY - 0.35, -L / 2], [-2.6, RY - 0.35, L / 2], 0.5, 0.5, 'canopyBlue', { r: 0.03 });
  k.bar([4.9, RY + 0.1, -L / 2], [4.9, RY + 0.1, L / 2], 0.2, 0.3, 'canopyBlue', { r: 0.02 });
  // the roof: transverse blue fins at 1.2 m whose tops ripple along and across the canopy, ETFE pillows between them
  const top = (fz, fx) => RY + 0.7 + 0.75 * Math.sin(fz * 0.3 + 0.8) * Math.cos(fx * 0.36 - fz * 0.07) + 0.22 * Math.sin(fz * 0.85 + fx * 0.6);
  const n = Math.round(L / 1.2), X0 = -3.6, X1 = 5.6, NX = 10;
  for (let i = 0; i <= n; i++) {
    const fz = -L / 2 + (L * i) / n, prof = [];
    for (let j = 0; j <= NX; j++) { const fx = X0 + ((X1 - X0) * j) / NX; prof.push([fx, top(fz, fx)]); }
    for (let j = NX; j >= 0; j--) { const fx = X0 + ((X1 - X0) * j) / NX; prof.push([fx, RY - 0.05 - 0.15 * Math.sin((j / NX) * Math.PI)]); }
    k.add(extrudeBevel(prof, { depth: 0.07, bevel: 0.015, bevelSeg: 1 }), 'canopyBlue', { at: [0, 0, fz], occ: false });
  }
  for (let i = 0; i < n; i++) {   // pillow: a low dome between two fins, its crown lifted 0.18 m
    const z0 = -L / 2 + (L * i) / n + 0.05, z1 = -L / 2 + (L * (i + 1)) / n - 0.05, F = [];
    for (let j = 0; j < NX; j++) {
      const xa = X0 + ((X1 - X0) * j) / NX, xb = X0 + ((X1 - X0) * (j + 1)) / NX, zm = (z0 + z1) / 2, lift = 0.16;
      const ya0 = top(z0, xa) - 0.12, yb0 = top(z0, xb) - 0.12, ya1 = top(z1, xa) - 0.12, yb1 = top(z1, xb) - 0.12;
      const yam = (ya0 + ya1) / 2 + lift, ybm = (yb0 + yb1) / 2 + lift;
      F.push([[xa, ya0, z0], [xa, yam, zm], [xb, ybm, zm], [xb, yb0, z0]], [[xa, yam, zm], [xa, ya1, z1], [xb, yb1, z1], [xb, ybm, zm]]);
    }
    k.add(faceGeo(F), 'etfe', { occ: false });
  }
  // LED strip under every 4th fin (lamp map pool on the deck at night)
  for (let i = 2; i < n; i += 4) { const fz = -L / 2 + (L * i) / n; k.box(7.6, 0.05, 0.06, 'lantern', { at: [1.0, RY - 0.2, fz], occ: false }); }
  for (const zz of [-18, -6, 6, 18]) { const lp = new Vector3(0.5, 0, zz).applyAxisAngle(new Vector3(0, 1, 0), ry); lamps.push([x + lp.x, DY, z + lp.z]); }
  // passenger furniture on the jetty: glass wind screens, benches, Transperth stop sign, SmartRider validators
  for (const zz of [-12, 4]) { k.box(0.05, 2.1, 6.0, 'glass', { at: [-2.2, DY + 1.05, zz], r: 0.01 }); k.box(0.06, 0.08, 6.0, 'steel', { at: [-2.2, DY + 2.12, zz] }); }
  for (const zz of [-14, -10, 2, 6]) { k.box(0.5, 0.06, 1.8, 'timber', { at: [-1.75, DY + 0.46, zz] }); for (const d of [-0.7, 0.7]) k.box(0.4, 0.44, 0.06, 'steel', { at: [-1.75, DY + 0.22, zz + d], color: 0x585d62 }); }
  k.box(0.08, 2.8, 0.08, 'steel', { at: [-1.9, DY + 1.4, -L / 2 + 2], color: 0x585d62 }); k.box(0.06, 0.9, 0.9, 'sign', { at: [-1.9, DY + 2.5, -L / 2 + 2] });
  for (const zz of [-L / 2 + 3.5, -L / 2 + 4.5]) k.box(0.22, 1.15, 0.16, 'alu', { at: [-1.0, DY + 0.58, zz], r: 0.03 });
  k.pop();
  // gangway from the quay down to the floating jetty (covered by the same canopy at its head)
  k.push(x, 0, z, ry);
  k.bar([-9.0, PROMENADE_Y + 0.05, -L / 2 + 3], [-2.4, DY + 0.05, -L / 2 + 3], 2.2, 0.14, 'alu');
  for (const s of [-1, 1]) k.add(tube([[-9.0, PROMENADE_Y + 1.05, -L / 2 + 3 + s * 1.05], [-2.4, DY + 1.05, -L / 2 + 3 + s * 1.05]], 0.035), 'steel', { occ: false });
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
// ---------------------------------------------------------------- Connect South canopies, Mindeerup piazza (Mends St)
// Rebuilt from references:
// - OSM footprints: way 1431651034 "Frillneck Lizard" (centre -225.2, 1340.0, head to the NE at the jetty foot) and way 1431651035
//   "Numbat" (centre -237.3, 1358.0), set end to end along the piazza spine from the jetty to Mends St.
// - City of South Perth: lizard 21 m long, 9.2 m wide, 9.7 m high, 9 t, facing the river to greet ferry passengers, four
//   legs, the head cut with "intricate and extensive hole patterns"; numbat 23.5 m long, 6.5 m tall, 5.6 m wide, 6 t, lights
//   up at night and watches over Mends St; numbat has a ribbed underbelly (Swan River ripples).
// - Denmac (fabricator): 8 mm plate aluminium bent like origami, some plates perforated for transparency, aluminium ribbing
//   underneath, painted in geometric patterns of bronze, yellow, orange, gold, red and stone.
// - Mikaela Castledine: crocheted black meerkats on the piazza (a mob of five).
// - Photo supplied by the player: yellow/orange folded lizard, a star frill of perforated yellow panels with orange-red
//   folds, angled faceted legs, stone-white faceted rear, timber boardwalk under it.
const CS = { Y: 0xf2b526, G: 0xd99a2c, O: 0xe56d1f, R: 0xb83b1d, B: 0x7a4b2a, S: 0xe6dfd2, K: 0x1d1915 };
const v3 = (p) => new Vector3(p[0], p[1], p[2]);
class Facets { // flat triangles grouped by material + colour; oriented away from a reference point when given
  constructor() { this.g = new Map(); }
  tri(a, b, c, col, ref, mat = 'csPaint') {
    if (ref) { const A = v3(a), n = v3(b).sub(A).cross(v3(c).sub(A)), m = A.add(v3(b)).add(v3(c)).multiplyScalar(1 / 3).sub(v3(ref)); if (n.dot(m) < 0) [b, c] = [c, b]; }
    const key = mat + '|' + col; if (!this.g.has(key)) this.g.set(key, []); this.g.get(key).push([a, b, c]);
  }
  quad(a, b, c, d, col, ref, mat) { this.tri(a, b, c, col, ref, mat); this.tri(a, c, d, col, ref, mat); }
  emit(k) { for (const [key, F] of this.g) { const [mat, col] = key.split('|'); k.add(faceGeo(F), mat, { color: +col, occ: false }); } }
}
const secAt = (S, z) => { // interpolate a section list (z descending or ascending) at z
  for (let i = 0; i < S.length - 1; i++) { const p = S[i], q = S[i + 1]; if ((z - p.z) * (z - q.z) <= 0) { const t = (z - p.z) / (q.z - p.z || 1), o = {}; for (const key of Object.keys(p)) o[key] = p[key] + (q[key] - p[key]) * t; return o; } }
  return S[S.length - 1];
};
// Yoshimura-style folded shell through sections {z, y, a, b, x?}: every other ring is rotated half a step and pushed out by
// `pop`, so the surface breaks into flat triangular facets like folded plate. Open shells span th0..th1 (0 = +x side, π/2 =
// top); closed shells go all the way round. col(i, th, z, q) picks each facet's paint; mat(i, th, z, q) its material.
function foldShell(F, S, { th0 = 0, th1 = Math.PI * 2, n = 10, closed = false, pop = 0.05, col, mat }) {
  const s = (th1 - th0) / n, P = (c, th, k) => [(c.x || 0) + c.a * k * Math.cos(th), c.y + c.b * k * Math.sin(th), c.z];
  const ring = (i) => { const c = S[i], odd = i % 2 === 1, k = odd ? 1 + pop : 1, out = [];
    if (closed) for (let j = 0; j < n; j++) { const t = th0 + (j + (odd ? 0.5 : 0)) * s; out.push({ p: P(c, t, k), t }); }
    else { if (odd) { out.push({ p: P(c, th0, 1), t: th0 }); for (let j = 0; j < n; j++) { const t = th0 + (j + 0.5) * s; out.push({ p: P(c, t, k), t }); } out.push({ p: P(c, th1, 1), t: th1 }); }
      else for (let j = 0; j <= n; j++) { const t = th0 + j * s; out.push({ p: P(c, t, k), t }); } }
    return out; };
  for (let i = 0; i < S.length - 1; i++) {
    const A = ring(i), B = ring(i + 1), c0 = S[i], c1 = S[i + 1], zm = (c0.z + c1.z) / 2;
    const ref = [((c0.x || 0) + (c1.x || 0)) / 2, (c0.y + c1.y) / 2, zm];
    let q = 0; const put = (a, b, c, t) => { F.tri(a.p, b.p, c.p, col(i, t, zm, q), ref, mat ? mat(i, t, zm, q) : undefined); q++; };
    if (closed) {
      const shiftB = (i + 1) % 2 === 1;   // the odd ring sits half a step ahead
      for (let j = 0; j < n; j++) { const j1 = (j + 1) % n, tm = th0 + (j + 0.5) * s;
        if (shiftB) { put(A[j], A[j1], B[j], tm); put(B[j], A[j1], B[j1], tm + s / 2); }
        else { put(B[j], B[j1], A[j], tm); put(A[j], B[j1], A[j1], tm + s / 2); } }
    } else {
      let a = 0, b = 0;
      while (a < A.length - 1 || b < B.length - 1) {
        const advA = b >= B.length - 1 || (a < A.length - 1 && A[a + 1].t <= B[b + 1].t);
        if (advA) { put(A[a], A[a + 1], B[b], (A[a].t + A[a + 1].t) / 2); a++; } else { put(A[a], B[b + 1], B[b], (B[b].t + B[b + 1].t) / 2); b++; }
      }
    }
  }
}
// aluminium ribs under an open shell: flat plates following the section arc, `d` deep, every `step` metres
function bellyRibs(F, S, z0, z1, step, th0, th1, d, col) {
  for (let z = z0; z <= z1 + 1e-6; z += step) { const c = secAt(S, z), n = 8;
    for (let j = 0; j < n; j++) { const t0 = th0 + ((th1 - th0) * j) / n, t1 = th0 + ((th1 - th0) * (j + 1)) / n, P = (t, k) => [(c.x || 0) + c.a * k * Math.cos(t), c.y + c.b * k * Math.sin(t), z];
      const ki = 1 - d / Math.min(c.a, c.b); F.quad(P(t0, 0.985), P(t1, 0.985), P(t1, ki), P(t0, ki), col, null); } }
}
// close the end of an open shell with a low faceted cone (apex dz beyond the end section)
function capShell(F, c, th0, th1, n, dz, col) { const ap = [c.x || 0, c.y + c.b * 0.25, c.z + dz], P = (t) => [(c.x || 0) + c.a * Math.cos(t), c.y + c.b * Math.sin(t), c.z];
  for (let j = 0; j < n; j++) F.tri(P(th0 + ((th1 - th0) * j) / n), P(th0 + ((th1 - th0) * (j + 1)) / n), ap, col(j), [c.x || 0, c.y, c.z - dz]); }
// folded-plate limb: a triangular prism along a polyline (ridge up), splayed toes on the ground at the end
function limb(F, P, w, cols, hint, toes = 3) {
  const T = P.map((p, i) => v3(P[Math.min(i + 1, P.length - 1)]).sub(v3(P[Math.max(i - 1, 0)])).normalize());
  const H = v3(hint), secs = P.map((p, i) => { const t = T[i], side = H.clone().addScaledVector(t, -H.dot(t)).normalize(), up = new Vector3().crossVectors(t, side); if (up.y < 0) up.negate();
    const c = v3(p), wi = w * (1 - 0.25 * (i / (P.length - 1)));
    return [c.clone().addScaledVector(up, wi * 0.6), c.clone().addScaledVector(side, wi * 0.5).addScaledVector(up, -wi * 0.3), c.clone().addScaledVector(side, -wi * 0.5).addScaledVector(up, -wi * 0.3)].map((v) => [v.x, v.y, v.z]); });
  for (let i = 0; i < P.length - 1; i++) { const ref = [(P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2, (P[i][2] + P[i + 1][2]) / 2];
    for (let f = 0; f < 3; f++) F.quad(secs[i][f], secs[i][(f + 1) % 3], secs[i + 1][(f + 1) % 3], secs[i + 1][f], cols[(i + f) % cols.length], ref); }
  F.tri(...secs[0], cols[0], P[1]); const e = P[P.length - 1]; F.tri(...secs[P.length - 1], cols[1 % cols.length], P[P.length - 2]);
  // toes: flat folded plates fanned forward from the foot
  const fw = v3(P[P.length - 1]).sub(v3(P[P.length - 2])); fw.y = 0; if (fw.lengthSq() < 1e-4) fw.copy(H); fw.normalize();
  for (let i = 0; i < toes; i++) { const a = (i - (toes - 1) / 2) * 0.55, d = fw.clone().applyAxisAngle(new Vector3(0, 1, 0), a), sd = new Vector3(-d.z, 0, d.x);
    const base = [e[0], 0.02, e[2]], tip = [e[0] + d.x * w * 1.6, 0.02, e[2] + d.z * w * 1.6], k0 = [e[0] + sd.x * w * 0.22, 0.02, e[2] + sd.z * w * 0.22], k1 = [e[0] - sd.x * w * 0.22, 0.02, e[2] - sd.z * w * 0.22];
    const ridge = [e[0] + d.x * w * 0.5, 0.22, e[2] + d.z * w * 0.5];
    const inn = [e[0] + d.x * w * 0.6, 0.06, e[2] + d.z * w * 0.6];
    F.tri(k0, ridge, tip, cols[(i + 1) % cols.length], inn); F.tri(k1, tip, ridge, cols[i % cols.length], inn); F.tri(k0, k1, ridge, cols[(i + 2) % cols.length], inn); }
}
const toWorld = (x, z, yaw, lx, lz) => { const p = new Vector3(lx, 0, lz).applyAxisAngle(new Vector3(0, 1, 0), yaw); return [x + p.x, z + p.z]; };

function frilledLizard(k, cols, lamps) {
  const [x, z] = PLACES.lizard, y = heightAt(x, z), yaw = Math.atan2(0.676, -0.737);   // head to the NE, at the river
  k.push(x, y, z, yaw);
  const F = new Facets(), { Y, G, O, R, B, S } = CS;
  // body: an open folded roof on four legs (you walk underneath); the stone-white rump, gold-yellow back, orange-red flanks
  const body = [{ z: -5.0, y: 3.3, a: 1.9, b: 1.5 }, { z: -3.6, y: 3.5, a: 2.6, b: 1.9 }, { z: -2.0, y: 3.7, a: 3.0, b: 2.1 }, { z: -0.4, y: 3.85, a: 3.15, b: 2.2 },
    { z: 1.2, y: 4.0, a: 3.0, b: 2.15 }, { z: 2.6, y: 4.3, a: 2.5, b: 1.95 }, { z: 3.8, y: 4.8, a: 1.75, b: 1.6 }];
  const bodyCol = (i, th, zz, q) => { const up = Math.sin(th), rear = zz < -2.2;
    if (rear) return up > 0.55 ? ((i + q) % 3 === 0 ? G : S) : (q % 4 === 1 ? Y : S);
    if (up > 0.8) return (i + q) % 2 ? Y : G;
    if (up > 0.3) return [O, Y, R, O][(i * 3 + q) % 4];
    return (i + q) % 2 ? R : B; };
  foldShell(F, body, { th0: -0.32, th1: Math.PI + 0.32, n: 10, pop: 0.07, col: bodyCol });
  bellyRibs(F, body, -4.4, 3.2, 0.8, -0.2, Math.PI + 0.2, 0.32, B);
  capShell(F, body[0], -0.32, Math.PI + 0.32, 8, -0.7, (j) => (j % 2 ? S : G)); capShell(F, body[body.length - 1], -0.32, Math.PI + 0.32, 8, 0.6, (j) => (j % 2 ? O : Y));
  // neck + head, reared up toward the river: a flat wedge skull and a dropped lower jaw (the display gape), the crown plates
  // cut with hole patterns
  const head = [{ z: 3.4, y: 5.0, a: 1.3, b: 1.15 }, { z: 4.8, y: 5.45, a: 1.22, b: 0.95 }, { z: 6.1, y: 5.8, a: 1.15, b: 0.72 }, { z: 7.4, y: 5.78, a: 0.88, b: 0.5 },
    { z: 8.5, y: 5.62, a: 0.5, b: 0.3 }, { z: 9.3, y: 5.5, a: 0.12, b: 0.08 }, { z: 9.6, y: 5.47, a: 0.02, b: 0.02 }];
  foldShell(F, head, { n: 8, closed: true, pop: 0.07,
    col: (i, th, zz, q) => { const up = Math.sin(th); return up > 0.5 ? ((i + q) % 2 ? Y : G) : up > -0.3 ? ((i + q) % 3 ? O : Y) : R; },
    mat: (i, th, zz, q) => (Math.sin(th) > 0.35 && i >= 1 && i <= 3 && (i + q) % 2 === 0 ? 'csPerf' : 'csPaint') });
  const jaw = [{ z: 5.5, y: 5.05, a: 1.0, b: 0.38 }, { z: 6.7, y: 4.62, a: 0.82, b: 0.3 }, { z: 7.8, y: 4.2, a: 0.5, b: 0.2 }, { z: 8.6, y: 3.92, a: 0.1, b: 0.07 }, { z: 8.8, y: 3.88, a: 0.02, b: 0.02 }];
  foldShell(F, jaw, { n: 8, closed: true, pop: 0.06, col: (i, th, zz, q) => (Math.sin(th) > 0.2 ? (q % 2 ? R : O) : (q % 2 ? S : G)) });
  { const M = 0xd8574a;   // the gape: pink-red mouth plates between the jaws
    for (const sx of [-1, 1]) F.quad([sx * 0.95, 5.3, 5.6], [sx * 0.62, 5.38, 8.2], [sx * 0.42, 4.3, 7.6], [sx * 0.8, 4.95, 5.7], M, [0, 5, 6.5]);
    F.quad([-0.62, 5.38, 8.2], [0.62, 5.38, 8.2], [0.95, 5.3, 5.6], [-0.95, 5.3, 5.6], M, [0, 6, 6.8]); F.quad([-0.42, 4.3, 7.6], [-0.8, 4.95, 5.7], [0.8, 4.95, 5.7], [0.42, 4.3, 7.6], M, [0, 3.5, 6.8]); }
  for (const sx of [-1, 1]) { const ex = sx * 1.0, ey = 6.02, ez = 6.3;   // eyes: dark faceted studs
    F.tri([ex, ey + 0.22, ez - 0.25], [ex + sx * 0.18, ey, ez], [ex, ey - 0.2, ez - 0.25], CS.K, [0, ey, ez - 0.2]);
    F.tri([ex, ey + 0.22, ez - 0.25], [ex, ey - 0.2, ez - 0.25], [ex, ey, ez + 0.3], CS.K, [-sx, ey, ez]);
    F.tri([ex + sx * 0.18, ey, ez], [ex, ey, ez + 0.3], [ex, ey - 0.2, ez - 0.25], CS.K, [0, ey, ez - 0.2]); }
  // the frill: a pleated star of 18 panels around the neck, flaring forward; perforated yellow panels alternating with
  // solid orange-red folds, on bronze spokes. Top at 9.7 m, 9.2 m across.
  const FZ = 4.55, FY = 5.35, N = 18, I = [], T = [];
  for (let j = 0; j <= N; j++) { const ph = (j / N) * Math.PI * 2 + Math.PI / 2, long = j % 2 === 0, sn = Math.sin(ph), cs = Math.cos(ph);
    let Rr = (long ? 4.35 : 3.35) * (1 + 0.04 * Math.abs(cs)); if (sn < 0) Rr = Math.min(Rr, (FY - (long ? 1.7 : 2.3)) / -sn);
    I.push([cs * 1.28, FY + sn * 1.05, FZ - 0.25]); T.push([cs * Rr, FY + sn * Rr, FZ + (long ? 0.95 : 0.35)]); }
  for (let j = 0; j < N; j++) { const ref = [(I[j][0] + I[j + 1][0]) / 2, (I[j][1] + I[j + 1][1]) / 2, FZ - 3];   // orient toward the river
    if (j % 2 === 0) F.quad(I[j], T[j], T[j + 1], I[j + 1], j % 4 === 0 ? Y : G, ref, 'csPerf');
    else F.quad(I[j], T[j], T[j + 1], I[j + 1], j % 4 === 1 ? O : R, ref); }
  for (let j = 0; j < N; j++) { k.bar(I[j], T[j], 0.12, 0.12, 'csPaint', { color: CS.B, occ: false }); k.bar(T[j], T[j + 1], 0.08, 0.08, 'csPaint', { color: CS.R, occ: false }); }
  // legs: sprawled and bent like a lizard's (shoulder out and up to the elbow, then down to splayed toes)
  const LEGS = [[[2.3, 3.9, 1.6], [4.3, 4.5, 2.4], [4.7, 0.7, 3.3], [4.9, 0.0, 3.9]], [[1.8, 3.4, -3.8], [4.1, 4.2, -4.9], [4.5, 0.7, -6.0], [4.7, 0.0, -6.7]]];
  for (const sx of [-1, 1]) for (const [li, L] of LEGS.entries()) {
    const P = L.map(([lx, ly, lz]) => [sx * lx, ly, lz]);
    limb(F, P, li === 0 ? 0.95 : 1.05, li === 0 ? [O, Y, R] : [S, G, O], [0, 0, 1]);
    const [wx, wz] = toWorld(x, z, yaw, P[3][0], P[3][2]); cols.push({ circle: [wx, wz, 0.55] });
    const [mx, mz] = toWorld(x, z, yaw, P[2][0], P[2][2]); cols.push({ circle: [mx, mz, 0.45] });
  }
  // tail: tapering to the ground and curling toward the numbat
  const tail = [{ z: -4.4, y: 3.2, a: 1.4, b: 1.15, x: 0 }, { z: -5.6, y: 2.1, a: 1.15, b: 0.9, x: -0.1 }, { z: -6.9, y: 1.05, a: 0.9, b: 0.62, x: -0.25 },
    { z: -8.3, y: 0.55, a: 0.65, b: 0.4, x: -0.5 }, { z: -9.7, y: 0.32, a: 0.4, b: 0.26, x: -0.75 }, { z: -10.9, y: 0.18, a: 0.14, b: 0.1, x: -0.9 }, { z: -11.4, y: 0.15, a: 0.02, b: 0.02, x: -0.95 }];
  foldShell(F, tail, { n: 8, closed: true, pop: 0.06, col: (i, th, zz, q) => (Math.sin(th) > 0.2 ? [S, G, S, O][(i + q) % 4] : B) });
  for (const t of [-5.4, -6.4, -7.4, -8.4, -9.4, -10.4]) { const c = secAt(tail, t); if (c.y - c.b < 1.9) { const [wx, wz] = toWorld(x, z, yaw, c.x, c.z); cols.push({ circle: [wx, wz, c.a + 0.15] }); } }
  F.emit(k);
  // timber boardwalk along the spine under the canopy + uplights in its belly
  for (let i = 0; i < 4; i++) k.box(5.6, 0.1, 4.6, 'timberDeck', { at: [0, -0.02, -6.6 + i * 4.75], color: [0xffffff, 0xe8dfd3, 0xf2eadf, 0xdcd1c3][i], r: 0.01, seg: 1, step: 20 });
  for (const lz of [-3, 1.5]) { const [wx, wz] = toWorld(x, z, yaw, 0, lz); lamps.push([wx, y + 2.4, wz]); }
  k.pop();
  return { x, z, yaw };
}

function numbatCanopy(k, cols, lamps) {
  const [x, z] = PLACES.numbat, y = heightAt(x, z), yaw = Math.atan2(-0.354, 0.935);   // head toward Mends St, tail to the lizard
  k.push(x, y, z, yaw);
  const F = new Facets(), { Y, G, O, R, B, S, K } = CS;
  const body = [{ z: -7.2, y: 3.25, a: 1.8, b: 1.8 }, { z: -5.6, y: 3.5, a: 2.5, b: 2.45 }, { z: -3.6, y: 3.62, a: 2.75, b: 2.65 }, { z: -1.6, y: 3.65, a: 2.8, b: 2.68 },
    { z: 0.4, y: 3.6, a: 2.75, b: 2.6 }, { z: 2.4, y: 3.5, a: 2.55, b: 2.4 }, { z: 4.2, y: 3.35, a: 2.1, b: 2.05 }, { z: 5.6, y: 3.25, a: 1.55, b: 1.6 }];
  // banded rump: stone stripes across the back toward the tail; rust-red, bronze and orange folds elsewhere
  const stripe = (zz) => zz < -0.6 && Math.floor((-zz - 0.6) / 1.15) % 2 === 0;
  foldShell(F, body, { th0: -0.36, th1: Math.PI + 0.36, n: 10, pop: 0.06,
    col: (i, th, zz, q) => { const up = Math.sin(th); if (up > 0.2 && stripe(zz)) return q % 5 === 2 ? G : S;
      return up > 0.75 ? ((i + q) % 2 ? R : O) : up > 0.25 ? [O, R, B, R][(i * 3 + q) % 4] : (q % 2 ? B : R); } });
  bellyRibs(F, body, -6.6, 5.0, 0.55, -0.25, Math.PI + 0.25, 0.42, CS.G);   // the ribbed underbelly (river ripples)
  capShell(F, body[0], -0.36, Math.PI + 0.36, 8, -0.7, (j) => (j % 2 ? B : S)); capShell(F, body[body.length - 1], -0.36, Math.PI + 0.36, 8, 0.6, (j) => (j % 2 ? R : O));
  const head = [{ z: 5.1, y: 3.45, a: 1.45, b: 1.5 }, { z: 6.6, y: 3.35, a: 1.35, b: 1.32 }, { z: 8.0, y: 2.95, a: 0.92, b: 0.86 }, { z: 9.3, y: 2.55, a: 0.48, b: 0.42 },
    { z: 10.3, y: 2.3, a: 0.14, b: 0.13 }, { z: 10.7, y: 2.25, a: 0.02, b: 0.02 }];
  foldShell(F, head, { n: 8, closed: true, pop: 0.06,
    col: (i, th, zz, q) => { const up = Math.sin(th); if (Math.abs(up) < 0.32 && i >= 1 && i <= 3) return K;   // the dark eye stripe
      return up > 0.3 ? ((i + q) % 2 ? O : R) : up > -0.3 ? O : S; } });
  for (const sx of [-1, 1]) { const b0 = [sx * 0.55, 4.45, 5.6], b1 = [sx * 1.15, 4.3, 6.3], tip = [sx * 1.05, 5.45, 5.75];   // ears
    F.tri(b0, b1, tip, O, [0, 4, 6.5]); F.tri(b0, tip, b1, R, [0, 4, 5]); }
  // the bushy tail held up behind
  const tail = [{ z: -6.4, y: 4.0, a: 0.7, b: 0.8 }, { z: -7.6, y: 4.6, a: 0.92, b: 1.05 }, { z: -8.8, y: 5.2, a: 1.0, b: 1.1 }, { z: -9.9, y: 5.5, a: 0.9, b: 0.95 },
    { z: -10.8, y: 5.6, a: 0.6, b: 0.62 }, { z: -11.5, y: 5.6, a: 0.05, b: 0.05 }];
  foldShell(F, tail, { n: 10, closed: true, pop: 0.12, col: (i, th, zz, q) => [B, G, S, B, O][(i * 2 + q) % 5], mat: (i, th, zz, q) => ((i + q) % 4 === 0 && Math.sin(th) > 0 ? 'csPerf' : 'csPaint') });
  // four legs, mostly upright, folded plate
  const LEGS = [[[2.1, 2.7, 3.4], [2.75, 1.4, 3.9], [2.95, 0, 4.5]], [[2.2, 2.7, -4.6], [2.85, 1.35, -5.3], [3.05, 0, -5.95]]];
  for (const sx of [-1, 1]) for (const L of LEGS) {
    const P = L.map(([lx, ly, lz]) => [sx * lx, ly, lz]);
    limb(F, P, 0.9, [R, B, O], [0, 0, 1], 4);
    const [wx, wz] = toWorld(x, z, yaw, P[2][0], P[2][2]); cols.push({ circle: [wx, wz, 0.55] });
  }
  F.emit(k);
  for (let i = 0; i < 4; i++) k.box(5.0, 0.1, 4.4, 'timberDeck', { at: [0, -0.02, -6.4 + i * 4.5], color: [0xf2eadf, 0xe0d6c8, 0xffffff, 0xe8dfd3][i], r: 0.01, seg: 1, step: 20 });
  for (const lz of [-4, 0.5, 4.4]) { const [wx, wz] = toWorld(x, z, yaw, 0, lz); lamps.push([wx, y + 2.6, wz]); }   // lit at night
  k.pop();
}

// Mikaela Castledine's meerkats: crocheted black yarn over a frame, standing up on watch
function meerkat(k, x, z, yaw, s, look) {
  k.push(x, heightAt(x, z), z, yaw, 0, 0, s);
  k.add(lathe([[0, 0], [0.09, 0.0], [0.15, 0.07], [0.17, 0.26], [0.155, 0.48], [0.12, 0.64], [0.085, 0.74], [0.07, 0.8], [0, 0.82]], { seg: 11 }), 'meerkat');
  k.push(0, 0.86, 0.01, look, 0.12);
  k.add(lathe([[0, -0.085], [0.06, -0.07], [0.088, -0.01], [0.075, 0.05], [0.04, 0.085], [0, 0.09]], { seg: 10 }), 'meerkat');
  k.add(lathe([[0.055, 0], [0.035, 0.06], [0.012, 0.13], [0, 0.135]], { seg: 8 }), 'meerkat', { at: [0, -0.02, 0.05], rot: [Math.PI / 2, 0, 0] });
  for (const sx of [-1, 1]) k.box(0.05, 0.04, 0.025, 'meerkat', { at: [sx * 0.075, 0.04, -0.02], r: 0.008 });
  for (const sx of [-1, 1]) k.cyl(0.016, 0.01, 'granite', { at: [sx * 0.045, 0.02, 0.07], rot: [Math.PI / 2, 0, 0], seg: 6, color: 0x707070 });   // glinting eyes
  k.pop();
  for (const sx of [-1, 1]) { k.bar([sx * 0.11, 0.6, 0.05], [sx * 0.08, 0.47, 0.13], 0.05, 0.045, 'meerkat', { r: 0.015 }); k.box(0.07, 0.04, 0.12, 'meerkat', { at: [sx * 0.07, 0.02, 0.05], r: 0.015 }); }
  k.bar([0, 0.1, -0.12], [0, 0.03, -0.46], 0.06, 0.05, 'meerkat', { r: 0.02 });   // tail as the third leg of the stand
  k.pop();
}

function connectSouth(k, cols, lamps) {
  const L = frilledLizard(k, cols, lamps); numbatCanopy(k, cols, lamps);
  // the mob of five on the boardwalk beside the lizard, all on watch toward the river
  const MOB = [[-5.6, -1.6, 1.42, 0.2], [-6.3, -0.6, 1.2, -0.3], [-5.0, -0.4, 1.0, 0.5], [-6.6, -2.3, 0.85, 0.1], [-5.9, -3.1, 0.78, -0.6]];
  for (const [lx, lz, s, look] of MOB) { const [wx, wz] = toWorld(L.x, L.z, L.yaw, lx, lz); meerkat(k, wx, wz, L.yaw + look * 0.4, s, look); cols.push({ circle: [wx, wz, 0.18 * s] }); }
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
  bellTower(k); spanda(k, lamps, colliders); const bridge = eqBridge(k); firstContact(k); kiosk(k); eqJetty(k, lamps); barrackJetty(k);
  // Mends St precinct in its own meshes: culled by frustum and by distance on phones (1.3 km from the Quay)
  const km = new Kit(); footprints.push(mendsJetty(km, lamps, colliders)); connectSouth(km, colliders, lamps);
  narrows(k); oldMill(k); warMemorial(k); brookfieldCrown(k);
  // short bridge: island → Barrack Square
  k.bar([100, PROMENADE_Y + 0.25, 3], [127, PROMENADE_Y + 0.25, 6], 4.5, 0.5, 'timberDeck');
  for (const s of [-1, 1]) k.bar([100, PROMENADE_Y + 1.3, 3 + s * 2.2], [127, PROMENADE_Y + 1.3, 6 + s * 2.2], 0.06, 0.06, 'steel');
  k.bakeAO({ radius: 0.6, samples: 8, strength: 0.6, ground: PROMENADE_Y - 0.05 });
  // jetty lanterns + lit restaurant glazing switch on at dusk (same night ramp as the street lamps)
  const lantern = new MeshStandardMaterial({ color: 0x2a2620, emissive: new Color(1.0, 0.82, 0.55), emissiveIntensity: 0.4, roughness: 0.3 });
  const winWarm = new MeshStandardMaterial({ color: 0x0e1012, emissive: new Color(1.0, 0.72, 0.42), emissiveIntensity: 0, roughness: 0.08, metalness: 0.6 });
  (G.nightMats ||= []).push({ mat: lantern, day: 0.2, night: 9 }, { mat: winWarm, day: 0, night: 0.9 });
  // Spanda: gloss white carbon fibre; at night the uplights wash the inner faces (light radiating from the centre)
  const spandaWhite = new MeshStandardMaterial({ color: 0xf7f7f3, roughness: 0.14, metalness: 0.0, vertexColors: true });
  { const [sx, sz] = PLACES.spanda, sy = heightAt(sx, sz);
    patch(spandaWhite, 'spanda-uplight', (sh) => { ensureWorldVaryings(sh); sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { vec3 toC = normalize(vec3(${sx.toFixed(2)}, ${sy.toFixed(2)}, ${sz.toFixed(2)}) - vWthPos); float inner = smoothstep(0.1, 0.7, dot(normalize(vWthN), toC));
    float fall = exp(-(vWthPos.y - ${sy.toFixed(2)}) / 22.0); totalEmissiveRadiance += vec3(0.95, 0.97, 1.0) * inner * (0.25 + 0.75 * fall) * 1.6 * uNight; }`); }); }
  // ETFE pillows of the ferry canopy: translucent, printed with a fine blue dot screen
  const dots = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#9dbbe6'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#1f4fa8';
    for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 8) { const r = 1.2 + 2.2 * (0.5 + 0.5 * Math.sin((x + y * 0.6) * 0.07)); g.beginPath(); g.arc(x + 4 + (y % 16 ? 4 : 0), y + 4, r, 0, Math.PI * 2); g.fill(); }
    const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(0.8, 0.8); return t; })();
  const etfe = new MeshStandardMaterial({ map: dots, color: 0xffffff, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false, vertexColors: true });
  const group = k.build({ ...mats, lantern, winWarm, spandaWhite, etfe });
  km.bakeAO({ radius: 0.6, samples: 8, strength: 0.6, ground: 2.8 });
  // Connect South canopies: satin-painted folded plate (Dulux Weathermax), perforated plate (alpha-tested hole grid, the holes
  // also cut the shadow), black crocheted yarn; the canopies are floodlit from below at night
  // hole pattern: a 0.5 m tile of big 13 cm holes on a 25 cm grid with small 5 cm holes between (read from 30 m away);
  // no mipmaps, so distant plates keep their holes instead of averaging to solid
  const holes = (() => { const N = 128, d = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const u = ((i + 0.5) / N) * 2, v = ((j + 0.5) / N) * 2, du = u - Math.floor(u) - 0.5, dv = v - Math.floor(v) - 0.5,
      eu = u + 0.5 - Math.floor(u + 0.5) - 0.5, ev = v + 0.5 - Math.floor(v + 0.5) - 0.5, o = Math.hypot(du, dv) < 0.27 || Math.hypot(eu, ev) < 0.1 ? 0 : 255, q = (i + j * N) * 4; d[q] = d[q + 1] = d[q + 2] = o; d[q + 3] = 255; }
    const t = new DataTexture(d, N, N); t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(2, 2); t.magFilter = LinearFilter; t.minFilter = LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; })();
  const glow = (m) => patch(m, 'cs-floodlit', (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.84, 0.66) * 0.32 * uNight;'); });
  const csPaint = glow(new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.42, metalness: 0.05, side: DoubleSide }));
  const csPerf = glow(new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.45, metalness: 0.05, side: DoubleSide, alphaMap: holes, alphaTest: 0.5 }));
  const meerkat = new MeshStandardMaterial({ color: 0x2a2724, vertexColors: true, roughness: 0.98, metalness: 0 });
  const mends = km.build({ ...mats, lantern, winWarm, csPaint, csPerf, meerkat }); mends.name = 'mends-precinct'; group.add(mends);
  for (const s of bhpSign()) group.add(s);
  return { group, bridge, lamps, colliders, footprints, mends };
}
