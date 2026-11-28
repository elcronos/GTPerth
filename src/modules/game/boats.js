// Boats: Transperth ferry MV Tricia (23.7 m aluminium catamaran, 148 seats) and a WA Water Police launch.
// Buoyancy samples the same Gerstner sea the GPU draws (sea.heightAt); thrust + rudder + bow thrusters, keel drag,
// bow rise at speed, shore collisions against the real shoreline, and a foam wake ribbon.
import { Group, Mesh, MeshStandardMaterial, Color, BufferGeometry, Float32BufferAttribute, DynamicDrawUsage, ShaderMaterial, CanvasTexture, SRGBColorSpace, PlaneGeometry, AdditiveBlending, Vector3 } from 'three';
import { Kit, lathe, roundedBox, extrudeBevel, tube } from '../../cookbook/geo/kit.js';
import { isLand } from '../../map.js';
import { ATMOS_DECL, ATMOS_GLSL } from '../../cookbook/lighting/atmos.glsl.js';
import { atmosUniforms } from '../../cookbook/lighting/atmos.js';

function nameTex(text, sub, bg = null, fg = '#0d3d2a') {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128; const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, 1024, 128); }
  g.fillStyle = fg; g.font = 'bold 70px Arial, Helvetica, sans-serif'; g.textAlign = 'left'; g.fillText(text, 20, 84);
  if (sub) { g.font = 'bold 40px Arial, sans-serif'; g.textAlign = 'right'; g.fillText(sub, 1004, 84); }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}

export function boatMaterials() {
  return {
    hull: new MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.28, metalness: 0.05, vertexColors: true }),
    deck: new MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.8, vertexColors: true }),
    glass: new MeshStandardMaterial({ color: 0x0a1014, roughness: 0.04, metalness: 0.9, vertexColors: true }),
    green: new MeshStandardMaterial({ color: 0x0e5a3a, roughness: 0.35, vertexColors: true }),
    yellow: new MeshStandardMaterial({ color: 0xf2b81a, roughness: 0.35, vertexColors: true }),
    steel: new MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.3, metalness: 0.9, vertexColors: true }),
    dark: new MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.7, vertexColors: true }),
    blue: new MeshStandardMaterial({ color: 0x0a2a8a, emissive: new Color(0.1, 0.25, 1.0), emissiveIntensity: 0.4, roughness: 0.3, vertexColors: true }),
    red: new MeshStandardMaterial({ color: 0x8a0a0a, emissive: new Color(1, 0.08, 0.05), emissiveIntensity: 0.4, roughness: 0.3, vertexColors: true }),
    policeBlue: new MeshStandardMaterial({ color: 0x123a9a, roughness: 0.35, vertexColors: true }),
    seat: new MeshStandardMaterial({ color: 0x1f4a7a, roughness: 0.6, vertexColors: true }),
  };
}

