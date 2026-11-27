// Tuned procedural surface programs for bake.js. Each entry:
//   { glsl: 'void surf(vec2 uv, inout Surf s) {...}', scale: metres per tile (UV unit 0..1), depth: metres of relief for
//     height 0..1, tint: default material.color (sRGB hex, multiplies albedo where s.mask = 1), porosity: how much rain
//     darkens it (0 = metal/glass, 1 = concrete/wood), emissive?: true if s.emit is used }
// Geometry UVs are expected in METRES (1 UV unit = 1 m); library.js divides by `scale`, so a 4 m concrete tile spans
// 4 m of mesh. Every program tiles: all noise goes through periodic helpers with whole-number frequencies (fq()).
// Albedo values are linear and physically plausible (fresh snow 0.85, concrete 0.3-0.4, asphalt ~0.1, rust 0.1-0.4).
//
// SURF_LIB helpers (available to your own surf programs too):
//   fq(perMetre)                      whole-number frequency per tile closest to `perMetre` features per metre
//   nfbm(uv, perM, oct, seed)         periodic fbm [0,1];  nfbm2(uv, vec2 perM, oct, seed) anisotropic
//   nridge(uv, perM, oct, seed)       periodic ridged [0,1];  nval(uv, perM, seed) periodic value noise [0,1]
//   ngrad(uv, perM, seed)             periodic gradient noise [-1,1]
//   nvor(uv, perM, jitter, seed)      periodic Voronoi vec4(F1, F2, edge, id) in cell units
//   warpP(uv, perM, amtUV, seed)      periodic domain warp
//   isoLine(field, widthM)            anti-aliased line along the zero set of `field`, metric width (crack networks)
//   scratches(uv, perM, seed, widthM, angle, angleJitter, density, len)   periodic scratch segments
//   paintDamage(uv, amount, seed)     vec3(chip, halo, runs): chips through paint, primer halo, rust runs below chips
//   rustColor(t)                      dark scale -> orange -> ochre ramp, t in [0,1]
//   planks(uv, perMAcross, seed)      vec4(alongFrac, acrossFrac, rowId, rowHash) for plank layouts
export const SURF_LIB = /*glsl*/`
float sat(float x) { return clamp(x, 0.0, 1.0); }
float fq(float perM) { return max(1.0, floor(perM * uScaleM + 0.5)); }
float nfbm(vec2 uv, float perM, int oct, float sd) { float f = fq(perM); return fbmP(uv * f, vec2(f), oct, sd); }
float nfbm2(vec2 uv, vec2 perM, int oct, float sd) { vec2 f = vec2(fq(perM.x), fq(perM.y)); return fbmP(uv * f, f, oct, sd); }
float nridge(vec2 uv, float perM, int oct, float sd) { float f = fq(perM); return ridgedP(uv * f, vec2(f), oct, sd); }
float nval(vec2 uv, float perM, float sd) { float f = fq(perM); return vnoiseP(uv * f, vec2(f), sd); }
float ngrad(vec2 uv, float perM, float sd) { float f = fq(perM); return gnoiseP(uv * f, vec2(f), sd); }
vec4 nvor(vec2 uv, float perM, float jit, float sd) { float f = fq(perM); return voronoiP(uv * f, vec2(f), jit, sd); }
vec2 warpP(vec2 uv, float perM, float amt, float sd) {
  return uv + amt * (vec2(nfbm(uv, perM, 3, sd), nfbm(uv, perM, 3, sd + 5.0)) - 0.5);
}
// texels per metre of the bake target
float texPerM() { return 1.0 / (uTexel * uScaleM); }
float isoLine(float g, float widthM) {
  float hw = max(0.5 * widthM * texPerM(), 0.6);
  float d = abs(g) / max(fwidth(g), 1e-6);
  return 1.0 - smoothstep(hw, hw + 1.0, d);
}
float scratches(vec2 uv, float perM, float sd, float widthM, float ang, float angJit, float density, float len) {
  float f = fq(perM); vec2 p = uv * f; ivec2 i = ivec2(floor(p)); vec2 fr = fract(p);
  float wCell = max(widthM * f / uScaleM, 0.8 * uTexel * f);
  float r = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 g = ivec2(x, y), c = nzWrap(i + g, ivec2(f));
    vec3 h = hash32(c, sd);
    if (h.z > density) continue;
    float a = ang + (hash21(c, sd + 1.0) - 0.5) * angJit * 6.2831853;
    vec2 dir = vec2(cos(a), sin(a)), d = fr - (vec2(g) + h.xy);
    float hl = 0.5 * len * (0.4 + 0.6 * hash21(c, sd + 2.0));
    float t = clamp(dot(d, dir), -hl, hl);
    float dist = length(d - dir * t);
    float taper = 1.0 - pow(abs(t) / hl, 4.0);
    r = max(r, (1.0 - smoothstep(0.0, wCell, dist)) * taper * (0.5 + 0.5 * h.z / density));
  }
  return r;
}
vec3 rustColor(float t) {
  vec3 a = vec3(0.075, 0.040, 0.025), b = vec3(0.24, 0.085, 0.032), c = vec3(0.42, 0.20, 0.07);
  t = sat(t);
  return t < 0.55 ? mix(a, b, t / 0.55) : mix(b, c, (t - 0.55) / 0.45);
}
float pdChip(vec2 uv, float th, float sd) {
  float n = nfbm(uv, 6.0, 6, sd) + (nfbm(uv, 40.0, 3, sd + 2.0) - 0.5) * 0.3;
  return smoothstep(th, th + 0.01, n);
}
vec3 paintDamage(vec2 uv, float amt, float sd) {
  float zone = smoothstep(0.4, 0.68, nfbm(uv, 1.5, 3, sd + 7.0));       // damage clusters; most paint is intact
  float th = mix(0.84, 0.63, sat(amt * (0.15 + 0.85 * zone)));
  float n = nfbm(uv, 6.0, 6, sd) + (nfbm(uv, 40.0, 3, sd + 2.0) - 0.5) * 0.3;
  float chip = smoothstep(th, th + 0.01, n);
  float halo = smoothstep(th - 0.03, th, n) * (1.0 - chip);
  float c2 = smoothstep(0.79 - 0.06 * amt, 0.8 - 0.06 * amt, nfbm(uv, 30.0, 4, sd + 3.0)) * zone;   // small chips near big ones
  chip = max(chip, c2);
  float run = 0.0, stepUV = 0.02 / uScaleM;
  for (int k = 1; k <= 5; k++) {
    float src = pdChip(uv + vec2(0.0, float(k) * stepUV), th, sd);
    run = max(run, src * (1.0 - float(k) / 6.0));
  }
  run *= smoothstep(0.42, 0.72, nfbm2(uv, vec2(45.0, 1.0), 3, sd + 5.0)) * (1.0 - chip);
  return vec3(chip, halo, run);
}
vec4 planks(vec2 uv, float perMAcross, float sd) {
  float NR = fq(perMAcross);
  float row = floor(uv.y * NR);
  float o = hash21(ivec2(int(mod(row, NR)), 3), sd);
  return vec4(fract(uv.x + o), fract(uv.y * NR), row, o);
}
`;

