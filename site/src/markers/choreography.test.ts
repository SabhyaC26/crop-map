// @vitest-environment jsdom
import type { Marker } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Crop } from '../data/crops';
import { prefersReducedMotion } from '../lib/motion';
import {
  cancelAll,
  drop,
  hideStatic,
  type MarkerItem,
  mergeOut,
  popIn,
  popOut,
  showStatic,
  splitIn,
} from './choreography';

vi.mock('../lib/motion', () => ({ prefersReducedMotion: vi.fn(() => false) }));

/** Stands in for a browser Animation: completion and cancellation are driven by the test. */
class FakeAnimation {
  readonly finished: Promise<void>;
  cancelled = false;
  private resolveFinished: () => void = () => undefined;
  private rejectFinished: (reason: Error) => void = () => undefined;

  constructor(
    readonly keyframes: Keyframe[],
    readonly timing: KeyframeEffectOptions,
  ) {
    this.finished = new Promise<void>((resolve, reject) => {
      this.resolveFinished = resolve;
      this.rejectFinished = reject;
    });
    // Browsers reject `finished` when an animation is cancelled; nothing awaits some of these, so swallow it here.
    this.finished.catch(() => undefined);
  }

  finish(): void {
    this.resolveFinished();
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.rejectFinished(new DOMException('The animation was aborted.', 'AbortError'));
  }
}

const animationsByElement = new Map<HTMLElement, FakeAnimation[]>();

const crop: Crop = { cropId: 1, dwrCode: 'ALM', name: 'Almond', icon: '', color: '#fff', group: 'tree', harvest: null };

function item(state: 'shown' | 'hidden' = 'hidden'): MarkerItem {
  const root = document.createElement('button');
  const fx = document.createElement('span');
  const animations: FakeAnimation[] = [];
  animationsByElement.set(fx, animations);
  fx.animate = ((keyframes: Keyframe[], timing: KeyframeEffectOptions) => {
    const anim = new FakeAnimation(keyframes, timing);
    animations.push(anim);
    return anim as unknown as Animation;
  }) as HTMLElement['animate'];
  root.dataset.state = state;
  return {
    region: {
      id: 'r',
      level: 'fine',
      cropId: 1,
      acres: 100,
      label: 'Region',
      rank: 0,
      parent: 'parent',
      lngLat: [0, 0],
    },
    crop,
    marker: {} as Marker,
    parts: { root, fx, band: document.createElement('span'), label: document.createElement('span'), name: document.createElement('span') },
    size: 32,
    labelWidth: 60,
    parent: null,
    sibling: 0,
    siblingCount: 1,
    anims: [],
    attached: true,
    shown: state === 'shown',
    gateOn: true,
    labelOn: true,
    inert: false,
    bandOpacity: 1,
    bandScale: 1,
    nudgeY: 0,
  };
}

const animsOf = (it: MarkerItem): FakeAnimation[] => animationsByElement.get(it.parts.fx) ?? [];
const stateOf = (it: MarkerItem): string | undefined => it.parts.root.dataset.state;
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frameValue = (anim: FakeAnimation, property: string, index: number): unknown => anim.keyframes[index]?.[property];

const mockComputedStyle = (style: { translate: string; scale: string; opacity: string }) => {
  vi.stubGlobal('getComputedStyle', () => style);
};

