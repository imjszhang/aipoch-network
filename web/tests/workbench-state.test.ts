import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyCatalog } from '../../spec/types.js';
import type { Project, Resource, SourceRepository } from '../../spec/types.js';
import type { SiteData } from '../src/model.js';
import { WorkbenchEngine } from '../src/workbench/engine.js';
import { resolveReference } from '../src/workbench/reference.js';
import { LibraryStore, parseLibrary, MAX_LIBRARY_BYTES } from '../src/library/storage.js';
import { DemoAdapter, UnavailableAdapter, type WorkbenchAdapter, type Session, type Request, type Receipt } from '../src/workbench/adapter.js';

const date = '2026-09-13T00:00:00.000Z';
const source: SourceRepository = { id: 'source:one', kind: 'source_repository', title: 'Public source', status: 'listed', updated_at: date, provenance: {}, provider: 'github', provider_id: 1, canonical_url: 'https://github.com/example/science', owner_id: 'actor:one', availability: 'accessible', archived: false, observed_at: date, stale: false, license: { status: 'identified', spdx_id: 'MIT', conditions: 'Keep the notice', path: 'LICENSE', commit: 'b'.repeat(40) }, aliases: [] };
const project: Project = { id: 'project:one', kind: 'project', title: 'First research', status: 'listed', updated_at: date, provenance: {}, domains: [], resource_ids: [], source_refs: [{ source_id: source.id, role: 'primary', commit: 'a'.repeat(40), path: 'research/method' }] };
const capability: Resource = { id: 'resource:one', kind: 'resource', title: 'A capability', status: 'listed', updated_at: date, provenance: {}, resource_type: 'tool', domains: [], project_ids: [project.id], source_refs: [{ source_id: source.id, role: 'implementation', commit: 'c'.repeat(40), path: 'src/main' }, { source_id: 'source:two', role: 'documentation', ref: 'main' }], license: { status: 'unknown' }, conditions: ['Needs source-specific review'], runtime: { status: 'not_described' } };
const fixture = (): SiteData => ({ snapshot_id: 'snapshot-one', generated_at: date, catalog: { ...emptyCatalog(), sources: [structuredClone(source), { ...structuredClone(source), id: 'source:two', provider_id: 2, archived: true, stale: true, license: { status: 'unknown' } }], projects: [structuredClone(project)], resources: [structuredClone(capability)] } });
class ControlledAdapter implements WorkbenchAdapter {
  demo = true;
  connects: Array<{ attempt: string; callback: (attempt: string, session: Session | null, reason?: string) => void }> = [];
  requests: Array<{ request: Request; callback: (receipt: Receipt) => void; fail: (message: string) => void }> = [];
  sessions = new Set<string>();
  connect(attempt: string, callback: (attempt: string, session: Session | null, reason?: string) => void) { this.connects.push({ attempt, callback }); return () => {}; }
  send(request: Request, callback: (receipt: Receipt) => void, fail: (message: string) => void) { this.requests.push({ request, callback, fail }); return () => {}; }
  confirm(index = this.connects.length - 1) { const connection = this.connects[index]; const session = { id: `session-${index}`, expiresAt: Date.now() + 10_000, demo: true }; this.sessions.add(session.id); connection.callback(connection.attempt, session); }
  receipt(change: Partial<Receipt> = {}, index = this.requests.length - 1) { const call = this.requests[index]; call.callback({ ...call.request, receivedAt: Date.now(), outcome: 'received', ...change }); }
  valid(session: Session) { return this.sessions.has(session.id) && session.expiresAt > Date.now(); }
  disconnect(session: Session) { this.sessions.delete(session.id); }
  dispose() { this.sessions.clear(); }
}
const make = () => { const adapter = new ControlledAdapter(); const library = new LibraryStore('test'); const engine = new WorkbenchEngine(fixture(), true, adapter, library); return { adapter, library, engine }; };
const connect = (engine: WorkbenchEngine, adapter: ControlledAdapter) => { engine.connect(); adapter.confirm(); };
const prepare = (engine: WorkbenchEngine, adapter: ControlledAdapter) => { engine.select(project, '/projects/?q=method&page=2'); connect(engine, adapter); engine.approve(true); };

