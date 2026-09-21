import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BrowserDataLoader } from '../src/browser-data-loader.js';
import { BrowserDataError, parseJsonBytes, readBoundedBytes } from '../src/bounded-fetch.js';
import { createFixtureCatalog, FIXTURE_TIME } from '../../spec/fixtures/catalog.js';
import { makeSearchIndex, searchDocuments } from '../src/search.js';
import { stableUiJson, type BrowseData, type UiManifest, type UiManifestReference, type UiSearchData } from '../../shared/browser-projection.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const descriptor = (href: string, value: string) => ({ href, bytes: Buffer.byteLength(value), sha256: digest(value) });
const code = (expected: string) => (error: unknown) => error instanceof BrowserDataError && error.code === expected;
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

function fixture(snapshot = 'loader-fixture', mutate?: (browse: BrowseData, search: UiSearchData) => void) {
  const catalog = createFixtureCatalog();
  const browse: BrowseData = { schema_version: 1, data_kind: 'browse', snapshot_id: snapshot, generated_at: FIXTURE_TIME, catalog };
  const search: UiSearchData = { schema_version: 1, snapshot_id: snapshot, index: makeSearchIndex(searchDocuments(catalog)).toJSON() };
  mutate?.(browse, search);
  const browseText = stableUiJson(browse), searchText = stableUiJson(search);
  const identity = { schema_version: 1 as const, snapshot_id: snapshot, generated_at: FIXTURE_TIME, files: { browse: descriptor('browse.json', browseText), search: descriptor('search.json', searchText) } };
  const manifest: UiManifest = { ...identity, projection_hash: digest(stableUiJson(identity)) };
  const manifestText = stableUiJson(manifest);
  const prefix = `internal/ui/v1/${snapshot}/${manifest.projection_hash}/`;
  const reference: UiManifestReference = { ...descriptor(`${prefix}manifest.json`, manifestText), schema_version: 1, snapshot_id: snapshot, projection_hash: manifest.projection_hash };
  return { browse, search, manifest, reference, assets: new Map([[`${prefix}manifest.json`, manifestText], [`${prefix}browse.json`, browseText], [`${prefix}search.json`, searchText]]) };
}

function server(fixtures: ReturnType<typeof fixture>[], base = '/') {
  const counts = new Map<string, number>();
  const assets = new Map(fixtures.flatMap(item => [...item.assets]));
  const history = { version: 1, current_snapshot_id: fixtures.at(-1)!.reference.snapshot_id, checked_at: FIXTURE_TIME,
    snapshots: [...new Set(fixtures.map(item => item.reference.snapshot_id))].map(snapshot_id => ({ snapshot_id, status: 'available', checked_at: FIXTURE_TIME })) };
  const fetcher = (async (url: string | URL | Request, options?: RequestInit) => {
    const path = String(url).slice(base.length);
    assert.ok(String(url).startsWith(base));
    counts.set(path, (counts.get(path) ?? 0) + 1);
    if (path === 'catalog/v1/history.json') { assert.equal(options?.cache, 'no-store'); return Response.json(history); }
    const body = assets.get(path);
    return new Response(body ?? 'missing', { status: body === undefined ? 404 : 200 });
  }) as typeof fetch;
  return { counts, assets, history, fetcher };
}

test('continuous download progress can exceed the former 15 second deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
  const pending = readBoundedBytes('/data', { maxBytes: 100, retries: 0, fetcher: (async () => new Response(body)) as typeof fetch });
  await flush();
  for (let index = 0; index < 4; index++) {
    context.mock.timers.tick(9_000);
    stream.enqueue(new Uint8Array([index]));
    await flush();
  }
  stream.close();
  assert.deepEqual([...await pending], [0, 1, 2, 3]);
});

