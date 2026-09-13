import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { resolveWorkbenchMode, type WorkbenchMode } from '../web/src/build-mode.js';

/** User-supplied product artwork is an asset, never a runtime reference to the design workspace. */
export function designAssetsPlugin(): Plugin {
  let mode: WorkbenchMode;
  const files = [
    { source: 'open-science-product-v9-r2.jpg', output: 'assets/open-science-product-v9-r2.jpg', type: 'image/jpeg' },
    { source: 'open-science-product-v9-r2.md', output: 'assets/open-science-product-notice.txt', type: 'text/plain; charset=utf-8' },
  ];
  return {
    name: 'aipoch-design-assets',
    config() {
      mode = resolveWorkbenchMode(process.env);
      return { define: { __AIPOCH_WORKBENCH_MODE__: JSON.stringify(mode) } };
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        const asset = files.find(file => pathname.endsWith(`/${file.output}`));
        if (!asset) return next();
        try {
          res.setHeader('Content-Type', asset.type);
          res.end(await readFile(resolve('web/src/assets', asset.source)));
        } catch (error) { next(error); }
      });
    },
    async generateBundle() {
      for (const file of files) this.emitFile({ type: 'asset', fileName: file.output, source: await readFile(resolve('web/src/assets', file.source)) });
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify({
        design: 'v9-r2', workbench_mode: mode, real_connector: mode === 'real',
        ...(mode === 'real' ? { connector_protocol: '1.0', connector_endpoint: 'http://127.0.0.1:47821' } : {}),
      }, null, 2) });
    },
  };
}
