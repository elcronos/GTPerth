import { osmBuildings } from '/home/claude/perth/src/modules/world/towers.js';
import { OSM_BUILDINGS } from '/home/claude/perth/src/osm_data.js';
import { rngFrom } from '/home/claude/perth/src/cookbook/geo/noise.js';
import { heightAt } from '/home/claude/perth/src/map.js';
import { readFileSync, writeFileSync } from 'fs';
const G = JSON.parse(readFileSync('/home/claude/skf/work/roof.json')), R = new Float32Array(readFileSync('/home/claude/skf/work/roof.bin').buffer.slice(0));
const { box, S, W, H } = G, GR = new Float32Array(W * H), NM = new Int32Array(W * H).fill(-1);
const inPoly = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
const B = osmBuildings(rngFrom(4207));
B.forEach((b, bi) => { const t = b.tiers[0], pts = t.pts.map(([x, z]) => [x + b.x, z + b.z]), top = t.h + b.base + 0.3 - heightAt(b.x, b.z);
  let xa = 1e9, xb = -1e9, za = 1e9, zb = -1e9; for (const [x, z] of pts) { xa = Math.min(xa, x); xb = Math.max(xb, x); za = Math.min(za, z); zb = Math.max(zb, z); }
  for (let j = Math.max(0, Math.floor((za - box[1]) / S)); j <= Math.min(H - 1, Math.ceil((zb - box[1]) / S)); j++) for (let i = Math.max(0, Math.floor((xa - box[0]) / S)); i <= Math.min(W - 1, Math.ceil((xb - box[0]) / S)); i++) {
    const x = box[0] + (i + 0.5) * S, z = box[1] + (j + 0.5) * S; if (inPoly(x, z, pts)) { const k = i + j * W; if (top > GR[k]) { GR[k] = top; NM[k] = bi; } } } });
// regions where the two disagree by > 12 m over > 150 m² (model default 20 m roofs ignored as unknown)
const tag = new Uint8Array(W * H), regions = [];
const bad = (k) => { const m = R[k], g = GR[k]; if (m > 0 && Math.abs(m - 20) < 0.01) return 0; if (m - g > 12) return 1; if (g - m > 12 && g > 25) return 2; return 0; };
for (let k0 = 0; k0 < W * H; k0++) { const t = bad(k0); if (!t || tag[k0]) continue;
  const st = [k0]; tag[k0] = 1; const cells = [];
  while (st.length) { const k = st.pop(); cells.push(k); const i = k % W, j = (k / W) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const kk = ii + jj * W; if (!tag[kk] && bad(kk) === t) { tag[kk] = 1; st.push(kk); } } }
  if (cells.length * S * S < 150) continue;
  let x = 0, z = 0, mm = 0, gg = 0; const names = new Map(); for (const k of cells) { x += box[0] + ((k % W) + 0.5) * S; z += box[1] + (((k / W) | 0) + 0.5) * S; mm = Math.max(mm, R[k]); gg = Math.max(gg, GR[k]); if (NM[k] >= 0) names.set(B[NM[k]].name, 1); }
  regions.push({ kind: t === 1 ? 'model taller' : 'game taller', x: +(x / cells.length).toFixed(0), z: +(z / cells.length).toFixed(0), area: cells.length * S * S, model: +mm.toFixed(0), game: +gg.toFixed(0), names: [...names.keys()].filter((n) => n !== 'osm').slice(0, 3) });
}
regions.sort((a, b) => Math.abs(b.model - b.game) * Math.sqrt(b.area) - Math.abs(a.model - a.game) * Math.sqrt(a.area));
writeFileSync('/home/claude/skf/work/regions.json', JSON.stringify(regions, null, 1));
writeFileSync("/home/claude/skf/work/game.bin", Buffer.from(GR.buffer));
for (const kind of ['model taller', 'game taller']) { const L = regions.filter((r) => r.kind === kind); console.log(`\n${kind}: ${L.length}`); for (const r of L.slice(0, 28)) console.log(`  (${r.x},${r.z}) area ${r.area} model ${r.model} game ${r.game} ${r.names.join(', ')}`); }
