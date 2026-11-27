// Tripo-generated vehicle meshes (one textured PBR mesh each). Normalised on load: bow/nose to +x, wheels/keel at
// y = 0, scaled to the real vehicle's length/width/height, so they drop into the procedural rigs (Car, Boat).
import { Box3, Vector3, Group, Color, Matrix4, CanvasTexture, SRGBColorSpace } from 'three';
import { patch, after } from '../../cookbook/engine/patch.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MODELS } from '../../assets/models.js';

// front: the model's nose direction as generated; dims: target L (x), H (y), W (z) in metres
const SPEC = {
  camry: { front: '+z', L: 4.88, W: 1.84, H: 1.45, tint: true },
  hatch: { front: '+z', L: 4.37, W: 1.79, H: 1.46 },
  suv: { front: '+x', L: 4.55, W: 1.84, H: 1.68 },
  ute: { front: '+x', L: 5.33, W: 1.86, H: 1.82, tint: true },
  police: { front: '+x', L: 4.95, W: 1.86, H: 1.58 },
  bus: { front: '+z', L: 12.2, W: 2.5, H: 3.2 },
  ferry: { front: '-z', L: 23.7, W: 7.6, H: 5.6, y0: 0.15 },
};
const ROT = { '+x': 0, '+z': Math.PI / 2, '-z': -Math.PI / 2, '-x': Math.PI };
const b64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
export const LIB = {};

export async function loadModels() {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  for (const n of Object.keys(MODELS)) {
    const S = SPEC[n]; if (!S) continue;
    try {
      const g = await loader.parseAsync(b64(MODELS[n]), '');
      const inner = g.scene; inner.rotation.y = ROT[S.front]; inner.updateMatrixWorld(true);
      const b = new Box3().setFromObject(inner), s = b.getSize(new Vector3()), c = b.getCenter(new Vector3());
      const wrap = new Group(); wrap.add(inner);
      inner.position.set(-c.x, -b.min.y, -c.z);
      wrap.scale.set(S.L / s.x, S.H / s.y, S.W / s.z);
      const root = new Group(); root.add(wrap); root.position.y = S.y0 || 0;
      inner.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; const m = o.material; m.envMapIntensity = 1.0; m.userData.noWeather = true; } });
      if (n === 'police') root.updateMatrixWorld(true), inner.traverse((o) => { if (o.isMesh) policeLivery(o, root, S); });
      LIB[n] = { root, S };
    } catch (e) { console.warn('model', n, e); }
    await new Promise((r) => setTimeout(r, 0));
  }
  return LIB;
}

// a per-instance clone; tint (white/silver bodies only) multiplies the baked albedo toward a paint colour
export function modelInstance(n, tint) {
  const L = LIB[n]; if (!L) return null;
  const o = L.root.clone(true);
  if (tint != null && L.S.tint) {
    const c = new Color(tint).lerp(new Color(1, 1, 1), 0.12);
    o.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.copy(c); } });
  }
  return o;
}

// The generated police texture spells the side lettering wrong; project a clean WA Police band (white ground,
// blue/white chequers, POLICE) onto the body sides in car space, so it wraps the doors' real curvature.
function policeLivery(mesh, root, S) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160; const g = c.getContext('2d');
  g.fillStyle = '#f3f4f5'; g.fillRect(0, 0, 1024, 160);
  const q = 26; for (let i = 0; i < 40; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#f3f4f5' : '#1438a8'; g.fillRect(i * q, 92 + j * q, q, q); }
  g.fillStyle = '#1438a8'; g.font = 'bold 70px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('POLICE', 540, 50);
  const tex = new CanvasTexture(c); tex.colorSpace = SRGBColorSpace;
  const toCar = new Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  patch(mesh.material, 'livery', (sh) => {
    sh.uniforms.uLiv = { value: tex }; sh.uniforms.uToCar = { value: toCar }; sh.uniforms.uDim = { value: new Vector3(S.L, S.H, S.W) };
    sh.vertexShader = 'uniform mat4 uToCar;\nvarying vec3 vCar;\nvarying vec3 vCarN;\n' + after(sh.vertexShader, '#include <begin_vertex>', 'vCar = (uToCar * vec4(position, 1.0)).xyz; vCarN = normalize(mat3(uToCar) * normal);');
    sh.fragmentShader = 'uniform sampler2D uLiv;\nuniform vec3 uDim;\nvarying vec3 vCar;\nvarying vec3 vCarN;\n' + after(sh.fragmentShader, '#include <map_fragment>', `
      { float yb = vCar.y / uDim.y; float xb = vCar.x / uDim.x;
        float side = abs(normalize(vCarN).z);
        float w = smoothstep(0.55, 0.75, side) * step(0.355, yb) * step(yb, 0.62) * smoothstep(0.43, 0.40, abs(xb));
        if (w > 0.0) { float u = vCarN.z > 0.0 ? xb + 0.5 : 0.5 - xb; float v = (yb - 0.355) / 0.265;
          vec3 lc = texture2D(uLiv, vec2(u, v)).rgb; lc = pow(lc, vec3(2.2)); diffuseColor.rgb = mix(diffuseColor.rgb, lc, w); } }`);
  });
}
