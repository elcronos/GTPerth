// Cars: procedural bodies (sedan, hatch, SUV, ute, WA Police sedan, Transperth CAT bus) built from bevelled
// extrusions with a separate greenhouse, real wheels, lights and WA plates; arcade physics (bicycle model with
// grip / handbrake drift, weight transfer pitch & roll on the terrain), collisions vs buildings, cars and people.
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Color, Vector3, CanvasTexture, SRGBColorSpace, MeshBasicMaterial, PlaneGeometry, DoubleSide } from 'three';
import { Kit, extrudeBevel, lathe, roundedBox } from '../../cookbook/geo/kit.js';
import { heightAt, isLand } from '../../map.js';
import { modelInstance, LIB } from './models.js';

const TRIPO = { sedan: 'camry', hatch: 'hatch', suv: 'suv', ute: 'ute', police: 'police', bus: 'bus' };

// ------------------------------------------------------------------ models
const KINDS = {
  sedan: { L: 4.85, W: 1.84, H: 1.45, wb: 2.82, prof: [[-2.42, 0.36], [2.42, 0.36], [2.47, 0.62], [2.38, 0.86], [1.25, 0.98], [-1.95, 1.04], [-2.44, 0.92]], gh: [[1.18, 0.97], [0.42, 1.40], [-0.95, 1.44], [-1.88, 1.03]], mass: 1500, power: 9.5, top: 52 },
  hatch: { L: 4.25, W: 1.78, H: 1.48, wb: 2.6, prof: [[-2.1, 0.36], [2.12, 0.36], [2.16, 0.62], [2.06, 0.84], [1.0, 0.96], [-1.95, 1.05], [-2.12, 0.86]], gh: [[0.96, 0.95], [0.25, 1.42], [-1.6, 1.46], [-2.02, 1.02]], mass: 1250, power: 8.5, top: 46 },
  suv: { L: 4.75, W: 1.92, H: 1.75, wb: 2.85, prof: [[-2.37, 0.48], [2.37, 0.48], [2.42, 0.8], [2.3, 1.08], [1.3, 1.16], [-2.3, 1.2], [-2.4, 1.0]], gh: [[1.24, 1.15], [0.55, 1.68], [-2.05, 1.72], [-2.3, 1.18]], mass: 2000, power: 9.0, top: 48 },
  ute: { L: 5.3, W: 1.9, H: 1.8, wb: 3.1, prof: [[-2.65, 0.5], [2.65, 0.5], [2.7, 0.82], [2.55, 1.1], [1.5, 1.16], [-2.65, 1.16]], gh: [[1.45, 1.15], [0.8, 1.72], [-0.55, 1.75], [-0.62, 1.15]], tray: true, mass: 2100, power: 9.0, top: 47 },
  police: { L: 4.95, W: 1.86, H: 1.48, wb: 2.85, prof: [[-2.47, 0.36], [2.47, 0.36], [2.52, 0.62], [2.42, 0.86], [1.28, 0.98], [-1.98, 1.05], [-2.48, 0.92]], gh: [[1.2, 0.97], [0.44, 1.41], [-0.97, 1.45], [-1.92, 1.03]], mass: 1650, power: 12, top: 60, police: true },
  bus: { L: 12.2, W: 2.5, H: 3.2, wb: 6.1, prof: [[-6.1, 0.35], [6.1, 0.35], [6.15, 3.0], [-6.1, 3.1]], gh: null, bus: true, mass: 12000, power: 5, top: 26 },
};
export const CAR_COLORS = [0xe8e8e6, 0x111215, 0x8a8f96, 0x1d2e4f, 0x6e1010, 0xc9c3b6, 0x2f3a33, 0x101a2a, 0xf0f0f0, 0x55595e, 0x3a6ea5, 0xa83a1a];

