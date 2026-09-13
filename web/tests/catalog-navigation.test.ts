import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../src/catalog-loader.js';
import { internalHref } from '../src/navigation.js';
import { pageDataForRoute, type SiteData } from '../src/model.js';
import { createFixtureCatalog, FIXTURE_TIME } from '../../spec/fixtures/catalog.js';

const data = (): SiteData => ({ snapshot_id: 'navigation-fixture', generated_at: FIXTURE_TIME, catalog: createFixtureCatalog() });

test('shared catalog loading preserves the expected snapshot and Pages base', async () => {
  const fixture = data(); let target = '';
  const loaded = await loadCatalog('/aipoch-network/', fixture.snapshot_id, (async (url, options) => {
    target = String(url); assert.ok(options?.signal); return Response.json(fixture);
  }) as typeof fetch);
  assert.equal(target, '/aipoch-network/internal/catalog.json');
  assert.deepEqual(loaded, fixture);
  await assert.rejects(loadCatalog('/', 'another-snapshot', (async () => Response.json(fixture)) as typeof fetch), /snapshot changed/);
});

test('catalog errors never yield an empty valid directory', async () => {
  for (const response of [new Response('offline', { status: 503 }), Response.json({ catalog: {} }), new Response('{broken'), new Response('small', { headers: { 'content-length': '32000001' } })]) {
    await assert.rejects(loadCatalog('/', undefined, (async () => response) as typeof fetch));
  }
  await assert.rejects(loadCatalog('/', undefined, (async () => new Response(new Uint8Array([0xc3, 0x28]))) as typeof fetch));
});

test('homepage carries complete statistics while retaining a display subgraph', () => {
  const fixture = data(); const page = pageDataForRoute(fixture, '/');
  assert.equal(page.researcher_total, fixture.catalog.actors.filter(actor => actor.account_type === 'user').length);
  assert.equal(page.totals?.actors, fixture.catalog.actors.length);
  assert.equal(page.totals?.resources, fixture.catalog.resources.length);
  for (const relation of page.catalog.relations) {
    const ids = new Set(Object.values(page.catalog).flat().map(row => row.id));
    assert.ok(ids.has(relation.from_id)); assert.ok(ids.has(relation.to_id));
  }
});

test('stable site links preserve queries, object identities and subpaths', () => {
  assert.equal(internalHref('/projects/project~scanpy/?source=repo', '/aipoch-network/'), '/aipoch-network/projects/project~scanpy/?source=repo');
  assert.equal(internalHref('/?personal=saved', '/'), '/?personal=saved');
  assert.equal(internalHref('#sources', '/aipoch-network/'), '#sources');
});
