// World module (template sample: a small dock yard on a quay). REPLACE the layout with the game's level; keep the shape:
//   create(G, { mats }) → { update, colliders: Box3[], bounds: Box3, root, ground, quay, shed, anchors }
//     ground  the walkable ground mesh (main.js patches it with ground/ground.js + planar reflection)
//     quay    the quay-edge mesh above the sea (main.js adds reflected caustics to its material)
//     shed    { group, box } — the roofed interior (main.js captures an interior probe for it)
//     anchors named points main.js dresses with lights, decals, FX emitters and scatter
//   The far field is NOT built here: main.js adds backdrop/farfield.js rings (same fog, real parallax).
//   showcase(G) → { cam, target }      (?show=world renders only this)
// Rules that make it look AAA (references/art-direction.md): real-scale metric UVs, bevelled edges (geo/kit.js),
// merge by material (one mesh per material key), contact AO baked into vertex colours, everything dressed AROUND
// the 6 POSES, far field ≥ 2 parallax layers hidden in fog.
import { Box3, Vector3, Group, Mesh, PlaneGeometry } from 'three';
import { Kit, crate, barrel, pallet, roundedBox } from '../cookbook/geo/kit.js';
import { WORLD, SEED } from '../contracts.js';

export function create(G, { mats }) {
  const rnd = G.rng(SEED);
  const root = new Group(); root.name = 'world';
  const colliders = [];
  const solid = (x, y, z, w, h, d) => colliders.push(new Box3(new Vector3(x - w / 2, y, z - d / 2), new Vector3(x + w / 2, y + h, z + d / 2)));

  // ground: one big slab, metric UVs (PlaneGeometry uv 0..1 → scale to metres)
  const size = WORLD.max[0] - WORLD.min[0] + 40;
  const gg = new PlaneGeometry(size, size, 1, 1);
  const uv = gg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size, uv.getY(i) * size);
  const ground = new Mesh(gg, mats.ground);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'ground';
  root.add(ground);
  // quay edge: the slab stands 3 m out of the sea on all four sides (top flush with the ground, face to the water)
  const qk = new Kit(), half = size / 2, qh = -WORLD.seaY + 2.4;
  for (const [x, z, w, d] of [[0, -half, size + 1, 1], [0, half, size + 1, 1], [-half, 0, 1, size], [half, 0, 1, size]]) {
    qk.add(roundedBox(w, qh, d, 0.03), 'quay', { at: [x, -qh / 2 + 0.001, z] });
  }
  const quay = qk.build({ quay: mats.quay || mats.concrete }, { castShadow: false });
  quay.name = 'quay';
  root.add(quay);

  // props through the kit: one merged mesh per material key
  const k = new Kit();
  const stacks = [[-6, -4], [-4.6, -4.4], [6, 2], [7.2, 1.6], [-2, 7], [10, -8], [-12, 4]];
  for (const [x, z] of stacks) {
    const n = 1 + Math.floor(rnd() * 3), ry = (rnd() - 0.5) * 0.4;
    for (let i = 0; i < n; i++) { k.push(x, i * 0.8, z, ry + (rnd() - 0.5) * 0.1); crate(k, { w: 1.2, h: 0.8, d: 0.8 }); k.pop(); }
    solid(x, 0, z, 1.3, n * 0.8, 1.3);
  }
  // barrel clusters (tight groups read as "placed by people", scattered singles read as procedural noise)
  for (const [cx, cz] of [[-9, -8], [9, 5], [-3, -11]]) for (let i = 0; i < 7; i++) {
    const a = i * 2.4, r = i ? 0.62 + (i % 2) * 0.1 : 0, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    k.push(x, 0, z, rnd() * 6); barrel(k, { color: [0x8a2a1e, 0x2a4a6a, 0x5d6b2f][i % 3] }); k.pop(); solid(x, 0, z, 0.6, 0.9, 0.6);
  }
  // pallet stacks
  for (let i = 0; i < 5; i++) for (let j = 0; j < 1 + (i % 3); j++) { k.push(3 + i * 1.4, j * 0.144, -6, 0.04 * i + (rnd() - 0.5) * 0.06); pallet(k, { seed: i * 3 + j }); k.pop(); }
  // a low shed (bevelled concrete walls + roof slab) so poses have an interior edge and big shadow shapes.
  // Own kit + own materials (mats.shed*): main.js gives them an interior probe without touching the outdoor ones.
  const sx = 13, sz = -12;
  const sk = new Kit();
  for (const [x, z, w, d] of [[0, -4, 10, 0.3], [-5, 0, 0.3, 8], [5, -2.2, 0.3, 3.6]]) { sk.add(roundedBox(w, 4, d, 0.02), 'concrete', { at: [sx + x, 2, sz + z] }); solid(sx + x, 0, sz + z, w, 4, d); }
  sk.add(roundedBox(10.6, 0.25, 8.6, 0.02), 'concrete', { at: [sx, 4.1, sz] });
  for (let i = 0; i < 4; i++) sk.add(roundedBox(0.3, 4, 0.3, 0.015), 'steel', { at: [sx - 4.5 + i * 3, 2, sz + 4] });
  sk.bakeAO?.({ ground: 0 }); sk.grime?.();
  const shedGroup = new Group(); shedGroup.name = 'shed';
  shedGroup.add(sk.build({ concrete: mats.shedConcrete || mats.concrete, steel: mats.shedSteel || mats.steel, default: mats.concrete }));
  root.add(shedGroup);
  const shed = { group: shedGroup, box: new Box3(new Vector3(sx - 5, 0, sz - 4), new Vector3(sx + 5, 4, sz + 4)), probeAt: [sx, 1.6, sz - 0.5] };
  // a perimeter wall (bevelled blocks) so the playable space reads as a place
  for (let i = -5; i <= 5; i++) {
    k.add(roundedBox(5.8, 2.6, 0.4, 0.02), 'concrete', { at: [i * 6, 1.3, WORLD.min[2] + 4] });
    solid(i * 6, 0, WORLD.min[2] + 4, 6, 2.6, 0.4);
  }
  k.bakeAO?.({ ground: 0 }); k.grime?.();
  root.add(k.build({ wood: mats.wood, paint: mats.paint, steel: mats.steel, concrete: mats.concrete, rubber: mats.rubber || mats.steel, default: mats.concrete }));

  // anchors for main.js dressing stages (lights, decals, FX, scatter): keep them next to the 6 POSES
  const anchors = {
    lamps: [[-8, 0, 6], [6, 0, -3], [-3, 0, -15], [9, 0, 9]],                  // lamp-post feet (y = ground)
    vent: [sx - 3.5, 0.15, sz - 3.4],                                         // steam vent inside the shed
    signs: [{ name: 'gate', pos: [sx - 1.5, 2.6, sz - 3.83], rotY: 0, w: 1.6 }, // on the shed's back wall
      { name: 'bay', pos: [-6, 1.6, WORLD.min[2] + 4.21], rotY: 0, w: 1.1 }],  // stencil on the perimeter wall
    wallLine: { x0: WORLD.min[0] + 2, x1: WORLD.max[0] - 2, z: WORLD.min[2] + 4.6 }, // rubble/weeds along the wall
  };

  G.scene.add(root);
  const bounds = new Box3().setFromObject(ground).union(new Box3().setFromObject(shedGroup));
  return { root, ground, quay, shed, anchors, colliders, bounds, update() {}, dispose() { G.scene.remove(root); } };
}

export function showcase(G) { return { cam: [-10, 2.2, 10], target: [0, 1, 0] }; }
