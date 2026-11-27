// Procedural HDR sky: gradient + Mie aureole + sun disk + layered fbm cloud deck with self-shadowing,
// a "burning gap" (the deck thins out toward the low sun) and sunset tint. Rendered on an inside-out box
// that is always at the far plane (gl_Position = p.xyww), finished with the shared atmosApply() so the
// horizon matches the fog on geometry exactly.
//
//   import { createSky } from './lighting/sky.js';
//   const sky = createSky(G);            // after installAtmos(G); adds sky.mesh to G.scene
//   sky.update(dt, t)                    // optional (cloud drift uses the shared uTime anyway)
//   sky.material.uniforms.uEnv.value = 1 // env-bake mode (no disk, clamped) — env-from-sky.js does this
//
// ART.sky: zenith, horizon, groundTint (linear HDR radiance), cloudCover 0..1, cloudSharp 0..1,
// sunGlow (aureole strength), burnGap 0..1, fogged (default true; false = airless/space: the sky skips the
// shared fog, so black space never turns into a fog-coloured wall), fogFar (m the fog is evaluated to, 3000).
// ART.sun.color = disk/cloud-light tint.
// Lightning: reads the shared uniform uFlash (weather/lightning.js, 0..~1.5) and lights the cloud deck from inside
// with a cold flash, brightest toward the last 'lightning' event's azimuth (no-op while uFlash is 0).
import { Mesh, BoxGeometry, ShaderMaterial, BackSide, Vector3 } from 'three';
import { patchUniforms, sharedUniform } from '../engine/patch.js';
import { ATMOS_DECL, ATMOS_GLSL, atmosUniforms } from './atmos.js';

const SKY_DEFAULT = { zenith: [0.10, 0.16, 0.28], horizon: [0.85, 0.62, 0.45], groundTint: [0.20, 0.18, 0.16], cloudCover: 0.6, cloudSharp: 0.5, sunGlow: 1.0, burnGap: 0.6, fogged: true, fogFar: 3000 };

const VS = /*glsl*/`
varying vec3 vDir;
void main() {
  vDir = position;
  // rotation only: the box is centred on the camera for any camera (also PMREM / CubeCamera faces)
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  // at the far plane (tiny epsilon so it is never clipped by the far plane itself)
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}`;

