import { describe, expect, it, vi } from 'vitest';
import { buildCropIndex } from '../data/crops';
import type { FieldsLayer } from '../layers/fields';
import { createEmphasis, type EmphasisState, type HighlightSink, type MarkerSink } from './emphasis';

function setup(markers: MarkerSink | undefined = { setHidden: vi.fn() }) {
  const fields = {
    layerIds: [],
    setEmphasis: vi.fn(),
    setSelected: vi.fn(),
    queryAt: vi.fn(() => null),
    isInteractive: vi.fn(() => true),
  } satisfies FieldsLayer;
  const overview: HighlightSink = { setHighlight: vi.fn() };
  const emphasis = createEmphasis({ crops: buildCropIndex([]), fields, overview, markers });
  return { emphasis, fields, overview, markers };
}

const ids = (set: ReadonlySet<number> | null): number[] | null => (set === null ? null : [...set].sort((a, b) => a - b));

describe('createEmphasis', () => {
  it('starts with nothing selected, previewed or dimmed, and pushes no targets', () => {
    const { emphasis, fields, overview } = setup();
    expect(emphasis.state).toEqual({ search: null, selected: new Set(), preview: null, active: null });
    expect(fields.setEmphasis).not.toHaveBeenCalled();
    expect(overview.setHighlight).not.toHaveBeenCalled();
  });

  it('search pins exactly one crop and hides the region markers', () => {
    const { emphasis, fields, overview, markers } = setup();
    emphasis.setSearch(3);
    expect(emphasis.state.search).toBe(3);
    expect(ids(emphasis.state.selected)).toEqual([3]);
    expect(ids(emphasis.state.active)).toEqual([3]);
    expect(fields.setEmphasis).toHaveBeenLastCalledWith([3]);
    expect(overview.setHighlight).toHaveBeenLastCalledWith([3]);
    expect(markers?.setHidden).toHaveBeenLastCalledWith(true);
  });

  it('a new search replaces the previous pinned crop instead of adding to it', () => {
    const { emphasis } = setup();
    emphasis.toggle(7);
    emphasis.setSearch(3);
    expect(ids(emphasis.state.selected)).toEqual([3]);
  });

  it('setSearch(null) clears everything and restores the markers', () => {
    const { emphasis, fields, markers } = setup();
    emphasis.setSearch(3);
    emphasis.setSearch(null);
    expect(emphasis.state.search).toBeNull();
    expect(emphasis.state.active).toBeNull();
    expect(fields.setEmphasis).toHaveBeenLastCalledWith(null);
    expect(markers?.setHidden).toHaveBeenLastCalledWith(false);
  });

  it('toggle adds a crop on the first call and removes it on the second', () => {
    const { emphasis } = setup();
    emphasis.toggle(1);
    expect(ids(emphasis.state.selected)).toEqual([1]);
    emphasis.toggle(1);
    expect(emphasis.state.selected.size).toBe(0);
    expect(emphasis.state.active).toBeNull();
  });

  it('toggling another crop keeps the searched crop pinned', () => {
    const { emphasis } = setup();
    emphasis.setSearch(1);
    emphasis.toggle(2);
    expect(emphasis.state.search).toBe(1);
    expect(ids(emphasis.state.selected)).toEqual([1, 2]);
  });

  it('un-toggling the searched crop from the legend clears search but keeps the rest', () => {
    const { emphasis } = setup();
    emphasis.setSearch(1);
    emphasis.toggle(2);
    emphasis.toggle(1);
    expect(emphasis.state.search).toBeNull();
    expect(ids(emphasis.state.selected)).toEqual([2]);
  });

  it('clear() drops both the search and every legend selection', () => {
    const { emphasis } = setup();
    emphasis.setSearch(1);
    emphasis.toggle(2);
    emphasis.clear();
    expect(emphasis.state).toEqual({ search: null, selected: new Set(), preview: null, active: null });
  });

  it('a hover preview dims others without hiding the markers', () => {
    const { emphasis, fields, markers } = setup();
    emphasis.setPreview(5);
    expect(ids(emphasis.state.active)).toEqual([5]);
    expect(fields.setEmphasis).toHaveBeenLastCalledWith([5]);
    expect(markers?.setHidden).not.toHaveBeenCalledWith(true);
  });

  it('a preview adds to the pinned selection rather than replacing it', () => {
    const { emphasis } = setup();
    emphasis.toggle(1);
    emphasis.setPreview(2);
    expect(ids(emphasis.state.active)).toEqual([1, 2]);
    expect(ids(emphasis.state.selected)).toEqual([1]);
  });

  it('repeating the same preview is a no-op for listeners', () => {
    const { emphasis } = setup();
    const listener = vi.fn();
    emphasis.subscribe(listener);
    emphasis.setPreview(5);
    emphasis.setPreview(5);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('previewing an already pinned crop does not re-push the field targets', () => {
    const { emphasis, fields } = setup();
    emphasis.toggle(1);
    fields.setEmphasis.mockClear();
    emphasis.setPreview(1);
    expect(fields.setEmphasis).not.toHaveBeenCalled();
  });

  it('removing a pinned crop that is still hovered un-hides the markers without re-pushing targets', () => {
    const { emphasis, fields, markers } = setup();
    emphasis.toggle(1);
    emphasis.setPreview(1);
    expect(markers?.setHidden).toHaveBeenLastCalledWith(true);
    fields.setEmphasis.mockClear();
    emphasis.toggle(1);
    expect(fields.setEmphasis).not.toHaveBeenCalled();
    expect(markers?.setHidden).toHaveBeenLastCalledWith(false);
  });

  it('setMarkers hands the current hidden state to a newly attached sink', () => {
    const { emphasis } = setup(undefined);
    emphasis.toggle(4);
    const late: MarkerSink = { setHidden: vi.fn() };
    emphasis.setMarkers(late);
    expect(late.setHidden).toHaveBeenLastCalledWith(true);
  });

  it('works with no marker sink at all', () => {
    const { emphasis } = setup(undefined);
    expect(() => {
      emphasis.setSearch(2);
      emphasis.setPreview(3);
      emphasis.clear();
    }).not.toThrow();
  });

  it('subscribers receive each new state, and unsubscribing stops delivery', () => {
    const { emphasis } = setup();
    const seen: EmphasisState[] = [];
    const unsubscribe = emphasis.subscribe((s) => seen.push(s));
    emphasis.toggle(1);
    unsubscribe();
    emphasis.toggle(2);
    expect(seen).toHaveLength(1);
    expect(ids(seen[0]?.selected ?? null)).toEqual([1]);
  });
});
