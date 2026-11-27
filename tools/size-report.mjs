#!/usr/bin/env node
// Bundle audit for the single-file build (G-size): node size-report.mjs dist/index.html [--budget 2] [--json]
// Reports raw / gzip / brotli, the JS / CSS / markup split, an estimate of GLSL bytes (template strings that look
// like shaders), and flags: embedded binary data: URIs, long base64 runs, external URLs (fonts/CDNs).
// Exit 1 when over budget (MB, default 2) or any binary blob is embedded.
import { readFileSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) || 'dist/index.html';
const bi = args.indexOf('--budget'); const budget = (bi >= 0 ? +args[bi + 1] : 2) * 1048576;
const html = readFileSync(file, 'utf8');
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
const js = scripts.join(''), css = styles.join('');
// GLSL estimate: backtick strings containing shader tokens
let glsl = 0, glslN = 0;
for (const m of js.matchAll(/`((?:\\[\s\S]|[^`\\])*)`/g)) {
  const s = m[1];
  if (s.length > 80 && /(gl_FragColor|gl_Position|\bvoid main\b|\bvec[234]\b|\buniform\b|#include <)/.test(s)) { glsl += s.length; glslN++; }
}
const blobs = [...html.matchAll(/data:(image|audio|video|font|application\/(octet-stream|font|x-font))[^"'`)\s]{0,30}/gi)].map((m) => m[0]);
const b64 = [...html.matchAll(/[A-Za-z0-9+/]{2000,}={0,2}/g)].map((m) => m[0].length);
const ext = [...new Set([...html.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)/gi), ...css.matchAll(/url\(\s*["']?(https?:\/\/[^)"']+)/gi)].map((m) => m[1]))];
const gz = gzipSync(html, { level: 9 }).length;
const br = brotliCompressSync(Buffer.from(html), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const r = {
  file, raw: html.length, gzip: gz, brotli: br, js: js.length, css: css.length, markup: html.length - js.length - css.length,
  glsl, glslStrings: glslN, binaryBlobs: blobs, base64Runs: b64, externalUrls: ext, budget, pass: html.length <= budget && !blobs.length,
};
if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
else {
  console.log(`${file}`);
  console.log(`  raw ${kb(r.raw)}   gzip ${kb(gz)}   brotli ${kb(br)}   budget ${kb(budget)}  ${r.raw <= budget ? 'OK' : 'OVER'}`);
  console.log(`  js ${kb(r.js)}   css ${kb(r.css)}   markup ${kb(r.markup)}   glsl≈ ${kb(glsl)} in ${glslN} strings (incl. three's own chunks)`);
  if (blobs.length) console.log('  BINARY BLOBS: ' + blobs.join(', '));
  if (b64.length) console.log(`  long base64-like runs: ${b64.length} (largest ${kb(Math.max(...b64))}) — check they are not assets`);
  if (ext.length) console.log('  external URLs: ' + ext.join(', '));
  console.log(r.pass ? 'PASS' : 'FAIL');
}
process.exit(r.pass ? 0 : 1);
