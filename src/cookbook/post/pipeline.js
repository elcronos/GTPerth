// HDR post-processing chain (no EffectComposer). See post/README.md for the API and tuning.
//   import { createPost } from './post/pipeline.js';
//   const post = createPost(G, { overlay: { scene: vmScene, camera: vmCam } });   // sets G.post + G.render
// Order: scene (HalfFloat, MSAA, DepthTexture) -> [overlay] -> [full-res linear depth zFull] -> [post.transparent
//   + 'posttransparent' event, depth-tested into the HDR target] -> half-res linear depth -> SSAO + bilateral blur
//   -> volumetric shafts (shadow-map ray-march; with lighting/atmos installed only the shadowed-sun correction)
//   + bilateral blur -> composite (joint-bilateral upsample) -> [camera motion blur]
//   -> bloom down chain (Karis 1st) -> eye-adaptation meter -> bloom tent up chain -> [streak]
//   -> tonemap mix(ACES,AgX) + grade -> [final hooks: rain lens] FXAA 3.11 + sharpen + grain + TPDF dither -> canvas.
// URL: ?post=0 (plain ACES bypass), ?ao=0, ?vol=0, ?bloom=0, ?streak=1, ?mb=0|1, ?rainlens=<amount>.
import {
  WebGLRenderTarget, DepthTexture, DataTexture, HalfFloatType, UnsignedByteType, UnsignedIntType, FloatType,
  RGBAFormat, RedFormat, LinearFilter, NearestFilter, Vector2, Vector3, Color, Matrix4, Scene,
} from 'three';
import { createFullscreen, fsMaterial } from './fullscreen.js';
import { patchUniforms } from '../engine/patch.js';
import {
  DEPTH_HALF, DEPTH_FULL, SSAO, BILATERAL, VOLUME, COMPOSITE, MOTION, BLOOM_DOWN, BLOOM_UP, STREAK, ADAPT, DIRT, TONEMAP,
  finalFrag, BYPASS, DEBUG,
} from './shaders.js';

// Per-tier costs. AO off on low (biggest fill-rate saver after MSAA).
export const POST_TIERS = {
  low:   { msaa: 0, ao: false, aoTaps: 8,  volSteps: 16 },
  med:   { msaa: 2, ao: true,  aoTaps: 8,  volSteps: 16 },
  high:  { msaa: 4, ao: true,  aoTaps: 12, volSteps: 20 },
  ultra: { msaa: 4, ao: true,  aoTaps: 16, volSteps: 24 },
};

// Defaults used when the game's ART omits a field (matches CONTRACT.md's example ART).
const DEF = {
  fog: { scatter: [0.75, 0.62, 0.52], heightFalloff: 0.08, baseHeight: 0.0 },
  vol: { density: 0.020, g: 0.60, steps: 20, strength: 1.0 },
  ambient: { skyIntensity: 1.6 },
  grade: { exposure: 1.0, agxMix: 0.25, lookPower: 1.15, sat: 1.18, contrast: 0.18,
    splitShadow: [0.92, 1.0, 1.08], splitHigh: [1.06, 1.0, 0.92], vignette: 0.30,
    bloom: 0.065, bloomThreshold: 1.2, lensDirt: 0.4, chroma: 0.0015, grain: 0.022, sharpen: 0.25,
    adaptMin: 0.6, adaptMax: 2.0, adaptTau: 1.5 },
};

const BLOOM_LEVELS = 6;

