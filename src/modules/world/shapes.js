// Landmark-specific surfaces the generic kit doesn't cover: box-section sweeps oriented by a fixed plane
// normal (bridge arches), and curved tapering "sail" blades (Bell Tower copper sails).
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Vector3 } from 'three';

function finish(P, N, UV, I) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new Float32BufferAttribute(UV, 2));
  g.setAttribute('color', new Float32BufferAttribute(new Array(P.length).fill(1), 3));
  g.setIndex(new Uint32BufferAttribute(I, 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// Rectangular hollow-section member along pts (array of Vector3), section axes: `side` (fixed unit vector,
// e.g. the arch plane normal) and in-plane radial = T × side. w(t) across `side`, d(t) in-plane. Flat-shaded.
export function boxSweep(pts, side, w, d) {
  const P = [], N = [], UV = [], I = [];
  const n = pts.length, T = [], R = [], L = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const t = new Vector3().subVectors(b, a).normalize(); T.push(t);
    R.push(new Vector3().crossVectors(t, side).normalize());
    if (i) L.push(L[i - 1] + pts[i].distanceTo(pts[i - 1]));
  }
  const total = L[n - 1];
  const faces = [[1, 1, 1, -1], [1, -1, -1, -1], [-1, -1, -1, 1], [-1, 1, 1, 1]]; // corner pairs (side sign, radial sign)
  const fn = [[1, 0], [0, -1], [-1, 0], [0, 1]];                                     // face normal (side, radial)
  for (let f = 0; f < 4; f++) {
    const base = P.length / 3;
    for (let i = 0; i < n; i++) {
      const t = L[i] / total, hw = w(t) / 2, hd = d(t) / 2, p = pts[i];
      const nx = side.x * fn[f][0] + R[i].x * fn[f][1], ny = side.y * fn[f][0] + R[i].y * fn[f][1], nz = side.z * fn[f][0] + R[i].z * fn[f][1];
      for (let c = 0; c < 2; c++) {
        const ss = faces[f][c * 2] * hw, rr = faces[f][c * 2 + 1] * hd;
        P.push(p.x + side.x * ss + R[i].x * rr, p.y + side.y * ss + R[i].y * rr, p.z + side.z * ss + R[i].z * rr);
        N.push(nx, ny, nz); UV.push(c * (f % 2 ? d(t) : w(t)), L[i]);
      }
    }
    for (let i = 0; i < n - 1; i++) { const a = base + i * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  return fixWinding(finish(P, N, UV, I));
}

// make every triangle face along its stored vertex normal (so the sweep's winding never matters)
function fixWinding(g) {
  const p = g.attributes.position.array, nn = g.attributes.normal.array, I = g.index.array;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), fnv = new Vector3();
  for (let i = 0; i < I.length; i += 3) {
    a.fromArray(p, I[i] * 3); b.fromArray(p, I[i + 1] * 3); c.fromArray(p, I[i + 2] * 3);
    fnv.subVectors(b, a).cross(c.sub(a));
    if (fnv.x * nn[I[i] * 3] + fnv.y * nn[I[i] * 3 + 1] + fnv.z * nn[I[i] * 3 + 2] < 0) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
  }
  return g;
}

// A curved sail blade wrapped around the y axis: radius r(h), centre azimuth c(h), half-width (radians) hw(h),
// for h in [0, H]; `thick` metres. Azimuth convention matches kit lathe (x = r sin φ, z = r cos φ).
// Closed solid (outer skin, inner skin, edges) with smooth normals across the skins.
export function sailBlade({ H, r, c, hw, thick = 0.25, rows = 40, cols = 18 }) {
  const P = [], N = [], UV = [], I = [];
  const at = (h, u, off) => { const ph = c(h) + (u * 2 - 1) * hw(h), rr = r(h) + off; return [Math.sin(ph) * rr, h, Math.cos(ph) * rr, ph]; };
  const skin = (off, sgn) => {
    const base = P.length / 3;
    for (let j = 0; j <= rows; j++) {
      const h = (j / rows) * H;
      for (let i = 0; i <= cols; i++) {
        const u = i / cols, [x, y, z, ph] = at(h, u, off);
        // normal ≈ radial tilted by the profile slope dr/dh
        const dh = H / rows * 0.5, dr = (r(Math.min(H, h + dh)) - r(Math.max(0, h - dh))) / (2 * dh);
        const nx = Math.sin(ph), nz = Math.cos(ph), ny = -dr, l = Math.hypot(nx, ny, nz);
        P.push(x, y, z); N.push((sgn * nx) / l, (sgn * ny) / l, (sgn * nz) / l); UV.push(u * hw(h) * 2 * r(h), h);
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = base + j * (cols + 1) + i, b = a + cols + 1; I.push(a, b, a + 1, a + 1, b, b + 1); }
  };
  skin(0, 1); skin(-thick, -1);
  // edge strips (both long edges)
  for (const u of [0, 1]) {
    const base = P.length / 3;
    for (let j = 0; j <= rows; j++) {
      const h = (j / rows) * H; const o = at(h, u, 0), ii = at(h, u, -thick);
      const tn = c(h) + (u ? 1 : -1) * (hw(h) + Math.PI / 2);
      for (const q of [o, ii]) { P.push(q[0], q[1], q[2]); N.push(Math.sin(tn), 0, Math.cos(tn)); UV.push(0, h); }
    }
    for (let j = 0; j < rows; j++) { const a = base + j * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  return fixWinding(finish(P, N, UV, I));
}