const asphalt = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  // dark binder with dense sand-size speckle; coarse aggregate only peeks through where the binder is worn
  float mid = nfbm(uv, 3.0, 4, 2.0), wearZ = 0.35 + 0.65 * smoothstep(0.4, 0.7, nfbm(uv, 8.0, 4, 13.0));
  float sp1 = nval(uv, 420.0, 4.0), sp2 = nval(uv, 260.0, 5.0), grain = nfbm(uv, 600.0, 2, 6.0);
  vec4 v = nvor(uv, 60.0, 0.95, 3.0);
  float st = smoothstep(0.05, 0.18, v.z) * step(0.55, v.w) * wearZ;
  vec3 col = vec3(0.05, 0.049, 0.047) * (0.88 + 0.24 * mid);
  col = mix(col, vec3(0.12, 0.115, 0.11), smoothstep(0.6, 0.8, sp1) * 0.7);
  col = mix(col, vec3(0.02), smoothstep(0.65, 0.85, sp2) * 0.5);
  col = mix(col, mix(vec3(0.07, 0.068, 0.065), vec3(0.11, 0.105, 0.1), fract(v.w * 7.13)), st * 0.6);
  col *= 0.9 + 0.2 * grain;
  vec2 wu = warpP(uv, 2.0, 0.03, 8.0);
  float crack = isoLine(ngrad(wu, 1.5, 9.0) + 0.3 * ngrad(wu, 6.0, 10.0), 0.0025) * smoothstep(0.58, 0.7, nfbm(uv, 1.5, 3, 11.0));
  float h = 0.5 + st * 0.25 * smoothstep(0.0, 0.25, v.z) + sp1 * 0.08 + grain * 0.08 + mid * 0.05;
  col = mix(col, vec3(0.018), crack * 0.85); h -= crack * 0.3;
  s.albedo = col; s.height = h;
  s.rough = mix(0.88 - 0.05 * sp1, 0.7, st * 0.6);
  s.ao = (0.7 + 0.3 * smoothstep(0.35, 0.75, h)) * (1.0 - crack * 0.5);
  s.mask = 1.0;
}`;

const concrete = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  vec2 m = uv * uScaleM;
  // 2 m slabs with saw-cut joints
  vec2 sl = fract(m * 0.5); vec2 dj = min(sl, 1.0 - sl) * 2.0;
  float dJ = min(dj.x, dj.y);
  float nS = max(1.0, floor(uScaleM * 0.5 + 0.5));
  float slabH = hash21(nzWrap(ivec2(floor(m * 0.5)), ivec2(nS)), 11.0);
  float jw = 0.004 + 0.0015 * nfbm(uv, 8.0, 2, 14.0);
  float joint = 1.0 - smoothstep(jw, jw + 0.002, dJ);
  float chamfer = 1.0 - smoothstep(0.0, 0.015, dJ);
  float big = nfbm(uv, 0.45, 4, 1.0), mid = nfbm(uv, 2.5, 5, 2.0), fine = nfbm(uv, 35.0, 3, 3.0), micro = nfbm(uv, 260.0, 2, 4.0);
  vec4 v = nvor(uv, 110.0, 0.9, 5.0); float agg = smoothstep(0.08, 0.2, v.z) * step(0.62, v.w);
  vec4 vp = nvor(uv, 70.0, 1.0, 6.0); float pore = (1.0 - smoothstep(0.05, 0.11, vp.x)) * step(0.82, vp.w);
  vec2 wu = warpP(uv, 2.0, 0.025, 7.0);
  float crack = isoLine(ngrad(wu, 1.1, 9.0) + 0.3 * ngrad(wu, 4.5, 10.0), 0.0012 + 0.0015 * fine) * smoothstep(0.56, 0.7, nfbm(uv, 0.7, 3, 12.0));
  vec3 col = vec3(0.34, 0.33, 0.31) * (0.86 + 0.24 * slabH) * (0.82 + 0.36 * mid) * (0.93 + 0.14 * fine);
  col = mix(col, col * vec3(1.06, 1.0, 0.9) * 1.08, smoothstep(0.35, 0.7, big) * 0.6);
  col = mix(col, vec3(0.44, 0.43, 0.41), agg * 0.3);
  col *= 1.0 - pore * 0.55;
  float stain = smoothstep(0.55, 0.82, nfbm(uv, 0.9, 5, 13.0)); col *= 1.0 - 0.28 * stain;
  float edgeDirt = (1.0 - smoothstep(0.0, 0.06, dJ)) * 0.3; col *= 1.0 - edgeDirt;
  col = mix(col, vec3(0.045, 0.04, 0.035), joint);
  col = mix(col, col * 0.3, crack);
  float h = 0.62 + 0.07 * mid + 0.035 * fine + 0.03 * micro - pore * 0.22 + agg * 0.03;
  h -= chamfer * chamfer * 0.2; h = mix(h, 0.08, joint); h -= crack * 0.3;
  s.albedo = col; s.height = h;
  s.rough = clamp(0.86 + 0.1 * (micro - 0.5) - stain * 0.08 + joint * 0.1, 0.0, 1.0);
  s.ao = mix(1.0, 0.35, joint) * (1.0 - crack * 0.5) * (1.0 - pore * 0.4) * (1.0 - edgeDirt * 0.5);
  s.mask = 1.0 - joint;
}`;

