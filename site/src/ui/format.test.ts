// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ICONS_BASE } from '../config';
import { cropImg, el, formatAcres, svg } from './format';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('formatAcres', () => {
  it('prints whole acres below 1,000', () => {
    expect(formatAcres(0)).toBe('0');
    expect(formatAcres(42.4)).toBe('42');
    expect(formatAcres(999.4)).toBe('999');
  });

  it('switches to one-decimal thousands from 1k and trims a trailing .0', () => {
    expect(formatAcres(1000)).toBe('1k');
    expect(formatAcres(1500)).toBe('1.5k');
    expect(formatAcres(2000)).toBe('2k');
    expect(formatAcres(2400)).toBe('2.4k');
  });

  it('switches to whole thousands from 10k', () => {
    expect(formatAcres(10_000)).toBe('10k');
    expect(formatAcres(12_345)).toBe('12k');
    expect(formatAcres(99_400)).toBe('99k');
  });

  it('switches to millions from 1M and keeps one decimal', () => {
    expect(formatAcres(1_000_000)).toBe('1M');
    expect(formatAcres(2_000_000)).toBe('2M');
    expect(formatAcres(2_500_000)).toBe('2.5M');
    expect(formatAcres(1_234_567)).toBe('1.2M');
  });

  // Bug: 999,999 rounds to "1000k" because the k branch uses Math.round and never hands off to M.
  it.fails('hands off to millions instead of printing 1000k', () => {
    expect(formatAcres(999_999)).toBe('1M');
  });

  // Bug: 999.6 acres falls through to the plain-number branch and prints "1000" instead of "1k".
  it.fails('does not print a four-digit plain number at the 1k boundary', () => {
    expect(formatAcres(999.6)).toBe('1k');
  });
});

describe('el', () => {
  it('creates an element with class and text', () => {
    const node = el('p', 'note', 'hello');
    expect(node.tagName).toBe('P');
    expect(node.className).toBe('note');
    expect(node.textContent).toBe('hello');
  });

  it('leaves the class empty and the text unset when omitted', () => {
    const node = el('div');
    expect(node.className).toBe('');
    expect(node.textContent).toBe('');
  });

  it('inserts text as plain text, never as markup', () => {
    const payload = '<img src=x onerror="alert(1)"><b>bold</b>';
    const node = el('span', undefined, payload);
    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('b')).toBeNull();
    expect(node.textContent).toBe(payload);
  });
});

describe('svg', () => {
  it('creates an SVG-namespace icon with the standard attributes', () => {
    const node = svg('icon-x', ['M0 0'], 3);
    expect(node.namespaceURI).toBe(SVG_NS);
    expect(node.getAttribute('class')).toBe('icon-x');
    expect(node.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(node.getAttribute('aria-hidden')).toBe('true');
    expect(node.getAttribute('stroke')).toBe('currentColor');
    expect(node.getAttribute('stroke-width')).toBe('3');
  });

  it('defaults the stroke width to 2.4', () => {
    expect(svg('icon', []).getAttribute('stroke-width')).toBe('2.4');
  });

  it('renders one path per d string, in order', () => {
    const node = svg('icon', ['M1 1', 'L2 2', 'Z']);
    const ds = Array.from(node.querySelectorAll('path'), (p) => p.getAttribute('d'));
    expect(ds).toEqual(['M1 1', 'L2 2', 'Z']);
  });
});

describe('cropImg', () => {
  it('points at the manifest file for the crop icon slug', () => {
    const img = cropImg({ almond: 'almond-v2.png' }, { icon: 'almond' }, 'cs-icon');
    expect(img.getAttribute('src')).toBe(`${ICONS_BASE}almond-v2.png`);
  });

  it('falls back to <slug>.png when the manifest has no entry', () => {
    const img = cropImg({}, { icon: 'kiwi' }, 'cs-icon');
    expect(img.getAttribute('src')).toBe(`${ICONS_BASE}kiwi.png`);
  });

  it('is decorative: empty alt, not draggable, async decoding, keeps its class', () => {
    const img = cropImg({}, { icon: 'kiwi' }, 'cs-icon');
    expect(img.className).toBe('cs-icon');
    expect(img.alt).toBe('');
    expect(img.draggable).toBe(false);
    expect(img.decoding).toBe('async');
  });
});
