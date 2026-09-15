import { defineConfig } from 'vite';
import { siteConfigFromEnv } from './web/src/site-url.js';
import { resolve } from 'node:path';
import { thirdPartyNoticesPlugin } from './scripts/third-party-notices.js';
import { designAssetsPlugin } from './scripts/design-assets.js';

export default defineConfig({
  define: { 'import.meta.env.VITE_SITE_INDEXING': JSON.stringify(siteConfigFromEnv().indexing) },
  plugins: [thirdPartyNoticesPlugin(), designAssetsPlugin()],
  root: 'web',
  publicDir: '../generated',
  base: process.env.SITE_BASE ?? '/',
  build: { outDir: resolve(process.env.BUILD_OUTPUT ?? 'dist'), emptyOutDir: true, sourcemap: false },
  server: { fs: { allow: ['..'] } },
});