const paintedMetal = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  vec3 dmg = paintDamage(uv, 0.65, 20.0);
  float peel = nfbm(uv, 110.0, 2, 1.0), mid = nfbm(uv, 2.0, 4, 2.0);
  float dirt = smoothstep(0.45, 0.78, nfbm(uv, 1.5, 5, 3.0));
  float scr = scratches(uv, 5.0, 4.0, 0.0005, 0.25, 0.25, 0.25, 1.2) * smoothstep(0.4, 0.65, nfbm(uv, 1.5, 3, 9.0));
  float rustT = nfbm(uv, 25.0, 4, 5.0);
  float bare = smoothstep(0.62, 0.74, nfbm(uv, 45.0, 3, 6.0));
  vec3 steel = vec3(0.45, 0.45, 0.46), oxide = vec3(0.10, 0.045, 0.028);
  vec3 chipCol = mix(rustColor(0.15 + rustT * 0.6), steel, bare * 0.35);
  float paint = 1.0 - dmg.x;
  vec3 col = vec3(0.86) * (0.92 + 0.1 * mid) * (0.97 + 0.06 * peel);
  col = mix(col, oxide, dmg.y * 0.7);
  col = mix(col, chipCol, dmg.x);
  col = mix(col, rustColor(0.4), dmg.z * 0.7);
  col = mix(col, vec3(0.12, 0.11, 0.1), scr * paint * 0.7);
  col *= 1.0 - dirt * 0.22;
  s.albedo = col;
  s.mask = paint * (1.0 - dmg.y * 0.7) * (1.0 - dmg.z * 0.7) * (1.0 - scr * 0.7);
  s.metal = dmg.x * bare * 0.8;
  float pr = 0.4 + 0.08 * mid + 0.12 * dirt + 0.04 * peel;
  s.rough = mix(pr, mix(0.88, 0.45, bare), dmg.x);
  s.rough = mix(s.rough, 0.8, dmg.z * 0.6); s.rough = mix(s.rough, 0.55, scr * 0.5);
  s.height = 0.45 + paint * 0.35 + peel * 0.05 - scr * 0.12 + (1.0 - paint) * rustT * 0.15 + dmg.z * 0.04;
  s.ao = 1.0 - (1.0 - paint) * 0.25;
}`;

const rust = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  float t = nfbm(uv, 7.0, 6, 1.0), t2 = nfbm(uv, 55.0, 3, 2.0);
  vec4 fl = nvor(warpP(uv, 6.0, 0.02, 9.0), 28.0, 1.0, 3.0);
  float flake = smoothstep(0.02, 0.09, fl.z) * step(0.5, fl.w) * smoothstep(0.42, 0.6, nfbm(uv, 3.5, 3, 4.0)) * 0.6;
  vec4 pits = nvor(uv, 180.0, 1.0, 5.0); float pit = (1.0 - smoothstep(0.12, 0.32, pits.x)) * step(0.72, pits.w);
  // paint remnants: ragged (high-frequency edge noise), only in a few zones, and themselves rust-bled and chalky
  float remN = nfbm(uv, 2.0, 5, 6.0) + (nfbm(uv, 14.0, 4, 16.0) - 0.5) * 0.2 + (nfbm(uv, 70.0, 2, 17.0) - 0.5) * 0.07;
  float paintRem = smoothstep(0.725, 0.74, remN) * (1.0 - pit);
  float bleed = smoothstep(0.35, 0.75, nfbm(uv, 40.0, 3, 18.0)) * 0.55 + smoothstep(0.5, 0.8, nfbm2(uv, vec2(30.0, 3.0), 3, 19.0)) * 0.35;
  vec3 col = rustColor(t * 0.65 + t2 * 0.35 + flake * 0.15 - 0.05);
  col = mix(col, vec3(0.05, 0.03, 0.02), pit * 0.8);
  float dark = smoothstep(0.5, 0.72, nfbm2(uv, vec2(2.0, 9.0), 4, 7.0)); col = mix(col, vec3(0.06, 0.045, 0.035), dark * 0.55);
  float ochre = smoothstep(0.62, 0.82, nfbm(uv, 4.0, 4, 8.0)); col = mix(col, vec3(0.40, 0.25, 0.08), ochre * 0.45);
  float edgeP = smoothstep(0.70, 0.735, remN) * (1.0 - paintRem);
  col = mix(col, vec3(0.13, 0.055, 0.03), edgeP * 0.6);
  float rb = sat(bleed);
  vec3 paintC = mix(vec3(0.5) * (0.85 + 0.3 * t2), rustColor(0.35 + 0.3 * t2), rb);
  col = mix(col, paintC, paintRem);
  s.albedo = col; s.mask = paintRem * (1.0 - rb) * 0.9;
  s.height = 0.35 + t * 0.3 + flake * 0.22 + t2 * 0.1 - pit * 0.28 + paintRem * 0.12;
  s.rough = mix(mix(0.9, 0.76, flake), mix(0.68, 0.85, rb), paintRem);
  s.metal = 0.0;
  s.ao = 0.65 + 0.35 * smoothstep(0.25, 0.7, s.height);
}`;

const corrugated = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  // ISO-container style trapezoid corrugation: ~0.29 m pitch, ~36 mm deep (depth = 0.036)
  float N = fq(3.5);
  float x = fract(uv.x * N);
  float prof = smoothstep(0.06, 0.26, x) - smoothstep(0.56, 0.76, x);
  float edgeZone = (smoothstep(0.02, 0.1, x) * (1.0 - smoothstep(0.24, 0.32, x))) + (smoothstep(0.52, 0.6, x) * (1.0 - smoothstep(0.74, 0.82, x)));
  float dent = nfbm(uv, 1.5, 3, 1.0);
  vec3 dmg = paintDamage(uv, 0.12 + 0.25 * edgeZone, 30.0);
  float mid = nfbm(uv, 2.0, 4, 2.0), peel = nfbm(uv, 100.0, 2, 3.0);
  float streak = smoothstep(0.45, 0.8, nfbm2(uv, vec2(30.0, 1.5), 4, 4.0));
  float valley = 1.0 - prof;
  float dirt = streak * (0.3 + 0.7 * valley) * smoothstep(0.35, 0.7, nfbm(uv, 1.5, 3, 5.0));
  float rstreak = smoothstep(0.55, 0.85, nfbm2(uv, vec2(40.0, 1.0), 4, 7.0)) * smoothstep(0.4, 0.7, nfbm(uv, 2.0, 3, 8.0));
  float paint = 1.0 - dmg.x;
  vec3 col = vec3(0.86) * (0.92 + 0.1 * mid) * (0.97 + 0.05 * peel);
  col = mix(col, rustColor(0.25 + 0.45 * nfbm(uv, 20.0, 3, 6.0)), dmg.x);
  col = mix(col, rustColor(0.45), max(dmg.z, rstreak * 0.5) * 0.7);
  col = mix(col, vec3(0.1, 0.045, 0.03), dmg.y * 0.6);
  col *= 1.0 - dirt * 0.35;
  s.albedo = col;
  s.mask = paint * (1.0 - max(dmg.z, rstreak * 0.5) * 0.7) * (1.0 - dmg.y * 0.6);
  s.rough = mix(0.56 + 0.05 * mid + 0.12 * dirt + rstreak * 0.1, 0.85, dmg.x);
  s.metal = 0.0;
  // depth is 36 mm (the profile): paint thickness must stay ~0.1 mm or every chip edge becomes a glint
  s.height = prof * 0.9 + dent * 0.05 + paint * 0.004 + peel * 0.001;
  s.ao = mix(0.8, 1.0, smoothstep(0.0, 0.5, prof)) * (1.0 - dirt * 0.2);
}`;

const galvanised = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  float SF = fq(38.0);                                      // zinc spangle grains ~2.5 cm
  vec2 wu = warpP(uv, 6.0, 0.004, 1.5);
  vec4 sp = voronoiP(wu * SF, vec2(SF), 1.0, 1.0);
  // nearest grain centre offset (same cells as sp)
  vec2 gp = wu * SF; ivec2 gi = ivec2(floor(gp)); vec2 gf = fract(gp); vec2 mr = vec2(0.0); float md = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 r = vec2(x, y) + hash32(nzWrap(gi + ivec2(x, y), ivec2(SF)), 1.0).xy - gf;
    float d = dot(r, r); if (d < md) { md = d; mr = r; }
  }
  float cb = sp.w, cb2 = fract(cb * 7.31), cb3 = fract(cb * 13.7);
  float ang = cb2 * 6.2831853; vec2 dir = vec2(cos(ang), sin(ang));
  float taper = smoothstep(0.0, 0.12, sp.z);
  float bnd = 1.0 - smoothstep(0.0, 0.03, sp.z);             // grain boundary line
  // dendrite feathering: streaks along the grain's growth direction
  vec2 lp = -mr; float alongD = dot(lp, dir), acrossD = dot(lp, vec2(-dir.y, dir.x));
  float fea = 0.5 + 0.5 * sin(acrossD * 38.0 + sin(alongD * 9.0 + cb3 * 6.0) * 1.2);
  fea = mix(0.5, fea, 0.35 + 0.65 * cb3);
  float fine = nfbm(uv, 240.0, 2, 2.0), mid = nfbm(uv, 1.5, 4, 3.0);
  float whiteRust = smoothstep(0.76, 0.9, nfbm(uv, 3.0, 5, 4.0) + (fine - 0.5) * 0.1);
  float stain = smoothstep(0.6, 0.85, nfbm2(uv, vec2(3.0, 0.5), 4, 5.0));   // faint vertical run-off
  float scr = scratches(uv, 4.0, 6.0, 0.0005, 0.0, 0.1, 0.3, 1.5);
  float refl = 0.58 + 0.06 * cb + 0.03 * (fea - 0.5);          // per-grain reflectance (crystal orientation)
  vec3 col = vec3(refl) * vec3(0.98, 1.0, 1.02) * (1.0 - bnd * 0.02) * (0.98 + 0.04 * fine);
  float r = 0.22 + 0.1 * cb2 + 0.05 * (fea - 0.5) + 0.04 * mid + bnd * 0.03;
  col = mix(col, vec3(0.62, 0.62, 0.6), whiteRust);
  col *= 1.0 - stain * 0.12;
  s.albedo = mix(col, vec3(0.72), scr * 0.4);
  s.metal = 1.0 - whiteRust * 0.9;
  s.rough = mix(mix(r + stain * 0.08, 0.85, whiteRust), 0.2, scr * 0.6);
  // facet tilt (~1 deg, 0 at boundaries so the Sobel normal stays continuous)
  s.height = 0.5 + alongD * 0.08 * taper * (0.4 + 0.6 * cb3) - bnd * 0.015 + whiteRust * 0.12 + fine * 0.01 - scr * 0.1;
  s.ao = 1.0;
  s.mask = 0.0;
}`;

