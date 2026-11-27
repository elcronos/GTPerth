// Roads: asphalt strips draped on the terrain with procedural Australian line marking (left-hand traffic: broken
// white lane lines, double centre lines on multi-lane roads, no markings through junctions), concrete kerbs and
// zebra crossings. Also exposes the lane graph used by traffic AI.
import { BufferGeometry, Float32BufferAttribute, Mesh } from 'three';
import { ROADS, heightAt } from '../../map.js';
import { patch } from '../../cookbook/engine/patch.js';

const STEP = 3;
function densify(pts, step = STEP) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function distToRoad(x, z, r) {
  let best = 1e9; const P = r.pts;
  for (let i = 0; i < P.length - 1; i++) {
    const ax = P[i][0], az = P[i][1], vx = P[i + 1][0] - ax, vz = P[i + 1][1] - az, l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
    best = Math.min(best, Math.hypot(ax + vx * t - x, az + vz * t - z));
  }
  return best;
}

export const CROSSINGS = [[125, -60, 0], [60, -198, 1], [-36, -215, 0], [125, -230, 0], [-193, 1345, 1], [-100, -232, 1]];

export function markRoadMaterial(mat) {
  patch(mat, 'road-marks', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRoad;\nvarying vec4 vRoad;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = aRoad;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vRoad; float rmPaint;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  // vRoad: x = along (m), y = across (m, 0 = centre), z = width, w = lanes + 10 * junctionFade
  float along = vRoad.x, ac = vRoad.y, W = vRoad.z;
  float lanes = mod(vRoad.w, 10.0), jf = clamp(floor(vRoad.w / 10.0) / 9.0, 0.0, 1.0);
  float aaw = fwidth(ac) * 0.75 + 0.002;
  float line = 0.0;
  float dash = step(fract(along / 12.0), 0.25);
  if (lanes < 2.5) {
    line = max(line, (1.0 - smoothstep(0.05, 0.05 + aaw, abs(ac))) * dash);
  } else {
    line = max(line, 1.0 - smoothstep(0.05, 0.05 + aaw, abs(abs(ac) - 0.16)));       // double centre line
    float lw = (W * 0.5 - 0.4) / (lanes * 0.5);
    for (int k = 1; k < 3; k++) { float off = lw * float(k); if (off < W * 0.5 - 0.6) line = max(line, (1.0 - smoothstep(0.05, 0.05 + aaw, abs(abs(ac) - off))) * step(fract(along / 9.0), 0.33)); }
  }
  line = max(line, (1.0 - smoothstep(0.05, 0.05 + aaw, abs(abs(ac) - (W * 0.5 - 0.35)))) * 0.85);   // edge line
  // zebra crossing flag in vRoad (along encoded crossing distance in uv.y slot is not available): handled by separate decals
  line *= jf;
  float wear = 0.75 + 0.25 * fract(sin(dot(floor(vec2(along * 2.0, ac * 6.0)), vec2(12.9898, 78.233))) * 43758.5453);
  rmPaint = line * wear;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.77, 0.72), rmPaint);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, rmPaint);');
  });
  return mat;
}

