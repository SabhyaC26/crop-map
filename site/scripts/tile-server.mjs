// Serves public/data/*.pmtiles with Range + CORS, standing in for the R2 tile host during local benchmarks.
//   node scripts/tile-server.mjs [port]
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const PORT = Number(process.argv[2] ?? 5300);
const DIR = new URL('../public/data/', import.meta.url).pathname;

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, ETag, Accept-Ranges');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (!name.endsWith('.pmtiles') || name.includes('..')) return res.writeHead(404).end();
  const file = join(DIR, name);
  let size;
  try {
    size = statSync(file).size;
  } catch {
    return res.writeHead(404).end();
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('ETag', `"${size}"`);
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
  if (!m) {
    res.writeHead(200, { 'Content-Length': size });
    return req.method === 'HEAD' ? res.end() : createReadStream(file).pipe(res);
  }
  const start = Number(m[1]);
  const end = Math.min(m[2] ? Number(m[2]) : size - 1, size - 1);
  res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  return req.method === 'HEAD' ? res.end() : createReadStream(file, { start, end }).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`tiles on http://127.0.0.1:${PORT}/`));