const woodPlanks = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  vec4 P = planks(uv, 5.0, 3.0);                             // 0.2 m wide boards, one butt joint per row per tile
  float row = P.z, yl = P.y, along = uv.x + P.w;
  float ph = hash21(ivec2(int(row), 7), 4.0), ph2 = hash21(ivec2(int(row), 9), 4.0);
  float fa = fq(1.0);
  float warp = fbmP(vec2(along * fa * 1.5, yl * 1.5 + row * 3.1), vec2(fa * 1.5, 0.0), 4, 5.0);
  float rings = (yl * (3.0 + ph * 4.0) + warp * 2.6) * 7.0;
  float rf = fract(rings);
  float late = smoothstep(0.7, 0.9, rf) * (1.0 - smoothstep(0.93, 1.0, rf));
  float fib = fbmP(vec2(along * fq(30.0), yl * 70.0 + row * 13.0), vec2(fq(30.0), 0.0), 3, 6.0 + row);
  float wM = 1.0 / fq(5.0) * uScaleM;                       // board width in metres
  float dAcross = min(yl, 1.0 - yl) * wM;
  float dAlong = min(fract(along), 1.0 - fract(along)) * uScaleM;
  float gap = 1.0 - smoothstep(0.0012, 0.0026, min(dAcross, dAlong));
  float edgeR = smoothstep(0.0, 0.006, min(dAcross, dAlong));
  float edgeG = 1.0 - smoothstep(0.0, 0.02, min(dAcross, dAlong));   // grime/wear band along board edges
  // knots: at most one per board, rings bend around it
  vec3 kh = hash32(ivec2(int(row), 21), 4.0);
  vec2 kd = vec2((fract(along) - fract(kh.x)) * uScaleM, (yl - (0.25 + 0.5 * kh.y)) * wM);
  kd.x -= floor(kd.x / uScaleM + 0.5) * uScaleM;
  float kr = length(kd * vec2(0.55, 1.0));
  float hasK = step(0.45, kh.z);
  float knot = hasK * (1.0 - smoothstep(0.011, 0.018, kr));
  float kAura = hasK * exp(-kr * 28.0);
  vec2 nl = vec2(min(fract(along), 1.0 - fract(along)) * uScaleM - 0.04, (yl - 0.5) * wM);
  float nail = 1.0 - smoothstep(0.003, 0.0045, min(length(nl - vec2(0.0, 0.05)), length(nl + vec2(0.0, 0.05))));
  float wear = nfbm(uv, 1.2, 4, 8.0);
  float pore = smoothstep(0.62, 0.8, fbmP(vec2(along * fq(80.0), yl * 220.0 + row * 5.0), vec2(fq(80.0), 0.0), 2, 11.0 + row));
  float grey = smoothstep(0.45, 0.8, nfbm(uv, 0.8, 4, 12.0)) * 0.45;
  vec3 light = vec3(0.19, 0.14, 0.095), dark = vec3(0.085, 0.055, 0.035);
  vec3 col = mix(light, dark, late * 0.55 + (fib - 0.3) * 0.45 + kAura * 0.5) * (0.72 + 0.45 * ph);
  col = mix(col, col * vec3(1.08, 1.0, 0.88), ph2 * 0.4);
  col *= (0.85 + 0.3 * wear) * (1.0 - pore * 0.18);
  col = mix(col, vec3(dot(col, vec3(0.33))) * vec3(1.02, 1.0, 0.96) * 1.15, grey);   // sun-bleached / greyed boards
  col = mix(col, vec3(0.075, 0.045, 0.026), knot * 0.6);
  col *= 1.0 - edgeG * 0.22 * (0.5 + wear);
  col = mix(col, vec3(0.03, 0.022, 0.016), gap);
  col = mix(col, vec3(0.08, 0.08, 0.085), nail);
  s.albedo = col; s.mask = 1.0 - gap;
  s.height = (0.75 - late * 0.06 + fib * 0.05 - wear * 0.04 - pore * 0.03 - knot * 0.04) * mix(0.85, 1.0, edgeR) * (1.0 - gap * 0.9) - nail * 0.05;
  s.rough = mix(0.62 + 0.1 * late + 0.1 * wear + grey * 0.15 + pore * 0.05, 0.95, gap); s.rough = mix(s.rough, 0.45, nail);
  s.metal = nail * 0.8;
  s.ao = mix(0.3, 1.0, 1.0 - gap) * mix(0.8, 1.0, edgeR);
}`;

const weatheredWood = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  vec4 P = planks(uv, 4.0, 13.0);                            // 0.25 m boards, one butt joint per row per 2 m tile
  float row = P.z, yl = P.y, along = uv.x + P.w;
  float ph = hash21(ivec2(int(row), 5), 8.0);
  float fa = fq(1.0);
  float warp = fbmP(vec2(along * fa * 2.0, yl * 1.2 + row * 2.7), vec2(fa * 2.0, 0.0), 4, 2.0);
  float rings = (yl * (1.6 + hash21(ivec2(int(row), 6), 8.0) * 1.6) + warp * 0.9) * 12.0;
  float groove = pow(1.0 - abs(fract(rings) - 0.5) * 2.0, 4.0) * (0.35 + 0.65 * fbmP(vec2(along * fq(4.0), yl * 6.0 + row), vec2(fq(4.0), 0.0), 3, 14.0));
  float fib = fbmP(vec2(along * fq(12.0), yl * 120.0 + row * 7.0), vec2(fq(12.0), 0.0), 5, 3.0 + row);
  float fib2 = fbmP(vec2(along * fq(40.0), yl * 260.0 + row * 3.0), vec2(fq(40.0), 0.0), 3, 23.0 + row);
  float crack = smoothstep(0.93, 0.985, 1.0 - abs(fract(rings * 0.25 + 0.13) - 0.5) * 2.0) * smoothstep(0.6, 0.75, fbmP(vec2(along * fq(3.0), yl * 3.0 + row * 5.0), vec2(fq(3.0), 0.0), 3, 15.0));
  float wM = 1.0 / fq(4.0) * uScaleM;
  float dAcross = min(yl, 1.0 - yl) * wM, dAlong = min(fract(along), 1.0 - fract(along)) * uScaleM;
  float gap = 1.0 - smoothstep(0.003, 0.006, min(dAcross, dAlong));
  float edgeR = smoothstep(0.0, 0.012, min(dAcross, dAlong));
  float lichen = smoothstep(0.7, 0.74, nfbm(uv, 5.0, 5, 9.0)) * (0.5 + 0.5 * nfbm(uv, 60.0, 2, 10.0));
  float brown = smoothstep(0.55, 0.75, nfbm(uv, 1.0, 4, 11.0));
  float edgeG = 1.0 - smoothstep(0.0, 0.03, min(dAcross, dAlong));
  vec3 grey = vec3(0.19, 0.185, 0.17) * (0.8 + 0.4 * ph) * (0.62 + 0.55 * fib) * (0.85 + 0.3 * fib2);
  vec3 col = mix(grey, vec3(0.16, 0.105, 0.065) * (0.75 + 0.5 * fib), brown * 0.6);
  col *= 1.0 - groove * 0.5;
  col *= 1.0 - edgeG * 0.3;
  col = mix(col, vec3(0.03, 0.025, 0.02), max(crack, gap));
  col = mix(col, mix(vec3(0.24, 0.25, 0.19), vec3(0.36, 0.36, 0.30), nfbm(uv, 20.0, 2, 12.0)), lichen * 0.8);
  s.albedo = col; s.mask = 1.0 - max(crack, gap);
  s.height = (0.75 - groove * 0.28 + fib * 0.14 + fib2 * 0.05 + lichen * 0.08) * mix(0.7, 1.0, edgeR) - crack * 0.4 - gap * 0.6;
  s.rough = mix(0.8 + 0.12 * groove + 0.05 * fib2, 0.95, lichen);
  s.ao = (1.0 - groove * 0.3) * (1.0 - max(crack, gap) * 0.6);
}`;

