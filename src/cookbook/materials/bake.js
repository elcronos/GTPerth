// GPU procedural PBR texture baker.
//
//   const set = bakeSurface(renderer, { surf: SURF.concrete.glsl, size: 1024, scale: 4, depth: 0.02, params: { uSeed: 3 } });
//   new MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap,
//                              metalnessMap: set.roughnessMap, aoMap: set.aoMap, roughness: 1, metalness: 1 });
//
// A surf program is GLSL that defines   void surf(vec2 uv, inout Surf s)   with uv in [0,1) over ONE TILE
// (the tile covers `scale` metres). It must tile: use the periodic noise (fbmP, voronoiP, ...) with whole-number
// frequencies. It writes the Surf fields:
//   albedo (linear RGB, untinted)  height [0,1] (x depth metres)  ao [0,1]  rough [0,1]  metal [0,1]
//   mask [0,1] (where material.color tints the albedo)  emit [0,1] (emissive amount, x material.emissive)
// Available inside surf: NOISE_GLSL + SURF_LIB helpers, uniforms uTexel (1/bake res), uScaleM (metres per tile),
// and every key in `params` as a uniform (number -> float, [x,y]/[x,y,z]/[x,y,z,w] -> vecN).
//
// Pipeline: (1) MRT pass renders surf() at ss x size (ss = 2 when size <= 1024: 4-sample supersampling kills
// bake-time aliasing) into float targets [albedo+mask, ao/rough/metal/emit, height]; it is drawn in bands with a
// gl.flush between them so a heavy program never trips the GPU watchdog. (2) Resolve passes box-filter down to
// `size` and write: albedo (SRGB8_ALPHA8, alpha = tint mask), ORM (R=ao G=rough B=metal A=emit), normal (Sobel of
// height in metric units, RGB = tangent normal, A = height). All three are mipmapped, RepeatWrapping, anisotropy 8.
// Results are cached by key; the float scratch is freed after every bake. rebakeAll(renderer) refills every cached
// set in place after a WebGL context restore (render-target contents are lost; the texture objects stay valid).
import {
  WebGLRenderTarget, ShaderMaterial, Mesh, Scene, Camera, BufferGeometry, Float32BufferAttribute, GLSL3,
  FloatType, HalfFloatType, UnsignedByteType, RGBAFormat, NearestFilter, LinearFilter, LinearMipmapLinearFilter,
  RepeatWrapping, SRGBColorSpace, NoColorSpace, Vector2, Vector3, Vector4,
} from 'three';
import { NOISE_GLSL } from './noise.glsl.js';

// Bake size per quality tier (texels per tile). high = 1024 (supersampled from 2048).
export const BAKE_SIZE = { low: 512, med: 1024, high: 1024, ultra: 2048 };

const cache = new Map();
let tri = null, cam = null;
const fsTri = () => {
  if (tri) return tri;
  tri = new BufferGeometry();
  tri.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  tri.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  cam = new Camera();
  return tri;
};

const VERT = /*glsl*/`
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Surf struct + defaults; surf programs fill it.
export const SURF_STRUCT = /*glsl*/`
struct Surf { vec3 albedo; float height; float ao; float rough; float metal; float mask; float emit; };
`;

const uniformDecl = (params) => {
  let s = '';
  for (const k in params) {
    const v = params[k];
    const t = typeof v === 'number' ? 'float' : Array.isArray(v) ? ['', '', 'vec2', 'vec3', 'vec4'][v.length] : v.isVector2 ? 'vec2' : v.isVector3 || v.isColor ? 'vec3' : 'vec4';
    s += `uniform ${t} ${k};\n`;
  }
  return s;
};
const uniformVal = (v) => {
  if (typeof v === 'number' || !Array.isArray(v)) return v;
  return v.length === 2 ? new Vector2(...v) : v.length === 3 ? new Vector3(...v) : new Vector4(...v);
};

function bakeMaterial(surfGlsl, lib, params) {
  const uniforms = { uTexel: { value: 0 }, uScaleM: { value: 1 } };
  for (const k in params) uniforms[k] = { value: uniformVal(params[k]) };
  return new ShaderMaterial({
    glslVersion: GLSL3, uniforms, vertexShader: VERT, depthTest: false, depthWrite: false,
    fragmentShader: /*glsl*/`