export const SKY_FS = /*glsl*/`
uniform float uTime;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunTint;
uniform vec4 uCloud;
uniform vec3 uGlow;
uniform float uEnv;
uniform float uSkyFar;
uniform float uFlash;
uniform vec3 uFlashDir;
varying vec3 vDir;
${ATMOS_DECL}
${ATMOS_GLSL}
float skHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float skNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = skHash(i);
  float b = skHash(i + vec2(1.0, 0.0));
  float c = skHash(i + vec2(0.0, 1.0));
  float d = skHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// fbm with per-octave fade by pixel footprint (fw = uv change per pixel) -> no shimmer near the horizon
float skFbm(vec2 p, float fw) {
  float s = 0.0;
  float a = 0.5;
  float fr = 1.0;
  mat2 m = mat2(1.62, 1.18, -1.18, 1.62);
  for (int i = 0; i < 6; i++) {
    float fade = clamp(1.6 - fw * fr * 1.6, 0.0, 1.0);
    s += a * mix(0.5, skNoise(p), fade);
    p = m * p + vec2(17.1, 3.7);
    a *= 0.5;
    fr *= 2.0;
  }
  return s;
}
void main() {
  vec3 rd = normalize(vDir);
  vec3 sd = normalize(uSunDir);
  float mu = dot(rd, sd);
  float up = max(rd.y, 0.0);
  // 0 at noon, 1 at sunset: drives how orange the low sky gets
  float sunset = 1.0 - smoothstep(0.0, 0.45, sd.y);
  vec2 rh = normalize(rd.xz + vec2(1e-5));
  vec2 sh = normalize(sd.xz + vec2(1e-5));
  // clamp: pow() of a tiny negative (float error) is NaN, and one NaN texel poisons the whole PMREM
  float az = clamp(dot(rh, sh) * 0.5 + 0.5, 0.0, 1.0);

  float tw = atmosTwilight();
  // --- clear-sky gradient: optical-mass-like falloff from horizon to zenith ---
  float hgt = 1.0 - exp(-up * 4.2);
  // squared tint = the deeper orange of light that crossed more air (used for everything near the low sun)
  vec3 tint2 = uSunTint * uSunTint;
  vec3 horizon = uHorizon * mix(0.6, 1.2, pow(az, 2.0) * mix(0.4, 1.0, sunset));
  horizon = mix(horizon, tint2 * 1.6, sunset * pow(az, 4.0) * 0.55);
  // blend in sqrt space: avoids the grey/lavender dip a linear lerp of complementary colours gives
  vec3 col = mix(sqrt(horizon), sqrt(uZenith), hgt);
  col *= col;
  // ground half: tinted bounce below the horizon (mostly hidden by fog)
  col = mix(col, uGround, smoothstep(0.0, -0.12, rd.y));
  col *= tw;

  // --- Mie aureole around the sun (art-directed sum of lobes) ---
  float m = max(mu, 0.0);
  vec3 aure = mix(uSunTint, tint2, 0.6) * (0.14 * pow(m, 4.0) + 0.45 * pow(m, 32.0) + 2.0 * pow(m, 400.0)) * uGlow.x;
  col += aure * (0.6 + 0.8 * sunset);

  // --- cloud deck: plane at fixed altitude, uv = rd.xz / rd.y ---
  float cover = uCloud.x;
  float cloudA = 0.0;
  // lightning: lobe toward the strike azimuth (wide: the flash lights the whole deck, the strike side most)
  float flA = clamp(dot(rh, normalize(uFlashDir.xz + vec2(1e-5))) * 0.5 + 0.5, 0.0, 1.0);
  float flash = uFlash * (0.3 + 0.7 * flA * flA) * (1.0 - uEnv);
  vec3 flashCol = vec3(0.62, 0.72, 1.0);
  vec3 fl = vec3(0.0); // flash radiance, added after the fog (attenuated by it, plus a lit-haze term)
  if (rd.y > 0.0 && cover > 0.001) {
    vec2 uv = rd.xz / (rd.y + 0.06) * 0.9 + vec2(uTime * 0.004, uTime * 0.0015);
    float fw = length(fwidth(uv)) * 1.2;
    vec2 w = vec2(skFbm(uv * 0.55 + 3.1, fw * 0.55), skFbm(uv * 0.55 + 9.7, fw * 0.55));
    vec2 q = uv + (w - 0.5) * 1.4;
    float n = skFbm(q, fw);
    // ragged burning gap: the deck opens up toward the sun near the horizon
    float toward = smoothstep(0.55, 1.0, az) * (1.0 - smoothstep(0.02, 0.5, rd.y));
    float gap = uCloud.z * toward;
    float th = mix(0.78, 0.30, cover) + gap * 0.34;
    float soft = mix(0.32, 0.05, uCloud.y);
    float dens = smoothstep(th, th + soft, n);
    // self-shadowing: density gradient toward the sun lights the sun-facing edges of each lump
    vec2 sUV = sh * 0.11;
    float nS = skFbm(q + sUV, fw);
    float relief = clamp((n - nS) * 5.0 + 0.45, 0.0, 1.0);
    float thick = smoothstep(th, th + 0.32, n);
    // underside is slate (sky-lit), lit edges take the low sun, thin parts near the sun glow (silver lining)
    vec3 shade = mix(uZenith * 1.15, uHorizon * 0.55, 0.35) * mix(1.0, 0.55, thick) * tw;
    vec3 lit = mix(uSunTint, tint2, sunset * 0.8) * mix(0.9, 2.4, sunset) * (0.3 + 0.7 * pow(az, 1.5));
    vec3 cc = mix(shade, lit, relief * (1.0 - 0.55 * thick) * (0.45 + 0.55 * az));
    // silver lining: thin cloud right around the sun forward-scatters (kept orange, not white)
    cc += mix(uSunTint, tint2, 0.5) * (pow(m, 8.0) * 2.2 + pow(m, 60.0) * 5.0) * (1.0 - thick) * uGlow.x;
    // lightning inside the deck: thick cores glow, the lumps' relief gives it structure, thin gaps stay darker
    fl = flashCol * flash * (0.35 + 1.65 * thick) * (0.55 + 0.45 * relief) * 2.4;
    // fade the deck into the haze toward the horizon (fog finishes it)
    cloudA = dens * smoothstep(0.0, 0.08, rd.y);
    col = mix(col, cc, cloudA);
    fl *= cloudA;
  }

  // clear sky / haze under the flash: a cold sheet near the horizon of the strike side
  fl += flashCol * flash * (1.0 - cloudA) * (0.12 + 0.5 * exp(-up * 6.0) * flA);

  // --- sun disk (HDR), occluded by cloud, removed in env mode ---
  float disk = smoothstep(0.99996, 0.99999, mu);
  float limb = 0.55 + 0.45 * sqrt(max(1.0 - (1.0 - mu) / 0.00004, 0.0));
  col += uSunTint * disk * limb * uGlow.y * (1.0 - cloudA * 0.97) * (1.0 - uEnv);

  // --- the shared atmosphere, evaluated along the view ray to a far point ---
  // (uSkyFar 0 = ART.sky.fogged false: airless, no fog on the sky)
  vec3 cam = cameraPosition;
  vec3 skyT = vec3(1.0);
  if (uSkyFar > 0.0) {
    col = atmosApply(col, cam + rd * uSkyFar, cam);
    skyT = atmosTransmittance(cam + rd * uSkyFar, cam);
  }
  // the flash through the fog: the deck seen through what transmits, and the rain/fog itself lit cold (so a
  // storm sky fogged to a wall still flashes, brightest in the upper sky where the deck is close)
  if (flash > 0.0) col += fl * skyT + flashCol * flash * (1.0 - skyT) * (0.35 + 0.45 * smoothstep(0.0, 0.5, rd.y)) * (0.6 + 0.4 * flA);

  // env mode: clamp fireflies (sun lobe) so the PMREM stays stable
  if (uEnv > 0.5) {
    float l = max(max(col.r, col.g), col.b);
    col *= min(1.0, uGlow.z / max(l, 1e-4));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSky(G, opts = {}) {
  const S = { ...SKY_DEFAULT, ...(G.ART.sky || {}), ...opts };
  const sunTint = new Vector3().fromArray(G.ART.sun?.color || [1, 0.75, 0.5]);
  const material = new ShaderMaterial({
    name: 'sky',
    uniforms: {
      ...atmosUniforms(),
      uTime: patchUniforms.uTime,
      uZenith: { value: new Vector3().fromArray(S.zenith) },
      uHorizon: { value: new Vector3().fromArray(S.horizon) },
      uGround: { value: new Vector3().fromArray(S.groundTint) },
      uSunTint: { value: sunTint },
      // x cover, y sharpness, z burn gap
      uCloud: { value: [S.cloudCover, S.cloudSharp, S.burnGap, 0] },
      // x aureole, y disk radiance (HDR), z env clamp
      uGlow: { value: new Vector3(S.sunGlow, opts.diskRadiance ?? 60, opts.envClamp ?? 6) },
      uEnv: { value: 0 },
      // opts.far wins (legacy), then ART.sky.fogged === false → 0 (no fog on the sky), then ART.sky.fogFar
      uSkyFar: { value: opts.far ?? (S.fogged === false ? 0 : S.fogFar) },
      uFlash: sharedUniform('uFlash', 'float', 0),
      uFlashDir: { value: new Vector3(1, 0, 0) },
    },
    vertexShader: VS, fragmentShader: SKY_FS,
    side: BackSide, depthWrite: false, depthTest: true, fog: false,
  });
  const geometry = new BoxGeometry(2, 2, 2);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1e6; // last among opaques: depth test rejects covered pixels (no overdraw)
  mesh.castShadow = mesh.receiveShadow = false;
  if (opts.addToScene !== false) G.scene.add(mesh);
  // weather/lightning.js emits {azim} per strike (same convention as its flash light: x = cos, z = sin)
  const onStrike = (e) => { if (e && e.azim != null) material.uniforms.uFlashDir.value.set(Math.cos(e.azim), 0, Math.sin(e.azim)); };
  G.on('lightning', onStrike);
  return {
    mesh, material, geometry,
    // a second mesh sharing the material, for PMREM / probes in another scene
    makeProxy() { const m = new Mesh(geometry, material); m.frustumCulled = false; return m; },
    update() {},
    dispose() { G.off('lightning', onStrike); geometry.dispose(); material.dispose(); mesh.removeFromParent(); },
  };
}
