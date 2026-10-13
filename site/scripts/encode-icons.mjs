// Re-encodes the 256px Fluent PNGs (assets-src/icons/fluent-256/) as 160px WebP into public/icons/ and
// rewrites manifest.json. 160px covers the largest marker (52 css px) at 3x DPR.
//   NODE_PATH=<dir with sharp> node scripts/encode-icons.mjs
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sharp = createRequire(import.meta.url)('sharp');
const SRC = new URL('../../assets-src/icons/fluent-256/', import.meta.url).pathname;
const OUT = new URL('../public/icons/', import.meta.url).pathname;
const SIZE = 160;

const manifestPath = join(OUT, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
for (const file of readdirSync(SRC).filter((f) => f.endsWith('.png'))) {
  const slug = file.replace(/\.png$/, '');
  await sharp(join(SRC, file))
    .resize(SIZE, SIZE, { kernel: 'lanczos3' })
    .webp({ quality: 90, alphaQuality: 100, effort: 6, smartSubsample: true })
    .toFile(join(OUT, `${slug}.webp`));
  manifest[slug] = `${slug}.webp`;
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