const tarp = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  float W = fq(220.0);                                       // ~4.5 mm scrim weave under the PE coating
  vec2 p = uv * W * 6.2831853;
  float weave = 0.5 + 0.5 * sin(p.x) * sin(p.y);
  vec2 wu = warpP(uv, 1.5, 0.06, 1.0);
  float folds = nfbm(wu, 1.0, 4, 2.0);
  float crease = pow(nridge(wu, 2.0, 4, 3.0), 3.0);
  float dirt = smoothstep(0.55, 0.9, nfbm(uv, 3.0, 5, 5.0) + crease * 0.2);
  vec3 col = vec3(0.8) * (0.96 + 0.04 * folds) * (0.98 + 0.02 * weave);
  col *= 1.0 - dirt * 0.45;
  s.albedo = col;
  s.mask = 1.0;
  s.height = folds * 0.2 + crease * 0.6 + weave * 0.03;
  s.rough = 0.5 + 0.2 * dirt + crease * 0.05;
  s.ao = 0.75 + 0.25 * smoothstep(0.2, 0.7, folds);
}`;

const plastic = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  vec4 st = nvor(uv, 140.0, 1.0, 1.0);                       // moulded stipple (VDI-like)
  float dome = 1.0 - smoothstep(0.0, 0.8, st.x);
  float mould = nfbm(uv, 180.0, 2, 2.0), mid = nfbm(uv, 2.0, 4, 3.0);
  float scuff = scratches(uv, 6.0, 4.0, 0.0012, 0.2, 0.5, 0.45, 1.5) * smoothstep(0.4, 0.6, nfbm(uv, 1.5, 3, 5.0));
  float dirt = smoothstep(0.55, 0.85, nfbm(uv, 1.2, 5, 6.0));
  vec3 col = vec3(0.82) * (0.94 + 0.08 * mid);
  col = mix(col, vec3(0.92), scuff * 0.35);
  col *= 1.0 - dirt * 0.4;
  s.albedo = col; s.mask = 1.0 - scuff * 0.2;
  s.height = 0.5 + dome * 0.25 + mould * 0.1 - scuff * 0.1;
  s.rough = 0.38 + 0.12 * mid + 0.12 * dirt + scuff * 0.2 - dome * 0.05;
  s.ao = 1.0 - (1.0 - dome) * 0.06;
}`;

