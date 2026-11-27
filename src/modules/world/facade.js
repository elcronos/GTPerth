// Building facades: one MeshStandardMaterial patch that draws real-scale curtain walls on plain extruded geometry.
//   uv          = (metres along the wall perimeter, metres up)   — roofs use world xz
//   aFac        = (panel width m, floor height m, style, seed)
//   color       = frame / cladding / slab colour (linear, vertex colour)
//   aGlass      = reflective glass F0 tint (linear)
// Styles: 0 curtain wall · 1 punched windows in stone/precast · 2 ribbon windows · 3 curtain wall + vertical fins ·
//         4 residential (glass + white slab edges + balustrades) · 5 solid panels (plant rooms, podiums) · 6 roof
// Glass is a coloured mirror (metalness 1, F0 = aGlass) with per-panel "oil-canning" normal tilt so reflections
// break up panel by panel; behind it, an interior-mapped office room (floor, ceiling lights, walls, blinds) is
// added as emission weighted by (1 - Fresnel). Everything fades to its pixel-footprint average to stay alias-free.
import { sharedUniform as _shU } from '../../cookbook/engine/patch.js';
import { MeshStandardMaterial } from 'three';
import { patch } from '../../cookbook/engine/patch.js';
import { ensureWorldVaryings } from '../../cookbook/materials/weathering.js';
_shU('uNight', 'float', 0);   // 0 day → 1 night (driven by daycycle.js)

