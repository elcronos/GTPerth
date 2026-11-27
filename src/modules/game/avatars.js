// Realistic humans: Microsoft Rocketbox avatars (MIT) embedded as meshopt-compressed GLBs. One GLB per person;
// Female_Adult_12 carries the female clip set, Male_Adult_01 the male set (same Biped skeleton, so clips are shared
// by bone name). Each instance is a SkeletonUtils clone with its own AnimationMixer.
import { AnimationClip, Vector3, Box3, Sphere, Color } from 'three';
import { patch, sharedUniform } from '../../cookbook/engine/patch.js';
import { lampReceive } from '../world/lampmap.js';
// people: a Fresnel rim (warm back-light by day, moon-blue at night) + a small night fill so the player and peds
// stay readable against dark water / paving. Driven by daycycle.js.
const uRim = sharedUniform('uCharRim', 'vec3', new Color(0, 0, 0)), uFill = sharedUniform('uCharFill', 'float', 0);
const _patched = new WeakSet();
function charPatch(m) {
  if (_patched.has(m)) return; _patched.add(m);
  patch(m, 'char-rim', (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
    totalEmissiveRadiance += uCharRim * pow(1.0 - ndv, 4.5) + max(diffuseColor.rgb, vec3(0.09)) * uCharFill; }`);
  });
}
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AVATARS } from '../../assets/avatars.js';

export const FEMALE = ['Female_Adult_12', 'Female_Adult_17', 'Female_Party_01', 'Female_Adult_01', 'Sports_Female_02'];
export const MALE = ['Male_Adult_01', 'Male_Adult_16', 'Male_Adult_09', 'Sports_Male_04', 'Business_Male_06', 'Male_Adult_17'];
export const POLICE = ['Police_Male_07', 'Police_Male_06'];
export const PLAYER_AVATAR = 'Female_Adult_12';

const b64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
// split builds ship the GLBs as files (assets/…/*.glb); single-file builds embed them as base64
const bufFor = async (s) => (/^assets\//.test(s) ? (await fetch(s)).arrayBuffer() : b64(s));

export async function loadAvatars(G, onProgress) {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const lib = {}; const names = Object.keys(AVATARS);
  let i = 0;
  for (const n of names) {
    const gltf = await loader.parseAsync(await bufFor(AVATARS[n]), '');
    const root = gltf.scene;
    let restHips = 0;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) { m.userData.noWeather = true; m.envMapIntensity = 0.85; if (m.name === 'head') m.roughness = 0.55; charPatch(m); lampReceive(m, 1.6); }
      }
      if (o.name === 'Bip01') restHips = o.getWorldPosition(new Vector3()).y;
    });
    lib[n] = { root, clips: gltf.animations, restHips, female: n.startsWith('Female') || n.includes('_Female') };
    onProgress?.(++i / names.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  // clip sets: rescale the Bip01 root position track to each avatar's hip height (bob stays, feet stay planted)
  const setF = lib.Female_Adult_12.clips, setM = lib.Male_Adult_01.clips;
  const ownerF = lib.Female_Adult_12.restHips, ownerM = lib.Male_Adult_01.restHips;
  const clipCache = new Map();
  function clipsFor(name) {
    if (clipCache.has(name)) return clipCache.get(name);
    const a = lib[name]; const src = a.female ? setF : setM; const owner = a.female ? ownerF : ownerM;
    const k = owner > 0 && a.restHips > 0 ? a.restHips / owner : 1;
    const out = {};
    for (const c of src) {
      const cc = c.clone();
      for (const t of cc.tracks) {
        if (t.name === 'Bip01.position') { const v = t.values; for (let j = 0; j < v.length; j++) v[j] *= k; }
      }
      out[shortName(c.name)] = cc;
    }
    clipCache.set(name, out);
    return out;
  }
  function instance(name) {
    const a = lib[name];
    const obj = skClone(a.root);
    obj.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.frustumCulled = true;
        o.geometry.boundingSphere = new Sphere(new Vector3(0, 90, 0), 140);   // cm (the root is scaled 0.01)
        o.castShadow = true; o.receiveShadow = true;
      }
    });
    return { obj, clips: clipsFor(name), female: a.female, name };
  }
  // warm-up list for the shader compiler: one material set of each avatar
  const warm = [];
  for (const n of names) lib[n].root.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => warm.push({ material: m, kind: 'skinned' })); });
  return { lib, instance, clipsFor, names, warm };
}

function shortName(n) {
  // f_walk_neutral_01 → walk ; f_run_neutral_01 → run ; f_run_fast_01 → sprint ; f_idle_neutral_01 → idle
  const s = n.replace(/^[fm]_/, '');
  if (/^walk_neutral/.test(s)) return 'walk';
  if (/^walk_stroll/.test(s)) return 'stroll';
  if (/^run_neutral/.test(s)) return 'run';
  if (/^run_fast/.test(s)) return 'sprint';
  if (/^idle_neutral/.test(s)) return 'idle';
  if (/^idle_look/.test(s)) return 'look';
  if (/cell_phone/.test(s)) return 'phone';
  if (/take_picture/.test(s)) return 'photo';
  if (/wave/.test(s)) return 'wave';
  if (/crouch/.test(s)) return 'cower';
  return s;
}
