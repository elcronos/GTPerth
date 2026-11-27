// GPU-generated sprite atlases (rendered once at create, ~5-20 ms): a fireball flipbook (8×8 frames of a
// ray-marched billowing fbm volume that grows, cools and turns to smoke) and a smoke-puff atlas (4×4 static
// variants). Texel encoding (both): R = emitted heat (0..1), G = opacity, B/A = sprite-space normal xy*0.5+0.5
// (gradient of the density at the visible surface) so puffs are LIT by the real sun at any sprite rotation.
import {
  WebGLRenderTarget, ShaderMaterial, Mesh, PlaneGeometry, Scene, OrthographicCamera, LinearFilter,
  LinearMipmapLinearFilter, UnsignedByteType, RGBAFormat, NoBlending,
} from 'three';

const VS = /*glsl*/`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FS = /*glsl*/`
uniform float uGrid;
uniform float uMode;
uniform float uSteps;
varying vec2 vUv;
float h3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vn(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 0.0)), h3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(h3(i + vec3(0.0, 0.0, 1.0)), h3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 1.0)), h3(i + 1.0), f.x), f.y), f.z);
}
// billowy fbm: abs-folded octaves give the cauliflower look of real explosion/smoke
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * abs(vn(p) * 2.0 - 1.0);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
float gTau;
vec3 gSeed;
float radiusAt(float tau) { return uMode < 0.5 ? 0.55 + 0.33 * (1.0 - pow(1.0 - tau, 2.0)) : 0.62; }
// signed "inside" amount: > 0 inside the cloud
float field(vec3 p) {
  float R = radiusAt(gTau);
  vec3 q = p;
  q.y -= (uMode < 0.5 ? 0.12 * gTau : 0.0);
  float n = fbm(q * 2.1 + gSeed + vec3(0.0, -gTau * 1.6, 0.0));
  float d = R - length(q * vec3(1.0, 1.08, 1.0)) - (n - 0.32) * (0.55 + 0.35 * gTau);
  // late frames erode into wisps
  d -= smoothstep(0.55, 1.0, gTau) * 0.25 * (1.0 - n);
  return d;
}
void main() {
  vec2 cell = floor(vUv * uGrid);
  vec2 f = fract(vUv * uGrid);
  float idx = cell.y * uGrid + cell.x;
  float N = uGrid * uGrid;
  gTau = uMode < 0.5 ? idx / (N - 1.0) : 0.35 + 0.3 * fract(idx * 0.618);
  gSeed = uMode < 0.5 ? vec3(3.1, 7.7, 1.3) : vec3(idx * 13.7, idx * 5.3, idx * 2.9);
  // keep a 6% empty border around every frame so mipmaps never bleed between frames
  vec2 p2 = (f - 0.5) * 2.0 / 0.88;
  float edge = 1.0 - smoothstep(0.92, 1.0, max(abs(p2.x), abs(p2.y)));
  float T = 1.0;
  float E = 0.0;
  vec3 nrm = vec3(p2, 0.3);
  bool hit = false;
  float dz = 2.0 / uSteps;
  for (int i = 0; i < 48; i++) {
    if (float(i) >= uSteps) break;
    float z = 1.0 - (float(i) + 0.5) * dz;
    vec3 p = vec3(p2, z);
    float d = field(p);
    // fire: dense billowy surface; puffs: soft graded edge (no cut-out silhouette)
    float dens = uMode < 0.5 ? smoothstep(0.0, 0.14, d) * 8.0 : smoothstep(-0.04, 0.42, d) * 3.2;
    if (dens > 0.001) {
      float a = 1.0 - exp(-dens * dz);
      // heat: hottest in the core and early in life; pockets of fire survive inside the billows
      // heat: the visible surface IS the fire early on; hot where the projected radius is small (core) and in
      // noise valleys (folds between billows glow, crests cool into soot first). Cools with tau.
      float R = radiusAt(gTau);
      float core = 1.0 - length(p.xy) / R;
      float heat = uMode < 0.5 ? clamp((core * 1.1 + 0.55 - (fbm(p * 3.3 + gSeed.zxy) - 0.3) * 1.3) * pow(1.0 - gTau, 1.25) * 1.25 - gTau * 0.35, 0.0, 1.0) : 0.0;
      E += T * a * heat;
      if (!hit && T < 0.55) {
        hit = true;
        float e = 0.04;
        nrm = -vec3(field(p + vec3(e, 0.0, 0.0)) - field(p - vec3(e, 0.0, 0.0)),
                    field(p + vec3(0.0, e, 0.0)) - field(p - vec3(0.0, e, 0.0)),
                    field(p + vec3(0.0, 0.0, e)) - field(p - vec3(0.0, 0.0, e)));
      }
      T *= 1.0 - a;
      if (T < 0.01) break;
    }
  }
  nrm = normalize(nrm + vec3(0.0, 0.0, 1e-3));
  float alpha = (1.0 - T) * edge;
  // puffs: radial falloff so overlapping sprites blend into one volume
  if (uMode > 0.5) alpha *= smoothstep(1.0, 0.35, length(p2)) * 0.92;
  gl_FragColor = vec4(clamp(E * edge, 0.0, 1.0), alpha, nrm.xy * 0.5 + 0.5);
}`;

function bake(renderer, size, grid, mode, steps) {
  const rt = new WebGLRenderTarget(size, size, {
    type: UnsignedByteType, format: RGBAFormat, depthBuffer: false, generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
  });
  const mat = new ShaderMaterial({ vertexShader: VS, fragmentShader: FS, blending: NoBlending, depthTest: false, depthWrite: false,
    uniforms: { uGrid: { value: grid }, uMode: { value: mode }, uSteps: { value: steps } } });
  const scene = new Scene(), cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), mat); quad.frustumCulled = false; scene.add(quad);
  const prev = renderer.getRenderTarget(), ac = renderer.autoClear;
  renderer.autoClear = true;
  renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(prev);
  renderer.autoClear = ac;
  quad.geometry.dispose(); mat.dispose();
  rt.texture.name = mode < 0.5 ? 'fx-fireball' : 'fx-puff';
  return rt;
}

// returns { fire: {texture, grid}, puff: {texture, grid}, dispose() }
export function createAtlases(renderer, tier = 'high') {
  const big = tier === 'low' ? 512 : tier === 'ultra' ? 2048 : 1024;
  const steps = tier === 'low' ? 20 : tier === 'ultra' ? 44 : 32;
  const fire = bake(renderer, big, 8, 0, steps);
  const puff = bake(renderer, big / 2, 4, 1, steps);
  return {
    fire: { texture: fire.texture, grid: 8 }, puff: { texture: puff.texture, grid: 4 },
    dispose() { fire.dispose(); puff.dispose(); },
  };
}
