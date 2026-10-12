// Re-encodes the 256px Fluent PNG icons (assets-src/icons/png-256/) as 192px WebP into site/public/icons/ and
// rewrites manifest.json (`slug -> file`). SVG icons are left alone. Encoding runs in headless Chromium's canvas,
// so there is no extra dependency.  192px = ~2.4x the largest rendered size (78 css px popup badge).
//
//   node scripts/perf-icons.mjs [--size 192] [--quality 0.9] [--src dir-with-png] [--out icons-dir]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const SIZE = Number(arg('size', '192'));
const QUALITY = Number(arg('quality', '0.9'));
const root = resolve(import.meta.dirname, '..', '..');
const srcDir = resolve(arg('src', resolve(root, 'assets-src', 'icons', 'png-256')));
const outDir = resolve(arg('out', resolve(root, 'site', 'public', 'icons')));
const manifestPath = resolve(outDir, 'manifest.json');

if (!existsSync(srcDir)) throw new Error(`missing ${srcDir} (original 256px PNGs)`);
mkdirSync(outDir, { recursive: true });
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const pngs = readdirSync(srcDir).filter((f) => f.endsWith('.png'));

const browser = await chromium.launch();
const page = await browser.newPage();
let before = 0;
let after = 0;
for (const file of pngs) {
  const slug = basename(file, '.png');
  const bytes = readFileSync(resolve(srcDir, file));
  before += bytes.length;
  const b64 = await page.evaluate(
    async ([data, size, quality]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', quality));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    [bytes.toString('base64'), SIZE, QUALITY],
  );
  const out = Buffer.from(b64, 'base64');
  after += out.length;
  writeFileSync(resolve(outDir, `${slug}.webp`), out);
  manifest[slug] = `${slug}.webp`;
}
await browser.close();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${pngs.length} icons: ${(before / 1024).toFixed(0)} KB PNG -> ${(after / 1024).toFixed(0)} KB WebP (${SIZE}px, q=${QUALITY})`);
