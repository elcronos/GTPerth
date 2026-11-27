// Practical lights that actually light things (fixes the common "lamps glow but light nothing" defect).
// One call builds: a real PointLight/SpotLight (while the tier's light budget lasts) + an emissive fixture
// mesh + a fogged halo in the haze + a "light pool" decal on the ground that fakes the lamp's irradiance
// (used automatically once the real-light budget is exhausted, so 40 street lamps still light the street).
//
//   import { createLights } from './lighting/lights.js';
//   const lights = createLights(G);                       // after installAtmos(G)
//   lights.add({ position: [4, 3.2, 0], kind: 'pole', color: [1, .78, .52], intensity: 60, groundY: 0 });
//   lights.add({ position: [0, 2.6, -8], kind: 'pendant', type: 'spot', target: [0, 0, -8] });
//   lights.update(dt, t)  // only needed for flicker (G.on('update') is wired automatically)
//
// Units: intensity in candela (three physical units, decay 2). Ground irradiance under a lamp at height h is
// I/h², so with the sun at irradiance ~8, I = 60 at 3.4 m gives ~5: visible in shade, dominant at dusk/indoors.
// IMPORTANT: the number of real lights is fixed at creation (changing it recompiles every material).
import {
  PointLight, SpotLight, Mesh, Group, PlaneGeometry, CylinderGeometry, SphereGeometry, BoxGeometry, ConeGeometry,
  MeshStandardMaterial, ShaderMaterial, AdditiveBlending, Color, Vector3,
} from 'three';
import { patchAtmos, atmosUniforms, ATMOS_DECL, ATMOS_GLSL } from './atmos.js';

const BUDGET = { low: 2, med: 4, high: 8, ultra: 12 };
// emissive radiance of the glass: bright enough to bloom, low enough that the tonemapper keeps its hue
// (a 60 cd lamp → ~5.6; much more clips to white after eye adaptation)
const emisFor = (I) => Math.min(2 + I * 0.06, 10);

