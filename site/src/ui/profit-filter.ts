import type { ExpressionSpecification } from 'maplibre-gl';
import type { EconomicsIndex, ProfitBasis, ProfitMode, Profitability } from '../data/economics';
import type { EmphasisController, FieldFilter } from './emphasis';

export interface ProfitFilter {
  destroy(): void;
}

interface ProfitFilterOptions {
  economics: EconomicsIndex;
  emphasis: EmphasisController;
  slot: HTMLElement;
}

const MODES: readonly { key: ProfitMode; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'profit', label: 'Profitable' },
  { key: 'loss', label: 'Losing' },
];

const BASES: readonly { key: ProfitBasis; label: string }[] = [
  { key: 'gross', label: 'Gross profit' },
  { key: 'net', label: 'After land' },
];

/** 'p' (profitable), 'l' (losing) or 'n' (no estimate) for a field, from its crop and county. */
function verdictExpression(v: Profitability): ExpressionSpecification {
  const byCrop: unknown[] = ['match', ['get', 'crop_id']];
  // `match` takes its label lists as plain arrays (not wrapped in "literal").
  if (v.profitCrops.length > 0) byCrop.push([...v.profitCrops], 'p');
  if (v.lossCrops.length > 0) byCrop.push([...v.lossCrops], 'l');
  byCrop.push('n');
  const cropVerdict = (byCrop.length > 3 ? byCrop : 'n') as ExpressionSpecification;

  // Counties with their own figures are judged exactly; the rest fall back to the statewide verdict.
  const key: ExpressionSpecification = ['concat', ['to-string', ['get', 'crop_id']], '|', ['coalesce', ['get', 'county'], '']];
  const byCounty: unknown[] = ['match', key];
  if (v.profitKeys.length > 0) byCounty.push([...v.profitKeys], 'p');
  if (v.lossKeys.length > 0) byCounty.push([...v.lossKeys], 'l');
  byCounty.push(cropVerdict);
  return (byCounty.length > 3 ? byCounty : cropVerdict) as ExpressionSpecification;
}

function buildFilter(economics: EconomicsIndex, mode: ProfitMode, basis: ProfitBasis): FieldFilter | null {
  if (mode === 'all') return null;
  const v = economics.profitability(basis);
  return {
    condition: ['==', verdictExpression(v), mode === 'profit' ? 'p' : 'l'],
    cropIds: mode === 'profit' ? v.majorityProfitCrops : v.majorityLossCrops,
  };
}

function segment<T extends string>(
  className: string,
  label: string,
  items: readonly { key: T; label: string }[],
  onPick: (key: T) => void,
): { root: HTMLElement; select(key: T): void } {
  const root = document.createElement('div');
  root.className = className;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', label);
  const buttons = items.map((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pf-btn';
    b.dataset['key'] = item.key;
    b.textContent = item.label;
    b.addEventListener('click', () => onPick(item.key));
    root.append(b);
    return b;
  });
  return {
    root,
    select(key) {
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset['key'] === key));
    },
  };
}

/** "All · Profitable · Losing", with a gross / after-land switch, under the search bar. */
export function createProfitFilter({ economics, emphasis, slot }: ProfitFilterOptions): ProfitFilter {
  let mode: ProfitMode = 'all';
  let basis: ProfitBasis = 'net';

  const root = document.createElement('div');
  root.className = 'pf-root';

  const apply = (): void => {
    modes.select(mode);
    bases.select(basis);
    root.dataset['mode'] = mode;
    bases.root.hidden = mode === 'all';
    emphasis.setFilter(buildFilter(economics, mode, basis));
  };

  const modes = segment(
    'pf-seg pf-modes',
    'Show fields',
    MODES,
    (key) => {
      mode = key;
      apply();
    },
  );
  const bases = segment(
    'pf-seg pf-bases',
    'Profit measured',
    BASES,
    (key) => {
      basis = key;
      apply();
    },
  );

  root.append(modes.root, bases.root);
  slot.append(root);
  apply();

  return {
    destroy() {
      emphasis.setFilter(null);
      root.remove();
    },
  };
}
