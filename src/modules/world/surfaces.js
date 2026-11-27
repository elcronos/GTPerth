// Perth-specific procedural surfaces registered into the cookbook's SURFACES table (baked by materials/bake.js like
// the built-ins). Albedos are linear. Every program tiles (periodic helpers only).
import { SURFACES } from '../../cookbook/materials/surfaces.glsl.js';

// Elizabeth Quay / Barrack Square paving: large pale granite + limestone pavers, 0.6 x 0.3 m stretcher bond,
// slightly varied tones, fine joints, light grime.
const eqPavers = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  vec2 m = uv * uScaleM;
  float row = floor(m.y / 0.3);
  vec2 q = vec2(m.x / 0.6 + 0.5 * mod(row, 2.0), m.y / 0.3);
  vec2 cell = floor(q); vec2 f = fract(q);
  vec2 dEdge = min(f, 1.0 - f) * vec2(0.6, 0.3);
  float dJ = min(dEdge.x, dEdge.y);
  ivec2 nC = ivec2(int(max(1.0, floor(uScaleM / 0.6 + 0.5))), int(max(1.0, floor(uScaleM / 0.3 + 0.5))));
  ivec2 ci = nzWrap(ivec2(cell), nC);
  float h1 = hash21(ci, 3.0), h2 = hash21(ci, 7.0);
  float joint = 1.0 - smoothstep(0.0025, 0.0045, dJ);
  float bevel = 1.0 - smoothstep(0.0, 0.012, dJ);
  float fine = nfbm(uv, 60.0, 3, 2.0), mid = nfbm(uv, 3.0, 4, 4.0), speck = step(0.78, nval(uv, 220.0, 5.0));
  vec3 granite = vec3(0.105, 0.103, 0.10), lime = vec3(0.13, 0.127, 0.12), dark = vec3(0.075, 0.074, 0.075);   // EQ granite setts: charcoal + mid grey (photo-matched)
  vec3 col = mix(mix(granite, lime, step(0.72, h1)), dark, step(0.88, h1));
  col = mix(col, dark, step(0.93, h2) * 0.8);
  col *= (0.94 + 0.1 * h2) * (0.92 + 0.12 * fine);
  col = mix(col, col * vec3(0.55, 0.55, 0.6), speck * 0.35);
  float grime = smoothstep(0.45, 0.85, nfbm(uv, 0.8, 4, 9.0)); col *= 1.0 - 0.28 * grime;
  float wearPath = smoothstep(0.55, 0.9, nfbm(uv, 0.42, 3, 21.0)); col = mix(col, col * vec3(1.06, 1.04, 1.0), wearPath * 0.5);
  float gum = (1.0 - smoothstep(0.0, 0.08, nvor(uv, 3.0, 1.0, 11.0).x)) * step(0.9, nvor(uv, 3.0, 1.0, 11.0).w);
  col = mix(col, vec3(0.08, 0.075, 0.075), gum * 0.6);
  col = mix(col, vec3(0.035, 0.033, 0.03), joint);
  s.albedo = col;
  s.height = 0.7 + 0.04 * fine + 0.02 * mid - bevel * bevel * 0.25 - joint * 0.5;
  s.rough = clamp(0.52 + 0.1 * fine + grime * 0.08 + joint * 0.2 - step(0.55, h1) * 0.05 - wearPath * 0.08, 0.0, 1.0);
  s.ao = mix(1.0, 0.45, joint);
  s.mask = 1.0;
}`;

// Kikuyu / couch lawn, late spring: green with dry yellow patches, mowing stripes, blade-scale noise.
const lawn = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  vec2 m = uv * uScaleM;
  float big = nfbm(uv, 0.35, 4, 1.0), mid = nfbm(uv, 1.6, 4, 2.0);
  float blades = nfbm2(uv, vec2(90.0, 30.0), 3, 3.0), micro = nfbm(uv, 240.0, 2, 4.0);
  float clump = nvor(uv, 9.0, 1.0, 5.0).x;
  vec3 green = vec3(0.058, 0.078, 0.036), lush = vec3(0.05, 0.085, 0.034), dry = vec3(0.18, 0.155, 0.07);
  vec3 col = mix(green, lush, mid);
  col = mix(col, dry, smoothstep(0.50, 0.80, big) * 0.8);
  col *= 0.72 + 0.5 * blades;
  col *= 0.85 + 0.25 * smoothstep(0.0, 0.5, clump);
  float stripe = step(0.5, fract(m.x / 1.2));
  col *= 0.97 + 0.05 * stripe;
  float soil = smoothstep(0.86, 0.97, nfbm(uv, 2.0, 5, 7.0));
  col = mix(col, vec3(0.16, 0.12, 0.08), soil * 0.5);
  s.albedo = col; s.height = 0.5 + 0.3 * blades + 0.1 * micro - soil * 0.2;
  s.rough = 0.88 + 0.08 * micro; s.ao = 0.75 + 0.25 * blades; s.mask = 1.0;
}`;