test('no-progress, total and cancellation limits bound even a non-cooperative transport', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const stalled = (async () => new Promise<Response>(() => {})) as typeof fetch;
  const idle = readBoundedBytes('/data', { maxBytes: 100, retries: 0, idleTimeoutMs: 10, totalTimeoutMs: 45, fetcher: stalled });
  const idleCheck = assert.rejects(idle, code('idle_timeout'));
  context.mock.timers.tick(10); await idleCheck;
  const total = readBoundedBytes('/data', { maxBytes: 100, retries: 0, idleTimeoutMs: 100, totalTimeoutMs: 45, fetcher: stalled });
  const totalCheck = assert.rejects(total, code('total_timeout'));
  context.mock.timers.tick(45); await totalCheck;
  const controller = new AbortController();
  const cancelled = readBoundedBytes('/data', { maxBytes: 100, signal: controller.signal, fetcher: stalled });
  controller.abort();
  await assert.rejects(cancelled, code('cancelled'));
});

test('empty chunks do not reset the no-progress deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const pending = readBoundedBytes('/data', { maxBytes: 100, retries: 0, idleTimeoutMs: 10, totalTimeoutMs: 45,
    fetcher: (async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }))) as typeof fetch });
  const check = assert.rejects(pending, code('idle_timeout'));
  await flush();
  context.mock.timers.tick(9); stream.enqueue(new Uint8Array()); await flush();
  context.mock.timers.tick(1); await check;
});

test('one automatic retry applies only to transient transport failures', async () => {
  for (const status of [408, 429, 500, 503]) {
    let calls = 0;
    const bytes = await readBoundedBytes('/data', { maxBytes: 100, fetcher: (async () => ++calls === 1 ? new Response('retry', { status }) : new Response('ok')) as typeof fetch });
    assert.equal(new TextDecoder().decode(bytes), 'ok'); assert.equal(calls, 2);
  }
  let calls = 0;
  await assert.rejects(readBoundedBytes('/data', { maxBytes: 100, fetcher: (async () => { calls++; throw new TypeError('network'); }) as typeof fetch }), code('network'));
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(readBoundedBytes('/data', { maxBytes: 100, fetcher: (async () => { calls++; return new Response('missing', { status: 404 }); }) as typeof fetch }), code('http'));
  assert.equal(calls, 1);
});

test('declared and decoded byte bounds reject oversized bodies without retry', async () => {
  for (const headers of [{ 'content-length': '101' }, {}] as HeadersInit[]) {
    let calls = 0;
    await assert.rejects(readBoundedBytes('/data', { maxBytes: 100, fetcher: (async () => { calls++; return new Response(new Uint8Array(101), { headers }); }) as typeof fetch }), code('too_large'));
    assert.equal(calls, 1);
  }
  assert.throws(() => parseJsonBytes(new Uint8Array([0xc3, 0x28])), code('invalid_data'));
  assert.throws(() => parseJsonBytes(new TextEncoder().encode('{')), code('invalid_data'));
});

test('browse and search share verified manifests and reuse one parsed index on a Pages subpath', async () => {
  const bundle = fixture(), origin = server([bundle], '/aipoch-network/'), loader = new BrowserDataLoader({ fetcher: origin.fetcher });
  const [browse, index] = await Promise.all([loader.loadBrowseData('/aipoch-network/', bundle.reference), loader.loadSearchIndex('/aipoch-network/', bundle.reference)]);
  assert.deepEqual(browse, bundle.browse);
  assert.ok(index.search(bundle.browse.catalog.projects[0].title).length);
  const [again, indexAgain] = await Promise.all([loader.loadBrowseData('/aipoch-network/', bundle.reference), loader.loadSearchIndex('/aipoch-network/', bundle.reference)]);
  assert.equal(again, browse); assert.equal(indexAgain, index);
  for (const [path, count] of origin.counts) assert.equal(count, path.endsWith('history.json') ? 2 : 1, path);
});

