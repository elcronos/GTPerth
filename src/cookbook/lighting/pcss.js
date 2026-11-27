// Contact-hardening soft shadows (PCSS) for three r180, installed globally by replacing getShadow() in
// ShaderChunk.shadowmap_pars_fragment, plus the sun-shadow helpers that make it look right:
//   installPCSS(opts)                      BEFORE any material compiles (right after createCore)
//   fitSunShadow(G, box3, mapSize)         fit the sun's ortho shadow camera to the level AABB (texel snapped)
//   createShadowScheduler(G, opts)         static: render once (+ invalidate()); dynamic: every N frames
//
// Algorithm (all in shadow-map uv space, ortho sun):
//   1. receiver-plane depth bias: dz/duv from dFdx/dFdy of the shadow coord, so every tap compares against
//      the receiver's own plane (kills acne on slopes without peter-panning)
//   2. blocker search: Vogel disk rotated per pixel by interleaved gradient noise (IGN)
//   3. penumbra (metres) = blocker→receiver distance * lightSize, clamped [1 texel, maxPenumbra]
//   4. Vogel-disk PCF of that radius (16 taps on high)
// shadow.radius of a light scales its softness (1 = default; < 0 = plain PCF of |radius| texels, use it
// for spot lights, whose perspective depth does not match the sun's metric range). Unpatched/other renderers: uPCSS stays 0 →
// falls back to a small rotated PCF, never a compile error.
import { ShaderChunk, ShaderLib, Vector3, Matrix4, Box3 } from 'three';

// Shared by every built-in material via ShaderLib (Float32Array is shared by reference by three's
// uniform cloning, so writing it updates every program): x depth range m, y frustum width m, z light size, w enabled.
export const pcssData = new Float32Array([100, 100, 0.012, 0]);

// map = sun shadow-map size. It mirrors engine/quality.js TIERS[*].shadow (1024/2048/2048/4096), which is the
// source of truth: fitSunShadow and installPCSS read G.quality.settings.shadow first, this table is the fallback
// when there is no quality controller. High is 2048 on purpose (engine budget: 4096² = 64 MB of RGBA depth plus a
// 4x caster pass); PCSS penumbrae hide the coarser texel. Crisper shadows: ?q=ultra or fitSunShadow(G, box, 4096).
const TIERS = {
  low: { blocker: 0, pcf: 6, map: 1024 },
  med: { blocker: 6, pcf: 10, map: 2048 },
  high: { blocker: 8, pcf: 16, map: 2048 },
  ultra: { blocker: 12, pcf: 24, map: 4096 },
};
export const PCSS_TIERS = TIERS;

let original = null;

// (defines are built with plain string concat: never interpolate into a #define inside a /*glsl*/ literal,
//  the minifier trims the space before an interpolation.)
const pcssHeader = (t, maxPenM, searchM) =>
  '#define PCSS_BLOCKER ' + t.blocker + '\n#define PCSS_PCF ' + t.pcf +
  '\n#define PCSS_MAXPEN ' + maxPenM.toFixed(3) + '\n#define PCSS_SEARCH ' + searchM.toFixed(3) + '\n';
