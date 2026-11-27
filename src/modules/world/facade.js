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
import { MeshStandardMaterial } from 'three';
import { patch } from '../../cookbook/engine/patch.js';
import { ensureWorldVaryings } from '../../cookbook/materials/weathering.js';

export function facadeMaterial(name = 'facade') {
  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.0, vertexColors: true });
  mat.name = name;
  mat.userData.weather = { dust: 0.2, wet: 0, beads: 0, porosity: 0.1 };
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
float fcBand(float x, float w, float aa) { return 1.0 - smoothstep(w, w + aa, x); }
`)
      
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float pw = vFac.x, fh = vFac.y, style = floor(vFac.z + 0.5), seed = vFac.w;
  vec2 cellSz = vec2(pw, fh);
  vec2 q = vFUv / cellSz;
  vec2 cell = floor(q), f = fract(q);
  vec2 fw = fwidth(q);
  fcFoot = max(fw.x, fw.y);                         // cells per pixel
  float far = smoothstep(0.25, 0.7, fcFoot);         // 1 = cells smaller than ~2 px: use averages
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
    vec2 w = vec2(0.30, 0.22);
    float inX = smoothstep(w.x - aa.x / pw, w.x, f.x) * (1.0 - smoothstep(1.0 - w.x, 1.0 - w.x + aa.x / pw, f.x));
    float inY = smoothstep(w.y - aa.y / fh, w.y, f.y) * (1.0 - smoothstep(0.86, 0.86 + aa.y / fh, f.y));
    glass = inX * inY;
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
    frame = mix(frame, vec3(0.75), edge);
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
  float avgGlass = style < 0.5 ? 0.88 : style < 1.5 ? 0.30 : style < 2.5 ? 0.48 : style < 3.5 ? 0.74 : style < 4.5 ? 0.62 : 0.0;
  glass = mix(glass, avgGlass, far);
  slab = mix(slab, style < 0.5 ? 0.18 : style < 3.5 && style > 2.5 ? 0.13 : style > 3.5 && style < 4.5 ? 0.12 : 0.0, far);
  fcGlass = glass;
  // per-panel tint/roughness variation; oil-canning tilt (faded with distance)
  vec3 gl = vGlass * (0.95 + 0.1 * rnd2);
  fcRough = mix(0.05 + 0.04 * rnd, 0.08, far);
  fcTilt = (vec2(rnd, rnd2) - 0.5) * 0.045 * (1.0 - far);
  // ---------------- interior mapping (rooms behind the glass)
  vec3 V = normalize(vWthPos - cameraPosition);
  vec3 Nw = normalize(vWthN);
  vec3 Tw = normalize(cross(vec3(0.0, 1.0, 0.0), Nw) + vec3(1e-4, 0.0, 0.0));
  vec3 Bw = vec3(0.0, 1.0, 0.0);
  vec3 d = vec3(dot(V, Tw), dot(V, Bw), -dot(V, Nw));
  float depth = 7.0;
  vec3 p0 = vec3(f.x * pw, f.y * fh, 0.0);
  vec3 tt = vec3((d.x > 0.0 ? (pw - p0.x) : -p0.x) / (d.x + 1e-5), (d.y > 0.0 ? (fh - p0.y) : -p0.y) / (d.y + 1e-5), depth / max(d.z, 1e-3));
  float t = min(min(abs(tt.x), abs(tt.y)), tt.z);
  vec3 hp = p0 + d * t;
  float lit = step(0.8, fcH(cell * 0.73 + seed));
  vec3 lampC = mix(vec3(1.0, 0.86, 0.66), vec3(0.85, 0.92, 1.0), step(0.5, fcH(cell + 9.1)));
  vec3 room;
  if (t == tt.z) { // back wall: partitions / furniture silhouettes
    float desk = step(hp.y, 0.75) * step(0.15, fract(hp.x * 0.6 + rnd));
    room = mix(vec3(0.55, 0.53, 0.5), vec3(0.18, 0.16, 0.15), desk);
  } else if (t == abs(tt.y)) {
    if (d.y > 0.0) { // ceiling with light panels
      vec2 lp = fract(hp.xz * vec2(0.5, 0.45)); float panel = step(0.3, lp.x) * step(lp.x, 0.7) * step(0.3, lp.y) * step(lp.y, 0.7);
      room = vec3(0.6) + panel * lit * 3.0 * lampC;
    } else { room = mix(vec3(0.22, 0.2, 0.19), vec3(0.32, 0.27, 0.22), rnd2); }  // carpet
  } else { room = vec3(0.62, 0.6, 0.57); }
  float dark = 0.08 + 0.10 * rnd;
  room *= lit > 0.5 ? (0.32 * lampC) : vec3(dark * 0.5, dark * 0.52, dark * 0.6);
  float fog = exp(-t * 0.12); room *= mix(0.5, 1.0, fog);
  // blinds partly drawn
  float blind = step(1.0 - fcH(cell + 4.2) * 0.7, f.y) * step(0.45, fcH(cell + 2.3));
  room = mix(room, vec3(0.42, 0.42, 0.40) * (lit > 0.5 ? 0.8 : 0.25), blind);
  vec3 roomAvg = vec3(0.04, 0.038, 0.035) + 0.06 * lampC;
  room = mix(room, roomAvg * 0.6, far);
  float NdV = clamp(dot(-V, Nw), 0.0, 1.0);
  float F0 = dot(gl, vec3(0.333));
  float Fr = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
  float transK = (1.0 - Fr) * (1.0 - slab) * 0.55;
  fcEmit = room * transK * glass;
  // final albedo / metal
  vec3 spandrel = gl * 0.6;
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
