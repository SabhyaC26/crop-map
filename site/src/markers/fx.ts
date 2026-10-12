type FxProperty = 'translate' | 'scale' | 'opacity';

export interface FxFrame {
  value: string | number;
  /** 0..1 position in the animation; omitted frames are spread evenly. */
  at?: number;
  /** Easing from this frame to the next. */
  easing?: string;
}

export interface FxTiming {
  duration: number;
  delay?: number;
  easing?: string;
}

export interface FxSnapshot {
  translate: string;
  scale: string;
  opacity: string;
}

export const REST: FxSnapshot = { translate: '0px 0px', scale: '1', opacity: '1' };

/** Current (mid-animation) transform state, so an interrupted animation continues from where it is. */
export function snapshot(el: HTMLElement): FxSnapshot {
  const cs = getComputedStyle(el);
  return {
    translate: cs.translate === 'none' ? REST.translate : cs.translate,
    scale: cs.scale === 'none' ? REST.scale : cs.scale,
    opacity: cs.opacity,
  };
}

/** One independently eased track on an individual transform property. */
export function track(el: HTMLElement, property: FxProperty, frames: readonly FxFrame[], timing: FxTiming): Animation {
  const keyframes: Keyframe[] = frames.map((f) => {
    const frame: Keyframe = { [property]: f.value };
    if (f.at !== undefined) frame.offset = f.at;
    if (f.easing !== undefined) frame.easing = f.easing;
    return frame;
  });
  return el.animate(keyframes, {
    duration: timing.duration,
    delay: timing.delay ?? 0,
    easing: timing.easing ?? 'linear',
    fill: 'both',
  });
}

export const settled = (animations: readonly Animation[]): Promise<void> =>
  Promise.all(animations.map((a) => a.finished)).then(() => undefined);
