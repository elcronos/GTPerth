// No-op stand-ins, one per module, matching each module's public API. engine/boot.js swaps one in when a
// non-critical module throws during create(), so the game still boots and the failure shows up as
// __stats().modules[i].stub === true (a gate failure — never ship with a stub).
// Keep every stub's shape in sync with the real module's api: callers must not need `if (mod.isStub)`.
const noop = () => {};
export const STUBS = {
  sky:       () => ({ update: noop, mesh: null, material: null }),
  env:       () => ({ bake: noop }),
  post:      () => ({ update: noop, params: {} }),       // no G.render → core renders the scene directly
  materials: () => ({ update: noop, get: () => null }),
  world:     () => ({ update: noop, colliders: [], bounds: null }),
  ground:    () => ({ update: noop, mask: null, refl: null, uniforms: null }),
  water:     () => ({ update: noop, sea: null, caustics: null, heightAt: () => 0 }),
  backdrop:  () => ({ update: noop, group: null }),
  props:     () => ({ update: noop }),
  scatter:   () => ({ update: noop, group: null }),
  decals:    () => ({ update: noop, atlas: null }),
  lights:    () => ({ update: noop, add: () => null }),
  shadows:   () => ({ update: noop, invalidate: noop }),
  fx:        () => ({ update: noop, muzzle: noop, tracer: noop, impact: noop, casing: noop, explosion: noop, emitter: () => null, materials: [] }),
  weather:   () => ({ update: noop, amount: 0, rain: null, snow: null, dust: null, lightning: null }),
  probes:    () => ({ update: noop, capture: noop }),
  actors:    () => ({ update: noop, list: [] }),
  player:    (G) => ({ update: noop, yaw: 0, pitch: 0, position: G.camera.position, teleport: noop }),
  audio:     () => ({ update: noop, play: () => null, setVolume: noop, unlock: noop, mixer: null }),
  ui:        () => ({ update: noop, setState: noop, state: 'playing', show: noop }),
};
