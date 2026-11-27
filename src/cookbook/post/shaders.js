// GLSL for every pass of the HDR post chain (post/pipeline.js wires them).
// Conventions: all passes are fullscreen triangles (post/fullscreen.js), vUv in [0,1].
// Half-res passes use texelFetch on gl_FragCoord so they never blur across depth edges by accident.
// Linear depth ("z") is positive view distance along -Z in metres; z >= uFar*0.99 means sky.

// ---------------------------------------------------------------- shared helpers
export const COMMON = /*glsl*/`
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// interleaved gradient noise (Jimenez 2014): blue-ish, cheap, great for jittering ray-march starts / AO rotation
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// hardware depth [0,1] -> positive linear view distance (perspective camera)
float linDepth(float d, vec2 nf) {
  float z = d * 2.0 - 1.0;
  return 2.0 * nf.x * nf.y / (nf.y + nf.x - z * (nf.y - nf.x));
}
// uv + linear depth -> view-space position. tanH = (1/P[0][0], 1/P[1][1]).
vec3 viewPos(vec2 uv, float z, vec2 tanH) { return vec3((uv * 2.0 - 1.0) * tanH * z, -z); }
`;

// ---------------------------------------------------------------- 1. half-res linear depth
export const DEPTH_HALF = /*glsl*/`
uniform sampler2D tDepth;
uniform vec2 uNF;
varying vec2 vUv;
${COMMON}
void main() {
  ivec2 sz = textureSize(tDepth, 0) - 1;
  // always the same full-res pixel (2q): consumers reconstruct its position with uv = (q + 0.25) / halfRes.
  // (a checkerboard min/max looks tempting but jitters positions by a pixel and makes flat planes self-occlude)
  float d = texelFetch(tDepth, min(ivec2(gl_FragCoord.xy) * 2, sz), 0).r;
  gl_FragColor = vec4(linDepth(d, uNF), 0.0, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------- 2. SSAO (half res)
// Normal from depth (pick the smaller-gradient side so edges don't smear), Vogel spiral taps rotated by IGN,
// horizon-style term max(0, cos(n,v) - bias) with a distance falloff. Radius is in world metres.
export const SSAO = /*glsl*/`
uniform sampler2D tZ;
uniform vec2 uRes;
uniform vec2 uTanH;
uniform float uFar;
uniform float uRadius;
uniform float uIntensity;
uniform float uBias;
varying vec2 vUv;
${COMMON}
vec3 P(ivec2 q) {
  q = clamp(q, ivec2(0), ivec2(uRes) - 1);
  float z = texelFetch(tZ, q, 0).r;
  return viewPos((vec2(q) + 0.25) / uRes, z, uTanH);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float z = texelFetch(tZ, p, 0).r;
  // sky or first-person overlay (drawn in the first 5 cm of depth range) gets no AO
  if (z > uFar * 0.99 || z < 0.06) { gl_FragColor = vec4(1.0); return; }
  vec3 c = viewPos((vec2(p) + 0.25) / uRes, z, uTanH);
  vec3 l = P(p + ivec2(-1, 0)), r = P(p + ivec2(1, 0)), d = P(p + ivec2(0, -1)), u = P(p + ivec2(0, 1));
  vec3 dx = abs(r.z - c.z) < abs(c.z - l.z) ? r - c : c - l;
  vec3 dy = abs(u.z - c.z) < abs(c.z - d.z) ? u - c : c - d;
  vec3 n = normalize(cross(dx, dy));
  // world radius -> pixels at this depth (clamped: huge radii thrash the cache, tiny ones alias)
  float rpx = clamp(uRadius * uRes.y * 0.5 / (z * uTanH.y), 2.0, 64.0);
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  float r2 = uRadius * uRadius;
  float ao = 0.0;
  for (int i = 0; i < AO_TAPS; i++) {
    float f = (float(i) + 0.5) / float(AO_TAPS);
    float a = float(i) * 2.3999632 + rot;
    vec2 o = vec2(cos(a), sin(a)) * sqrt(f) * rpx;
    ivec2 q = p + ivec2(round(o));
    if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, ivec2(uRes)))) continue; // off-screen: no info
    vec3 s = P(q);
    vec3 v = s - c;
    float vv = dot(v, v);
    float fall = clamp(1.0 - vv / r2, 0.0, 1.0);
    ao += max(0.0, dot(v, n) * inversesqrt(vv + 1e-6) - uBias) * fall;
  }
  ao = clamp(1.0 - uIntensity * ao / float(AO_TAPS), 0.0, 1.0);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

