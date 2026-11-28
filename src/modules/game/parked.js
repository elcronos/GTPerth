// Static kerbside parking for the CBD: rows of parked cars built once as InstancedMeshes (one per car part per
// kind/colour bucket), so a full street of cars costs a few dozen draw calls and no physics. Desktop tiers only.
import { Group, InstancedMesh, Matrix4, Quaternion, Vector3, Euler } from 'three';
import { buildCarModel, CAR_COLORS } from './vehicles.js';
import { ROADS, heightAt, isLand } from '../../map.js';

const BOX = [-450, 650, -900, -150];   // x0, x1, z0, z1
const KINDS = ['sedan', 'hatch', 'suv'];

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
  const cols = [CAR_COLORS[0], CAR_COLORS[1], CAR_COLORS[2], CAR_COLORS[3], CAR_COLORS[4], CAR_COLORS[5]];
  const buckets = new Map();
  // low-poly kit cars (no scanned mesh): a whole CBD of parked cars stays a few hundred k triangles
  for (const sl of slots) { const k = KINDS[Math.floor(rnd() * KINDS.length)] + '|' + Math.floor(rnd() * cols.length); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(sl); }
  const T = new Matrix4(), q = new Quaternion(), e = new Euler(0, 0, 0, 'YXZ'), p = new Vector3(), one = new Vector3(1, 1, 1), tmp = new Matrix4(), ZERO = new Matrix4().makeScale(0, 0, 0);
  // parked cars sit with their lamps off (the shared traffic lamp materials glow)
  const off = new Map(); const dark = (m) => { if (m !== M.light && m !== M.tail) return m; if (!off.has(m)) { const c = m.clone(); c.emissiveIntensity = 0; off.set(m, c); } return off.get(m); };
  const slotT = (x, z, h) => { e.set(0, -h, 0); q.setFromEuler(e); p.set(x, heightAt(x, z) + 0.05, z); return new Matrix4().compose(p, q, one); };
  const instParts = (model, n) => { const parts = []; model.group.updateMatrixWorld(true);
    model.group.traverse((o) => { if (!o.isMesh || !o.geometry) return; const im = new InstancedMesh(o.geometry, dark(o.material), n);
      im.castShadow = true; im.receiveShadow = true; im.userData.noReflect = true; im.frustumCulled = false; group.add(im); parts.push({ im, local: o.matrixWorld.clone() }); });
    return parts; };
  // two LODs: low-poly kit cars for every slot; the scanned mesh swaps in for the cars nearest the camera
  const NEAR = 14, NEAR_R = 55, all = [], BL = [];
  for (const [k, list] of buckets) {
    const [kind, ci] = k.split('|');
    const kit = instParts(buildCarModel(kind, cols[+ci], M, true), list.length);
    const hiModel = buildCarModel(kind, cols[+ci], M, false);
    const hi = hiModel.wheels.length ? null : instParts(hiModel, Math.min(NEAR, list.length));   // null when no scanned mesh is loaded
    const B = { kit, hi, list, Ts: list.map(([x, z, h]) => slotT(x, z, h)), near: new Set() }; BL.push(B);
    B.Ts.forEach((Ti, i) => { for (const pt of kit) pt.im.setMatrixAt(i, tmp.multiplyMatrices(Ti, pt.local)); all.push([B, i]); });
    for (const pt of kit) { pt.im.instanceMatrix.needsUpdate = true; pt.im.computeBoundingSphere(); pt.im.frustumCulled = true; }
    if (hi) for (const pt of hi) pt.im.count = 0;
  }
  let acc = 1;
  const update = (dt, cam, force = false) => {
    if (((acc += dt) < 0.6 && !force) || !cam) return; acc = 0;
    const near = all.filter(([B]) => B.hi).map(([B, i]) => [B, i, Math.hypot(B.list[i][0] - cam.x, B.list[i][1] - cam.z)]).filter((r) => r[2] < NEAR_R).sort((u, v) => u[2] - v[2]).slice(0, NEAR);
    const next = new Map(BL.map((B) => [B, new Set()]));
    for (const [B, i] of near) next.get(B).add(i);
    for (const B of BL) {
      const nx = next.get(B);
      for (const i of B.near) if (!nx.has(i)) for (const pt of B.kit) { pt.im.setMatrixAt(i, tmp.multiplyMatrices(B.Ts[i], pt.local)); pt.im.instanceMatrix.needsUpdate = true; }
      for (const i of nx) if (!B.near.has(i)) for (const pt of B.kit) { pt.im.setMatrixAt(i, ZERO); pt.im.instanceMatrix.needsUpdate = true; }
      B.near = nx;
      if (B.hi) { let j = 0; for (const i of nx) { for (const pt of B.hi) pt.im.setMatrixAt(j, tmp.multiplyMatrices(B.Ts[i], pt.local)); j++; }
        for (const pt of B.hi) { pt.im.count = j; pt.im.instanceMatrix.needsUpdate = true; } }
    }
  };
  G.scene.add(group);
  group.userData.noReflect = true;
  const info = () => ({ buckets: BL.length, hi: BL.filter((B) => B.hi).length, near: BL.reduce((a, B) => a + B.near.size, 0) });
  return { group, count: slots.length, slots, update, info };
}
