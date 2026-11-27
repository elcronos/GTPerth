#!/usr/bin/env node
// Real-GPU screenshot capture for games and showcase pages.
//   node capture.mjs --url <http-url|file> --out <dir> [--poses "x,y,z,tx,ty,tz;..."] [--names a,b]
//                    [--w 1920 --h 1080] [--wait 4000] [--query "shot=1&q=high"] [--critic] [--shimmer]
// Writes <out>/<name>.png (master), and with --critic: <out>/critic/<name>.jpg (≤1568px long edge, what the
// vision model can actually see) + <out>/critic/<name>-crop{1,2}.jpg (1:1 768px crops at the busiest regions).
// --shimmer: renders 2 frames 1/60 s apart with the camera frozen and writes <name>-shimmer.jpg (abs diff ×8) —
// the critic cannot watch video, but it can see a heatmap of temporal instability.
// meta.json gets renderer string, stats, errors. NEVER give meta.json to the blind critic.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const A = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
if (!A.url || !A.out) { console.error('usage: capture.mjs --url U --out DIR [--poses ...] [--critic]'); process.exit(1); }
const W = +(A.w || 1920), H = +(A.h || 1080), WAIT = +(A.wait || 4000);
mkdirSync(A.out, { recursive: true });
if (A.critic) mkdirSync(path.join(A.out, 'critic'), { recursive: true });

// serve local files over http (file:// breaks some APIs); port 0 = OS assigned, no clashes between agents
let url = A.url, server;
if (!/^https?:/.test(url)) {
  const file = path.resolve(url), root = path.dirname(file);
  server = createServer((req, res) => {
    if (req.url.startsWith('/favicon')) { res.writeHead(204); return res.end(); } // keeps a 404 out of the error log
    const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!existsSync(p) || !p.startsWith(root)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(readFileSync(p));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/${path.basename(file)}`;
}
const angle = { darwin: 'metal', win32: 'd3d11', linux: 'vulkan' }[process.platform] || 'default';
const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', `--use-angle=${angle}`,
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    `--window-size=${W},${H + 80}`],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400)); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`.slice(0, 400)));

const poses = A.poses ? String(A.poses).split(';').filter(Boolean) : [''];
const names = A.names ? String(A.names).split(',') : poses.map((_, i) => `pose-${i + 1}`);
const meta = { url, size: [W, H], shots: [] };

function toJpeg(png, x, y, w, h, scale) {
  const ow = Math.round(w * scale), oh = Math.round(h * scale), data = Buffer.alloc(ow * oh * 4);
  for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) {
    // box filter downscale
    const sx0 = x + Math.floor(i / scale), sy0 = y + Math.floor(j / scale), n = Math.max(1, Math.round(1 / scale));
    let r = 0, g = 0, b = 0, c = 0;
    for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) {
      const sx = Math.min(png.width - 1, sx0 + u), sy = Math.min(png.height - 1, sy0 + v), k = (sy * png.width + sx) * 4;
      r += png.data[k]; g += png.data[k + 1]; b += png.data[k + 2]; c++;
    }
    const o = (j * ow + i) * 4; data[o] = r / c; data[o + 1] = g / c; data[o + 2] = b / c; data[o + 3] = 255;
  }
  return jpeg.encode({ data, width: ow, height: oh }, 90).data;
}
function busiest(png, size, count) {
  // pick crop windows with highest local luminance variance (detail/defect magnets), non-overlapping
  const cells = [], step = size / 2;
  for (let y = 0; y + size <= png.height; y += step) for (let x = 0; x + size <= png.width; x += step) {
    let s = 0, s2 = 0, n = 0;
    for (let j = 0; j < size; j += 8) for (let i = 0; i < size; i += 8) {
      const k = ((y + j) * png.width + x + i) * 4, l = png.data[k] * 0.3 + png.data[k + 1] * 0.59 + png.data[k + 2] * 0.11;
      s += l; s2 += l * l; n++;
    }
    cells.push({ x, y, v: s2 / n - (s / n) ** 2 });
  }
  cells.sort((a, b) => b.v - a.v);
  const pick = [];
  for (const c of cells) { if (pick.every((p) => Math.abs(p.x - c.x) >= size || Math.abs(p.y - c.y) >= size)) pick.push(c); if (pick.length >= count) break; }
  return pick;
}

for (let i = 0; i < poses.length; i++) {
  const name = names[i] || `pose-${i + 1}`;
  const q = new URLSearchParams(A.query || 'shot=1');
  if (poses[i]) q.set('cam', poses[i]);
  const u = url + (url.includes('?') ? '&' : '?') + q.toString() + (A.hash ? '#' + A.hash : '');
  const t0 = Date.now();
  await page.goto(u);
  try { await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }); }
  catch { logs.push(`[capture] ${name}: __ready never became true (60s)`); }
  await page.waitForTimeout(WAIT);
  const file = path.join(A.out, name + '.png');
  const buf = await page.screenshot({ path: file });
  const info = await page.evaluate(() => ({ stats: window.__stats ? window.__stats() : null, errors: (window.__errors || []).slice(0, 20) }));
  if (A.shimmer) {
    const b2 = await page.screenshot();
    const p1 = PNG.sync.read(buf), p2 = PNG.sync.read(b2), d = new PNG({ width: p1.width, height: p1.height });
    for (let k = 0; k < p1.data.length; k += 4) {
      const diff = Math.min(255, 8 * (Math.abs(p1.data[k] - p2.data[k]) + Math.abs(p1.data[k + 1] - p2.data[k + 1]) + Math.abs(p1.data[k + 2] - p2.data[k + 2])) / 3);
      d.data[k] = diff; d.data[k + 1] = diff * 0.5; d.data[k + 2] = 0; d.data[k + 3] = 255;
    }
    const sc = Math.min(1, 1568 / Math.max(d.width, d.height));
    writeFileSync(path.join(A.out, A.critic ? 'critic' : '', name + '-shimmer.jpg'), toJpeg(d, 0, 0, d.width, d.height, sc));
  }
  if (A.critic) {
    const png = PNG.sync.read(buf);
    const sc = Math.min(1, 1568 / Math.max(png.width, png.height));
    writeFileSync(path.join(A.out, 'critic', name + '.jpg'), toJpeg(png, 0, 0, png.width, png.height, sc));
    const crop = Math.min(768, png.height);
    busiest(png, crop, 2).forEach((c, k) => writeFileSync(path.join(A.out, 'critic', `${name}-crop${k + 1}.jpg`), toJpeg(png, c.x, c.y, crop, crop, 1)));
  }
  meta.shots.push({ name, pose: poses[i], ms: Date.now() - t0, ...info });
  console.log(`${name}: ${info.errors.length} errors, ${info.stats ? info.stats.fps + 'fps ' + info.stats.calls + ' calls ' + info.stats.tris + ' tris' : 'no __stats'}`);
}
meta.renderer = meta.shots[0]?.stats?.renderer || 'unknown';
meta.software = /SwiftShader|llvmpipe|Software|Basic Render/i.test(meta.renderer);
meta.logs = logs.slice(-60);
writeFileSync(path.join(A.out, 'meta.json'), JSON.stringify(meta, null, 2));
console.log('renderer:', meta.renderer, meta.software ? '(SOFTWARE — perf/visual numbers invalid)' : '');
if (logs.length) console.log(logs.slice(-15).join('\n'));
await browser.close();
server?.close();
