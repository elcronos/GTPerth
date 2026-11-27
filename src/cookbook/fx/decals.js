// Impact decals: bullet holes (concrete/plaster), metal holes (bare-metal rim, paint chips, glows hot for ~1 s)
// and scorch marks — one InstancedMesh, lit MeshStandardMaterial (so they react to sun/lamps/flashes), atlas
// drawn once on a canvas, ring buffer (oldest replaced), polygonOffset instead of geometry offsets.
// Flat static surfaces only (decals are quads, not projected meshes): keep size ≤ the surface you hit.
import {
  InstancedMesh, PlaneGeometry, MeshStandardMaterial, CanvasTexture, SRGBColorSpace, InstancedBufferAttribute,
  Matrix4, Quaternion, Vector3, DynamicDrawUsage,
} from 'three';
import { patch } from '../engine/patch.js';
import { hasAtmos } from './common.js';
import { patchAtmos } from '../lighting/atmos.js';

export const DECAL = { hole: [0, 4], metal: [4, 2], scorch: [6, 2] }; // [first tile, variants]
const COLS = 4, ROWS = 2;

function drawAtlas(tile = 256, seed = 11) {
  const c = document.createElement('canvas'); c.width = tile * COLS; c.height = tile * ROWS;
  const x = c.getContext('2d');
  let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const blob = (cx, cy, rad, jag, n = 28) => { x.beginPath(); for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2, rr = rad * (1 - jag + jag * 2 * r()); x[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); };
  for (let t = 0; t < COLS * ROWS; t++) {
    const ox = (t % COLS) * tile, oy = Math.floor(t / COLS) * tile, cx = ox + tile / 2, cy = oy + tile / 2, R = tile * 0.44;
    x.save(); x.beginPath(); x.rect(ox + 2, oy + 2, tile - 4, tile - 4); x.clip();
    if (t < 4) { // concrete hole: dust halo, chipped crater, cracks, dark core
      let g = x.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, 'rgba(150,145,135,0.55)'); g.addColorStop(0.5, 'rgba(165,160,150,0.25)'); g.addColorStop(1, 'rgba(165,160,150,0)');
      x.fillStyle = g; x.fillRect(ox, oy, tile, tile);
      blob(cx, cy, R * 0.42, 0.35); x.fillStyle = 'rgba(118,112,104,0.95)'; x.fill();
      blob(cx, cy, R * 0.3, 0.3); x.fillStyle = 'rgba(84,80,75,1)'; x.fill();
      x.strokeStyle = 'rgba(40,38,35,0.7)'; x.lineWidth = 1.5;
      for (let k = 0; k < 6; k++) { // radial cracks
        let a = r() * 6.28, px = cx + Math.cos(a) * R * 0.25, py = cy + Math.sin(a) * R * 0.25; x.beginPath(); x.moveTo(px, py);
        for (let m = 0; m < 5; m++) { a += (r() - 0.5) * 0.8; px += Math.cos(a) * R * 0.12; py += Math.sin(a) * R * 0.12; x.lineTo(px, py); }
        x.stroke();
      }
      g = x.createRadialGradient(cx, cy, 0, cx, cy, R * 0.16); g.addColorStop(0, 'rgba(8,7,6,1)'); g.addColorStop(0.7, 'rgba(20,18,16,1)'); g.addColorStop(1, 'rgba(40,37,34,0.0)');
      x.fillStyle = g; blob(cx, cy, R * 0.17, 0.2); x.fill();
    } else if (t < 6) { // metal hole: paint flakes off, bright torn rim, soot
      let g = x.createRadialGradient(cx, cy, 0, cx, cy, R * 0.9);
      g.addColorStop(0, 'rgba(30,26,22,0.6)'); g.addColorStop(1, 'rgba(30,26,22,0)'); x.fillStyle = g; x.fillRect(ox, oy, tile, tile);
      blob(cx, cy, R * 0.38, 0.4, 20); x.fillStyle = 'rgba(150,150,152,1)'; x.fill(); // bare steel
      blob(cx, cy, R * 0.24, 0.15); x.fillStyle = 'rgba(205,205,210,1)'; x.fill(); // polished rim
      g = x.createRadialGradient(cx, cy, 0, cx, cy, R * 0.16); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.8, 'rgba(10,10,10,1)'); g.addColorStop(1, 'rgba(60,60,60,1)');
      x.fillStyle = g; blob(cx, cy, R * 0.15, 0.12); x.fill();
    } else { // scorch: irregular soot blotches + radial streaks
      for (let k = 0; k < 40; k++) {
        const a = r() * 6.28, d = Math.pow(r(), 0.7) * R * 0.7, rr = R * (0.15 + r() * 0.3);
        const g = x.createRadialGradient(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr);
        g.addColorStop(0, `rgba(12,10,8,${0.22 + 0.2 * (1 - d / R)})`); g.addColorStop(1, 'rgba(12,10,8,0)');
        x.fillStyle = g; x.fillRect(ox, oy, tile, tile);
      }
      x.strokeStyle = 'rgba(15,12,10,0.25)'; x.lineCap = 'round';
      for (let k = 0; k < 50; k++) { const a = r() * 6.28, d0 = R * 0.3, d1 = R * (0.6 + r() * 0.4); x.lineWidth = 2 + r() * 6; x.beginPath(); x.moveTo(cx + Math.cos(a) * d0, cy + Math.sin(a) * d0); x.lineTo(cx + Math.cos(a) * d1, cy + Math.sin(a) * d1); x.stroke(); }
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, R * 0.35); g.addColorStop(0, 'rgba(5,4,3,0.95)'); g.addColorStop(1, 'rgba(5,4,3,0)');
      x.fillStyle = g; x.fillRect(ox, oy, tile, tile);
    }
    x.restore();
  }
  const tex = new CanvasTexture(c); tex.colorSpace = SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

