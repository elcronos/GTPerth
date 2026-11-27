// GLSL noise library (GLSL ES 3.00 / WebGL2). One string, include-guarded, so several patches can paste it
// into the same shader without redefinition errors.
//
//   import { NOISE_GLSL } from './noise.glsl.js';
//   shader.fragmentShader = NOISE_GLSL + shader.fragmentShader;   // or insert after #include <common>
//
// Conventions
//   - `s` is a seed (any float, truncated to int): different seeds give uncorrelated fields.
//   - *P variants are PERIODIC: `per` is the period in lattice cells (whole numbers). Use them in texture bakes:
//     with uv in [0,1) and frequency F, call fooP(uv*F, vec2(F), ...) and the result tiles seamlessly.
//     fbmP / ridgedP double the frequency each octave, so whole-number periods stay whole.
//   - Ranges: hash* [0,1); vnoise [0,1]; gnoise ~[-1,1]; fbm/ridged [0,1] (mostly 0.2-0.8 for fbm);
//     voronoi returns vec4(F1, F2, distance-to-edge, cell hash in [0,1)), distances in cell units.
//   - 3D runtime noise (vnoise3/fbm3) is non-periodic and cheap; use it in world-space material patches.
//   - Hash: pcg3d (Jarzynski & Olano 2020, "Hash Functions for GPU Rendering") — integer, no sin() banding.
export const NOISE_GLSL = /*glsl*/`
#ifndef NZ_LIB
#define NZ_LIB
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
// top 24 bits -> exact floats in [0,1)
vec3 hash3i(ivec3 p) { return vec3(pcg3d(uvec3(p)) >> 8u) * (1.0 / 16777216.0); }
float hash21(ivec2 p, float s) { return hash3i(ivec3(p, int(s))).x; }
vec2 hash22(ivec2 p, float s) { return hash3i(ivec3(p, int(s))).xy; }
vec3 hash32(ivec2 p, float s) { return hash3i(ivec3(p, int(s))); }
// float-coordinate convenience (cells of size 1)
float hash12(vec2 p, float s) { return hash21(ivec2(floor(p)), s); }
// wrap a lattice coordinate into [0,per); per <= 0 means "no wrap"
ivec2 nzWrap(ivec2 i, ivec2 per) {
  if (per.x > 0) i.x = ((i.x % per.x) + per.x) % per.x;
  if (per.y > 0) i.y = ((i.y % per.y) + per.y) % per.y;
  return i;
}
vec2 nzFade(vec2 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

// ---- value noise ------------------------------------------------------------------------------------
float vnoiseP(vec2 p, vec2 per, float s) {
  ivec2 i = ivec2(floor(p)), P = ivec2(per);
  vec2 f = fract(p), u = nzFade(f);
  float a = hash21(nzWrap(i, P), s), b = hash21(nzWrap(i + ivec2(1, 0), P), s);
  float c = hash21(nzWrap(i + ivec2(0, 1), P), s), d = hash21(nzWrap(i + ivec2(1, 1), P), s);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float vnoise(vec2 p, float s) { return vnoiseP(p, vec2(0.0), s); }

// ---- gradient (Perlin-style) noise ------------------------------------------------------------------
vec2 nzGrad(ivec2 i, float s) { float a = hash21(i, s) * 6.2831853; return vec2(cos(a), sin(a)); }
float gnoiseP(vec2 p, vec2 per, float s) {
  ivec2 i = ivec2(floor(p)), P = ivec2(per);
  vec2 f = fract(p), u = nzFade(f);
  float a = dot(nzGrad(nzWrap(i, P), s), f);
  float b = dot(nzGrad(nzWrap(i + ivec2(1, 0), P), s), f - vec2(1.0, 0.0));
  float c = dot(nzGrad(nzWrap(i + ivec2(0, 1), P), s), f - vec2(0.0, 1.0));
  float d = dot(nzGrad(nzWrap(i + ivec2(1, 1), P), s), f - vec2(1.0, 1.0));
  return 1.41 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float gnoise(vec2 p, float s) { return gnoiseP(p, vec2(0.0), s); }

// ---- fractal sums -----------------------------------------------------------------------------------
// fbm in [0,1] (gain 0.5, lacunarity 2). oct <= 10.
float fbmP(vec2 p, vec2 per, int oct, float s) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int k = 0; k < 10; k++) {
    if (k >= oct) break;
    sum += amp * gnoiseP(p, per, s + float(k) * 13.0);
    norm += amp; p *= 2.0; per *= 2.0; amp *= 0.5;
  }
  return 0.5 + 0.5 * sum / norm;
}
float fbm(vec2 p, int oct, float s) { return fbmP(p, vec2(0.0), oct, s); }
// ridged multifractal in [0,1]: sharp crests (rock, cracks, veins)
float ridgedP(vec2 p, vec2 per, int oct, float s) {
  float sum = 0.0, amp = 0.5, norm = 0.0, w = 1.0;
  for (int k = 0; k < 10; k++) {
    if (k >= oct) break;
    float r = 1.0 - abs(gnoiseP(p, per, s + float(k) * 7.0));
    r *= r * w; w = clamp(r * 2.0, 0.0, 1.0);
    sum += amp * r; norm += amp; p *= 2.0; per *= 2.0; amp *= 0.5;
  }
  return sum / norm;
}
float ridged(vec2 p, int oct, float s) { return ridgedP(p, vec2(0.0), oct, s); }

// ---- Voronoi / cellular -----------------------------------------------------------------------------
// vec4(F1, F2, edge distance, cell hash). Two-pass exact edge distance (Quilez). jitter 0..1.
vec4 voronoiP(vec2 p, vec2 per, float jitter, float s) {
  ivec2 i = ivec2(floor(p)), P = ivec2(per);
  vec2 f = fract(p);
  float F1 = 8.0, F2 = 8.0, id = 0.0;
  vec2 mr = vec2(0.0); ivec2 mg = ivec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 g = ivec2(x, y);
    vec3 h = hash32(nzWrap(i + g, P), s);
    vec2 r = vec2(g) + h.xy * jitter - f;
    float d = dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; mr = r; mg = g; id = h.z; } else if (d < F2) { F2 = d; }
  }
  float ed = 8.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    ivec2 g = mg + ivec2(x, y);
    vec2 r = vec2(g) + hash32(nzWrap(i + g, P), s).xy * jitter - f;
    vec2 dr = r - mr;
    if (dot(dr, dr) > 1e-5) ed = min(ed, dot(0.5 * (mr + r), normalize(dr)));
  }
  return vec4(sqrt(F1), sqrt(F2), ed, id);
}
vec4 voronoi(vec2 p, float s) { return voronoiP(p, vec2(0.0), 1.0, s); }
// cheaper F1 + id only (3x3), for runtime use
vec2 voronoiF1(vec2 p, float jitter, float s) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p);
  float F1 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 h = hash32(i + ivec2(x, y), s);
    vec2 r = vec2(x, y) + h.xy * jitter - f;
    float d = dot(r, r);
    if (d < F1) { F1 = d; id = h.z; }
  }
  return vec2(sqrt(F1), id);
}

// ---- 3D runtime noise (world space, non periodic) ---------------------------------------------------
float vnoise3(vec3 p) {
  ivec3 i = ivec3(floor(p)); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash3i(i).x, b = hash3i(i + ivec3(1, 0, 0)).x, c = hash3i(i + ivec3(0, 1, 0)).x, d = hash3i(i + ivec3(1, 1, 0)).x;
  float e = hash3i(i + ivec3(0, 0, 1)).x, g = hash3i(i + ivec3(1, 0, 1)).x, h = hash3i(i + ivec3(0, 1, 1)).x, k = hash3i(i + ivec3(1, 1, 1)).x;
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
float fbm3(vec3 p, int oct) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int k = 0; k < 6; k++) {
    if (k >= oct) break;
    sum += amp * vnoise3(p); norm += amp; p = p * 2.03 + 17.1; amp *= 0.5;
  }
  return sum / norm;
}

// ---- interleaved gradient noise (Jimenez 2014): per-pixel dither / jitter in [0,1) ------------------
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }
#endif
`;