precision highp float;
precision highp int;
in vec2 vUv;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
uniform float uTexel;
uniform float uScaleM;
` + uniformDecl(params) + NOISE_GLSL + SURF_STRUCT + lib + surfGlsl + /*glsl*/`
void main() {
  Surf s = Surf(vec3(0.5), 0.5, 1.0, 0.7, 0.0, 0.0, 0.0);
  surf(fract(vUv), s);
  o0 = vec4(clamp(s.albedo, 0.0, 1.0), clamp(s.mask, 0.0, 1.0));
  o1 = vec4(clamp(s.ao, 0.0, 1.0), clamp(s.rough, 0.02, 1.0), clamp(s.metal, 0.0, 1.0), clamp(s.emit, 0.0, 1.0));
  o2 = vec4(s.height, 0.0, 0.0, 1.0);
}
`,
  });
}

// Resolve: box-filter ss x ss scratch texels into one output texel. MODE 0 albedo, 1 orm, 2 normal+height.
const RESOLVE_FRAG = /*glsl*/`
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 oCol;
uniform sampler2D tA;
uniform sampler2D tB;
uniform sampler2D tH;
uniform int uSS;
uniform float uSlope;   // depth_m / (8 * texel_m): Sobel sum -> metric slope
ivec2 wrapT(ivec2 p, int n) { return ((p % n) + n) % n; }
float H(ivec2 p, int n) { return texelFetch(tH, wrapT(p, n), 0).r; }
void main() {
  int n = textureSize(tH, 0).x;
  ivec2 base = ivec2(floor(gl_FragCoord.xy)) * uSS;
  vec4 acc = vec4(0.0);
  for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
    if (x >= uSS || y >= uSS) continue;
    ivec2 p = base + ivec2(x, y);
#if MODE == 0
    acc += texelFetch(tA, p, 0);
#elif MODE == 1
    acc += texelFetch(tB, p, 0);
#else
    float tl = H(p + ivec2(-1, 1), n), t = H(p + ivec2(0, 1), n), tr = H(p + ivec2(1, 1), n);
    float l = H(p + ivec2(-1, 0), n), c = H(p, n), r = H(p + ivec2(1, 0), n);
    float bl = H(p + ivec2(-1, -1), n), b = H(p + ivec2(0, -1), n), br = H(p + ivec2(1, -1), n);
    float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
    float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
    vec3 nn = normalize(vec3(-gx * uSlope, -gy * uSlope, 1.0));
    acc += vec4(nn, c);
#endif
  }
  acc /= float(uSS * uSS);
#if MODE == 2
  // averaged (unnormalised) normal: its shortening is what specular AA (Toksvig) reads after mipmapping
  oCol = vec4(acc.xyz * 0.5 + 0.5, clamp(acc.w, 0.0, 1.0));
#else
  oCol = acc;
