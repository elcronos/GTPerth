// Extract per-building clusters (footprint hull, base, top) from the Sketchfab Perth GLB, in raw mesh-local units
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { writeFileSync } from 'fs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const out = [];
for (const n of doc.getRoot().listNodes()) {
  const m = n.getMesh(); if (!m || !/building/.test(m.getName())) continue;
  for (const p of m.listPrimitives()) {
    const P = p.getAttribute('POSITION').getArray(), I = p.getIndices()?.getArray(), nv = P.length / 3;
    // weld by rounded position, union-find over triangles
    const key = new Map(), id = new Int32Array(nv);
    for (let i = 0; i < nv; i++) { const k = Math.round(P[3 * i] * 20) + ',' + Math.round(P[3 * i + 1] * 20) + ',' + Math.round(P[3 * i + 2] * 20); let v = key.get(k); if (v === undefined) { v = key.size; key.set(k, v); } id[i] = v; }
    const par = new Int32Array(key.size).map((_, i) => i), f = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }, u = (a, b) => { a = f(a); b = f(b); if (a !== b) par[a] = b; };
    const tri = I || Array.from({ length: nv }, (_, i) => i);
    for (let t = 0; t < tri.length; t += 3) { u(id[tri[t]], id[tri[t + 1]]); u(id[tri[t]], id[tri[t + 2]]); }
    const cl = new Map();
    for (let i = 0; i < nv; i++) { const r = f(id[i]); let c = cl.get(r); if (!c) { c = { xs: [], ys: [], z0: 1e9, z1: -1e9 }; cl.set(r, c); } c.xs.push(P[3 * i]); c.ys.push(P[3 * i + 1]); c.z0 = Math.min(c.z0, P[3 * i + 2]); c.z1 = Math.max(c.z1, P[3 * i + 2]); }
    for (const c of cl.values()) {
      // 2D convex hull of the cluster
      const pts = [...new Set(c.xs.map((x, i) => x.toFixed(2) + ',' + c.ys[i].toFixed(2)))].map((s) => s.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], hi = [];
      for (const q of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
      for (const q of pts.slice().reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
      const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
      out.push({ hull: hull.map((q) => [+q[0].toFixed(2), +q[1].toFixed(2)]), z0: +c.z0.toFixed(2), z1: +c.z1.toFixed(2), n: c.xs.length });
    }
  }
}
writeFileSync(process.argv[3], JSON.stringify(out));
console.log('clusters', out.length, 'top heights', out.map((c) => c.z1 - c.z0).sort((a, b) => b - a).slice(0, 15).map((v) => +v.toFixed(1)));