const rubber = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  float sti = nfbm(uv, 300.0, 3, 1.0), mid = nfbm(uv, 2.0, 4, 2.0);
  float wear = smoothstep(0.5, 0.75, nfbm(uv, 1.5, 5, 3.0));
  float dust = smoothstep(0.45, 0.8, nfbm(uv, 2.0, 4, 4.0) + (0.5 - sti) * 0.5);
  float scuff = scratches(uv, 8.0, 5.0, 0.0015, 0.0, 0.5, 0.35, 1.2);
  vec3 col = vec3(0.034, 0.033, 0.032) * (0.9 + 0.2 * mid);
  col = mix(col, vec3(0.055, 0.054, 0.052), wear);
  col = mix(col, vec3(0.16, 0.15, 0.13), dust * 0.35);
  col = mix(col, vec3(0.06), scuff * 0.5);
  s.albedo = col; s.mask = 0.0;
  s.height = 0.5 + sti * 0.3 * (1.0 - wear * 0.7) - scuff * 0.1;
  s.rough = mix(0.88, 0.7, wear) + dust * 0.08 - scuff * 0.15;
  s.ao = 0.85 + 0.15 * sti;
}`;

const rock = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  vec2 w = warpP(uv, 0.8, 0.08, 1.0);
  float r1 = nridge(w, 0.9, 6, 2.0), f1 = nfbm(w, 2.0, 6, 3.0), f2 = nfbm(uv, 12.0, 4, 4.0);
  float strata = 0.5 + 0.5 * sin((uv.y * fq(2.5) + f1 * 1.6) * 6.2831853);
  float h = r1 * 0.55 + f1 * 0.3 + strata * 0.06 + f2 * 0.08 + nfbm(uv, 60.0, 3, 13.0) * 0.03;
  vec4 cv = nvor(warpP(uv, 2.5, 0.025, 5.0), 1.5, 1.0, 6.0);
  float crack = isoLine(cv.z, 0.005) * smoothstep(0.42, 0.58, nfbm(uv, 1.5, 3, 8.0));
  float f3 = nfbm(uv, 60.0, 3, 13.0);
  vec3 dark = vec3(0.07, 0.068, 0.064), light = vec3(0.26, 0.245, 0.22);
  vec3 col = mix(dark, light, smoothstep(0.25, 0.85, h)) * (0.75 + 0.4 * f2) * (0.85 + 0.3 * f3);
  col = mix(col, col * vec3(1.25, 1.0, 0.75), smoothstep(0.55, 0.8, nfbm(uv, 1.5, 4, 9.0)) * 0.5);
  float lichen = smoothstep(0.62, 0.68, nfbm(uv, 4.0, 5, 10.0)) * smoothstep(0.45, 0.65, h);
  vec3 lc = mix(vec3(0.36, 0.34, 0.24), vec3(0.42, 0.24, 0.08), step(0.7, nfbm(uv, 1.0, 2, 11.0)));
  col = mix(col, lc * (0.8 + 0.4 * nfbm(uv, 60.0, 2, 12.0)), lichen * 0.8);
  col = mix(col, vec3(0.03), crack * 0.85);
  s.albedo = col; s.height = h - crack * 0.15 + lichen * 0.02;
  s.rough = 0.82 + 0.1 * f2 + lichen * 0.05 - smoothstep(0.7, 0.9, r1) * 0.1;
  s.ao = (0.3 + 0.7 * smoothstep(0.15, 0.75, h)) * (1.0 - crack * 0.6);
  s.mask = 1.0;
}`;

const sand = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  vec2 w = warpP(uv, 0.7, 0.05, 1.0);
  float RF = fq(11.0);                                       // ~9 cm wind ripples
  float ph = w.y * RF + nfbm(uv, 1.3, 3, 2.0) * 2.5;
  float x = fract(ph);
  float rip = smoothstep(0.0, 0.72, x) * (1.0 - smoothstep(0.72, 1.0, x));   // long stoss, short lee slope
  float amp = 0.35 + 0.65 * nfbm(uv, 0.5, 3, 3.0);
  float g = nval(uv, 700.0, 4.0), g2 = nval(uv, 330.0, 5.0);
  float mid = nfbm(uv, 3.0, 4, 6.0);
  vec4 pv = nvor(uv, 14.0, 1.0, 7.0); float peb = (1.0 - smoothstep(0.08, 0.14, pv.x)) * step(0.94, pv.w);
  vec3 col = vec3(0.42, 0.34, 0.235) * (0.88 + 0.24 * mid);
  col *= 0.92 + 0.16 * rip * amp;                            // coarse dark grains settle in troughs
  col = mix(col, vec3(0.12, 0.10, 0.08), smoothstep(0.82, 0.95, g) * 0.6);
  col = mix(col, vec3(0.62, 0.58, 0.5), smoothstep(0.85, 0.97, g2) * 0.5);
  col = mix(col, mix(vec3(0.5, 0.46, 0.4), vec3(0.2, 0.18, 0.16), fract(pv.w * 31.0)), peb);
  s.albedo = col; s.mask = 1.0;
  s.height = rip * amp * 0.7 + mid * 0.2 + g * 0.03 + peb * 0.15;
  s.rough = 0.9 + 0.06 * g - peb * 0.2;
  s.ao = 0.8 + 0.2 * rip;
}`;

const snow = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  float drift = nfbm(warpP(uv, 0.6, 0.08, 1.0), 0.7, 5, 2.0);
  float sast = nfbm2(warpP(uv, 1.0, 0.05, 3.0), vec2(1.5, 7.0), 4, 4.0);
  float crust = nridge(warpP(uv, 3.0, 0.03, 7.0), 9.0, 4, 8.0);          // wind-crust ridges, ~10 cm
  float lump = nfbm(uv, 22.0, 3, 9.0);                                    // clumps / old pock marks
  float gran = nfbm(uv, 180.0, 2, 5.0), pit = nval(uv, 450.0, 6.0);
  float h = drift * 0.6 + sast * 0.22 + crust * 0.06 + lump * 0.04 + gran * 0.04 - smoothstep(0.75, 0.95, pit) * 0.03;
  // fresh snow is ~0.8-0.9, but slightly aged/settled snow at 0.7-0.78 keeps grading under a strong sun
  vec3 col = vec3(0.74, 0.76, 0.80) * (0.93 + 0.1 * gran) * (0.96 + 0.06 * lump);
  float hollow = 1.0 - smoothstep(0.25, 0.6, h);
  col = mix(col, vec3(0.56, 0.66, 0.80), hollow * 0.4);                  // light scattered through thin snow is blue
  col = mix(col, col * vec3(0.97, 0.97, 0.95), smoothstep(0.55, 0.8, crust) * 0.5);
  s.albedo = col; s.mask = 1.0; s.height = h;
  s.rough = 0.6 + 0.14 * gran - smoothstep(0.6, 0.85, sast) * 0.14 - smoothstep(0.6, 0.9, crust) * 0.1;
  s.ao = 0.78 + 0.22 * smoothstep(0.2, 0.7, h);
}`;

