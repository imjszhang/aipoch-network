import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'web',
  publicDir: '../generated',
  base: process.env.SITE_BASE ?? '/',
  build: { outDir: resolve(process.env.BUILD_OUTPUT ?? 'dist'), emptyOutDir: true, sourcemap: false },
  server: { fs: { allow: ['..'] } },
});
