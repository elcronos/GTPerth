/*! Portions adapted from MIT-licensed code, Copyright (c) 2026 Maksymilian Dendura. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
// Naive surface nets + helpers for density volumes (D > 0 = solid, D < 0 = air).
// surfaceNets() adapted from MIT-licensed code, Copyright (c) 2026 Maksymilian Dendura (see THIRD_PARTY_NOTICES.md): one vertex per sign-changing cell at the mean
// of its edge crossings, quads emitted with a 2-slice ring buffer. Output is grid-space (voxel units).
// Load-time only. A 160×48×160 grid meshes in ~60 ms in V8.

export function surfaceNets(D, nx, ny, nz) {
  let pos = new Float32Array(1 << 16), nv = 0;
  let idx = new Uint32Array(1 << 17), ni = 0;
  const sl = nx * ny;
  let cur = new Int32Array(sl), prev = new Int32Array(sl);
  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      let i0 = nx * (y + ny * z);
      for (let x = 0; x < nx - 1; x++, i0++) {
        const d0 = D[i0], d1 = D[i0 + 1], d2 = D[i0 + nx], d3 = D[i0 + nx + 1];
        const d4 = D[i0 + sl], d5 = D[i0 + sl + 1], d6 = D[i0 + sl + nx], d7 = D[i0 + sl + nx + 1];
        const m = (d0 > 0) | ((d1 > 0) << 1) | ((d2 > 0) << 2) | ((d3 > 0) << 3) | ((d4 > 0) << 4) | ((d5 > 0) << 5) | ((d6 > 0) << 6) | ((d7 > 0) << 7);
        if (m === 0 || m === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0, t;
        // 12 cube edges: accumulate the linear zero crossing of each sign-changing edge
        if ((d0 > 0) !== (d1 > 0)) { t = d0 / (d0 - d1); sx += t; n++; }
        if ((d2 > 0) !== (d3 > 0)) { t = d2 / (d2 - d3); sx += t; sy += 1; n++; }
        if ((d4 > 0) !== (d5 > 0)) { t = d4 / (d4 - d5); sx += t; sz += 1; n++; }
        if ((d6 > 0) !== (d7 > 0)) { t = d6 / (d6 - d7); sx += t; sy += 1; sz += 1; n++; }
        if ((d0 > 0) !== (d2 > 0)) { t = d0 / (d0 - d2); sy += t; n++; }
        if ((d1 > 0) !== (d3 > 0)) { t = d1 / (d1 - d3); sy += t; sx += 1; n++; }
        if ((d4 > 0) !== (d6 > 0)) { t = d4 / (d4 - d6); sy += t; sz += 1; n++; }
        if ((d5 > 0) !== (d7 > 0)) { t = d5 / (d5 - d7); sy += t; sx += 1; sz += 1; n++; }
        if ((d0 > 0) !== (d4 > 0)) { t = d0 / (d0 - d4); sz += t; n++; }
        if ((d1 > 0) !== (d5 > 0)) { t = d1 / (d1 - d5); sz += t; sx += 1; n++; }
        if ((d2 > 0) !== (d6 > 0)) { t = d2 / (d2 - d6); sz += t; sy += 1; n++; }
        if ((d3 > 0) !== (d7 > 0)) { t = d3 / (d3 - d7); sz += t; sx += 1; sy += 1; n++; }
        if (nv * 3 + 3 > pos.length) { const p2 = new Float32Array(pos.length * 2); p2.set(pos); pos = p2; }
        const vi = nv++;
        pos[vi * 3] = x + sx / n; pos[vi * 3 + 1] = y + sy / n; pos[vi * 3 + 2] = z + sz / n;
        const ci = x + nx * y;
        cur[ci] = vi;
        if (ni + 18 > idx.length) { const i2 = new Uint32Array(idx.length * 2); i2.set(idx); idx = i2; }
        const s0 = d0 > 0;
        let a, b, c, d;
        // one quad per sign-changing edge leaving the cell's min corner (x, y, z directions)
        if ((d1 > 0) !== s0 && y > 0 && z > 0) {
          a = vi; b = cur[ci - nx]; c = prev[ci - nx]; d = prev[ci];
          if (s0) { idx[ni++] = a; idx[ni++] = b; idx[ni++] = c; idx[ni++] = a; idx[ni++] = c; idx[ni++] = d; }
          else { idx[ni++] = a; idx[ni++] = c; idx[ni++] = b; idx[ni++] = a; idx[ni++] = d; idx[ni++] = c; }
        }
        if ((d2 > 0) !== s0 && x > 0 && z > 0) {
          a = vi; b = prev[ci]; c = prev[ci - 1]; d = cur[ci - 1];
          if (s0) { idx[ni++] = a; idx[ni++] = b; idx[ni++] = c; idx[ni++] = a; idx[ni++] = c; idx[ni++] = d; }
          else { idx[ni++] = a; idx[ni++] = c; idx[ni++] = b; idx[ni++] = a; idx[ni++] = d; idx[ni++] = c; }
        }
        if ((d4 > 0) !== s0 && x > 0 && y > 0) {
          a = vi; b = cur[ci - 1]; c = cur[ci - 1 - nx]; d = cur[ci - nx];
          if (s0) { idx[ni++] = a; idx[ni++] = b; idx[ni++] = c; idx[ni++] = a; idx[ni++] = c; idx[ni++] = d; }
          else { idx[ni++] = a; idx[ni++] = c; idx[ni++] = b; idx[ni++] = a; idx[ni++] = d; idx[ni++] = c; }
        }
      }
    }
    const tmp = cur; cur = prev; prev = tmp;
  }
  return { pos: pos.subarray(0, nv * 3), idx: idx.subarray(0, ni), nv, ni };
}

// Trilinear sampler over the grid (grid-space coordinates, clamped).
export function sampler3(D, nx, ny, nz) {
  return (x, y, z) => {
    x = Math.max(0, Math.min(nx - 1.001, x)); y = Math.max(0, Math.min(ny - 1.001, y)); z = Math.max(0, Math.min(nz - 1.001, z));
    const ix = x | 0, iy = y | 0, iz = z | 0, fx = x - ix, fy = y - iy, fz = z - iz, sl = nx * ny, i = ix + nx * (iy + ny * iz);
    const a = D[i] + (D[i + 1] - D[i]) * fx, b = D[i + nx] + (D[i + nx + 1] - D[i + nx]) * fx;
    const c = D[i + sl] + (D[i + sl + 1] - D[i + sl]) * fx, d = D[i + sl + nx] + (D[i + sl + nx + 1] - D[i + sl + nx]) * fx;
    const e = a + (b - a) * fy, f = c + (d - c) * fy;
    return e + (f - e) * fz;
  };
}

// Remove floating specks: solid voxels not 6-connected to the bottom layer become air (sign flipped,
// magnitude kept so the mesher still interpolates). The fix for "small boxes floating in the water".
export function floodFillSolid(D, nx, ny, nz) {
  const N = nx * ny * nz, seen = new Uint8Array(N), stack = new Int32Array(N);
  let sp = 0;
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) { const i = x + nx * ny * z; if (D[i] > 0) { seen[i] = 1; stack[sp++] = i; } }
  const sl = nx * ny;
  while (sp > 0) {
    const i = stack[--sp], x = i % nx, y = ((i / nx) | 0) % ny, z = (i / sl) | 0;
    const push = (j) => { if (!seen[j] && D[j] > 0) { seen[j] = 1; stack[sp++] = j; } };
    if (x > 0) push(i - 1); if (x < nx - 1) push(i + 1);
    if (y > 0) push(i - nx); if (y < ny - 1) push(i + nx);
    if (z > 0) push(i - sl); if (z < nz - 1) push(i + sl);
  }
  let removed = 0;
  for (let i = 0; i < N; i++) if (D[i] > 0 && !seen[i]) { D[i] = -D[i] - 1e-3; removed++; }
  return removed;
}
