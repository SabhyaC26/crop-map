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

const STATIC_PREFIX = /^\/(data|icons|fonts|webfonts)\//;
const STATIC_CACHE = 'public, max-age=86400, stale-while-revalidate=604800';

/** Matches `public/_headers` in local dev/preview so reloads reuse cached tiles, GeoJSON, icons and fonts. */
const staticCacheHeaders = (): Plugin => {
  const attach = (middlewares: { use: (fn: (req: { url?: string }, res: { setHeader: (k: string, v: string) => unknown }, next: () => void) => void) => void }): void => {
    middlewares.use((req, res, next) => {
      if (req.url && STATIC_PREFIX.test(req.url)) {
        const origSetHeader = res.setHeader.bind(res);
        res.setHeader = (name: string, value: string) => {
          if (name.toLowerCase() === 'cache-control') return origSetHeader(name, STATIC_CACHE);
          return origSetHeader(name, value);
        };
        origSetHeader('Cache-Control', STATIC_CACHE);
      }
      next();
    });
  };
  return {
    name: 'static-cache-headers',
    configureServer: (server) => attach(server.middlewares),
    configurePreviewServer: (server) => attach(server.middlewares),
  };
};

export default defineConfig(({ mode }) => ({
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  plugins: [excludePmtilesFromDist(), earlyHints(loadEnv(mode, process.cwd(), 'VITE_')), staticCacheHeaders()],
}));
