// roof-height raster (0.5 m cells, max z of near-horizontal faces) of the Sketchfab buildings, in game coordinates
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readFileSync, writeFileSync } from 'fs';
const X = JSON.parse(readFileSync('/home/claude/skf/work/xform.json'));
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read('/home/claude/skf/perth.glb');
const box = [-2300, -2600, 6000, 5100], S = 1.0, W = Math.ceil(box[2] / S), H = Math.ceil(box[3] / S), R = new Float32Array(W * H);
let tris = 0;
for (const n of doc.getRoot().listNodes()) {
  const m = n.getMesh(); if (!m || !/building/.test(m.getName())) continue;
  for (const p of m.listPrimitives()) {
    const P = p.getAttribute('POSITION').getArray(), I = p.getIndices().getArray();
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]].map((i) => [X.a * P[3 * i] + X.b, X.c * P[3 * i + 1] + X.d, P[3 * i + 2]]);
      const z0 = v[0][2]; if (Math.abs(v[1][2] - z0) > 0.05 || Math.abs(v[2][2] - z0) > 0.05 || z0 < 0.5) continue;   // flat roofs only
      tris++;
      const xs = v.map((q) => q[0]), zs = v.map((q) => q[1]);
      const i0 = Math.max(0, Math.floor((Math.min(...xs) - box[0]) / S)), i1 = Math.min(W - 1, Math.ceil((Math.max(...xs) - box[0]) / S));
      const j0 = Math.max(0, Math.floor((Math.min(...zs) - box[1]) / S)), j1 = Math.min(H - 1, Math.ceil((Math.max(...zs) - box[1]) / S));
      const [A, B, C] = v, d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
      if (Math.abs(d) < 1e-9) continue;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = box[0] + (i + 0.5) * S, z = box[1] + (j + 0.5) * S;
        const l1 = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (z - C[1])) / d, l2 = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (z - C[1])) / d;
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) { const k = i + j * W; if (z0 > R[k]) R[k] = z0; }
      }
    }
  }
}
writeFileSync('/home/claude/skf/work/roof.bin', Buffer.from(R.buffer));
writeFileSync('/home/claude/skf/work/roof.json', JSON.stringify({ box, S, W, H }));
console.log('roof tris', tris, 'grid', W, H);