test('digest failure is not retried or cached and manual retry can recover', async () => {
  const bundle = fixture(), origin = server([bundle]), loader = new BrowserDataLoader({ fetcher: origin.fetcher });
  const path = bundle.reference.href.replace('manifest.json', 'browse.json'), original = origin.assets.get(path)!;
  origin.assets.set(path, original.replace('browse', 'broken'));
  await assert.rejects(loader.loadBrowseData('/', bundle.reference), code('digest_mismatch'));
  assert.equal(origin.counts.get(path), 1);
  origin.assets.set(path, original);
  assert.deepEqual(await loader.loadBrowseData('/', bundle.reference), bundle.browse);
  assert.equal(origin.counts.get(path), 2);
  assert.equal(origin.counts.get(bundle.reference.href), 1);
});

test('unknown schema and a different snapshot fail despite correct file digests', async () => {
  for (const [mutation, expected] of [
    [(browse: BrowseData) => { (browse as { schema_version: number }).schema_version = 2; }, 'invalid_data'],
    [(browse: BrowseData) => { browse.snapshot_id = 'different-snapshot'; }, 'version_mismatch'],
  ] as const) {
    const bundle = fixture('loader-fixture', mutation), origin = server([bundle]), loader = new BrowserDataLoader({ fetcher: origin.fetcher });
    await assert.rejects(loader.loadBrowseData('/', bundle.reference), code(expected));
    assert.equal(origin.counts.get(bundle.reference.href.replace('manifest.json', 'browse.json')), 1);
  }
});

test('manifest references cannot redirect data outside their immutable version path', async () => {
  const bundle = fixture(), origin = server([bundle]), loader = new BrowserDataLoader({ fetcher: origin.fetcher });
  for (const href of ['https://elsewhere.test/data', '../catalog.json', bundle.reference.href.replace('/manifest.json', '/%2e%2e/catalog.json')]) {
    await assert.rejects(loader.loadBrowseData('/', { ...bundle.reference, href }), code('invalid_data'));
  }
  assert.equal(origin.counts.size, 0);
});

test('retirement invalidates cached data and an unavailable ledger fails closed', async () => {
  const old = fixture(), current = fixture('new-snapshot'), origin = server([old, current]);
  let offline = false;
  const fetcher = (async (url, options) => offline && String(url).endsWith('history.json') ? new Response('offline', { status: 503 }) : origin.fetcher(url, options)) as typeof fetch;
  const loader = new BrowserDataLoader({ fetcher });
  await loader.loadBrowseData('/', old.reference);
  offline = true;
  await assert.rejects(loader.loadBrowseData('/', old.reference), code('http'));
  offline = false;
  origin.history.snapshots[0].status = 'withdrawn';
  await assert.rejects(loader.loadBrowseData('/', old.reference), code('retired'));
  // A subsequently stale ledger response must not resurrect a retirement already observed.
  origin.history.snapshots[0].status = 'available';
  await assert.rejects(loader.loadBrowseData('/', old.reference), code('retired'));
  assert.deepEqual(await loader.loadBrowseData('/', current.reference), current.browse);
  assert.equal(origin.counts.get(old.reference.href.replace('manifest.json', 'browse.json')), 1);
});

test('same-snapshot projections use distinct caches and LRU version capacity is bounded', async () => {
  const first = fixture(), second = fixture('loader-fixture', browse => { browse.catalog.projects[0].description = 'Changed presentation.'; });
  const origin = server([first, second]), loader = new BrowserDataLoader({ fetcher: origin.fetcher, maxVersions: 1 });
  const a = await loader.loadBrowseData('/', first.reference);
  const b = await loader.loadBrowseData('/', second.reference);
  assert.notEqual(a, b); assert.notEqual(first.reference.projection_hash, second.reference.projection_hash);
  await loader.loadBrowseData('/', first.reference);
  assert.equal(origin.counts.get(first.reference.href), 2);
  assert.equal(origin.counts.get(second.reference.href), 1);
});

