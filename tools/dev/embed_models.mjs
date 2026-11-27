// Embed Tripo-generated, gltf-transform-optimised GLBs (meshopt + webp) as base64 into src/assets/models.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const names = process.argv.slice(2);
let out = '// Vehicles generated with Tripo (image/text-to-3D), optimised with glTF-Transform (meshopt geometry, webp textures).\nexport const MODELS = {\n';
for (const n of names) { const f = `/home/claude/viewer/opt_${n}.glb`; if (!existsSync(f)) continue; out += `  ${n}: '${readFileSync(f).toString('base64')}',\n`; }
writeFileSync('src/assets/models.js', out + '};\n'); console.log('models.js', (out.length / 1024).toFixed(0), 'KB');