const ice = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  vec2 w = warpP(uv, 1.5, 0.04, 1.0);
  vec4 plate = nvor(w, 1.6, 1.0, 2.0);
  float crackA = isoLine(plate.z, 0.0015) * (0.4 + 0.6 * smoothstep(0.3, 0.6, nfbm(uv, 3.0, 3, 10.0)));
  float crackB = isoLine(ngrad(w, 5.0, 3.0) + 0.3 * ngrad(w, 18.0, 4.0), 0.0008) * smoothstep(0.55, 0.7, nfbm(uv, 2.0, 3, 5.0)) * 0.6;
  vec4 bv = nvor(uv, 45.0, 1.0, 6.0);
  float bub = (1.0 - smoothstep(0.03, 0.05 + 0.08 * bv.w * bv.w, bv.x)) * step(0.82, bv.w) * smoothstep(0.4, 0.6, nfbm(uv, 2.0, 3, 11.0));
  float frost = smoothstep(0.58, 0.78, nfbm(uv, 1.0, 5, 7.0));
  float mid = nfbm(uv, 0.7, 4, 8.0), micro = nfbm(uv, 120.0, 2, 9.0);
  vec3 col = vec3(0.09, 0.14, 0.18) * (0.75 + 0.5 * mid) * (0.9 + 0.2 * plate.w);
  col = mix(col, vec3(0.38, 0.48, 0.55), max(crackA, crackB));
  col = mix(col, vec3(0.45, 0.52, 0.58), bub * 0.6);
  col = mix(col, vec3(0.72, 0.78, 0.84), frost * 0.8);
  s.albedo = col; s.mask = 1.0;
  s.height = 0.5 + mid * 0.1 + frost * 0.25 + micro * 0.04 - crackA * 0.25 - crackB * 0.12;
  s.rough = 0.05 + micro * 0.05 + max(crackA, crackB) * 0.3 + frost * 0.5;
  s.ao = 1.0 - crackA * 0.3;
}`;

const forestGround = /*glsl*/`
// fallen leaves: periodic cellular layout, each cell holds one rotated pointed ellipse; topmost leaf wins
vec4 leafLayer(vec2 uv, float perM, float sd) {
  float f = fq(perM); vec2 p = uv * f; ivec2 i = ivec2(floor(p)); vec2 fr = fract(p);
  vec4 best = vec4(0.0, 0.0, 0.0, -1.0);   // coverage, id, vein, order
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 g = ivec2(x, y); ivec2 c = nzWrap(i + g, ivec2(f));
    vec3 h = hash32(c, sd); vec3 h2 = hash32(c, sd + 1.0);
    if (h2.z < 0.15) continue;
    vec2 d = fr - (vec2(g) + h.xy);
    float a = h.z * 6.2831853; vec2 ax = vec2(cos(a), sin(a));
    vec2 q = vec2(dot(d, ax), dot(d, vec2(-ax.y, ax.x)));
    float L = 0.45 + 0.35 * h2.x, Wd = L * (0.35 + 0.2 * h2.y);
    float t = clamp(q.x / L, -1.0, 1.0);
    float wAt = Wd * sqrt(max(1.0 - t * t, 0.0)) * (1.0 - 0.35 * t);
    float e = max(abs(q.x) - L, abs(q.y) - wAt);
    float cov = 1.0 - smoothstep(-0.02, 0.0, e);
    if (cov > 0.0 && h2.z > best.w) {
      float vein = (1.0 - smoothstep(0.0, 0.015, abs(q.y))) * step(abs(q.x), L);
      best = vec4(cov, h2.x, vein, h2.z);
    }
  }
  return best;
}
void surf(vec2 uv, inout Surf s) {
  float mid = nfbm(uv, 1.5, 5, 1.0), fine = nfbm(uv, 60.0, 3, 2.0);
  vec3 soil = vec3(0.075, 0.055, 0.038) * (0.75 + 0.5 * fine);
  float moss = smoothstep(0.55, 0.63, nfbm(warpP(uv, 2.0, 0.05, 3.0), 2.0, 5, 4.0));
  float mossD = nfbm(uv, 160.0, 3, 5.0);
  vec4 L1 = leafLayer(uv, 22.0, 6.0), L2 = leafLayer(uv + 0.37, 17.0, 7.0);
  vec4 Lf = L2.x > 0.5 ? L2 : L1;
  float leafCov = max(L1.x, L2.x) * (1.0 - moss * 0.85) * smoothstep(0.25, 0.5, nfbm(uv, 2.0, 3, 8.0) + 0.2);
  vec3 lc = mix(vec3(0.085, 0.058, 0.034), vec3(0.17, 0.11, 0.055), Lf.y);
  lc *= mix(0.55, 1.0, smoothstep(0.0, 0.6, Lf.x)) * (L2.x > 0.5 && L1.x > 0.5 ? 1.0 : 0.8);
  lc = mix(lc, vec3(0.06, 0.045, 0.03), smoothstep(0.5, 0.85, fract(Lf.y * 9.7)));
  lc = mix(lc, vec3(0.20, 0.17, 0.08), step(0.9, fract(Lf.y * 3.3)) * 0.7);
  lc *= 1.0 - Lf.z * 0.35;
  float twig = scratches(uv, 4.0, 9.0, 0.004, 0.0, 1.0, 0.4, 1.2);
  vec4 pv = nvor(uv, 9.0, 1.0, 10.0); float peb = (1.0 - smoothstep(0.1, 0.18, pv.x)) * step(0.88, pv.w);
  vec3 col = soil;
  col = mix(col, vec3(0.2, 0.19, 0.17) * (0.7 + 0.6 * pv.w), peb);
  col = mix(col, lc, leafCov);
  col = mix(col, vec3(0.12, 0.08, 0.05), twig * (1.0 - moss));
  vec3 mc = mix(vec3(0.045, 0.07, 0.018), vec3(0.11, 0.13, 0.035), mossD) * (0.7 + 0.5 * nfbm(uv, 8.0, 3, 13.0));
  col = mix(col, mc, moss);
  s.albedo = col; s.mask = 0.0;
  s.height = 0.3 + mid * 0.15 + peb * 0.25 + leafCov * 0.2 + twig * 0.15 + moss * (0.3 + 0.2 * mossD);
  s.rough = mix(mix(0.92, 0.62, leafCov), 0.95, moss);
  s.ao = 0.55 + 0.45 * smoothstep(0.2, 0.7, s.height);
}`;

const brick = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  // 215 x 65 mm bricks, 10 mm mortar -> 225 x 75 mm cells, running bond. Use scale = 1.8 (8 x 24 cells).
  vec2 m = uv * uScaleM;
  const float CL = 0.225, CH = 0.075;
  float row = floor(m.y / CH);
  float bx = m.x / CL + mod(row, 2.0) * 0.5;
  float ci = floor(bx);
  vec2 lc = vec2(fract(bx) * CL, fract(m.y / CH) * CH);
  float d = min(min(lc.x, CL - lc.x), min(lc.y, CH - lc.y));
  int nx = int(floor(uScaleM / CL + 0.5)), ny = int(floor(uScaleM / CH + 0.5));
  ivec2 bid = nzWrap(ivec2(int(ci), int(row)), ivec2(nx, ny));
  vec3 bh = hash32(bid, 3.0);
  float edgeN = nfbm(uv, 40.0, 3, 4.0);
  float brk = smoothstep(0.0045, 0.0065, d + (edgeN - 0.5) * 0.004);
  float face = nfbm(uv, 20.0, 4, 5.0), fine = nfbm(uv, 200.0, 2, 6.0);
  vec4 pv = nvor(uv, 90.0, 1.0, 7.0); float pit = (1.0 - smoothstep(0.08, 0.16, pv.x)) * step(0.8, pv.w);
  vec3 bc = mix(vec3(0.22, 0.075, 0.045), vec3(0.33, 0.15, 0.085), bh.x);
  bc = mix(bc, bc * vec3(0.55, 0.5, 0.52), step(0.86, bh.y));        // over-fired clinkers
  bc = mix(bc, vec3(0.36, 0.25, 0.17), step(0.93, bh.z) * 0.6);
  bc *= (0.82 + 0.36 * face) * (0.92 + 0.16 * fine) * (1.0 - pit * 0.4);
  float soot = smoothstep(0.5, 0.8, nfbm(uv, 0.8, 4, 8.0)); bc *= 1.0 - soot * 0.3;
  vec3 mc = vec3(0.36, 0.345, 0.32) * (0.75 + 0.4 * nfbm(uv, 80.0, 3, 9.0));
  s.albedo = mix(mc, bc, brk); s.mask = brk;
  float rnd = smoothstep(0.0045, 0.014, d);
  s.height = mix(0.18 + 0.1 * fine, 0.62 + 0.12 * face + 0.04 * fine - pit * 0.2, brk) * mix(0.85, 1.0, rnd * brk + (1.0 - brk));
  s.rough = mix(0.95, 0.82 + 0.1 * face, brk);
  s.ao = mix(0.5, 1.0, brk) * (1.0 - pit * 0.3);
}`;