export function facadeMaterial(name = 'facade') {
  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.0, vertexColors: true });
  mat.name = name;
  mat.userData.weather = { dust: 0.0, wet: 0, beads: 0, porosity: 0.1 };
  if (/[?&]nofwth/.test(location.search)) mat.userData.noWeather = true;   // debug
  patch(mat, 'facade', (shader) => {
    ensureWorldVaryings(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFac;\nattribute vec3 aGlass;\nvarying vec4 vFac;\nvarying vec3 vGlass;\nvarying vec2 vFUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = aFac; vGlass = aGlass; vFUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vFac; varying vec3 vGlass; varying vec2 vFUv;
float fcGlass; float fcRough; float fcMetal; vec3 fcEmit; vec2 fcTilt; float fcFoot;
float fcH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// centred AA ramp that preserves coverage: a sub-pixel mullion fades out instead of growing to a full pixel
float fcBand(float x, float w, float aa) { return (1.0 - smoothstep(w - 0.5 * aa, w + 0.5 * aa, x)) * min(1.0, 2.0 * w / (aa + 2.0 * w)); }
`)
      
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float pw = vFac.x, fh = vFac.y, style = floor(vFac.z + 0.5);
  // snap the per-building seed: perspective interpolation adds ~1e-4 jitter, which the hashes below amplify into
  // per-pixel noise (the 'TV static' in windows) when the seed is large
  float seed = mod(floor(abs(vFac.w) + 0.5), 97.0);
  float shopOn = step(vFac.w, -0.5);
  pw = floor(pw * 100.0 + 0.5) / 100.0; fh = floor(fh * 100.0 + 0.5) / 100.0;
  // street level of a shopfront building: 0-0.3 m plinth, 0.3-3.3 glazed bays, 3.3-3.6 awning shadow, 3.6-4.6 fascia
  float shop = shopOn * (1.0 - step(4.6, vFUv.y)) * step(-0.5, vFUv.y);
  if (shop > 0.5) { pw = 3.2; fh = 4.6; }
  vec2 cellSz = vec2(pw, fh);
  vec2 q = vFUv / cellSz;
  vec2 cell = floor(q), f = fract(q);
  vec2 fw = fwidth(q);
  fcFoot = max(fw.x, fw.y);                         // cells per pixel
  float far = smoothstep(0.08, 0.30, fcFoot);         // 1 = cells smaller than ~2 px: use averages
  float farRoom = smoothstep(0.06, 0.25, fcFoot);    // room interiors fade to their average much earlier (no TV static)
  vec2 dE = min(f, 1.0 - f) * cellSz;                // metres to the cell edges
  vec2 aa = fw * cellSz * 1.2 + 0.004;
  vec3 frame = diffuseColor.rgb;
  float glass = 0.0, slab = 0.0;
  float rnd = fcH(cell + seed * 17.0), rnd2 = fcH(cell.yx * 1.7 + seed * 3.1);
  if (style < 0.5) {                                  // curtain wall: thin mullions + spandrel glass band
    float mull = fcBand(dE.x, 0.04, aa.x);
    float tran = fcBand(dE.y, 0.05, aa.y);
    float span = step(f.y, 0.20);                    // opaque spandrel glass at the slab
    glass = (1.0 - max(mull, tran));
    slab = span * glass;
  } else if (style < 1.5) {                           // punched windows
    vec2 w = vec2(0.14, 0.16);
    float inX = smoothstep(w.x - aa.x / pw, w.x, f.x) * (1.0 - smoothstep(1.0 - w.x, 1.0 - w.x + aa.x / pw, f.x));
    float inY = smoothstep(w.y - aa.y / fh, w.y, f.y) * (1.0 - smoothstep(0.90, 0.90 + aa.y / fh, f.y));
    // 20 cm deep reveal: the glass sits back in the opening (parallax), the exposed reveal is shaded
    vec3 Vr = normalize(vWthPos - cameraPosition); vec3 Nr = normalize(vWthN);
    vec3 Tr = normalize(cross(vec3(0.0, 1.0, 0.0), Nr) + vec3(1e-4, 0.0, 0.0));
    vec3 dr = vec3(dot(Vr, Tr), Vr.y, max(-dot(Vr, Nr), 0.25));
    vec2 g2 = f + dr.xy / dr.z * 0.20 / cellSz * (1.0 - far);
    float gX = smoothstep(w.x - aa.x / pw, w.x, g2.x) * (1.0 - smoothstep(1.0 - w.x, 1.0 - w.x + aa.x / pw, g2.x));
    float gY = smoothstep(w.y - aa.y / fh, w.y, g2.y) * (1.0 - smoothstep(0.90, 0.90 + aa.y / fh, g2.y));
    float open = inX * inY;
    glass = open * gX * gY;
    frame = mix(frame, frame * 0.55, open * (1.0 - gX * gY));
    frame *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.06, f.y - 0.90)) * step(0.90, f.y) * (1.0 - far);   // sill shadow
  } else if (style < 2.5) {                           // ribbon windows
    float band = smoothstep(0.42, 0.42 + aa.y / fh, f.y) * (1.0 - smoothstep(0.93, 0.93 + aa.y / fh, f.y));
    glass = band * (1.0 - fcBand(dE.x, 0.035, aa.x));
  } else if (style < 3.5) {                           // curtain wall + deep vertical fins (fin every panel)
    float fin = fcBand(dE.x, 0.11, aa.x);
    float tran = fcBand(dE.y, 0.06, aa.y);
    glass = (1.0 - max(fin, tran));
    slab = step(f.y, 0.16) * glass;
    frame *= 1.0 + fin * 0.25;
  } else if (style < 4.5) {                           // residential: slab edges + glass balustrade
    float edge = smoothstep(0.0, aa.y / fh, f.y) * (1.0 - smoothstep(0.13, 0.13 + aa.y / fh, f.y));
    float bal = step(f.y, 0.40) * (1.0 - edge);
    float mull = fcBand(dE.x, 0.035, aa.x);
    glass = (1.0 - max(edge, mull)) * (1.0 - bal * 0.5);
    slab = bal * 0.6;
    frame = mix(frame, vec3(0.40), edge);
  } else if (style < 5.5) {                           // solid panels with joints
    float j = max(fcBand(dE.x, 0.012, aa.x), fcBand(dE.y, 0.012, aa.y));
    frame *= 1.0 - j * 0.35;
    frame *= 0.92 + 0.12 * rnd;
  } else if (style > 6.5) {                           // 7: 'cobble' powder-coated panels (Ritz-Carlton podium)
    vec2 pc = floor(vFUv / vec2(1.6, 1.2)); float h = fcH(pc + seed);
    vec3 pal = vec3(0.44, 0.39, 0.32) * (0.9 + 0.2 * h) + vec3(0.02, 0.0, -0.02) * step(0.7, h);
    vec2 pf = fract(vFUv / vec2(1.6, 1.2)); vec2 pe = min(pf, 1.0 - pf);
    float j = 1.0 - smoothstep(0.02, 0.02 + fw.x * 2.0, min(pe.x, pe.y));
    frame = mix(pal * (0.9 + 0.2 * fcH(pc * 2.3)), vec3(0.08), j * (1.0 - far));
    frame = mix(frame, vec3(0.42, 0.37, 0.3), far);
  } else {                                            // roof
    vec2 g = vWthPos.xz * 0.5; float n = fcH(floor(g)) * 0.15;
    frame *= 0.85 + n;
  }
  // towers: a dark louvred plant floor every 18 storeys (vertical rhythm, as on real CBD towers)
  if ((style < 0.5 || (style > 1.5 && style < 3.5)) && vFUv.y > 30.0 && shop < 0.5) {
    float fl = floor(vFUv.y / fh);
    float mech = 1.0 - step(0.5, mod(fl + seed * 7.0, 18.0));
    float slat = mix(0.6 + 0.4 * step(0.5, fract(vFUv.y * 6.0)), 0.8, far);
    glass = mix(glass, 0.0, mech); slab *= 1.0 - mech;
    frame = mix(frame, vec3(0.07) * slat, mech);
  }
  float shopSign = 0.0; vec3 signC = vec3(0.0);
  if (shop > 0.5) {
    float gy = vFUv.y;
    float unit = floor(vFUv.x / 9.6);                         // one tenancy every 3 bays
    float hu = fcH(vec2(unit, seed * 1.3)), hu2 = fcH(vec2(unit * 1.7, seed + 4.0));
    float mull = fcBand(dE.x, 0.07, aa.x);
    float inGlz = smoothstep(0.30, 0.30 + aa.y, gy) * (1.0 - smoothstep(3.3, 3.3 + aa.y, gy));
    float shutter = step(0.9, hu2);                             // a closed roller shutter here and there
    glass = inGlz * (1.0 - mull) * (1.0 - shutter);
    slab = 0.0;
    vec3 plinth = vec3(0.045, 0.043, 0.042);
    vec3 shut = vec3(0.30, 0.30, 0.29) * (0.85 + 0.15 * step(0.5, fract(gy * 9.0)));
    vec3 awn = vec3(0.025);
    vec3 pal[6]; pal[0] = vec3(0.05, 0.05, 0.055); pal[1] = vec3(0.42, 0.05, 0.04); pal[2] = vec3(0.04, 0.12, 0.22); pal[3] = vec3(0.55, 0.50, 0.42); pal[4] = vec3(0.06, 0.20, 0.10); pal[5] = vec3(0.6, 0.38, 0.05);
    signC = pal[int(hu * 5.99)];
    frame = mix(frame * 0.8, plinth, 1.0 - smoothstep(0.28, 0.30, gy));
    frame = mix(frame, shut, inGlz * shutter);
    float awnB = smoothstep(3.3, 3.32, gy) * (1.0 - smoothstep(3.58, 3.6, gy));
    frame = mix(frame, awn, awnB);
    float fasc = smoothstep(3.6, 3.62, gy);
    frame = mix(frame, signC, fasc * 0.85);
    // illuminated lettering-free sign box centred in the fascia of most tenancies
    float sx = abs(fract(vFUv.x / 9.6) - 0.5) * 9.6, sy = abs(gy - 4.1);
    shopSign = step(0.35, hu2) * (1.0 - smoothstep(2.4, 2.45, sx)) * (1.0 - smoothstep(0.26, 0.28, sy));
    frame = mix(frame, vec3(0.85, 0.82, 0.75), shopSign * 0.6);
  }
  float avgGlass = style < 0.5 ? 0.80 : style < 1.5 ? 0.54 : style < 2.5 ? 0.58 : style < 3.5 ? 0.74 : style < 4.5 ? 0.76 : 0.0;
  if (shop > 0.5) avgGlass = 0.6;
  glass = mix(glass, avgGlass, far);
  slab = mix(slab, style < 0.5 ? 0.18 : style < 3.5 && style > 2.5 ? 0.13 : style > 3.5 && style < 4.5 ? 0.12 : 0.0, far);
  fcGlass = glass;
  // per-panel tint/roughness variation; oil-canning tilt (faded with distance)
  vec3 gl = vGlass * (0.95 + 0.1 * rnd2) * (0.85 + 0.3 * fcH(vec2(seed, 3.7)));   // per-tower glass value
  fcRough = mix(0.08 + 0.05 * rnd, 0.1, far);
  fcTilt = (vec2(rnd, rnd2) - 0.5) * 0.022 * (1.0 - far);
  // ---------------- interior mapping (rooms behind the glass)
  vec3 V = normalize(vWthPos - cameraPosition);
  vec3 Nw = normalize(vWthN);
  vec3 Tw = normalize(cross(vec3(0.0, 1.0, 0.0), Nw) + vec3(1e-4, 0.0, 0.0));
  vec3 Bw = vec3(0.0, 1.0, 0.0);
  vec3 d = vec3(dot(V, Tw), dot(V, Bw), -dot(V, Nw));
  float depth = shop > 0.5 ? 4.5 : 7.0;
  if (shop > 0.5) { f.y = clamp((vFUv.y - 0.3) / 3.0, 0.0, 1.0); fh = 3.0; }
  vec3 p0 = vec3(f.x * pw, f.y * fh, 0.0);
  vec3 tt = vec3((d.x > 0.0 ? (pw - p0.x) : -p0.x) / (d.x + 1e-5), (d.y > 0.0 ? (fh - p0.y) : -p0.y) / (d.y + 1e-5), depth / max(d.z, 1e-3));
  float ttx = abs(tt.x), tty = abs(tt.y), ttz = tt.z;
  float t = min(min(ttx, tty), ttz);
  vec3 hp = p0 + d * t;
  float lit = shop > 0.5 ? step(0.12, fcH(cell * 0.31 + seed)) : step(0.94 - 0.38 * uNight, 0.8 * fcH(vec2(floor(cell.x / 6.0), cell.y) * 0.73 + seed) + 0.2 * fcH(cell * 0.73 + seed));
  vec3 lampC = mix(vec3(1.0, 0.86, 0.66), vec3(0.85, 0.92, 1.0), step(0.7, fcH(cell + 9.1)));
  // every surface is evaluated unconditionally (derivatives in divergent branches are undefined → pixel speckle),
  // then selected by ordering rather than float equality
  vec2 hw = fwidth(hp.xy) + 1e-3;
  float desk = (1.0 - smoothstep(0.75 - hw.y, 0.75 + hw.y, hp.y)) * smoothstep(0.15 - hw.x, 0.15 + hw.x, fract(hp.x * 0.6 + rnd));
  vec3 rBack = mix(vec3(0.55, 0.53, 0.5), vec3(0.18, 0.16, 0.15), desk * (1.0 - farRoom));
  vec2 lpp = hp.xz * vec2(0.5, 0.45); vec2 lp = fract(lpp); vec2 lw = fwidth(lpp) + 0.02;
  float panel = smoothstep(0.3 - lw.x, 0.3 + lw.x, lp.x) * (1.0 - smoothstep(0.7 - lw.x, 0.7 + lw.x, lp.x)) * smoothstep(0.3 - lw.y, 0.3 + lw.y, lp.y) * (1.0 - smoothstep(0.7 - lw.y, 0.7 + lw.y, lp.y)) * (1.0 - farRoom);
  vec3 rCeil = vec3(0.6) + panel * lit * 1.6 * lampC;
  vec3 rFloor = mix(vec3(0.22, 0.2, 0.19), vec3(0.32, 0.27, 0.22), rnd2);
  vec3 rSide = vec3(0.62, 0.6, 0.57);
  if (shop > 0.5) { rBack = mix(vec3(0.10, 0.09, 0.08), signC * 0.8 + 0.05, 0.4) * (0.5 + 0.5 * step(0.5, fract(hp.y * 1.4))); rSide *= 0.45; }   // shelving, merchandise
  vec3 room = ttz <= min(ttx, tty) ? rBack : (tty <= ttx ? (d.y > 0.0 ? rCeil : rFloor) : rSide);
  float dark = 0.08 + 0.10 * rnd;
  if (shop > 0.5) { room = mix(room, room * mix(vec3(1.0), signC * 2.5 + 0.4, 0.35), step(0.5, fcH(cell + 3.3))); lampC = vec3(1.0, 0.88, 0.7); }
  room *= lit > 0.5 ? (shop > 0.5 ? 0.9 * lampC * (0.38 + 2.4 * uNight) : 0.32 * lampC * (0.45 + 2.6 * uNight)) : vec3(dark * 0.5, dark * 0.52, dark * 0.6);
  float fog = exp(-t * 0.12); room *= mix(0.5, 1.0, fog);
  // blinds partly drawn
  vec2 zone = vec2(floor(cell.x / 5.0), cell.y);   // blinds set per tenancy zone, not per window (no pixel confetti)
  float blind = step(1.0 - fcH(zone + 4.2) * 0.7, f.y) * step(0.62, fcH(zone + 2.3)) * (1.0 - shop);
  room = mix(room, vec3(0.30, 0.30, 0.29) * (lit > 0.5 ? 0.8 : 0.18), blind);
  vec3 roomAvg = vec3(0.04, 0.038, 0.035) + (0.06 + 0.3 * uNight) * lampC;
  room = mix(room, roomAvg * 0.6, shop > 0.5 ? far : farRoom);
  float NdV = clamp(dot(-V, Nw), 0.0, 1.0);
  float F0 = dot(gl, vec3(0.333));
  float Fr = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
  float transK = (1.0 - Fr) * (1.0 - slab) * (shop > 0.5 ? 0.65 : 0.55);
  fcEmit = room * transK * glass + shopSign * signC * (0.6 + 6.0 * uNight) * (1.0 - far * 0.5) + shopSign * vec3(1.0, 0.95, 0.85) * 2.2 * uNight;
  // final albedo / metal
  if (shop > 0.5) gl *= 0.8;   // shop glass: darker, less mirror, interiors read
  vec3 spandrel = gl * 0.6;
  frame *= mix(1.0, 0.65, uNight * (1.0 - shop));   // unlit cladding drops away at night
  vec3 glassAlb = mix(gl, spandrel, slab);
  diffuseColor.rgb = mix(frame, glassAlb, glass);
  fcMetal = glass;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, fcRough, fcGlass);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 1.0, fcMetal);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 Nw = normalize(vWthN);
  vec3 Tw = normalize(cross(vec3(0.0, 1.0, 0.0), Nw) + vec3(1e-4, 0.0, 0.0));
  vec3 tiltW = Tw * fcTilt.x + vec3(0.0, 1.0, 0.0) * fcTilt.y;
  normal = normalize(normal + (viewMatrix * vec4(tiltW, 0.0)).xyz * fcGlass);
}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fcEmit;');
  });
  return mat;
}
