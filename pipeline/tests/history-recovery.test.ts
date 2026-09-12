import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, stableJson } from '../build.js';
import { readHistoricalSnapshot, type SnapshotHistory } from '../history.js';
import { prepareRecoveryInputs, rebuildRecoveryCandidate } from '../recovery.js';
import { normalize, type SnapshotBatch } from '../normalize.js';
import type { Registry } from '../registry.js';

const T0 = '2026-09-12T00:00:00.000Z', T1 = '2026-09-12T01:00:00.000Z', T2 = '2026-09-12T02:00:00.000Z';
const URL_A = 'https://github.com/lab/source-a', URL_B = 'https://github.com/lab/source-b';
function fixture(includeB = true): { registry: Registry; batch: SnapshotBatch } {
  const urls = includeB ? [URL_A, URL_B] : [URL_A];
  return {
    registry: { version: 1, sources: urls.map(url => ({ url, reviewed_at: T0, review_note: 'Synthetic history/recovery drill.' })),
      projects: [], resources: urls.map((url, index) => ({ key: index ? 'b' : 'a', title: `Original editorial ${index ? 'B' : 'A'}`, description: `Approved public description ${index ? 'B' : 'A'}`, type: 'method', domains: ['biology'], sources: [url] })),
      collections: [], withdrawals: [] },
    batch: { as_of: T0, sources: urls.map((url, index) => ({ requested_url: url, checked_at: T0, observed_at: T0, availability: 'accessible', suppressed: false,
      repository: { id: index ? 202 : 201, name: index ? 'source-b' : 'source-a', full_name: `lab/source-${index ? 'b' : 'a'}`, html_url: url,
        description: `SOURCE_${index ? 'B' : 'A'}_PUBLIC_MARKER`, readme: `README_${index ? 'B' : 'A'}_PUBLIC_MARKER`, default_branch: 'main', archived: false, fork: false,
        owner: { id: 101, login: 'lab', type: 'Organization', html_url: 'https://github.com/lab' }, topics: [], updated_at: T0,
        has_issues: true, has_discussions: false, commit: (index ? 'b' : 'a').repeat(40) } })) },
  };
}
async function temporary(t: TestContext): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'aipoch-history-drill-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
async function tree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(path: string) {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await visit(next); else files[next] = (await readFile(join(root, next))).toString('base64');
    }
  }
  await visit(''); return files;
}
async function ledger(root: string): Promise<SnapshotHistory> { return JSON.parse(await readFile(join(root, 'catalog/v1/history.json'), 'utf8')); }
function strings(files: Record<string, string>): string { return Object.values(files).map(bytes => Buffer.from(bytes, 'base64').toString('utf8')).join('\n'); }

test('ordinary builds retain validated historical snapshot manifests and shard bytes unchanged', async t => {
  const root = await temporary(t), output = join(root, 'generated'); const { registry, batch } = fixture();
  const first = await generate(registry, batch, output, 1);
  const firstPath = join(output, 'catalog/v1/snapshots', first.snapshot_id), before = await tree(firstPath);
  registry.resources[0].title = 'Updated editorial A'; batch.as_of = T1;
  const second = await generate(registry, batch, output, 1);
  assert.notEqual(first.snapshot_id, second.snapshot_id);
  assert.deepEqual(await tree(firstPath), before);
  const historical = await readHistoricalSnapshot(firstPath, first.snapshot_id);
  assert.equal(historical.catalog.resources[0].title, 'Original editorial A');
  assert.deepEqual((await ledger(output)).snapshots.map(row => row.status), ['available', 'available']);
});

test('re-sharding has a new snapshot identity and cannot rewrite already-fixed old shard URLs', async t => {
  const root = await temporary(t), output = join(root, 'generated'); const { registry, batch } = fixture();
  const first = await generate(registry, batch, output, 1), before = await tree(join(output, 'catalog/v1/snapshots', first.snapshot_id));
  const second = await generate(registry, batch, output, 200);
  assert.notEqual(first.snapshot_id, second.snapshot_id);
  assert.deepEqual(await tree(join(output, 'catalog/v1/snapshots', first.snapshot_id)), before);
});

test('withdrawal retires affected historical snapshots while preserving unaffected earlier snapshots', async t => {
  const root = await temporary(t), output = join(root, 'generated');
  const one = fixture(false), two = fixture(true);
  const safe = await generate(one.registry, one.batch, output);
  two.batch.as_of = T1; const affected = await generate(two.registry, two.batch, output);
  two.registry.withdrawals.push({ id: 'source:github:202', withdrawn_at: T2, reason: 'withdrawn' }); two.batch.as_of = T2;
  await generate(two.registry, two.batch, output);
  const files = await tree(output), content = strings(files);
  assert.ok(Object.keys(files).some(path => path.includes(safe.snapshot_id)));
  assert.ok(!Object.keys(files).some(path => path.includes(affected.snapshot_id)));
  assert.doesNotMatch(content, /SOURCE_B_PUBLIC_MARKER|README_B_PUBLIC_MARKER|https:\/\/github.com\/lab\/source-b/);
  assert.equal((await ledger(output)).snapshots.find(row => row.snapshot_id === affected.snapshot_id)?.status, 'withdrawn');
});

