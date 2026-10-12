// Generates MapLibre SDF glyph PBFs from static TTFs (SIL OFL) using node-fontnik.
// Usage: node build-glyphs.mjs <fontnik-dir> <ttf-dir> <out-dir> [family]
//   fontnik-dir : an npm-installed `fontnik` (with prebuilds)
//   ttf-dir     : folder holding the static TTFs for the family (layout depends on family, see FAMILIES)
//   out-dir     : output root; one `<Family Weight>/` folder is written per stack
//   family      : `nunito` (default) or `figtree`
//
// Nunito TTFs: from @expo-google-fonts/nunito -> <ttf-dir>/<400Regular>/Nunito_<400Regular>.ttf
// Figtree TTFs: from erikdkennedy/figtree fonts/ttf -> <ttf-dir>/Figtree-<Regular>.ttf
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

// Maps each output fontstack (the name MapLibre requests via text-font) to its source weight key,
// and resolves that weight key to a TTF path relative to ttf-dir.
const FAMILIES = {
  nunito: {
    stacks: {
      'Nunito Regular': '400Regular',
      'Nunito SemiBold': '600SemiBold',
      'Nunito Bold': '700Bold',
      'Nunito ExtraBold': '800ExtraBold',
    },
    ttfPath: (weight) => join(weight, `Nunito_${weight}.ttf`),
  },
  figtree: {
    stacks: {
      'Figtree Regular': 'Regular',
      'Figtree Medium': 'Medium',
      'Figtree SemiBold': 'SemiBold',
      'Figtree Bold': 'Bold',
      'Figtree ExtraBold': 'ExtraBold',
    },
    ttfPath: (weight) => `Figtree-${weight}.ttf`,
  },
};

// Latin, Latin Extended-A/B, Latin Extended Additional, General Punctuation, symbols
const BLOCKS = [[0, 1023], [7680, 7935], [8192, 8447]];

const [fontnikDirArg, ttfDirArg, outDirArg, familyArg = 'nunito'] = process.argv.slice(2);
if (!fontnikDirArg || !ttfDirArg || !outDirArg) {
  console.error('Usage: node build-glyphs.mjs <fontnik-dir> <ttf-dir> <out-dir> [nunito|figtree]');
  process.exit(1);
}
const family = FAMILIES[familyArg];
if (!family) {
  console.error(`Unknown family "${familyArg}". Known: ${Object.keys(FAMILIES).join(', ')}`);
  process.exit(1);
}

const fontnikDir = resolve(fontnikDirArg);
const ttfDir = resolve(ttfDirArg);
const outDir = resolve(outDirArg);
const fontnik = createRequire(join(fontnikDir, 'index.js'))(fontnikDir);
const range = promisify(fontnik.range);

for (const [stack, weight] of Object.entries(family.stacks)) {
  const font = readFileSync(join(ttfDir, family.ttfPath(weight)));
  const dir = join(outDir, stack);
  mkdirSync(dir, { recursive: true });
  for (const [from, to] of BLOCKS) {
    for (let start = from; start < to; start += 256) {
      const end = start + 255;
      const pbf = await range({ font, start, end });
      writeFileSync(join(dir, `${start}-${end}.pbf`), pbf);
    }
  }
  console.log(`wrote ${dir}`);
}
console.log('glyphs written to', outDir);
