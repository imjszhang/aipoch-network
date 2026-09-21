import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../../scripts/render-page.js';
import { createFixtureCatalog, FIXTURE_TIME } from '../../spec/fixtures/catalog.js';
import { allEntries, isSharedCatalogRoute, pageDataForRoute, relatedEntriesFor, routeFor, SHARED_CATALOG_ROUTES, tombstoneRouteFor, type SiteData } from '../../web/src/model.js';
import { HOME_DESCRIPTION, HOME_TITLE } from '../../web/src/seo.js';
import { parseDirectoryPath, directoryPageItems } from '../../web/src/directory-routes.js';
import { verificationData } from '../../scripts/verification-site.js';

const template = '<!doctype html><html><head><title>Original title</title><meta name="description" content="Original description" /></head><body><div id="root"><!--app-html--></div><!--app-data--><script type="module" src="/assets/app.js"></script></body></html>';
const siteData = (): SiteData => ({ snapshot_id: 'render-regression', generated_at: FIXTURE_TIME, catalog: createFixtureCatalog() });
function payload(html: string): SiteData {
  const match = html.match(/<script>window\.__AIPOCH__=([\s\S]*?)<\/script>/);
  assert.ok(match, 'The complete JSON payload is embedded in one script');
  return JSON.parse(match[1]) as SiteData;
}
function decodeText(value: string): string {
  return value.replace(/&(?:amp|quot|lt|gt|#x27|#39);/g, match => ({ '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&#x27;': "'", '&#39;': "'" })[match]!);
}
function checkRetainedSources(data: SiteData): void {
  const sources = new Set(data.catalog.sources.map(source => source.id));
  for (const item of [...data.catalog.projects, ...data.catalog.resources]) for (const ref of item.source_refs) assert.ok(sources.has(ref.source_id), `${item.id} retains ${ref.source_id} needed by the page`);
  for (const item of data.catalog.organizations) for (const source of item.source_ids) assert.ok(sources.has(source), `Organization ${item.id} retains ${source}`);
}

test('source replacement tokens, quotes and script-like text round-trip unchanged through real SSR', () => {
  const hostile = "Original $& prefix $` suffix $' quotes \"' backslash \\ </script><script>alert(\"injected\")</script> <img src=x onerror=alert(1)> \u2028 separator \u2029";
  const data = siteData(), resource = data.catalog.resources[0];
  resource.title = hostile; resource.description = `Description ${hostile}`;
  resource.inputs = [hostile]; resource.outputs = [hostile]; resource.conditions = [hostile];
  const before = structuredClone(data);
  const html = renderPage(template, data, routeFor(resource), '/aipoch-network/');
  const embedded = payload(html), restored = embedded.catalog.resources.find(item => item.id === resource.id)!;
  assert.equal(restored.title, hostile); assert.equal(restored.description, resource.description);
  assert.deepEqual(restored.inputs, [hostile]); assert.deepEqual(restored.outputs, [hostile]); assert.deepEqual(restored.conditions, [hostile]);
  assert.deepEqual(data, before, 'Rendering does not mutate source records');
  assert.deepEqual(embedded, pageDataForRoute(data, routeFor(resource)), 'The entire route payload survives JSON serialization');
  const scriptBody = html.match(/<script>window\.__AIPOCH__=([\s\S]*?)<\/script>/)![1];
  assert.ok(!scriptBody.includes('<')); assert.ok(!scriptBody.includes('\u2028')); assert.ok(!scriptBody.includes('\u2029'));
  assert.equal([...html.matchAll(/<script\b/gi)].length, 2, 'Only the intended payload and module scripts exist');
  assert.equal([...html.matchAll(/<\/script>/gi)].length, 2);
  assert.ok(!html.includes('<script>alert')); assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;/script&gt;&lt;script&gt;alert('), 'React renders script-like source text as escaped text');
  const heading = html.match(/<h1>([\s\S]*?)<\/h1>/)![1];
  assert.equal(decodeText(heading), hostile, 'The visible heading does not interpret replacement tokens');
  const title = html.match(/<title>([\s\S]*?)<\/title>/)![1];
  assert.equal(decodeText(title), `${hostile} | AIPOCH Network`);
  const description = html.match(/<meta name="description" content="([^"]*)"\s*\/>/);
  assert.ok(description, 'Quotes do not terminate the metadata attribute');
  assert.equal(decodeText(description[1]), resource.description);
  assert.equal([...html.matchAll(/<title>/g)].length, 1); assert.equal([...html.matchAll(/<meta name="description"/g)].length, 1);
  assert.ok(!html.includes('<!--app-html-->')); assert.ok(!html.includes('<!--app-data-->'));
});

test('each replacement token independently preserves JSON and page metadata', () => {
  for (const token of ['$&', "$'", '$`', '$$']) {
    const data = siteData(), project = data.catalog.projects[0]; project.title = `Title ${token} end`; project.description = `Description ${token} end`;
    const html = renderPage(template, data, routeFor(project), '/');
    assert.equal(payload(html).catalog.projects[0].title, project.title);
    assert.equal(decodeText(html.match(/<title>([\s\S]*?)<\/title>/)![1]), `${project.title} | AIPOCH Network`);
    assert.equal(decodeText(html.match(/<meta name="description" content="([^"]*)"\s*\/>/)![1]), project.description);
  }
});

test('multi-source organization and project details retain and render every required source', () => {
  const data = siteData();
  for (const entry of [data.catalog.organizations[0], data.catalog.projects[0], data.catalog.resources[1]]) {
    const html = renderPage(template, data, routeFor(entry), '/aipoch-network/');
    const embedded = payload(html); checkRetainedSources(embedded);
    assert.equal(embedded.catalog.sources.length, 2);
    for (const source of data.catalog.sources) assert.ok(html.includes(source.canonical_url), `${entry.kind} renders ${source.id}`);
    assert.ok(!html.includes('Entry not found'));
  }
});

test('collections can render Actor, organization, project and resource references without losing the display graph', () => {
  const data = siteData(), collection = data.catalog.collections[0];
  const actor = data.catalog.actors.find(item => item.account_type === 'user')!;
  collection.item_ids = [actor.id, data.catalog.organizations[0].id, data.catalog.projects[0].id, data.catalog.resources[1].id];
  const html = renderPage(template, data, routeFor(collection), '/aipoch-network/');
  const embedded = payload(html); checkRetainedSources(embedded);
  for (const entry of [actor, data.catalog.organizations[0], data.catalog.projects[0], data.catalog.resources[1]]) {
    assert.ok(html.includes(`href="/aipoch-network${routeFor(entry)}"`));
    assert.ok(html.includes(entry.title));
  }
  assert.ok(!html.includes('Unavailable catalog record'));
});

test('Actor profile and minimal tombstone pages render without client services', () => {
  const data = siteData(), actor = data.catalog.actors.find(item => item.account_type === 'user')!;
  // An independent actor can own multiple sources; its profile needs both observations.
  for (const source of data.catalog.sources) source.owner_id = actor.id;
  const actorHtml = renderPage(template, data, routeFor(actor), '/');
  const actorPayload = payload(actorHtml); checkRetainedSources(actorPayload);
  assert.equal(actorPayload.catalog.sources.length, 2);
  for (const source of data.catalog.sources) assert.ok(actorHtml.includes(source.canonical_url));
  const tombstone = data.catalog.tombstones[0];
  const html = renderPage(template, data, tombstoneRouteFor(tombstone), '/');
  const embedded = payload(html);
  assert.ok(html.includes('Entry withdrawn')); assert.ok(!html.includes('Entry not found'));
  assert.deepEqual(embedded.catalog.tombstones, [tombstone]);
  assert.equal(embedded.catalog.resources.length, 0); assert.equal(embedded.catalog.sources.length, 0);
  assert.ok(!html.includes(data.catalog.resources[0].title));
});

test('all current fixture routes render and route-local detail payloads preserve their source references', () => {
  const data = siteData();
  const paths = ['/', '/explore/', '/projects/', '/capabilities/', '/organizations/', '/researchers/', '/collections/', '/sources/', '/community/', '/submit/', '/404/', ...allEntries(data.catalog).map(routeFor), ...data.catalog.tombstones.map(tombstoneRouteFor)];
  for (const path of paths) {
    const html = renderPage(template, data, path, '/');
    assert.ok(html.includes('Skip to content'), path);
    assert.match(html, /<h1(?:\s[^>]*)?>/, path);
    const embedded = payload(html);
    assert.equal(embedded.snapshot_id, data.snapshot_id);
    assert.equal(embedded.data_kind, 'page');
    checkRetainedSources(embedded);
  }
});

test('directories and action pages retain SSR and safely embed bounded page data for immediate hydration', () => {
  const data = verificationData(1000);
  data.snapshot_id = 'literal $& </script> snapshot';
  for (const path of SHARED_CATALOG_ROUTES) {
    const html = renderPage(template, data, path, '/aipoch-network/');
    const script = html.match(/<script>window\.__AIPOCH__=([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    const embedded = JSON.parse(script) as SiteData;
    assert.equal(embedded.snapshot_id, data.snapshot_id);
    assert.equal(embedded.data_kind, 'page');
    assert.ok(Buffer.byteLength(script) < Buffer.byteLength(JSON.stringify(data)) / 5, 'Page payload does not duplicate the catalog');
    const directory = parseDirectoryPath(path);
    if (directory) {
      const expected = directoryPageItems(data, directory.kind, 1).map(row => row.id);
      assert.deepEqual(embedded.directory_bootstrap?.ids, expected);
      assert.ok(expected.length <= 8);
    } else assert.equal(embedded.directory_bootstrap, undefined);
    assert.ok(!script.includes('<'));
    assert.ok(html.includes('Skip to content'));
    if (path === '/explore/' || path === '/capabilities/') {
      assert.ok(html.includes(data.catalog.resources[0].title));
      assert.ok(html.includes(`href="/aipoch-network${routeFor(data.catalog.resources[0])}"`));
    }
    if (path === '/submit/') assert.ok(html.includes('Public GitHub repository or organization URL'));
  }
});

test('large organization and collection previews retain exactly twenty entries, full counts, and matching View all scopes', () => {
  const data = verificationData(1000, { largeCollection: true }), before = structuredClone(data);
  for (const entry of [data.catalog.organizations[0], data.catalog.collections[0]]) {
    const complete = relatedEntriesFor(entry, data.catalog);
    assert.ok(complete.length > 20);
    const html = renderPage(template, data, routeFor(entry), '/aipoch-network/');
    const selected = payload(html);
    assert.equal(selected.related_totals?.[entry.id], complete.length);
    const retained = [...selected.catalog.organizations, ...selected.catalog.collections].find(row => row.id === entry.id)!;
    assert.equal(relatedEntriesFor(retained, selected.catalog).length, 20);
    assert.deepEqual(relatedEntriesFor(retained, selected.catalog).map(row => row.id), complete.slice(0, 20).map(row => row.id));
    checkRetainedSources(selected);
    assert.ok(html.replace(/<!--[\s\S]*?-->/g, '').includes(`Showing 20 of ${complete.length} related entries.`));
    assert.ok(html.includes(`/aipoch-network/browse/explore/?${entry.kind === 'organization' ? 'organization' : 'collection'}=${encodeURIComponent(entry.id)}`));
    assert.ok(Buffer.byteLength(JSON.stringify(selected)) < 40_000, 'Preview payload stays bounded for this fixture');
  }
  assert.deepEqual(data, before, 'Preview trimming never mutates the authoritative catalog');
});

test('homepage visible metadata and CTAs stay the published baseline', () => {
  const html = renderPage(template, siteData(), '/', '/');
  assert.equal(decodeText(html.match(/<title>([\s\S]*?)<\/title>/)![1]), HOME_TITLE);
  assert.equal(decodeText(html.match(/<meta name="description" content="([^"]*)"\s*\/>/)![1]), HOME_DESCRIPTION);
  assert.match(html, /<h1[^>]*>[\s\S]*Science[\s\S]*Open to All/);
  assert.ok(html.includes('Join with Open-Science'));
  assert.ok(html.includes('Explore AIPOCH Network'));
  assert.ok(html.includes('Connect an existing project'));
  assert.ok(html.includes('src="/assets/open-science-product-v9-r2.jpg"'));
  assert.ok(html.includes('rel="canonical"'));
  assert.ok(!html.includes('SoftwareApplication'));
});

test('build-time directory pages expose distinct raw HTML and pagination hrefs', () => {
  const data = verificationData(80);
  const first = renderPage(template, data, '/capabilities/', '/');
  const second = renderPage(template, data, '/capabilities/page/2/', '/');
  const query = renderPage(template, data, '/capabilities/?page=2', '/');
  assert.ok(isSharedCatalogRoute('/capabilities/page/2/'));
  assert.equal(payload(first).directory_bootstrap?.page, 1);
  assert.equal(payload(second).directory_bootstrap?.page, 2);
  assert.notDeepEqual(payload(first).directory_bootstrap?.ids, payload(second).directory_bootstrap?.ids);
  assert.ok(first.includes('href="/capabilities/page/2/"'));
  assert.ok(second.includes('href="/capabilities/"') || second.includes('href="/capabilities/page/3/"'));
  assert.notEqual(first, second);
  assert.ok(!query.includes('<title>Reusable capabilities, page 2'));
  assert.ok(query.includes('href="https://aipoch.network/capabilities/"'));
  assert.match(first, /<title>Reusable capabilities \| AIPOCH Network<\/title>/);
  assert.match(second, /<title>Reusable capabilities, page 2 \| AIPOCH Network<\/title>/);
  assert.ok(first.includes('rel="canonical"'));
  assert.ok(second.includes('href="https://aipoch.network/capabilities/page/2/"'));
});

test('all operation entrances expose noindex and ordinary directory links before JavaScript', () => {
  const data = siteData();
  for (const section of ['explore', 'projects', 'capabilities', 'organizations', 'researchers', 'collections', 'sources']) {
    const html = renderPage(template, data, `/browse/${section}/`, '/aipoch-network/');
    assert.ok(html.includes('<meta name="robots" content="noindex, follow"'));
    assert.ok(!html.includes('rel="canonical"'));
    assert.ok(html.includes(`href="/aipoch-network/${section}/"`));
    assert.equal(payload(html).directory_bootstrap?.page, 1);
    assert.ok(!html.includes('Entry not found'));
  }
});