const PCSS_BODY = /*glsl*/`
uniform vec4 uPCSS;
float pcssIGN(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
vec2 pcssVogel(int i, int n, float phi) {
  float r = sqrt((float(i) + 0.5) / float(n));
  float th = float(i) * 2.39996323 + phi;
  return r * vec2(cos(th), sin(th));
}
float pcssDepth(sampler2D m, vec2 uv) {
  return unpackRGBAToDepth(texture2D(m, uv));
}
float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
  float shadow = 1.0;
  shadowCoord.xyz /= shadowCoord.w;
  shadowCoord.z += shadowBias;
  // receiver plane: depth slope in shadow uv (computed before any branch: derivatives need uniform flow)
  vec3 sdx = dFdx(shadowCoord.xyz);
  vec3 sdy = dFdy(shadowCoord.xyz);
  float det = sdx.x * sdy.y - sdx.y * sdy.x;
  vec2 dzduv = abs(det) > 1e-14 ? vec2(sdy.y * sdx.z - sdx.y * sdy.z, sdx.x * sdy.z - sdy.x * sdx.z) / det : vec2(0.0);
  // clamp: at silhouettes the plane fit is garbage
  float slopeMax = 6.0 / max(uPCSS.x, 1.0) * max(uPCSS.y, 1.0);
  dzduv = clamp(dzduv, vec2(-slopeMax), vec2(slopeMax));
  bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
  bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
  if ( frustumTest ) {
    vec2 texel = 1.0 / shadowMapSize;
    float phi = pcssIGN(gl_FragCoord.xy) * 6.2831853;
    float zr = shadowCoord.z;
    // constant slope-scaled epsilon on top of the plane (one texel of slope)
    float eps = (abs(dzduv.x) * texel.x + abs(dzduv.y) * texel.y) * 0.6 + 1e-5;
    float rUV;
    // fallback (no fit data, or a light that opts out with shadow.radius < 0, e.g. spot lamps): small rotated PCF
    if (uPCSS.w < 0.5 || shadowRadius < 0.0) {
      rUV = texel.x * 1.5 * max(abs(shadowRadius), 0.5);
    } else {
      float uvPerM = 1.0 / uPCSS.y;
      float minUV = texel.x * 1.2;
      float maxUV = PCSS_MAXPEN * uvPerM * max(shadowRadius, 0.1);
#if PCSS_BLOCKER > 0
      float searchUV = clamp(uPCSS.z * PCSS_SEARCH * uvPerM * max(shadowRadius, 0.1), texel.x * 3.0, maxUV);
      float bSum = 0.0;
      float bCnt = 0.0;
      for (int i = 0; i < PCSS_BLOCKER; i++) {
        vec2 o = pcssVogel(i, PCSS_BLOCKER, phi) * searchUV;
        float d = pcssDepth(shadowMap, shadowCoord.xy + o);
        float zc = zr + dot(dzduv, o) - eps;
#ifdef USE_REVERSED_DEPTH_BUFFER
        if (d > zc) { bSum += d; bCnt += 1.0; }
#else
        if (d < zc) { bSum += d; bCnt += 1.0; }
#endif
      }
      if (bCnt < 0.5) return 1.0;
      float distM = abs(zr - bSum / bCnt) * uPCSS.x;
      rUV = clamp(distM * uPCSS.z * uvPerM * max(shadowRadius, 0.1), minUV, maxUV);
#else
      rUV = minUV * 2.0 * max(shadowRadius, 0.5);
#endif
    }
    // wide penumbrae get twice the taps (noise ~ 1/sqrt(n) is most visible there); contact shadows stay cheap
    int n = rUV > texel.x * 5.0 ? PCSS_PCF * 2 : PCSS_PCF;
    float s = 0.0;
    for (int i = 0; i < PCSS_PCF * 2; i++) {
      if (i >= n) break;
      vec2 o = pcssVogel(i, n, phi) * rUV;
      s += texture2DCompare(shadowMap, shadowCoord.xy + o, zr + dot(dzduv, o) - eps);
    }
    shadow = s / float(n);
    // fade out at the map border instead of a hard edge
    vec2 e = min(shadowCoord.xy, 1.0 - shadowCoord.xy);
    shadow = mix(1.0, shadow, smoothstep(0.0, 0.02, min(e.x, e.y)));
  }
  return mix( 1.0, shadow, shadowIntensity );
}
`;

// opts: { tier, lightSize (penumbra metres per metre of blocker distance, sun ≈ 0.0093, art 0.015-0.03),
//         maxPenumbra (m), search (max blocker distance considered, m) }
export function installPCSS(opts = {}) {
  let tier = TIERS[opts.tier] || TIERS[opts.G?.quality?.tier] || TIERS.high;
  // engine/quality.js settings win when present (pcssTaps 0 = no blocker search, plain rotated PCF)
  const qs = opts.G?.quality?.settings;
  if (qs && !opts.tier && qs.pcssTaps != null) tier = { blocker: qs.pcssTaps ? Math.max(6, qs.pcssTaps >> 1) : 0, pcf: Math.max(6, Math.min(qs.pcssTaps || 6, 24)), map: qs.shadow || tier.map };
  if (!original) original = ShaderChunk.shadowmap_pars_fragment;
  const src = original;
  const a = src.indexOf('float getShadow(');
  const b = src.indexOf('vec2 cubeToUV(');
  if (a < 0 || b < 0) {
    const msg = 'pcss: three shadow chunk layout changed, PCSS not installed';
    if (opts.G) opts.G.errors.push(msg); console.warn(msg);
    return false;
  }
  // keep the comment block that precedes cubeToUV out of the cut: find its start
  const cut = src.lastIndexOf('// cubeToUV', b);
  const end = cut > a ? cut : b;
  ShaderChunk.shadowmap_pars_fragment = src.slice(0, a) + pcssHeader(tier, opts.maxPenumbra ?? 0.45, opts.search ?? 30) + PCSS_BODY + '\n' + src.slice(end);
  pcssData[2] = opts.lightSize ?? 0.012;
  // give every lit built-in material the shared uniform
  for (const k in ShaderLib) {
    const sh = ShaderLib[k];
    if (sh.uniforms && sh.uniforms.directionalLightShadows) sh.uniforms.uPCSS = { value: pcssData };
  }
  return true;
}

// Switch PCSS tap counts at runtime (recompiles every material once — do it on a menu change, not mid-fight).
export function setPCSSTier(G, tier) {
  installPCSS({ tier, lightSize: pcssData[2], G });
  G.scene.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) m.needsUpdate = true;
  });
  const t = TIERS[tier];
  if (t && G.sun?.light) setShadowMapSize(G.sun.light, t.map);
}

export function setShadowMapSize(light, size) {
  const sh = light.shadow;
  if (sh.mapSize.x === size) return;
  sh.mapSize.set(size, size);
  if (sh.map) { sh.map.dispose(); sh.map = null; }
}

