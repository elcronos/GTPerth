// Real-sky day cycle for Perth, 27 November (AWST, UTC+8): the sun follows the true solar path for
// -31.96°, 115.86° (noon elevation ≈79° almost due north, sunset ≈19:05 at bearing ≈245° over Kings Park),
// then civil / nautical twilight and a moonlit night with stars and the city lit up.
//
// The clock runs 12:00 → 24:00 (then wraps to 12:00). Default speed: 12 game hours in 24 real minutes.
//   ?time=18.5  start at 18:30      ?timescale=120  game seconds per real second (default 30)
// Drives: G.sun (dir / colour / intensity → light, atmos, fog in-scatter), sky dome uniforms, the sky-matched
// environment map (re-baked every few seconds), post exposure / grade, shadow refits, night emissives
// (G.nightMats registry), window lights (shared uNight uniform), stars + moon.
import { Vector3, Color, BufferGeometry, Float32BufferAttribute, Points, PointsMaterial, Sprite, SpriteMaterial, CanvasTexture, SRGBColorSpace, AdditiveBlending } from 'three';
import { sharedUniform } from '../../cookbook/engine/patch.js';
import { syncAtmos } from '../../cookbook/lighting/atmos.js';
import { patchUniforms } from '../../cookbook/engine/patch.js';

const LAT = -31.9592, LON = 115.8559, R = Math.PI / 180;
export function solar(hoursAWST) {
  const ms = Date.UTC(2026, 10, 27, 0, 0) + (hoursAWST - 8) * 3600000;
  const d = ms / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * R, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * R, e = (23.439 - 0.00000036 * d) * R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = (gmst * 15 + LON) * R - ra, la = LAT * R;
  let el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / R;
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  if (el > -1 && el < 10) el += 0.57 * Math.max(0, 1 - Math.max(0, el) / 10);   // atmospheric refraction near the horizon
  return { el, az };   // degrees; az radians from north, clockwise
}

// keyframes by solar elevation (deg). Linear colours.
const K = [
  { el: -18, zen: [0.0016, 0.0024, 0.0062], hor: [0.010, 0.010, 0.016], sun: [0.55, 0.65, 1.0], si: 0.0, fogSc: [0.10, 0.11, 0.16], sat: 1.05, key: 0.07, amax: 7, env: 0.55, glow: 0.2 },
  { el: -8, zen: [0.004, 0.008, 0.024], hor: [0.05, 0.035, 0.05], sun: [0.6, 0.6, 0.9], si: 0.0, fogSc: [0.25, 0.22, 0.28], sat: 1.12, key: 0.09, amax: 6, env: 0.65, glow: 0.4 },
  { el: -3, zen: [0.012, 0.025, 0.075], hor: [0.42, 0.20, 0.13], sun: [1.0, 0.42, 0.22], si: 0.0, fogSc: [0.75, 0.42, 0.33], sat: 1.25, key: 0.12, amax: 4, env: 0.8, glow: 0.9 },
  { el: 0.5, zen: [0.03, 0.065, 0.19], hor: [1.0, 0.46, 0.22], sun: [1.0, 0.48, 0.24], si: 6.0, fogSc: [0.98, 0.58, 0.38], sat: 1.30, key: 0.17, amax: 2.6, env: 0.9, glow: 1.5 },
  { el: 8, zen: [0.045, 0.11, 0.30], hor: [1.02, 0.6, 0.34], sun: [1.0, 0.6, 0.33], si: 10.5, fogSc: [0.98, 0.66, 0.44], sat: 1.30, key: 0.2, amax: 1.9, env: 0.95, glow: 1.35 },
  { el: 20, zen: [0.05, 0.14, 0.40], hor: [0.75, 0.68, 0.58], sun: [1.0, 0.8, 0.6], si: 11.5, fogSc: [0.82, 0.78, 0.74], sat: 1.2, key: 0.2, amax: 1.7, env: 0.95, glow: 1.0 },
  { el: 45, zen: [0.045, 0.15, 0.48], hor: [0.55, 0.66, 0.78], sun: [1.0, 0.92, 0.82], si: 12.5, fogSc: [0.70, 0.76, 0.86], sat: 1.12, key: 0.2, amax: 1.6, env: 1.0, glow: 0.8 },
  { el: 90, zen: [0.04, 0.15, 0.50], hor: [0.50, 0.64, 0.80], sun: [1.0, 0.96, 0.9], si: 13.0, fogSc: [0.66, 0.74, 0.86], sat: 1.10, key: 0.2, amax: 1.6, env: 1.0, glow: 0.7 },
];
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t, out) => { out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); out[2] = lerp(a[2], b[2], t); return out; };
function sample(el) {
  let i = 0; while (i < K.length - 2 && el > K[i + 1].el) i++;
  const a = K[i], b = K[i + 1], t = Math.min(1, Math.max(0, (el - a.el) / (b.el - a.el)));
  const o = {};
  for (const k of Object.keys(a)) o[k] = Array.isArray(a[k]) ? lerp3(a[k], b[k], t, []) : lerp(a[k], b[k], t);
  return o;
}

