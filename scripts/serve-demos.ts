#!/usr/bin/env ts-node
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT =
  Number(process.env.PORT) ||
  Number(getArg('-p')) ||
  Number(getArg('--port')) ||
  5173;
const DEMOS_ROOT = path.join(process.cwd(), 'demos');

function discoverCuratedFiles(rootDir: string): Set<string> {
  const files = new Set<string>(['index.html']);
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      /^[a-z0-9-]+-component(?:\.preview)?\.(?:html|js)$/.test(entry.name)
    ) {
      files.add(entry.name);
    }
  }
  return files;
}

const CURATED = discoverCuratedFiles(DEMOS_ROOT);

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const MIME = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.cjs', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function safeJoin(root: string, urlPath: string): string {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = path.normalize(decoded).replace(/^\/+/, '');
  return path.join(root, normalized);
}

function send(
  res: http.ServerResponse,
  status: number,
  body: string,
  type = 'text/plain; charset=utf-8'
): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.end(body);
}

// No directory listings — serve curated gallery only

const server = http.createServer((req, res) => {
  if (!req.url) return send(res, 400, 'Bad Request');
  const urlPath = req.url.replace(/\?.*$/, '').replace(/\/+/g, '/');

  // Only serve / or /demos paths
  if (urlPath === '/' || urlPath === '/demos' || urlPath === '/demos/') {
    const fsPath = path.join(DEMOS_ROOT, 'index.html');
    const data = fs.readFileSync(fsPath);
    return send(res, 200, data.toString('utf8'), MIME.get('.html'));
  }

  // Map /demos/<file> to curated allowlist
  if (urlPath.startsWith('/demos/')) {
    const name = urlPath.slice('/demos/'.length);
    if (!CURATED.has(name)) return send(res, 404, 'Not Found');
    const fsPath = safeJoin(DEMOS_ROOT, name);
    if (!fs.existsSync(fsPath) || !fs.statSync(fsPath).isFile())
      return send(res, 404, 'Not Found');
    const ext = path.extname(fsPath).toLowerCase();
    const type = MIME.get(ext) || 'application/octet-stream';
    const data = fs.readFileSync(fsPath);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    return res.end(data);
  }
  // Everything else is hidden
  return send(res, 404, 'Not Found');
});

server.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`Demo server (curated) running on ${base}`);
  console.log(`Open: ${base}/demos/`);
});