const _m = new Matrix4(), _v = new Vector3(), _x = new Vector3(), _y = new Vector3(), _z = new Vector3(), _c = new Vector3();
const _up = new Vector3(0, 1, 0), _zero = new Vector3();

// Fit the sun's orthographic shadow camera tightly around a world AABB (the level), in light space,
// snapped to whole shadow texels so the shadow does not crawl when the sun rotates slightly.
//   mapSize defaults to G.quality.settings.shadow (engine TIERS: low 1024, med/high 2048, ultra 4096). margin: extra metres around the box.
// Also sets bias/normalBias and the PCSS depth range / frustum width. Call again if the sun moves a lot.
//   maxShadowLen: casters' shadows are followed down to the ground plane (box.min.y) up to this many metres, so a
//   low sun's long shadows are not cut off at the box edge (they would end in a hard line).
export function fitSunShadow(G, box3, mapSize, { margin = 2, light = G.sun.light, dir = G.sun.dir, maxShadowLen = 60 } = {}) {
  const size = mapSize || G.quality?.settings?.shadow || TIERS[G.quality?.tier]?.map || 2048;
  setShadowMapSize(light, size);
  // the same basis three's shadow camera uses: lookAt(lightPos → target, up = +Y)
  _m.lookAt(dir, _zero, Math.abs(dir.y) > 0.999 ? _v.set(0, 0, 1) : _up);
  _x.setFromMatrixColumn(_m, 0); _y.setFromMatrixColumn(_m, 1); _z.setFromMatrixColumn(_m, 2);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const h = box3.max.y - box3.min.y;
  const len = Math.min(maxShadowLen, h / Math.max(dir.y, 0.05)); // shadow of the box top reaches this far along -dir
  for (let i = 0; i < 16; i++) {
    _v.set(i & 1 ? box3.max.x : box3.min.x, i & 2 ? box3.max.y : box3.min.y, i & 4 ? box3.max.z : box3.min.z);
    if (i >= 8) _v.addScaledVector(dir, -len * (h > 0 ? (_v.y - box3.min.y) / h : 0)); // top corners' shadow tips
    const px = _v.dot(_x), py = _v.dot(_y), pz = _v.dot(_z);
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz);
  }
  const ext = Math.max(x1 - x0, y1 - y0) + margin * 2;
  const texel = ext / size;
  const cx = Math.floor((x0 + x1) * 0.5 / texel) * texel;
  const cy = Math.floor((y0 + y1) * 0.5 / texel) * texel;
  const zTop = z1 + margin, depth = z1 - z0 + margin * 2;
  _c.copy(_x).multiplyScalar(cx).addScaledVector(_y, cy);
  light.position.copy(_c).addScaledVector(_z, zTop);
  light.target.position.copy(_c).addScaledVector(_z, z0 - margin);
  light.updateMatrixWorld(); light.target.updateMatrixWorld();
  const cam = light.shadow.camera;
  cam.left = -ext / 2; cam.right = ext / 2; cam.bottom = -ext / 2; cam.top = ext / 2;
  cam.near = 0.0; cam.far = depth;
  cam.updateProjectionMatrix();
  light.shadow.bias = -0.00002 * (200 / Math.max(depth, 1));
  light.shadow.normalBias = texel * 1.0;
  light.castShadow = true;
  pcssData[0] = depth; pcssData[1] = ext; pcssData[3] = 1;
  return { ext, depth, texel };
}

// Shadow rendering schedule (core sets shadowMap.autoUpdate = false).
//   mode 'static': render on the first frames and whenever invalidate() is called (moving the sun, spawning level)
//   mode 'dynamic': every `every` frames (2 = a proven cadence) for moving casters
export function createShadowScheduler(G, { mode = 'static', every = 2 } = {}) {
  let pending = 3; // a few frames: textures/instances may finish uploading after the first one
  const api = {
    mode, every,
    invalidate(frames = 1) { pending = Math.max(pending, frames); },
    update() {
      // read renderer.shadowMap every frame: three REPLACES that object on a context restore
      const sm = G.renderer.shadowMap;
      if (delay > 0 && --delay === 0) pending = Math.max(pending, 3);
      if (api.mode === 'dynamic' && G.frame % Math.max(1, api.every) === 0) sm.needsUpdate = true;
      if (pending > 0) { sm.needsUpdate = true; pending--; }
    },
    dispose() { G.off('update', api.update); G.off('contextrestored', onRestore); },
  };
  // a restored GL context has an empty shadow map: re-render it (static mode would never refill it)
  let delay = 0;
  const onRestore = () => { delay = 2; };
  G.on('update', api.update);
  G.on('contextrestored', onRestore);
  return api;
}

// Union of world AABBs of shadow casters under root (for fitSunShadow).
export function casterBounds(root, out = new Box3()) {
  out.makeEmpty();
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isMesh && o.castShadow && o.name !== 'sky') out.expandByObject(o); });
  return out;
}
