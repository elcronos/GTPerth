// 2D collision world: building footprints (polygons), props (circles), plus dynamic bodies registered per frame.
// circleVsWorld(x, z, r) pushes a circle out of every static collider and returns the contact normal.
import { isLand, heightAt } from '../../map.js';

export function createCollision(colliders) {
  const CELL = 24, grid = new Map();
  const key = (i, j) => i * 100003 + j;
  const items = [];
  for (const c of colliders) {
    let it;
    if (c.circle) { const [x, z, r] = c.circle; it = { kind: 'c', x, z, r, minx: x - r, maxx: x + r, minz: z - r, maxz: z + r }; }
    else { const P = c.pts || c.poly; let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9; for (const p of P) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); } it = { kind: 'p', P, minx, maxx, minz, maxz, name: c.name, h: c.h }; }
    const id = items.push(it) - 1;
    for (let i = Math.floor(it.minx / CELL); i <= Math.floor(it.maxx / CELL); i++) for (let j = Math.floor(it.minz / CELL); j <= Math.floor(it.maxz / CELL); j++) {
      const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id);
    }
  }
  const out = { x: 0, z: 0, nx: 0, nz: 0, hit: false, depth: 0 };
  const seen = new Set();
  function circleVsWorld(x, z, r) {
    out.x = x; out.z = z; out.hit = false; out.nx = 0; out.nz = 0; out.depth = 0;
    seen.clear();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
      const l = grid.get(key(i, j)); if (!l) continue;
      for (const id of l) {
        if (seen.has(id)) continue; seen.add(id);
        const it = items[id];
        if (out.x + r < it.minx || out.x - r > it.maxx || out.z + r < it.minz || out.z - r > it.maxz) continue;
        if (it.kind === 'c') {
          const dx = out.x - it.x, dz = out.z - it.z, d = Math.hypot(dx, dz), m = r + it.r;
          if (d < m && d > 1e-6) { const nx = dx / d, nz = dz / d; out.x = it.x + nx * m; out.z = it.z + nz * m; out.nx = nx; out.nz = nz; out.hit = true; out.depth = Math.max(out.depth, m - d); }
        } else {
          // polygon: inside test + closest edge
          const P = it.P; let inside = false, best = 1e9, bx = 0, bz = 0;
          for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
            const xa = P[a][0], za = P[a][1], xb = P[b][0], zb = P[b][1];
            if ((za > out.z) !== (zb > out.z) && out.x < ((xb - xa) * (out.z - za)) / (zb - za) + xa) inside = !inside;
            const vx = xb - xa, vz = zb - za, l2 = vx * vx + vz * vz || 1;
            const t = Math.max(0, Math.min(1, ((out.x - xa) * vx + (out.z - za) * vz) / l2));
            const cx = xa + vx * t, cz = za + vz * t, d = Math.hypot(out.x - cx, out.z - cz);
            if (d < best) { best = d; bx = cx; bz = cz; }
          }
          if (inside || best < r) {
            let nx = out.x - bx, nz = out.z - bz; const d = Math.hypot(nx, nz) || 1e-6; nx /= d; nz /= d;
            if (inside) { nx = -nx; nz = -nz; }
            out.x = bx + nx * r; out.z = bz + nz * r; out.nx = nx; out.nz = nz; out.hit = true; out.depth = Math.max(out.depth, inside ? best + r : r - best);
          }
        }
      }
    }
    return out;
  }
  // segment test (line of sight / camera): returns fraction t of the first hit along a→b (1 = clear)
  function segment(ax, az, bx, bz, maxH = 1e9, y = 0) {
    let tMin = 1;
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 2);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const l = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))); if (!l) continue;
      for (const id of l) {
        const it = items[id]; if (it.kind !== 'p' || (it.h && y > it.h + heightAt(x, z))) continue;
        if (x < it.minx || x > it.maxx || z < it.minz || z > it.maxz) continue;
        let inside = false; const P = it.P;
        for (let a = 0, b = P.length - 1; a < P.length; b = a++) { const xa = P[a][0], za = P[a][1], xb = P[b][0], zb = P[b][1]; if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) inside = !inside; }
        if (inside) return Math.max(0, t - 1 / steps);
      }
    }
    return tMin;
  }
  return { circleVsWorld, segment, items, isLand, heightAt };
}
