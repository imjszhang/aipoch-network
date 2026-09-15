import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessRefresh, readRefreshState, refreshRegistry, refreshState, validateBatch } from '../refresh.js';
import type { Registry } from '../registry.js';
import type { SnapshotBatch } from '../normalize.js';
import { trustedRun } from '../../scripts/restore-refresh.js';

const NOW = '2026-09-12T12:00:00.000Z';
async function fixture() {
  const registry = JSON.parse(await readFile('registry/catalog.json', 'utf8')) as Registry;
  const batch = JSON.parse(await readFile('fixtures/pilot/snapshots.json', 'utf8')) as SnapshotBatch;
  // Tests exercise lifecycle rules independently of the pilot's observation time.
  batch.as_of = '2026-09-12T10:00:00.000Z';
  delete batch.accounts;
  for (const source of batch.sources) {
    source.checked_at = source.observed_at = batch.as_of;
    // These lifecycle tests use their own clock; optional discovery observations have separate coverage.
    delete source.github_metrics; delete source.source_activity; delete source.observation;
  }
  return { registry, batch };
}
async function temporary(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'aipoch-refresh-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('all-source outage preserves the accepted batch, even when recent cached observations exist', async t => {
  const directory = await temporary(t), { registry, batch } = await fixture();
  const original = JSON.stringify(batch);
  await writeFile(join(directory, 'batch.json'), original);
  await assert.rejects(refreshRegistry(registry, { directory, previous: batch, now: () => new Date(NOW), reader: {
    refresh: async (_owner, _repo, previous) => ({ ...previous!, checked_at: NOW, availability: 'temporarily_unavailable', error: 'rate_limited' }),
  } }), /All sources failed/);
  assert.equal(await readFile(join(directory, 'batch.json'), 'utf8'), original);
  const report = JSON.parse(await readFile(join(directory, 'refresh-report.json'), 'utf8'));
  assert.equal(report.complete, false);
  assert.equal(report.retained, registry.sources.length);
});

test('fresh hosted runner restores bounded public state and retains one failed source without inventing freshness', async t => {
  const directory = await temporary(t), { registry, batch } = await fixture();
  const restored = join(directory, 'previous.json');
  await writeFile(restored, JSON.stringify(refreshState(batch)));
  const previous = await readRefreshState(restored, registry, new Date(NOW));
  let calls = 0;
  const result = await refreshRegistry(registry, { directory, previous, now: () => new Date(NOW), reader: {
    refresh: async (_owner, _repo, prior) => {
      assert.ok(prior?.repository);
      return ++calls === 1 ? { ...prior, checked_at: NOW, availability: 'temporarily_unavailable', error: 'unavailable' }
        : { ...prior, checked_at: NOW, observed_at: NOW, availability: 'accessible' };
    },
  } });
  assert.equal(result.report.retained, 1);
  assert.equal(result.batch.sources[0].observed_at, batch.as_of);
  assert.equal((await readRefreshState(join(directory, 'batch.json'), registry, new Date(NOW)))?.as_of, NOW);
});

test('a clean runner cannot promote a partial catalog when an unavailable source has no baseline', async t => {
  const directory = await temporary(t), { registry, batch } = await fixture();
  let calls = 0;
  await assert.rejects(refreshRegistry(registry, { directory, now: () => new Date(NOW), reader: {
    refresh: async (_owner, _repo) => {
      const source = batch.sources[calls++];
      return calls === 1 ? { requested_url: source.requested_url, checked_at: NOW, availability: 'temporarily_unavailable', suppressed: false }
        : { ...source, checked_at: NOW, observed_at: NOW };
    },
  } }), /without a last public observation/);
  await assert.rejects(readFile(join(directory, 'batch.json')), /ENOENT/);
});

