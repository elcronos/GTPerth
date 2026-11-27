#!/usr/bin/env node
// Static file server for built games (file:// breaks workers/fetch/pointer-lock in places — always test over http).
//   node serve.mjs [dir|file] [--port 0] [--host 127.0.0.1]     → prints the URL; Ctrl-C to stop
//   import { startServer } from './serve.mjs';  const s = await startServer('dist/index.html'); s.url; s.close();
// Port 0 = OS-assigned, so parallel agents never collide. No caching (every reload sees the fresh build).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain' };

// target: a directory (serves it) or a file (serves its directory; s.url points at the file)
export async function startServer(target = '.', { port = 0, host = '127.0.0.1' } = {}) {
  const abs = path.resolve(target);
  const isFile = (await stat(abs)).isFile();
  const root = isFile ? path.dirname(abs) : abs;
  const server = createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      if (rel.startsWith('/favicon')) { res.writeHead(204); return res.end(); }
      if (rel.endsWith('/')) rel += 'index.html';
      const p = path.join(root, rel);
      if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(port, host, r));
  const base = `http://${host}:${server.address().port}/`;
  return { url: base + (isFile ? path.basename(abs) : ''), base, root, server, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] && process.argv[1].endsWith('serve.mjs')) {
  const a = process.argv.slice(2);
  const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
  const target = a.find((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--'))) || '.';
  const s = await startServer(target, { port: +opt('port', 0), host: opt('host', '127.0.0.1') });
  console.log(s.url);
}
