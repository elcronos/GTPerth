/*! Portions adapted from MIT-licensed code, Copyright (c) 2026 Maksymilian Dendura. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
// Animated caustics: a tileable 512² texture re-rendered every frame (iterated sin/cos domain warp), projected
// along the (refracted) sun direction onto any MeshStandardMaterial through a patch.
// Caustic pattern adapted from MIT-licensed code, Copyright (c) 2026 Maksymilian Dendura (see THIRD_PARTY_NOTICES.md) — `caus()` and its sun projection `cuv()`.
//
//   const caus = createCaustics(G);                                   // one per scene
//   patchCaustics(seabedMat, caus, { mode: 'under', waterY: -1.8 });  // light focused through waves onto the seabed
//   patchCaustics(pillarMat, caus, { mode: 'over',  waterY: -1.8 });  // light reflected off the waves dancing on walls
//
// The patch only modulates the sun's direct diffuse term ('under') or adds a reflected-sun term ('over'),
// so shadowed areas never get caustics and nothing glows at night. Beyond `fadeFar` the pattern fades to its mean
// (no shimmer at distance; mipmaps handle the middle distance).
import { WebGLRenderTarget, Mesh, PlaneGeometry, OrthographicCamera, Scene, ShaderMaterial, RepeatWrapping, LinearMipmapLinearFilter, LinearFilter, Vector3, UnsignedByteType, RGBAFormat } from 'three';
import { patch } from '../engine/patch.js';

const CAUS_FS = /*glsl*/`
uniform float uT;
varying vec2 vUv;
// iterated warp; periodic in uv (period 1) so the texture tiles
float caus(vec2 uv, float t) {
  vec2 p = uv * 6.2831853;
  vec2 i = p;
  float c = 1.0;          // starting at 1 (as the original tileable caustic) gives dark water + bright filaments
  for (int n = 1; n <= 5; n++) {
    float tt = t * (1.0 - 3.5 / float(n));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    float s = sin(i.x + tt);
    float k = cos(i.y + tt);
    c += abs(s * k) / (1.25 * sqrt(s * s + k * k) + 1e-4);
  }
  c = 1.17 - pow(c / 5.0, 1.4);
  return pow(abs(c), 8.0);
}
void main() {
  float t = uT * 0.45 + 23.0;
  // two phase-shifted layers (r, g) let the patch cross-fade for less obvious repetition
  float a = caus(vUv, t);
  float b = caus(fract(vUv + vec2(0.37, 0.61)), t * 0.83 + 4.0);
  gl_FragColor = vec4(clamp(a, 0.0, 1.0), clamp(b, 0.0, 1.0), 0.0, 1.0);
}
`;