export function create(G, { mats }) {
  const lanes = [];
  // segment hash (20 m cells) for the junction-fade query: distance to any OTHER road's asphalt edge
  const CELL = 20, hash = new Map(); const key = (i, j) => i * 100003 + j;
  ROADS.forEach((o, oi) => { for (let i = 0; i < o.pts.length - 1; i++) {
    const a = o.pts[i], b = o.pts[i + 1], pad = o.w / 2 + 10;
    const i0 = Math.floor((Math.min(a[0], b[0]) - pad) / CELL), i1 = Math.floor((Math.max(a[0], b[0]) + pad) / CELL), j0 = Math.floor((Math.min(a[1], b[1]) - pad) / CELL), j1 = Math.floor((Math.max(a[1], b[1]) + pad) / CELL);
    for (let ii = i0; ii <= i1; ii++) for (let jj = j0; jj <= j1; jj++) { const k = key(ii, jj); let L = hash.get(k); if (!L) hash.set(k, (L = [])); L.push(oi, i); } } });
  const jdist = (x, z, ri) => {
    const L = hash.get(key(Math.floor(x / CELL), Math.floor(z / CELL))); if (!L) return 1e9;
    let best = 1e9;
    for (let n = 0; n < L.length; n += 2) { const oi = L[n]; if (oi === ri) continue; const o = ROADS[oi], i = L[n + 1];
      const ax = o.pts[i][0], az = o.pts[i][1], vx = o.pts[i + 1][0] - ax, vz = o.pts[i + 1][1] - az, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      best = Math.min(best, Math.hypot(ax + vx * t - x, az + vz * t - z) - o.w / 2); }
    return best;
  };
  // everything merges into ONE road mesh + ONE kerb mesh (≈1000 OSM streets)
  const pos = [], uv = [], road = [], idx = [], kpos = [], kuv = [], kidx = [];
  const LIFT = { t: 0.1, p: 0.09, s: 0.08, m: 0.065 };
  ROADS.forEach((r, ri) => {
    const pts = densify(r.pts);
    const v0 = pos.length / 3, k0 = kpos.length / 3;
    let u = 0; const hw = r.w / 2, lift = (LIFT[r.cls] ?? 0.06) + (ri % 7) * 0.0015;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const nx = tz, nz = -tx;
      if (i > 0) u += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      const jd = jdist(p[0], p[1], ri);
      const jf = Math.round(9 * Math.min(1, Math.max(0, (jd - 2) / 6)));
      const L = [p[0] + nx * hw, p[1] + nz * hw], R = [p[0] - nx * hw, p[1] - nz * hw];
      pos.push(L[0], heightAt(L[0], L[1]) + lift, L[1], R[0], heightAt(R[0], R[1]) + lift, R[1]);
      uv.push(u, -hw, u, hw);
      road.push(u, hw, r.w, r.lanes + 10 * jf, u, -hw, r.w, r.lanes + 10 * jf);
      if (i > 0) { const k = v0 + (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      for (const side of [1, -1]) {
        const ex = p[0] + nx * hw * side, ez = p[1] + nz * hw * side, ox = nx * 0.3 * side, oz = nz * 0.3 * side;
        const y0 = heightAt(ex, ez) + lift, y1 = y0 + 0.13;
        kpos.push(ex, y0 - 0.1, ez, ex, y1, ez, ex + ox, y1, ez + oz);
        kuv.push(u, 0, u, 0.13, u, 0.43);
      }
      if (i > 0 && jf > 3) {
        const k = k0 + (i - 1) * 6;
        for (const o of [0, 3]) {
          const a0 = k + o, b0 = k + 6 + o;
          if (o === 0) kidx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1, a0 + 1, b0 + 1, a0 + 2, a0 + 2, b0 + 1, b0 + 2);
          else kidx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0, a0 + 1, a0 + 2, b0 + 1, a0 + 2, b0 + 2, b0 + 1);
        }
      }
    }
    if (r.traffic === false) return;
    const nl = Math.max(1, Math.floor(r.lanes / 2)), lw = (r.w * 0.5 - 0.5) / nl;
    for (let li = 0; li < nl; li++) {
      const off = lw * (li + 0.5);
      lanes.push({ road: r.name, off, pts: offsetLine(r.pts, off) });
      lanes.push({ road: r.name, off, pts: offsetLine([...r.pts].reverse(), off) });
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('aRoad', new Float32BufferAttribute(road, 4)); g.setIndex(idx); g.computeVertexNormals();
  const m = new Mesh(g, mats.road); m.name = 'roads'; m.receiveShadow = true; m.renderOrder = -1;
  const kg = new BufferGeometry();
  kg.setAttribute('position', new Float32BufferAttribute(kpos, 3)); kg.setAttribute('uv', new Float32BufferAttribute(kuv, 2)); kg.setIndex(kidx); kg.computeVertexNormals();
  const km = new Mesh(kg, mats.kerb); km.name = 'kerbs'; km.receiveShadow = true;
  return { meshes: [m, km], lanes };
}
// offset to the left of travel (x east, z south: left of direction (tx,tz) is (tz,-tx))
function offsetLine(P, off) {
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out.push([P[i][0] + tz * off, P[i][1] - tx * off]);
  }
  return out;
}