let plateTex = null;
function plateTexture() { // WA plate: white, black characters, "WA — THE STATE TO FLY" strip
  if (plateTex) return plateTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(4, 4, 248, 120);
  g.fillStyle = '#121212'; g.font = 'bold 64px Arial Narrow, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('1HXR 607', 128, 82);
  g.font = 'bold 18px Arial, sans-serif'; g.fillStyle = '#1a3a7a'; g.fillText('WA - THE STATE TO EXPLORE', 128, 112);
  plateTex = new CanvasTexture(c); plateTex.colorSpace = SRGBColorSpace; return plateTex;
}

export function makeCarMaterials() {
  const paint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.45, vertexColors: true }); paint.name = 'carpaint';
  const glass = new MeshStandardMaterial({ color: 0x0b0f12, roughness: 0.03, metalness: 0.85, vertexColors: true }); glass.name = 'carglass';
  const trim = new MeshStandardMaterial({ color: 0x141414, roughness: 0.6, metalness: 0.1, vertexColors: true });
  const chrome = new MeshStandardMaterial({ color: 0xd0d4d8, roughness: 0.15, metalness: 1.0, vertexColors: true });
  const tyre = new MeshStandardMaterial({ color: 0x151515, roughness: 0.92, metalness: 0, vertexColors: true });
  const light = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, emissive: new Color(1, 0.95, 0.85), emissiveIntensity: 0.3, vertexColors: true });
  const tail = new MeshStandardMaterial({ color: 0x400000, roughness: 0.3, emissive: new Color(1, 0.03, 0.02), emissiveIntensity: 0.25, vertexColors: true }); tail.name = 'taillight';
  const plate = new MeshStandardMaterial({ map: plateTexture(), roughness: 0.5 });
  const blue = new MeshStandardMaterial({ color: 0x0a2a8a, emissive: new Color(0.1, 0.25, 1.0), emissiveIntensity: 0.4, roughness: 0.3, vertexColors: true }); blue.name = 'beaconBlue';
  const red = new MeshStandardMaterial({ color: 0x8a0a0a, emissive: new Color(1.0, 0.08, 0.05), emissiveIntensity: 0.4, roughness: 0.3, vertexColors: true }); red.name = 'beaconRed';
  const decal = new MeshStandardMaterial({ map: policeLivery(), roughness: 0.3, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
  const busPaint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.2, vertexColors: true });
  return { paint, glass, trim, chrome, tyre, light, tail, plate, blue, red, decal, busPaint };
}
function policeLivery() { // WA Police: blue/white Battenburg-style chequer band + POLICE
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128; const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 128);
  for (let i = 0; i < 32; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#f2f2f2' : '#123a9a'; g.fillRect(i * 32, 40 + j * 32, 32, 32); }
  g.fillStyle = '#123a9a'; g.font = 'bold 38px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('POLICE', 512, 34);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}

export function buildCarModel(kind, color, M) {
  const K = KINDS[kind]; const k = new Kit(); const col = new Color(color);
  const wr = kind === 'bus' ? 0.5 : kind === 'suv' || kind === 'ute' ? 0.38 : 0.33;
  const tm = LIB[TRIPO[kind]] && modelInstance(TRIPO[kind], color);
  if (tm) { // scanned-quality Tripo mesh (wheels baked in); keep the flashing beacons + brake glow as live parts
    const group = new Group(); group.add(tm);
    const S = LIB[TRIPO[kind]].S;
    if (K.police) for (const s of [-1, 1]) { const b = new Mesh(new BoxGeometry(0.22, 0.07, 0.42), s > 0 ? M.blue : M.red); b.position.set(-0.25, S.H + 0.01, s * 0.28); group.add(b); }
    for (const s of [-1, 1]) { const t = new Mesh(new BoxGeometry(0.02, 0.1, 0.3), M.tail); t.position.set(-S.L / 2 - 0.005, S.H * 0.58, s * (S.W / 2 - 0.25)); group.add(t); }
    return { group, wheels: [], K: { ...K, L: S.L, W: S.W }, wr };
  }
  if (K.bus) {
    k.box(K.L, 2.75, K.W, 'busPaint', { at: [0, 0.35 + 1.375, 0], r: 0.12, color: 0xe8ecef });
    k.box(K.L - 1.2, 1.15, K.W + 0.02, 'glass', { at: [-0.3, 2.05, 0], r: 0.04 });
    k.box(0.05, 1.5, K.W - 0.3, 'glass', { at: [K.L / 2 + 0.01, 1.95, 0], r: 0.02 });
    k.box(K.L, 0.35, K.W + 0.03, 'blue', { at: [0, 0.75, 0], r: 0.02 });                    // Blue CAT stripe
  } else {
    // lower body: side profile extruded across the width, tumblehome on the shoulders
    const body = extrudeBevel(K.prof, { depth: K.W, bevel: 0.05, bevelSeg: 2 });
    const P = body.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) { const y = P[i + 1]; const s = 1 - Math.max(0, y - 0.7) * 0.18; P[i + 2] *= s; }
    body.computeVertexNormals();
    k.add(body, 'paint', { color: col });
    // greenhouse (glass) + roof skin + pillars
    const gh = extrudeBevel(K.gh, { depth: K.W * 0.86, bevel: 0.03 });
    k.add(gh, 'glass');
    const roofPts = [[K.gh[1][0] - 0.06, K.gh[1][1] - 0.02], [K.gh[2][0] + 0.05, K.gh[2][1] - 0.02], [K.gh[2][0] + 0.05, K.gh[2][1] + 0.025], [K.gh[1][0] - 0.06, K.gh[1][1] + 0.025]];
    k.add(extrudeBevel(roofPts, { depth: K.W * 0.84, bevel: 0.02 }), 'paint', { color: col });
    const midX = (K.gh[0][0] + K.gh[3][0]) / 2;
    for (const s of [-1, 1]) k.box(0.1, (K.gh[1][1] - K.gh[0][1]), 0.05, 'paint', { at: [midX, (K.gh[0][1] + K.gh[1][1]) / 2 + 0.02, s * K.W * 0.43], r: 0.02, color: col });
    if (K.tray) k.box(2.1, 0.5, K.W - 0.1, 'trim', { at: [-1.55, 1.25, 0], r: 0.03 });
    // lights
    for (const s of [-1, 1]) {
      k.box(0.08, 0.12, 0.42, 'light', { at: [K.L / 2 + 0.01, 0.74, s * (K.W / 2 - 0.3)], r: 0.03 });
      k.box(0.08, 0.14, 0.38, 'tail', { at: [-K.L / 2 - 0.01, 0.82, s * (K.W / 2 - 0.28)], r: 0.03 });
      k.box(0.18, 0.08, 0.12, 'trim', { at: [K.gh[0][0] - 0.05, K.gh[0][1] + 0.08, s * (K.W / 2 + 0.06)], r: 0.02 });   // mirrors
    }
    k.box(0.05, 0.22, K.W - 0.5, 'trim', { at: [K.L / 2 + 0.03, 0.55, 0], r: 0.02 });   // grille
    k.box(0.06, 0.16, K.W - 0.1, 'trim', { at: [K.L / 2 + 0.02, 0.38, 0], r: 0.02 });
    k.box(0.06, 0.16, K.W - 0.1, 'trim', { at: [-K.L / 2 - 0.02, 0.4, 0], r: 0.02 });
    if (K.police) {
      k.box(0.36, 0.1, 1.3, 'trim', { at: [0, K.gh[2][1] + 0.08, 0], r: 0.03 });
      k.box(0.3, 0.12, 0.55, 'blue', { at: [0, K.gh[2][1] + 0.16, 0.34], r: 0.03 });
      k.box(0.3, 0.12, 0.55, 'red', { at: [0, K.gh[2][1] + 0.16, -0.34], r: 0.03 });
    }
  }
  // wheels: tyre + rim
  const wheels = [];
  const wx = K.wb / 2, wz = K.W / 2 - 0.12;
  const tyreG = lathe([[wr * 0.62, -0.11], [wr * 0.96, -0.12], [wr, -0.08], [wr, 0.08], [wr * 0.96, 0.12], [wr * 0.62, 0.11]], { seg: 20, crease: 50 });
  const rimG = lathe([[0.0, 0.1], [wr * 0.62, 0.1], [wr * 0.64, 0.06], [wr * 0.6, -0.06], [0.0, -0.08]], { seg: 14 });
  const group = k.build({ ...M, paint: M.paint, glass: M.glass, light: M.light, tail: M.tail, trim: M.trim, blue: M.blue, red: M.red, busPaint: M.busPaint, default: M.trim });
  for (const [x, z] of [[wx, wz], [wx, -wz], [-wx, wz], [-wx, -wz]]) {
    const w = new Group(); w.position.set(x, wr, z);
    const t = new Mesh(tyreG, M.tyre); t.rotation.x = Math.PI / 2; t.castShadow = true;
    const r = new Mesh(rimG, M.chrome); r.rotation.x = z > 0 ? -Math.PI / 2 : Math.PI / 2; r.position.z = z > 0 ? 0.0 : 0.0;
    w.add(t, r); group.add(w); wheels.push(w);
  }
  if (!K.bus) {
    for (const s of [1, -1]) { const p = new Mesh(new PlaneGeometry(0.52, 0.13), M.plate); p.position.set(s * (K.L / 2 + 0.06), 0.5, 0); p.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2; group.add(p); }
    if (K.police) for (const s of [1, -1]) { const d = new Mesh(new PlaneGeometry(K.L * 0.9, 0.28), M.decal); d.position.set(0, 0.72, s * (K.W / 2 + 0.02)); d.rotation.y = s > 0 ? 0 : Math.PI; group.add(d); }
  }
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, wheels, K, wr };
}