const emissivePanel = /*glsl*/`
void surf(vec2 uv, inout Surf s) {
  // 4 x 4 grid of 0.25 m light tiles in a dark aluminium frame (scale 1). Emission colour = material.emissive.
  float N = fq(4.0);
  vec2 c = fract(uv * N), ci = floor(uv * N);
  float cell = 1.0 / N * uScaleM;
  vec2 dm = min(c, 1.0 - c) * cell;
  float d = min(dm.x, dm.y);
  float lens = smoothstep(0.011, 0.013, d);
  vec3 h = hash32(nzWrap(ivec2(ci), ivec2(N)), 2.0);
  float alive = h.x < 0.08 ? 0.04 : (0.7 + 0.3 * h.y);
  float vign = smoothstep(0.0, 0.05, d - 0.012);
  vec2 cc = (c - 0.5) * 2.0;
  float centre = 1.0 - 0.35 * dot(cc, cc) * 0.5;                          // diffuser: brighter in the middle
  float led = 0.5 + 0.5 * sin(uv.x * fq(160.0) * 6.2831853) * sin(uv.y * fq(160.0) * 6.2831853);
  float dirt = smoothstep(0.5, 0.85, nfbm(uv, 2.0, 4, 3.0));
  vec2 sc = abs(c - 0.5) * cell; float screw = 1.0 - smoothstep(0.0025, 0.0035, length(sc - vec2(cell * 0.5 - 0.006)));
  vec3 frame = vec3(0.30, 0.30, 0.31) * (0.9 + 0.2 * nfbm(uv, 30.0, 3, 4.0));
  s.albedo = mix(frame, vec3(0.7) * (1.0 - dirt * 0.2), lens); s.mask = lens;
  s.metal = (1.0 - lens) * (1.0 - screw * 0.2);
  s.rough = mix(0.42 + 0.2 * dirt, 0.22 + 0.2 * dirt, lens);
  s.emit = lens * alive * mix(0.45, 1.0, vign) * centre * (0.85 + 0.15 * led) * (1.0 - dirt * 0.35);
  s.height = mix(0.8, 0.45, lens) - screw * 0.2 + lens * led * 0.01;
  s.ao = mix(0.7, 1.0, smoothstep(0.0, 0.02, abs(d - 0.012)));
}`;

const s = (glsl, scale, depth, tint, porosity, extra = {}) => ({ glsl, scale, depth, tint, porosity, ...extra });
export const SURFACES = {
  asphalt:        s(asphalt, 2, 0.008, 0xffffff, 0.9, { ground: true, note: 'road/apron asphalt, 12-18 mm aggregate, cracks, tar patches, oil' }),
  concrete:       s(concrete, 4, 0.006, 0xffffff, 1.0, { note: '2 m slabs with saw-cut joints, cracks, pores, stains' }),
  painted_metal:  s(paintedMetal, 2, 0.0015, 0x7d2219, 0.25, { note: 'chipped paint over primer/rust with rust runs and scratches (tint = paint)' }),
  rust:           s(rust, 1, 0.005, 0x4a5a50, 0.6, { note: 'heavy flaking rust, pits, paint remnants (tint = remnant paint)' }),
  corrugated:     s(corrugated, 2, 0.036, 0x1f4d6b, 0.25, { note: 'container corrugation (normal-mapped, 0.29 m pitch), chipped paint (tint = paint)' }),
  galvanised:     s(galvanised, 1, 0.0006, 0xffffff, 0.15, { note: 'hot-dip zinc spangle, white rust, stains' }),
  wood_planks:    s(woodPlanks, 2, 0.006, 0xffffff, 0.8, { note: '0.2 m boards along U, grain, gaps, nails (tint = stain)' }),
  weathered_wood: s(weatheredWood, 2, 0.009, 0xffffff, 1.0, { note: 'silvered 0.25 m boards, deep grain, cracks, lichen' }),
  tarp:           s(tarp, 1, 0.006, 0x2f5fa8, 0.3, { note: 'PE tarp: folds, creases, scrim weave, fade, dirt (tint = tarp colour)' }),
  plastic:        s(plastic, 1, 0.0006, 0xd8a020, 0.1, { note: 'moulded stippled plastic, scuffs, dirt (tint = colour)' }),
  rubber:         s(rubber, 0.5, 0.0012, 0xffffff, 0.2, { note: 'black rubber, stipple, wear, dust' }),
  rock:           s(rock, 4, 0.09, 0xffffff, 0.7, { note: 'ridged rock with strata, cracks, lichen — use triplanar' }),
  sand:           s(sand, 2, 0.012, 0xffffff, 0.9, { ground: true, note: 'wind ripples (~9 cm), grains, pebbles' }),
  snow:           s(snow, 2, 0.055, 0xffffff, 0.2, { ground: true, note: 'drifts, sastrugi, granular surface' }),
  ice:            s(ice, 2, 0.002, 0xffffff, 0.0, { ground: true, note: 'dark clear ice with white fracture lines, bubbles, frost' }),
  forest_ground:  s(forestGround, 2, 0.03, 0xffffff, 0.8, { ground: true, note: 'soil, fallen leaves, twigs, pebbles, moss patches' }),
  brick:          s(brick, 1.8, 0.012, 0xffffff, 0.9, { note: '215x65 mm running bond, recessed mortar, clinkers (tint = brick)' }),
  emissive_panel: s(emissivePanel, 1, 0.004, 0xffffff, 0.1, { emissive: true, note: '4x4 light tiles in a frame; emissive colour = material.emissive' }),
};
export const SURFACE_NAMES = Object.keys(SURFACES);
