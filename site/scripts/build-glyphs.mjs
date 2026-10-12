// Generates MapLibre SDF glyph PBFs from Nunito TTFs (SIL OFL) using node-fontnik.
// Usage: node build-glyphs.mjs <fontnik-dir> <nunito-ttf-dir> <out-dir>
//   fontnik-dir   : an npm-installed `fontnik` (with prebuilds)
//   nunito-ttf-dir: folder holding Nunito_<weight><Name>.ttf (from @expo-google-fonts/nunito)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const [fontnikDir, ttfDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
const fontnik = createRequire(join(fontnikDir, 'index.js'))(fontnikDir);
const range = promisify(fontnik.range);

const STACKS = {
  'Nunito Regular': '400Regular',
  'Nunito SemiBold': '600SemiBold',
  'Nunito Bold': '700Bold',
  'Nunito ExtraBold': '800ExtraBold',
};
// Latin, Latin Extended-A/B, Latin Extended Additional, General Punctuation, symbols
const BLOCKS = [[0, 1023], [7680, 7935], [8192, 8447]];

for (const [stack, weight] of Object.entries(STACKS)) {
  const font = readFileSync(join(ttfDir, weight, `Nunito_${weight}.ttf`));
  const dir = join(outDir, stack);
  mkdirSync(dir, { recursive: true });
  for (const [from, to] of BLOCKS) {
    for (let start = from; start < to; start += 256) {
      const end = start + 255;
      const pbf = await range({ font, start, end });
      writeFileSync(join(dir, `${start}-${end}.pbf`), pbf);
    }
  }
}
console.log('glyphs written to', outDir);
