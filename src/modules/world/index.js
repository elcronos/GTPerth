// World assembly: materials, land + shore, roads, skyline, landmarks, Perth Water, far field, props.
import { patch } from '../../cookbook/engine/patch.js';
import { MeshStandardMaterial, Color, DoubleSide, Group, Vector3, Box3, BufferGeometry, Float32BufferAttribute, Mesh } from 'three';
import { makeMaterial } from '../../cookbook/materials/library.js';
import { createSea } from '../../cookbook/water/sea.js';
import { createPlanarReflection } from '../../cookbook/ground/planar-reflection.js';
import { createFarfield } from '../../cookbook/backdrop/farfield.js';
import { registerSurfaces } from './surfaces.js';
import { facadeMaterial } from './facade.js';
import * as Ground from './ground.js';
import * as Roads from './roads.js';
import * as Towers from './towers.js';
import * as Landmarks from './landmarks.js';
import * as Props from './props.js';
import { heightAt, isLand, PLACES } from '../../map.js';

export { registerSurfaces };

function std(color, rough, metal, extra = {}) { const m = new MeshStandardMaterial({ color: new Color().setRGB(...color), roughness: rough, metalness: metal, vertexColors: true, ...extra }); return m; }
function vc(m) { m.vertexColors = true; return m; }

// copper shingle cladding (as photographed): horizontal seams every 0.6 m, vertical joints every 2.4 m
function seamed(m) {
  patch(m, 'seam', (sh) => {
    sh.vertexShader = 'varying vec2 vSeamUv;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeamUv = uv;');
    sh.fragmentShader = 'varying vec2 vSeamUv;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n{ float f = fract(vSeamUv.y / 0.6); float seam = smoothstep(0.0, 0.07, f) * smoothstep(1.0, 0.95, f); float g = fract(vSeamUv.x / 2.4); seam *= smoothstep(0.0, 0.02, g); diffuseColor.rgb *= 0.66 + 0.34 * seam; }');
  });
  return m;
}
export function makeWorldMaterials() {
  const m = {
    quayWall: vc(makeMaterial('concrete', { tint: 0xb8b4aa })),
    coping: vc(makeMaterial('limestone', { scale: 2 })),
    limestone: vc(makeMaterial('limestone')),
    rock: vc(makeMaterial('rock', { triplanar: true, tint: 0xb8a890 })),
    sand: vc(makeMaterial('river_sand')),
    road: (() => { const r = vc(Roads.markRoadMaterial(makeMaterial('asphalt'))); const c0 = r.color.clone(); r.color.setRGB(1.85, 1.72, 1.52).multiply(c0); r.envMapIntensity = 0.55; return r; })(),   // sun-bleached WA bitumen (aged albedo ~0.12)
    kerb: vc(makeMaterial('concrete', { weather: 'ground', tint: 0xc8c4bc })),
    concrete: vc(makeMaterial('concrete', { tint: 0xd8d4cc })),
    bridgeConc: vc(makeMaterial('concrete', { tint: 0xe0dcd2, scale: 6 })),
    white: vc(makeMaterial('clean_paint', { tint: 0xf4f4f0 })),
    alu: vc(makeMaterial('clean_paint', { tint: 0xc8ccd0, metal: 1, rough: 0.8 })),
    render: vc(makeMaterial('clean_paint', { tint: 0xe8e0d0, rough: 2.2 })),
    canopy: vc(makeMaterial('clean_paint', { tint: 0xf0efe8, rough: 2.5 })),
    timber: vc(makeMaterial('wood_planks', { tint: 0xc89870 })),
    timberDeck: vc(makeMaterial('weathered_wood', { tint: 0xb09a80 })),
    pile: vc(makeMaterial('weathered_wood', { tint: 0x6a5a4a })),
    woodDark: vc(makeMaterial('wood_planks', { tint: 0x5a4030 })),
    steel: vc(makeMaterial('galvanised')),
    roofMetal: vc(makeMaterial('galvanised', { tint: 0x9aa0a4 })),
    rubber: vc(makeMaterial('rubber')),
    brick: vc(makeMaterial('brick', { tint: 0xd8a088, scale: 1 })),
    canopyBlue: std([0.12, 0.26, 0.68], 0.3, 0.15, { emissive: new Color(0.5, 0.18, 1.0), emissiveIntensity: 0 }),
    ledPurple: std([0.3, 0.2, 0.4], 0.4, 0, { emissive: new Color(0.62, 0.16, 1.0), emissiveIntensity: 0 }),
    archWhite: std([0.86, 0.87, 0.88], 0.35, 0.1, { emissive: new Color(0.55, 0.2, 0.95), emissiveIntensity: 0 }),
    tile: vc(makeMaterial('brick', { tint: 0xf08050, scale: 0.8 })),   // red Marseille tiles
    granite: std([0.06, 0.055, 0.05], 0.45, 0),
    copper: seamed(std([0.30, 0.11, 0.065], 0.55, 0.35)),
    teal: std([0.16, 0.42, 0.44], 0.05, 0.8),
    deckSteel: std([0.42, 0.44, 0.46], 0.5, 0.6),
    glass: std([0.18, 0.22, 0.24], 0.04, 0.9),
    glassLight: std([0.42, 0.5, 0.52], 0.03, 0.75),
    glassDark: std([0.05, 0.06, 0.065], 0.08, 0.6),
    water: std([0.02, 0.04, 0.05], 0.02, 0.2),
    sign: std([0.02, 0.24, 0.14], 0.5, 0),
    numbat: std([0.32, 0.13, 0.05], 0.7, 0),
    sailcloth: std([0.75, 0.72, 0.65], 0.9, 0, { side: DoubleSide }),
  };
  m.kerb.side = DoubleSide;
  return m;
}

