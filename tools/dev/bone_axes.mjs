import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Vector3, Quaternion } from 'three';
import { readFileSync } from 'node:fs';
globalThis.self = globalThis; globalThis.window = globalThis; globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const buf = readFileSync('/home/claude/perth/dist/assets/avatars/Female_Adult_12.glb');
const L = new GLTFLoader(); L.setMeshoptDecoder(MeshoptDecoder);
const g = await new Promise((res, rej) => L.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
g.scene.updateMatrixWorld(true);
for (const n of ['Bip01_L_Thigh', 'Bip01_L_Calf', 'Bip01_R_Calf', 'Bip01_L_Foot']) { const b = g.scene.getObjectByName(n); const q = b.getWorldQuaternion(new Quaternion());
  console.log(n, 'x->', new Vector3(1,0,0).applyQuaternion(q).toArray().map(v=>v.toFixed(2)), 'y->', new Vector3(0,1,0).applyQuaternion(q).toArray().map(v=>v.toFixed(2)), 'z->', new Vector3(0,0,1).applyQuaternion(q).toArray().map(v=>v.toFixed(2))); }
