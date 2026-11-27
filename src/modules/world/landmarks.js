// Elizabeth Quay and Perth Water landmarks, modelled from published dimensions:
//  Bell Tower (Swan Bells, 82.5 m: concrete bell chamber in 30 m copper sails + glass spire of spokes)
//  Spanda (29 m, six nested white carbon-fibre arches)    Elizabeth Quay Bridge (110 m S-deck, two leaning 22 m arches)
//  First Contact (5 m cast aluminium bird-in-a-boat)      Florence Hummerston Kiosk (1927, on the island)
//  Elizabeth Quay Jetty (Transperth ferry terminal)       Barrack Street Jetty (piers 1-5)
//  Mends Street Jetty (South Perth)                       The Narrows Bridge (3 parallel decks)
//  Old Mill (1835 tower mill)                             State War Memorial obelisk (Kings Park)
import { CatmullRomCurve3, Vector3 } from 'three';
import { Kit, lathe, tube, roundedBox, sweep } from '../../cookbook/geo/kit.js';
import { heightAt, PLACES, ISLAND, NARROWS, PROMENADE_Y } from '../../map.js';

const V = (x, y, z) => new Vector3(x, y, z);

function bellTower(k) {
  const [x, z] = PLACES.bellTower, y = heightAt(x, z);
  k.push(x, y, z, 0.25);
  // podium + reflection pool rim
  k.cyl(17, 0.9, 'limestone', { at: [0, 0.45, 0], seg: 48 });
  k.cyl(14.5, 0.25, 'water', { at: [0, 0.95, 0], seg: 48 });
  // tinted glass spire: a tall square-section needle (rotated 45°) that starts wide at the plaza and tapers to the
  // tip at 82.5 m; the six-storey concrete bell chamber stands inside its lower third
  const top = 82.5 - 0.9;
  k.add(lathe([[0, 0], [7.0, 0], [6.4, 12], [5.6, 24], [4.6, 34], [3.4, 46], [2.1, 58], [1.0, 70], [0.05, top]], { seg: 4, phi0: Math.PI / 4, crease: 20 }), 'glassLight', { at: [0, 0.9, 0], occ: false });
  k.add(lathe([[0, 4], [3.6, 4], [3.3, 30], [0, 30]], { seg: 4, phi0: Math.PI / 4, crease: 20 }), 'concrete', { at: [0, 0.9, 0] });
  // gleaming steel "spokes" ringing the spire, radiating from the central axle, narrowing upward
  for (let h = 34; h < top - 3; h += 2.3) {
    const t = (h - 34) / (top - 34), r = 4.6 * (1 - t) + 0.3;
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; k.bar([0, h + 0.9, 0], [Math.cos(a) * (r + 1.1), h + 0.9, Math.sin(a) * (r + 1.1)], 0.12, 0.12, 'steel'); }
  }
  for (let h = 3; h < 34; h += 3.4) { const r = 7.0 - (h / 34) * 2.4; k.add(lathe([[r + 0.04, h], [r + 0.12, h + 0.12], [r + 0.04, h + 0.24]], { seg: 4, phi0: Math.PI / 4 }), 'steel', { at: [0, 0.9, 0], occ: false }); }
  k.cyl(0.22, top - 30, 'steel', { at: [0, 30 + (top - 30) / 2, 0], seg: 8 });
  // copper sails: tall curved leaves standing in front of the glass on the river side, flaring like spinnakers
  const sail = (az, H, R, span, lean) => {
    const p = [[R * 0.55, 0], [R * 0.9, H * 0.18], [R, H * 0.42], [R * 0.86, H * 0.7], [R * 0.5, H * 0.92], [R * 0.25, H]];
    k.add(lathe(p, { seg: 12, phi0: az - span / 2, phiLen: span, crease: 70 }), 'copper', { at: [0, 0.9, 0] });
    k.add(lathe(p.map(([r, h]) => [r - 0.35, h]).reverse(), { seg: 12, phi0: az - span / 2, phiLen: span, crease: 70 }), 'copper', { at: [0, 0.9, 0] });
  };
  sail(Math.PI * 0.5 - 0.55, 31, 10.5, 0.85);          // south-west sail
  sail(Math.PI * 0.5 + 0.55, 29, 10.0, 0.8);           // south-east sail
  sail(Math.PI * 0.5 - 1.55, 22, 8.8, 0.7);            // west, lower
  sail(Math.PI * 0.5 + 1.6, 20, 8.6, 0.7);             // east, lower
  k.pop();
}

function spanda(k) {
  const [x, z] = PLACES.spanda, y = heightAt(x, z);
  k.push(x, y, z, 0.12);
  // six nested arches growing exponentially; all share the west foot, the plane faces the river (south)
  const sizes = [29, 20.3, 14.2, 9.9, 6.9, 4.8];
  for (let i = 0; i < 6; i++) {
    const H = sizes[i], W = H * 0.55;
    const pts = []; for (let s = 0; s <= 24; s++) { const t = s / 24; const px = -8 + t * W; const py = H * Math.pow(Math.sin(Math.PI * t), 0.85); pts.push([px, py, i * 0.0]); }
    k.add(tube(pts, (r) => 0.42 * (H / 29) ** 0.4 * (0.9 + 0.2 * Math.sin(Math.PI * r)), { radial: 14, curve: true, samples: 64 }), 'white', { occ: false });
  }
  k.cyl(1.2, 0.3, 'concrete', { at: [-8, 0.15, 0], seg: 16 });
  k.pop();
}

