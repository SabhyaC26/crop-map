import { ECONOMICS_URL } from '../config';

/**
 * Per-acre unit economics for a crop in a county: crop sales minus the cost of growing it
 * (gross profit), minus the yearly cost of the land (profit after land). Taxes and amortization
 * are out of scope.
 */
export interface CropEconomics {
  cropId: number;
  /** County the yield and price come from, or 'California' for the statewide fallback. */
  county: string;
  isStatewide: boolean;
  /** Commodity type assumed when the map crop covers several (e.g. "Wine grapes"), else null. */
  variant: string | null;
  /** Share of the crop's acres in this county that are the assumed type (0..1), else null. */
  variantShare: number | null;
  /** Year of the yield and price. */
  year: number;
  /** Sale units per acre (e.g. 1900 lb, 6.78 ton). */
  yield: number;
  unit: string;
  /** Dollars per sale unit. */
  price: number;
  /** By-product sales per acre (almond hulls, straw...). */
  extras: readonly { label: string; perAcre: number }[];
  growingCost: number;
  /** How the growing cost was derived, one arithmetic step per line. */
  costSteps: readonly string[];
  costCaveat: string | null;
  /** Yearly land cost per acre: cash rent, or the cost of capital on owned land. */
  landCost: number;
  landBasis: 'rent' | 'owned';
  landSteps: readonly string[];
  revenueSource: Source;
  costSource: Source;
}

export interface Source {
  label: string;
  /** Short attribution for the one-line basis, e.g. "UC Davis". */
  short: string;
  url: string;
}

export interface EconomicsResult {
  revenuePerAcre: number;
  costPerAcre: number;
  grossPerAcre: number;
  landPerAcre: number;
  /** Profit after land: gross profit minus the yearly land cost. */
  netPerAcre: number;
  revenue: number;
  cost: number;
  gross: number;
  land: number;
  net: number;
  /** Gross profit as a share of revenue. */
  margin: number;
  netMargin: number;
  /** Price per sale unit at which gross profit is zero (by-products held constant). */
  breakEvenPrice: number;
  /** Price per sale unit that also covers the land cost. */
  breakEvenPriceWithLand: number;
}

/** Map-wide profit filter: show every field, or only those that make / lose money. */
export type ProfitMode = 'all' | 'profit' | 'loss';
/** Which profit the filter judges by: before land (gross) or after the yearly land cost. */
export type ProfitBasis = 'gross' | 'net';

/** Profit (gross or after land) as verdicts the map can style fields by. */
export interface Profitability {
  /** `${cropId}|${county}` for crops in counties with their own figures. */
  readonly profitKeys: readonly string[];
  readonly lossKeys: readonly string[];
  /** Statewide verdict per crop, for counties without their own figures. */
  readonly profitCrops: readonly number[];
  readonly lossCrops: readonly number[];
  /** Verdict held by most of a crop's acres, for zoomed-out layers that carry no county. */
  readonly majorityProfitCrops: readonly number[];
  readonly majorityLossCrops: readonly number[];
}

export interface EconomicsIndex {
  get(cropId: number, county: string): CropEconomics | undefined;
  profitability(basis: ProfitBasis): Profitability;
}

interface EconomicsFile {
  sources: Record<string, Source>;
  crops: Record<string, { unit: string }>;
  costs: Record<
    string,
    {
      growingCost: number;
      source: string;
      steps: string[];
      caveat: string | null;
      landCost: number;
      landBasis: 'rent' | 'owned';
      landSteps: string[];
    }
  >;
  entries: {
    cropId: number;
    county: string;
    statewide: boolean;
    year: number;
    source: string;
    variant: string | null;
    variantShare: number | null;
    acres?: number;
    cost: string;
    yield: number;
    price: number;
    extras: { label: string; perAcre: number }[];
  }[];
}

/** County name the USDA compilation uses for its statewide row. */
const STATE_TOTAL = 'state total';

const MISSING_SOURCE: Source = { label: 'Unknown source', short: 'unknown', url: '' };

/** "San Joaquin County" and "san joaquin" both key to "san joaquin". */
export const countyKey = (county: string): string => county.trim().toLowerCase().replace(/\s+county$/, '');