test('selection survives connection; consent is required and send is deduplicated', t => {
  const { engine, adapter } = make(); t.after(() => engine.dispose());
  engine.select(project, '/projects/?q=method&page=2'); engine.send(); assert.equal(adapter.requests.length, 0);
  connect(engine, adapter);
  assert.equal(engine.getSnapshot().overlay, 'review'); assert.equal(engine.getSnapshot().selected, project.id);
  assert.equal(engine.getSnapshot().library.selection?.returnTo, '/projects/?q=method&page=2');
  engine.send(); assert.equal(adapter.requests.length, 0);
  engine.approve(true); engine.approve(false); engine.send(); assert.equal(adapter.requests.length, 0);
  engine.approve(true); engine.send(); engine.send(); assert.equal(adapter.requests.length, 1);
  engine.close(); assert.equal(engine.getSnapshot().referenceStatus, 'sending');
  engine.resume(); assert.equal(engine.getSnapshot().request?.id, adapter.requests[0].request.id);
  adapter.receipt(); adapter.receipt(); assert.equal(engine.getSnapshot().receipts.length, 1);
  assert.equal(engine.getSnapshot().referenceStatus, 'received');
});
test('all four receipt identities must match; wrong or duplicate receipts cannot succeed', t => {
  const { engine, adapter } = make(); t.after(() => engine.dispose()); prepare(engine, adapter); engine.send();
  for (const change of [{ id: 'wrong' }, { sessionId: 'wrong' }, { objectId: 'wrong' }, { content: 'wrong' }]) { adapter.receipt(change); assert.equal(engine.getSnapshot().referenceStatus, 'sending'); assert.equal(engine.getSnapshot().receipts.length, 0); }
  adapter.receipt(); assert.equal(engine.getSnapshot().receipts.length, 1);
  adapter.receipt(); assert.equal(engine.getSnapshot().receipts.length, 1);
});
test('second selection needs explicit replacement; old receipt cannot approve new object', t => {
  const { engine, adapter } = make(); t.after(() => engine.dispose()); prepare(engine, adapter); engine.send();
  engine.select(capability); assert.equal(engine.getSnapshot().selected, project.id); assert.equal(engine.getSnapshot().overlay, 'replacement');
  engine.keepWaiting(); assert.equal(engine.getSnapshot().referenceStatus, 'sending');
  engine.select(capability); engine.replace(); assert.equal(engine.getSnapshot().selected, capability.id); assert.equal(engine.getSnapshot().approval, null);
  adapter.receipt(); assert.equal(engine.getSnapshot().receipts.length, 0);
  engine.approve(true); engine.send(); assert.equal(adapter.requests.length, 2);
  adapter.receipt({}, 0); assert.equal(engine.getSnapshot().referenceStatus, 'sending');
  adapter.receipt(); assert.equal(engine.getSnapshot().receipts.length, 1);
});
test('replacement keeps the second object’s return context even if the first receipt arrives during review', t => {
  const { engine, adapter } = make(); t.after(() => engine.dispose()); prepare(engine, adapter); engine.send();
  engine.select(capability, '/capabilities/?q=second&page=3');
  assert.equal(engine.getSnapshot().library.selection?.returnTo, '/projects/?q=method&page=2');
  adapter.receipt(); engine.replace();
  assert.equal(engine.getSnapshot().library.selection?.id, capability.id);
  assert.equal(engine.getSnapshot().library.selection?.returnTo, '/capabilities/?q=second&page=3');
  assert.equal(engine.getSnapshot().approval, null); assert.equal(adapter.requests.length, 1);
  assert.match(engine.getSnapshot().notice, /previous reference was received/);
  engine.approve(true); engine.send(); engine.select(project, '/projects/?q=third&page=4'); engine.replace();
  assert.equal(engine.getSnapshot().library.selection?.returnTo, '/projects/?q=third&page=4');
  assert.match(engine.getSnapshot().notice, /delivery remains unconfirmed/);
});
test('cancel, retry and late connection callbacks never restore an old attempt', t => {
  const { engine, adapter } = make(); t.after(() => engine.dispose());
  engine.connect(); engine.cancelConnection(); adapter.confirm(0); assert.equal(engine.getSnapshot().connection, 'unconfirmed');
  engine.connect(); adapter.confirm(0); assert.equal(engine.getSnapshot().connection, 'connecting');
  adapter.confirm(1); assert.equal(engine.getSnapshot().connection, 'connected');
});
test('stopped, disconnected and expired-session responses stay unconfirmed', t => {
  const { engine, adapter } = make(); t.after(() => engine.dispose()); prepare(engine, adapter); engine.send(); engine.stopWaiting();
  adapter.receipt(); assert.equal(engine.getSnapshot().receipts.length, 0); assert.match(engine.getSnapshot().notice, /does not withdraw/);
  engine.approve(true); engine.send(); engine.disconnect(); adapter.receipt(); assert.equal(engine.getSnapshot().receipts.length, 0);
  connect(engine, adapter); engine.approve(true); engine.send(); adapter.sessions.clear(); adapter.receipt(); assert.equal(engine.getSnapshot().connection, 'interrupted'); assert.equal(engine.getSnapshot().receipts.length, 0);
});
for (const [name, edit] of [
  ['snapshot', (data: SiteData) => { data.snapshot_id = 'snapshot-two'; }],
  ['title', (data: SiteData) => { data.catalog.projects[0].title = 'Updated title'; }],
  ['full commit', (data: SiteData) => { data.catalog.projects[0].source_refs[0].commit = 'f'.repeat(40); }],
  ['path', (data: SiteData) => { data.catalog.projects[0].source_refs[0].path = 'different/path'; }],
  ['license', (data: SiteData) => { data.catalog.sources[0].license = { status: 'unknown' }; }],
  ['conditions', (data: SiteData) => { data.catalog.sources[0].license.conditions = 'New conditions'; }],
  ['source', (data: SiteData) => { data.catalog.projects[0].source_refs.push({ source_id: 'source:two', role: 'evidence' }); }],
] as const) test(`${name} changes redraw exact reference and invalidate approval and waiting`, t => {
  const { engine, adapter } = make(); t.after(() => engine.dispose()); prepare(engine, adapter);
  const old = engine.getSnapshot().resolution; const data = fixture(); edit(data); engine.updateData(data, true);
  assert.equal(engine.getSnapshot().approval, null); assert.notDeepEqual(engine.getSnapshot().resolution, old); engine.send(); assert.equal(adapter.requests.length, 0);
  engine.approve(true); engine.send(); data.snapshot_id = 'third'; engine.updateData(data, true); adapter.receipt(); assert.equal(engine.getSnapshot().receipts.length, 0);
});
test('all source facts and full immutable hashes are represented without invented metadata', () => {
  const result = resolveReference(fixture(), capability.id, true); assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  assert.equal(result.reference.action, 'Use'); assert.equal(result.reference.sources.length, 2);
  assert.equal(result.reference.sources[0].commit, 'c'.repeat(40)); assert.equal(result.reference.sources[0].license.commit, 'b'.repeat(40));
  assert.equal(result.reference.sources[1].commit, null); assert.equal(result.reference.sources[1].path, null); assert.equal(result.reference.sources[1].version_status, 'unfixed');
  assert.equal(result.reference.sources[1].stale, true); assert.equal(result.reference.sources[1].archived, true); assert.equal(result.reference.sources[1].license.status, 'unknown');
  assert.equal(result.reference.conditions[0], 'Needs source-specific review'); assert.deepEqual(JSON.parse(result.content), result.reference);
});
test('partial catalog is not treated as missing, while withdrawn records and private sources cannot send', () => {
  const data = fixture(); data.catalog.resources = [];
  assert.equal(resolveReference(data, capability.id, false).status, 'loading'); assert.equal(resolveReference(data, capability.id, true).status, 'missing');
  data.catalog.tombstones.push({ kind: 'tombstone', id: project.id, status: 'withdrawn', withdrawn_at: date });
  assert.equal(resolveReference(data, project.id, false).status, 'withdrawn');
  const privateData = fixture(); privateData.catalog.sources[0].availability = 'private'; assert.equal(resolveReference(privateData, project.id, true).status, 'withdrawn');
  const subset = fixture(); subset.catalog.sources = []; assert.equal(resolveReference(subset, project.id, false).status, 'loading');
});
test('personal handlers refuse disconnected modifications; reconnect restores records without authority', t => {
  const { engine, adapter } = make(); t.after(() => engine.dispose());
  engine.toggleSave(project.id); engine.recordView(project); assert.deepEqual(engine.getSnapshot().library.saved, []); assert.deepEqual(engine.getSnapshot().library.recent, []);
  connect(engine, adapter); engine.toggleSave(project.id); engine.recordView(project); engine.disconnect(); engine.toggleSave(project.id); engine.clearLibrary(); engine.recordView(capability);
  assert.deepEqual(engine.getSnapshot().library.saved, [project.id]); assert.deepEqual(engine.getSnapshot().library.recent, [project.id]);
  connect(engine, adapter); assert.deepEqual(engine.getSnapshot().library.saved, [project.id]); assert.equal(engine.getSnapshot().approval, null);
});
test('persistent records and cross-tab updates cannot grant connection or send authority', t => {
  let raw = JSON.stringify({ version: 1, saved: [project.id], recent: [], language: 'zh', selection: { id: project.id, returnTo: '/projects/' }, connected: true, session: { id: 'forged' }, approval: true });
  const storage = { getItem: () => raw, setItem: (_key: string, next: string) => { raw = next; } };
  const adapter = new ControlledAdapter(); const library = new LibraryStore('test', storage); const engine = new WorkbenchEngine(fixture(), true, adapter, library); t.after(() => engine.dispose());
  assert.equal(engine.getSnapshot().connection, 'disconnected'); assert.equal(engine.getSnapshot().approval, null); assert.equal(engine.getSnapshot().selected, project.id);
  engine.storageEvent(JSON.stringify({ ...library.value, saved: [capability.id], connected: true }));
  assert.deepEqual(engine.getSnapshot().library.saved, [capability.id]); assert.equal(engine.getSnapshot().session, null);
  engine.setLanguage('en'); assert.equal(JSON.parse(raw).connected, undefined); assert.equal(JSON.parse(raw).session, undefined);
});
test('corrupt, old and blocked storage falls back to memory and preserves recoverable bytes', () => {
  for (const raw of ['broken-json', JSON.stringify({ version: 0, saved: [project.id] }), JSON.stringify({ version: 1, saved: 'wrong', recent: [], language: 'en' })]) {
    let writes = 0; const store = new LibraryStore('test', { getItem: () => raw, setItem: () => { writes++; } });
    store.update({ saved: [capability.id] }); assert.equal(writes, 0); assert.ok(store.warning); assert.deepEqual(store.value.saved, [capability.id]);
  }
  const store = new LibraryStore('test', { getItem: () => null, setItem() { throw new Error('quota'); } }); store.update({ saved: [project.id] }); assert.match(store.warning, /memory/); assert.deepEqual(store.value.saved, [project.id]);
  assert.throws(() => parseLibrary(JSON.stringify({ version: 1, saved: [], recent: [], language: 'en', selection: { id: 'x', returnTo: '//evil.example' } })));
});
test('more than 5000 saved records round-trip; byte-limit overflow preserves the prior persisted record', () => {
  let persisted: string | null = null;
  const storage = { getItem: () => persisted, setItem: (_key: string, raw: string) => { persisted = raw; } };
  const store = new LibraryStore('test', storage);
  const saved = Array.from({ length: 6000 }, (_, index) => `project:${index}`);
  store.update({ saved });
  const reloaded = new LibraryStore('test', storage); assert.deepEqual(reloaded.value.saved, saved); assert.equal(reloaded.warning, '');
  const previous = persisted;
  const oversized = Array.from({ length: 5000 }, (_, index) => `${index}:${'界'.repeat(300)}`);
  store.update({ saved: oversized });
  assert.equal(persisted, previous); assert.deepEqual(store.value.saved, oversized); assert.match(store.warning, /memory/);
  assert.throws(() => parseLibrary(' '.repeat(MAX_LIBRARY_BYTES + 1)));
  // Multibyte text also obeys the byte bound when its UTF-16 length remains below the limit.
  const raw = JSON.stringify({ version: 1, saved: oversized, recent: [], language: 'en', selection: null });
  assert.ok(raw.length < MAX_LIBRARY_BYTES); assert.ok(new TextEncoder().encode(raw).byteLength > MAX_LIBRARY_BYTES); assert.throws(() => parseLibrary(raw));
});
test('Review domain disposal rejects stale callbacks and does not alter ordinary library/session', t => {
  const ordinary = make(); const review = make(); t.after(() => { ordinary.engine.dispose(); review.engine.dispose(); });
  prepare(ordinary.engine, ordinary.adapter); ordinary.engine.toggleSave(project.id); ordinary.engine.send(); ordinary.engine.suspend();
  prepare(review.engine, review.adapter); review.engine.toggleSave(capability.id); review.engine.send(); review.engine.dispose(); review.adapter.receipt(); ordinary.adapter.receipt();
  assert.deepEqual(ordinary.engine.getSnapshot().library.saved, [project.id]); assert.equal(ordinary.engine.getSnapshot().receipts.length, 0); assert.equal(ordinary.engine.getSnapshot().referenceStatus, 'needs-review');
  assert.equal(ordinary.engine.checkSession(), true); assert.equal(ordinary.engine.getSnapshot().approval, null);
  ordinary.adapter.sessions.clear(); assert.equal(ordinary.engine.checkSession(), false);
});
test('timeouts never infer non-delivery and require another explicit attempt', async t => {
  const adapter = new ControlledAdapter(); const engine = new WorkbenchEngine(fixture(), true, adapter, new LibraryStore('test'), { connect: 5, send: 5 }); t.after(() => engine.dispose());
  engine.connect(); await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(engine.getSnapshot().connection, 'unconfirmed'); adapter.confirm(); assert.equal(engine.getSnapshot().connection, 'unconfirmed');
  prepare(engine, adapter); engine.send(); await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(engine.getSnapshot().referenceStatus, 'unconfirmed'); assert.match(engine.getSnapshot().notice, /may already have received/); adapter.receipt(); assert.equal(engine.getSnapshot().receipts.length, 0); assert.equal(adapter.requests.length, 1);
});
test('production adapter cannot confirm a session; Demo responds only as an explicit separate adapter', async t => {
  const unavailable = new WorkbenchEngine(fixture(), true, new UnavailableAdapter(), new LibraryStore('test')); t.after(() => unavailable.dispose()); unavailable.connect(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(unavailable.getSnapshot().connection, 'unconfirmed'); assert.equal(unavailable.getSnapshot().session, null); assert.match(unavailable.getSnapshot().reason, /cannot confirm/);
  const demo = new DemoAdapter(1); const engine = new WorkbenchEngine(fixture(), true, demo, new LibraryStore('demo')); t.after(() => engine.dispose()); engine.connect(); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(engine.getSnapshot().session?.demo, true);
});