// EQ Bridge: S-shaped deck (plan), crown ~6.3 m for the ferry channel; arches meet at the centre pier ("M")
export function bridgeCurve() {
  return new CatmullRomCurve3([V(-64, 0, 6), V(-46, 0, 17), V(-22, 0, 15), V(0, 0, 5), V(20, 0, -2), V(34, 0, 6), V(41, 0, 12)], false, 'centripetal');
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
  k.add(sweep(prof, side, { smooth: false, caps: true }), 'white');
  k.add(sweep([[-2.25, 0.12], [2.25, 0.12], [2.25, 0.05], [-2.25, 0.05]], side, { caps: true }), 'timber');
  // mesh balustrades (handrail tubes + posts)
  for (const edge of [left, right]) {
    k.add(tube(edge.map((p) => [p[0], p[1] + 1.15, p[2]]), 0.04, { radial: 8 }), 'steel', { occ: false });
    k.add(tube(edge.map((p) => [p[0], p[1] + 0.12, p[2]]), 0.03, { radial: 6 }), 'steel', { occ: false });
    for (let i = 0; i < edge.length; i += 2) k.bar([edge[i][0], edge[i][1] + 0.1, edge[i][2]], [edge[i][0], edge[i][1] + 1.15, edge[i][2]], 0.04, 0.04, 'steel');
  }
  // the two arches: A from the west landing to the centre pier leaning north, B from the centre pier to the island leaning south
  const P0 = C.getPointAt(0.04), Pm = C.getPointAt(0.5), P1 = C.getPointAt(0.95);
  const arch = (A, B, lean) => {
    const pts = []; const ax = new Vector3().subVectors(B, A); const L = ax.length(); ax.normalize();
    const n = new Vector3(ax.z, 0, -ax.x); // horizontal normal
    for (let s = 0; s <= 30; s++) {
      const t = s / 30, h = 22 * Math.sin(Math.PI * t);
      const p = A.clone().lerp(B, t); p.y = 0.3 + h * Math.cos(lean); p.addScaledVector(n, h * Math.sin(lean));
      pts.push([p.x, p.y, p.z]);
    }
    k.add(tube(pts, (r) => 0.55 - 0.18 * Math.sin(Math.PI * r), { radial: 12, curve: true, samples: 60 }), 'white', { occ: false });
    return { pts, A, B, n };
  };
  const a1 = arch(V(P0.x, 0, P0.z), V(Pm.x, 0, Pm.z), 0.38);
  const a2 = arch(V(Pm.x, 0, Pm.z), V(P1.x, 0, P1.z), -0.38);
  // cable hangers from each arch down to the nearest deck edge
  for (const a of [a1, a2]) {
    for (let s = 3; s <= 27; s += 2) {
      const ap = a.pts[s];
      let best = 0, bd = 1e9; for (let i = 0; i <= N; i++) { const e = (a === a1 ? left : right)[i]; const d = (e[0] - ap[0]) ** 2 + (e[2] - ap[2]) ** 2; if (d < bd) { bd = d; best = i; } }
      const e = (a === a1 ? left : right)[best];
      if (ap[1] > e[1] + 1.5) k.add(tube([[ap[0], ap[1], ap[2]], [e[0], e[1] + 0.2, e[2]]], 0.025, { radial: 4 }), 'steel', { occ: false });
    }
  }
  // concrete piers framing the navigation channel + centre pier
  for (const t of [0.4, 0.5, 0.6]) { const p = C.getPointAt(t); const y = bridgeDeckY(t); k.box(1.1, y + 2.4, 1.8, 'bridgeConc', { at: [p.x, (y - 2.4) / 2 - 0.7, p.z], r: 0.15 }); }
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
  const x = ISLAND.x + 2, z = ISLAND.z - 1, y = PROMENADE_Y;
  k.push(x, y, z, 0.1);
  k.box(15, 0.4, 10, 'limestone', { at: [0, 0.2, 0], r: 0.03 });
  k.box(13, 4.2, 8, 'render', { at: [0, 2.5, 0], r: 0.05 });
  for (let i = -2; i <= 2; i++) k.box(1.3, 2.0, 0.08, 'glassDark', { at: [i * 2.4, 2.2, 4.03], r: 0.01 });
  for (let i = -2; i <= 2; i++) k.box(1.3, 2.0, 0.08, 'glassDark', { at: [i * 2.4, 2.2, -4.03], r: 0.01 });
  // hipped terracotta roof
  k.add(lathe([[9.6, 0], [7.2, 1.4], [2.0, 3.0], [0, 3.1]], { seg: 4, phi0: Math.PI / 4, crease: 10 }).scale(1, 1, 0.72), 'tile', { at: [0, 4.6, 0] });
  // verandah posts
  for (let i = -3; i <= 3; i++) for (const s of [-1, 1]) k.cyl(0.09, 3.2, 'white', { at: [i * 2.1, 2.0, s * 5.0] });
  k.pop();
}

