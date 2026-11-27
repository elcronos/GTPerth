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

// MV Tricia: bow +x. Twin demi-hulls, bridge deck, glazed passenger cabin, wheelhouse on the roof forward,
// open rear deck, Transperth green/yellow waterline stripes.
export function buildFerry(M) {
  const k = new Kit();
  const L = 23.7, B = 7.6;
  for (const s of [-1, 1]) {
    // demi-hull: rounded vee, fine entry at the bow (+x), transom at the stern
    const hp = [[-11.6, -0.95], [8.6, -0.95], [11.85, 0.15], [11.6, 0.95], [-11.7, 0.95], [-11.85, 0.2]];
    const hull = extrudeBevel(hp, { depth: 1.9, bevel: 0.25, bevelSeg: 3 });
    k.add(hull, 'hull', { at: [0, -0.05, s * (B / 2 - 0.95)] });
    k.box(L * 0.97, 0.22, 0.06, 'green', { at: [-0.3, 0.12, s * (B / 2 + 0.01)], r: 0.01 });
    k.box(L * 0.95, 0.1, 0.06, 'yellow', { at: [-0.4, 0.34, s * (B / 2 + 0.012)], r: 0.01 });
  }
  // bridge deck (wet deck) between the hulls
  k.add(extrudeBevel([[-11.7, 0.55], [10.6, 0.55], [11.4, 1.0], [11.2, 1.2], [-11.8, 1.2]], { depth: B, bevel: 0.12, bevelSeg: 2 }), 'hull');
  k.box(L * 0.9, 0.05, B - 0.4, 'deck', { at: [-0.6, 1.23, 0], r: 0.02 });
  // passenger cabin: raked front, rounded roof edge; continuous tinted glass band wrapping the sides
  const cab = [[-7.2, 1.2], [6.6, 1.2], [8.7, 1.9], [7.4, 3.45], [-7.0, 3.55], [-7.4, 3.2]];
  k.add(extrudeBevel(cab, { depth: B - 0.5, bevel: 0.22, bevelSeg: 3 }), 'hull');
  const band = [[-6.9, 2.05], [7.9, 2.05], [7.55, 3.05], [-6.9, 3.12]];
  k.add(extrudeBevel(band, { depth: B - 0.4, bevel: 0.06 }), 'glass');
  k.add(extrudeBevel([[-7.6, 3.42], [7.6, 3.36], [7.8, 3.62], [-7.5, 3.72]], { depth: B - 0.15, bevel: 0.12, bevelSeg: 2 }), 'hull');   // roof overhang
  for (let i = -3; i <= 3; i++) for (const s of [-1, 1]) k.box(0.1, 1.0, 0.04, 'hull', { at: [i * 2.1, 2.58, s * (B / 2 - 0.19)], r: 0.02 });
  // wheelhouse on the roof, forward, with wrap glass
  k.add(extrudeBevel([[2.0, 3.6], [5.6, 3.6], [6.5, 4.3], [5.9, 5.1], [2.2, 5.15]], { depth: 3.6, bevel: 0.12, bevelSeg: 2 }), 'hull');
  k.add(extrudeBevel([[2.4, 4.35], [6.1, 4.35], [5.75, 4.95], [2.4, 4.98]], { depth: 3.7, bevel: 0.04 }), 'glass');
  k.cyl(0.06, 2.2, 'steel', { at: [3.2, 6.2, 0] }); k.box(0.9, 0.06, 0.06, 'steel', { at: [3.2, 6.9, 0], r: 0.01 });
  k.box(0.18, 0.18, 0.18, 'dark', { at: [3.2, 7.35, 0], r: 0.05 });
  // roof rails, rear open deck with bench seats and rails
  for (const s of [-1, 1]) k.add(tube([[-7.3, 4.6, s * (B / 2 - 0.25)], [1.8, 4.6, s * (B / 2 - 0.25)]], 0.035), 'steel', { occ: false });
  for (let i = 0; i < 3; i++) k.box(0.5, 0.45, B - 1.8, 'seat', { at: [-8.4 + i * 1.0, 1.5, 0], r: 0.06 });
  k.add(tube([[-11.4, 2.25, -B / 2 + 0.2], [-11.4, 2.25, B / 2 - 0.2]], 0.04), 'steel', { occ: false });
  for (const s of [-1, 1]) k.add(tube([[-11.4, 2.25, s * (B / 2 - 0.2)], [-7.2, 2.25, s * (B / 2 - 0.2)]], 0.04), 'steel', { occ: false });
  for (let x = -11; x < -7; x += 1.2) for (const s of [-1, 1]) k.bar([x, 1.25, s * (B / 2 - 0.2)], [x, 2.25, s * (B / 2 - 0.2)], 0.04, 0.04, 'steel');
  // fenders + bow fender
  for (let i = -5; i <= 4; i++) for (const s of [-1, 1]) k.box(0.7, 0.32, 0.2, 'dark', { at: [i * 2, 1.0, s * (B / 2 + 0.08)], r: 0.08 });
  k.bakeAO({ radius: 0.5, samples: 6, strength: 0.5 });
  const g = k.build(M);
  const tTex = nameTex('TRANSPERTH', 'TRICIA'), tMat = new MeshStandardMaterial({ map: tTex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const s of [-1, 1]) { const p = new Mesh(new PlaneGeometry(9, 1.1), tMat); p.position.set(0.2, 1.62, s * (B / 2 - 0.24)); p.rotation.y = s > 0 ? 0 : Math.PI; g.add(p); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, L, B, helm: new Vector3(4.2, 4.6, 0), deckY: 1.25 };
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
