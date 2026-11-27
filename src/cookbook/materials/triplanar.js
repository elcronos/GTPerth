// World-space triplanar projection for terrain, rocks and anything without good UVs.
//
//   const m = makeMaterial('rock', { triplanar: true });          // library does this for you, or:
//   patchTriplanar(material, 4 /* metres per texture tile */, { blend: 0.6, sharp: 4 });
//
// Samples map / roughnessMap / metalnessMap / aoMap / normalMap three times (X, Y, Z projections of the world
// position), blends with |N|^sharp weights sharpened by the baked height (normalMap alpha) so the transition
// follows the relief instead of a smooth smear ("height blend"), and reconstructs the normal with whiteout blending
// (Golus 2017, UV signs fixed so no projection is mirrored). Mesh UVs are ignored.
// Works with weathering.js (it reads matTpH / matNLen) and specular AA. Apply it AFTER library's 'pbr' patch and
// BEFORE patchWeathering (library.js does this). Cost: 9 texture fetches + 3 dummy normal fetches skipped (~2x UV).
import { Vector3 } from 'three';
import { patch } from '../engine/patch.js';
import { ensureWorldVaryings } from './weathering.js';

const PARS = /*glsl*/`
uniform vec3 uTpP;
vec2 tpX;
vec2 tpY;
vec2 tpZ;
vec3 tpW;
vec3 tpNW;
vec4 tpSample(sampler2D t) { return texture(t, tpX) * tpW.x + texture(t, tpY) * tpW.y + texture(t, tpZ) * tpW.z; }
`;

const PRELUDE = /*glsl*/`
{
  vec3 n = normalize(vWthN);
#ifdef DOUBLE_SIDED
  n *= gl_FrontFacing ? 1.0 : -1.0;
#endif
  vec3 sg = vec3(n.x < 0.0 ? -1.0 : 1.0, n.y < 0.0 ? -1.0 : 1.0, n.z < 0.0 ? -1.0 : 1.0);
  vec3 p = vWthPos * uTpP.x;
  tpX = vec2(p.z * sg.x, p.y);
  tpY = vec2(p.x * sg.y, p.z);
  tpZ = vec2(-p.x * sg.z, p.y);
  vec3 w = pow(abs(n), vec3(uTpP.z));
  w /= dot(w, vec3(1.0));
  tpNW = n;
#ifdef USE_NORMALMAP
  vec4 nX = texture(normalMap, tpX), nY = texture(normalMap, tpY), nZ = texture(normalMap, tpZ);
  vec3 hb = w * (0.3 + vec3(nX.a, nY.a, nZ.a) * uTpP.y * 2.0);
  float mx = max(hb.x, max(hb.y, hb.z));
  w = max(hb - mx * 0.6, 0.0);
  w /= dot(w, vec3(1.0));
  matTpH = nX.a * w.x + nY.a * w.y + nZ.a * w.z;
  vec3 tX = nX.xyz * 2.0 - 1.0, tY = nY.xyz * 2.0 - 1.0, tZ = nZ.xyz * 2.0 - 1.0;
  matNLen = length(tX) * w.x + length(tY) * w.y + length(tZ) * w.z;
  tX.xy *= normalScale; tY.xy *= normalScale; tZ.xy *= normalScale;
  tX.x *= sg.x; tY.x *= sg.y; tZ.x *= -sg.z;
  tX = vec3(tX.xy + n.zy, abs(tX.z) * n.x);
  tY = vec3(tY.xy + n.xz, abs(tY.z) * n.y);
  tZ = vec3(tZ.xy + n.xy, abs(tZ.z) * n.z);
  tpNW = normalize(tX.zyx * w.x + tY.xzy * w.y + tZ.xyz * w.z);
#endif
  tpW = w;
}
`;

const ON = '\n#undef texture2D\n#define texture2D(t, c) tpSample(t)\n';
const OFF = '\n#undef texture2D\n#define texture2D texture\n';
const NOFETCH = '\n#undef texture2D\n#define texture2D(t, c) vec4(0.5, 0.5, 1.0, 1.0)\n';
const wrap = (src, inc, pre, post) => src.replace(inc, pre + inc + post);

/**
 * @param material MeshStandardMaterial with map/normalMap/roughnessMap(ORM)... set
 * @param scaleMeters metres covered by one texture tile
 * @param o { blend = 0.6 (height-blend strength 0..1), sharp = 4 (normal-weight exponent) }
 */
export function patchTriplanar(material, scaleMeters = 2, o = {}) {
  const u = { value: new Vector3(1 / scaleMeters, o.blend ?? 0.6, o.sharp ?? 4) };
  material.userData.triplanar = u;
  return patch(material, 'triplanar', (shader) => {
    ensureWorldVaryings(shader);
    shader.uniforms.uTpP = u;
    let fs = '#define MAT_TRIPLANAR\n' + shader.fragmentShader;
    fs = fs.replace('void main() {', PARS + 'void main() {');
    fs = fs.replace('#include <map_fragment>', PRELUDE + '#include <map_fragment>');
    fs = wrap(fs, '#include <map_fragment>', ON, OFF);
    fs = wrap(fs, '#include <roughnessmap_fragment>', ON, OFF);
    fs = wrap(fs, '#include <metalnessmap_fragment>', ON, OFF);
    fs = wrap(fs, '#include <aomap_fragment>', ON, OFF);
    fs = wrap(fs, '#include <normal_fragment_maps>', NOFETCH, OFF + '\nnormal = normalize((viewMatrix * vec4(tpNW, 0.0)).xyz);\n');
    shader.fragmentShader = fs;
  });
}
