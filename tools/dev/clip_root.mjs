import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { readFileSync } from 'node:fs';
import { Quaternion, Euler } from 'three';
globalThis.self = globalThis; globalThis.window = globalThis; globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const buf = readFileSync(process.argv[2]);
const L = new GLTFLoader(); L.setMeshoptDecoder(MeshoptDecoder);
const g = await new Promise((res, rej) => L.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
for (const c of g.animations) {
  const t = c.tracks.find((t) => t.name === 'Bip01.position'), q = c.tracks.find((t) => t.name === 'Bip01.quaternion');
  const n = t.times.length, v = t.values, out = [];
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 8))) out.push(`${t.times[i].toFixed(2)}:${(v[i*3]).toFixed(0)},${(v[i*3+2]).toFixed(0)}`);
  const qa = new Quaternion().fromArray(q.values, 0), qb = new Quaternion().fromArray(q.values, (q.times.length - 1) * 4);
  const ea = new Euler().setFromQuaternion(qa, 'YXZ'), eb = new Euler().setFromQuaternion(qb, 'YXZ');
  console.log(c.name, c.duration.toFixed(2), out.join(' '), 'yaw', (ea.y * 57.3).toFixed(0), '->', (eb.y * 57.3).toFixed(0));
}
