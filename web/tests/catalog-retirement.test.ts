import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureCatalog, FIXTURE_TIME } from '../../spec/fixtures/catalog.js';
import { pageDataForRoute, routeFor, type SiteData } from '../src/model.js';
import { WorkbenchEngine } from '../src/workbench/engine.js';
import { DemoAdapter, type Request, type Receipt } from '../src/workbench/adapter.js';
import { LibraryStore } from '../src/library/storage.js';
import { loadCatalog } from '../src/catalog-loader.js';
import { BrowserDataError } from '../src/browser-data-loader.js';

const fixture = (): SiteData => ({ snapshot_id: 'retirement-fixture', generated_at: FIXTURE_TIME, data_kind: 'full', catalog: createFixtureCatalog() });
class Adapter extends DemoAdapter {
  sends = 0;
  cancellations = 0;
  constructor() { super(); this.connectionOutcome = 'manual'; this.receiptOutcome = 'manual'; }
  override send(request: Request, receive: (receipt: Receipt) => void, fail: (message: string) => void) {
    this.sends++;
    const cancel = super.send(request, receive, fail);
    return () => { this.cancellations++; cancel(); };
  }
}

test('retirement revokes full-catalog consent while keeping the selected ID and complete page readable', context => {
  const data = fixture(), adapter = new Adapter(), library = new LibraryStore('retired'), engine = new WorkbenchEngine(data, true, adapter, library);
  context.after(() => engine.dispose());
  const project = data.catalog.projects[0];
  engine.select(project); engine.connect(); adapter.confirmConnection(); engine.approve(true);
  assert.ok(engine.getSnapshot().approval);
  engine.retireCatalog();
  assert.equal(engine.getSnapshot().selected, project.id);
  assert.equal(library.value.selection?.id, project.id);
  assert.equal(engine.getSnapshot().resolution?.status, 'withdrawn');
  assert.equal(engine.getSnapshot().approval, null);
  engine.approve(true); engine.send();
  assert.equal(adapter.sends, 0);
  // An already downloaded full graph or complete embedded detail cannot revive it.
  engine.updateData(data, true);
  engine.updateData(pageDataForRoute(data, routeFor(project)), false);
  engine.hydrateLibrary(library);
  engine.manualReview(); engine.approve(true); engine.send();
  assert.equal(engine.getSnapshot().resolution?.status, 'withdrawn');
  assert.equal(adapter.sends, 0);
  assert.equal(data.catalog.projects[0].title, project.title);
});

test('retirement ends the browser receipt wait and ignores late receipts without claiming recall', context => {
  const data = fixture(), adapter = new Adapter(), engine = new WorkbenchEngine(data, true, adapter, new LibraryStore('retired-wait'));
  context.after(() => engine.dispose());
  engine.select(data.catalog.projects[0]); engine.connect(); adapter.confirmConnection(); engine.approve(true); engine.send();
  assert.equal(adapter.sends, 1); assert.ok(engine.getSnapshot().request);
  engine.retireCatalog(); engine.retireCatalog();
  assert.equal(adapter.cancellations, 1);
  assert.equal(engine.getSnapshot().request, null);
  assert.match(engine.getSnapshot().notice, /does not withdraw/);
  adapter.deliver();
  assert.equal(engine.getSnapshot().receipts.length, 0);
  engine.select(data.catalog.resources[0]); engine.approve(true); engine.send();
  assert.equal(engine.getSnapshot().resolution?.status, 'withdrawn');
  assert.equal(engine.getSnapshot().selected, data.catalog.resources[0].id);
  assert.equal(adapter.sends, 1);
});

test('a retired page cannot resolve a later selection, even before any full catalog is fetched', context => {
  const data = fixture(), project = data.catalog.projects[0], engine = new WorkbenchEngine(pageDataForRoute(data, routeFor(project)), false, new Adapter(), new LibraryStore('retired-page'));
  context.after(() => engine.dispose());
  engine.retireCatalog(); engine.select(project); engine.manualReview();
  assert.equal(engine.getSnapshot().resolution?.status, 'withdrawn');
});

test('the full-catalog boundary rejects presentation graphs even with the expected snapshot', async () => {
  for (const data_kind of ['page', 'browse'] as const) {
    await assert.rejects(loadCatalog('/', 'retirement-fixture', (async () => Response.json({ ...fixture(), data_kind })) as typeof fetch), error => error instanceof BrowserDataError && error.code === 'invalid_data');
  }
});