// Kings Park bushland floor: pale grey Bassendean sand, eucalypt leaf litter, twigs, dark low shrubs.
const bush = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  float big = nfbm(uv, 0.4, 4, 1.0), mid = nfbm(uv, 2.0, 5, 2.0), fine = nfbm(uv, 40.0, 3, 3.0);
  vec4 lv = nvor(uv, 14.0, 1.0, 4.0);
  float leaf = (1.0 - smoothstep(0.15, 0.32, lv.x)) * step(0.35, lv.w);
  vec4 sh = nvor(uv, 1.4, 1.0, 6.0);
  float shrub = (1.0 - smoothstep(0.25, 0.8, sh.x)) * step(0.12, sh.w);   // dense understorey: from afar the bush reads as dark canopy
  vec3 sand = vec3(0.26, 0.24, 0.2) * (0.85 + 0.25 * fine);
  vec3 litter = mix(vec3(0.22, 0.14, 0.08), vec3(0.32, 0.25, 0.14), lv.w);
  vec3 col = mix(sand, litter, leaf * 0.85);
  col = mix(col, mix(vec3(0.045, 0.065, 0.03), vec3(0.08, 0.095, 0.05), big) * (0.7 + 0.6 * fine), shrub * 0.95);
  col *= 0.85 + 0.3 * mid;
  col = mix(col, col * vec3(1.05, 0.95, 0.85), smoothstep(0.5, 0.8, big) * 0.4);
  s.albedo = col; s.height = 0.4 + 0.2 * fine + 0.3 * shrub + 0.1 * leaf;
  s.rough = 0.92; s.ao = mix(1.0, 0.6, shrub); s.mask = 1.0;
}`;

// Exposed limestone (Kings Park escarpment, quay copings): creamy, pitted, layered.
const limestone = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  float big = nfbm(uv, 0.7, 4, 1.0), mid = nfbm(uv, 3.0, 5, 2.0), fine = nfbm(uv, 30.0, 3, 3.0);
  vec4 v = nvor(uv, 18.0, 1.0, 5.0); float pit = (1.0 - smoothstep(0.03, 0.12, v.x)) * step(0.6, v.w);
  float strata = sin(uv.y * uScaleM * 6.2831853 * 1.3 + 3.0 * big) * 0.5 + 0.5;
  vec3 col = mix(vec3(0.52, 0.45, 0.34), vec3(0.62, 0.56, 0.44), mid) * (0.85 + 0.2 * fine) * (0.9 + 0.1 * strata);
  col = mix(col, vec3(0.2, 0.18, 0.15), pit * 0.6);
  col = mix(col, col * vec3(0.7, 0.72, 0.62), smoothstep(0.6, 0.85, big) * 0.5);
  s.albedo = col; s.height = 0.5 + 0.25 * mid + 0.1 * fine - pit * 0.3 + 0.08 * strata;
  s.rough = 0.85; s.ao = 1.0 - pit * 0.5; s.mask = 1.0;
}`;

// River sand (South Perth foreshore beaches) — wet near the water handled in the shader.
const riverSand = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  float mid = nfbm(uv, 2.0, 5, 2.0), fine = nfbm(uv, 50.0, 3, 3.0);
  vec4 v = nvor(uv, 30.0, 1.0, 4.0); float peb = (1.0 - smoothstep(0.1, 0.3, v.x)) * step(0.85, v.w);
  vec3 col = vec3(0.50, 0.44, 0.34) * (0.85 + 0.25 * fine) * (0.9 + 0.2 * mid);
  col = mix(col, vec3(0.3, 0.27, 0.22), peb);
  s.albedo = col; s.height = 0.5 + 0.2 * mid + 0.1 * fine + peb * 0.3; s.rough = 0.9; s.ao = 1.0; s.mask = 1.0;
}`;

// Painted steel / aluminium panels (cladding, ferry superstructure) — clean factory finish with faint streaks.
const cleanPaint = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  float mid = nfbm(uv, 2.0, 4, 2.0), fine = nfbm(uv, 60.0, 2, 3.0);
  float streak = nfbm2(uv, vec2(12.0, 0.8), 3, 5.0);
  vec3 col = vec3(0.8) * (0.96 + 0.05 * mid) * (1.0 - 0.06 * smoothstep(0.55, 0.9, streak));
  s.albedo = col; s.height = 0.5 + 0.02 * fine; s.rough = 0.32 + 0.12 * mid + 0.1 * streak; s.ao = 1.0; s.mask = 1.0;
}`;

const S = (glsl, scale, depth, tint, porosity, extra = {}) => ({ glsl, scale, depth, tint, porosity, ...extra });
export function registerSurfaces() {
  SURFACES.eq_pavers = S(eqPavers, 2.4, 0.006, 0xffffff, 0.9, { ground: true, note: 'Elizabeth Quay granite/limestone pavers' });
  SURFACES.lawn = S(lawn, 4, 0.02, 0xffffff, 0.9, { ground: true, note: 'lawn' });
  SURFACES.bush = S(bush, 4, 0.03, 0xffffff, 0.9, { ground: true, note: 'Kings Park bushland floor' });
  SURFACES.limestone = S(limestone, 4, 0.05, 0xffffff, 0.8, { note: 'limestone' });
  SURFACES.river_sand = S(riverSand, 2, 0.01, 0xffffff, 0.9, { ground: true, note: 'river sand' });
  SURFACES.clean_paint = S(cleanPaint, 2, 0.001, 0xffffff, 0.2, { note: 'factory paint' });
}