beforeEach(() => {
  animationsByElement.clear();
  vi.mocked(prefersReducedMotion).mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('static show and hide', () => {
  it('showStatic makes the marker visible without animating', () => {
    const marker = item('hidden');
    showStatic(marker);
    expect(stateOf(marker)).toBe('shown');
    expect(marker.shown).toBe(true);
    expect(animsOf(marker)).toHaveLength(0);
  });

  it('hideStatic hides the marker and cancels whatever was running', () => {
    const marker = item('shown');
    mergeOut(marker, null, 0);
    const [glide] = animsOf(marker);
    hideStatic(marker);
    expect(glide?.cancelled).toBe(true);
    expect(marker.anims).toEqual([]);
    expect(stateOf(marker)).toBe('hidden');
  });

  it('a static show interrupts a fade-out so its completion cannot hide the marker late', async () => {
    const marker = item('shown');
    popOut(marker, 0);
    showStatic(marker);
    await flush();
    expect(stateOf(marker)).toBe('shown');
  });
});

describe('splitIn', () => {
  it('springs a fine marker out of its parent position and shows it at once', () => {
    const marker = item('hidden');
    splitIn(marker, { x: 10, y: 20 }, 100);
    expect(stateOf(marker)).toBe('shown');

    const [translate, scale, opacity] = animsOf(marker);
    expect(frameValue(translate!, 'translate', 0)).toBe('10.0px 20.0px');
    expect(frameValue(translate!, 'translate', 1)).toBe('0px 0px');
    expect(translate!.timing.delay).toBe(100);
    expect(frameValue(scale!, 'scale', 0)).toBe('0.4');
    expect(frameValue(opacity!, 'opacity', 0)).toBe('0');
    expect(frameValue(opacity!, 'opacity', 1)).toBe(1);
  });

  it('with no parent position it starts from the marker origin', () => {
    const marker = item('hidden');
    splitIn(marker, null, 0);
    const [translate] = animsOf(marker);
    expect(frameValue(translate!, 'translate', 0)).toBe('0px 0px');
  });

  it('under reduced motion it only fades in, with no transform tracks', () => {
    vi.mocked(prefersReducedMotion).mockReturnValue(true);
    const marker = item('hidden');
    splitIn(marker, { x: 10, y: 20 }, 0);
    const anims = animsOf(marker);
    expect(anims).toHaveLength(1);
    expect(Object.keys(anims[0]?.keyframes[0] ?? {})).toEqual(['opacity']);
  });

  it('interrupting a split continues from the current mid-flight transform', () => {
    mockComputedStyle({ translate: '7.0px 3.0px', scale: '0.8', opacity: '0.6' });
    const marker = item('hidden');
    splitIn(marker, { x: 10, y: 20 }, 0);

    mergeOut(marker, null, 0);
    // The split's three tracks come first; the glide's translate, scale and opacity tracks follow.
    const [glideTranslate, glideScale, glideOpacity] = animsOf(marker).slice(3);
    expect(frameValue(glideTranslate!, 'translate', 0)).toBe('7.0px 3.0px');
    expect(frameValue(glideScale!, 'scale', 0)).toBe('0.8');
    expect(frameValue(glideOpacity!, 'opacity', 0)).toBe('0.6');
  });
});

describe('mergeOut', () => {
  it('stays visible while gliding and is hidden only after the glide finishes', async () => {
    const marker = item('shown');
    mergeOut(marker, { x: 5, y: -5 }, 0);
    await flush();
    expect(stateOf(marker)).toBe('shown');

    for (const anim of animsOf(marker)) anim.finish();
    await flush();
    expect(stateOf(marker)).toBe('hidden');
    expect(marker.anims).toEqual([]);
  });

  it('glides into the parent and fades for the last 60% of the glide', () => {
    const marker = item('shown');
    mergeOut(marker, { x: 5, y: -5 }, 0);
    const [translate, , opacity] = animsOf(marker);
    expect(frameValue(translate!, 'translate', 1)).toBe('5.0px -5.0px');
    // Fade starts at 40% of the 440ms glide and lasts the remaining 60%.
    expect(opacity!.timing.delay).toBeCloseTo(176, 0);
    expect(opacity!.timing.duration).toBeCloseTo(264, 0);
  });

  it('a glide superseded by a new show cannot hide the marker when its old animations settle', async () => {
    const marker = item('shown');
    mergeOut(marker, null, 0);
    const oldGlide = animsOf(marker).slice();
    splitIn(marker, null, 0);
    for (const anim of oldGlide) anim.finish();
    await flush();
    expect(stateOf(marker)).toBe('shown');
  });
});

describe('popOut and popIn', () => {
  it('popOut swells past full size and then shrinks to nothing before hiding', async () => {
    const marker = item('shown');
    popOut(marker, 0);
    const [scale] = animsOf(marker);
    expect(scale!.keyframes.map((k) => k.offset)).toEqual([0, 0.3, 1]);
    expect(frameValue(scale!, 'scale', 1)).toBe(1.15);
    expect(frameValue(scale!, 'scale', 2)).toBe(0);

    for (const anim of animsOf(marker)) anim.finish();
    await flush();
    expect(stateOf(marker)).toBe('hidden');
  });

  it('popIn shows the marker immediately and grows it from nothing', () => {
    const marker = item('hidden');
    popIn(marker, 0);
    expect(stateOf(marker)).toBe('shown');
    const [scale] = animsOf(marker);
    expect(frameValue(scale!, 'scale', 0)).toBe('0');
    expect(frameValue(scale!, 'scale', 1)).toBe(1);
  });
});

describe('drop', () => {
  it('starts 190px above the rest position and lands at rest', () => {
    const marker = item('hidden');
    drop(marker, 0);
    const [translate] = animsOf(marker);
    expect(frameValue(translate!, 'translate', 0)).toBe('0px -190px');
    expect(frameValue(translate!, 'translate', 1)).toBe('0px 0px');
  });

  it('squash keyframes have non-decreasing offsets inside the animation', () => {
    const marker = item('hidden');
    drop(marker, 0);
    const scale = animsOf(marker)[1];
    const offsets = (scale?.keyframes ?? []).map((k) => k.offset ?? 0);
    expect(offsets.every((o) => o >= 0 && o <= 1)).toBe(true);
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1] ?? 0);
  });
});

describe('cancelAll', () => {
  it('cancels every in-flight animation without changing visibility', () => {
    const marker = item('shown');
    popOut(marker, 0);
    const anims = animsOf(marker).slice();
    cancelAll(marker);
    expect(anims.every((a) => a.cancelled)).toBe(true);
    expect(marker.anims).toEqual([]);
    expect(stateOf(marker)).toBe('shown');
  });
});