function eqJetty(k) {
  const [x, z] = PLACES.eqJetty;
  // floating pontoon (concrete) along the west shore, gangway, white shade canopy on steel columns
  k.push(x + 4.5, 0, z);
  k.box(5, 1.0, 46, 'concrete', { at: [0, 0.2, 0], r: 0.08 });
  k.box(4.6, 0.06, 45.6, 'timberDeck', { at: [0, 0.73, 0], r: 0.01 });
  for (let i = -3; i <= 3; i++) { k.cyl(0.35, 3.0, 'concrete', { at: [2.8, -0.8, i * 7] }); k.cyl(0.12, 3.2, 'steel', { at: [-2.0, 2.3, i * 7] }); k.cyl(0.12, 3.2, 'steel', { at: [2.0, 2.3, i * 7] }); }
  k.box(5.6, 0.25, 46, 'canopy', { at: [0, 3.95, 0], r: 0.1 });
  k.box(5.0, 1.0, 0.1, 'sign', { at: [0, 3.2, 23.1], r: 0.02 });
  // fenders on the berth face
  for (let i = -10; i <= 10; i++) k.box(0.3, 0.8, 0.6, 'rubber', { at: [2.6, 0.5, i * 2.1] });
  k.pop();
  // gangways to the promenade
  for (const dz of [-14, 10]) k.bar([x - 4, PROMENADE_Y + 0.05, z + dz], [x + 2.2, 0.75, z + dz], 2.0, 0.12, 'alu');
  // ticket shelter on the quay
  k.push(x - 8, PROMENADE_Y, z - 2);
  k.box(3.2, 2.6, 6, 'glass', { at: [0, 1.3, 0], r: 0.03 }); k.box(3.8, 0.2, 7, 'canopy', { at: [0, 2.75, 0], r: 0.05 });
  k.pop();
}

function barrackJetty(k) {
  const xs = [184, 203, 222, 241, 260];
  xs.forEach((x, i) => {
    const len = i === 0 || i === 4 ? 75 : 58, z0 = 34;
    k.push(x, 0, z0 + len / 2);
    k.box(5.5, 0.35, len, 'timberDeck', { at: [0, 1.65, 0], r: 0.02 });
    for (let j = -Math.floor(len / 6); j <= Math.floor(len / 6); j++) for (const s of [-2.4, 2.4]) k.cyl(0.22, 4.4, 'pile', { at: [s, -0.6, j * 3] });
    k.tube([[2.7, 2.7, -len / 2], [2.7, 2.7, len / 2]], 0.035, 'steel'); k.tube([[-2.7, 2.7, -len / 2], [-2.7, 2.7, len / 2]], 0.035, 'steel');
    for (let j = -len / 2; j <= len / 2; j += 2.5) for (const s of [-2.7, 2.7]) k.bar([s, 1.8, j], [s, 2.7, j], 0.05, 0.05, 'steel');
    // pier-head shelter
    k.box(5, 0.2, 7, 'canopy', { at: [0, 4.6, len / 2 - 5], r: 0.04 }); for (const s of [-2, 2]) for (const t of [-2.5, 2.5]) k.cyl(0.08, 2.8, 'steel', { at: [s, 3.2, len / 2 - 5 + t] });
    k.pop();
  });
  // jetty pavilions (cafes / ticket offices) at the base, pitched roofs
  for (const [x, z, w] of [[193, 22, 14], [231, 24, 16], [268, 22, 12]]) {
    k.push(x, PROMENADE_Y, z);
    k.box(w, 3.6, 8, 'render', { at: [0, 1.8, 0], r: 0.05 });
    k.box(w - 1, 2.4, 0.08, 'glassDark', { at: [0, 1.5, 4.03], r: 0.01 });
    k.add(lathe([[w * 0.72, 0], [0.4, 2.2], [0, 2.25]], { seg: 4, phi0: Math.PI / 4, crease: 10 }).scale(1, 1, 8 / w), 'roofMetal', { at: [0, 3.6, 0] });
    k.pop();
  }
}

function mendsJetty(k) {
  const [x, z] = PLACES.mendsJetty;
  const len = 50;
  k.push(x, 0, z - len / 2 + 2);
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

export function create(G, { mats }) {
  const k = new Kit();
  bellTower(k); spanda(k); const bridge = eqBridge(k); firstContact(k); kiosk(k); eqJetty(k); barrackJetty(k); mendsJetty(k);
  narrows(k); oldMill(k); warMemorial(k);
  // short bridge: island → Barrack Square
  k.bar([ISLAND.x + 15, PROMENADE_Y + 0.25, ISLAND.z + 4], [92, PROMENADE_Y + 0.25, 12], 4.5, 0.5, 'timberDeck');
  k.bakeAO({ radius: 0.6, samples: 8, strength: 0.6, ground: PROMENADE_Y - 0.05 });
  const group = k.build(mats);
  return { group, bridge };
}
