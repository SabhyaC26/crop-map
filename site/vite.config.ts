import { readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const dataDir = resolve(import.meta.dirname, 'dist', 'data');

const excludePmtilesFromDist = (): Plugin => ({
  name: 'exclude-pmtiles-from-dist-host-them-separately',
  apply: 'build',
  async closeBundle() {
    const files = await readdir(dataDir).catch(() => [] as string[]);
    await Promise.all(
      files.filter((f) => f.endsWith('.pmtiles')).map((f) => rm(resolve(dataDir, f), { force: true })),
    );
  },
});

export default defineConfig({
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  plugins: [excludePmtilesFromDist()],
});
