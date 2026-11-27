// Velocity-stretched streaks in ONE instanced draw: sparks (gravity, drag, bounce on the ground, cooling
// along a black-body ramp) and tracers (bullet-speed glowing segments). Screen-space quads between a tail and
// a head point with round caps; width = max(world width in px, 1.25 px) and intensity scaled by the ratio,
// so sub-pixel sparks fade instead of aliasing/crawling (energy-conserving minimum pixel width).
import { PlaneGeometry, ShaderMaterial } from 'three';
import { Pool, PREMUL, FX_GLSL, fogChunk, fogUniforms } from './common.js';

const VS = /*glsl*/`
attribute vec4 iHead;
attribute vec4 iTail;
attribute vec4 iCol;
uniform vec2 uFxRes;
varying vec3 vSeg;
varying float vW;
varying float vFade;
varying vec4 vCol;
varying vec3 vWorld;
void main() {
  vec4 h = projectionMatrix * viewMatrix * vec4(iHead.xyz, 1.0);
  vec4 t = projectionMatrix * viewMatrix * vec4(iTail.xyz, 1.0);
  float nearW = 0.06;
  if (h.w < nearW && t.w < nearW) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // clip the segment against the near plane so streaks crossing the camera stay sane
  if (t.w < nearW) t = mix(h, t, (h.w - nearW) / (h.w - t.w));
  if (h.w < nearW) h = mix(t, h, (t.w - nearW) / (t.w - h.w));
  vec2 hs = h.xy / h.w * 0.5 * uFxRes;
  vec2 ts = t.xy / t.w * 0.5 * uFxRes;
  vec2 d = hs - ts;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float along = position.x + 0.5;
  vec4 base = mix(t, h, along);
  float pxW = iHead.w * uFxRes.y * 0.5 * projectionMatrix[1][1] / base.w;
  float w = max(pxW, 1.25);
  vFade = pxW / w;
  vec2 off = nrm * position.y * w + dir * position.x * w;
  gl_Position = base + vec4(off * 2.0 / uFxRes * base.w, 0.0, 0.0);
  vSeg = vec3(along * len + position.x * w, position.y * w, len);
  vW = w;
  vCol = iCol;
  vWorld = mix(iTail.xyz, iHead.xyz, along);
}`;