// ---------------------------------------------------------------- 3. depth-aware separable blur (half res)
// Used for both AO (r) and volumetrics (rgba). Gaussian x exp(-|dz|/(k*z)) weight.
export const BILATERAL = /*glsl*/`
uniform sampler2D tSrc;
uniform sampler2D tZ;
uniform vec2 uDir;
uniform float uDepthK;
varying vec2 vUv;
void main() {
  ivec2 sz = textureSize(tSrc, 0) - 1;
  ivec2 p = ivec2(gl_FragCoord.xy);
  float z0 = texelFetch(tZ, p, 0).r;
  vec4 acc = texelFetch(tSrc, p, 0);
  float wsum = 1.0;
  float inv = 1.0 / (uDepthK * z0 + 0.02);
  for (int i = 1; i <= 4; i++) {
    float g = exp(-float(i * i) * 0.11);
    for (int s = -1; s <= 1; s += 2) {
      ivec2 q = clamp(p + ivec2(uDir * float(i * s)), ivec2(0), sz);
      float w = g * exp(-abs(texelFetch(tZ, q, 0).r - z0) * inv);
      acc += texelFetch(tSrc, q, 0) * w;
      wsum += w;
    }
  }
  gl_FragColor = acc / wsum;
}
`;

// ---------------------------------------------------------------- 4. volumetric sun shafts / height fog (half res)
// Ray-march camera -> min(scene depth, uMaxD) through the sun's shadow map. Quadratic step distribution
// (denser near the camera, where shafts are big on screen), IGN-jittered start, two-lobe HG phase,
// exponential height density. Output rgb = in-scattered radiance, a = transmittance.
//
// Two modes (uAtm):
//  0 standalone: the pass IS the fog: own density/extinction, ambient + shadowed sun in-scatter, a = T.
//  1 atmos (lighting/atmos.js installed): every material already applied the analytic fog, which assumes the
//    whole medium is sun-lit. Here we march the SAME medium (uFogSigma/uFogFalloff/uFogBase/uFogStart, the same
//    two-lobe phase and the same 0.0125*uFogSunInscatter sun term) and output the sun in-scatter that the
//    shadowed segments must NOT have received, as a negative radiance; a = 1 (extinction already applied once).
//    Net result = analytic ambient haze + shadowed sun in-scatter: no double haze, and outside the shadow
//    frustum (vis = 1) the correction is exactly 0, so there is no "lit wall" at the frustum edge.
export const VOLUME = /*glsl*/`
#include <packing>
uniform sampler2D tZ;
uniform sampler2D tShadow;
uniform mat4 uShadowM;
uniform mat4 uCamWorld;
uniform vec2 uRes;
uniform vec2 uTanH;
uniform float uFar;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform float uDensity;
uniform float uFalloff;
uniform float uBase;
uniform float uG;
uniform float uMaxD;
uniform float uExt;
uniform float uShadowOn;
uniform float uAtm;
uniform float uShaft;
uniform vec3 uFogSigma;
uniform float uFogFalloff;
uniform float uFogBase;
uniform float uFogStart;
uniform float uFogSunInscatter;
uniform vec3 uAtmSun;
varying vec2 vUv;
${COMMON}
// lighting/atmos.glsl.js atmosHG (normalised x4pi, sphere mean 1)
float hgA(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5);
}
float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
float sunVis(vec3 wp) {
  vec4 sc = uShadowM * vec4(wp, 1.0);
  sc.xyz /= sc.w;
  // outside the shadow frustum = lit (fit the shadow camera to the playable area)
  if (uShadowOn < 0.5 || sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  float d = unpackRGBAToDepth(texture2D(tShadow, sc.xy));
  return step(sc.z, d + 0.0015);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float z = texelFetch(tZ, p, 0).r;
  vec2 uv = (vec2(p) + 0.25) / uRes;
  vec3 vp = viewPos(uv, z, uTanH);
  float dist = length(vp);
  vec3 rd = normalize(mat3(uCamWorld) * (vp / dist));
  vec3 ro = uCamWorld[3].xyz;
  // stop 0.25 m short of the surface: the last samples would otherwise read the receiver's own shadow-map
  // texels and print the shadow-map grid (cross-hatch) onto walls facing away from the sun
  float maxT = z > uFar * 0.99 ? uMaxD : min(max(dist - 0.25, 0.0), uMaxD);
  float cosT = dot(rd, uSunDir);
  float j = ign(gl_FragCoord.xy);
  float inv = 1.0 / float(VOL_STEPS);
  if (uAtm > 0.5) {
    // same medium + sun term as atmosInscatter(); march only where the analytic fog exists (t >= uFogStart)
    float s0 = min(uFogStart, maxT), len = maxT - s0;
    float ph = 0.8 * hgA(cosT, 0.62) + 0.2 * hgA(cosT, -0.25);
    vec3 S = uAtmSun * (ph * uFogSunInscatter * 0.0125 * smoothstep(-0.08, 0.06, uSunDir.y));
    float k = max(uFogFalloff, 1e-5);
    vec3 Ta = vec3(1.0), D = vec3(0.0);
    for (int i = 0; i < VOL_STEPS; i++) {
      float f0 = float(i) * inv, f1 = f0 + inv, fj = f0 + j * inv;
      float t = s0 + len * fj * fj;
      float ds = len * (f1 * f1 - f0 * f0);
      vec3 wp = ro + rd * t;
      vec3 a = uFogSigma * (exp(clamp(-k * (wp.y - uFogBase), -60.0, 6.0)) * ds);
      vec3 e = exp(-a);
      // sum of Ta*(1-e) telescopes to the analytic (1 - T): with vis = 0 everywhere D = the whole sun term
      D += Ta * (1.0 - e) * (1.0 - sunVis(wp));
      Ta *= e;
    }
    gl_FragColor = vec4(-S * D * uShaft, 1.0);
    return;
  }
  // forward lobe for the glow toward the sun, weak back lobe so the away view isn't dead
  float ph = mix(hg(cosT, uG), hg(cosT, -0.25), 0.2);
  vec3 sunL = uSunCol * ph;
  vec3 L = vec3(0.0);
  float T = 1.0;
  for (int i = 0; i < VOL_STEPS; i++) {
    float f0 = float(i) * inv, f1 = f0 + inv, fj = f0 + j * inv;
    float t = maxT * fj * fj;
    float ds = maxT * (f1 * f1 - f0 * f0);
    vec3 wp = ro + rd * t;
    float dens = uDensity * exp(-max(wp.y - uBase, 0.0) * uFalloff);
    float a = dens * ds;
    vec3 Ls = sunL * sunVis(wp) + uAmb;
    L += T * Ls * a;
    T *= exp(-a * uExt);
  }
  gl_FragColor = vec4(L, T);
}
`;

