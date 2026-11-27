// Land: triangulated shoreline polygons, adaptively subdivided near the play areas, draped on heightAt().
// One blended ground material: pavers / lawn / bushland / river sand by a painted top-down mask, limestone on slopes.
// Shore edges: Elizabeth Quay quay walls + coping, The Landing steps, rock revetment along Mounts Bay, sand beaches
// on the South Perth foreshore.
import {
  ShapeUtils, Vector2, BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, CanvasTexture, LinearFilter,
  LinearMipmapLinearFilter, RepeatWrapping, Color, SRGBColorSpace, NoColorSpace,
} from 'three';
import { NORTH_LAND, SOUTH_LAND, ISLAND, ISLAND_POLY, HEIRISSON, SHORE_N, SHORE_S, ROADS, heightAt, isLand, PROMENADE_Y } from '../../map.js';
import { OSM_MASK } from '../../assets/osm_mask.js';
import './lampmap.js';
import { patch } from '../../cookbook/engine/patch.js';
import { getSurfaceSet } from '../../cookbook/materials/library.js';
import { ensureWorldVaryings, ensureNoise } from '../../cookbook/materials/weathering.js';

const FOCUS = [[60, -110, 1], [200, 40, 1], [-200, 1300, 1], [-60, 600, 0.25], [-750, 100, 0.5], [-900, 450, 0.4]];
function targetEdge(x, z) {
  let d = 1e9;
  for (const f of FOCUS) { const dx = x - f[0], dz = z - f[1]; d = Math.min(d, Math.sqrt(dx * dx + dz * dz) * (1 / f[2])); }
  let L = 4 + d * 0.055;
  if (x < -820 && z < 650 && z > -700) L = Math.min(L, 16);   // Kings Park escarpment needs relief
  return Math.min(L, 110);
}

function buildPolyMesh(contour) {
  const pts = contour.map((p) => new Vector2(p[0], p[1]));
  const faces = ShapeUtils.triangulateShape(pts, []);
  const V = contour.map((p) => [p[0], p[1]]);
  const cache = new Map();
  const mid = (a, b) => {
    const k = a < b ? a * 1e6 + b : b * 1e6 + a;
    let m = cache.get(k);
    if (m === undefined) { m = V.length; V.push([(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2]); cache.set(k, m); }
    return m;
  };
  const out = [];
  const len = (a, b) => Math.hypot(V[a][0] - V[b][0], V[a][1] - V[b][1]);
  const stack = faces.map((f) => [f[0], f[1], f[2], 0]);
  while (stack.length) {
    const [a, b, c, depth] = stack.pop();
    const cx = (V[a][0] + V[b][0] + V[c][0]) / 3, cz = (V[a][1] + V[b][1] + V[c][1]) / 3;
    const L = targetEdge(cx, cz);
    const lab = len(a, b), lbc = len(b, c), lca = len(c, a);
    const mx = Math.max(lab, lbc, lca);
    if (mx <= L || depth > 16) { out.push(a, b, c); continue; }
    // split the longest edge only (keeps triangles well shaped, conforming through the shared-midpoint cache)
    if (mx === lab) { const m = mid(a, b); stack.push([a, m, c, depth + 1], [m, b, c, depth + 1]); }
    else if (mx === lbc) { const m = mid(b, c); stack.push([a, b, m, depth + 1], [a, m, c, depth + 1]); }
    else { const m = mid(c, a); stack.push([a, b, m, depth + 1], [m, b, c, depth + 1]); }
  }
  // longest-edge bisection can leave T-junctions where neighbours split differently; a second conforming pass fixes
  // them: any edge whose midpoint exists in the cache is split.
  const fixed = [];
  const q = []; for (let i = 0; i < out.length; i += 3) q.push([out[i], out[i + 1], out[i + 2], 0]);
  const has = (a, b) => cache.get(a < b ? a * 1e6 + b : b * 1e6 + a);
  while (q.length) {
    const [a, b, c, d] = q.pop();
    const mab = has(a, b), mbc = has(b, c), mca = has(c, a);
    if (d > 8) { fixed.push(a, b, c); continue; }
    if (mab !== undefined) { q.push([a, mab, c, d + 1], [mab, b, c, d + 1]); continue; }
    if (mbc !== undefined) { q.push([a, b, mbc, d + 1], [a, mbc, c, d + 1]); continue; }
    if (mca !== undefined) { q.push([a, b, mca, d + 1], [mca, b, c, d + 1]); continue; }
    fixed.push(a, b, c);
  }
  const pos = new Float32Array(V.length * 3);
  for (let i = 0; i < V.length; i++) { pos[i * 3] = V[i][0]; pos[i * 3 + 1] = heightAt(V[i][0], V[i][1]); pos[i * 3 + 2] = V[i][1]; }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  // winding: make every triangle face up
  for (let i = 0; i < fixed.length; i += 3) {
    const a = fixed[i], b = fixed[i + 1], c = fixed[i + 2];
    const ux = V[b][0] - V[a][0], uz = V[b][1] - V[a][1], vx = V[c][0] - V[a][0], vz = V[c][1] - V[a][1];
    if (ux * vz - uz * vx > 0) { fixed[i + 1] = c; fixed[i + 2] = b; }
  }
  g.setIndex(fixed);
  g.computeVertexNormals();
  return g;
}
function circlePoly(cx, cz, r, n = 40) { const p = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } return p; }

