import { readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const DEFAULT_TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const BOOT_FETCHES = ['/data/crops.json', '/data/regions.json', '/icons/manifest.json'];

const excludePmtilesFromDist = (): Plugin => {
  let dataDir = '';
  return {
    name: 'exclude-pmtiles-from-dist-host-them-separately',
    apply: 'build',
    configResolved(config) {
      dataDir = resolve(config.root, config.build.outDir, 'data');
    },
    async closeBundle() {
      const files = await readdir(dataDir).catch(() => [] as string[]);
      await Promise.all(
        files.filter((f) => f.endsWith('.pmtiles')).map((f) => rm(resolve(dataDir, f), { force: true })),
      );
    },
  };
};

/** Opens connections to the tile and terrain hosts, and starts the boot JSON, while the JS bundle is still loading. */
const earlyHints = (env: Record<string, string>): Plugin => ({
  name: 'early-connection-hints',
  transformIndexHtml() {
    const urls = [
      env.VITE_BASEMAP_URL,
      env.VITE_FIELDS_URL,
      env.VITE_OVERVIEW_URL,
      env.VITE_FIELDS_LOW_URL,
      env.VITE_TERRAIN_URL ?? DEFAULT_TERRAIN_URL,
    ];
    const origins = new Set(urls.filter((u) => u && /^https?:\/\//.test(u)).map((u) => new URL(u).origin));
    return [
      ...[...origins].map((href) => ({ tag: 'link', attrs: { rel: 'preconnect', href, crossorigin: '' }, injectTo: 'head' as const })),
      ...BOOT_FETCHES.map((href) => ({
        tag: 'link',
        attrs: { rel: 'preload', href, as: 'fetch', crossorigin: '' },
        injectTo: 'head' as const,
      })),
    ];
  },
});

export default defineConfig(({ mode }) => ({
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  plugins: [excludePmtilesFromDist(), earlyHints(loadEnv(mode, process.cwd(), 'VITE_'))],
}));