function starField() {
  const n = 2400, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    const y = Math.abs(u) * 0.98 + 0.02;
    p[i * 3] = Math.cos(a) * r; p[i * 3 + 1] = y; p[i * 3 + 2] = Math.sin(a) * r;
    const b = Math.pow(rnd(), 3) * 0.9 + 0.1, w = rnd();
    c[i * 3] = b * (0.85 + 0.15 * w); c[i * 3 + 1] = b * 0.9; c[i * 3 + 2] = b * (1.0 - 0.1 * w);
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(p, 3)); g.setAttribute('color', new Float32BufferAttribute(c, 3));
  const m = new PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: AdditiveBlending });
  m.userData.noAtmos = true; m.userData.noWeather = true;
  const pts = new Points(g, m); pts.frustumCulled = false; pts.renderOrder = 1e6 + 1; pts.scale.setScalar(6000);
  return pts;
}
function moonSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64); gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.32, 'rgba(240,238,225,1)'); gr.addColorStop(0.36, 'rgba(180,190,220,0.25)'); gr.addColorStop(1, 'rgba(120,140,200,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(160,160,150,0.35)'; for (const [x, y, r] of [[54, 52, 7], [72, 70, 9], [60, 76, 5], [76, 50, 4]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  const m = new SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false, opacity: 0, blending: AdditiveBlending }); m.userData.noAtmos = true; m.userData.noWeather = true;
  const s = new Sprite(m); s.scale.setScalar(300); s.renderOrder = 1e6 + 2; s.frustumCulled = false; return s;
}

export function createDayCycle(G, { sky, env, shadows }) {
  const q = G.params;
  const clock = G.clock = { hours: q.has('time') ? +q.get('time') : 12.0, scale: q.has('timescale') ? +q.get('timescale') : 30, frozen: q.has('shot') && !q.has('timescale') };
  const uNight = sharedUniform('uNight', 'float', 0);
  G.nightMats = G.nightMats || [];
  const stars = starField(), moon = moonSprite();
  G.scene.add(stars, moon);
  const moonDir = new Vector3(0.55, 0.62, -0.56).normalize();   // a waxing moon high in the north-east sky
  const U = sky.material.uniforms, P = () => G.post && G.post.params;
  const base = P() ? { sat: P().sat, vol: P().volStrength, bloom: P().bloomStrength } : null;
  const cover0 = U.uCloud.value[0];
  let lastBake = -1e9, lastFitDir = new Vector3(), lastBakeDir = new Vector3(), cur = null;
  const tmp = new Vector3();

  function apply(force) {
    const h = clock.hours;
    const s = solar(h);
    const el = s.el, k = sample(el); cur = { el, az: s.az, k };
    // sun direction (towards the sun): x east, z south
    const ce = Math.cos(Math.max(el, 1.5) * R);
    const sunV = tmp.set(Math.sin(s.az) * ce, Math.sin(Math.max(el, 1.5) * R), -Math.cos(s.az) * ce).normalize();
    const night = Math.min(1, Math.max(0, (-el - 1) / 7));          // 0 above -1°, 1 below -8°
    if (night < 1 && el > -1) { G.sun.dir.copy(sunV); G.sun.color.setRGB(...k.sun); G.sun.intensity = k.si; }
    else {
      // twilight → moonlight: the moon takes over the key light (cool, dim)
      const m = night;
      G.sun.dir.copy(sunV).lerp(moonDir, m).normalize();
      G.sun.color.setRGB(lerp(k.sun[0], 0.55, m), lerp(k.sun[1], 0.65, m), lerp(k.sun[2], 1.0, m));
      G.sun.intensity = lerp(k.si, 0.45, m);
    }
    syncAtmos(G);
    U.uZenith.value.fromArray(k.zen); U.uHorizon.value.fromArray(k.hor); U.uSunTint.value.fromArray(k.sun);
    U.uCloud.value[0] = cover0 * (1 - 0.8 * night);   // moonlit clouds: thin them out instead of drawing them sunlit
    U.uGlow.value.x = k.glow; U.uGlow.value.y = el > -1 ? 60 : 0;
    if (patchUniforms.uFogScatter) patchUniforms.uFogScatter.value.fromArray(k.fogSc);
    if (G.scene.environmentIntensity != null) G.scene.environmentIntensity = k.env;
    const p = P();
    if (p) { p.adaptKey = k.key; p.adaptMax = k.amax; p.sat = k.sat; if (base) { p.volStrength = base.vol * (1 - night); p.bloomStrength = base.bloom * (1 + 1.5 * night); } }
    uNight.value = Math.min(1, Math.max(0, (4 - el) / 10));          // lights come on through sunset
    for (const n of G.nightMats) {
      const t = n.curve ? n.curve(uNight.value) : uNight.value;
      n.mat.emissiveIntensity = lerp(n.day ?? 0, n.night, t);
      if (n.color && n.mat.emissive) n.mat.emissive.setRGB(...n.color);
    }
    stars.material.opacity = night * 0.95; moon.material.opacity = Math.min(1, night * 1.3);
    // re-bake the environment and refit shadows when the sky has moved enough
    if (force || (G.t - lastBake > 4 && G.sun.dir.angleTo(lastBakeDir) > 0.004)) { env.bake(); lastBake = G.t; lastBakeDir.copy(G.sun.dir); }
    if (force || G.sun.dir.angleTo(lastFitDir) > 0.01) { lastFitDir.copy(G.sun.dir); shadows?.fit?.(true); }
  }
  apply(true);
  G.on('update', (dt) => {
    if (!clock.frozen && !G.paused) { clock.hours += (dt * clock.scale) / 3600; if (clock.hours >= 24) clock.hours = 12; }
    stars.position.copy(G.camera.position); moon.position.copy(G.camera.position).addScaledVector(moonDir, 5500);
    apply(false);
  });
  clock.set = (h) => { clock.hours = h; apply(true); };
  clock.label = () => { const h = Math.floor(clock.hours) % 24, m = Math.floor((clock.hours % 1) * 60); const ap = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12; return `${h12}:${String(m).padStart(2, '0')} ${ap}`; };
  clock.state = () => cur;
  return clock;
}
