// Street-lamp light received by props and people at night: samples the same 2D lamp map the ground uses
// (uLampMap / uLampBox, built in props.js) and adds albedo-lit warm light. Cheap: one texture fetch.
import { patch, sharedUniform } from '../../cookbook/engine/patch.js';
import { Vector4 } from 'three';
// declared up front so any material compiled before props.js fills the map still links
sharedUniform('uLampMap', 'sampler2D', null); sharedUniform('uLampBox', 'vec4', new Vector4(0, 0, 1, 1));
import { ensureWorldVaryings } from '../../cookbook/materials/weathering.js';
const done = new WeakSet();
export function lampReceive(mat, gain = 1.4) {
  if (!mat || done.has(mat)) return mat; done.add(mat);
  patch(mat, 'lamp-receive', (sh) => {
    ensureWorldVaryings(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { vec2 lrUv = (vWthPos.xz - uLampBox.xy) / uLampBox.zw;
    float lr = texture2D(uLampMap, clamp(lrUv, 0.0, 1.0)).r;
    totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.78, 0.52) * lr * lr * ${gain.toFixed(2)} * uNight; }`);
  });
  return mat;
}
