// Static server for a built dist/ that compresses like Cloudflare Pages (brotli for text types).
//   node scripts/serve-dist.mjs <dir> [port]
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { brotliCompressSync } from 'node:zlib';

const DIR = process.argv[2] ?? 'dist';
const PORT = Number(process.argv[3] ?? 5199);
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.geojson': 'application/geo+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.pbf': 'application/x-protobuf', '.mp4': 'video/mp4',
};
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.geojson', '.svg']);
const cache = new Map();

createServer((req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (path.endsWith('/')) path += 'index.html';
  const file = join(DIR, path);
  try {
    if (!statSync(file).isFile()) throw new Error();
  } catch {
    return res.writeHead(404).end();
  }
  const ext = extname(file);
  const br = COMPRESS.has(ext) && /\bbr\b/.test(req.headers['accept-encoding'] ?? '');
  const key = `${file}:${br}`;
  if (!cache.has(key)) {
    const raw = readFileSync(file);
    cache.set(key, br ? brotliCompressSync(raw) : raw);
  }
  const body = cache.get(key);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ...(br ? { 'Content-Encoding': 'br' } : {}),
  });
  res.end(body);
}).listen(PORT, '127.0.0.1', () => console.log(`${DIR} on http://127.0.0.1:${PORT}/`));
