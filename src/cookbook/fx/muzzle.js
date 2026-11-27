// Muzzle flash, physically plausible (NOT a giant star sprite — see references/defect-catalogue.md):
//  - three intersecting additive quads around the barrel axis form a short flame cone (rifle ~0.16 m long,
//    pistol ~0.08 m, shotgun ~0.22 m wide), with a hot core, a Mach-disc bulge at ~35 % length and fbm breakup;
//  - one small disc facing down the axis (what you see looking into the muzzle), with 3 faint prongs (flash hider);
//  - cone quads fade when seen edge-on, the disc fades when seen side-on → no cardboard look from any angle;
//  - lives 2-3 frames (~45 ms); per-shot random length/roll/seed; paired with a light-pool pulse (lights.js).
import { BufferGeometry, BufferAttribute, ShaderMaterial } from 'three';
import { Pool, PREMUL, FX_GLSL, fogChunk, fogUniforms } from './common.js';

const VS = /*glsl*/`
attribute vec4 iPos;
attribute vec4 iDir;
attribute vec4 iSeed;
varying vec2 vQ;
varying float vPart;
varying float vFace;
varying vec4 vSeed;
varying float vAge;
varying vec3 vW;
void main() {
  vec3 f = normalize(iDir.xyz);
  vec3 up = abs(f.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 r = normalize(cross(up, f));
  vec3 u = cross(f, r);
  float cr = cos(iSeed.z);
  float sr = sin(iSeed.z);
  vec3 r2 = r * cr + u * sr;
  vec3 u2 = -r * sr + u * cr;
  float part = position.z;
  float L = iPos.w * iSeed.w;
  float W = iPos.w * 0.5;
  vec3 w;
  vec3 n;
  if (part < 2.5) {
    float a = part * 1.0472;
    vec3 side = r2 * cos(a) + u2 * sin(a);
    w = iPos.xyz + f * (position.y * L) + side * (position.x * W * (0.45 + 0.55 * position.y));
    n = cross(f, side);
  } else {
    float D = iPos.w * 0.32;
    w = iPos.xyz + f * (0.02 * L) + (r2 * position.x + u2 * (position.y * 2.0 - 1.0)) * D;
    n = f;
  }
  vec3 V = normalize(cameraPosition - w);
  vFace = abs(dot(normalize(n), V));
  vQ = vec2(position.x, position.y);
  vPart = part;
  vSeed = iSeed;
  vAge = iDir.w;
  vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const FS = /*glsl*/`