export function create(G, { mats }) {
  const root = new Group(); root.name = 'world';
  const ground = Ground.create(G, { mats });
  for (const o of ground.meshes) root.add(o);
  const roads = Roads.create(G, { mats });
  for (const o of roads.meshes) root.add(o);
  const facade = facadeMaterial();
  const towers = Towers.create(G, { material: facade });
  for (const o of towers.meshes) root.add(o);
  const lm = Landmarks.create(G, { mats });
  root.add(lm.group);
  towers.footprints.push(...lm.footprints);   // landmark buildings (Mister Walker): collision, minimap, prop keep-out
  const props = Props.create(G, { mats, roads, footprints: towers.footprints, lamps: lm.lamps });
  root.add(props.group);
  G.scene.add(root);

  // Perth Water: calm river chop under a light sea breeze from the SW
  // signature surface: the river mirrors the skyline (planar reflection; off on the 'low' tier → env reflections)
  const refl = createPlanarReflection(G, { height: 0 });
  refl.hide?.push(...(props.noReflect || [])); refl.maxFar = 2600;   // the mirror skips far bush and street clutter
  const sea = createSea(G, { refl, level: 0, far: 6500, waveOpts: { L0: 5.0, steep: 0.016, chop: 0.14, spread: 2.0, falloff: 0.86, detailSteep: 0.016, count: 8, detail: 12, seed: 11 },
    scatter: [0.008, 0.032, 0.044], absorb: [0.52, 0.16, 0.12], foam: 0.4, envIntensity: 1.0 });

  // far field: the Darling Scarp to the east + suburbs (all at real-ish apparent heights, fogged by the same atmosphere)
  const far = createFarfield(G, { layers: [
    { kind: 'mountains', radius: 6000, height: 90, base: -8, follow: 0.95, body: [0.2, 0.2, 0.27], top: [0.26, 0.24, 0.3], rim: 0.6, fogScale: 1.0, rough: 0.6, seed: 7 },
    { kind: 'skyline', radius: 3300, height: 12, base: -2, follow: 0.5, windows: 0.25, body: [0.16, 0.15, 0.14], top: [0.19, 0.18, 0.16], rim: 0.4, fogScale: 1.0, seed: 5 },
    { kind: 'treeline', radius: 4300, height: 16, base: 0, follow: 0.6, body: [0.05, 0.05, 0.05], top: [0.09, 0.08, 0.07], rim: 0.8, fogScale: 1.0, seed: 3 },
  ] });

  // any vertex-coloured material on a geometry without a colour attribute reads (0,0,0) in WebGL → renders black
  // (this blacked out the quay walls, kerbs and roads). Give such geometries a white colour attribute.
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position || o.geometry.attributes.color) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (!ms.some((m) => m && m.vertexColors)) return;
    o.geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(o.geometry.attributes.position.count * 3).fill(1), 3));
  });
  // suburbs beyond the OSM extent (±2600 m): flat olive-grey land so the river is the only water to the horizon
  {
    const R = [[-8000, -8000, 8000, -2600], [2600, -2600, 8000, 675], [2600, 1313, 8000, 8000], [-8000, -2600, -2600, 1235], [-738, 2600, 2600, 8000]];
    const pos = [];
    for (const [x0, z0, x1, z1] of R) pos.push(x0, 1.2, z0, x0, 1.2, z1, x1, 1.2, z1, x0, 1.2, z0, x1, 1.2, z1, x1, 1.2, z0);
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const fm = new MeshStandardMaterial({ color: 0x4a4c3c, roughness: 1, metalness: 0, side: DoubleSide }); fm.name = 'suburbs-far';
    const fl = new Mesh(g, fm); fl.name = 'suburbs-far'; fl.frustumCulled = false; root.add(fl);
  }
  const colliders = [...towers.footprints, ...(props.colliders || []), ...lm.colliders];
  const bounds = new Box3(new Vector3(-1400, -5, -1000), new Vector3(1400, 300, 1800));
  return { root, ground: ground.ground[0], groundMeshes: ground.ground, sea, far, roads, towers, landmarks: lm, props, colliders, bounds, facade,
    heightAt, isLand, update() {} };
}
