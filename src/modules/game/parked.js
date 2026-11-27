// Static kerbside parking for the CBD: rows of parked cars built once as InstancedMeshes (one per car part per
// kind/colour bucket), so a full street of cars costs a few dozen draw calls and no physics. Desktop tiers only.
import { Group, InstancedMesh, Matrix4, Quaternion, Vector3, Euler } from 'three';
import { buildCarModel, CAR_COLORS } from './vehicles.js';
import { ROADS, heightAt, isLand } from '../../map.js';

const BOX = [-450, 650, -900, -150];   // x0, x1, z0, z1
const KINDS = ['sedan', 'hatch', 'suv', 'ute'];

export function createParkedRows(G, M, { step = 7.5, fill = 0.55, seed = 11 } = {}) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const slots = [];
  const ends = []; for (const r of ROADS) if (r.pts.length) { ends.push(r.pts[0], r.pts[r.pts.length - 1]); }
  for (const r of ROADS) {
    if (!['p', 's', 'm'].includes(r.cls) || r.traffic === false) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 20) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      for (let d = 10; d < L - 10; d += step) {
        const cx = ax + tx * d, cz = az + tz * d;
        if (cx < BOX[0] || cx > BOX[1] || cz < BOX[2] || cz > BOX[3]) continue;
        if (ends.some((e) => Math.hypot(e[0] - cx, e[1] - cz) < 14)) continue;   // keep junctions clear
        for (const side of r.oneway ? [1] : [1, -1]) {
          if (rnd() > fill) continue;
          const off = (r.w / 2 - 1.15) * side, x = cx + tz * off, z = cz - tx * off;
          if (!isLand(x, z)) continue;
          slots.push([x, z, Math.atan2(tz, tx) + (side < 0 ? Math.PI : 0)]);
        }
      }
    }
  }
  // buckets: kind x 3 colours
  const group = new Group(); group.name = 'parked-rows';
  const cols = [CAR_COLORS[0], CAR_COLORS[3 % CAR_COLORS.length], CAR_COLORS[5 % CAR_COLORS.length]];
  const buckets = new Map();
  // low-poly kit cars (no scanned mesh): a whole CBD of parked cars stays a few hundred k triangles
  for (const sl of slots) { const k = KINDS[Math.floor(rnd() * KINDS.length)] + '|' + Math.floor(rnd() * cols.length); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(sl); }
  const T = new Matrix4(), q = new Quaternion(), e = new Euler(0, 0, 0, 'YXZ'), p = new Vector3(), one = new Vector3(1, 1, 1), tmp = new Matrix4();
  for (const [k, list] of buckets) {
    const [kind, ci] = k.split('|');
    const m = buildCarModel(kind, cols[+ci], M, true); m.group.updateMatrixWorld(true);
    m.group.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const im = new InstancedMesh(o.geometry, o.material, list.length);
      list.forEach(([x, z, h], i) => {
        e.set(0, -h, 0); q.setFromEuler(e); p.set(x, heightAt(x, z) + 0.05, z);
        T.compose(p, q, one); tmp.multiplyMatrices(T, o.matrixWorld); im.setMatrixAt(i, tmp);
      });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = true; im.receiveShadow = true;
      im.userData.noReflect = true; group.add(im);
    });
  }
  G.scene.add(group);
  group.userData.noReflect = true;
  return { group, count: slots.length, slots };
}