varying vec2 vQ;
varying float vPart;
varying float vFace;
varying vec4 vSeed;
varying float vAge;
varying vec3 vW;
${FX_GLSL}
__FOG__
void main() {
  float s = vSeed.x * 37.0;
  float I;
  float core;
  if (vPart < 2.5) {
    float u = vQ.y;
    float v = vQ.x;
    // flame width profile: narrow at the crown, bulge (Mach disc) then taper
    float bulge = exp(-pow((u - 0.33) / 0.16, 2.0));
    float wp = 0.3 + 0.5 * sqrt(u) * (1.0 - u * 0.5) + 0.25 * bulge;
    float across = exp(-pow(v / wp, 2.0) * 2.2) * (1.0 - v * v) * (1.0 - v * v); // window: zero at the quad edge
    float len = pow(1.0 - u, 1.35) * smoothstep(0.0, 0.05, u);
    // breakup: lengthwise flame tongues (high v-frequency) + blotches; squared for contrast
    float n = fxNoise(vec2(u * 6.0 - s, v * 7.0 + s + vPart * 3.1)) * 0.6 + fxNoise(vec2(u * 15.0 + s, v * 13.0 - s)) * 0.4;
    I = across * len * (0.2 + 1.8 * n * n) * (0.55 + 0.9 * bulge);
    I *= smoothstep(0.05, 0.45, vFace);
    core = across * exp(-u * 6.0);
  } else {
    vec2 p = vec2(vQ.x, vQ.y * 2.0 - 1.0);
    float r = length(p);
    float ang = atan(p.y, p.x);
    float prong = pow(abs(cos(ang * 1.5 + vSeed.x * 6.283)), 10.0) * exp(-r * 3.2) * 0.45;
    I = (exp(-r * r * 7.0) + prong) * (1.0 - smoothstep(0.75, 1.0, r));
    I *= smoothstep(0.25, 0.9, vFace);
    core = exp(-r * r * 30.0);
  }
  // 1st frame full, then quick decay
  float fade = (1.0 - smoothstep(0.35, 1.0, vAge));
  I *= fade;
  // orange plume, yellow-white only in the core (an all-white flash reads as a sticker)
  vec3 col = mix(vec3(1.0, 0.36, 0.08), vec3(1.0, 0.75, 0.42), clamp(I * 0.9 + core, 0.0, 1.0));
  vec3 rgb = col * (I * 4.5 + core * 7.0 * fade) * vSeed.y * uFxExposureComp;
  rgb *= atmosTransmittance(vW, cameraPosition);
  gl_FragColor = vec4(rgb, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function flashGeometry() {
  const pos = [], idx = [];
  for (let p = 0; p < 4; p++) {
    const b = pos.length / 3;
    // x across [-1,1], y along [0,1], z part id
    pos.push(-1, 0, p, 1, 0, p, 1, 1, p, -1, 1, p);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

// kinds: length multiplier, size (m), brightness
export const MUZZLE_KINDS = {
  rifle: { size: 0.11, len: 1.3, bright: 1.0, life: 0.045 },
  pistol: { size: 0.07, len: 1.2, bright: 0.8, life: 0.035 },
  shotgun: { size: 0.15, len: 1.3, bright: 1.2, life: 0.05 },
  smg: { size: 0.08, len: 1.3, bright: 0.85, life: 0.035 },
};

export function createMuzzle(G, U, { cap = 16 } = {}) {
  const mat = new ShaderMaterial({ ...PREMUL, name: 'fx-muzzle', side: 2, uniforms: { ...U, ...fogUniforms() }, vertexShader: VS, fragmentShader: FS.replace('__FOG__', fogChunk()) });
  const P = new Pool(cap, flashGeometry(), mat, { iPos: 4, iDir: 4, iSeed: 4 }, { life: 2 });
  P.mesh.renderOrder = 12;
  const A = P.arrays;
  // pos/dir: Vector3-likes; kind name or object
  function flash(px, py, pz, dx, dy, dz, kind = 'rifle', scale = 1) {
    const K = MUZZLE_KINDS[kind] || MUZZLE_KINDS.rifle;
    const i = P.spawn(), i4 = i * 4;
    A.iPos[i4] = px; A.iPos[i4 + 1] = py; A.iPos[i4 + 2] = pz; A.iPos[i4 + 3] = K.size * scale * (0.85 + Math.random() * 0.3);
    A.iDir[i4] = dx; A.iDir[i4 + 1] = dy; A.iDir[i4 + 2] = dz; A.iDir[i4 + 3] = 0;
    A.iSeed[i4] = Math.random(); A.iSeed[i4 + 1] = K.bright * (0.85 + Math.random() * 0.3); A.iSeed[i4 + 2] = Math.random() * 6.283; A.iSeed[i4 + 3] = K.len * (0.75 + Math.random() * 0.5);
    A.life[i * 2] = 0; A.life[i * 2 + 1] = K.life;
    return i;
  }
  function update(dt) {
    for (let i = 0; i < P.n; i++) {
      // age advances AFTER it is written, so the spawn frame always renders the brightest state
      const a = A.life[i * 2], L = A.life[i * 2 + 1];
      if (a >= L) { P.kill(i); i--; continue; }
      A.iDir[i * 4 + 3] = a / L; A.life[i * 2] = a + dt;
    }
    P.commit();
  }
  return { pool: P, mesh: P.mesh, flash, update, get count() { return P.n; } };
}
