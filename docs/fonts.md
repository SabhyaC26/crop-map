# Fonts

The map and UI use **Figtree** for labels and text. It replaces Nunito.

## Sources

| Asset | Source |
| --- | --- |
| Static TTFs (Regular, Medium, SemiBold, Bold, ExtraBold) | https://github.com/erikdkennedy/figtree/tree/master/fonts/ttf |
| Variable TTF (`Figtree[wght].ttf`, used for the web font) | https://github.com/google/fonts/tree/main/ofl/figtree |
| Nunito static TTFs (legacy glyph build) | `@expo-google-fonts/nunito` 0.4.2 (npm) |

The Figtree static TTFs are from the upstream project, copyright 2022 The Figtree Project Authors. The static TTFs are version 2.001. The variable web font is version 2.002.

## License

Figtree is licensed under the SIL Open Font License 1.1. The full text is in `site/public/webfonts/OFL.txt`. Nunito is also OFL 1.1.

## Outputs

**Glyph PBFs** (MapLibre SDF glyphs, requested as `{fontstack}/{range}.pbf`):

- `site/public/fonts/Figtree Regular/`
- `site/public/fonts/Figtree Medium/`
- `site/public/fonts/Figtree SemiBold/`
- `site/public/fonts/Figtree Bold/`
- `site/public/fonts/Figtree ExtraBold/`

Each directory holds the ranges `0-255`, `256-511`, `512-767`, `768-1023`, `7680-7935`, and `8192-8447`. These cover Latin, Latin Extended A/B, Latin Extended Additional, and General Punctuation. The fontstack names are the directory names, for example `"Figtree Bold"` in a MapLibre `text-font` expression.

**Web fonts** (`site/public/webfonts/`):

- `Figtree-Variable.woff2`: variable font, weight axis 300–900
- `OFL.txt`: license

## Rebuilding

The glyph script is `site/scripts/build-glyphs.mjs`. It takes the fontnik install, the TTF folder, the output root, and the family name.

1. Install fontnik into a scratch folder outside the repo:

   ```sh
   mkdir -p /tmp/figtree-build/npm && cd /tmp/figtree-build/npm
   npm init -y && npm install fontnik
   ```

2. Download the static TTFs into `/tmp/figtree-build/ttf/` as `Figtree-<Weight>.ttf`, using the upstream URLs above.

3. Build the glyphs from the `site` directory:

   ```sh
   node scripts/build-glyphs.mjs /tmp/figtree-build/npm/node_modules/fontnik /tmp/figtree-build/ttf public/fonts figtree
   ```

To rebuild Nunito, use the `nunito` family with a TTF folder laid out as `<weight>/Nunito_<weight>.ttf`. The default family is `nunito`. Running the script with `nunito` reproduces the committed Nunito glyph files byte for byte.

To rebuild the web font, run fonttools with brotli from the folder that holds the variable TTF, and write the output into the repo:

```sh
uvx --from fonttools --with brotli fonttools ttLib.woff2 compress -o /path/to/ca-crop-map/site/public/webfonts/Figtree-Variable.woff2 "Figtree[wght].ttf"
```

The variable TTF comes from google/fonts (`ofl/figtree/Figtree[wght].ttf`).