// ------------------------------------------------------------------ mask (r = lawn, g = bush, b = sand; rest = pavers)
export const MASK = { x0: OSM_MASK.x0, z0: OSM_MASK.z0, size: OSM_MASK.size, px: 2048 };
function paintMask() {
  const c = document.createElement('canvas'); c.width = c.height = MASK.px;
  const ctx = c.getContext('2d');
  const s = MASK.px / MASK.size;
  const X = (x) => (x - MASK.x0) * s, Z = (z) => (z - MASK.z0) * s;
  const poly = (P, col) => { ctx.fillStyle = col; ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Z(p[1])) : ctx.moveTo(X(p[0]), Z(p[1])))); ctx.closePath(); ctx.fill(); };
  const rect = (x0, z0, x1, z1, col) => { ctx.fillStyle = col; ctx.fillRect(X(x0), Z(z0), (x1 - x0) * s, (z1 - z0) * s); };
  const line = (P, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w * s; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Z(p[1])) : ctx.moveTo(X(p[0]), Z(p[1])))); ctx.stroke(); };
  const LAWN = '#ff0000', BUSH = '#00ff00', SAND = '#0000ff', PAVE = '#000000';
  rect(-1500, -1100, 1500, 1900, LAWN);
  // Kings Park bushland: everything high on Mount Eliza
  const step = 6;
  for (let x = -1500; x < -330; x += step) for (let z = -900; z < 450; z += step) {
    const h = heightAt(x, z);
    if (h > 7) { ctx.fillStyle = h > 14 ? BUSH : '#40c000'; ctx.fillRect(X(x), Z(z), step * s + 1, step * s + 1); }
  }
  // lawns around the State War Memorial and Fraser Avenue
  ctx.fillStyle = LAWN; ctx.beginPath(); ctx.ellipse(X(-955), Z(120), 110 * s, 80 * s, 0.4, 0, Math.PI * 2); ctx.fill();
  // CBD: paved city blocks north of The Esplanade
  poly([[-380, -186], [400, -186], [400, -1100], [-380, -1100]], PAVE);
  rect(235, -205, 420, -78, LAWN);                       // Supreme Court Gardens
  rect(345, -66, 1500, 22, LAWN);                        // Langley Park
  rect(140, -470, 260, -420, LAWN);                      // Stirling Gardens
  // Elizabeth Quay precinct + Barrack Square: hard landscape
  poly([[-150, -200], [130, -200], [135, -40], [96, 30], [-72, 22], [-150, 26]], PAVE);
  poly([[80, -60], [345, -66], [345, 40], [90, 32]], PAVE);
  ctx.fillStyle = PAVE; ctx.beginPath(); ctx.arc(X(ISLAND.x), Z(ISLAND.z), ISLAND.r * s, 0, Math.PI * 2); ctx.fill();
  // garden beds in the EQ precinct (native planting)
  for (const [x, z, w, d] of [[-120, -150, 18, 40], [96, -170, 14, 20], [30, -195, 50, 5], [-90, -10, 30, 8], [270, -20, 40, 10]]) rect(x - w / 2, z - d / 2, x + w / 2, z + d / 2, LAWN);
  // footpaths + roads
  for (const r of ROADS) line(r.pts, r.w + 7, PAVE);
  // Mounts Bay Road foreshore path, Riverside path
  line([[-150, 18], [-330, 46], [-560, 118], [-800, 244], [-900, 290]], 4, PAVE);
  // South Perth: foreshore beach strip + path; suburb (paved) beyond Mill Point Road
  line([[-860, 590], [-740, 662], [-620, 862], [-430, 1102], [-320, 1198], [-232, 1260]], 9, SAND);
  line([[0, 1300], [200, 1324], [420, 1354], [800, 1406], [1400, 1462]], 8, SAND);
  line([[-760, 690], [-630, 880], [-500, 1030], [-380, 1150], [-260, 1258], [-150, 1300], [0, 1318], [300, 1350], [800, 1420]], 4, PAVE);
  // (suburbs beyond Mill Point Road stay lawn/garden: roads, houses and trees are drawn on top)
  rect(-240, 1268, -140, 1300, PAVE);                   // Mends Street plaza
  ctx.filter = 'blur(1.6px)'; ctx.drawImage(c, 0, 0); ctx.filter = 'none';
  const t = new CanvasTexture(c);
  // the real ground cover (OSM landuse: parks, Kings Park bush, beaches) replaces the sketch as soon as it decodes
  const img = new Image();
  img.onload = () => { ctx.clearRect(0, 0, c.width, c.height); ctx.filter = 'blur(1.2px)'; ctx.drawImage(img, 0, 0, c.width, c.height); ctx.filter = 'none'; t.needsUpdate = true; };
  img.src = OSM_MASK.png; t.flipY = false; t.colorSpace = NoColorSpace; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.generateMipmaps = true;
  return t;
}