test('private, access suppression, lost public state and over-seven-day sources also retire harvested history', async t => {
  for (const mode of ['private', 'suppressed', 'removed', 'expired'] as const) {
    const root = await temporary(t), output = join(root, mode), { registry, batch } = fixture(false);
    const before = await generate(registry, batch, output);
    batch.as_of = T1;
    if (mode === 'private') batch.sources[0].availability = 'private';
    if (mode === 'suppressed') { batch.sources[0].availability = 'unknown'; batch.sources[0].suppressed = true; }
    if (mode === 'removed') batch.sources = [];
    if (mode === 'expired') batch.as_of = '2026-09-20T00:00:00.000Z';
    await generate(registry, batch, output);
    const files = await tree(output);
    assert.ok(!Object.keys(files).some(path => path.includes(before.snapshot_id)), mode);
    assert.doesNotMatch(strings(files), /SOURCE_A_PUBLIC_MARKER|README_A_PUBLIC_MARKER/, mode);
  }
});

test('retirement ledger prevents an old withdrawn snapshot ID from being revived by replaying old inputs', async t => {
  const root = await temporary(t), output = join(root, 'generated'), old = fixture(false);
  await generate(old.registry, old.batch, output);
  const current = structuredClone(old); current.batch.as_of = T1; current.registry.withdrawals.push({ id: 'resource:a', withdrawn_at: T1, reason: 'withdrawn' });
  await generate(current.registry, current.batch, output); const before = await tree(output);
  await assert.rejects(generate(old.registry, old.batch, output), /retired snapshot ID/);
  assert.deepEqual(await tree(output), before);
});

test('revoking a verified claim also retires historical copies of that authority statement', async t => {
  const root = await temporary(t), output = join(root, 'generated'), { registry, batch } = fixture(false);
  registry.claims = [{ kind: 'claim', id: 'claim:capability', subject_id: 'resource:a', actor_id: 'actor:github:101', type: 'capability', status: 'verified', scope: 'Synthetic capability statement only', evidence: [{ role: 'editor', url: URL_A, source_id: 'source:github:201', observed_at: T0, review: 'reviewed' }], recorded_at: T0, verified_at: T0, verified_by: 'actor:github:101', recheck_on: ['dispute'] }];
  const first = await generate(registry, batch, output);
  registry.claims[0].status = 'revoked'; batch.as_of = T1; await generate(registry, batch, output);
  assert.ok(!Object.keys(await tree(output)).some(path => path.includes(first.snapshot_id)));
  assert.equal((await ledger(output)).snapshots.find(row => row.snapshot_id === first.snapshot_id)?.reason, 'authority_changed');
});

test('historical corruption and unmanifested files are never copied into new output', async t => {
  const root = await temporary(t), output = join(root, 'generated'), { registry, batch } = fixture(false);
  const first = await generate(registry, batch, output);
  const directory = join(output, 'catalog/v1/snapshots', first.snapshot_id);
  await writeFile(join(directory, 'unmanifested-secret.json'), '{"secret":"SHOULD_NEVER_COPY"}');
  batch.as_of = T1; await generate(registry, batch, output);
  assert.doesNotMatch(strings(await tree(output)), /SHOULD_NEVER_COPY/);
  const pinned = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  await writeFile(join(directory, pinned.collections.sources[0].href), 'CORRUPT_HISTORY');
  batch.as_of = T2; await generate(registry, batch, output);
  assert.doesNotMatch(strings(await tree(output)), /CORRUPT_HISTORY/);
  assert.equal((await ledger(output)).snapshots.find(row => row.snapshot_id === first.snapshot_id)?.status, 'invalid');
});

test('separate verified artifact history is reproducible and repeated builds are byte-identical', async t => {
  const root = await temporary(t), history = join(root, 'verified-artifact'), a = join(root, 'candidate-a'), b = join(root, 'candidate-b');
  const { registry, batch } = fixture(); await generate(registry, batch, history); batch.as_of = T1; registry.resources[0].title = 'Next title';
  await generate(registry, batch, a, 200, { historyDirectory: history });
  await generate(registry, batch, b, 200, { historyDirectory: history });
  assert.deepEqual(await tree(a), await tree(b));
  const first = await tree(a); await generate(registry, batch, a); assert.deepEqual(await tree(a), first);
});

test('malformed historical retirement state fails without replacing the complete current output', async t => {
  const root = await temporary(t), output = join(root, 'generated'), bad = join(root, 'untrusted-artifact'); const { registry, batch } = fixture();
  await generate(registry, batch, output); const before = await tree(output);
  await cp(output, bad, { recursive: true }); await writeFile(join(bad, 'catalog/v1/history.json'), '{"version":1,"snapshots":[{"snapshot_id":"../secret"}]}');
  batch.as_of = T1;
  await assert.rejects(generate(registry, batch, output, 200, { historyDirectory: bad }), /ledger/);
  assert.deepEqual(await tree(output), before);
});

