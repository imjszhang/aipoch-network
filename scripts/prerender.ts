import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type SiteData } from '../web/src/model.js';
import { prerenderPaths } from '../web/src/directory-routes.js';
import { renderPage } from './render-page.js';
import { DEMO_MODE } from '../web/src/build-mode.js';
import { robotsText, sitemapEntries, sitemapXml } from '../web/src/seo.js';
import { siteConfigFromEnv } from '../web/src/site-url.js';

const base = process.env.SITE_BASE ?? '/';
const output = process.env.BUILD_OUTPUT ?? 'dist';
const config = siteConfigFromEnv({ ...process.env, SITE_BASE: base });
if (!/^\/(?:[a-zA-Z0-9._-]+\/)*$/.test(base)) throw new Error('SITE_BASE must be / or a slash-terminated static path');
const data = JSON.parse(await readFile('generated/internal/catalog.json', 'utf8')) as SiteData;
data.ui_manifest = JSON.parse(await readFile('generated/internal/ui-manifest.json', 'utf8'));
data.data_kind = 'full';
const template = await readFile(join(output, 'index.html'), 'utf8');
const paths = prerenderPaths(data, DEMO_MODE);
for (const path of paths) {
  const html = renderPage(template, data, path, base, config);
  const file = path === '/404/' ? join(output, '404.html') : join(output, path.slice(1), 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}
const sitemapPaths = paths.filter(path => path !== '/404/');
await writeFile(join(output, 'sitemap.xml'), sitemapXml(sitemapEntries(data, config, sitemapPaths)));
await writeFile(join(output, 'robots.txt'), robotsText(config));
await writeFile(join(output, '.nojekyll'), '');
await writeFile(join(output, 'routes.json'), JSON.stringify({ base, paths: sitemapPaths, snapshot_id: data.snapshot_id }, null, 2));
console.log(`Prerendered ${paths.length} pages with static deep links at ${base}.`);
