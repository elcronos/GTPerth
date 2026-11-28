import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { readFileSync } from 'node:fs';
globalThis.self = globalThis; globalThis.window = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close(){} });
const buf = readFileSync('/home/claude/perth/dist/assets/avatars/Female_Adult_12.glb');
const L = new GLTFLoader(); L.setMeshoptDecoder(MeshoptDecoder);
const g = await new Promise((res, rej) => L.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
for (const c of g.animations) {
  const tr = c.tracks.filter(t => t.name.endsWith('.position'));
  for (const t of tr) { const v = t.values, n = t.times.length; console.log(c.name, t.name, 'dur', c.duration.toFixed(2), 'first', [v[0],v[1],v[2]].map(x=>x.toFixed(1)), 'last', [v[(n-1)*3],v[(n-1)*3+1],v[(n-1)*3+2]].map(x=>x.toFixed(1)), 'mid', [v[Math.floor(n/2)*3],v[Math.floor(n/2)*3+1],v[Math.floor(n/2)*3+2]].map(x=>x.toFixed(1))); }
}
let pel; g.scene.traverse(o=>{ if(o.name==='Bip01') console.log('Bip01 parent', o.parent.name, o.parent.scale.toArray(), o.parent.rotation.toArray().slice(0,3)); });
