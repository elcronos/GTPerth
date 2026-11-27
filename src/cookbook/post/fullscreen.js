// Fullscreen-triangle helper shared by every post pass (one geometry, one mesh, one camera).
// A single oversized triangle covers the viewport with no diagonal seam (cheaper and cleaner than a quad).
//   const fs = createFullscreen(renderer);
//   const m = fsMaterial(FRAG, { tSrc: { value: null } }, { TAPS: 12 });
//   fs.pass(m, target);           // target = WebGLRenderTarget or null (canvas)
import { BufferGeometry, Float32BufferAttribute, Mesh, OrthographicCamera, ShaderMaterial } from 'three';

// vUv in [0,1]; gl_Position z = 0 so depth test/write never matter.
export const FS_VERT = /*glsl*/`
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export function fsMaterial(fragmentShader, uniforms = {}, defines = {}) {
  return new ShaderMaterial({
    vertexShader: FS_VERT, fragmentShader, uniforms, defines,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
}

export function createFullscreen(renderer) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new Mesh(geo);
  mesh.frustumCulled = false;
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    mesh, cam,
    // caller owns renderer.autoClear (pipeline sets it false while running passes)
    pass(material, target) {
      mesh.material = material;
      renderer.setRenderTarget(target);
      renderer.render(mesh, cam);
    },
    dispose() { geo.dispose(); },
  };
}