#endif
}
`;
const resolveMats = [];
function resolveMat(mode) {
  if (resolveMats[mode]) return resolveMats[mode];
  return (resolveMats[mode] = new ShaderMaterial({
    glslVersion: GLSL3, defines: { MODE: mode }, vertexShader: VERT, fragmentShader: RESOLVE_FRAG, depthTest: false, depthWrite: false,
    uniforms: { tA: { value: null }, tB: { value: null }, tH: { value: null }, uSS: { value: 1 }, uSlope: { value: 1 } },
  }));
}

function finalTarget(renderer, size, srgb) {
  const rt = new WebGLRenderTarget(size, size, {
    type: UnsignedByteType, format: RGBAFormat, colorSpace: srgb ? SRGBColorSpace : NoColorSpace,
    generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
    wrapS: RepeatWrapping, wrapT: RepeatWrapping, depthBuffer: false, stencilBuffer: false,
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
  });
  return rt;
}

// Render one bake job into its three final targets. Used for the first bake and again after a context restore
// (render-target CONTENTS do not survive a lost context; three re-creates the GL objects lazily, we refill them).
function runBake(renderer, job, outs) {
  const { surf, lib, size, scale, depth, params } = job;
  const gl = renderer.getContext();
  const floatOK = !!renderer.extensions.get('EXT_color_buffer_float');
  const ss = size <= 1024 ? 2 : 1, N = size * ss;
  const scratch = new WebGLRenderTarget(N, N, {
    count: 3, type: floatOK ? FloatType : HalfFloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter,
    generateMipmaps: false, depthBuffer: false, stencilBuffer: false,
  });

  // save renderer state
  const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevScissor = renderer.getScissorTest();
  const prevXR = renderer.xr.enabled; renderer.xr.enabled = false;
  renderer.autoClear = false;

  const geo = fsTri();
  const mesh = new Mesh(geo); mesh.frustumCulled = false;
  const scene = new Scene(); scene.add(mesh);

  // (1) surf -> MRT scratch, in horizontal bands
  const mat = bakeMaterial(surf, lib || '', params);
  mat.uniforms.uTexel.value = 1 / N; mat.uniforms.uScaleM.value = scale;
  mesh.material = mat;
  renderer.setRenderTarget(scratch);
  renderer.setScissorTest(true);
  const band = 256;
  for (let y = 0; y < N; y += band) {
    scratch.scissor.set(0, y, N, Math.min(band, N - y)); scratch.scissorTest = true;
    renderer.setRenderTarget(scratch);
    renderer.render(scene, cam);
    gl.flush();
  }
  scratch.scissorTest = false;
  renderer.setScissorTest(false);

  // (2) resolve into the three final targets
  const texelM = scale / N;
  for (let m = 0; m < 3; m++) {
    const rm = resolveMat(m);
    rm.uniforms.tA.value = scratch.textures[0]; rm.uniforms.tB.value = scratch.textures[1]; rm.uniforms.tH.value = scratch.textures[2];
    rm.uniforms.uSS.value = ss; rm.uniforms.uSlope.value = depth / (8 * texelM);
    mesh.material = rm;
    renderer.setRenderTarget(outs[m]);
    renderer.render(scene, cam); // three generates the mip chain after rendering into a mipmapped target
  }

  renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto; renderer.setScissorTest(prevScissor); renderer.xr.enabled = prevXR;
  mat.dispose(); scratch.dispose();
}

/**
 * Bake a surf program to a PBR texture set.
 * @param {WebGLRenderer} renderer
 * @param {object} o  { surf: glsl, lib?: glsl helpers, size=1024, scale=1 (metres per tile), depth=0.01 (metres of
 *                      relief for height 0..1), params={}, key?: cache key (default derived from surf+params) }
 * @returns {{map, normalMap, roughnessMap, metalnessMap, aoMap, size, scale, key, rebake(renderer?), dispose()}}
 */
export function bakeSurface(renderer, o) {
  const size = o.size || 1024, scale = o.scale || 1, depth = o.depth ?? 0.01, params = o.params || {};
  const key = o.key || (hashStr(o.surf) + '|' + size + '|' + scale + '|' + depth + '|' + JSON.stringify(params));
  if (cache.has(key)) return cache.get(key);

  const job = { surf: o.surf, lib: o.lib || '', size, scale, depth, params };
  const rtA = finalTarget(renderer, size, true), rtO = finalTarget(renderer, size, false), rtN = finalTarget(renderer, size, false);
  const outs = [rtA, rtO, rtN];
  runBake(renderer, job, outs);

  const set = {
    map: rtA.texture, roughnessMap: rtO.texture, metalnessMap: rtO.texture, aoMap: rtO.texture, normalMap: rtN.texture,
    size, scale, key,
    /** Re-render into the same targets (same texture objects, so every material keeps working). */
    rebake(r = renderer) { runBake(r, job, outs); },
    dispose() { rtA.dispose(); rtO.dispose(); rtN.dispose(); cache.delete(key); },
  };
  cache.set(key, set);
  return set;
}

export function clearBakeCache() { for (const s of [...cache.values()]) s.dispose(); }
export const bakeCacheSize = () => cache.size;
/** Re-render every cached bake in place. Call after a WebGL context restore (library.js wires this to
 *  G.on('contextrestored') in initMaterials). Returns the number of sets rebaked. */
export function rebakeAll(renderer) { let n = 0; for (const s of cache.values()) { s.rebake(renderer); n++; } return n; }

function hashStr(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
