import { OSM_BUILDINGS } from '/home/claude/perth/src/osm_data.js';
import { readFileSync, writeFileSync } from 'fs';
const C = JSON.parse(readFileSync('/home/claude/skf/work/clusters.json'));
const cen = (r) => { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; };
const a = 94430 / 111319.49, c = -110950 / (111319.49 / Math.cos(-31.959 * Math.PI / 180));
const G = OSM_BUILDINGS.map((b) => ({ b, c: cen(b.p) }));
const M = C.map((m) => ({ m, c: cen(m.hull) }));
// grid of game centroids
const grid = new Map(), K = (x, z) => Math.floor(x / 20) + ',' + Math.floor(z / 20);
for (const g of G) { const k = K(...g.c); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(g); }
const near = (x, z, r) => { let best = null, bd = r; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const g of grid.get((Math.floor(x / 20) + i) + ',' + (Math.floor(z / 20) + j)) || []) { const d = Math.hypot(g.c[0] - x, g.c[1] - z); if (d < bd) { bd = d; best = g; } } return best; };
// translation from tall anchors first, then ICP on everything
let b = 0, d = 0;
{ const tall = M.filter((m) => m.m.z1 - m.m.z0 > 100); const off = []; for (const m of tall) { const g = OSM_BUILDINGS.filter((q) => Math.abs((q.h || 0) - (m.m.z1 - m.m.z0)) < 0.05); if (g.length === 1) { const gc = cen(g[0].p); off.push([gc[0] - a * m.c[0], gc[1] - c * m.c[1]]); } }
  const med = (v) => v.sort((p, q) => p - q)[v.length >> 1]; b = med(off.map((o) => o[0])); d = med(off.map((o) => o[1])); console.log('anchors', off.length, b.toFixed(1), d.toFixed(1)); }
for (let it = 0; it < 6; it++) {
  const dx = [], dz = []; for (const m of M) { const x = a * m.c[0] + b, z = c * m.c[1] + d, g = near(x, z, it < 2 ? 12 : 5); if (g) { dx.push(g.c[0] - x); dz.push(g.c[1] - z); } }
  const med = (v) => v.sort((p, q) => p - q)[v.length >> 1]; b += med(dx); d += med(dz);
  console.log('icp', it, 'matches', dx.length, 'shift', med(dx).toFixed(2), med(dz).toFixed(2));
}
writeFileSync('/home/claude/skf/work/xform.json', JSON.stringify({ a, b, c, d }));
console.log({ a, b, c, d });
