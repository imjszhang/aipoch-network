import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { thirdPartyNoticesPlugin } from './scripts/third-party-notices.js';

export default defineConfig({
  plugins: [thirdPartyNoticesPlugin()],
  root: 'web',
  publicDir: '../generated',
  base: process.env.SITE_BASE ?? '/',
  build: { outDir: resolve(process.env.BUILD_OUTPUT ?? 'dist'), emptyOutDir: true, sourcemap: false },
  server: { fs: { allow: ['..'] } },
});
