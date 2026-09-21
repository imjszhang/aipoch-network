import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateDiscoveryOutput } from '../../scripts/validate-discovery.js';

const sections = ['explore', 'projects', 'capabilities', 'organizations', 'researchers', 'collections', 'sources'];
async function write(root: string, path: string, value: string) { const file = join(root, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, value); }
async function fixture(t: TestContext, base = '/') {
  const root = await mkdtemp(join(tmpdir(), 'aipoch-discovery-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const details = ['/projects/project~one/', '/projects/project~two/'];
  const paths = ['/', ...sections.map(section => `/${section}/`), ...sections.map(section => `/browse/${section}/`), '/projects/page/2/', ...details];
  await write(root, 'routes.json', JSON.stringify({ base, paths }));
  await write(root, 'internal/catalog.json', JSON.stringify({ catalog: { projects: [{ id: 'project:one' }, { id: 'project:two' }], resources: [], sources: [], organizations: [], actors: [], collections: [], tombstones: [] } }));
  for (const path of [...paths, '/404/']) {
    const browse = path.startsWith('/browse/');
    const canonical = browse ? '' : `<link rel="canonical" href="https://aipoch.network${base}${path.slice(1)}">`;
    const robots = base === '/' && !browse && path !== '/404/' ? 'index, follow' : 'noindex, follow';
    const links = path === '/explore/' ? details : path === '/projects/' ? [details[0], '/projects/page/2/'] : path === '/projects/page/2/' ? [details[1], '/projects/'] : ['/explore/'];
    const directory = sections.some(section => path === `/${section}/` || path.startsWith(`/${section}/page/`));
    const listed = links.filter(link => details.includes(link));
    const jsonLd = directory && base === '/' ? `<script type="application/ld+json">${JSON.stringify({ '@type': 'CollectionPage', mainEntity: { '@type': 'ItemList', numberOfItems: listed.length, itemListElement: listed.map((link, index) => ({ position: index + 1, url: `https://aipoch.network${link}` })) } })}</script>` : '';
    const html = `<html><head>${canonical}<meta name="robots" content="${robots}">${jsonLd}</head><body><div class="results-list">${links.map(link => `<a class="panel simple-card" href="${base}${link.slice(1)}">Read</a>`).join('')}</div></body></html>`;
    await write(root, path === '/404/' ? '404.html' : `${path.slice(1)}index.html`, html);
  }
  await write(root, 'sitemap.xml', `<urlset>${base === '/' ? details.map(path => `<url><loc>https://aipoch.network${path}</loc></url>`).join('') : ''}</urlset>`);
  return root;
}

test('independent static checks verify the same graph under root and Pages subpath', async t => {
  for (const base of ['/', '/aipoch-network/']) {
    const root = await fixture(t, base);
    const result = await validateDiscoveryOutput(root, { base });
    assert.equal(result.reachableDetails, 2);
    assert.equal(result.sitemapUrls, base === '/' ? 2 : 0);
  }
});

test('initial robots and canonical errors cannot pass by sharing the renderer decision code', async t => {
  for (const [path, rewrite, error] of [
    ['projects/index.html', (html: string) => html.replace('index, follow', 'noindex, follow'), /inconsistent initial robots/],
    ['projects/index.html', (html: string) => html.replace('</head>', '<meta name="robots" content="index, follow"></head>'), /exactly one initial robots/],
    ['projects/index.html', (html: string) => html.replace('https://aipoch.network/projects/', 'https://aipoch.network/'), /does not self-canonicalize/],
    ['browse/projects/index.html', (html: string) => html.replace('</head>', '<link rel="canonical" href="https://aipoch.network/projects/"></head>'), /inconsistent canonical count/],
  ] as const) {
    const root = await fixture(t);
    await write(root, path, rewrite(await readFile(join(root, path), 'utf8')));
    await assert.rejects(validateDiscoveryOutput(root), error);
  }
});

test('sitemap rejects noindex pages, query variants and duplicate URLs', async t => {
  for (const [locs, error] of [
    [['https://aipoch.network/browse/projects/'], /missing or noindex/],
    [['https://aipoch.network/projects/?q=test'], /invalid sitemap URL/],
    [['https://aipoch.network/projects/', 'https://aipoch.network/projects/'], /duplicate sitemap URL/],
  ] as const) {
    const root = await fixture(t);
    await write(root, 'sitemap.xml', `<urlset>${locs.map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`);
    await assert.rejects(validateDiscoveryOutput(root), error);
  }
});

test('each directory must expose its own pagination and details through real anchor links', async t => {
  const root = await fixture(t);
  const file = 'projects/index.html', html = await readFile(join(root, file), 'utf8');
  await write(root, file, html.replace('<a class="panel simple-card" href="/projects/page/2/">Read</a>', '<script>const link = "<a href=\"/projects/page/2/\">Read</a>";</script>'));
  await assert.rejects(validateDiscoveryOutput(root), /pagination is unreachable/);
  await write(root, file, html);
  const second = await readFile(join(root, 'projects/page/2/index.html'), 'utf8');
  await write(root, 'projects/page/2/index.html', second.replace('href="/projects/project~two/"', 'href="/projects/project~two/?q=hidden"'));
  await assert.rejects(validateDiscoveryOutput(root), /ItemList count disagrees|detail is unreachable through projects/);
});

test('missing generated entity routes fail even when the sitemap omits them', async t => {
  const root = await fixture(t);
  const routes = JSON.parse(await readFile(join(root, 'routes.json'), 'utf8'));
  routes.paths = routes.paths.filter((path: string) => path !== '/projects/project~two/');
  await write(root, 'routes.json', JSON.stringify(routes));
  await write(root, 'sitemap.xml', '<urlset></urlset>');
  await assert.rejects(validateDiscoveryOutput(root), /catalog detail has no published route/);
});

test('directory discovery cannot silently skip coverage when the catalog graph is absent', async t => {
  const root = await fixture(t);
  await write(root, 'internal/catalog.json', '{}');
  await assert.rejects(validateDiscoveryOutput(root), /missing its catalog graph/);
});

test('structured data must describe the actual static directory links in their visible order', async t => {
  const root = await fixture(t);
  const file = 'explore/index.html', html = await readFile(join(root, file), 'utf8');
  await write(root, file, html.replace('"position":1', '"position":2'));
  await assert.rejects(validateDiscoveryOutput(root), /ItemList order disagrees/);
});

test('provenance links within result rows do not become additional ItemList entries', async t => {
  const root = await fixture(t);
  const file = 'explore/index.html', html = await readFile(join(root, file), 'utf8');
  const row = '<article class="project-row"><div class="row-title"><a href="/projects/project~one/">First</a></div><div class="row-meta"><a href="/projects/project~two/">Related provenance</a></div></article>';
  await write(root, file, html.replace('<a class="panel simple-card" href="/projects/project~one/">Read</a>', row));
  assert.equal((await validateDiscoveryOutput(root)).reachableDetails, 2);
});
