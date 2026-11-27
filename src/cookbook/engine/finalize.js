// One pass over the finished scene that gives every world material the two global patches, so no material is
// ever left unfogged (sticks out of the haze) or dry in the rain:
//
//   import { finalizeMaterials } from './engine/finalize.js';
//   const r = finalizeMaterials(G, G.scene);   // after world, ground, water, backdrop, props, lights, decals, FX
//   // r = { materials, atmos, weathering, skipped }  (also G.finalizeStats)
//
// Per material (each one once, however many meshes share it):
//  - atmos (lighting/atmos.js patchAtmos): every built-in material (Standard/Physical/Basic/Lambert/Phong/Toon) that
//    has neither 'atmos' nor 'atmosAdd'. Additive blending → transmittance only. Skipped: ShaderMaterial /
//    RawShaderMaterial (they call atmosApply() themselves: sky, backdrop, particles), Points/Sprite/Line materials,
//    userData.noAtmos.
//  - weathering (materials/weathering.js patchWeathering): MeshStandard/MeshPhysical only, opaque, without an
//    existing 'wth' patch (makeMaterial already adds it). Skipped: surfaces with their own wetness model (patch keys
//    starting with 'ground' or 'sea' — ground/ground.js, water/sea.js), transparent/additive materials (glass, decals,
//    halos), userData.noWeather. Preset from userData.weather ('prop' | 'ground' | 'sheltered' | opts object), else
//    'ground' for meshes named /ground|floor|road|terrain/i, else 'prop'.
// Needs installAtmos(G) (shared fog uniforms) and initMaterials(G)/initWeathering(G) (shared weather uniforms) first.
// Idempotent: call it again after adding more objects (only new materials are patched). Compiles nothing by itself;
// run it before the warm-up (boot.finish) so the warm-up compiles the final programs.
import { patchKeys } from './patch.js';
import { patchAtmos } from '../lighting/atmos.js';
import { patchWeathering } from '../materials/weathering.js';

const ATMOS_TYPES = new Set(['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshBasicMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshToonMaterial']);
const OWN_WETNESS = /^(ground|sea)/;
const GROUNDISH = /ground|floor|road|terrain|asphalt/i;

export function finalizeMaterials(G, root = G.scene, { atmos = true, weathering = true } = {}) {
  const seen = new Set();
  const r = { materials: 0, atmos: 0, weathering: 0, skipped: 0 };
  root.traverse((o) => {
    if (!o.material) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (!m || seen.has(m)) continue;
      seen.add(m); r.materials++;
      if (m.isShaderMaterial || !ATMOS_TYPES.has(m.type)) { r.skipped++; continue; }
      const keys = patchKeys(m);
      const additive = m.blending === 2; // AdditiveBlending
      if (atmos && !m.userData.noAtmos && !keys.includes('atmos') && !keys.includes('atmosAdd')) {
        patchAtmos(m, { additive }); r.atmos++;
      }
      const lit = m.isMeshStandardMaterial; // Physical extends Standard
      if (weathering && lit && !m.userData.noWeather && !m.transparent && !additive && !keys.includes('wth') &&
          !keys.some((k) => OWN_WETNESS.test(k))) {
        const w = m.userData.weather;
        const opts = typeof w === 'object' && w ? w : { preset: typeof w === 'string' ? w : (GROUNDISH.test(o.name || m.name || '') ? 'ground' : 'prop') };
        patchWeathering(m, opts); m.userData.weatherPreset = opts.preset || 'custom'; r.weathering++;
      }
    }
  });
  G.finalizeStats = r;
  return r;
}