test('a result larger than the retention budget is returned but not retained', async () => {
  const bundle = fixture(), origin = server([bundle]), loader = new BrowserDataLoader({ fetcher: origin.fetcher, maxCacheBytes: 1 });
  await loader.loadBrowseData('/', bundle.reference);
  await loader.loadBrowseData('/', bundle.reference);
  assert.equal(origin.counts.get(bundle.reference.href), 2);
});

test('cancelling one subscriber leaves a shared download available to another', async () => {
  const bundle = fixture(), origin = server([bundle]);
  let release!: () => void, started!: () => void;
  let transportAborted = false;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const fetcher = (async (url, options) => {
    if (String(url).endsWith('browse.json')) {
      started();
      await new Promise<void>((resolve, reject) => {
        release = resolve;
        options?.signal?.addEventListener('abort', () => { transportAborted = true; reject(options.signal?.reason); }, { once: true });
      });
    }
    return origin.fetcher(url, options);
  }) as typeof fetch;
  const loader = new BrowserDataLoader({ fetcher }), controller = new AbortController();
  const first = loader.loadBrowseData('/', bundle.reference, { signal: controller.signal });
  const second = loader.loadBrowseData('/', bundle.reference);
  await ready;
  controller.abort();
  await assert.rejects(first, code('cancelled'));
  assert.equal(transportAborted, false);
  release();
  assert.deepEqual(await second, bundle.browse);
});

test('the last cancellation terminates transport and does not poison a later request', async () => {
  const bundle = fixture(), origin = server([bundle]);
  let started!: () => void, delay = true, transportAborted = false;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const fetcher = (async (url, options) => {
    if (delay && String(url).endsWith('browse.json')) {
      started();
      await new Promise<Response>((_, reject) => options?.signal?.addEventListener('abort', () => { transportAborted = true; reject(options.signal?.reason); }, { once: true }));
    }
    return origin.fetcher(url, options);
  }) as typeof fetch;
  const loader = new BrowserDataLoader({ fetcher }), controller = new AbortController();
  const pending = loader.loadBrowseData('/', bundle.reference, { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, code('cancelled'));
  assert.equal(transportAborted, true);
  delay = false;
  assert.deepEqual(await loader.loadBrowseData('/', bundle.reference), bundle.browse);
});

test('immutable downloads run alongside the ledger but are never exposed before it passes', async () => {
  const bundle = fixture(), origin = server([bundle]);
  let release!: () => void, browseDownloaded!: () => void;
  const started = new Promise<void>(resolve => { browseDownloaded = resolve; });
  const fetcher = (async (url, options) => {
    if (String(url).endsWith('history.json')) await new Promise<void>(resolve => { release = resolve; });
    const response = await origin.fetcher(url, options);
    if (String(url).endsWith('browse.json')) browseDownloaded();
    return response;
  }) as typeof fetch;
  const loader = new BrowserDataLoader({ fetcher });
  let exposed = false;
  const pending = loader.loadBrowseData('/', bundle.reference).then(value => { exposed = true; return value; });
  await started;
  await flush();
  assert.equal(exposed, false);
  release();
  assert.deepEqual(await pending, bundle.browse);
});

test('retirement cancels an in-flight version shared by multiple subscribers', async () => {
  const old = fixture(), current = fixture('new-snapshot'), origin = server([old, current]);
  let browseStarted!: () => void;
  const started = new Promise<void>(resolve => { browseStarted = resolve; });
  const fetcher = (async (url, options) => {
    if (String(url).endsWith('browse.json') && String(url).includes('/loader-fixture/')) {
      browseStarted();
      return await new Promise<Response>((_, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }));
    }
    return origin.fetcher(url, options);
  }) as typeof fetch;
  const loader = new BrowserDataLoader({ fetcher });
  const pending = loader.loadBrowseData('/', old.reference);
  const pendingCheck = assert.rejects(pending, code('retired'));
  await started;
  origin.history.snapshots[0].status = 'withdrawn';
  await assert.rejects(loader.loadSearchIndex('/', old.reference), code('retired'));
  await pendingCheck;
});
