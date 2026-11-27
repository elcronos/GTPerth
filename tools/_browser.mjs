// Shared helpers for the Playwright tools (bench, playtest). Real GPU Chrome, headful (headless = SwiftShader).
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

export function parseArgs(argv = process.argv.slice(2)) {
  const A = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const v = argv[i + 1]; if (v !== undefined && !v.startsWith('--')) { A[a.slice(2)] = v; i++; } else A[a.slice(2)] = true; }
    else A._.push(a);
  }
  return A;
}

// url: http(s) URL or a local file (served over http on an OS-assigned port)
export async function openTarget(url) {
  if (/^https?:/.test(url)) return { url, close: async () => {} };
  const s = await startServer(url);
  return { url: s.url, close: s.close };
}

export async function launchChrome({ w = 1600, h = 900, extraArgs = [], uncapped = false } = {}) {
  const angle = { darwin: 'metal', win32: 'd3d11', linux: 'vulkan' }[process.platform] || 'default';
  const args = ['--enable-gpu', '--ignore-gpu-blocklist', `--use-angle=${angle}`,
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    `--window-size=${w},${h + 80}`, ...extraArgs];
  // uncapped: measure real frame cost instead of the vsync interval
  if (uncapped) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400)); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`.slice(0, 400)));
  return { browser, page, logs };
}

export const withQuery = (url, query, hash) => url + (query ? (url.includes('?') ? '&' : '?') + query : '') + (hash ? '#' + hash : '');
export const isSoftware = (r) => /SwiftShader|llvmpipe|Software|Basic Render/i.test(r || '');

export async function waitReady(page, timeout = 60000) {
  try { await page.waitForFunction(() => window.__ready === true || !!window.__fatal, null, { timeout }); }
  catch { return { ok: false, why: '__ready never became true' }; }
  const fatal = await page.evaluate(() => window.__fatal || null);
  return fatal ? { ok: false, why: 'fatal: ' + fatal } : { ok: true };
}
