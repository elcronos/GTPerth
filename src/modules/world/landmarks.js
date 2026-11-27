// Elizabeth Quay and Perth Water landmarks, modelled from published dimensions:
//  Bell Tower (Swan Bells, 82.5 m: concrete bell chamber in 30 m copper sails + glass spire of spokes)
//  Spanda (29 m, six nested white carbon-fibre arches)    Elizabeth Quay Bridge (110 m S-deck, two leaning 22 m arches)
//  First Contact (5 m cast aluminium bird-in-a-boat)      Florence Hummerston Kiosk (1927, on the island)
//  Elizabeth Quay Jetty (Transperth ferry terminal)       Barrack Street Jetty (piers 1-5)
//  Mends Street Jetty (South Perth)                       The Narrows Bridge (3 parallel decks)
//  Old Mill (1835 tower mill)                             State War Memorial obelisk (Kings Park)
import { CatmullRomCurve3, Vector3, CanvasTexture, SRGBColorSpace, Mesh, PlaneGeometry, MeshBasicMaterial } from 'three';
import { Kit, lathe, tube, roundedBox, sweep } from '../../cookbook/geo/kit.js';
import { heightAt, PLACES, ISLAND, NARROWS, PROMENADE_Y } from '../../map.js';

const V = (x, y, z) => new Vector3(x, y, z);

function bellTower(k) {
  // From photos: a teal glass needle (square section, ribbed, banded by steel "spokes") rising from the plaza;
  // its lower 38 m is wrapped by two great copper shells meeting in an ogive point, open front and back so the
  // glass shows through a vertical slot. Copper is warm red-brown; a silver needle tops the glass at 82.5 m.
  const [x, z] = PLACES.bellTower, y = heightAt(x, z);
  k.push(x, y, z, 0.0);
  k.cyl(17, 0.6, 'limestone', { at: [0, 0.3, 0], seg: 48 });
  k.cyl(14.5, 0.2, 'water', { at: [0, 0.68, 0], seg: 48 });
  const y0 = 0.6, top = 82.5 - y0;
  const R = (h) => 6.2 * Math.pow(Math.max(0, 1 - h / 72), 1.05) + 0.25;
  const prof = []; for (let i = 0; i <= 18; i++) { const h = (i / 18) * 72; prof.push([R(h), h]); }
  prof.unshift([0, 0]); prof.push([0, 72]);
  k.add(lathe(prof, { seg: 8, phi0: Math.PI / 8, crease: 20 }), 'teal', { at: [0, y0, 0], occ: false });
  for (let h = 2; h < 70; h += 2.6) { const r = R(h); k.add(lathe([[r + 0.02, h], [r + 0.16, h + 0.1], [r + 0.02, h + 0.2]], { seg: 8, phi0: Math.PI / 8 }), 'steel', { at: [0, y0, 0], occ: false }); }
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i / 8) * Math.PI * 2; const pts = []; for (let h = 0; h <= 72; h += 6) { const r = R(h) + 0.05; pts.push([Math.cos(a) * r, y0 + h, Math.sin(a) * r]); } k.add(tube(pts, 0.06, { radial: 4 }), 'steel', { occ: false }); }
  k.add(lathe([[0.35, 0], [0.12, 8], [0.02, top - 72]], { seg: 8 }), 'steel', { at: [0, y0 + 72, 0] });
  // copper shells (east + west), ogive profile, each spanning 120°, with thickness and a rolled edge
  const cp = [[8.0, 0], [8.7, 5], [8.6, 11], [8.0, 17], [6.9, 23], [5.3, 29], [3.4, 34], [1.3, 38]];
  for (const az of [Math.PI / 2, -Math.PI / 2]) {
    k.add(lathe(cp, { seg: 18, phi0: az - 0.92, phiLen: 1.84, crease: 80 }), 'copper', { at: [0, y0, 0] });
    k.add(lathe(cp.map(([r, h]) => [Math.max(0.2, r - 0.45), h]).reverse(), { seg: 18, phi0: az - 0.92, phiLen: 1.84, crease: 80 }), 'copper', { at: [0, y0, 0] });
    for (const ed of [az - 0.92, az + 0.92]) { const pts = cp.map(([r, h]) => [Math.sin(ed) * (r - 0.22), y0 + h, Math.cos(ed) * (r - 0.22)]); k.add(tube(pts, 0.24, { radial: 6, curve: true, samples: 24 }), 'copper', { occ: false }); }
  }
  // glazed entrance pavilion at the foot
  k.box(10, 4, 4, 'glassLight', { at: [0, y0 + 2, 8.5], r: 0.05 });
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
  k.add(sweep(prof, side, { smooth: false, caps: true }), 'deckSteel');
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
      const t = s / 30, h = 19.5 * Math.pow(Math.sin(Math.PI * t), 0.82);
      const p = A.clone().lerp(B, t); p.y = 2.6 + h * Math.cos(lean); p.addScaledVector(n, h * Math.sin(lean));
      pts.push([p.x, p.y, p.z]);
    }
    k.add(tube(pts, (r) => 0.42 - 0.12 * Math.sin(Math.PI * r), { radial: 12, curve: true, samples: 60 }), 'white', { occ: false });
    return { pts, A, B, n };
  };
  const a1 = arch(V(P0.x, 0, P0.z), V(Pm.x, 0, Pm.z), 0.13);
  const a2 = arch(V(Pm.x, 0, Pm.z), V(P1.x, 0, P1.z), -0.13);
  // cable hangers from each arch down to the nearest deck edge
  for (const a of [a1, a2]) {
    for (let s = 2; s <= 28; s += 1) {
      const ap = a.pts[s];
      let best = 0, bd = 1e9; for (let i = 0; i <= N; i++) { const e = (a === a1 ? left : right)[i]; const d = (e[0] - ap[0]) ** 2 + (e[2] - ap[2]) ** 2; if (d < bd) { bd = d; best = i; } }
      const e = (a === a1 ? left : right)[best];
      if (ap[1] > e[1] + 1.5) k.add(tube([[ap[0], ap[1], ap[2]], [e[0], e[1] + 0.2, e[2]]], 0.025, { radial: 4 }), 'steel', { occ: false });
    }
  }
  // concrete piers framing the navigation channel + centre pier
  for (const t of [0.39, 0.61]) { const p = C.getPointAt(t); const y = bridgeDeckY(t); k.box(1.1, y + 2.4, 1.8, 'bridgeConc', { at: [p.x, (y - 2.4) / 2 - 0.7, p.z], r: 0.15 }); }
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

