# Field unit economics

The field card shows **Profit/acre** under the harvest strip, with an expandable breakdown and a
one-line basis ("* 2024 prices · UC Davis data"). It estimates what one year of the crop earns over
the cost of growing it.

## The model (layered)

| Layer | What | Status |
|---|---|---|
| 1. Crop sales | yield/acre × price (+ by-products where known: almond hulls, cottonseed) | shipped |
| 2. Growing cost | everything to grow and harvest, incl. packing where the study includes it | shipped |
| **= Gross profit** | sales − growing cost | shipped |
| 3. Land | rent, or the cost of capital on owned land | later ("Land cost: later" row) |
| 4. Net profit | taxes, depreciation, orchard/vineyard establishment amortization | out of scope |

## Revenue: yield and price

`make economics` (`pipeline/09_economics.py`) reads the
[UC Davis CalAg](https://calag.ucdavis.edu/data/county-crop-reports.html) compilation of County Ag
Commissioner crop reports (`cleaned_county_ag_all_crops_web.xlsx`, from the
[CalAg Box folder](https://ucdavis.app.box.com/s/y6t2icitof2gib1zwwy7ygu3bjpogh0f/folder/368575016764)).
USDA NASS's own all-county compilation stops at 2022; CalAg transcribed the 2023–24 county PDFs.

Per map crop and county:

1. **Crop type.** A map crop can span several commodity types (grapes → wine / table / raisin;
   citrus → navels / mandarins / lemons; corn & sorghum → silage / grain / sorghum). The county gets
   the type with the most acres; the card says which ("Wine grapes: 100% of these acres in Napa County").
   `Corn, All` is split by price (≤ $120/ton = silage tonnage filed by dairy counties).
2. **Year.** Newest of 2024 → 2023 → 2022 with acres, tonnage and value. Yield = tons / acres,
   price = value / tons (units converted: lb, cwt, bales).
3. **Trust checks.** A county's own figure needs ≥ 200 acres and a yield within 0.33×–3× the median
   county yield for that type (wine grapes 0.1×–5×: coastal premium vineyards legitimately yield
   ~3 t/ac vs ~15 in the valley). Processing tomatoes also need a price ≤ $300/ton (above that the
   county is selling fresh-market tomatoes). Failing counties use the **statewide figure for the same
   type**, pooled from trusted counties, labeled "California average".
4. **Overrides** from the San Joaquin County 2024 Crop Report PDF: almonds with hulls, alfalfa,
   processing-only tomatoes.

## Growing cost

One UC Davis cost study per crop type and region (`data/lookup/economics.json` → `studies`, `regions`):

- growing cost = **study cash cost − land rent − property tax**, × inflation factor
- inflation = USDA NASS Prices Paid Index (PPITW, 2011=100), study year → 2024, never below 1;
  studies before 2004 use the 2004 index
- vegetable, citrus, berry and stone-fruit studies include harvest and packing; county crop-report
  values are at first sale (usually packed), so they are kept in

Crops with no estimate: pastures, young (non-bearing) orchards, mixed/other categories, greenhouse,
turf, eucalyptus, kiwis, carrots and garlic (no usable UC Davis study).

### Studies used

| Map crop | Type | Region | Study | Year | Cash | − Rent | − Tax | Growing cost (2024 $) |
|---|---|---|---|---|---|---|---|---|
| Almonds | Almonds | default | [Almonds, San Joaquin Valley North](https://www.almonds.org/sites/default/files/2025-05/AlmondsSJVNorth%20Final%20draft4.pdf) | 2024 | $4,546 | $0 | $352 | **$4,194** |
| Grapes | Wine grapes | napa | [Wine grapes (Cabernet Sauvignon), Napa County](https://coststudyfiles.ucdavis.edu/uploads/cs_public/fe/24/fe24e27a-5c29-4cc3-a83c-63a31cd0c767/2020napawinegrape.pdf) | 2020 | $11,871 | $0 | $2,229 | **$12,241** |
| Grapes | Wine grapes | northCoast | [Wine grapes, Russian River Valley, Sonoma (Pinot noir & Chardonnay avg.)](https://coststudyfiles.ucdavis.edu/uploads/cs_public/c6/28/c6287d1a-64b9-4ba6-b8ff-d83d6c0d0a64/amendedwinegrapessonomafinaldraft91817.pdf) | 2016 | $8,661 | $0 | $757 | **$10,452** |
| Grapes | Wine grapes | northSJV | [Wine grapes (Cabernet), Lodi / North San Joaquin Valley](https://coststudyfiles.ucdavis.edu/uploads/pub/2022/02/28/2021_grapewinelodi_22522.pdf) | 2021 | $4,469 | $0 | $352 | **$4,804** |
| Grapes | Wine grapes | otherWine | [Wine grapes (Cabernet), Lodi / North San Joaquin Valley](https://coststudyfiles.ucdavis.edu/uploads/pub/2022/02/28/2021_grapewinelodi_22522.pdf) | 2021 | $4,469 | $0 | $352 | **$4,804** |
| Grapes | Wine grapes | default | [Wine grapes (Cabernet), South San Joaquin Valley](https://coststudyfiles.ucdavis.edu/uploads/cs_public/2d/10/2d10450b-f265-45db-85d6-5b15a0fde6c0/19winegrapessjvsouthcabernet.pdf) | 2019 | $4,007 | $0 | $357 | **$4,630** |
| Grapes | Table grapes | default | [Table grapes (Flame Seedless), San Joaquin Valley South](https://coststudyfiles.ucdavis.edu/uploads/cs_public/03/e8/03e8865f-2b6b-4859-90c6-84414cd9d3f4/2018tablegrapessjvflameseedlessfinaldraft.pdf) | 2018 | $18,836 | $0 | $315 | **$23,641** |
| Grapes | Raisin grapes | default | [Raisin grapes (dry-on-vine), San Joaquin Valley](https://coststudyfiles.ucdavis.edu/uploads/cs_public/ec/ba/ecba9b89-f1e9-401c-9044-4afa2c060093/2016dovraisinsohtsjvfinaldraft111716.pdf) | 2016 | $2,894 | $0 | $283 | **$3,453** |
| Corn & sorghum | Silage | default | [Corn silage, North San Joaquin Valley](https://coststudyfiles.ucdavis.edu/uploads/cs_public/a9/c5/a9c55e16-83cf-46f3-86b8-436ae2deb41f/15ctsilagecornsanjoaquinvalleyfinaldraftjuly20.pdf) | 2015 | $1,494 | $155 | $2 | **$1,702** |
| Corn & sorghum | Grain corn | default | [Field corn (grain), San Joaquin Valley South](https://coststudyfiles.ucdavis.edu/uploads/cs_public/8a/b9/8ab9b6ef-72ca-4762-af3c-50b487da72c5/corn-sjv-2015.pdf) | 2015 | $1,613 | $300 | $2 | **$1,669** |
| Corn & sorghum | Sorghum | default | [Grain sorghum, San Joaquin Valley](https://coststudyfiles.ucdavis.edu/uploads/cs_public/cb/2c/cb2c22b4-04b7-45fb-a29b-7a5babe95776/2016sorghumgrainsjvfinaldraftmar23.pdf) | 2016 | $1,430 | $250 | $201 | **$1,295** |
| Pistachios | Pistachios | default | [Pistachios, San Joaquin Valley South](https://coststudyfiles.ucdavis.edu/uploads/cs_public/e4/bd/e4bd9353-25a1-4258-b5b1-42a203bc09ad/2020pistachiosjvsouth.pdf) | 2020 | $3,788 | $0 | $287 | **$4,445** |
| Alfalfa | Alfalfa | default | [Alfalfa hay, Sacramento & North San Joaquin Valley](https://ucanr.edu/sites/nichemarketing/files/337465.pdf) | 2020 | $1,491 | $300 | $4 | **$1,507** |
| Rice | Rice | delta | [Rice, Delta](https://coststudyfiles.ucdavis.edu/uploads/pub/2023/05/11/20022ricedeltacontinuousrotation5923.pdf) | 2022 | $1,623 | $400 | $8 | **$1,237** |
| Rice | Rice | default | [Rice (medium grain), Sacramento Valley](https://coststudyfiles.ucdavis.edu/uploads/pub/2021/11/03/2021ricesacramentovalley.pdf) | 2021 | $2,061 | $475 | $8 | **$1,841** |
| Grain & hay | Grain hay | default | [Oat hay (dryland), Sacramento Valley](https://coststudyfiles.ucdavis.edu/uploads/cs_public/ae/dd/aedd57c9-f980-4bfb-810a-afdffe760a36/oathay_sv2012.pdf) | 2012 | $381 | $75 | $0 | **$410** |
| Grain & hay | Oats | default | [Oat hay (dryland), Sacramento Valley](https://coststudyfiles.ucdavis.edu/uploads/cs_public/ae/dd/aedd57c9-f980-4bfb-810a-afdffe760a36/oathay_sv2012.pdf) | 2012 | $381 | $75 | $0 | **$410** |
| Walnuts | Walnuts | southSJV | [Walnuts, South San Joaquin Valley](https://coststudyfiles.ucdavis.edu/2024/03/27/23WalnutsSacVal-Final-3.26.24.pdf) | 2023 | $3,717 | $0 | $421 | **$3,296** |
| Walnuts | Walnuts | default | [Walnuts, Sacramento Valley](https://coststudyfiles.ucdavis.edu/uploads/pub/2023/03/17/22walnutssacval-31623.pdf) | 2022 | $4,001 | $0 | $362 | **$3,705** |
| Citrus | Navel oranges | default | [Navel oranges, San Joaquin Valley South](https://coststudyfiles.ucdavis.edu/uploads/pub/2021/08/12/2021orangessjvsouth.pdf) | 2021 | $7,345 | $0 | $282 | **$8,241** |
| Citrus | Valencia oranges | default | [Navel oranges, San Joaquin Valley South](https://coststudyfiles.ucdavis.edu/uploads/pub/2021/08/12/2021orangessjvsouth.pdf) | 2021 | $7,345 | $0 | $282 | **$8,241** |
| Citrus | Mandarins | default | [Mandarins (Tango), San Joaquin Valley South](https://coststudyfiles.ucdavis.edu/uploads/cs_public/05/9f/059f84bb-f096-4089-9053-a4cce02fb915/mandarinsvs2011.pdf) | 2011 | $13,088 | $0 | $182 | **$18,055** |
| Citrus | Lemons | coastCitrus | [Lemons (Eureka), Ventura County](https://coststudyfiles.ucdavis.edu/uploads/cs_public/38/fa/38fa8f9c-c93b-4c62-9740-a850bbc40df9/2020lemonsventuracounty.pdf) | 2020 | $12,089 | $0 | $879 | **$14,231** |
| Citrus | Lemons | default | [Lemons, San Joaquin Valley South](https://coststudyfiles.ucdavis.edu/uploads/cs_public/a1/39/a139af36-5c70-48ec-8367-bc534c314eb3/lemons-vs-2015.pdf) | 2015 | $9,573 | $0 | $227 | **$11,897** |
| Tomatoes | Tomatoes | default | [Processing tomatoes, Sacramento Valley & Northern Delta](https://coststudyfiles.ucdavis.edu/uploads/pub/2023/08/21/amended_82123_2023processtomatosacramentovalleysdifinal.pdf) | 2023 | $4,925 | $762 | $8 | **$4,155** |
| Wheat | Wheat | default | [Wheat, Sacramento Valley irrigated](https://ccfruitandnuts.ucanr.edu/sites/default/files/2020-10/337454.pdf) | 2016 | $707 | $60 | $71 | **$762** |
| Lettuce & greens | Lettuce | default | [Romaine hearts, Central Coast](https://www.foodpolitics.com/wp-content/uploads/Romaine-lettuce-cost-of-production_UC-Davis_23.pdf) | 2023 | $16,347 | $1,600 | $11 | **$14,736** |
| Cotton | Cotton | default | [Cotton (Acala/Upland), San Joaquin Valley](https://cottoninfo.ucdavis.edu/sites/g/files/dgvnsk14551/files/inline-files/150401.pdf) | 2012 | $1,297 | $0 | $88 | **$1,620** |
| Broccoli & cole crops | Broccoli | default | [Broccoli (bunched), Central Coast](https://coststudyfiles.ucdavis.edu/uploads/pub/2023/08/04/2023-brocbunch14s-full-final.pdf) | 2023 | $13,577 | $1,600 | $11 | **$11,966** |
| Onions & garlic | Dry onions | intermountain | [Onions for dehydrating, Intermountain (Tulelake)](https://coststudyfiles.ucdavis.edu/2024/05/10/2023Onions-Final.pdf) | 2023 | $4,361 | $550 | $0 | **$3,811** |
| Onions & garlic | Dry onions | default | [Fresh-market red onions, San Joaquin Valley South](https://coststudyfiles.ucdavis.edu/uploads/cs_public/37/c8/37c88af8-b52e-45eb-bc21-2acd754b0c0a/onionredvs06.pdf) | 2006 | $4,167 | $300 | $8 | **$7,296** |
| Peaches & nectarines | Cling peaches | default | [Cling peaches, Sacramento & San Joaquin Valley](https://coststudyfiles.ucdavis.edu/uploads/cs_public/65/6c/656ce5fa-f4f9-4e95-99fe-a01c1ea8a7a4/2017peachsvsjv-ecling-final_draft2.pdf) | 2017 | $6,633 | $0 | $275 | **$8,321** |
| Peaches & nectarines | Fresh peaches | default | [Fresh-market peaches, San Joaquin Valley South](https://coststudyfiles.ucdavis.edu/uploads/cs_public/90/2f/902faeaa-5024-413d-92dd-927002909580/peachesvs09.pdf) | 2009 | $12,277 | $0 | $141 | **$19,448** |
| Peaches & nectarines | Nectarines | default | [Nectarines, San Joaquin Valley South](https://coststudyfiles.ucdavis.edu/uploads/cs_public/39/b6/39b6cb12-0c79-4b66-bb92-b1012bdbbfd2/nectarinevs09.pdf) | 2009 | $13,086 | $0 | $139 | **$20,748** |
| Melons & squash | Melons | default | [Cantaloupes, Imperial County](https://coststudyfiles.ucdavis.edu/uploads/cs_public/d1/e3/d1e38240-392f-40f5-a110-fc1f55d7302a/cantaloupesb04.pdf) | 2004 | $3,708 | $200 | $0 | **$7,436** |
| Olives | Olives | default | [Table olives (modern, mechanical harvest), Central Valley](https://coststudyfiles.ucdavis.edu/uploads/pub/2023/11/30/2023moderntableolivedraft11302023.pdf) | 2023 | $4,941 | $0 | $288 | **$4,653** |
| Avocados | Avocados | southAvocado | [Avocados (high density), San Diego County](https://coststudyfiles.ucdavis.edu/uploads/cs_public/b4/3d/b43d58d9-1e91-4a3e-80f9-a2edb14958b0/2020avocadohighdensitysandiegocounty.pdf) | 2020 | $12,637 | $0 | $413 | **$15,518** |
| Avocados | Avocados | default | [Avocados, Ventura & Santa Barbara](https://class.ucanr.edu/sites/default/files/2012-11/156254.pdf) | 2011 | $5,886 | $0 | $708 | **$7,244** |
| Strawberries | Strawberries | default | [Strawberries, Central Coast](https://coststudyfiles.ucdavis.edu/2024/04/04/2024Strawberry-FULL-FINAL-March2024.pdf) | 2024 | $111,755 | $3,200 | $47 | **$108,508** |
| Prunes | Prunes | southSJV | [Prunes (dried plums), South San Joaquin Valley](https://coststudyfiles.ucdavis.edu/2024/03/27/2023.Prunes.SJV-Final-3.25.24.pdf) | 2023 | $6,129 | $0 | $311 | **$5,818** |
| Prunes | Prunes | default | [Prunes (dried plums), Sacramento Valley](https://coststudyfiles.ucdavis.edu/uploads/pub/2023/04/21/2022prunessacvalley42023.pdf) | 2022 | $5,535 | $0 | $301 | **$5,329** |
| Cherries | Cherries | default | [Sweet cherries, San Joaquin Valley North](https://coststudyfiles.ucdavis.edu/uploads/cs_public/84/4f/844f0de3-7c1c-4bd3-89ac-893e3388c140/cherry2017_nsjv_final_draft4.pdf) | 2017 | $15,969 | $0 | $346 | **$20,446** |
| Sunflowers | Sunflower seed | default | [Sunflowers for hybrid seed, Sacramento Valley](https://coststudyfiles.ucdavis.edu/uploads/cs_public/18/2d/182dcc66-2b3e-4048-b639-b87d0a6456fd/2018sunflowerssacval-finaldraft_92618.pdf) | 2018 | $1,355 | $272 | $5 | **$1,376** |
| Potatoes | Potatoes | default | [Potatoes (fresh market), Klamath Basin](https://coststudyfiles.ucdavis.edu/2024/05/10/23PotatoFreshMktKlamath-Final.pdf) | 2023 | $3,762 | $550 | $0 | **$3,212** |
| Safflower | Safflower | default | [Safflower, Sacramento Valley](https://coststudyfiles.ucdavis.edu/uploads/cs_public/75/f3/75f3b0a2-11b4-4514-9e87-4af1565a4942/safflowersvbed2005.pdf) | 2005 | $260 | $0 | $2 | **$516** |
| Pomegranates | Pomegranates | default | [Pomegranates, San Joaquin Valley South](https://coststudyfiles.ucdavis.edu/uploads/cs_public/d5/bd/d5bdaad2-b874-4b99-a3c2-cc7a89cfc72d/pomegranatevs2010.pdf) | 2010 | $5,067 | $0 | $120 | **$7,690** |
| Blueberries & berries | Blueberries | default | [Blueberries, San Joaquin Valley South](https://coststudyfiles.ucdavis.edu/uploads/cs_public/79/77/7977d8f7-9f4e-4858-abc8-74c81163b3a5/blueberryvs2009.pdf) | 2009 | $28,084 | $0 | $180 | **$44,717** |
| Sugar beets | Sugar beets | default | [Sugar beets, Imperial County](https://ccfruitandnuts.ucanr.edu/sites/default/files/2011-06/108188.pdf) | 2004 | $1,428 | $175 | $0 | **$2,656** |
| Sweet potatoes | Sweet potatoes | default | [Sweet potatoes, Merced County](https://coststudyfiles.ucdavis.edu/uploads/cs_public/6f/32/6f32eea8-df52-4607-897b-6a90537a8aff/potatosweetsjv2006.pdf) | 2006 | $4,318 | $393 | $65 | **$7,297** |
| Dry beans | Dry beans | southSJV | [Blackeye beans, San Joaquin Valley South](https://ucanr.edu/sites/default/files/2026-09/FINAL%20blackeyebeans-sjv-south-2026.pdf) | 2026 | $1,951 | $0 | $125 | **$1,826** |
| Dry beans | Dry beans | default | [Garbanzo beans, Sacramento & North San Joaquin Valley](https://coststudyfiles.ucdavis.edu/uploads/cs_public/8c/23/8c232c39-e3b8-4f12-ac02-911cb4602cc2/2018garbanzobeansacvalfinaldraft22018.pdf) | 2018 | $1,177 | $195 | $2 | **$1,251** |
| Plums | Plums | default | [Fresh plums, San Joaquin Valley South](https://coststudyfiles.ucdavis.edu/uploads/cs_public/05/1e/051eabc3-9bdd-45cc-9c85-f122f8f275f0/2016plumssjvfinaldraft112316.pdf) | 2016 | $11,911 | $0 | $231 | **$15,445** |
| Dates | Dates | default | [Dates, Coachella Valley](https://ccfruitandnuts.ucanr.edu/sites/default/files/2011-06/108139.pdf) | 2006 | $4,668 | $0 | $492 | **$7,895** |
| Wild rice | Wild rice | default | [Wild rice, Intermountain](https://coststudyfiles.ucdavis.edu/uploads/cs_public/e2/52/e2525250-9c1e-4279-b0c9-4b182f6f5c4b/wildriceir05.pdf) | 2005 | $709 | $150 | $2 | **$1,113** |
| Peppers | Peppers | default | [Fresh bell peppers, Oxnard Plain (UCCE)](https://ccfruitandnuts.ucanr.edu/sites/default/files/2014-01/179209.pdf) | 2013 | $13,131 | $1,400 | $6 | **$15,431** |
| Pears | Pears | default | [Pears (Green Bartlett), Sacramento River Delta](https://coststudyfiles.ucdavis.edu/2024/05/02/23PearsSV-4.23.24.pdf) | 2023 | $10,036 | $0 | $255 | **$9,781** |
| Apples | Apples | default | [Apples for processing, Central Coast](https://coststudyfiles.ucdavis.edu/uploads/pub/2023/11/13/2023applesccfullfinal-nov23.pdf) | 2023 | $7,166 | $0 | $307 | **$6,859** |
| Pecans | Pecans | default | [Pecans, San Joaquin & Sacramento Valley](https://coststudyfiles.ucdavis.edu/uploads/cs_public/f6/c7/f6c7d8c2-d02a-4c61-a364-6d3b08a5428b/pecansjv2005.pdf) | 2005 | $1,621 | $0 | $77 | **$3,086** |
| Apricots | Apricots | default | [Fresh apricots, San Joaquin Valley](https://coststudyfiles.ucdavis.edu/uploads/cs_public/bb/10/bb101479-e0b0-42e4-aeda-5e94ca48ce56/apricotsfreshsjv.pdf) | 2003 | $3,694 | $0 | $96 | **$7,627** |

## Known weak spots (read before trusting a number)

- **Old studies:** apricots (2003), cantaloupe & sugar beets (2004, old guideline format), pecans,
  safflower, wild rice (2005), dates & sweet potatoes & red onions (2006), blueberries, fresh peaches,
  nectarines (2009). Inflation-adjusted, but rough.
- **Proxies:** Central Coast and foothill wine grapes use the Lodi study; all melons use cantaloupe;
  apples use Central Coast processing apples against "pome fruit" values; olives use the table-olive
  study (oil olives cost far less).
- **Packing mismatches:** potatoes and sweet potatoes exclude packing, so packed-product margins look
  too high; mandarins pack in 5-lb retail cartons, so costs look high.
- **Silage** is valued at feed transfer prices; most is grown by dairies for their own herds.
- **One cost per type and region**: no farm-size, irrigation or variety differences.
- Costs are 2024 dollars; input costs have risen since (diesel hit a record in Sept 2026).

## Adding or changing a crop

1. Add/adjust a `studies` entry (cash, rent, tax, year, url, caveat) and the crop's `variants`
   (CalAg `match` names, cost per `region`) in `data/lookup/economics.json`.
2. `make economics`; review the printed fallbacks, then spot-check a county against its PDF.
