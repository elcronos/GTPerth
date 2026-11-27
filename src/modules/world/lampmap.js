// Street-lamp light received by props and people at night: samples the same 2D lamp map the ground uses
// (uLampMap / uLampBox, built in props.js) and adds albedo-lit warm light. Cheap: one texture fetch.
import { patch, sharedUniform } from '../../cookbook/engine/patch.js';
import { Vector4 } from 'three';
// declared up front so any material compiled before props.js fills the map still links
sharedUniform('uLampMap', 'sampler2D', null); sharedUniform('uLampBox', 'vec4', new Vector4(0, 0, 1, 1));
import { ensureWorldVaryings } from '../../cookbook/materials/weathering.js';
const done = new WeakSet();
// approximate ground height for the falloff: the promenade/CBD rise (z north of the river climbs ~0.02/m)
const GROUND_GLSL = 'float uLampGroundY(vec2 p) { return 2.2 + max(0.0, -(p.y + 250.0)) * 0.025; }';
export function lampReceive(mat, gain = 1.4) {
  if (!mat || done.has(mat)) return mat; done.add(mat);
  patch(mat, 'lamp-receive', (sh) => {
    ensureWorldVaryings(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GROUND_GLSL).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { vec2 lrUv = (vWthPos.xz - uLampBox.xy) / uLampBox.zw;
    float lr = texture2D(uLampMap, clamp(lrUv, 0.0, 1.0)).r;
    lr *= 1.0 - smoothstep(0.5, 2.4, vWthPos.y - uLampGroundY(vWthPos.xz));   // a ground pool lights legs and benches, not whole poles
    totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.78, 0.52) * lr * lr * ${gain.toFixed(2)} * uNight; }`);
  });
  return mat;
}
