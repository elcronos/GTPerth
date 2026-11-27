// Planar reflection for a horizontal plane (wet ground puddles, calm water).
// Technique: mirror the main camera about the plane y = height, replace the near plane of the mirrored
// projection by the reflection plane itself (Lengyel's oblique near-plane clipping, so nothing below the
// plane leaks into the mirror), render the scene into a half-res, mip-mapped HalfFloat target, and hand
// shaders a matrix that maps a world point to its UV in that target. Mips are what make roughness-driven
// blur cheap: a damp surface samples mip 3-6, a puddle mip 0-1.
//
//   const refl = createPlanarReflection(G, { height: 0, hide: [groundMesh] });
//   patchGround(groundMat, { mask, refl });      // ground.js consumes refl.uniforms
//   // rendering: runs on G.emit('prerender') (post pipeline). If no 'prerender' arrived in the previous frame,
//   // it renders itself at the end of 'update' — i.e. it always works, with or without a post pipeline.
//
// Quality: off on 'low' (shaders fall back to env reflections), 0.5x on 'med'/'high', 1x on 'ultra'.
// Objects with userData.noReflect = true (direct children of the scene) and everything in `hide` are hidden
// during the mirrored pass (particles, the reflecting surface itself, first-person weapon ...).
import {
  WebGLRenderTarget, HalfFloatType, RGBAFormat, LinearFilter, LinearMipmapLinearFilter, PerspectiveCamera,
  Matrix4, Vector3, Vector4, Plane, Vector2, LinearSRGBColorSpace, DataTexture,
} from 'three';

const TIER_SCALE = { low: 0, med: 0.5, high: 0.5, ultra: 1.0 };
const TIER_MSAA = { low: 0, med: 0, high: 4, ultra: 4 };

// scratch (module scope: zero allocations per frame)
const _camPos = new Vector3(), _fwd = new Vector3(), _up = new Vector3(), _tgt = new Vector3();
const _plane = new Plane(), _clip = new Vector4(), _q = new Vector4(), _size = new Vector2(), _rot = new Matrix4();
// maps clip space [-1,1] to texture space [0,1]
const BLACK = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;
const BIAS = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