export function buildEconomicsIndex(file: EconomicsFile): EconomicsIndex {
  const byKey = new Map<string, CropEconomics>();
  for (const e of file.entries) {
    const cost = file.costs[e.cost];
    const crop = file.crops[String(e.cropId)];
    if (!cost || !crop) continue;
    byKey.set(`${e.cropId}|${countyKey(e.county)}`, {
      cropId: e.cropId,
      county: countyKey(e.county) === STATE_TOTAL ? 'California' : e.county,
      isStatewide: e.statewide,
      variant: e.variant,
      variantShare: e.variantShare,
      year: e.year,
      yield: e.yield,
      unit: crop.unit,
      price: e.price,
      extras: e.extras,
      growingCost: cost.growingCost,
      costSteps: cost.steps,
      costCaveat: cost.caveat,
      landCost: cost.landCost,
      landBasis: cost.landBasis,
      landSteps: cost.landSteps,
      revenueSource: file.sources[e.source] ?? MISSING_SOURCE,
      costSource: file.sources[cost.source] ?? MISSING_SOURCE,
    });
  }
  // Counties without their own figures fall back to the statewide row.
  const get = (cropId: number, county: string): CropEconomics | undefined =>
    byKey.get(`${cropId}|${countyKey(county)}`) ?? byKey.get(`${cropId}|${STATE_TOTAL}`);
  const verdicts = new Map<ProfitBasis, Profitability>();
  return {
    get,
    profitability(basis) {
      let v = verdicts.get(basis);
      if (!v) verdicts.set(basis, (v = buildProfitability(file, byKey, basis)));
      return v;
    },
  };
}

function buildProfitability(
  file: EconomicsFile,
  byKey: ReadonlyMap<string, CropEconomics>,
  basis: ProfitBasis,
): Profitability {
  const perAcre = (e: CropEconomics): number => {
    const r = computeEconomics(e, 1);
    return basis === 'gross' ? r.grossPerAcre : r.netPerAcre;
  };
  const profitKeys: string[] = [];
  const lossKeys: string[] = [];
  const profitCrops: number[] = [];
  const lossCrops: number[] = [];
  const acresByVerdict = new Map<number, { profit: number; loss: number }>();
  for (const raw of file.entries) {
    const e = byKey.get(`${raw.cropId}|${countyKey(raw.county)}`);
    if (!e) continue;
    const profitable = perAcre(e) > 0;
    if (e.isStatewide && countyKey(raw.county) === STATE_TOTAL) {
      (profitable ? profitCrops : lossCrops).push(raw.cropId);
      continue;
    }
    // Field tiles carry the county name as written in the crop reports (e.g. "San Joaquin").
    (profitable ? profitKeys : lossKeys).push(`${raw.cropId}|${raw.county}`);
    const tally = acresByVerdict.get(raw.cropId) ?? { profit: 0, loss: 0 };
    tally[profitable ? 'profit' : 'loss'] += raw.acres ?? 0;
    acresByVerdict.set(raw.cropId, tally);
  }
  const majorityProfitCrops: number[] = [];
  const majorityLossCrops: number[] = [];
  const cropIds = new Set([...profitCrops, ...lossCrops, ...acresByVerdict.keys()]);
  for (const id of cropIds) {
    const t = acresByVerdict.get(id);
    const profitable = t && t.profit + t.loss > 0 ? t.profit > t.loss : profitCrops.includes(id);
    (profitable ? majorityProfitCrops : majorityLossCrops).push(id);
  }
  return { profitKeys, lossKeys, profitCrops, lossCrops, majorityProfitCrops, majorityLossCrops };
}

const EMPTY_INDEX: EconomicsIndex = {
  get: () => undefined,
  profitability: () => ({
    profitKeys: [],
    lossKeys: [],
    profitCrops: [],
    lossCrops: [],
    majorityProfitCrops: [],
    majorityLossCrops: [],
  }),
};

/** Economics are an optional layer: a missing or broken file just means no estimates. */
export async function loadEconomics(url: string = ECONOMICS_URL): Promise<EconomicsIndex> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`economics.json: HTTP ${res.status}`);
    return buildEconomicsIndex((await res.json()) as EconomicsFile);
  } catch (err) {
    console.warn('crop economics unavailable', err);
    return EMPTY_INDEX;
  }
}

export function computeEconomics(e: CropEconomics, acres: number): EconomicsResult {
  const extrasPerAcre = e.extras.reduce((sum, x) => sum + x.perAcre, 0);
  const revenuePerAcre = e.yield * e.price + extrasPerAcre;
  const grossPerAcre = revenuePerAcre - e.growingCost;
  const netPerAcre = grossPerAcre - e.landCost;
  return {
    revenuePerAcre,
    costPerAcre: e.growingCost,
    grossPerAcre,
    landPerAcre: e.landCost,
    netPerAcre,
    revenue: revenuePerAcre * acres,
    cost: e.growingCost * acres,
    gross: grossPerAcre * acres,
    land: e.landCost * acres,
    net: netPerAcre * acres,
    margin: revenuePerAcre > 0 ? grossPerAcre / revenuePerAcre : 0,
    netMargin: revenuePerAcre > 0 ? netPerAcre / revenuePerAcre : 0,
    breakEvenPrice: e.yield > 0 ? (e.growingCost - extrasPerAcre) / e.yield : 0,
    breakEvenPriceWithLand: e.yield > 0 ? (e.growingCost + e.landCost - extrasPerAcre) / e.yield : 0,
  };
}
