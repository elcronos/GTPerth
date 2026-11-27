// The ONE atmosphere model (analytic exponential height fog + sun in-scatter) shared by every shader:
// patched MeshStandard/Basic/Lambert materials (via atmos.js patchAtmos), the procedural sky (sky.js),
// backdrop cards, particles and any custom ShaderMaterial. Because the sky evaluates exactly the same
// function along its view ray, geometry fades into the sky at the horizon with no seam.
//
// Physics (per RGB channel c):
//   density(h)   = exp(-k * (h - base))                       (k = uFogFalloff, base = uFogBase)
//   tau_c(d)     = sigma_c * Integral_0^d density(o.y + rd.y*t) dt
//                = sigma_c * exp(-k*(o.y-base)) * d * (1 - exp(-a)) / a,   a = k*rd.y*d
//   T_c          = exp(-tau_c)                                (transmittance)
//   L_in         = uFogScatter + uSunColor * phase(mu) * uFogSunInscatter
//   result       = col * T + L_in * (1 - T)
// The fog starts uFogStart metres from the camera so the near field stays crisp.
//
// Uniforms (declared automatically for patched materials by engine/patch.js; ShaderMaterials paste
// ATMOS_DECL and pass atmosUniforms() — see atmos.js):
//   uSunDir vec3 (normalized, TO the sun), uSunColor vec3 (linear colour * intensity, = DirectionalLight irradiance)
//   uFogSigma vec3 (extinction per metre at base height), uFogScatter vec3 (ambient in-scatter radiance, HDR)
//   uFogFalloff float (1/m), uFogBase float (m), uFogSunInscatter float (sun lobe strength), uFogStart float (m)

export const ATMOS_DECL = /*glsl*/`
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogSigma;
uniform vec3 uFogScatter;
uniform float uFogFalloff;
uniform float uFogBase;
uniform float uFogSunInscatter;
uniform float uFogStart;
`;

export const ATMOS_GLSL = /*glsl*/`
// optical depth (per channel) between the camera and a world point
vec3 atmosTau(vec3 wpos, vec3 cam) {
  vec3 v = wpos - cam;
  float d = length(v);
  vec3 rd = v / max(d, 1e-4);
  float dd = max(d - uFogStart, 0.0);
  // origin moved to where the fog starts along the ray
  float h0 = cam.y + rd.y * (d - dd) - uFogBase;
  float k = max(uFogFalloff, 1e-5);
  // clamp so camera far below the base (or rays diving down kilometres) cannot overflow exp()
  float a = clamp(k * rd.y * dd, -30.0, 80.0);
  float f = abs(a) > 1e-3 ? (1.0 - exp(-a)) / a : 1.0 - 0.5 * a;
  float dens = exp(clamp(-k * h0, -60.0, 6.0));
  return uFogSigma * (dens * dd * f);
}
// skylight dims as the sun sets: 1 for elevations >= ~11 deg (ART values are authored for that), ~0.55 at 1.5 deg,
// 0.25 at night. Lets one ART drive a day cycle without re-authoring fog/sky colours.
float atmosTwilight() {
  return mix(0.25, 1.0, smoothstep(-0.12, 0.19, uSunDir.y));
}
// Henyey-Greenstein, normalized so that the sphere average is 1 (i.e. HG * 4pi)
float atmosHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5);
}
// radiance scattered toward the camera by the fog along direction rd
vec3 atmosInscatter(vec3 rd) {
  float mu = dot(rd, uSunDir);
  // two lobes: strong forward glow toward the sun + weak back-scatter so the anti-sun side is not dead
  float ph = 0.8 * atmosHG(mu, 0.62) + 0.2 * atmosHG(mu, -0.25);
  float sunUp = smoothstep(-0.08, 0.06, uSunDir.y);
  // multiple-scattered skylight: full colour toward the sun, cooler and dimmer on the anti-sun side
  vec3 amb = uFogScatter * mix(vec3(0.58, 0.66, 0.82), vec3(1.0), mu * 0.5 + 0.5) * atmosTwilight();
  return amb + uSunColor * (ph * uFogSunInscatter * 0.0125 * sunUp);
}
vec3 atmosTransmittance(vec3 wpos, vec3 cam) {
  return exp(-atmosTau(wpos, cam));
}
// THE fog: every opaque surface, the sky and the backdrop call this with their linear HDR colour
vec3 atmosApply(vec3 col, vec3 wpos, vec3 cam) {
  vec3 T = exp(-atmosTau(wpos, cam));
  vec3 rd = normalize(wpos - cam);
  return col * T + atmosInscatter(rd) * (1.0 - T);
}
`;