export function createPlanarReflection(G, opts = {}) {
  const o = { height: 0, hide: [], clipBias: 0.0, scale: null, ...opts };
  const cam = new PerspectiveCamera();
  cam.matrixAutoUpdate = true;
  const target = new WebGLRenderTarget(16, 16, {
    type: HalfFloatType, format: RGBAFormat, colorSpace: LinearSRGBColorSpace,
    minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, generateMipmaps: true,
    depthBuffer: true, stencilBuffer: false, samples: 0,
  });
  target.texture.name = 'planarReflection';

  // shared with every shader that reads the reflection (ground.js, sea.js)
  const uniforms = {
    uReflTex: { value: target.texture },
    uReflMat: { value: new Matrix4() },  // world -> reflection UV (projective: divide xy by w)
    uReflOn: { value: 0 },               // 0 = disabled this frame → shaders keep env radiance
    uReflLod: { value: 0 },              // log2(targetHeight/540): keeps blur width constant in screen px
  };

  const hidden = [], wasVisible = [];
  let lastFrame = -1, lastPrerender = -10;
  const api = { target, camera: cam, uniforms, enabled: true, height: o.height, active: false, hide: o.hide };

  function tierScale() {
    if (o.scale != null) return o.scale;
    return TIER_SCALE[G.quality.tier] ?? 0.5;
  }

  api.update = function update() {
    if (lastFrame === G.frame) return;        // at most once per frame
    lastFrame = G.frame;
    const s = tierScale();
    const main = G.camera;
    main.updateMatrixWorld();
    _camPos.setFromMatrixPosition(main.matrixWorld);
    // disabled, or camera under the plane (looking at the underside): no reflection
    if (!api.enabled || s <= 0 || _camPos.y <= api.height + 0.01) { uniforms.uReflOn.value = 0; api.active = false; return; }

    // size: fraction of the actual drawing buffer (follows dynres), rounded to keep mips well-formed
    G.renderer.getDrawingBufferSize(_size);
    const ds = G.quality.scale || 1;
    const w = Math.max(64, Math.round((_size.x * ds * s) / 8) * 8), h = Math.max(32, Math.round((_size.y * ds * s) / 8) * 8);
    const msaa = TIER_MSAA[G.quality.tier] ?? 0;
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    if (target.samples !== msaa) { target.samples = msaa; target.dispose(); }

    // --- mirrored camera: reflect position, forward target and up vector about y = height
    const H = api.height;
    _rot.extractRotation(main.matrixWorld);
    _fwd.set(0, 0, -1).applyMatrix4(_rot);
    _up.set(0, 1, 0).applyMatrix4(_rot);
    _tgt.copy(_camPos).add(_fwd);
    cam.position.set(_camPos.x, 2 * H - _camPos.y, _camPos.z);
    cam.up.set(_up.x, -_up.y, _up.z);
    cam.lookAt(_tgt.x, 2 * H - _tgt.y, _tgt.z);
    cam.near = main.near; cam.far = main.far;
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    cam.projectionMatrix.copy(main.projectionMatrix);

    // texture matrix uses the un-modified xy/w rows (the oblique trick only changes the z row)
    uniforms.uReflMat.value.copy(BIAS).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // --- oblique near plane = reflection plane (in mirrored-camera view space). Keeps everything below
    // the plane (the ground's underside, the sea bed, the quay wall below water...) out of the mirror.
    _plane.set(_up.set(0, 1, 0), -H - o.clipBias);
    _plane.applyMatrix4(cam.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const e = cam.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + e[8]) / e[0];
    _q.y = (Math.sign(_clip.y) + e[9]) / e[5];
    _q.z = -1.0;
    _q.w = (1.0 + e[10]) / e[14];
    _clip.multiplyScalar(2.0 / _clip.dot(_q));
    e[2] = _clip.x; e[6] = _clip.y; e[10] = _clip.z + 1.0; e[14] = _clip.w;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.layers.mask = main.layers.mask;

    // --- hide reflectors / particles
    hidden.length = 0;
    for (const m of api.hide) hidden.push(m);
    const ch = G.scene.children;
    for (let i = 0; i < ch.length; i++) if (ch[i].userData.noReflect) hidden.push(ch[i]);
    for (let i = 0; i < hidden.length; i++) { wasVisible[i] = hidden[i].visible; hidden[i].visible = false; }

    const r = G.renderer;
    const prevTarget = r.getRenderTarget(), prevXr = r.xr.enabled, prevShadow = r.shadowMap.autoUpdate, prevAuto = r.autoClear;
    r.xr.enabled = false; r.shadowMap.autoUpdate = false; r.autoClear = true;
    // a material visible in the mirror must not sample the target it is rendering into (GL feedback loop):
    // swap the shared uniform to a 1x1 black texture for the duration of the pass
    uniforms.uReflOn.value = 0;
    uniforms.uReflTex.value = BLACK;
    try {
      r.setRenderTarget(target);
      r.clear();
      r.render(G.scene, cam);
    } finally {
      r.setRenderTarget(prevTarget);
      r.xr.enabled = prevXr; r.shadowMap.autoUpdate = prevShadow; r.autoClear = prevAuto;
      for (let i = 0; i < hidden.length; i++) hidden[i].visible = wasVisible[i];
    }
    uniforms.uReflTex.value = target.texture;
    uniforms.uReflOn.value = 1;
    uniforms.uReflLod.value = Math.log2(h / 540);
    api.active = true;
  };

  api.setHeight = (y) => { api.height = y; };
  api.addHidden = (obj) => { if (!api.hide.includes(obj)) api.hide.push(obj); };

  // post pipeline emits 'prerender' right before the main scene render (best: camera is final)
  const onPre = () => { lastPrerender = G.frame; api.update(); };
  // fallback: no pipeline → render at the end of the update phase (after controllers moved the camera,
  // because this listener is registered late — create the reflection after your camera controller).
  const onUpd = () => { if (G.frame - lastPrerender > 1) api.update(); };
  G.on('prerender', onPre);
  G.on('update', onUpd);
  api.dispose = () => { target.dispose(); api.enabled = false; };
  return api;
}

// GLSL helper any shader can paste (after declaring the 4 uniforms above):
//   vec3 c = planarSample(worldPos + offset, lod);
export const PLANAR_GLSL = /*glsl*/`
uniform sampler2D uReflTex;
uniform mat4 uReflMat;
uniform float uReflOn;
uniform float uReflLod;
vec2 planarUV(vec3 wp) {
  vec4 c = uReflMat * vec4(wp, 1.0);
  return clamp(c.xy / max(c.w, 1e-4), vec2(0.001), vec2(0.999));
}
`;
