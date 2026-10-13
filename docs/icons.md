# Crop icons

All icons live in `site/public/icons/` and are indexed by `site/public/icons/manifest.json`
(`slug -> file`). Preview: `assets-src/icons/contact-sheet.html` (screenshot: `docs/screens/icons.png`).

## Fluent Emoji (32 emoji-backed slugs)

3D PNGs from [microsoft/fluentui-emoji](https://github.com/microsoft/fluentui-emoji), MIT License,
Copyright (c) Microsoft Corporation. The unmodified 256x256 `*_3d.png` assets live in
`assets-src/icons/fluent-256/`; `site/scripts/encode-icons.mjs` ships them as 160px WebP (the largest marker is
52 css px, so 160px covers 3x screens) and points `manifest.json` at them. Source URLs are also in
`assets-src/icons/sources.json`.

Mapping notes: `lettuce` = Leafy green, `corn` = Ear of corn, `orange` = Tangerine, `apple` = Red apple,
`kiwi` = Kiwi fruit, `rice` = Sheaf of rice, `blueberry` = Blueberries, `cow` = Cow (full body).

| slug | source |
|---|---|
| `lettuce` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Leafy%20green/3D/leafy_green_3d.png |
| `broccoli` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Broccoli/3D/broccoli_3d.png |
| `carrot` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Carrot/3D/carrot_3d.png |
| `onion` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Onion/3D/onion_3d.png |
| `garlic` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Garlic/3D/garlic_3d.png |
| `potato` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Potato/3D/potato_3d.png |
| `tomato` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Tomato/3D/tomato_3d.png |
| `bell_pepper` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Bell%20pepper/3D/bell_pepper_3d.png |
| `hot_pepper` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Hot%20pepper/3D/hot_pepper_3d.png |
| `cucumber` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Cucumber/3D/cucumber_3d.png |
| `melon` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Melon/3D/melon_3d.png |
| `watermelon` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Watermelon/3D/watermelon_3d.png |
| `corn` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Ear%20of%20corn/3D/ear_of_corn_3d.png |
| `strawberry` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Strawberry/3D/strawberry_3d.png |
| `blueberry` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Blueberries/3D/blueberries_3d.png |
| `grapes` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Grapes/3D/grapes_3d.png |
| `olive` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Olive/3D/olive_3d.png |
| `avocado` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Avocado/3D/avocado_3d.png |
| `orange` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Tangerine/3D/tangerine_3d.png |
| `lemon` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Lemon/3D/lemon_3d.png |
| `peach` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Peach/3D/peach_3d.png |
| `cherries` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Cherries/3D/cherries_3d.png |
| `apple` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Red%20apple/3D/red_apple_3d.png |
| `pear` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Pear/3D/pear_3d.png |
| `kiwi` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Kiwi%20fruit/3D/kiwi_fruit_3d.png |
| `rice` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Sheaf%20of%20rice/3D/sheaf_of_rice_3d.png |
| `sunflower` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Sunflower/3D/sunflower_3d.png |
| `beans` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Beans/3D/beans_3d.png |
| `tulip` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Tulip/3D/tulip_3d.png |
| `seedling` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Seedling/3D/seedling_3d.png |
| `herb` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Herb/3D/herb_3d.png |
| `cow` | https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Cow/3D/cow_3d.png |

## Custom SVG icons (8 slugs)

`almond, pistachio, walnut, date, pomegranate, wheat, alfalfa, cotton` are original artwork authored
for this project to match the Fluent 3D look (multi-stop gradients, specular sheen, bottom shading,
no outlines, 256 viewBox, transparent background). Same license as the rest of this repo.