const FS = /*glsl*/`
varying vec3 vSeg;
varying float vW;
varying float vFade;
varying vec4 vCol;
varying vec3 vWorld;
${FX_GLSL}
__FOG__
void main() {
  float dx = max(0.0, max(-vSeg.x, vSeg.x - vSeg.z));
  float r = length(vec2(dx, vSeg.y)) / (vW * 0.5);
  float prof = exp(-r * r * 2.2) * (1.0 - smoothstep(0.75, 1.0, r));
  float u = clamp(vSeg.x / max(vSeg.z, 1e-3), 0.0, 1.0);
  // brighter toward the head; the tail fades (exposure trail)
  float along = mix(vCol.z, 1.0, u * u);
  vec3 c;
  if (vCol.w < 0.5) {
    c = fxHeat(vCol.x);
  } else {
    // tracer: hot white core inside an orange-red sheath
    c = mix(vec3(1.0, 0.32, 0.08), vec3(1.0, 0.78, 0.5), smoothstep(0.6, 0.0, r)) * 6.0;
  }
  vec3 rgb = c * vCol.y * prof * along * vFade * uFxExposureComp;
  rgb *= atmosTransmittance(vWorld, cameraPosition);
  gl_FragColor = vec4(rgb, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createStreaks(G, U, { cap = 1024 } = {}) {
  const mat = new ShaderMaterial({ ...PREMUL, name: 'fx-streaks', uniforms: { ...U, ...fogUniforms() }, vertexShader: VS, fragmentShader: FS.replace('__FOG__', fogChunk()) });
  // GPU: head(xyz,width) tail(xyz,tailBright... unused w) col(heat, bright, tailBright, kind)
  // CPU: p (pos xyz, age) v (vel xyz, life) m (stretch, bounce, drag, cool) t (tracer: dist, maxDist, length, speed)
  const P = new Pool(cap, new PlaneGeometry(1, 1), mat, { iHead: 4, iTail: 4, iCol: 4 }, { p: 4, v: 4, m: 4, t: 4, d: 4 });
  P.mesh.renderOrder = 11;
  const A = P.arrays;
  let groundAt = null, groundY = 0;

  // sparks: spec fields x,y,z, vx,vy,vz, life, width, heat, bright, stretch, bounce, drag, cool
  function spark(x, y, z, vx, vy, vz, life, width, heat, bright, bounce = 0.35, drag = 0.6) {
    const i = P.spawn(), i4 = i * 4;
    A.p[i4] = x; A.p[i4 + 1] = y; A.p[i4 + 2] = z; A.p[i4 + 3] = 0;
    A.v[i4] = vx; A.v[i4 + 1] = vy; A.v[i4 + 2] = vz; A.v[i4 + 3] = life;
    A.m[i4] = 0.022; A.m[i4 + 1] = bounce; A.m[i4 + 2] = drag; A.m[i4 + 3] = heat;
    A.t[i4 + 3] = 0;
    A.iHead[i4 + 3] = width; A.iCol[i4] = heat; A.iCol[i4 + 1] = bright; A.iCol[i4 + 2] = 0.15; A.iCol[i4 + 3] = 0;
    return i;
  }
  // tracers: from -> to at `speed` m/s, visible segment `length` m
  function tracer(fx, fy, fz, tx, ty, tz, speed = 380, length = 6, width = 0.022, bright = 1) {
    const dx = tx - fx, dy = ty - fy, dz = tz - fz, L = Math.hypot(dx, dy, dz) || 1;
    const i = P.spawn(), i4 = i * 4;
    A.p[i4] = fx; A.p[i4 + 1] = fy; A.p[i4 + 2] = fz; A.p[i4 + 3] = 0;
    A.d[i4] = dx / L; A.d[i4 + 1] = dy / L; A.d[i4 + 2] = dz / L;
    A.t[i4] = 0; A.t[i4 + 1] = L; A.t[i4 + 2] = length; A.t[i4 + 3] = speed;
    A.iHead[i4 + 3] = width; A.iCol[i4] = 1; A.iCol[i4 + 1] = bright; A.iCol[i4 + 2] = 0.0; A.iCol[i4 + 3] = 1;
    return i;
  }

  function update(dt) {
    const gy = -9.81;
    for (let i = 0; i < P.n; i++) {
      const i4 = i * 4;
      if (A.t[i4 + 3] > 0) { // tracer
        const s = A.t[i4] + A.t[i4 + 3] * dt; A.t[i4] = s;
        const L = A.t[i4 + 1], len = A.t[i4 + 2];
        if (s - len >= L) { P.kill(i); i--; continue; }
        const hd = Math.min(s, L), tl = Math.max(0, Math.min(s - len, L));
        A.iHead[i4] = A.p[i4] + A.d[i4] * hd; A.iHead[i4 + 1] = A.p[i4 + 1] + A.d[i4 + 1] * hd; A.iHead[i4 + 2] = A.p[i4 + 2] + A.d[i4 + 2] * hd;
        A.iTail[i4] = A.p[i4] + A.d[i4] * tl; A.iTail[i4 + 1] = A.p[i4 + 1] + A.d[i4 + 1] * tl; A.iTail[i4 + 2] = A.p[i4 + 2] + A.d[i4 + 2] * tl;
        continue;
      }
      const age = A.p[i4 + 3] + dt, life = A.v[i4 + 3];
      if (age >= life) { P.kill(i); i--; continue; }
      A.p[i4 + 3] = age;
      const dr = Math.exp(-A.m[i4 + 2] * dt);
      let vx = A.v[i4] * dr, vy = A.v[i4 + 1] * dr + gy * dt, vz = A.v[i4 + 2] * dr;
      let x = A.p[i4] + vx * dt, y = A.p[i4 + 1] + vy * dt, z = A.p[i4 + 2] + vz * dt;
      const g = groundAt ? groundAt(x, z) : groundY;
      if (y < g && vy < 0) {
        y = g + (g - y) * A.m[i4 + 1]; vy = -vy * A.m[i4 + 1]; vx *= 0.55; vz *= 0.55;
        A.m[i4 + 3] *= 0.85; // loses heat on contact
        if (Math.abs(vy) < 0.4) vy = 0;
      }
      A.v[i4] = vx; A.v[i4 + 1] = vy; A.v[i4 + 2] = vz; A.p[i4] = x; A.p[i4 + 1] = y; A.p[i4 + 2] = z;
      const u = age / life;
      // cooling: heat falls, brightness follows heat^1.5 and fades out at the end
      const heat = A.m[i4 + 3] * (1 - 0.65 * u);
      A.iCol[i4] = heat; A.iCol[i4 + 1] *= 1; // bright factor is constant; heat ramp carries the dimming
      const st = A.m[i4];
      A.iHead[i4] = x; A.iHead[i4 + 1] = y; A.iHead[i4 + 2] = z;
      A.iTail[i4] = x - vx * st; A.iTail[i4 + 1] = y - vy * st; A.iTail[i4 + 2] = z - vz * st;
      if (u > 0.85) A.iHead[i4 + 3] *= 0.92; // shrink out
    }
    P.commit();
  }
  return {
    pool: P, mesh: P.mesh, spark, tracer, update,
    setGround(y, fn = null) { groundY = y; groundAt = fn; },
    get count() { return P.n; },
  };
}