// ---------------------------------------------------------------- 5. composite (full res HDR)
// Joint-bilateral upsample of AO + volumetrics, AO mostly on "ambient-looking" (dim) pixels, then col*T + inscatter.
export const COMPOSITE = /*glsl*/`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tZ;
uniform sampler2D tAO;
uniform sampler2D tVol;
uniform sampler2D tAdapt;
uniform vec2 uNF;
uniform vec2 uHalf;
uniform float uAO;
uniform float uVol;
uniform float uAdaptKey;
uniform vec2 uAdaptClamp;
varying vec2 vUv;
${COMMON}
// 4 nearest half-res texels, bilinear weight x depth similarity; falls back to the closest-depth texel
void upsample(vec2 uv, float z, out float ao, out vec4 vol) {
  vec2 pos = uv * uHalf - 0.5;
  ivec2 b = ivec2(floor(pos));
  vec2 f = fract(pos);
  ivec2 mx = ivec2(uHalf) - 1;
  float wsum = 0.0, best = 1e9;
  ao = 0.0; vol = vec4(0.0);
  float aoB = 1.0; vec4 volB = vec4(0.0, 0.0, 0.0, 1.0);
  float inv = 1.0 / (0.04 * z + 0.02);
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 q = clamp(b + o, ivec2(0), mx);
    float zq = texelFetch(tZ, q, 0).r;
    float dz = abs(zq - z);
    float bw = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
    float w = bw * exp(-dz * inv) + 1e-5;
    float a = texelFetch(tAO, q, 0).r;
    vec4 v = texelFetch(tVol, q, 0);
    ao += a * w; vol += v * w; wsum += w;
    if (dz < best) { best = dz; aoB = a; volB = v; }
  }
  if (wsum < 0.02) { ao = aoB; vol = volB; } else { ao /= wsum; vol /= wsum; }
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 col = texelFetch(tColor, p, 0).rgb;
  // scrub NaN/Inf before they poison bloom + adaptation (half float max is 65504)
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  col = min(col, vec3(60000.0));
  float z = linDepth(texelFetch(tDepth, p, 0).r, uNF);
  float ao; vec4 vol;
  upsample(vUv, z, ao, vol);
  if (uAO > 0.0) {
    // AO "mostly on ambient": we have no separate ambient buffer, so judge by displayed brightness —
    // sun-lit pixels keep most of their light, shadowed/ambient pixels take the full occlusion.
    float L = texelFetch(tAdapt, ivec2(0), 0).r;
    float e = clamp(uAdaptKey / max(L, 1e-4), uAdaptClamp.x, uAdaptClamp.y);
    float amb = 1.0 - 0.75 * smoothstep(0.25, 1.4, luma(col) * e);
    float a = mix(1.0, ao, amb * uAO);
    col *= vec3(a * mix(1.0, a, 0.2), a, a * mix(1.0, a, 0.05)); // faintly cool occlusion (red drops first)
  }
  // (atmos mode: vol.a = 1 and vol.rgb <= 0 removes the sun in-scatter of shadowed fog; never below black)
  if (uVol > 0.0) col = max(col * mix(1.0, vol.a, uVol) + vol.rgb * uVol, vec3(0.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- 6. bloom: 13-tap downsample (Karis on first level)
// rgb = energy for the wide veil, a = soft-knee-thresholded luminance (hot highlights: dirt / glow / streak).
export const BLOOM_DOWN = /*glsl*/`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
uniform vec3 uThresh; // threshold, knee, unused
varying vec2 vUv;
${COMMON}
vec4 S(float x, float y) { return texture2D(tSrc, vUv + vec2(x, y) * uTexel); }
float kw(vec4 c) { return 1.0 / (1.0 + luma(c.rgb)); }
void main() {
  vec4 a = S(-2.0, 2.0), b = S(0.0, 2.0), c = S(2.0, 2.0);
  vec4 d = S(-2.0, 0.0), e = S(0.0, 0.0), f = S(2.0, 0.0);
  vec4 g = S(-2.0, -2.0), h = S(0.0, -2.0), i = S(2.0, -2.0);
  vec4 j = S(-1.0, 1.0), k = S(1.0, 1.0), l = S(-1.0, -1.0), m = S(1.0, -1.0);
  vec4 g0 = (j + k + l + m) * 0.25;
  vec4 g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25;
  vec4 g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
  vec4 o;
  if (uFirst > 0.5) {
    // Karis average: weight each 2x2 group by 1/(1+luma) -> single-pixel fireflies can't pulse the bloom
    float w0 = 0.5 * kw(g0), w1 = 0.125 * kw(g1), w2 = 0.125 * kw(g2), w3 = 0.125 * kw(g3), w4 = 0.125 * kw(g4);
    o = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    float br = max(o.r, max(o.g, o.b));
    float knee = uThresh.y;
    float soft = clamp(br - uThresh.x + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    o.a = luma(o.rgb) * max(soft, br - uThresh.x) / max(br, 1e-4);
  } else {
    o = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
  }
  gl_FragColor = o;
}
`;

// ---------------------------------------------------------------- 7. bloom: 9-tap tent upsample, lerp into the finer level
export const BLOOM_UP = /*glsl*/`
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexel; // texel of tLow
uniform float uScatter;
varying vec2 vUv;
vec4 S(float x, float y) { return texture2D(tLow, vUv + vec2(x, y) * uTexel); }
void main() {
  vec4 t = S(0.0, 0.0) * 4.0
    + (S(1.0, 0.0) + S(-1.0, 0.0) + S(0.0, 1.0) + S(0.0, -1.0)) * 2.0
    + S(1.0, 1.0) + S(-1.0, 1.0) + S(1.0, -1.0) + S(-1.0, -1.0);
  gl_FragColor = mix(texture2D(tHigh, vUv), t / 16.0, uScatter);
}
`;

// ---------------------------------------------------------------- 8. anamorphic streak (horizontal, 3 passes of growing stride)
export const STREAK = /*glsl*/`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uStride;
uniform float uFirst;
uniform float uThresh;
varying vec2 vUv;
${COMMON}
vec3 S(float x) {
  vec4 c = texture2D(tSrc, vUv + vec2(x * uStride * uTexel.x, 0.0));
  if (uFirst > 0.5) { float l = luma(c.rgb); return c.rgb * max(l - uThresh, 0.0) / max(l, 1e-4); }
  return c.rgb;
}
void main() {
  vec3 acc = S(0.0) * 0.2;
  float w = 0.2;
  for (int i = 1; i <= 7; i++) {
    float g = exp(-float(i) * 0.38) * 0.2;
    acc += (S(float(i)) + S(-float(i))) * g;
    w += 2.0 * g;
  }
  gl_FragColor = vec4(acc / w, 1.0);
}
`;

// ---------------------------------------------------------------- 9. eye adaptation: meter (1x1) + temporal smoothing (ping-pong)
export const ADAPT = /*glsl*/`
uniform sampler2D tSrc;
uniform sampler2D tPrev;
uniform float uRate;
uniform float uReset;
varying vec2 vUv;
${COMMON}
void main() {
  // centre-weighted log-average of a 7x5 grid over the middle 70% x 60% of the frame
  float s = 0.0, w = 0.0;
  for (int y = 0; y < 5; y++) for (int x = 0; x < 7; x++) {
    vec2 g = vec2(float(x) / 6.0, float(y) / 4.0) - 0.5;
    vec2 uv = 0.5 + g * vec2(0.7, 0.6);
    float wt = 1.0 - 0.6 * length(g);
    float l = luma(textureLod(tSrc, uv, 0.0).rgb);
    s += log(clamp(l, 1e-3, 1e4)) * wt;
    w += wt;
  }
  float cur = exp(s / w);
  float prev = texelFetch(tPrev, ivec2(0), 0).r;
  float L = uReset > 0.5 ? cur : prev + (cur - prev) * uRate;
  gl_FragColor = vec4(L, cur, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------- 10. procedural lens dirt (rendered once)
export const DIRT = /*glsl*/`
uniform vec2 uAspect;
varying vec2 vUv;
${COMMON}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 q = vUv * uAspect;
  float c = 0.0;
  // soft bokeh discs with a brighter rim (dried droplets), sized log-uniformly
  for (int i = 0; i < 72; i++) {
    float fi = float(i);
    vec2 pc = vec2(hash12(vec2(fi, 1.7)), hash12(vec2(fi, 9.3))) * uAspect;
    float r = 0.012 + 0.07 * pow(hash12(vec2(fi, 4.1)), 2.5);
    float d = length(q - pc) / r;
    float disc = smoothstep(1.0, 0.82, d) * (0.45 + 0.55 * smoothstep(0.55, 0.95, d));
    c += disc * (0.25 + 0.75 * hash12(vec2(fi, 7.7)));
  }
  // smudges + faint wipe streaks
  float n = vnoise(q * 3.0) * 0.6 + vnoise(q * 7.0) * 0.3 + vnoise(q * 17.0) * 0.1;
  float smudge = smoothstep(0.45, 0.85, n) * 0.6;
  float streak = smoothstep(0.6, 1.0, vnoise(vec2(q.x * 1.5 + q.y * 0.6, q.y * 18.0))) * 0.25;
  float v = 0.15 + c * 0.9 + smudge + streak;
  gl_FragColor = vec4(vec3(v) * vec3(1.0, 0.97, 0.92), 1.0);
}
`;

// ---------------------------------------------------------------- 11. tonemap + grade (full res -> display-encoded HDR16, luma in alpha)
export const TONEMAP = /*glsl*/`
uniform sampler2D tComp;
uniform sampler2D tBloom;
uniform sampler2D tAdapt;
uniform sampler2D tDirt;
uniform sampler2D tStreak;
uniform float uExposure;
uniform float uAdaptOn;
uniform float uAdaptKey;
uniform vec2 uAdaptClamp;
uniform float uBloom;
uniform float uHot;
uniform float uDirt;
uniform float uStreak;
uniform float uAgx;
uniform float uLook;
uniform float uSat;
uniform float uContrast;
uniform vec3 uSplitS;
uniform vec3 uSplitH;
uniform float uVig;
uniform float uChroma;
uniform float uAspect;
varying vec2 vUv;
${COMMON}
// ACES filmic, Stephen Hill RRT+ODT fit (same constants three.js uses; 1/0.6 pre-scale matches three's exposure)
vec3 acesHill(vec3 c) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = IN * (c / 0.6);
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(OUT * (a / b), 0.0, 1.0);
}
// AgX (Sobotka), Filament/three.js formulation: rolls highlights off to white instead of clipping hue
vec3 agx(vec3 c) {
  const mat3 S2R = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 R2S = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 INSET = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 OUTSET = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  c = INSET * (S2R * c);
  c = clamp((log2(max(c, 1e-10)) + 12.47393) / 16.5, 0.0, 1.0);
  vec3 x2 = c * c, x4 = x2 * x2;
  c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
  c = pow(max(OUTSET * c, 0.0), vec3(2.2));
  return clamp(R2S * c, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec2 d = vUv - 0.5;
  vec3 col;
  if (uChroma > 0.0) {
    // radial chromatic aberration: grows with distance from centre, zero in the middle
    // radial, quadratic (≈uChroma uv at the corners, ~0 in the middle). Channels are mixed in Reinhard-compressed
    // space so a 5.0-vs-0.3 HDR edge gives a soft display-like fringe, not a saturated 1px red/blue line.
    vec2 o = d * length(d) * uChroma * 2.0;
    vec3 c0 = texture2D(tComp, vUv).rgb;
    vec3 k = c0 / (1.0 + c0);
    vec3 ka = vec3(texture2D(tComp, vUv - o).r, c0.g, texture2D(tComp, vUv + o).b);
    ka = ka / (1.0 + ka);
    k = mix(k, ka, 0.6);
    col = k / max(1.0 - k, 1e-4);
  } else col = texture2D(tComp, vUv).rgb;
  vec4 b = texture2D(tBloom, vUv);
  col = mix(col, b.rgb, uBloom);                               // energy-conserving veil
  vec3 hot = b.rgb / max(luma(b.rgb), 1e-4) * b.a;               // thresholded highlights only
  col += hot * (uHot + texture2D(tDirt, vUv).rgb * uDirt);
  col += texture2D(tStreak, vUv).rgb * uStreak * vec3(0.45, 0.65, 1.25);
  float e = uExposure;
  if (uAdaptOn > 0.5) e *= clamp(uAdaptKey / max(texelFetch(tAdapt, ivec2(0), 0).r, 1e-4), uAdaptClamp.x, uAdaptClamp.y);
  col *= e;
  vec3 t = mix(acesHill(col), agx(col), uAgx);
  t = pow(t, vec3(uLook));
  float l = luma(t);
  t = max(mix(vec3(l), t, uSat), 0.0);
  // S-curve on luminance (keeps hue), split tone by luminance (cool shadows, warm highlights)
  l = luma(t);
  float ls = mix(l, l * l * (3.0 - 2.0 * l), uContrast);
  t *= ls / max(l, 1e-4);
  t *= mix(uSplitS, uSplitH, smoothstep(0.05, 0.65, ls));
  float r = length(d * vec2(uAspect, 1.0)) / length(vec2(uAspect, 1.0) * 0.5);
  t *= 1.0 - uVig * smoothstep(0.35, 1.05, r) * (0.6 + 0.4 * r);
  t = toSRGB(clamp(t, 0.0, 1.0));
  gl_FragColor = vec4(t, luma(t));
}
`;

// ---------------------------------------------------------------- 12. final: FXAA 3.11 (quality) + edge-aware sharpen + grain + TPDF dither
// finalFrag(hooks): hooks = [{ decl, uv, color }] GLSL strings pasted at compile time (see pipeline.js
// opts.finalHooks): decl at file scope, pre = declarations at the top of main() (shared by uv and color),
// uv may modify `vec2 uv` (the lookup position, before FXAA), color may modify `vec3 col` (after sharpen,
// before grain/dither). Used by the rain-lens drops (weather/rain.js).
export const finalFrag = (hooks = []) => /*glsl*/`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFxaa;
uniform float uSharpen;
uniform float uGrain;
uniform float uSeed;
uniform float uAspect;
uniform float uTime;
varying vec2 vUv;
${COMMON}
${hooks.map((h) => h.decl || '').join('\n')}
#define EDGE_T 0.125
#define EDGE_MIN 0.0312
#define SUBPIX 0.75
float LA(vec2 uv) { return textureLod(tSrc, uv, 0.0).a; }
float stepSize(int i) { return i < 1 ? 1.5 : (i < 5 ? 2.0 : (i < 6 ? 4.0 : 8.0)); }
void main() {
  vec2 T = uTexel;
  vec2 uv = vUv;
${hooks.map((h) => h.pre || '').join('\n')}
${hooks.map((h) => h.uv ? '  {\n' + h.uv + '\n  }' : '').join('\n')}
  vec2 posM = uv;
  vec4 M = textureLod(tSrc, posM, 0.0);
  vec4 cS = textureLod(tSrc, posM + vec2(0.0, 1.0) * T, 0.0);
  vec4 cE = textureLod(tSrc, posM + vec2(1.0, 0.0) * T, 0.0);
  vec4 cN = textureLod(tSrc, posM + vec2(0.0, -1.0) * T, 0.0);
  vec4 cW = textureLod(tSrc, posM + vec2(-1.0, 0.0) * T, 0.0);
  float lumaM = M.a, lumaS = cS.a, lumaE = cE.a, lumaN = cN.a, lumaW = cW.a;
  float rangeMax = max(max(lumaN, lumaW), max(lumaE, max(lumaS, lumaM)));
  float rangeMin = min(min(lumaN, lumaW), min(lumaE, min(lumaS, lumaM)));
  float range = rangeMax - rangeMin;
  vec3 col = M.rgb;
  if (uFxaa > 0.5 && range >= max(EDGE_MIN, rangeMax * EDGE_T)) {
    float lumaNW = LA(posM + vec2(-1.0, -1.0) * T);
    float lumaSE = LA(posM + vec2(1.0, 1.0) * T);
    float lumaNE = LA(posM + vec2(1.0, -1.0) * T);
    float lumaSW = LA(posM + vec2(-1.0, 1.0) * T);
    float lumaNS = lumaN + lumaS;
    float lumaWE = lumaW + lumaE;
    float subpixRcpRange = 1.0 / range;
    float subpixNSWE = lumaNS + lumaWE;
    float edgeHorz1 = (-2.0 * lumaM) + lumaNS;
    float edgeVert1 = (-2.0 * lumaM) + lumaWE;
    float lumaNESE = lumaNE + lumaSE;
    float lumaNWNE = lumaNW + lumaNE;
    float edgeHorz2 = (-2.0 * lumaE) + lumaNESE;
    float edgeVert2 = (-2.0 * lumaN) + lumaNWNE;
    float lumaNWSW = lumaNW + lumaSW;
    float lumaSWSE = lumaSW + lumaSE;
    float edgeHorz4 = (abs(edgeHorz1) * 2.0) + abs(edgeHorz2);
    float edgeVert4 = (abs(edgeVert1) * 2.0) + abs(edgeVert2);
    float edgeHorz3 = (-2.0 * lumaW) + lumaNWSW;
    float edgeVert3 = (-2.0 * lumaS) + lumaSWSE;
    float edgeHorz = abs(edgeHorz3) + edgeHorz4;
    float edgeVert = abs(edgeVert3) + edgeVert4;
    float subpixNWSWNESE = lumaNWSW + lumaNESE;
    float lengthSign = T.x;
    bool horzSpan = edgeHorz >= edgeVert;
    float subpixA = subpixNSWE * 2.0 + subpixNWSWNESE;
    if (!horzSpan) { lumaN = lumaW; lumaS = lumaE; } else lengthSign = T.y;
    float subpixB = (subpixA * (1.0 / 12.0)) - lumaM;
    float gradientN = lumaN - lumaM;
    float gradientS = lumaS - lumaM;
    float lumaNN = lumaN + lumaM;
    float lumaSS = lumaS + lumaM;
    bool pairN = abs(gradientN) >= abs(gradientS);
    float gradient = max(abs(gradientN), abs(gradientS));
    if (pairN) lengthSign = -lengthSign;
    float subpixC = clamp(abs(subpixB) * subpixRcpRange, 0.0, 1.0);
    vec2 posB = posM;
    vec2 offNP = horzSpan ? vec2(T.x, 0.0) : vec2(0.0, T.y);
    if (!horzSpan) posB.x += lengthSign * 0.5; else posB.y += lengthSign * 0.5;
    vec2 posN = posB - offNP;
    vec2 posP = posB + offNP;
    float subpixD = ((-2.0) * subpixC) + 3.0;
    float lumaEndN = LA(posN);
    float subpixE = subpixC * subpixC;
    float lumaEndP = LA(posP);
    if (!pairN) lumaNN = lumaSS;
    float gradientScaled = gradient * 0.25;
    float lumaMM = lumaM - lumaNN * 0.5;
    float subpixF = subpixD * subpixE;
    bool lumaMLTZero = lumaMM < 0.0;
    lumaEndN -= lumaNN * 0.5;
    lumaEndP -= lumaNN * 0.5;
    bool doneN = abs(lumaEndN) >= gradientScaled;
    bool doneP = abs(lumaEndP) >= gradientScaled;
    for (int i = 0; i < 8; i++) {
      if (doneN && doneP) break;
      float s = stepSize(i);
      if (!doneN) { posN -= offNP * s; lumaEndN = LA(posN) - lumaNN * 0.5; doneN = abs(lumaEndN) >= gradientScaled; }
      if (!doneP) { posP += offNP * s; lumaEndP = LA(posP) - lumaNN * 0.5; doneP = abs(lumaEndP) >= gradientScaled; }
    }
    float dstN = horzSpan ? posM.x - posN.x : posM.y - posN.y;
    float dstP = horzSpan ? posP.x - posM.x : posP.y - posM.y;
    bool goodSpanN = (lumaEndN < 0.0) != lumaMLTZero;
    bool goodSpanP = (lumaEndP < 0.0) != lumaMLTZero;
    float spanLength = dstP + dstN;
    bool directionN = dstN < dstP;
    float dst = min(dstN, dstP);
    bool goodSpan = directionN ? goodSpanN : goodSpanP;
    float subpixG = subpixF * subpixF;
    float pixelOffset = (dst * (-1.0 / spanLength)) + 0.5;
    float subpixH = subpixG * SUBPIX;
    float pixelOffsetSubpix = max(goodSpan ? pixelOffset : 0.0, subpixH);
    vec2 pos = posM;
    if (!horzSpan) pos.x += pixelOffsetSubpix * lengthSign; else pos.y += pixelOffsetSubpix * lengthSign;
    col = textureLod(tSrc, pos, 0.0).rgb;
  }
  // unsharp mask (cross neighbourhood), backed off on edges so FXAA'd lines don't re-alias / halo
  // luma-only: sharpening rgb would amplify chromatic-aberration fringes into coloured 1px lines
  float blurL = (cN.a + cS.a + cE.a + cW.a) * 0.25; // (lumaN/S are reused by FXAA above)
  float edge = smoothstep(0.02, 0.09, range);
  col += (lumaM - blurL) * uSharpen * (1.0 - edge);
${hooks.map((h) => h.color ? '  {\n' + h.color + '\n  }' : '').join('\n')}
  // luminance-weighted grain: strongest in shadows/mids, faint in highlights (like film)
  float l = luma(col);
  float n = hash12(gl_FragCoord.xy + uSeed * vec2(17.31, 61.77)) + hash12(gl_FragCoord.xy * 1.37 + uSeed * vec2(41.13, 7.91)) - 1.0;
  col += n * uGrain * (1.0 - 0.75 * l);
  // TPDF dither (+-1 LSB, triangular) kills 8-bit banding in skies and fog
  float t = ign(gl_FragCoord.xy + uSeed * 5.588) + hash12(gl_FragCoord.xy + 37.0) - 1.0;
  col += t / 255.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export const FINAL = finalFrag(); // no hooks (kept for anything importing the plain final pass)

// ---------------------------------------------------------------- 13. full-res linear depth (current frame, after opaque)
// R32F metres, same convention as tZ. Consumers: soft particles drawn in post.transparent, decals, water.
export const DEPTH_FULL = /*glsl*/`
uniform sampler2D tDepth;
uniform vec2 uNF;
varying vec2 vUv;
${COMMON}
void main() {
  gl_FragColor = vec4(linDepth(texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r, uNF), 0.0, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------- 14. camera motion blur (full res HDR, optional)
// Velocity = reprojection of this pixel's depth through the previous frame's view-projection (camera motion
// only: moving objects are not tracked). MB_TAPS IGN-jittered taps centred on the pixel along the velocity,
// clamped to uMaxPx. Taps that land on the first-person overlay (z < 6 cm) are skipped so the gun never smears
// into the world, and overlay pixels themselves are left sharp.
export const MOTION = /*glsl*/`
uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform mat4 uInvVP;
uniform mat4 uPrevVP;
uniform vec2 uNF;
uniform vec2 uTexel;
uniform float uScale;
uniform float uMaxPx;
varying vec2 vUv;
${COMMON}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c0 = texelFetch(tSrc, p, 0).rgb;
  float d = texelFetch(tDepth, p, 0).r;
  if (linDepth(d, uNF) < 0.06) { gl_FragColor = vec4(c0, 1.0); return; }
  vec4 wp = uInvVP * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  wp /= wp.w;
  vec4 pc = uPrevVP * wp;
  if (pc.w <= 1e-4) { gl_FragColor = vec4(c0, 1.0); return; }
  vec2 v = (vUv - (pc.xy / pc.w * 0.5 + 0.5)) * uScale;
  float lp = length(v / uTexel);
  if (lp < 0.75) { gl_FragColor = vec4(c0, 1.0); return; }
  if (lp > uMaxPx) v *= uMaxPx / lp;
  float j = ign(gl_FragCoord.xy) - 0.5;
  vec3 acc = c0;
  float w = 1.0;
  for (int i = 0; i < MB_TAPS; i++) {
    vec2 uv = vUv + v * ((float(i) + 0.5 + j) / float(MB_TAPS) - 0.5);
    if (linDepth(texture2D(tDepth, uv).r, uNF) < 0.06) continue;
    acc += texture2D(tSrc, uv).rgb;
    w += 1.0;
  }
  gl_FragColor = vec4(acc / w, 1.0);
}
`;

// ---------------------------------------------------------------- ?post=0 bypass: plain ACES (what three's stock tonemapping would give)
export const BYPASS = /*glsl*/`
uniform sampler2D tColor;
uniform float uExposure;
varying vec2 vUv;
vec3 acesHill(vec3 c) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = IN * (c / 0.6);
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(OUT * (a / b), 0.0, 1.0);
}
void main() {
  vec3 c = acesHill(texture2D(tColor, vUv).rgb * uExposure);
  gl_FragColor = vec4(mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)), 1.0);
}
`;

// ---------------------------------------------------------------- debug view (?postdbg=ao|vol|depth|bloom|adapt)
export const DEBUG = /*glsl*/`
uniform sampler2D tSrc;
uniform int uMode;
varying vec2 vUv;
void main() {
  vec4 s = texture2D(tSrc, vUv);
  vec3 c = s.rgb;
  if (uMode == 1) c = vec3(s.r);                                   // ao
  else if (uMode == 2) c = abs(s.rgb) / (1.0 + abs(s.rgb));       // vol inscatter (Reinhard; atmos mode: |removed sun in-scatter|)
  else if (uMode == 3) c = vec3(fract(log2(max(s.r, 1e-3)) * 0.5));  // linear depth bands (1 band per x4)
  else if (uMode == 4) c = s.rgb / (1.0 + s.rgb);                   // bloom
  else if (uMode == 5) c = vec3(s.a);                                // vol transmittance
  gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}
`;
