import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../../scripts/render-page.js';
import { createFixtureCatalog, FIXTURE_TIME } from '../../spec/fixtures/catalog.js';
import { allEntries, pageDataForRoute, routeFor, tombstoneRouteFor, type SiteData } from '../../web/src/model.js';

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
    checkRetainedSources(payload(html));
  }
});