// ------------------------------------------------------------------ physics
const _v = new Vector3();
export class Car {
  constructor(G, kind, color, M, col) {
    this.G = G; this.kind = kind; this.col = col;
    const m = buildCarModel(kind, color, M);
    this.model = m; this.K = m.K;
    this.root = new Group(); this.root.add(m.group); G.scene.add(this.root);
    this.x = 0; this.z = 0; this.y = 0; this.h = 0;           // heading: forward = (cos h, sin h) in x/z
    this.vx = 0; this.vz = 0; this.w = 0;                     // velocity, yaw rate
    this.throttle = 0; this.brake = 0; this.steer = 0; this.hand = 0;
    this.pitch = 0; this.roll = 0; this.wheelRot = 0; this.steerVis = 0;
    this.r = Math.max(this.K.W, this.K.L * 0.5) * 0.55;
    this.health = 100; this.driver = null; this.sunk = false; this.inWater = 0;
    this.siren = false; this.sirenT = 0; this.hitCooldown = 0;
    this.radius = this.K.L / 2;
  }
  get speed() { return this.vx * Math.cos(this.h) + this.vz * Math.sin(this.h); }
  place(x, z, h) { this.x = x; this.z = z; this.h = h; this.vx = this.vz = this.w = 0; this.y = heightAt(x, z); this.sync(0); }
  update(dt) {
    const K = this.K;
    const fx = Math.cos(this.h), fz = Math.sin(this.h);
    let vf = this.vx * fx + this.vz * fz, vl = -this.vx * fz + this.vz * fx;
    const onLand = isLand(this.x, this.z);
    if (!onLand) { this.inWater += dt; }
    if (this.inWater > 0) {
      // fell off the quay: sink
      this.vx *= 1 - Math.min(1, 1.5 * dt); this.vz *= 1 - Math.min(1, 1.5 * dt); this.w *= 0.95;
      this.y = Math.max(-2.2, this.y - dt * (this.y > -0.3 ? 4 : 0.35));
      this.x += this.vx * dt; this.z += this.vz * dt; this.sunk = this.y < -1.4;
      this.sync(dt); return;
    }
    // engine / brakes
    const top = K.top / 3.6 * 2.4;            // m/s
    let acc = 0;
    if (this.throttle > 0) acc += this.throttle * K.power * (1 - Math.min(1, Math.abs(vf) / top) ** 2);
    if (this.throttle < 0) acc += vf > 0.5 ? this.throttle * 14 : this.throttle * K.power * 0.5 * (1 - Math.min(1, -vf / 9));
    if (this.brake > 0) acc -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 14 * this.brake);
    acc -= vf * 0.04 + vf * Math.abs(vf) * 0.0025;          // rolling + aero
    vf += acc * dt;
    // lateral grip (handbrake drops rear grip → drift)
    const grip = this.hand > 0 ? 2.2 : 9.5;
    vl -= vl * Math.min(1, grip * dt);
    // steering: bicycle model yaw rate, speed-sensitive lock
    const lock = 0.62 / (1 + Math.abs(vf) * 0.045);
    this.steerVis += (this.steer * lock - this.steerVis) * Math.min(1, 10 * dt);
    const yawTarget = (vf / K.wb) * Math.tan(this.steerVis) * (this.hand > 0 ? 1.35 : 1);
    this.w += (yawTarget - this.w) * Math.min(1, (this.hand > 0 ? 3 : 8) * dt);
    this.h += this.w * dt;
    const nfx = Math.cos(this.h), nfz = Math.sin(this.h);
    this.vx = nfx * vf - nfz * vl; this.vz = nfz * vf + nfx * vl;
    this.x += this.vx * dt; this.z += this.vz * dt;
    // world collisions: two circles (front/back)
    let hitSpeed = 0;
    for (const s of [1, -1]) {
      const off = (K.L / 2 - K.W * 0.45) * s;
      const cx = this.x + nfx * off, cz = this.z + nfz * off;
      const c = this.col.circleVsWorld(cx, cz, K.W * 0.52);
      if (c.hit) {
        this.x += c.x - cx; this.z += c.z - cz;
        const vn = this.vx * c.nx + this.vz * c.nz;
        if (vn < 0) { this.vx -= vn * c.nx * 1.35; this.vz -= vn * c.nz * 1.35; hitSpeed = Math.max(hitSpeed, -vn); this.w *= 0.5; }
      }
    }
    if (hitSpeed > 4 && this.hitCooldown <= 0) { this.health -= hitSpeed * 1.2; this.onCrash?.(hitSpeed); this.hitCooldown = 0.4; }
    this.hitCooldown -= dt;
    this.sync(dt);
  }
  sync(dt) {
    const K = this.K, fx = Math.cos(this.h), fz = Math.sin(this.h);
    if (this.inWater <= 0) {
      const hf = heightAt(this.x + fx * K.wb / 2, this.z + fz * K.wb / 2), hb = heightAt(this.x - fx * K.wb / 2, this.z - fz * K.wb / 2);
      const hl = heightAt(this.x - fz * K.W / 2, this.z + fx * K.W / 2), hr = heightAt(this.x + fz * K.W / 2, this.z - fx * K.W / 2);
      const gy = (hf + hb + hl + hr) / 4 + 0.05;
      this.y += (gy - this.y) * Math.min(1, 20 * dt || 1);
      const tp = Math.atan2(hf - hb, K.wb), tr = Math.atan2(hl - hr, K.W);
      // weight transfer from accel / cornering
      const vf = this.speed;
      const accP = dt > 0 ? (vf - (this.lastVf ?? vf)) / dt : 0; this.lastVf = vf;
      this.pitch += (tp - accP * 0.006 - this.pitch) * Math.min(1, 8 * dt || 1);
      this.roll += (tr + this.w * vf * 0.004 - this.roll) * Math.min(1, 8 * dt || 1);
    }
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.set(0, 0, 0);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = -this.h;
    this.root.rotation.z = this.pitch;
    this.root.rotation.x = -this.roll;
    // wheels
    this.wheelRot += (this.speed / this.model.wr) * (dt || 0);
    this.model.wheels.forEach((w, i) => { w.rotation.set(0, i < 2 ? -this.steerVis : 0, 0); w.children[0].rotation.y = -this.wheelRot; w.children[1].rotation.y = -this.wheelRot; });
  }
  dispose() { this.G.scene.remove(this.root); }
}
