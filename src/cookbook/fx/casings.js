// Ejected shell casings: one InstancedMesh of a lathed brass case (real dimensions: 5.56 NATO 45 mm,
// 9 mm 19 mm, 12 ga hull scaled), rigid-body-lite physics (gravity, spin, bounce with restitution + friction,
// settle lying on its side), ring buffer. onBounce(x,y,z,speed,kind) lets the game play a tinkle.
import { InstancedMesh, LatheGeometry, Vector2, MeshStandardMaterial, Matrix4, Quaternion, Vector3, DynamicDrawUsage, Color } from 'three';
import { hasAtmos } from './common.js';
import { patchAtmos } from '../lighting/atmos.js';

// rifle profile (m): base rim, extractor groove, body, shoulder, neck
const PROFILE = [[0, 0], [0.00473, 0], [0.00473, 0.0011], [0.0040, 0.0013], [0.0040, 0.0028], [0.00477, 0.0031], [0.00477, 0.0355], [0.00315, 0.0392], [0.00315, 0.0447], [0.0029, 0.0447]];
export const CASING_KINDS = {
  rifle: { scale: 1, color: [0.78, 0.55, 0.26], radius: 0.0048 },
  pistol: { scale: 0.43, color: [0.8, 0.58, 0.3], radius: 0.0048 * 0.95 },
  shotgun: { scale: 1.5, color: [0.55, 0.06, 0.04], radius: 0.0105 },
};

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _a = new Vector3(), _h = new Vector3(), _Y = new Vector3(0, 1, 0), _c = new Color();

export function createCasings(G, { cap = 48, onBounce = null } = {}) {
  const geo = new LatheGeometry(PROFILE.map(([r, y]) => new Vector2(r, y - 0.022)), 14);
  const mat = new MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.32 });
  mat.name = 'fx-casings';
  if (hasAtmos()) patchAtmos(mat);
  const mesh = new InstancedMesh(geo, mat, cap); mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage); mesh.frustumCulled = false;
  const S = new Float32Array(cap * 16); // pos3 vel3 quat4 ang3 scale radius state(0 flying,1 resting) kind
  const kinds = Object.keys(CASING_KINDS);
  let head = 0, total = 0, groundY = 0, groundAt = null;
  for (let i = 0; i < cap; i++) mesh.setColorAt(i, _c.set(0xffffff));

  function write(i) {
    const o = i * 16; _p.set(S[o], S[o + 1], S[o + 2]); _q.set(S[o + 6], S[o + 7], S[o + 8], S[o + 9]); const k = S[o + 13]; _s.set(k, k, k);
    _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m);
  }
  return {
    mesh,
    setGround(y, fn = null) { groundY = y; groundAt = fn; },
    // eject at (x,y,z) with velocity (vx,vy,vz) in m/s; typical rifle: 3 m/s right, 1.5 up, a bit back
    eject(x, y, z, vx, vy, vz, kind = 'rifle') {
      const K = CASING_KINDS[kind] || CASING_KINDS.rifle, i = head; head = (head + 1) % cap; total++;
      const o = i * 16;
      S[o] = x; S[o + 1] = y; S[o + 2] = z; S[o + 3] = vx; S[o + 4] = vy; S[o + 5] = vz;
      _q.setFromAxisAngle(_a.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(), Math.PI / 2 + (Math.random() - 0.5) * 0.6);
      S[o + 6] = _q.x; S[o + 7] = _q.y; S[o + 8] = _q.z; S[o + 9] = _q.w;
      S[o + 10] = (Math.random() - 0.5) * 30; S[o + 11] = (Math.random() - 0.5) * 30; S[o + 12] = 15 + Math.random() * 25;
      S[o + 13] = K.scale; S[o + 14] = 0; S[o + 15] = kinds.indexOf(kind);
      mesh.setColorAt(i, _c.setRGB(K.color[0], K.color[1], K.color[2]));
      mesh.instanceColor.needsUpdate = true;
      mesh.count = Math.min(total, cap);
      write(i);
      return i;
    },
    update(dt) {
      let dirty = false;
      for (let i = 0; i < mesh.count; i++) {
        const o = i * 16;
        if (S[o + 14] > 0.5) continue; // resting
        dirty = true;
        S[o + 4] -= 9.81 * dt;
        S[o] += S[o + 3] * dt; S[o + 1] += S[o + 4] * dt; S[o + 2] += S[o + 5] * dt;
        // integrate orientation: q += 0.5 * (w ⊗ q) * dt
        const wx = S[o + 10], wy = S[o + 11], wz = S[o + 12];
        let qx = S[o + 6], qy = S[o + 7], qz = S[o + 8], qw = S[o + 9];
        const h = 0.5 * dt;
        const nx = qx + h * (wx * qw + wy * qz - wz * qy), ny = qy + h * (wy * qw + wz * qx - wx * qz);
        const nz = qz + h * (wz * qw + wx * qy - wy * qx), nw = qw - h * (wx * qx + wy * qy + wz * qz);
        const L = Math.hypot(nx, ny, nz, nw); qx = nx / L; qy = ny / L; qz = nz / L; qw = nw / L;
        S[o + 6] = qx; S[o + 7] = qy; S[o + 8] = qz; S[o + 9] = qw;
        const K = CASING_KINDS[kinds[S[o + 15]]] || CASING_KINDS.rifle;
        const g = (groundAt ? groundAt(S[o], S[o + 2]) : groundY) + K.radius;
        if (S[o + 1] < g && S[o + 4] < 0) {
          const sp = -S[o + 4];
          S[o + 1] = g; S[o + 4] = sp * 0.32; S[o + 3] *= 0.55; S[o + 5] *= 0.55;
          S[o + 10] *= 0.5; S[o + 11] *= 0.5; S[o + 12] = S[o + 12] * 0.5 + (Math.random() - 0.5) * 10;
          if (onBounce && sp > 0.4) onBounce(S[o], S[o + 1], S[o + 2], sp, kinds[S[o + 15]]);
          if (sp < 0.7) {
            // settle lying on its side, keeping the current heading
            _q.set(qx, qy, qz, qw); _a.copy(_Y).applyQuaternion(_q); _h.set(_a.x, 0, _a.z);
            if (_h.lengthSq() < 1e-6) _h.set(1, 0, 0);
            _q.setFromUnitVectors(_Y, _h.normalize());
            S[o + 6] = _q.x; S[o + 7] = _q.y; S[o + 8] = _q.z; S[o + 9] = _q.w; S[o + 14] = 1;
          }
        }
        write(i);
      }
      if (dirty) mesh.instanceMatrix.needsUpdate = true;
    },
    clear() { head = 0; total = 0; mesh.count = 0; },
    get count() { return mesh.count; },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
