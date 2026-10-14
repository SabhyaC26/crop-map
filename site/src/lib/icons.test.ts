// @vitest-environment jsdom
import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type * as Icons from './icons';
import type { Crop } from '../data/crops';

const MANIFEST = { almond: 'almond.svg', grapes: 'grapes.webp', broken: 'broken.webp' };
const CANVAS_PX = 128;

class FakeImage {
  static instances: FakeImage[] = [];
  decoding = '';
  width = 0;
  height = 0;
  src = '';
  constructor() {
    FakeImage.instances.push(this);
  }
  /** Artwork whose file name contains "broken" fails to decode, like a 404 or a corrupt image. */
  decode(): Promise<void> {
    return this.src.includes('broken') ? Promise.reject(new Error('decode failed')) : Promise.resolve();
  }
}

interface FakeContext {
  save: Mock;
  restore: Mock;
  beginPath: Mock;
  arc: Mock;
  fill: Mock;
  drawImage: Mock;
  createRadialGradient: Mock;
  getImageData: Mock;
}

function createContext(): FakeContext {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    getImageData: vi.fn(() => ({ width: CANVAS_PX, height: CANVAS_PX, data: new Uint8ClampedArray(CANVAS_PX * CANVAS_PX * 4) })),
  };
}

function createMap(alreadyHave: string[] = []) {
  const images = new Map<string, { data: unknown; options: unknown }>(
    alreadyHave.map((id) => [id, { data: null, options: null }]),
  );
  const addImage = vi.fn((id: string, data: unknown, options: unknown) => {
    images.set(id, { data, options });
  });
  const hasImage = vi.fn((id: string) => images.has(id));
  return { map: { addImage, hasImage } as unknown as MapLibreMap, addImage, hasImage, images };
}

function crop(icon: string, cropId = 1): Crop {
  return { cropId, dwrCode: 'X', name: icon, icon, color: '#ffffff', group: 'Test', harvest: null };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

describe('icons', () => {
  let icons: typeof Icons;
  let fetchMock: Mock<(url: string) => Promise<Response>>;
  let ctx: FakeContext;

  beforeEach(async () => {
    // icons.ts caches the manifest promise at module level, so every test needs a fresh module instance.
    vi.resetModules();
    icons = await import('./icons');
    FakeImage.instances = [];
    fetchMock = vi.fn((_url: string) => Promise.resolve(jsonResponse(MANIFEST)));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Image', FakeImage);
    ctx = createContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ctx as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('loadIconManifest', () => {
    it('fetches the manifest from the icon base and returns it', async () => {
      await expect(icons.loadIconManifest()).resolves.toEqual(MANIFEST);
      expect(fetchMock).toHaveBeenCalledWith('/icons/manifest.json');
    });

    it('fetches only once and reuses the result for later callers', async () => {
      const [a, b] = await Promise.all([icons.loadIconManifest(), icons.loadIconManifest()]);
      await icons.loadIconManifest();
      expect(a).toBe(b);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects with the HTTP status when the manifest request fails', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 404));
      await expect(icons.loadIconManifest()).rejects.toThrow('icons manifest: HTTP 404');
    });

    it.fails('retries the manifest after a failed request instead of caching the failure', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 503));
      await expect(icons.loadIconManifest()).rejects.toThrow();
      await expect(icons.loadIconManifest()).resolves.toEqual(MANIFEST);
    });
  });

  describe('iconUrl', () => {
    it('resolves a slug through the manifest file name', () => {
      expect(icons.iconUrl(MANIFEST, 'almond')).toBe('/icons/almond.svg');
    });

    it('falls back to <slug>.png for slugs missing from the manifest', () => {
      expect(icons.iconUrl(MANIFEST, 'pear')).toBe('/icons/pear.png');
    });
  });

  describe('registerCropIcons', () => {
    it('adds one map image per distinct icon, keyed icon-<slug> at 4x pixel ratio', async () => {
      const { map, addImage } = createMap();
      await icons.registerCropIcons(map, [crop('almond', 1), crop('almond', 2), crop('grapes', 3)]);

      expect(addImage.mock.calls.map(([id]) => id).sort()).toEqual(['icon-almond', 'icon-grapes']);
      for (const [, , options] of addImage.mock.calls) {
        expect(options).toEqual({ pixelRatio: 4 });
      }
    });

    it('loads artwork from the URL the manifest resolves to', async () => {
      const { map } = createMap();
      await icons.registerCropIcons(map, [crop('almond'), crop('grapes', 2)]);
      expect(FakeImage.instances.map((img) => img.src).sort()).toEqual(['/icons/almond.svg', '/icons/grapes.webp']);
    });

    it('skips icons the map already has, without downloading them again', async () => {
      const { map, addImage } = createMap(['icon-almond']);
      await icons.registerCropIcons(map, [crop('almond'), crop('grapes', 2)]);
      expect(FakeImage.instances.map((img) => img.src)).toEqual(['/icons/grapes.webp']);
      expect(addImage.mock.calls.map(([id]) => id)).toEqual(['icon-grapes']);
    });

    it('rasterises a 128px canvas and pushes its pixels to the map', async () => {
      const { map, addImage } = createMap();
      await icons.registerCropIcons(map, [crop('almond')]);
      const [, data] = addImage.mock.calls[0] ?? [];
      expect(ctx.getImageData).toHaveBeenCalledWith(0, 0, CANVAS_PX, CANVAS_PX);
      expect(data).toEqual(ctx.getImageData.mock.results[0]?.value);
    });

    it('paints the glyph horizontally centred on a disc that fits the canvas', async () => {
      const { map } = createMap();
      await icons.registerCropIcons(map, [crop('almond')]);

      const [, x, y, w, h] = ctx.drawImage.mock.calls[0] ?? [];
      expect(x + w / 2).toBe(CANVAS_PX / 2);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + h).toBeLessThanOrEqual(CANVAS_PX);

      const [discX, discY, discR] = ctx.arc.mock.calls[0] ?? [];
      expect(discX).toBe(CANVAS_PX / 2);
      expect(discY - discR).toBeGreaterThanOrEqual(0);
      expect(discY + discR).toBeLessThanOrEqual(CANVAS_PX);
    });

    it('rejects when the manifest cannot be loaded', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));
      const { map, addImage } = createMap();
      await expect(icons.registerCropIcons(map, [crop('almond')])).rejects.toThrow('HTTP 500');
      expect(addImage).not.toHaveBeenCalled();
    });

    it.fails('still registers the other icons when one artwork fails to load', async () => {
      const { map, images } = createMap();
      await expect(icons.registerCropIcons(map, [crop('almond'), crop('broken', 2)])).resolves.toBeUndefined();
      expect(images.has('icon-almond')).toBe(true);
    });
  });
});
