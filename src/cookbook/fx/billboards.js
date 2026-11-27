// Lit, soft, sorted billboards: fire (flipbook), smoke/steam/dust puffs (atlas), glow (analytic flash) and
// ground shock rings — ONE instanced draw call, premultiplied alpha so emissive fire and absorbing smoke mix
// correctly. Puffs carry a normal in the atlas → real sun wrap-lighting + forward-scatter rim + sky/ground ambient.
// Soft-particle fade against scene depth (uFxDepth, linear metres) when available, camera-near fade always.
import { PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import { Pool, PREMUL, FX_GLSL, fogChunk, fogUniforms } from './common.js';

export const KIND = { FIRE: 0, PUFF: 1, GLOW: 2, RING: 3 };

const VS = /*glsl*/`
attribute vec4 iPos;
attribute vec4 iA;
attribute vec4 iC;
attribute vec4 iE;
varying vec2 vUv;
varying vec2 vRot;
varying vec3 vW;
varying vec3 vClip;
varying float vViewZ;
varying vec4 vC;
varying vec4 vE;
varying vec4 vA;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vBack;
void main() {
  float c = cos(iA.y);
  float s = sin(iA.y);
  vec2 q = position.xy;
  vec2 rq = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * iPos.w;
  vRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vBack = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec3 w;
  if (iA.z > 2.5) {
    // ground ring: horizontal quad, lifted 3 cm to avoid z-fighting
    w = iPos.xyz + vec3(rq.x, 0.03, rq.y);
  } else {
    w = iPos.xyz + vRight * rq.x + vUp * rq.y;
  }
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  vClip = gl_Position.xyw;
  vViewZ = -mv.z;
  vW = w;
  vUv = uv;
  vRot = vec2(c, s);
  vC = iC;
  vE = iE;
  vA = iA;
}`;

const FS = /*glsl*/`
uniform sampler2D uFire;
uniform sampler2D uPuff;
uniform float uFireGrid;
uniform float uPuffGrid;
varying vec2 vUv;
varying vec2 vRot;
varying vec3 vW;
varying vec3 vClip;
varying float vViewZ;
varying vec4 vC;
varying vec4 vE;
varying vec4 vA;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vBack;
${FX_GLSL}
__FOG__
vec4 tile(sampler2D t, float grid, float idx, vec2 uv) {
  vec2 cell = vec2(mod(idx, grid), floor(idx / grid));
  return texture2D(t, (cell + uv) / grid);
}
float hg(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-3), 1.5));
}
void main() {
  float life = vA.x;
  float kind = vA.z;
  vec4 tx;
  if (kind < 0.5) {
    float n = uFireGrid * uFireGrid - 1.0;
    float f = clamp(life, 0.0, 1.0) * n;
    float f0 = floor(f);
    tx = mix(tile(uFire, uFireGrid, f0, vUv), tile(uFire, uFireGrid, min(f0 + 1.0, n), vUv), f - f0);
  } else if (kind < 1.5) {
    tx = tile(uPuff, uPuffGrid, vA.w, vUv);
  } else if (kind < 2.5) {
    float r = length(vUv - 0.5) * 2.0;
    tx = vec4(1.0, 0.0, 0.5, 0.5) * vec4(exp(-r * r * 5.0) * (1.0 - smoothstep(0.7, 1.0, r)), 1.0, 1.0, 1.0);
  } else {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float ang = atan(p.y, p.x);
    float ring = exp(-pow((r - 0.78) / (0.10 + 0.08 * life), 2.0)) * (1.0 - smoothstep(0.9, 1.0, r));
    ring *= 0.55 + 0.45 * fxNoise(vec2(ang * 6.0 + vA.w * 17.0, r * 4.0));
    tx = vec4(0.0, ring, 0.5 + p.x * 0.2, 0.5 + 0.35);
  }
  float soft = fxSoft(vClip, vViewZ, vE.z);
  float a = tx.g * vC.a * soft;
  if (a < 0.002 && tx.r * vE.x < 0.002) discard;
  // sprite-space normal -> world
  vec2 ns = tx.ba * 2.0 - 1.0;
  ns = vec2(vRot.x * ns.x - vRot.y * ns.y, vRot.y * ns.x + vRot.x * ns.y);
  vec3 nW;
  if (kind > 2.5) {
    nW = normalize(vec3(ns.x, 1.0, ns.y));
  } else {
    float nz = sqrt(max(0.0, 1.0 - dot(ns, ns)));
    nW = normalize(vRight * ns.x + vUp * ns.y + vBack * (nz + 0.25));
  }
  vec3 V = normalize(vW - cameraPosition);
  float ndl = dot(nW, uFxSunDir);
  float wrap = clamp(ndl * 0.6 + 0.4, 0.0, 1.0);
  // thin edges glow when back-lit (forward scattering through the puff)
  float thin = 1.0 - tx.g;
  float ph = hg(dot(V, uFxSunDir), 0.6);
  vec3 amb = mix(uFxAmbDown, uFxAmbUp, clamp(nW.y * 0.5 + 0.5, 0.0, 1.0));
  vec3 lit = vC.rgb * (uFxSun * (wrap * wrap * 0.3183 * (0.55 + 0.45 * thin) + ph * (0.25 + thin)) + amb);
  // emission: heat from the texture biased by the particle's temperature
  float heat = clamp(tx.r * vE.y, 0.0, 1.0);
  vec3 emis = fxHeat(heat) * vE.x * soft * uFxExposureComp;
  if (kind > 1.5 && kind < 2.5) emis = vC.rgb * tx.r * vE.x * soft * uFxExposureComp;
  // puffs: vE.x = fire-lit under-glow (explosion smoke lit from inside, decays with heatDecay)
  if (kind > 0.5 && kind < 1.5) emis = vec3(1.0, 0.38, 0.1) * vE.x * soft * uFxExposureComp * (0.4 + 0.6 * tx.g);
  vec3 rgb = lit * a + emis * max(tx.g, kind > 1.5 ? 1.0 : 0.35);
  vec3 Tr = atmosTransmittance(vW, cameraPosition);
  rgb = rgb * Tr + atmosInscatter(V) * (1.0 - Tr) * a;
  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// spec object fields used by emit(): x,y,z, vx,vy,vz, size0,size1, life, kind, variant, rot, spin,
// r,g,b (albedo), opacity, emis (emission scale), heat (texture heat multiplier), heatDecay (per life),
// drag (1/s), buoy (m/s² upward), soft (m), fadeIn (fraction of life)
export function makeSpec() {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size0: 1, size1: 2, life: 2, kind: 1, variant: 0, rot: 0, spin: 0,
    r: 0.5, g: 0.5, b: 0.5, opacity: 1, emis: 0, heat: 1, heatDecay: 0, drag: 1, buoy: 0, soft: 1, fadeIn: 0.1, delay: 0 };
}

const _cam = new Vector3(), _fw = new Vector3();

export function createBillboards(G, U, atlases, { cap = 384 } = {}) {
  const mat = new ShaderMaterial({
    ...PREMUL, name: 'fx-billboards',
    uniforms: { ...U, ...fogUniforms(), uFire: { value: atlases.fire.texture }, uPuff: { value: atlases.puff.texture },
      uFireGrid: { value: atlases.fire.grid }, uPuffGrid: { value: atlases.puff.grid } },
    vertexShader: VS, fragmentShader: FS.replace('__FOG__', fogChunk()),
  });
  const P = new Pool(cap, new PlaneGeometry(1, 1), mat,
    { iPos: 4, iA: 4, iC: 4, iE: 4 },
    { vel: 4, tm: 4, ex: 4, key: 1, f2: 2 });
  P.mesh.renderOrder = 10;
  const A = P.arrays;

  function emit(s) {
    const i = P.spawn(), i4 = i * 4;
    A.iPos[i4] = s.x; A.iPos[i4 + 1] = s.y; A.iPos[i4 + 2] = s.z; A.iPos[i4 + 3] = s.size0;
    A.iA[i4] = 0; A.iA[i4 + 1] = s.rot; A.iA[i4 + 2] = s.kind; A.iA[i4 + 3] = s.variant;
    A.iC[i4] = s.r; A.iC[i4 + 1] = s.g; A.iC[i4 + 2] = s.b; A.iC[i4 + 3] = 0;
    A.iE[i4] = s.emis; A.iE[i4 + 1] = s.heat; A.iE[i4 + 2] = s.soft; A.iE[i4 + 3] = 0;
    A.vel[i4] = s.vx; A.vel[i4 + 1] = s.vy; A.vel[i4 + 2] = s.vz; A.vel[i4 + 3] = s.drag;
    A.tm[i4] = -s.delay; A.tm[i4 + 1] = s.life; A.tm[i4 + 2] = s.size0; A.tm[i4 + 3] = s.size1;
    A.ex[i4] = s.spin; A.ex[i4 + 1] = s.buoy; A.ex[i4 + 2] = s.opacity; A.ex[i4 + 3] = s.heatDecay;
    A.f2[i * 2] = s.fadeIn; A.f2[i * 2 + 1] = s.emis; A.key[i] = 0;
    return i;
  }

  function update(dt) {
    const cam = G.camera; cam.getWorldPosition(_cam); cam.getWorldDirection(_fw);
    for (let i = 0; i < P.n; i++) {
      const i4 = i * 4;
      let age = A.tm[i4] + dt; A.tm[i4] = age;
      const life = A.tm[i4 + 1];
      if (age >= life) { P.kill(i); i--; continue; }
      if (age < 0) { A.iC[i4 + 3] = 0; A.iE[i4] = 0; continue; } // delayed spawn
      const u = age / life;
      const drag = Math.exp(-A.vel[i4 + 3] * dt);
      A.vel[i4] *= drag; A.vel[i4 + 2] *= drag; A.vel[i4 + 1] = A.vel[i4 + 1] * drag + A.ex[i4 + 1] * dt;
      A.iPos[i4] += A.vel[i4] * dt; A.iPos[i4 + 1] += A.vel[i4 + 1] * dt; A.iPos[i4 + 2] += A.vel[i4 + 2] * dt;
      // size: fast ease-out growth (smoke expands quickly then lingers)
      const g = 1 - (1 - u) * (1 - u) * (1 - u);
      A.iPos[i4 + 3] = A.tm[i4 + 2] + (A.tm[i4 + 3] - A.tm[i4 + 2]) * g;
      A.iA[i4] = u; A.iA[i4 + 1] += A.ex[i4] * dt;
      const fin = A.f2[i * 2], fi = fin > 0 ? Math.min(1, u / fin) : 1;
      const fo = 1 - smooth(0.45, 1, u);
      A.iC[i4 + 3] = A.ex[i4 + 2] * fi * fo;
      A.iE[i4] = A.f2[i * 2 + 1] * Math.exp(-A.ex[i4 + 3] * u) * fi;
      const dx = A.iPos[i4] - _cam.x, dy = A.iPos[i4 + 1] - _cam.y, dz = A.iPos[i4 + 2] - _cam.z;
      A.key[i] = dx * _fw.x + dy * _fw.y + dz * _fw.z;
    }
    // back-to-front insertion sort (nearly sorted frame to frame → ~O(n))
    for (let i = 1; i < P.n; i++) {
      let j = i;
      while (j > 0 && A.key[j - 1] < A.key[j]) { P.swap(j - 1, j); j--; }
    }
    P.commit();
  }
  return { pool: P, mesh: P.mesh, emit, update, get count() { return P.n; } };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