// ------------------------------------------------------------------ blended ground material
function groundMaterial(G) {
  const P = getSurfaceSet('eq_pavers'), L = getSurfaceSet('lawn'), B = getSurfaceSet('bush'), S = getSurfaceSet('river_sand'), R = getSurfaceSet('limestone');
  const mask = paintMask();
  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.name = 'ground';
  mat.userData.noWeather = true;
  const U = {
    tMask: { value: mask }, uMask: { value: [MASK.x0, MASK.z0, MASK.size, 0] },
    tPA: { value: P.map }, tPN: { value: P.normalMap }, tPO: { value: P.roughnessMap },
    tLA: { value: L.map }, tLN: { value: L.normalMap }, tBA: { value: B.map }, tBN: { value: B.normalMap },
    tSA: { value: S.map }, tRA: { value: R.map }, tRN: { value: R.normalMap },
    uSc: { value: [1 / 1.8, 1 / 4, 1 / 4, 1 / 2] },
  };
  patch(mat, 'perth-ground', (shader) => {
    Object.assign(shader.uniforms, U);
    ensureWorldVaryings(shader); ensureNoise(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tMask, tPA, tPN, tPO, tLA, tLN, tBA, tBN, tSA, tRA, tRN;
uniform vec4 uMask, uSc;
#define DBG_KP ${/[?&]dbgkp/.test(location.search) ? 'true' : 'false'}
vec4 gW; vec2 gXZ; float gRock;
`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  gXZ = vWthPos.xz;
  vec3 mk = texture2D(tMask, (gXZ - uMask.xy) / uMask.z).rgb;
  // break up mask borders with noise so transitions look organic, not blurred
  float bn = vnoise3(vec3(gXZ * 0.35, 1.7)) - 0.5;
  mk = clamp((mk - 0.5) * 2.2 + 0.5 + bn * 0.55, 0.0, 1.0) * step(0.02, mk + 0.0);
  float wl = mk.r, wb = mk.g, ws = mk.b;
  float tot = wl + wb + ws; if (tot > 1.0) { wl /= tot; wb /= tot; ws /= tot; }
  gW = vec4(max(0.0, 1.0 - wl - wb - ws), wl, wb, ws);
  gRock = smoothstep(0.34, 0.18, normalize(vWthN).y) * (1.0 - gW.x) * (1.0 - 0.8 * gW.z) * (0.55 + 0.45 * vnoise3(vec3(gXZ * 0.05, 9.0)));
  vec3 aP = texture2D(tPA, gXZ * uSc.x).rgb, aL = texture2D(tLA, gXZ * uSc.y).rgb;
  vec3 aB = texture2D(tBA, gXZ * uSc.z).rgb, aS = texture2D(tSA, gXZ * uSc.w).rgb;
  vec3 aR = texture2D(tRA, vec2(gXZ.x + gXZ.y, vWthPos.y) * 0.25).rgb;
  vec3 alb = aP * gW.x + aL * gW.y + aB * vec3(0.62, 0.7, 0.5) * gW.z + aS * gW.w;   // bush floor under canopy shade: olive, dark
  alb = mix(alb, aR, gRock);
  float macro = vnoise3(vec3(gXZ * 0.012, 3.1)) * 0.6 + vnoise3(vec3(gXZ * 0.06, 5.3)) * 0.4;
  alb *= 0.88 + 0.22 * macro;
  // bushland beyond the tree draw distance: paint a mottled eucalypt canopy (crowns ~8-12 m, sunlit tops vs dark gaps)
  // so Kings Park still reads as dense bush from the river, Mends St and the air
  float camDg = length(vWthPos - cameraPosition);
  float inKP = step(-2800.0, gXZ.x) * step(gXZ.x, -650.0) * step(-1100.0, gXZ.y) * step(gXZ.y, 900.0);
  float farV = max(smoothstep(260.0, 650.0, camDg) * gW.z, smoothstep(700.0, 1300.0, camDg) * inKP * (1.0 - gW.w));   // Kings Park reads as canopy once its trees fade
  if (farV > 0.001) {
    float can = smoothstep(0.38, 0.62, vnoise3(vec3(gXZ * 0.11, 2.0)) * 0.65 + vnoise3(vec3(gXZ * 0.31, 4.0)) * 0.35);
    vec3 canC = mix(vec3(0.018, 0.028, 0.014), vec3(0.10, 0.125, 0.055), can * can) * (0.85 + 0.3 * vnoise3(vec3(gXZ * 0.02, 7.0)));
    alb = mix(alb, DBG_KP ? vec3(1.0, 0.0, 0.0) : canC, farV * 0.9);
  }
  // limestone banding course across the EQ paving: a 0.9 m pale strip every 10.8 m (world space, on the pavers only)
  float bandP = step(fract(gXZ.x / 10.8 + gXZ.y * 0.0), 0.083) * step(-260.0, gXZ.y) * step(gXZ.y, 60.0) * step(-150.0, gXZ.x) * step(gXZ.x, 350.0);
  alb = mix(alb, vec3(0.20, 0.19, 0.17) * (0.92 + 0.16 * macro), bandP * gW.x);
  float ao = mix(1.0, texture2D(tPO, gXZ * uSc.x).r, gW.x);
  diffuseColor.rgb *= alb * ao;
}`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * (texture2D(tPO, gXZ * uSc.x).g * gW.x + 0.9 * gW.y + 0.93 * gW.z + 0.88 * gW.w);
roughnessFactor = mix(roughnessFactor, 0.85, gRock);`)
      .replace('#include <aomap_fragment>', `
  { // street-lamp light map (props.js): albedo-lit warm pools at night
    vec2 luv = (vWthPos.xz - uLampBox.xy) / uLampBox.zw;
    float lamp = texture2D(uLampMap, luv).r * step(0.0, luv.x) * step(luv.x, 1.0) * step(0.0, luv.y) * step(luv.y, 1.0);
    reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.74, 0.46) * (lamp * lamp * 3.4 + 0.008) * uNight;
  }
#include <aomap_fragment>`)
      .replace('#include <normal_fragment_maps>', `{
  vec3 nP = texture2D(tPN, gXZ * uSc.x).xyz * 2.0 - 1.0, nL = texture2D(tLN, gXZ * uSc.y).xyz * 2.0 - 1.0;
  vec3 nB = texture2D(tBN, gXZ * uSc.z).xyz * 2.0 - 1.0;
  vec3 tn = nP * gW.x + nL * gW.y + nB * gW.z + vec3(0.0, 0.0, 1.0) * gW.w;
  vec3 nR = texture2D(tRN, vec2(gXZ.x + gXZ.y, vWthPos.y) * 0.25).xyz * 2.0 - 1.0;
  tn = normalize(mix(tn, nR, gRock));
  vec3 Nw = normalize(vWthN);
  vec3 Tw = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
  vec3 Bw = normalize(cross(Tw, Nw));
  vec3 nw = normalize(Tw * tn.x + Bw * tn.y + Nw * tn.z);
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
}`);
  });
  return mat;
}

