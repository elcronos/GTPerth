// Chainable onBeforeCompile patching. Every cookbook material tweak goes through here so that
// several systems (weathering, fog, macro variation, specular AA...) can stack on one material.
//   patch(mat, 'wet', (shader, renderer) => { shader.fragmentShader = shader.fragmentShader.replace(A, B) })
// Shared uniforms: put them in `patchUniforms` once; every patched shader gets them.

export const patchUniforms = {
  uTime: { value: 0, type: 'float' },
};
// Register a uniform shared by every patched material (declared automatically in both stages).
export function sharedUniform(name, type, value) {
  if (!patchUniforms[name]) patchUniforms[name] = { value, type };
  return patchUniforms[name];
}
const declare = (src) => {
  let d = '';
  for (const k in patchUniforms) if (!new RegExp('uniform\\s+\\w+\\s+' + k + '\\b').test(src)) d += `uniform ${patchUniforms[k].type} ${k};\n`;
  if (!d) return src;
  // before <common> so helper functions that patches insert after <common> can use them
  return src.includes('#include <common>') ? src.replace('#include <common>', d + '#include <common>') : src.replace('void main()', d + 'void main()');
};

const KEY = Symbol('patches');

export function patch(material, key, fn) {
  let list = material[KEY];
  if (!list) {
    list = material[KEY] = [];
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      if (prev && prev !== material.onBeforeCompile) prev.call(material, shader, renderer);
      Object.assign(shader.uniforms, patchUniforms);
      for (const p of list) p.fn(shader, renderer);
      shader.vertexShader = declare(shader.vertexShader);
      shader.fragmentShader = declare(shader.fragmentShader);
      material.userData.shader = shader; // lets systems poke per-material uniforms later
    };
    material.customProgramCacheKey = () => list.map((p) => p.key).join('|');
  }
  const i = list.findIndex((p) => p.key === key);
  if (i >= 0) list[i] = { key, fn }; else list.push({ key, fn });
  material.needsUpdate = true;
  return material;
}

export function hasPatch(material, key) {
  return !!material[KEY]?.some((p) => p.key === key);
}

// Keys of every patch on a material, in application order (e.g. ['wth', 'specaa', 'atmos']). Empty if unpatched.
export function patchKeys(material) {
  return material[KEY] ? material[KEY].map((p) => p.key) : [];
}

// Helper: insert GLSL after/before an include, keeping the include itself.
export const after = (src, include, code) => src.replace(include, include + '\n' + code);
export const before = (src, include, code) => src.replace(include, code + '\n' + include);