test('private suppression can remove sources even while every remaining endpoint is temporarily unavailable', async t => {
  const directory = await temporary(t), { registry, batch } = await fixture();
  let calls = 0;
  const result = await refreshRegistry(registry, { directory, previous: batch, now: () => new Date(NOW), reader: {
    refresh: async (_owner, _repo, prior) => ++calls === 1
      ? { ...prior!, checked_at: NOW, availability: 'private', suppressed: true, error: 'not_public' }
      : { ...prior!, checked_at: NOW, availability: 'temporarily_unavailable', error: 'unavailable' },
  } });
  assert.equal(result.report.withheld, 1);
  assert.equal(result.report.complete, true);
});

test('interrupted refresh never replaces accepted inputs and releases its process lock', async t => {
  const directory = await temporary(t), { registry, batch } = await fixture();
  await writeFile(join(directory, 'batch.json'), JSON.stringify(batch));
  let calls = 0;
  await assert.rejects(refreshRegistry(registry, { directory, previous: batch, now: () => new Date(NOW), reader: {
    refresh: async (_owner, _repo, prior) => { if (++calls === 2) throw new Error('Synthetic interruption'); return { ...prior!, checked_at: NOW, observed_at: NOW }; },
  } }), /Synthetic interruption/);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'batch.json'), 'utf8')), batch);
  await assert.rejects(readFile(join(directory, 'refresh-lock/owner.json')), /ENOENT/);
});

test('cross-run state excludes upstream response extras, README and HTTP validators while local cache retains bounded validators', async t => {
  const directory = await temporary(t), { registry, batch } = await fixture();
  const source = batch.sources[0];
  source.etag = '"etag"'; source.last_modified = 'Sat, 12 Sep 2026 10:00:00 GMT';
  source.repository!.readme = 'DO_NOT_ARCHIVE_README';
  Object.assign(source, { authorization: 'DO_NOT_ARCHIVE_TOKEN' });
  Object.assign(source.repository!, { private_field: 'DO_NOT_ARCHIVE_EXTRA' });
  assert.doesNotMatch(JSON.stringify(refreshState(batch)), /DO_NOT_ARCHIVE|etag|last_modified/);
  const file = join(directory, 'state.json');
  await writeFile(file, JSON.stringify(batch));
  const loaded = await readRefreshState(file, registry, new Date(NOW));
  assert.equal(loaded?.sources[0].etag, '"etag"');
  assert.doesNotMatch(JSON.stringify(loaded), /DO_NOT_ARCHIVE/);
});

test('candidate gates reject missing sources, stale fallback and future or duplicate observations', async () => {
  const { registry, batch } = await fixture();
  assert.equal(assessRefresh(registry, { ...batch, sources: [] }).complete, false);
  const source = batch.sources[0];
  source.observed_at = '2026-09-01T10:00:00.000Z';
  source.availability = 'temporarily_unavailable';
  assert.match(assessRefresh(registry, batch).problems.join(' '), /exceeds seven days/);
  assert.throws(() => validateBatch(registry, { ...batch, as_of: '2030-01-01T00:00:00.000Z' }, new Date(NOW)), /time/);
  assert.throws(() => validateBatch(registry, { ...batch, sources: [source, source] }, new Date(NOW)), /Duplicate/);
});

test('ordinary state restores only from successful trusted main; negative evidence may come from a completed failed main run', () => {
  const run = { id: 123, run_attempt: 1, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', head_branch: 'main', path: '.github/workflows/refresh.yml', head_repository: { full_name: 'example/network' } };
  assert.equal(trustedRun(run, 'example/network'), true);
  assert.equal(trustedRun({ ...run, conclusion: 'failure' }, 'example/network'), false);
  assert.equal(trustedRun({ ...run, conclusion: 'failure' }, 'example/network', false), true);
  for (const change of [{ status: 'in_progress' }, { event: 'pull_request' }, { head_branch: 'untrusted' }, { path: '.github/workflows/ci.yml' }, { head_repository: { full_name: 'outsider/network' } }]) {
    assert.equal(trustedRun({ ...run, ...change }, 'example/network', false), false);
  }
});