// ------------------------------------------------------------------ shore edges
function strip(pts, build, want) { // pts: [[x,z],...]; build(p, n) → [[x,y,z] top, [x,y,z] bottom]; want(n) → desired normal dir
  const pos = [], uv = [], idx = []; let u = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    if (i > 0) u += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const [top, bot] = build(p, [tz, -tx]);
    pos.push(...top, ...bot);
    const h = Math.hypot(top[0] - bot[0], top[1] - bot[1], top[2] - bot[2]);
    uv.push(u, 0, u, h);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  if (want) { // flip winding if the strip faces the wrong way
    const N = g.attributes.normal.array, P2 = pts[Math.floor(pts.length / 2)];
    const k = Math.floor(pts.length / 2) * 2; const nv = [N[k * 3], N[k * 3 + 1], N[k * 3 + 2]];
    const w = want(P2);
    if (nv[0] * w[0] + nv[1] * w[1] + nv[2] * w[2] < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  }
  return g;
}
// split a closed polygon into runs of consecutive shore points (skipping the far closing corners)
function densify(P, step = 3) {
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)]);
  }
  out.push(P[P.length - 1]);
  return out;
}

export function create(G, { mats }) {
  const group = []; const meshes = {};
  const gm = groundMaterial(G);
  const north = new Mesh(buildPolyMesh(NORTH_LAND), gm);
  const south = new Mesh(buildPolyMesh(SOUTH_LAND), gm);
  const island = new Mesh(buildPolyMesh(ISLAND_POLY), gm);
  const heir = new Mesh(buildPolyMesh(HEIRISSON), gm);
  for (const m of [north, south, island, heir]) { m.receiveShadow = true; m.name = 'ground'; group.push(m); }
  meshes.ground = [north, south, island, heir];

  // --- shore: which side is water? walls face the water (normal from the strip builder points left of travel)
  const shoreN = SHORE_N;
  const wallPts = [], revetPts = [], limePts = [];
  const dn = densify(shoreN, 4);
  // classify contiguous runs
  let run = [], kind = null;
  const flush = () => { if (run.length > 1) (kind === 'wall' ? wallPts : kind === 'rev' ? revetPts : limePts).push(run); run = []; };
  for (const p of dn) {
    const k = p[0] < -115 ? 'rev' : p[0] < 345 ? 'wall' : 'lime';
    if (k !== kind) { if (run.length) { const last = run[run.length - 1]; flush(); run.push(last); } kind = k; }
    run.push(p);
  }
  flush();
  const shoreS = densify(SHORE_S, 4);
  const sandS = [], wallS = []; run = []; kind = null;
  for (const p of shoreS) {
    const k = p[0] > -300 && p[0] < -150 && p[1] > 1250 ? 'wall' : 'sand';
    if (k !== kind) { if (run.length) { const last = run[run.length - 1]; (kind === 'wall' ? wallS : sandS).push(run); run = [last]; } kind = k; }
    run.push(p);
  }
  if (run.length > 1) (kind === 'wall' ? wallS : sandS).push(run);

  // the land polygon winds so that, walking along it, water is on one side; detect per run by probing
  const waterSide = (p, n) => (!isLand(p[0] + n[0] * 3, p[1] + n[1] * 3) ? 1 : -1);
  const wallGeo = (pts) => { const s = waterSide(pts[Math.floor(pts.length / 2)], (() => { const a = pts[0], b = pts[1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]; })());
    const mid = pts[Math.floor(pts.length / 2)], a0 = pts[Math.max(0, Math.floor(pts.length / 2) - 1)], b0 = pts[Math.min(pts.length - 1, Math.floor(pts.length / 2) + 1)]; const tl = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) || 1; const wn = [((b0[1] - a0[1]) / tl) * s, 0, (-(b0[0] - a0[0]) / tl) * s];
    return strip(pts, (p, n) => { const y = heightAt(p[0], p[1]); const o = 0.02 * s; return [[p[0] + n[0] * o, y + 0.001, p[1] + n[1] * o], [p[0] + n[0] * o, -3, p[1] + n[1] * o]]; }, () => wn); };
  const slopeGeo = (pts, run_, toY) => { const s = waterSide(pts[Math.floor(pts.length / 2)], (() => { const a = pts[0], b = pts[1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]; })());
    return strip(pts, (p, n) => { const y = heightAt(p[0], p[1]); return [[p[0], y - 0.02, p[1]], [p[0] + n[0] * run_ * s, toY, p[1] + n[1] * run_ * s]]; }, () => [0, 1, 0]); };
  const copingGeo = (pts, w, hgt) => { const s = waterSide(pts[Math.floor(pts.length / 2)], (() => { const a = pts[0], b = pts[1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]; })());
    return strip(pts, (p, n) => { const y = heightAt(p[0], p[1]) + hgt; return [[p[0] - n[0] * w * s, y, p[1] - n[1] * w * s], [p[0] + n[0] * 0.08 * s, y, p[1] + n[1] * 0.08 * s]]; }, () => [0, 1, 0]); };

  // coping block front face (overhangs the wall by 8 cm) and a dark wet/algae band just above the waterline
  const copeFace = (pts, hgt) => { const s = waterSide(pts[Math.floor(pts.length / 2)], (() => { const a = pts[0], b = pts[1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]; })());
    return strip(pts, (p, n) => { const y = heightAt(p[0], p[1]); const o = 0.08 * s; return [[p[0] + n[0] * o, y + hgt, p[1] + n[1] * o], [p[0] + n[0] * o, y - 0.24, p[1] + n[1] * o]]; }, (p) => { const a = pts[0], b = pts[1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [((b[1] - a[1]) / l) * s, 0, (-(b[0] - a[0]) / l) * s]; }); };
  const wetBand = (pts) => { const s = waterSide(pts[Math.floor(pts.length / 2)], (() => { const a = pts[0], b = pts[1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]; })());
    return strip(pts, (p, n) => { const o = 0.035 * s; return [[p[0] + n[0] * o, 0.45, p[1] + n[1] * o], [p[0] + n[0] * o, -0.6, p[1] + n[1] * o]]; }, (p) => { const a = pts[0], b = pts[1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [((b[1] - a[1]) / l) * s, 0, (-(b[0] - a[0]) / l) * s]; }); };
  const wetMat = mats.quayWall.clone(); wetMat.color.multiplyScalar(0.42); wetMat.roughness = 0.35; wetMat.name = 'quay-wet';
  const add = (geo, mat, name, shadow = true) => { const m = new Mesh(geo, mat); m.name = name; m.receiveShadow = true; m.castShadow = shadow; group.push(m); return m; };
  for (const r of wallPts) { add(wallGeo(r), mats.quayWall, 'quay-wall'); add(copingGeo(r, 0.6, 0.12), mats.coping, 'quay-coping', false); add(copeFace(r, 0.12), mats.coping, 'quay-coping-face', false); add(wetBand(r), wetMat, 'quay-wet', false); }
  for (const r of limePts) add(wallGeo(r), mats.limestone, 'lime-wall');
  for (const r of revetPts) add(slopeGeo(r, 7, -1.5), mats.rock, 'revetment');
  for (const r of wallS) { add(wallGeo(r), mats.limestone, 'sp-wall'); add(copingGeo(r, 0.45, 0.04), mats.coping, 'sp-coping', false); }
  for (const r of sandS) add(slopeGeo(r, 9, -1.4), mats.sand, 'beach');
  const isl = densify([...ISLAND_POLY, ISLAND_POLY[0]], 3);
  add(wallGeo(isl), mats.quayWall, 'island-wall'); add(copingGeo(isl, 0.5, 0.12), mats.coping, 'island-coping', false); add(copeFace(isl, 0.12), mats.coping, 'island-coping-face', false); add(wetBand(isl), wetMat, 'island-wet', false);

  return { meshes: group, ground: meshes.ground, material: gm };
}
