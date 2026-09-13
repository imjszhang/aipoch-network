import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { allEntries, routeFor, tombstoneRoutesFor, type SiteData } from '../web/src/model.js';
import { renderPage } from './render-page.js';
import { DEMO_MODE } from '../web/src/build-mode.js';

const base = process.env.SITE_BASE ?? '/';
const output = process.env.BUILD_OUTPUT ?? 'dist';
if (!/^\/(?:[a-zA-Z0-9._-]+\/)*$/.test(base)) throw new Error('SITE_BASE must be / or a slash-terminated static path');
const data = JSON.parse(await readFile('generated/internal/catalog.json', 'utf8')) as SiteData;
const template = await readFile(join(output, 'index.html'), 'utf8');
const entries = allEntries(data.catalog);
const paths = ['/', '/explore/', '/projects/', '/capabilities/', '/organizations/', '/researchers/', '/collections/', '/sources/', '/community/', '/submit/', '/join/', '/me/', '/contribute/', ...(DEMO_MODE ? ['/review/'] : []), ...entries.map(routeFor), ...data.catalog.tombstones.flatMap(tombstoneRoutesFor), '/404/'];
for (const path of paths) {
  const html = renderPage(template, data, path, base);
  const file = path === '/404/' ? join(output, '404.html') : join(output, path.slice(1), 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file,html);
}
await writeFile(join(output, '.nojekyll'),'');
await writeFile(join(output, 'routes.json'), JSON.stringify({ base, paths: paths.filter(path => path !== '/404/'), snapshot_id: data.snapshot_id },null,2));
console.log(`Prerendered ${paths.length} pages with static deep links at ${base}.`);