const POOL_VS = /*glsl*/`
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
// irradiance of a point light at uLight onto a horizontal receiver: E = I * cos / d^2 = I * h / d^3,
// reflected by an assumed ground albedo (Lambert: L = albedo/pi * E). Spot: smooth cone falloff.
const POOL_FS = /*glsl*/`
uniform vec3 uLight;
uniform vec3 uColor;
uniform vec3 uSpotDir;
uniform vec2 uCone;
uniform float uRadius;
uniform float uAlbedo;
varying vec3 vW;
${ATMOS_DECL}
${ATMOS_GLSL}
void main() {
  vec3 L = uLight - vW;
  float h = max(L.y, 0.05);
  float d2 = dot(L, L);
  float E = h / (d2 * sqrt(d2));
  float r = length(vW.xz - uLight.xz);
  E *= 1.0 - smoothstep(uRadius * 0.55, uRadius, r);
  float cosA = dot(normalize(-L), uSpotDir);
  E *= uCone.x < -0.5 ? 1.0 : smoothstep(uCone.x, uCone.y, cosA);
  vec3 col = uColor * E * uAlbedo * 0.318;
  col *= atmosTransmittance(vW, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
}`;
// glow of the lamp in the haze: camera-facing quad, falloff ~ 1/(1+(r/k)^2), stronger the denser the fog
const HALO_VS = /*glsl*/`
uniform float uSize;
varying vec2 vUv;
varying vec3 vC;
void main() {
  vUv = uv * 2.0 - 1.0;
  vC = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec4 mv = viewMatrix * vec4(vC, 1.0);
  mv.xy += position.xy * uSize;
  // pull toward the camera so the quad is not cut by the fixture it surrounds
  mv.xyz += normalize(-mv.xyz) * 0.5 * uSize;
  gl_Position = projectionMatrix * mv;
}`;
const HALO_FS = /*glsl*/`
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
varying vec3 vC;
${ATMOS_DECL}
${ATMOS_GLSL}
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float g = (1.0 / (1.0 + r2 * 60.0) - 0.0164) * (1.0 - r2);
  vec3 col = uColor * g * uStrength;
  col *= atmosTransmittance(vC, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
}`;


export function createLights(G, { budget } = {}) {
  const maxReal = budget ?? BUDGET[G.quality.tier] ?? 8;
  const items = [];
  const root = new Group(); root.name = 'practicals';
  G.scene.add(root);
  // shared fixture materials
  const metal = patchAtmos(new MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.85, roughness: 0.42 }));
  const geo = {
    pole: new CylinderGeometry(0.06, 0.08, 1, 10), arm: new BoxGeometry(0.05, 0.05, 1),
    cage: new CylinderGeometry(0.16, 0.12, 0.34, 8, 1, true), cap: new ConeGeometry(0.24, 0.16, 8),
    bulb: new SphereGeometry(0.07, 12, 8), cord: new CylinderGeometry(0.008, 0.008, 1, 4),
    shade: new ConeGeometry(0.26, 0.22, 16, 1, true), quad: new PlaneGeometry(2, 2), pool: new PlaneGeometry(1, 1),
  };
  const uAtm = atmosUniforms();

  function add(o = {}) {
    const p = new Vector3().fromArray(o.position || [0, 3, 0]);
    const color = new Color().fromArray(o.color || [1.0, 0.62, 0.32]); // warm tungsten/sodium-ish (linear)
    const intensity = o.intensity ?? 60;
    const type = o.type || (o.kind === 'pendant' ? 'spot' : 'point');
    const range = o.range ?? Math.sqrt(intensity / 0.02); // where E drops to ~0.02
    const groundY = o.groundY ?? 0;
    const g = new Group(); g.position.copy(p); root.add(g);
    const it = { group: g, color, intensity, base: intensity, flicker: o.flicker ?? 0, phase: Math.random() * 100, light: null };

    // --- real light while the budget lasts ---
    const wantReal = o.real ?? true;
    if (wantReal && items.filter((i) => i.light).length < maxReal) {
      const L = type === 'spot' ? new SpotLight(color, intensity, range, o.angle ?? 0.9, o.penumbra ?? 0.6, 2) : new PointLight(color, intensity, range, 2);
      if (type === 'spot') {
        L.target.position.fromArray(o.target || [p.x, groundY, p.z]); root.add(L.target);
      }
      L.position.copy(p);
      L.castShadow = !!o.castShadow;
      if (L.castShadow) { L.shadow.mapSize.set(512, 512); L.shadow.radius = -2; L.shadow.bias = -0.0005; L.shadow.normalBias = 0.02; }
      root.add(L); it.light = L;
    }

    // --- emissive fixture ---
    const emis = patchAtmos(new MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: o.emissive ?? emisFor(intensity), roughness: 0.3 }));
    it.emisMat = emis; it.emisBase = emis.emissiveIntensity;
    const bulb = new Mesh(geo.bulb, emis); g.add(bulb);
    const kind = o.kind || 'pole';
    if (kind === 'pole') {
      const hgt = p.y - groundY;
      const pole = new Mesh(geo.pole, metal); pole.scale.y = hgt + 0.3; pole.position.set(0, -(hgt + 0.3) / 2 + 0.3, -0.45); g.add(pole);
      const arm = new Mesh(geo.arm, metal); arm.scale.z = 0.5; arm.position.set(0, 0.3, -0.22); g.add(arm);
      const cage = new Mesh(geo.cage, metal); cage.position.y = 0.04; g.add(cage);
      const cap = new Mesh(geo.cap, metal); cap.position.y = 0.28; g.add(cap);
      const glass = new Mesh(geo.cage, emis); glass.scale.set(0.8, 0.85, 0.8); glass.position.y = 0.04; g.add(glass);
      for (const m of [pole, arm, cap]) m.castShadow = true;
    } else if (kind === 'wall') {
      const arm = new Mesh(geo.arm, metal); arm.scale.z = 0.35; arm.position.set(0, 0.22, -0.17); g.add(arm);
      const cage = new Mesh(geo.cage, metal); cage.scale.setScalar(0.75); g.add(cage);
      const cap = new Mesh(geo.cap, metal); cap.scale.setScalar(0.75); cap.position.y = 0.2; g.add(cap);
      const glass = new Mesh(geo.cage, emis); glass.scale.set(0.6, 0.64, 0.6); g.add(glass);
    } else if (kind === 'pendant') {
      const len = o.cord ?? 0.8;
      const cord = new Mesh(geo.cord, metal); cord.scale.y = len; cord.position.y = len / 2 + 0.1; g.add(cord);
      const shade = new Mesh(geo.shade, metal); shade.material = metal; shade.position.y = 0.08; g.add(shade);
      shade.castShadow = true;
    }
    if (o.rotationY) g.rotation.y = o.rotationY;
    g.traverse((m) => { if (m.isMesh && m.material === emis) m.castShadow = false; });

    // --- halo in the haze ---
    if (o.halo !== false) {
      const hm = new ShaderMaterial({
        uniforms: { ...uAtm, uColor: { value: color.clone() }, uStrength: { value: (o.haloStrength ?? 1.0) * Math.min(intensity, 80) * 0.05 }, uSize: { value: o.haloSize ?? 0.9 } },
        vertexShader: HALO_VS, fragmentShader: HALO_FS, blending: AdditiveBlending, transparent: true, depthWrite: false,
      });
      const halo = new Mesh(geo.quad, hm); halo.frustumCulled = false; halo.renderOrder = 10; g.add(halo); it.halo = hm;
    }

    // --- ground light pool (fake irradiance) when there is no real light, or forced with pool:'always' ---
    if ((!it.light && o.pool !== false) || o.pool === 'always') {
      const radius = o.poolRadius ?? Math.min(range * 0.6, (p.y - groundY) * 3.2);
      const sd = new Vector3(0, -1, 0);
      if (type === 'spot' && o.target) sd.fromArray(o.target).sub(p).normalize();
      const cone = type === 'spot' ? [Math.cos(o.angle ?? 0.9), Math.cos((o.angle ?? 0.9) * (1 - (o.penumbra ?? 0.6)))] : [-1, 0];
      const pm = new ShaderMaterial({
        uniforms: {
          ...uAtm, uLight: { value: p.clone() }, uColor: { value: new Vector3(color.r, color.g, color.b).multiplyScalar(intensity) },
          uSpotDir: { value: sd }, uCone: { value: cone }, uRadius: { value: radius }, uAlbedo: { value: o.albedo ?? 0.35 },
        },
        vertexShader: POOL_VS, fragmentShader: POOL_FS, blending: AdditiveBlending, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const pool = new Mesh(geo.pool, pm);
      pool.rotation.x = -Math.PI / 2; pool.scale.set(radius * 2, radius * 2, 1);
      pool.position.set(p.x, groundY + 0.004, p.z);
      root.add(pool); it.pool = pm;
    }
    items.push(it);
    return it;
  }

  function update(dt, t) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.flicker) continue;
      const f = 1 - it.flicker * (0.5 + 0.5 * Math.sin(t * 13.0 + it.phase) * Math.sin(t * 7.3 + it.phase * 2.1));
      if (it.light) it.light.intensity = it.base * f;
      it.emisMat.emissiveIntensity = (it.emisBase) * f;
      if (it.pool) it.pool.uniforms.uColor.value.set(it.color.r, it.color.g, it.color.b).multiplyScalar(it.base * f);
    }
  }
  G.on('update', update);
  return {
    root, items, add, update,
    get realCount() { return items.filter((i) => i.light).length; },
    dispose() { root.removeFromParent(); for (const k in geo) geo[k].dispose(); metal.dispose(); for (const i of items) { i.emisMat.dispose(); i.halo?.dispose(); i.pool?.dispose(); } },
  };
}

export { BUDGET as LIGHT_BUDGET };
