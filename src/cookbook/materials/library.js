// Ready-made PBR materials: bake (cached) + tint mask + metric UV scale + weathering + specular AA.
//
//   import { initMaterials, makeMaterial, MATERIAL_NAMES } from './materials/library.js';
//   initMaterials(G);                                    // once, after createCore (renderer + tier + ART.surface)
//   const wall  = makeMaterial('corrugated', { tint: 0x8a2a1c });
//   const floor = makeMaterial('concrete', { scale: 4 });             // metres per tile (default per surface)
//   const rock  = makeMaterial('rock', { triplanar: true });          // world projection, ignores UVs
//   const lamp  = makeMaterial('emissive_panel', { emissive: 0xffd9a0, emissiveIntensity: 8 });
//
// Geometry UVs must be in METRES (1 UV unit = 1 m). One bake per surface name (per tier size) is shared by every
// material made from it; tint (material.color) only affects texels whose baked mask is 1 (paint, tarp, stain...).
import { MeshStandardMaterial, Vector2, Color } from 'three';
import { patch } from '../engine/patch.js';
import { bakeSurface, BAKE_SIZE, rebakeAll } from './bake.js';
import { SURFACES, SURF_LIB, SURFACE_NAMES } from './surfaces.glsl.js';
import { initWeathering, patchWeathering, WEATHER_PRESETS } from './weathering.js';
import { patchTriplanar } from './triplanar.js';

export const MATERIAL_NAMES = SURFACE_NAMES;
let R = null, TIER = 'high';

const wired = new WeakSet();
export function initMaterials(G) {
  R = G.renderer; TIER = (G.quality && G.quality.tier) || 'high';
  initWeathering(G);
  // a lost WebGL context wipes every render-target's contents: refill the cached bakes in place (same textures)
  if (G.on && !wired.has(G)) {
    wired.add(G);
    G.on('contextrestored', () => { const n = rebakeAll(G.renderer); G.materialsRebaked = (G.materialsRebaked || 0) + n; });
  }
}

/** Bake (or fetch cached) the texture set of a surface name. */
export function getSurfaceSet(name, o = {}) {
  const def = SURFACES[name];
  if (!def) throw new Error('unknown surface ' + name + ' (have: ' + SURFACE_NAMES.join(', ') + ')');
  const renderer = o.renderer || R;
  if (!renderer) throw new Error('initMaterials(G) first (or pass { renderer })');
  const size = o.size || BAKE_SIZE[o.tier || TIER] || 1024;
  return bakeSurface(renderer, { surf: def.glsl, lib: SURF_LIB, size, scale: def.scale, depth: def.depth, params: def.params, key: name + '|' + size });
}

// UV scale (metres -> tiles), tint through the baked mask (albedo alpha), emission from ORM alpha.
const PBR_VERT = /*glsl*/`
#ifdef USE_MAP
  vMapUv *= uMatUv;
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv *= uMatUv;
#endif
#ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv *= uMatUv;
#endif
#ifdef USE_METALNESSMAP
  vMetalnessMapUv *= uMatUv;
#endif
#ifdef USE_AOMAP
  vAoMapUv *= uMatUv;
#endif
`;
const PBR_TINT = /*glsl*/`
#ifdef USE_MAP
  diffuseColor.rgb = sampledDiffuseColor.rgb * mix(vec3(1.0), diffuse, sampledDiffuseColor.a);
  diffuseColor.a = opacity;
#endif
`;
function patchPbr(mat, uvScale, emissive) {
  const u = { value: new Vector2(uvScale, uvScale) };
  mat.userData.uvScale = u.value;
  patch(mat, emissive ? 'pbr-emit' : 'pbr', (shader) => {
    shader.uniforms.uMatUv = u;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uMatUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + PBR_VERT);
    let fs = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + PBR_TINT);
    if (emissive) fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_ROUGHNESSMAP\n  totalEmissiveRadiance *= texture2D(roughnessMap, vRoughnessMapUv).a;\n#endif\n');
    shader.fragmentShader = fs;
  });
}

/**
 * @param name one of MATERIAL_NAMES
 * @param o {
 *   tint (hex|Color; default per surface)   scale (metres per tile; default per surface)
 *   rough=1, metal=1 (multipliers on the baked values)   normal=1 (normalScale)   ao=1 (aoMapIntensity)
 *   emissive (hex, emissive surfaces only), emissiveIntensity=4
 *   triplanar=false (true or {blend, sharp})
 *   weather: false | 'ground' | 'sheltered' | { preset?, wet, dust, snow, edge, porosity, beads, macro, edgeMetal, specAA }
 *            (see weathering.js). Ground-class surfaces (SURFACES[name].ground: asphalt, sand, snow, ice,
 *            forest_ground) default to the 'ground' preset (dust 0, beads 0) so up-facing dust never paints terrain
 *            beige; pass { preset: 'prop' } (or explicit values) to override.
 *   size, tier, renderer   (bake overrides)
 * }
 */
export function makeMaterial(name, o = {}) {
  const def = SURFACES[name];
  const set = getSurfaceSet(name, o);
  const scale = o.scale ?? def.scale;
  const ns = o.normal ?? 1;
  const mat = new MeshStandardMaterial({
    color: new Color(o.tint ?? def.tint),
    map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, metalnessMap: set.metalnessMap, aoMap: set.aoMap,
    roughness: o.rough ?? 1, metalness: o.metal ?? 1, normalScale: new Vector2(ns, ns), aoMapIntensity: o.ao ?? 1,
    emissive: def.emissive ? new Color(o.emissive ?? 0xffd2a0) : new Color(0), emissiveIntensity: def.emissive ? (o.emissiveIntensity ?? 4) : 1,
  });
  mat.name = name;
  patchPbr(mat, 1 / scale, !!def.emissive);
  if (o.triplanar) patchTriplanar(mat, scale, typeof o.triplanar === 'object' ? o.triplanar : {});
  if (o.weather !== false) {
    const wo = typeof o.weather === 'string' ? { preset: o.weather } : (o.weather || {});
    const preset = WEATHER_PRESETS[wo.preset ?? (def.ground ? 'ground' : 'prop')] || {};
    const edgeDefault = /painted|corrugated|plastic/.test(name) ? 0.6 : 0;
    // low tier: skip rain beads (the only per-pixel Voronoi); branch is on a uniform, so it costs nothing when off
    const lowBeads = TIER === 'low' ? { beads: 0 } : {};
    const { preset: _p, ...explicit } = wo;
    patchWeathering(mat, { porosity: def.porosity, edge: edgeDefault, beads: 1, ...preset, ...lowBeads, ...explicit });
    mat.userData.weatherPreset = wo.preset ?? (def.ground ? 'ground' : 'prop');
  }
  return mat;
}