test('an existing catalog build lock prevents a second writer without deleting its lock or prior output', async t => {
  const root = await temporary(t), output = join(root, 'generated'), { registry, batch } = fixture();
  await generate(registry, batch, output); const before = await tree(output);
  await mkdir(`${output}.build-lock`); await writeFile(join(`${output}.build-lock`, 'owner.json'), '{"pid":12345}');
  await assert.rejects(generate(registry, batch, output), /output lock/);
  assert.deepEqual(await tree(output), before);
  assert.equal(await readFile(join(`${output}.build-lock`, 'owner.json'), 'utf8'), '{"pid":12345}');
});

test('recovery restores safe old editorial values using current observations and current withdrawals', async t => {
  const root = await temporary(t), output = join(root, 'candidate'), historical = fixture(), current = structuredClone(historical);
  current.batch.as_of = T1; current.registry.resources[0].title = 'Broken new editorial A'; current.registry.resources[1].title = 'Current B';
  current.batch.sources[0].repository!.readme = 'CURRENT_A_README';
  current.registry.withdrawals.push({ id: 'source:github:202', withdrawn_at: T1, reason: 'withdrawn' });
  const original = structuredClone(current);
  const inputs = prepareRecoveryInputs(historical.registry, historical.batch, current.registry, current.batch);
  assert.equal(inputs.registry.resources[0].title, 'Original editorial A');
  assert.equal(inputs.report.restored.resources, 1); assert.equal(inputs.report.skipped.resources, 1);
  assert.deepEqual(inputs.registry.withdrawals, current.registry.withdrawals); assert.deepEqual(inputs.batch, current.batch); assert.deepEqual(current, original);
  const result = await rebuildRecoveryCandidate(historical.registry, historical.batch, current.registry, current.batch, output);
  assert.equal(result.report.policy, 'current_scope_sources_withdrawals_and_authority');
  const recovered = await readHistoricalSnapshot(join(output, 'catalog/v1/snapshots', result.manifest.snapshot_id), result.manifest.snapshot_id);
  assert.equal(recovered.catalog.sources[0].readme, undefined, 'recovery must not republish full README text');
  assert.equal(recovered.catalog.resources[0].title, 'Original editorial A');
  assert.equal(recovered.catalog.resources.length, 1);
  assert.doesNotMatch(strings(await tree(output)), /SOURCE_B_PUBLIC_MARKER|README_B_PUBLIC_MARKER|https:\/\/github.com\/lab\/source-b/);
});

test('recovery does not reintroduce removed membership, prior claims, or edits attached to a reused source name', () => {
  const historical = fixture(), current = fixture(false);
  historical.registry.claims = [{ kind: 'claim', id: 'claim:old', subject_id: 'source:github:201', actor_id: 'actor:github:101', type: 'maintainership', status: 'unverified', scope: 'Prior request only', evidence: [{ role: 'community', url: URL_A, source_id: 'source:github:201', observed_at: T0, review: 'reviewed' }], recorded_at: T0, recheck_on: ['transfer'] }];
  current.batch.as_of = T1; current.registry.resources[0].title = 'Current source-name owner'; current.batch.sources[0].repository!.id = 999;
  const recovered = prepareRecoveryInputs(historical.registry, historical.batch, current.registry, current.batch);
  assert.equal(recovered.registry.resources.length, 1); assert.equal(recovered.registry.resources[0].title, 'Current source-name owner');
  assert.equal(recovered.registry.claims, undefined); assert.equal(recovered.report.restored.resources, 0);
  assert.equal(normalize(recovered.registry, recovered.batch).catalog.sources[0].id, 'source:github:999');
});

test('recovery inputs and outputs are deterministic and reject policy observations from before the prior release', async t => {
  const root = await temporary(t), historical = fixture(false), current = structuredClone(historical); current.batch.as_of = T1;
  const one = prepareRecoveryInputs(historical.registry, historical.batch, current.registry, current.batch);
  const two = prepareRecoveryInputs(historical.registry, historical.batch, current.registry, current.batch);
  assert.equal(stableJson(one), stableJson(two));
  await rebuildRecoveryCandidate(historical.registry, historical.batch, current.registry, current.batch, join(root, 'a'));
  await rebuildRecoveryCandidate(historical.registry, historical.batch, current.registry, current.batch, join(root, 'b'));
  assert.deepEqual(await tree(join(root, 'a')), await tree(join(root, 'b')));
  current.batch.as_of = '2026-09-11T00:00:00.000Z';
  assert.throws(() => prepareRecoveryInputs(historical.registry, historical.batch, current.registry, current.batch), /cannot precede/);
});