/** @returns {{ texture, update(dt,t), rebake(), dispose() }}  (rebake runs itself on G.on('contextrestored')) */
export function createCaustics(G, { size = 512, every = null } = {}) {
  const tier = G.quality.tier;
  const n = tier === 'low' ? 256 : size;
  const step = every ?? (tier === 'low' ? 2 : 1);   // re-render every N frames
  const rt = new WebGLRenderTarget(n, n, { type: UnsignedByteType, format: RGBAFormat, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, depthBuffer: false });
  rt.texture.wrapS = rt.texture.wrapT = RepeatWrapping;
  rt.texture.anisotropy = 4;
  rt.texture.name = 'caustics';
  const mat = new ShaderMaterial({
    uniforms: { uT: { value: 0 } },
    vertexShader: /*glsl*/`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: CAUS_FS, depthTest: false, depthWrite: false,
  });
  const scene = new Scene(), cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), mat); quad.frustumCulled = false; scene.add(quad);
  const draw = () => {
    const r = G.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(rt); r.render(scene, cam); r.setRenderTarget(prev);
  };
  const update = (dt, t) => {
    mat.uniforms.uT.value = t;
    if (G.frame % step) return;
    draw();
  };
  // a lost context wipes the render target: redraw at once (with every > 1, or while paused, the next update
  // could be frames away and the patched materials would sample black for that long)
  const rebake = () => { draw(); G.causticsRebaked = (G.causticsRebaked || 0) + 1; };
  G.on('update', update);
  G.on('contextrestored', rebake);
  draw();
  return {
    texture: rt.texture, update, rebake,
    dispose() { if (G.off) { G.off('update', update); G.off('contextrestored', rebake); } rt.dispose(); mat.dispose(); quad.geometry.dispose(); },
  };
}

// refract the incoming sun ray through a flat water surface (n = 1.33); returns the direction light travels
function refractedSun(sunDir, out) {
  const ix = -sunDir.x, iy = -sunDir.y, iz = -sunDir.z, eta = 1 / 1.33;
  // GLSL refract(I, N=up, eta) = eta*I - (eta*dot(N,I) + sqrt(k))*N, k = 1 - eta²(1 - dot(N,I)²)
  const k = 1 - eta * eta * (1 - iy * iy);
  return out.set(eta * ix, -Math.sqrt(Math.max(k, 0)), eta * iz).normalize();
}

/**
 * @param {Material} material MeshStandard/Physical
 * @param {{texture}} caus createCaustics() result
 * @param {object} o mode 'under'|'over' · waterY · scale (m per tile, 3.3) · strength · fadeFar (m, 60)
 *   maxDepth (under: m below water where the pattern has faded to soft light, 6) · reach (over: m above water, 2.5)
 */
export function patchCaustics(material, caus, o = {}) {
  const G = o.G || window.__G;
  const mode = o.mode || 'under';
  const uniforms = {
    uCausTex: { value: caus.texture },
    uCausY: { value: o.waterY ?? 0 },
    uCausScale: { value: 1 / (o.scale ?? 3.3) },
    uCausK: { value: o.strength ?? 1.0 },
    uCausFar: { value: o.fadeFar ?? 60 },
    uCausDepth: { value: mode === 'under' ? (o.maxDepth ?? 6) : (o.reach ?? 2.5) },
    uCausDir: { value: new Vector3(0, -1, 0) },        // direction the caustic light travels (refracted / reflected sun)
    uCausSun: { value: new Vector3() },                // sun radiance (for 'over')
  };
  const sync = () => {
    const s = G.sun.dir;
    if (mode === 'under') refractedSun(s, uniforms.uCausDir.value);
    else uniforms.uCausDir.value.set(-s.x, s.y, -s.z);   // sun ray mirrored by the water: travels up and away
    uniforms.uCausSun.value.set(G.sun.color.r, G.sun.color.g, G.sun.color.b).multiplyScalar(G.sun.intensity);
  };
  sync();
  G.on('update', sync);

  patch(material, 'caus' + mode, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'varying vec3 causW;\n#include <common>')
      .replace('#include <begin_vertex>', /*glsl*/`#include <begin_vertex>
  {
    vec4 cw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
    cw = instanceMatrix * cw;
#endif
    causW = (modelMatrix * cw).xyz;
  }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CAUS_DECL)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + (mode === 'under' ? CAUS_UNDER : CAUS_OVER));
    // 'under': submerged and swash-zone surfaces are wet → darker, more saturated albedo, smoother
    if (mode === 'under' && o.wetten !== false) shader.fragmentShader = shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  {
    float wz = 1.0 - smoothstep(uCausY + 0.05, uCausY + 0.6, causW.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, pow(diffuseColor.rgb, vec3(1.35)) * 0.75, wz);
    roughnessFactor = mix(roughnessFactor, 0.35, wz * step(uCausY, causW.y));
  }`);
  });
  return { uniforms, sync };
}

const CAUS_DECL = /*glsl*/`
varying vec3 causW;
uniform sampler2D uCausTex;
uniform float uCausY;
uniform float uCausScale;
uniform float uCausK;
uniform float uCausFar;
uniform float uCausDepth;
uniform vec3 uCausDir;
uniform vec3 uCausSun;
// project the point along the light direction back up to the water plane → pattern coordinate (m)
vec2 causUV(vec3 p) { return p.xz - uCausDir.xz * ((p.y - uCausY) / uCausDir.y); }
// chromatic sample: r/g/b offset (dispersion), second-scale breakup; mean ≈ 1
vec3 causSample(vec3 p, float spread) {
  vec2 q = causUV(p) * uCausScale;
  vec2 o = vec2(0.004, 0.0025) * (1.0 + spread * 3.0);
  // texture mean ≈ 0.19 → ×5 makes the mean ≈ 1 (energy conserving modulation of the sun)
  vec3 a = vec3(texture(uCausTex, q + o).r, texture(uCausTex, q).r, texture(uCausTex, q - o).r);
  float b = texture(uCausTex, q.yx * 0.31 + 0.37).g;          // large-scale breakup (other layer, other scale)
  vec3 c = min(a * 5.0 * (0.62 + 2.0 * b), vec3(8.0));
  float d = length(p - cameraPosition);
  return mix(c, vec3(1.0), smoothstep(uCausFar * 0.5, uCausFar, d));
}
`;

const CAUS_UNDER = /*glsl*/`
  {
    float dep = uCausY - causW.y;                         // metres under the water plane
    if (dep > 0.0) {
      float k = smoothstep(0.0, 0.35, dep) * (1.0 - smoothstep(uCausDepth * 0.4, uCausDepth, dep)) * uCausK;
      vec3 c = causSample(causW, dep / uCausDepth);
      // modulate only the sun (already shadowed); energy roughly conserved: mean of c ≈ 1
      reflectedLight.directDiffuse *= mix(vec3(1.0), c, k);
    }
  }
`;

const CAUS_OVER = /*glsl*/`
  {
    float h = causW.y - uCausY;                           // metres above the water plane
    if (h > -0.05 && h < uCausDepth) {
      vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix));
      // faces that look down/out toward the water catch the reflected sun
      float facing = clamp(dot(nW, -uCausDir) * 0.8 + 0.2, 0.0, 1.0);
      float fall = exp(-h / (uCausDepth * 0.35)) * smoothstep(-0.05, 0.08, h);
      vec3 c = causSample(causW, 0.3);
      // Fresnel of the low sun on water ≈ 0.1-0.3; times the dancing pattern
      reflectedLight.indirectDiffuse += diffuseColor.rgb * uCausSun * c * (0.05 * fall * facing * uCausK);
    }
  }
`;