// MV Tricia (Southerly Designs / Dongara Marine, 2019): 23.9 m x 5.5 m aluminium catamaran, 148 seats, one passenger
// deck. Bow +x. Twin demi-hulls with fine entries, a bridge deck carrying a fully glazed cabin (dark tinted wrap, white
// mullions), a compact wheelhouse raised on the starboard side forward, solar panels on the roof, open stern deck with
// rails, side boarding gates, Transperth green / yellow waterline stripes and lettering. The old photogrammetry mesh
// read as a bus at 7.6 m beam; this is built to the published dimensions.
export function buildFerry(M) {
  const L = 23.9, B = 5.5, HW = 1.45;   // demi-hull width
  const k = new Kit(), cz = B / 2 - HW / 2;
  for (const s of [-1, 1]) {
    // demi-hull side profile (x along, y up), extruded across and bevelled: flat run, raked fine bow, square transom
    const hp = [[-11.9, -0.85], [7.4, -0.85], [10.6, -0.35], [11.95, 0.55], [11.85, 1.0], [-11.95, 1.0], [-11.95, -0.55]];
    k.add(extrudeBevel(hp, { depth: HW, bevel: 0.22, bevelSeg: 3 }), 'hull', { at: [0, -0.05, s * cz] });
    k.box(L * 0.96, 0.2, 0.05, 'green', { at: [-0.4, 0.08, s * (B / 2 + 0.005)], r: 0.01 });
    k.box(L * 0.94, 0.09, 0.05, 'yellow', { at: [-0.5, 0.29, s * (B / 2 + 0.008)], r: 0.01 });
    k.box(L * 0.9, 0.16, 0.05, 'dark', { at: [-0.6, -0.62, s * (B / 2 + 0.003)], r: 0.01 });   // antifoul boot-top
    k.box(0.5, 0.4, 0.6, 'dark', { at: [-11.7, -0.3, s * cz], r: 0.05 });                       // waterjet / prop housing
  }
  // bridge deck between the hulls and the main deck (non-slip grey)
  k.add(extrudeBevel([[-11.9, 0.45], [9.8, 0.45], [11.0, 0.95], [10.9, 1.2], [-11.95, 1.2]], { depth: B, bevel: 0.1, bevelSeg: 2 }), 'hull');
  k.box(L * 0.92, 0.04, B - 0.3, 'deck', { at: [-0.5, 1.22, 0], r: 0.01 });
  // passenger cabin: raked windscreen, near-full-length glazing, rounded roof edge
  const CX0 = -6.4, CX1 = 7.1, CY0 = 1.2, CY1 = 3.35;
  k.add(extrudeBevel([[CX0, CY0], [CX1 - 0.6, CY0], [CX1 + 0.9, 1.75], [CX1, CY1 - 0.05], [CX0 + 0.2, CY1], [CX0, CY1 - 0.3]], { depth: B - 0.35, bevel: 0.16, bevelSeg: 3 }), 'hull');
  k.add(extrudeBevel([[CX0 + 0.25, 1.95], [CX1 + 0.45, 1.95], [CX1 + 0.05, 3.0], [CX0 + 0.25, 3.05]], { depth: B - 0.25, bevel: 0.04 }), 'glass');
  for (let xx = CX0 + 1.4; xx < CX1 - 0.3; xx += 1.35) for (const s of [-1, 1]) k.box(0.09, 1.1, 0.04, 'hull', { at: [xx, 2.5, s * (B / 2 - 0.12)], r: 0.015 });
  for (const s of [-1, 1]) { k.box(1.1, 1.9, 0.05, 'dark', { at: [CX0 + 0.9, 2.15, s * (B / 2 - 0.13)], r: 0.02 }); k.box(1.1, 1.9, 0.05, 'dark', { at: [2.2, 2.15, s * (B / 2 - 0.13)], r: 0.02 }); }   // boarding doors
  // seats seen through the glass: rows of blue bus-style seats either side of the aisle
  for (let xx = CX0 + 1.0; xx < CX1 - 1.0; xx += 0.85) for (const s of [-1, 1]) { k.box(0.45, 0.45, 1.6, 'seat', { at: [xx, 1.48, s * 1.35], r: 0.05 }); k.box(0.08, 0.55, 1.6, 'seat', { at: [xx - 0.22, 1.95, s * 1.35], r: 0.03 }); }
  k.add(extrudeBevel([[CX0 - 0.3, CY1 - 0.08], [CX1 + 0.1, CY1 - 0.12], [CX1 + 0.3, CY1 + 0.12], [CX0 - 0.2, CY1 + 0.16]], { depth: B - 0.1, bevel: 0.1, bevelSeg: 2 }), 'hull');   // roof
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) k.box(1.6, 0.04, 1.0, 'solar', { at: [CX0 + 1.2 + i * 1.75, CY1 + 0.2, s * 0.65], r: 0.01, rot: [0, 0, 0.04] });
  // compact wheelhouse raised on the starboard side, forward (all controls on the starboard side: one-person docking)
  const WZ = B / 2 - 1.1;   // starboard = +z with the bow at +x (right = forward × up)
  k.add(extrudeBevel([[3.0, CY1 + 0.1], [5.9, CY1 + 0.1], [6.5, CY1 + 0.75], [6.1, CY1 + 1.35], [3.2, CY1 + 1.4]], { depth: 2.0, bevel: 0.1, bevelSeg: 2 }), 'hull', { at: [0, 0, WZ] });
  k.add(extrudeBevel([[3.4, CY1 + 0.72], [6.25, CY1 + 0.72], [5.95, CY1 + 1.22], [3.4, CY1 + 1.26]], { depth: 2.08, bevel: 0.03 }), 'glass', { at: [0, 0, WZ] });
  k.cyl(0.05, 1.3, 'steel', { at: [3.6, CY1 + 2.05, WZ] }); k.box(0.9, 0.05, 0.05, 'steel', { at: [3.6, CY1 + 2.55, WZ], r: 0.01 });   // mast + yard
  k.box(0.12, 0.12, 0.12, 'navWhite', { at: [3.6, CY1 + 2.75, WZ], r: 0.03 });
  k.box(0.22, 0.12, 0.06, 'red', { at: [6.4, 2.2, -B / 2 + 0.1], r: 0.02 }); k.box(0.22, 0.12, 0.06, 'navGreen', { at: [6.4, 2.2, B / 2 - 0.1], r: 0.02 });   // port red / starboard green
  // open stern deck: rails, benches, life rings; rails along the side decks forward of the cabin
  for (const s of [-1, 1]) { k.add(tube([[-11.6, 2.25, s * (B / 2 - 0.15)], [CX0, 2.25, s * (B / 2 - 0.15)]], 0.035), 'steel', { occ: false }); k.add(tube([[CX1 + 0.6, 2.2, s * (B / 2 - 0.15)], [10.6, 2.0, s * 0.6]], 0.035), 'steel', { occ: false }); }
  k.add(tube([[-11.6, 2.25, -B / 2 + 0.15], [-11.6, 2.25, B / 2 - 0.15]], 0.035), 'steel', { occ: false });
  for (let xx = -11.4; xx < CX0; xx += 1.1) for (const s of [-1, 1]) k.bar([xx, 1.24, s * (B / 2 - 0.15)], [xx, 2.25, s * (B / 2 - 0.15)], 0.035, 0.035, 'steel');
  for (let i = 0; i < 2; i++) k.box(0.5, 0.45, B - 1.6, 'seat', { at: [-9.6 + i * 1.3, 1.48, 0], r: 0.05 });
  for (const s of [-1, 1]) k.cyl(0.33, 0.09, 'navOrange', { at: [CX0 - 0.15, 2.3, s * (B / 2 - 0.05)], rot: [Math.PI / 2, 0, 0], seg: 14 });
  // rubbing strake + fenders
  for (const s of [-1, 1]) k.box(L * 0.95, 0.16, 0.12, 'dark', { at: [-0.4, 1.05, s * (B / 2 + 0.05)], r: 0.05 });
  k.bakeAO({ radius: 0.5, samples: 6, strength: 0.5 });
  const g = k.build({ ...M,
    solar: new MeshStandardMaterial({ color: 0x0c1830, roughness: 0.2, metalness: 0.6, vertexColors: true }),
    navWhite: new MeshStandardMaterial({ color: 0xffffff, emissive: new Color(1, 1, 0.95), emissiveIntensity: 1.2, vertexColors: true }),
    navGreen: new MeshStandardMaterial({ color: 0x0a6a2a, emissive: new Color(0.1, 1, 0.3), emissiveIntensity: 0.6, vertexColors: true }),
    navOrange: new MeshStandardMaterial({ color: 0xff6a20, roughness: 0.5, vertexColors: true }) });
  const tTex = nameTex('TRANSPERTH', 'TRICIA'), tMat = new MeshStandardMaterial({ map: tTex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const s of [-1, 1]) { const p = new Mesh(new PlaneGeometry(8.5, 1.05), tMat); p.position.set(-1.0, 0.72, s * (B / 2 + 0.03)); p.rotation.y = s > 0 ? 0 : Math.PI; g.add(p); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, L, B, helm: new Vector3(4.6, CY1 + 1.0, WZ), deckY: 1.25 };
}

