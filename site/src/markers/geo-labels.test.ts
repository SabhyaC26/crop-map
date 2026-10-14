import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { GEO_LABELS_SOURCE, GEO_POINT_LABEL_LAYER_IDS } from '../style/storybook';
import type { Rect } from './collision';
import { createGeoLabelGuard } from './geo-labels';

interface Hit {
  properties: { name: string };
}

interface FakeMapOptions {
  hasSource?: boolean;
  hasLayers?: boolean;
}

/** A map whose rendered-label query returns whatever `under` currently holds, regardless of the query box. */
const createFakeMap = (options: FakeMapOptions = {}) => {
  const { hasSource = true, hasLayers = true } = options;
  const state: { under: Hit[] } = { under: [] };
  const map = {
    getSource: vi.fn(() => (hasSource ? {} : undefined)),
    getLayer: vi.fn((id: string) => (hasLayers ? { id } : undefined)),
    queryRenderedFeatures: vi.fn((_box: unknown, _opts: unknown) => state.under),
    setFeatureState: vi.fn(),
  };
  return { map, state, asMap: map as unknown as MapLibreMap };
};

const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 });

describe('createGeoLabelGuard', () => {
  it('hides a place name that sits under a placed marker box', () => {
    const { asMap, state, map } = createFakeMap();
    state.under = [{ properties: { name: 'Fresno' } }];
    const guard = createGeoLabelGuard(asMap);

    guard.update([rect(100, 100, 140, 140)]);

    expect(map.setFeatureState).toHaveBeenCalledWith({ source: GEO_LABELS_SOURCE, id: 'Fresno' }, { hidden: true });
  });

  it('queries an inset box over only the point label layers', () => {
    const { asMap, map } = createFakeMap();
    const guard = createGeoLabelGuard(asMap);
    expect(GEO_POINT_LABEL_LAYER_IDS.length).toBeGreaterThan(0);

    guard.update([rect(100, 100, 140, 140)]);

    expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
      [
        [103, 103],
        [137, 137],
      ],
      { layers: [...GEO_POINT_LABEL_LAYER_IDS] },
    );
  });

  it('counts a name as covered once even when several boxes reach it', () => {
    const { asMap, state, map } = createFakeMap();
    state.under = [{ properties: { name: 'Fresno' } }];
    const guard = createGeoLabelGuard(asMap);

    guard.update([rect(100, 100, 140, 140), rect(120, 120, 160, 160)]);

    expect(map.setFeatureState).toHaveBeenCalledTimes(1);
  });

  it('does not re-hide a name that stays covered on the next update', () => {
    const { asMap, state, map } = createFakeMap();
    state.under = [{ properties: { name: 'Fresno' } }];
    const guard = createGeoLabelGuard(asMap);
    const placed = [rect(100, 100, 140, 140)];

    guard.update(placed);
    guard.update(placed);

    expect(map.setFeatureState).toHaveBeenCalledTimes(1);
  });

  it('restores a name once no marker covers it anymore', () => {
    const { asMap, state, map } = createFakeMap();
    state.under = [{ properties: { name: 'Fresno' } }];
    const guard = createGeoLabelGuard(asMap);
    guard.update([rect(100, 100, 140, 140)]);

    state.under = [];
    guard.update([]);

    expect(map.setFeatureState).toHaveBeenLastCalledWith({ source: GEO_LABELS_SOURCE, id: 'Fresno' }, { hidden: false });
  });

  it('skips boxes too thin to hold an inset query, but queries boxes just wide enough', () => {
    const { asMap, map } = createFakeMap();
    const guard = createGeoLabelGuard(asMap);

    guard.update([rect(0, 0, 6, 40)]);
    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();

    guard.update([rect(0, 0, 7, 40)]);
    expect(map.queryRenderedFeatures).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the labels source is missing', () => {
    const { asMap, state, map } = createFakeMap({ hasSource: false });
    state.under = [{ properties: { name: 'Fresno' } }];
    const guard = createGeoLabelGuard(asMap);

    guard.update([rect(100, 100, 140, 140)]);

    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
    expect(map.setFeatureState).not.toHaveBeenCalled();
  });

  it('does not query when none of the point label layers exist on the style', () => {
    const { asMap, map } = createFakeMap({ hasLayers: false });
    const guard = createGeoLabelGuard(asMap);

    guard.update([rect(100, 100, 140, 140)]);

    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
  });

  it('destroy restores every label it still has hidden', () => {
    const { asMap, state, map } = createFakeMap();
    state.under = [{ properties: { name: 'Fresno' } }, { properties: { name: 'Visalia' } }];
    const guard = createGeoLabelGuard(asMap);
    guard.update([rect(100, 100, 140, 140)]);

    guard.destroy();

    expect(map.setFeatureState).toHaveBeenCalledWith({ source: GEO_LABELS_SOURCE, id: 'Fresno' }, { hidden: false });
    expect(map.setFeatureState).toHaveBeenCalledWith({ source: GEO_LABELS_SOURCE, id: 'Visalia' }, { hidden: false });
  });
});