const _m = new Matrix4(), _q = new Quaternion(), _q2 = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _n = new Vector3(), _Z = new Vector3(0, 0, 1);

export function createDecals(G, U, { cap = 256 } = {}) {
  const map = drawAtlas(G.quality.tier === 'low' ? 128 : 256);
  const mat = new MeshStandardMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, roughness: 0.85, metalness: 0.0 });
  mat.name = 'fx-decals';
  const iDecal = new InstancedBufferAttribute(new Float32Array(cap * 4), 4); iDecal.setUsage(DynamicDrawUsage);
  const geo = new PlaneGeometry(1, 1); geo.setAttribute('iDecal', iDecal);
  const mesh = new InstancedMesh(geo, mat, cap); mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 1;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage); mesh.receiveShadow = true;
  patch(mat, 'fxDecal', (sh) => {
    sh.uniforms.uFxTime = U.uFxTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 iDecal;\nuniform float uFxTime;\nvarying vec2 vDecalUv;\nvarying float vDecalHot;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
// canvas is flipY'd: tile row 0 (top of the canvas) sits at the top of uv space
vMapUv = vec2((mod(iDecal.x, ${COLS}.0) + uv.x) / ${COLS}.0, 1.0 - (floor(iDecal.x / ${COLS}.0) + 1.0 - uv.y) / ${ROWS}.0);
vDecalUv = uv;
vDecalHot = iDecal.w * exp(-max(uFxTime - iDecal.z, 0.0) * 1.6);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDecalUv;\nvarying float vDecalHot;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float dRr = length(vDecalUv - 0.5) * 2.0;
totalEmissiveRadiance += vec3(3.2, 0.95, 0.25) * vDecalHot * smoothstep(0.32, 0.1, dRr) * diffuseColor.a;`);
  });
  if (hasAtmos()) patchAtmos(mat);
  let head = 0, total = 0;
  return {
    mesh,
    // kind: 'hole' | 'metal' | 'scorch'; size in metres; normal must be unit length
    add(px, py, pz, nx, ny, nz, kind = 'hole', size = 0.09, roll = Math.random() * 6.283) {
      const [t0, nv] = DECAL[kind] || DECAL.hole;
      const i = head; head = (head + 1) % cap; total++;
      _n.set(nx, ny, nz); _q.setFromUnitVectors(_Z, _n); _q2.setFromAxisAngle(_Z, roll); _q.multiply(_q2);
      _p.set(px, py, pz).addScaledVector(_n, 0.002); _s.set(size, size, size);
      _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m);
      iDecal.array[i * 4] = t0 + ((Math.random() * nv) | 0); iDecal.array[i * 4 + 1] = 0;
      iDecal.array[i * 4 + 2] = U.uFxTime.value; iDecal.array[i * 4 + 3] = kind === 'metal' ? 1 : kind === 'scorch' ? 0.25 : 0;
      mesh.count = Math.min(total, cap);
      mesh.instanceMatrix.needsUpdate = true; iDecal.needsUpdate = true;
      return i;
    },
    clear() { head = 0; total = 0; mesh.count = 0; },
    get count() { return mesh.count; },
    dispose() { geo.dispose(); mat.dispose(); map.dispose(); },
  };
}