// Brookfield Place: the open steel exoskeleton crown (~30 m) above the 204 m roof, with the red BHP sign
function brookfieldCrown(k) {
  const x = -96, z = -494, y = heightAt(x, z) + 204, W = 50, D = 24, H = 30;
  k.push(x, y, z, 0);
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
  const x = -96, z = -494, y = heightAt(x, z) + 204 + 24;
  for (const s of [-1, 1]) { const p = new Mesh(new PlaneGeometry(12, 4.5), m); p.position.set(x, y, z + s * 12.6); p.rotation.y = s > 0 ? 0 : Math.PI; out.push(p); }
  return out;
}

export function create(G, { mats }) {
  const k = new Kit();
  bellTower(k); spanda(k); const bridge = eqBridge(k); firstContact(k); kiosk(k); eqJetty(k); barrackJetty(k); mendsJetty(k);
  narrows(k); oldMill(k); warMemorial(k); brookfieldCrown(k);
  // short bridge: island → Barrack Square
  k.bar([ISLAND.x + 15, PROMENADE_Y + 0.25, ISLAND.z + 4], [92, PROMENADE_Y + 0.25, 12], 4.5, 0.5, 'timberDeck');
  k.bakeAO({ radius: 0.6, samples: 8, strength: 0.6, ground: PROMENADE_Y - 0.05 });
  const group = k.build(mats);
  for (const s of bhpSign()) group.add(s);
  return { group, bridge };
}