export function buildPoliceBoat(M) {
  const k = new Kit(); const L = 10.5, B = 3.4;
  const hull = lathe([[0, -0.6], [1.2, -0.4], [1.7, 0.2], [1.7, 0.8], [0, 0.8]], { seg: 18 });
  hull.scale(L / 2 / 1.7, 1, 1);
  k.add(hull, 'hull');
  k.box(L * 0.9, 0.18, 0.06, 'policeBlue', { at: [0, 0.35, B / 2 - 0.03], r: 0.01 }); k.box(L * 0.9, 0.18, 0.06, 'policeBlue', { at: [0, 0.35, -B / 2 + 0.03], r: 0.01 });
  k.box(L * 0.85, 0.06, B - 0.4, 'deck', { at: [-0.2, 0.82, 0], r: 0.02 });
  k.box(3.2, 1.3, 2.4, 'hull', { at: [0.6, 1.55, 0], r: 0.1 });
  k.box(3.0, 0.7, 2.45, 'glass', { at: [0.7, 1.75, 0], r: 0.05 });
  k.box(0.4, 0.15, 1.2, 'dark', { at: [0.6, 2.3, 0], r: 0.03 });
  k.box(0.32, 0.14, 0.5, 'blue', { at: [0.6, 2.42, 0.32], r: 0.03 }); k.box(0.32, 0.14, 0.5, 'red', { at: [0.6, 2.42, -0.32], r: 0.03 });
  k.cyl(0.05, 1.8, 'steel', { at: [-0.4, 2.9, 0] });
  k.box(1.4, 0.9, 1.0, 'dark', { at: [-L / 2 + 0.9, 1.1, 0], r: 0.1 });   // outboards
  const g = k.build(M);
  const tMat = new MeshStandardMaterial({ map: nameTex('WATER POLICE', '', null, '#123a9a'), transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const s of [-1, 1]) { const p = new Mesh(new PlaneGeometry(5, 0.6), tMat); p.position.set(0.3, 1.0, s * (B / 2 + 0.02)); p.rotation.y = s > 0 ? 0 : Math.PI; g.add(p); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, L, B, helm: new Vector3(0.6, 1.6, 0), deckY: 0.85 };
}

// ------------------------------------------------------------------ wake ribbon
const WAKE_N = 90;
function wakeMaterial() {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, ...atmosUniforms() },
    vertexShader: /*glsl*/`
attribute vec2 aW; varying vec2 vW; varying vec3 vPos;
void main() { vW = aW; vec4 wp = modelMatrix * vec4(position, 1.0); vPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: ATMOS_DECL + ATMOS_GLSL + /*glsl*/`
uniform float uTime; varying vec2 vW; varying vec3 vPos;
float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.0), f.x), f.y); }
void main() {
  float age = vW.x, across = vW.y;                    // age 0 (stern) .. 1 (old); across -1..1
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(across));
  float core = exp(-across * across * 6.0);
  vec2 p = vPos.xz * 1.6 + vec2(uTime * 0.2, 0.0);
  float bubbles = smoothstep(0.35, 0.8, n(p) * 0.6 + n(p * 3.1) * 0.4);
  float a = (core * 0.85 + bubbles * 0.6 * edge) * pow(1.0 - age, 1.6) * edge;
  vec3 col = vec3(0.85, 0.9, 0.92) * a * 0.9;
  col *= atmosTransmittance(vPos, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
}`,
  });
}
export class Wake {
  constructor(G, width) {
    this.G = G; this.width = width; this.pts = []; this.t = 0;
    const g = new BufferGeometry();
    this.pos = new Float32Array(WAKE_N * 2 * 3); this.aw = new Float32Array(WAKE_N * 2 * 2);
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('aW', new Float32BufferAttribute(this.aw, 2).setUsage(DynamicDrawUsage));
    const idx = []; for (let i = 0; i < WAKE_N - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } g.setIndex(idx);
    this.mat = wakeMaterial(); this.mesh = new Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 3; G.scene.add(this.mesh);
    this.geo = g;
  }
  update(dt, x, z, h, speed) {
    this.t += dt; this.mat.uniforms.uTime.value = this.G.t;
    const fx = Math.cos(h), fz = Math.sin(h);
    const last = this.pts[0];
    if (!last || Math.hypot(last.x - x, last.z - z) > 0.9) this.pts.unshift({ x, z, nx: -fz, nz: fx, s: Math.min(1, Math.abs(speed) / 6), age: 0 });
    for (const p of this.pts) p.age += dt;
    while (this.pts.length > WAKE_N || (this.pts.length && this.pts[this.pts.length - 1].age > 18)) this.pts.pop();
    const n = this.pts.length;
    for (let i = 0; i < WAKE_N; i++) {
      const p = this.pts[Math.min(i, n - 1)] || { x, z, nx: 0, nz: 1, s: 0, age: 99 };
      const spread = this.width * (0.5 + p.age * 0.55) * (0.3 + 0.7 * p.s);
      const o = i * 6;
      this.pos[o] = p.x + p.nx * spread; this.pos[o + 1] = 0.06; this.pos[o + 2] = p.z + p.nz * spread;
      this.pos[o + 3] = p.x - p.nx * spread; this.pos[o + 4] = 0.06; this.pos[o + 5] = p.z - p.nz * spread;
      const age = Math.min(1, p.age / 14) * (i < n ? 1 : 0) + (i < n ? 0 : 1);
      const fade = age + (1 - p.s) * 0.6;
      this.aw[i * 4] = Math.min(1, fade); this.aw[i * 4 + 1] = 1; this.aw[i * 4 + 2] = Math.min(1, fade); this.aw[i * 4 + 3] = -1;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aW.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ physics
export class Boat {
  constructor(G, kind, model, sea) {
    this.G = G; this.kind = kind; this.model = model; this.sea = sea;
    this.root = new Group(); this.root.add(model.group); G.scene.add(this.root);
    this.x = 0; this.z = 0; this.y = 0; this.h = 0; this.vx = 0; this.vz = 0; this.w = 0;
    this.throttle = 0; this.steer = 0; this.pitch = 0; this.roll = 0;
    const ferry = kind === 'ferry';
    this.P = ferry ? { thrust: 3.4, rev: 1.6, top: 19, drag: 0.012, lat: 2.6, yaw: 0.075, bow: 0.18, draft: 0.95, rise: 0.012 } : { thrust: 6.5, rev: 2.5, top: 24, drag: 0.011, lat: 3.4, yaw: 0.16, bow: 0.4, draft: 0.45, rise: 0.02 };
    this.health = 100; this.hitCooldown = 0; this.r = model.L / 2;
    this.wake = new Wake(G, model.B * 0.55);
  }
  get speed() { return this.vx * Math.cos(this.h) + this.vz * Math.sin(this.h); }
  place(x, z, h) { this.x = x; this.z = z; this.h = h; this.vx = this.vz = this.w = 0; this.sync(0.016); }
  update(dt) {
    const P = this.P, fx = Math.cos(this.h), fz = Math.sin(this.h);
    let vf = this.vx * fx + this.vz * fz, vl = -this.vx * fz + this.vz * fx;
    const thr = this.throttle > 0 ? this.throttle * P.thrust * (1 - Math.min(1, vf / P.top) ** 2) : this.throttle * P.rev;
    vf += (thr - vf * Math.abs(vf) * P.drag - vf * 0.05) * dt;
    vl -= vl * Math.min(1, P.lat * dt);
    // rudder (needs flow) + bow thrusters (work when slow)
    const yawT = this.steer * (vf * P.yaw + P.bow * (1 - Math.min(1, Math.abs(vf) / 4)));
    this.w += (yawT - this.w) * Math.min(1, 1.8 * dt);
    this.h += this.w * dt;
    const nfx = Math.cos(this.h), nfz = Math.sin(this.h);
    this.vx = nfx * vf - nfz * vl; this.vz = nfz * vf + nfx * vl;
    this.x += this.vx * dt; this.z += this.vz * dt;
    // shore collision: hull sample points
    const L = this.model.L / 2, B = this.model.B / 2;
    let hit = 0;
    for (const [a, b] of [[L * 0.95, 0], [L * 0.6, B], [L * 0.6, -B], [-L * 0.9, B], [-L * 0.9, -B], [0, B], [0, -B]]) {
      const px = this.x + nfx * a - nfz * b, pz = this.z + nfz * a + nfx * b;
      if (isLand(px, pz)) {
        // push back toward water: probe 8 directions for the nearest water
        let bx = 0, bz = 0;
        for (let i = 0; i < 8; i++) { const an = (i / 8) * Math.PI * 2; if (!isLand(px + Math.cos(an) * 2.5, pz + Math.sin(an) * 2.5)) { bx += Math.cos(an); bz += Math.sin(an); } }
        const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l;
        this.x += bx * 0.35; this.z += bz * 0.35;
        const vn = this.vx * bx + this.vz * bz;
        if (vn < 0) { this.vx -= vn * bx * 1.4; this.vz -= vn * bz * 1.4; hit = Math.max(hit, -vn); }
        this.w *= 0.8;
      }
    }
    if (hit > 2.5 && this.hitCooldown <= 0) { this.health -= hit * 2.2; this.onCrash?.(hit); this.hitCooldown = 0.6; }
    this.hitCooldown -= dt;
    this.sync(dt);
    this.wake.update(dt, this.x - nfx * L * 0.95, this.z - nfz * L * 0.95, this.h, vf);
  }
  sync(dt) {
    const sea = this.sea, fx = Math.cos(this.h), fz = Math.sin(this.h), L = this.model.L * 0.4, B = this.model.B * 0.4;
    const hb = sea ? sea.heightAt(this.x + fx * L, this.z + fz * L) : 0, hs = sea ? sea.heightAt(this.x - fx * L, this.z - fz * L) : 0;
    const hl = sea ? sea.heightAt(this.x - fz * B, this.z + fx * B) : 0, hr = sea ? sea.heightAt(this.x + fz * B, this.z - fx * B) : 0;
    const vf = this.speed;
    const ty = (hb + hs + hl + hr) / 4 - this.P.draft + 0.2 + Math.min(0.25, Math.abs(vf) * 0.012);
    this.y += (ty - this.y) * Math.min(1, 4 * dt);
    const tp = Math.atan2(hb - hs, L * 2) + Math.min(0.06, Math.max(0, vf) * this.P.rise * 0.3);
    const tr = Math.atan2(hl - hr, B * 2) - this.w * vf * 0.01;
    this.pitch += (tp - this.pitch) * Math.min(1, 3 * dt); this.roll += (tr - this.roll) * Math.min(1, 3 * dt);
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.order = 'YXZ'; this.root.rotation.set(-this.roll, -this.h, this.pitch);
  }
}