export function createPost(G, opts = {}) {
  const R = G.renderer, gl = R.getContext(), A = G.ART || {}, url = G.params;
  const grade = { ...DEF.grade, ...(A.grade || {}) }, fog = { ...DEF.fog, ...(A.fog || {}) };
  const vol = { ...DEF.vol, ...(A.vol || {}) }, amb = { ...DEF.ambient, ...(A.ambient || {}) };
  const off = (k) => url.get(k) === '0';
  const shot = !!url.get('shot');
  // lighting/atmos.js registers these shared uniforms; when present the volumetrics only add the shadowing
  const atmosNow = () => !!(patchUniforms.uFogSigma && patchUniforms.uFogStart && patchUniforms.uSunColor);
  const mbOpt = opts.motionBlur === true ? 0.5 : +opts.motionBlur || 0;

  // ---- live knobs (mutate at runtime; read every frame). Initialised from ART.
  const params = {
    enabled: !off('post'), ao: !off('ao'), vol: !off('vol'), bloom: !off('bloom'),
    streak: url.get('streak') === '1' || !!opts.streak, fxaa: true, adapt: true,
    exposure: grade.exposure,
    // eye adaptation: exposure = clamp(adaptKey / avgLum, adaptMin, adaptMax) * exposure
    adaptKey: opts.adaptKey ?? 0.20, adaptMin: grade.adaptMin, adaptMax: grade.adaptMax, adaptTau: grade.adaptTau,
    // SSAO (metres)
    aoRadius: 0.9, aoIntensity: 2.6, aoBias: 0.06, aoStrength: 1.0,
    // volumetrics: density per metre at baseHeight, exp height falloff, HG g, march length
    // ART.vol.density is the sea-level scattering coefficient; 0.55x keeps CONTRACT's 0.020 from going milky
    volDensity: vol.density * 0.55, volG: vol.g, volStrength: vol.strength, volFalloff: fog.heightFalloff,
    volBase: fog.baseHeight, volMaxDist: opts.volMaxDist ?? 80, volExtinction: 0.5,
    // with lighting/atmos the analytic fog already has the ambient haze: volAmbient 0 (and it is ignored there)
    volAmbient: atmosNow() ? 0 : 0.12, volScatter: fog.scatter.slice(),
    // volMode 'auto' = atmos when installAtmos() ran (shared uFog* uniforms), else 'standalone'
    // volShaft (atmos mode): 1 = physically exact shadowing of the analytic sun in-scatter, >1 deeper shafts
    volMode: opts.volMode || 'auto', volShaft: 1.0,
    // camera motion blur: shutter fraction of the frame's reprojected motion (0 = off), cap in render pixels
    motionBlur: url.get('mb') === '1' ? (mbOpt || 0.5) : off('mb') ? 0 : mbOpt, motionBlurMax: 40,
    // rain-lens drops in the final pass (needs opts.rainLensGLSL = RAIN_LENS_GLSL from weather/rain.js)
    rainLens: url.get('rainlens') ? +url.get('rainlens') : (opts.rainLens ?? 0),
    // force the current-frame full-res linear depth (targets.zFull) even when post.transparent is empty
    zFull: !!opts.zFull,
    // bloom: mix weight of the wide veil + thresholded hot part (glow, dirt, streak)
    bloomStrength: grade.bloom, bloomThreshold: grade.bloomThreshold, bloomKnee: 0.6, bloomScatter: 0.72,
    hotGlow: 0.05, lensDirt: grade.lensDirt, streakStrength: 0.35, streakThreshold: 2.2,
    // tonemap + grade
    agxMix: grade.agxMix, lookPower: grade.lookPower, sat: grade.sat, contrast: grade.contrast,
    splitShadow: grade.splitShadow.slice(), splitHigh: grade.splitHigh.slice(), vignette: grade.vignette,
    chroma: grade.chroma, grain: grade.grain, sharpen: grade.sharpen,
  };

  const fs = createFullscreen(R);
  const rt = (o = {}) => new WebGLRenderTarget(4, 4, {
    type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false, ...o,
  });
  const near = { minFilter: NearestFilter, magFilter: NearestFilter };
  const tex1 = (r, g, b, a) => { const t = new DataTexture(new Uint8Array([r, g, b, a]), 1, 1, RGBAFormat, UnsignedByteType); t.needsUpdate = true; return t; };
  const WHITE = tex1(255, 255, 255, 255), BLACK = tex1(0, 0, 0, 0), NOVOL = tex1(0, 0, 0, 255);

  // ---- targets
  const depthTex = new DepthTexture(4, 4, UnsignedIntType);
  const sceneRT = rt({ depthBuffer: true, depthTexture: depthTex, samples: 4 });
  const comp = rt(), ldr = rt();
  const zHalf = rt({ format: RedFormat, type: FloatType, ...near }); // R32F: half floats staircase planes at 10 m+ (AO ripples)
  const zFull = rt({ format: RedFormat, type: FloatType, ...near }); // current-frame full-res linear depth (after opaque)
  const mbRT = rt(); // motion-blurred HDR (only allocated at size when motion blur runs)
  const aoA = rt({ format: RedFormat, ...near }), aoB = rt({ format: RedFormat, ...near });
  const volA = rt(near), volB = rt(near);
  const down = [], up = [];
  for (let i = 0; i < BLOOM_LEVELS; i++) down.push(rt());
  for (let i = 0; i < BLOOM_LEVELS - 1; i++) up.push(rt());
  const streakA = rt(), streakB = rt();
  const adapt = [rt({ ...near, type: FloatType }), rt({ ...near, type: FloatType })];
  adapt[0].setSize(1, 1); adapt[1].setSize(1, 1);
  const dirt = rt({ type: UnsignedByteType }); dirt.setSize(512, 288);

  // ---- materials (one per pass; uniforms hold references where possible so per-frame work is scalar copies)
  const nf = new Vector2(), tanH = new Vector2(), half = new Vector2(), full = new Vector2();
  const mDepth = fsMaterial(DEPTH_HALF, { tDepth: { value: depthTex }, uNF: { value: nf } });
  const mDepthFull = fsMaterial(DEPTH_FULL, { tDepth: { value: depthTex }, uNF: { value: nf } });
  const invVP = new Matrix4(), prevVP = new Matrix4(), curVP = new Matrix4();
  let mbReset = true;
  const mMotion = fsMaterial(MOTION, {
    tSrc: { value: comp.texture }, tDepth: { value: depthTex }, uInvVP: { value: invVP }, uPrevVP: { value: prevVP },
    uNF: { value: nf }, uTexel: { value: new Vector2() }, uScale: { value: 0 }, uMaxPx: { value: 40 },
  }, { MB_TAPS: 8 });
  const mAO = fsMaterial(SSAO, {
    tZ: { value: zHalf.texture }, uRes: { value: half }, uTanH: { value: tanH }, uFar: { value: 1000 },
    uRadius: { value: 0.7 }, uIntensity: { value: 1 }, uBias: { value: 0.1 },
  }, { AO_TAPS: 12 });
  const mBlur = fsMaterial(BILATERAL, { tSrc: { value: null }, tZ: { value: zHalf.texture }, uDir: { value: new Vector2() }, uDepthK: { value: 0.05 } });
  const sunCol = new Color(), ambCol = new Color();
  const light = G.sun && G.sun.light;
  const mVol = fsMaterial(VOLUME, {
    tZ: { value: zHalf.texture }, tShadow: { value: WHITE }, uShadowM: { value: light ? light.shadow.matrix : null },
    uCamWorld: { value: G.camera.matrixWorld }, uRes: { value: half }, uTanH: { value: tanH }, uFar: { value: 1000 },
    uSunDir: { value: G.sun ? G.sun.dir : new Vector3(0, 1, 0) }, uSunCol: { value: sunCol }, uAmb: { value: ambCol },
    uDensity: { value: 0.02 }, uFalloff: { value: 0.08 }, uBase: { value: 0 }, uG: { value: 0.6 }, uMaxD: { value: 90 },
    uExt: { value: 1 }, uShadowOn: { value: 0 },
    // atmos mode: bound to lighting/atmos.js's shared uniform objects on first use (live updates, no copies)
    uAtm: { value: 0 }, uShaft: { value: 1 }, uFogSigma: { value: new Vector3() }, uFogFalloff: { value: 0 },
    uFogBase: { value: 0 }, uFogStart: { value: 0 }, uFogSunInscatter: { value: 0 }, uAtmSun: { value: new Vector3() },
  }, { VOL_STEPS: 20 });
  function bindAtmos() {
    const u = mVol.uniforms, a = patchUniforms;
    if (u.uFogSigma === a.uFogSigma) return;
    u.uFogSigma = a.uFogSigma; u.uFogFalloff = a.uFogFalloff; u.uFogBase = a.uFogBase;
    u.uFogStart = a.uFogStart; u.uFogSunInscatter = a.uFogSunInscatter; u.uAtmSun = a.uSunColor;
  }
  const adaptClamp = new Vector2();
  const mComp = fsMaterial(COMPOSITE, {
    tColor: { value: sceneRT.texture }, tDepth: { value: depthTex }, tZ: { value: zHalf.texture },
    tAO: { value: WHITE }, tVol: { value: NOVOL }, tAdapt: { value: adapt[0].texture },
    uNF: { value: nf }, uHalf: { value: half }, uAO: { value: 1 }, uVol: { value: 1 },
    uAdaptKey: { value: 0.2 }, uAdaptClamp: { value: adaptClamp },
  });
  const thresh = new Vector3();
  const mDown = fsMaterial(BLOOM_DOWN, { tSrc: { value: null }, uTexel: { value: new Vector2() }, uFirst: { value: 0 }, uThresh: { value: thresh } });
  const mUp = fsMaterial(BLOOM_UP, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new Vector2() }, uScatter: { value: 0.7 } });
  const mStreak = fsMaterial(STREAK, { tSrc: { value: null }, uTexel: { value: new Vector2() }, uStride: { value: 1 }, uFirst: { value: 0 }, uThresh: { value: 2.2 } });
  const mAdapt = fsMaterial(ADAPT, { tSrc: { value: null }, tPrev: { value: null }, uRate: { value: 0 }, uReset: { value: 1 } });
  const splitS = new Vector3(), splitH = new Vector3();
  const mTone = fsMaterial(TONEMAP, {
    tComp: { value: comp.texture }, tBloom: { value: BLACK }, tAdapt: { value: adapt[0].texture }, tDirt: { value: dirt.texture },
    tStreak: { value: BLACK }, uExposure: { value: 1 }, uAdaptOn: { value: 1 }, uAdaptKey: { value: 0.2 }, uAdaptClamp: { value: adaptClamp },
    uBloom: { value: 0 }, uHot: { value: 0 }, uDirt: { value: 0 }, uStreak: { value: 0 }, uAgx: { value: 0.25 }, uLook: { value: 1 },
    uSat: { value: 1 }, uContrast: { value: 0 }, uSplitS: { value: splitS }, uSplitH: { value: splitH }, uVig: { value: 0 },
    uChroma: { value: 0 }, uAspect: { value: 1 },
  });
  // final-pass hooks (compile time). opts.rainLensGLSL = RAIN_LENS_GLSL (weather/rain.js) adds the lens drops,
  // driven by params.rainLens; opts.finalHooks = [{ decl, uv, color, uniforms }] for anything else.
  const hooks = [...(opts.finalHooks || [])];
  const uRainLens = { value: 0 };
  if (opts.rainLensGLSL) hooks.push({
    decl: opts.rainLensGLSL + '\nuniform float uRainLens;',
    // drops refract (offset the lookup) and darken slightly; the branch costs nothing when dry
    uv: 'if (uRainLens > 0.0) { vec3 rl = rainLens(uv, uTime, uRainLens, uAspect); uv += rl.xy; rainDim = 1.0 - 0.15 * rl.z; }',
    color: 'col *= rainDim;',
    pre: 'float rainDim = 1.0;',
    uniforms: { uRainLens },
  });
  const finalU = { tSrc: { value: ldr.texture }, uTexel: { value: new Vector2() }, uFxaa: { value: 1 }, uSharpen: { value: 0 }, uGrain: { value: 0 }, uSeed: { value: 0 }, uAspect: { value: 16 / 9 }, uTime: { value: 0 } };
  for (const h of hooks) Object.assign(finalU, h.uniforms || {});
  const mFinal = fsMaterial(finalFrag(hooks), finalU);
  const mDebug = fsMaterial(DEBUG, { tSrc: { value: null }, uMode: { value: 0 } });
  const DBG = { ao: 1, vol: 2, depth: 3, bloom: 4, trans: 5, zfull: 6 };
  const dbg = DBG[url.get('postdbg')] || 0; // ?postdbg=ao|vol|trans|depth|bloom|zfull shows that buffer instead of the frame
  if (dbg === 6) params.zFull = true;
  const mBypass = fsMaterial(BYPASS, { tColor: { value: sceneRT.texture }, uExposure: { value: 1 } });

  // lens dirt is static: bake once
  const mDirt = fsMaterial(DIRT, { uAspect: { value: new Vector2(16 / 9, 1) } });
  fs.pass(mDirt, dirt); R.setRenderTarget(null); mDirt.dispose();

  // ---- quality tiers
  let tier = POST_TIERS.high;
  function applyQuality() {
    tier = POST_TIERS[G.quality.tier] || POST_TIERS.high;
    const steps = G.quality.tier === 'high' ? Math.max(16, vol.steps | 0) : tier.volSteps;
    if (sceneRT.samples !== tier.msaa) { sceneRT.samples = tier.msaa; sceneRT.dispose(); }
    if (mAO.defines.AO_TAPS !== tier.aoTaps) { mAO.defines.AO_TAPS = tier.aoTaps; mAO.needsUpdate = true; }
    if (mVol.defines.VOL_STEPS !== steps) { mVol.defines.VOL_STEPS = steps; mVol.needsUpdate = true; }
  }
  applyQuality();
  G.on('quality', applyQuality);

  // ---- sizing (render resolution = CSS size * dpr * dynres scale; final pass upscales to the canvas)
  let fw = 0, fh = 0, hw = 0, hh = 0;
  const overlay = opts.overlay || null;
  function setSize(w, h) {
    fw = Math.max(8, w | 0); fh = Math.max(8, h | 0);
    hw = Math.max(4, Math.ceil(fw / 2)); hh = Math.max(4, Math.ceil(fh / 2));
    sceneRT.setSize(fw, fh); comp.setSize(fw, fh); ldr.setSize(fw, fh);
    if (zFull.width > 4) zFull.setSize(fw, fh);
    if (mbRT.width > 4) mbRT.setSize(fw, fh);
    mMotion.uniforms.uTexel.value.set(1 / fw, 1 / fh);
    finalU.uAspect.value = fw / fh;
    for (const t of [zHalf, aoA, aoB, volA, volB]) t.setSize(hw, hh);
    let lw = hw, lh = hh;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      down[i].setSize(lw, lh); if (i < BLOOM_LEVELS - 1) up[i].setSize(lw, lh);
      lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
    }
    streakA.setSize(down[1].width, down[1].height); streakB.setSize(down[1].width, down[1].height);
    half.set(hw, hh); full.set(fw, fh);
    mFinal.uniforms.uTexel.value.set(1 / fw, 1 / fh);
    mTone.uniforms.uAspect.value = fw / fh;
    if (overlay && overlay.camera.isPerspectiveCamera) { overlay.camera.aspect = fw / fh; overlay.camera.updateProjectionMatrix(); }
  }
  function autoSize() {
    const s = G.quality.scale || 1;
    const w = Math.max(8, Math.round(G.width * G.dpr * s)), h = Math.max(8, Math.round(G.height * G.dpr * s));
    if (w !== fw || h !== fh) setSize(w, h);
  }

  let frames = 0, transCount = 0;
  const transparent = new Scene();
  transparent.name = 'post.transparent';
  function bilateral(src, tmp, k) {
    mBlur.uniforms.uDepthK.value = k;
    mBlur.uniforms.tSrc.value = src.texture; mBlur.uniforms.uDir.value.set(1, 0); fs.pass(mBlur, tmp);
    mBlur.uniforms.tSrc.value = tmp.texture; mBlur.uniforms.uDir.value.set(0, 1); fs.pass(mBlur, src);
  }

  function render() {
    G.emit('prerender');
    autoSize();
    const cam = G.camera, P = params;
    const autoClear = R.autoClear;
    R.autoClear = false;

    // 1) scene into HDR MSAA target (+ depth texture, resolved by three on the next target switch)
    R.setRenderTarget(sceneRT);
    R.clear(true, true, false);
    R.render(G.scene, cam);
    // 2) first-person overlay: its own camera, drawn into the first 5% of the depth range. This is a
    //    "depth clear" that keeps world depth intact for AO/volumetrics (gun pixels read as ~5 cm away).
    if (overlay) {
      gl.depthRange(0, 0.05);
      R.render(overlay.scene, overlay.camera);
      gl.depthRange(0, 1);
    }
    const pe = cam.projectionMatrix.elements;
    nf.set(cam.near, cam.far); tanH.set(1 / pe[0], 1 / pe[5]);
    // 2b) after-opaque: current-frame full-res linear depth, then transparent/soft particles depth-tested into the
    //     HDR target. Switching to zFull resolves MSAA colour + depth, so the particles can sample zFull while
    //     drawing into sceneRT with no feedback loop (true on low tier too, where depthTex is attached to sceneRT).
    const hasTrans = transparent.children.length > 0 || transCount > 0;
    if (hasTrans || P.zFull) {
      if (zFull.width !== fw || zFull.height !== fh) zFull.setSize(fw, fh);
      fs.pass(mDepthFull, zFull);
    }
    if (hasTrans) {
      R.setRenderTarget(sceneRT);
      G.emit('posttransparent', R, cam, api);
      if (transparent.children.length) R.render(transparent, cam);
    }

    if (!P.enabled) {
      mBypass.uniforms.uExposure.value = P.exposure;
      fs.pass(mBypass, null);
      mbReset = true;
      R.autoClear = autoClear; frames++;
      return;
    }

    fs.pass(mDepth, zHalf);

    // 3) SSAO
    const doAO = P.ao && tier.ao;
    if (doAO) {
      const u = mAO.uniforms;
      u.uFar.value = cam.far; u.uRadius.value = P.aoRadius; u.uIntensity.value = P.aoIntensity; u.uBias.value = P.aoBias;
      fs.pass(mAO, aoA);
      bilateral(aoA, aoB, 0.04);
    }

    // 4) volumetric shafts
    const useAtm = P.volMode !== 'standalone' && atmosNow();
    const doVol = P.vol && (useAtm ? P.volShaft > 0 : P.volDensity > 0);
    if (doVol) {
      const u = mVol.uniforms, sh = light && light.shadow;
      if (useAtm) bindAtmos();
      u.uAtm.value = useAtm ? 1 : 0; u.uShaft.value = P.volShaft;
      const map = sh && sh.map;
      u.tShadow.value = map ? map.texture : WHITE;
      u.uShadowOn.value = map && light.castShadow ? 1 : 0;
      u.uFar.value = cam.far;
      sunCol.copy(G.sun.color).multiplyScalar(G.sun.intensity * P.volStrength);
      const ai = amb.skyIntensity * P.volAmbient * P.volStrength;
      ambCol.setRGB(P.volScatter[0] * ai, P.volScatter[1] * ai, P.volScatter[2] * ai);
      u.uDensity.value = P.volDensity; u.uFalloff.value = P.volFalloff; u.uBase.value = P.volBase;
      u.uG.value = P.volG; u.uMaxD.value = Math.min(P.volMaxDist, cam.far); u.uExt.value = P.volExtinction;
      fs.pass(mVol, volA);
      bilateral(volA, volB, 0.06);
    }

    // 5) composite
    adaptClamp.set(P.adaptMin, P.adaptMax);
    {
      const u = mComp.uniforms;
      u.tAO.value = doAO ? aoA.texture : WHITE; u.uAO.value = doAO ? P.aoStrength : 0;
      u.tVol.value = doVol ? volA.texture : NOVOL; u.uVol.value = doVol ? 1 : 0;
      u.uAdaptKey.value = P.adaptKey;
      if (!P.adapt) adaptClamp.set(1, 1); // adapt off -> AO judges raw brightness (exposure 1)
      u.tAdapt.value = adapt[frames & 1].texture;
      fs.pass(mComp, comp);
    }

    // 5b) camera motion blur (off by default): reproject depth with last frame's view-projection
    let hdr = comp;
    curVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    if (mbReset) { prevVP.copy(curVP); mbReset = false; }
    if (P.motionBlur > 0) {
      if (mbRT.width !== fw || mbRT.height !== fh) mbRT.setSize(fw, fh);
      invVP.copy(curVP).invert();
      const u = mMotion.uniforms;
      u.uScale.value = P.motionBlur; u.uMaxPx.value = P.motionBlurMax;
      fs.pass(mMotion, mbRT);
      hdr = mbRT;
    }
    prevVP.copy(curVP);
    mTone.uniforms.tComp.value = hdr.texture;

    // 6) bloom down chain (always run: the adaptation meter reads level 2)
    thresh.set(P.bloomThreshold, Math.max(1e-3, P.bloomKnee * P.bloomThreshold), 0);
    {
      const u = mDown.uniforms;
      let src = hdr;
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        u.tSrc.value = src.texture; u.uTexel.value.set(1 / src.width, 1 / src.height); u.uFirst.value = i === 0 ? 1 : 0;
        fs.pass(mDown, down[i]);
        src = down[i];
      }
    }

    // 7) eye adaptation (1x1 ping-pong; exponential approach with time constant tau)
    {
      const u = mAdapt.uniforms, cur = adapt[frames & 1], nxt = adapt[(frames + 1) & 1];
      u.tSrc.value = down[2].texture; u.tPrev.value = cur.texture;
      u.uRate.value = 1 - Math.exp(-G.dt / Math.max(0.01, P.adaptTau));
      u.uReset.value = frames < 2 ? 1 : 0;
      fs.pass(mAdapt, nxt);
      mTone.uniforms.tAdapt.value = nxt.texture;
    }

    // 8) bloom up chain
    if (P.bloom) {
      const u = mUp.uniforms;
      u.uScatter.value = P.bloomScatter;
      for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
        const low = i === BLOOM_LEVELS - 2 ? down[BLOOM_LEVELS - 1] : up[i + 1];
        u.tLow.value = low.texture; u.tHigh.value = down[i].texture; u.uTexel.value.set(1 / low.width, 1 / low.height);
        fs.pass(mUp, up[i]);
      }
    }

    // 9) anamorphic streak (optional): threshold + 3 horizontal passes, stride 1 -> 4 -> 16
    const doStreak = P.bloom && P.streak && P.streakStrength > 0;
    if (doStreak) {
      const u = mStreak.uniforms;
      u.uThresh.value = P.streakThreshold;
      u.uTexel.value.set(1 / streakA.width, 1 / streakA.height);
      u.tSrc.value = down[1].texture; u.uStride.value = 1; u.uFirst.value = 1; fs.pass(mStreak, streakA);
      u.tSrc.value = streakA.texture; u.uStride.value = 4; u.uFirst.value = 0; fs.pass(mStreak, streakB);
      u.tSrc.value = streakB.texture; u.uStride.value = 16; fs.pass(mStreak, streakA);
    }

    // 10) tonemap + grade
    {
      const u = mTone.uniforms;
      u.tBloom.value = P.bloom ? up[0].texture : BLACK;
      u.tStreak.value = doStreak ? streakA.texture : BLACK;
      u.uExposure.value = P.exposure; u.uAdaptOn.value = P.adapt ? 1 : 0; u.uAdaptKey.value = P.adaptKey;
      u.uBloom.value = P.bloom ? P.bloomStrength : 0; u.uHot.value = P.bloom ? P.hotGlow : 0;
      u.uDirt.value = P.bloom ? P.lensDirt : 0; u.uStreak.value = doStreak ? P.streakStrength : 0;
      u.uAgx.value = P.agxMix; u.uLook.value = P.lookPower; u.uSat.value = P.sat; u.uContrast.value = P.contrast;
      splitS.fromArray(P.splitShadow); splitH.fromArray(P.splitHigh);
      u.uVig.value = P.vignette; u.uChroma.value = P.chroma;
      fs.pass(mTone, ldr);
    }

    if (dbg) {
      mDebug.uniforms.uMode.value = dbg === 6 ? 3 : dbg;
      mDebug.uniforms.tSrc.value = (dbg === 1 ? aoA : dbg === 2 || dbg === 5 ? volA : dbg === 3 ? zHalf : dbg === 6 ? zFull : up[0]).texture;
      fs.pass(mDebug, null); R.autoClear = autoClear; frames++; return;
    }
    // 11) final to canvas
    {
      const u = mFinal.uniforms;
      u.uFxaa.value = P.fxaa ? 1 : 0; u.uSharpen.value = P.sharpen; u.uGrain.value = P.grain;
      u.uSeed.value = shot ? 0 : (frames % 997); // frozen grain under ?shot so shimmer heatmaps show real instability
      u.uTime.value = G.t || 0; uRainLens.value = opts.rainLensGLSL ? Math.max(0, P.rainLens) : 0;
      fs.pass(mFinal, null);
    }

    R.autoClear = autoClear;
    frames++;
  }

  function dispose() {
    for (const t of [sceneRT, comp, ldr, zHalf, zFull, mbRT, aoA, aoB, volA, volB, streakA, streakB, dirt, ...adapt, ...down, ...up]) t.dispose();
    for (const m of [mDepth, mDepthFull, mAO, mBlur, mVol, mComp, mMotion, mDown, mUp, mStreak, mAdapt, mTone, mFinal, mBypass, mDebug]) m.dispose();
    depthTex.dispose(); WHITE.dispose(); BLACK.dispose(); NOVOL.dispose(); fs.dispose();
    if (G.render === render) G.render = null;
    if (G.post === api) G.post = null;
  }

  const api = {
    render, setSize, params, dispose,
    resetAdaptation() { frames = 0; mbReset = true; },  // also call after a camera cut (no motion-blur smear)
    resetMotion() { mbReset = true; },
    // after-opaque pass: objects added here are drawn into the HDR target after opaque (+overlay), depth-tested
    // against the scene depth, with targets.zFull already holding this frame's linear depth (soft particles).
    // Use depthWrite:false materials; they get no shadows/lights from G.scene (custom-lit / unlit / additive).
    transparent,
    // for a 'posttransparent' listener (G.on('posttransparent', (renderer, camera, post) => ...)): call this once
    // so the pass runs even with an empty post.transparent; the listener draws with sceneRT bound
    useTransparentEvent() { transCount++; },
    get atmosVol() { return params.volMode !== 'standalone' && atmosNow(); },
    // exposed so other systems can read the frame (e.g. water refraction reads targets.scene.depthTexture)
    // zFull: R32F full-res linear depth (metres) of THIS frame's opaque scene; valid when post.transparent is
    // non-empty, useTransparentEvent() was called or params.zFull is true (otherwise it is not refreshed)
    targets: { scene: sceneRT, depth: depthTex, comp, ldr, zHalf, zFull, ao: aoA, vol: volA, bloomDown: down, bloomUp: up, adapt },
  };
  G.post = api;
  G.render = render;
  return api;
}
