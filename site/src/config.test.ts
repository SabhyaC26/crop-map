import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Config from './config';

describe('config', () => {
  let config: typeof Config;

  beforeEach(async () => {
    // config.ts reads import.meta.env once at module evaluation, so each test loads a fresh copy.
    vi.resetModules();
    config = await import('./config');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serves the static data and icons from root-relative paths by default', () => {
    for (const url of [config.FIELDS_URL, config.OVERVIEW_URL, config.FIELDS_LOW_URL, config.BASEMAP_URL, config.REGIONS_URL, config.CROPS_URL]) {
      expect(url.startsWith('/')).toBe(true);
    }
    expect(config.ICONS_BASE.endsWith('/')).toBe(true);
  });

  it('defaults terrain to a public terrarium tile template with z/x/y placeholders', () => {
    expect(config.TERRAIN_TILES_URL).toMatch(/^https:\/\//);
    for (const placeholder of ['{z}', '{x}', '{y}']) {
      expect(config.TERRAIN_TILES_URL).toContain(placeholder);
    }
  });

  it('uses VITE_* overrides when they are set', async () => {
    vi.stubEnv('VITE_FIELDS_URL', 'https://tiles.example.com/fields.pmtiles');
    vi.stubEnv('VITE_TERRAIN_URL', 'https://terrain.example.com/{z}/{x}/{y}.png');
    vi.resetModules();
    const overridden = await import('./config');
    expect(overridden.FIELDS_URL).toBe('https://tiles.example.com/fields.pmtiles');
    expect(overridden.TERRAIN_TILES_URL).toBe('https://terrain.example.com/{z}/{x}/{y}.png');
    expect(overridden.OVERVIEW_URL).toBe('/data/overview.pmtiles');
  });

  it('treats an empty VITE_* override as unset and keeps the default', async () => {
    vi.stubEnv('VITE_FIELDS_URL', '');
    vi.resetModules();
    const overridden = await import('./config');
    expect(overridden.FIELDS_URL).toBe('/data/fields.pmtiles');
  });
});
