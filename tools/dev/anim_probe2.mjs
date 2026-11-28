import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { AnimationMixer, Vector3 } from 'three';
import { readFileSync } from 'node:fs';
globalThis.self = globalThis; globalThis.window = globalThis; globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const buf = readFileSync('/home/claude/perth/dist/assets/avatars/Female_Adult_12.glb');
const L = new GLTFLoader(); L.setMeshoptDecoder(MeshoptDecoder);
const g = await new Promise((res, rej) => L.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
const obj = g.scene; const bones = {}; obj.traverse((o) => { if (o.isBone || o.name.startsWith('Bip01')) bones[o.name] = o; });
for (const c0 of g.animations.filter((c) => /walk_neutral|run_neutral|run_fast|stroll/.test(c.name))) {
  const c = c0.clone();
  for (const t of c.tracks) if (t.name === 'Bip01.position') { const v = t.values, n = t.times.length, T0 = t.times[0], T1 = t.times[n - 1], D = [v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 1] - v[1], v[(n - 1) * 3 + 2] - v[2]];
    for (let j = 0; j < n; j++) { const u = (t.times[j] - T0) / (T1 - T0) - 0.5; for (let a = 0; a < 3; a++) v[j * 3 + a] -= D[a] * u; } }
  const m = new AnimationMixer(obj), a = m.clipAction(c); a.play();
  const N = 60, wl = [], wr = [], _v = new Vector3();
  for (let i = 0; i < N; i++) { m.setTime((i / N) * c.duration); obj.updateMatrixWorld(true); wl.push(bones.Bip01_L_Foot.getWorldPosition(new Vector3())); wr.push(bones.Bip01_R_Foot.getWorldPosition(new Vector3())); }
  const minY = Math.min(...wl.map((q) => q.y), ...wr.map((q) => q.y)), maxY = Math.max(...wl.map((q) => q.y));
  const dt = c.duration / N, vs = [];
  for (let i = 0; i < N; i++) { const j = (i + 1) % N; for (const F of [wl, wr]) if (F[i].y < minY + 0.035 && F[j].y < minY + 0.035) vs.push(Math.hypot(F[j].x - F[i].x, F[j].z - F[i].z) / dt); }
  vs.sort((p, q) => p - q);
  console.log(c.name, 'minY', minY.toFixed(3), 'maxY', maxY.toFixed(3), 'n', vs.length, 'median', vs[Math.floor(vs.length / 2)]?.toFixed(2), 'z range L', Math.min(...wl.map(q=>q.z)).toFixed(2), Math.max(...wl.map(q=>q.z)).toFixed(2));
  a.stop(); m.uncacheRoot(obj);
}
