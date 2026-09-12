import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRestoreArtifact, readArtifactInventory, selectRestoreArtifacts, trustedRun, type Artifact, type Run } from '../../scripts/restore-refresh.js';

const REPOSITORY = 'example/network', REPOSITORY_ID = 91;
const OLD = '2026-09-12T08:00:00Z', NEW = '2026-09-12T10:00:00Z';
type Prefix = 'trusted-refresh-state' | 'trusted-source-suppressions' | 'catalog-candidate';
function artifact(id: number, runId = 200, attempt = 1, prefix: Prefix = 'trusted-source-suppressions', created_at = OLD): Artifact {
  return { id, name: `${prefix}-${runId}-${attempt}`, created_at, expired: false, size_in_bytes: 100,
    workflow_run: { id: runId, repository_id: REPOSITORY_ID, head_repository_id: REPOSITORY_ID, head_branch: 'main' } };
}
function run(id = 200, run_attempt = 1, overrides: Partial<Run> = {}): Run {
  return { id, run_attempt, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', head_branch: 'main',
    path: '.github/workflows/refresh.yml', head_repository: { full_name: REPOSITORY }, ...overrides };
}

test('artifact enumeration reads every page before relying on a small recent-looking subset', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => artifact(i + 1, 1000 + i));
  const calls: number[] = [];
  const actual = await readArtifactInventory(async (page, pageSize) => {
    calls.push(page); assert.equal(pageSize, 100);
    return { total_count: rows.length, artifacts: rows.slice((page - 1) * pageSize, page * pageSize) };
  });
  assert.deepEqual(calls, [1, 2, 3]); assert.deepEqual(actual, rows);
});

test('incomplete, omitted, duplicate or changing artifact pages cannot become a restore baseline', async () => {
  const first = [artifact(1), artifact(2, 201)], last = [artifact(3, 202)];
  const cases: Array<{ name: string; pages: unknown[] }> = [
    { name: 'omitted total', pages: [{ artifacts: first }] },
    { name: 'omitted records', pages: [{ total_count: 3 }] },
    { name: 'short initial page', pages: [{ total_count: 3, artifacts: first.slice(0, 1) }] },
    { name: 'missing final page', pages: [{ total_count: 3, artifacts: first }, { total_count: 3, artifacts: [] }] },
    { name: 'duplicate replaces missing entry', pages: [{ total_count: 3, artifacts: first }, { total_count: 3, artifacts: [first[0]] }] },
    { name: 'inventory changes', pages: [{ total_count: 3, artifacts: first }, { total_count: 4, artifacts: last }] },
    { name: 'count smaller than returned data', pages: [{ total_count: 1, artifacts: first }] },
    { name: 'invalid record', pages: [{ total_count: 1, artifacts: [{ ...first[0], created_at: 'not-a-date' }] }] },
  ];
  for (const { name, pages } of cases) await assert.rejects(readArtifactInventory(async page => pages[page - 1], { pageSize: 2 }), /artifact inventory/i, name);
});

test('the bounded inventory accepts its exact cap or empty state but refuses silent truncation above the cap', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => artifact(i + 1, 1000 + i));
  let pages = 0;
  assert.equal((await readArtifactInventory(async (page, size) => {
    pages++; return { total_count: rows.length, artifacts: rows.slice((page - 1) * size, page * size) };
  })).length, 1000);
  assert.equal(pages, 10);
  await assert.rejects(readArtifactInventory(async () => ({ total_count: 1001, artifacts: rows.slice(0, 100) })), /exceeds/);
  assert.deepEqual(await readArtifactInventory(async () => ({ total_count: 0, artifacts: [] })), []);
  await assert.rejects(readArtifactInventory(async () => ({}), { maxArtifacts: 1001 }), /bounds/);
});

test('an older run with a newer failed attempt supplies the latest negative artifact by creation time', async () => {
  const artifacts = [
    artifact(11, 200, 1, 'trusted-source-suppressions'),
    artifact(12, 200, 1, 'trusted-refresh-state'),
    artifact(13, 200, 1, 'catalog-candidate'),
    artifact(1, 100, 2, 'trusted-source-suppressions', NEW),
    artifact(2, 100, 2, 'trusted-refresh-state', NEW),
    artifact(3, 100, 2, 'catalog-candidate', NEW),
  ];
  const calls: string[] = [];
  const result = await selectRestoreArtifacts(artifacts, REPOSITORY, REPOSITORY_ID, async (id, attempt) => {
    calls.push(`${id}:${attempt}`); return run(id, attempt, { conclusion: id === 100 ? 'failure' : 'success' });
  });
  assert.equal(result.negative?.artifact.id, 1, 'newer evidence wins even when both run ID and artifact ID are smaller');
  assert.equal(result.negative?.runId, 100); assert.equal(result.negative?.attempt, 2);
  assert.equal(result.accepted?.artifact.id, 12); assert.equal(result.catalog?.artifact.id, 13);
  assert.deepEqual(calls, ['100:2', '200:1'], 'each exact attempt is checked once, independent of run ID order');
});

test('the completed previous attempt remains usable while the same run has a newer in-progress attempt', async () => {
  const calls: string[] = [];
  const result = await selectRestoreArtifacts([
    artifact(1, 200, 1, 'trusted-source-suppressions'),
    artifact(2, 200, 1, 'trusted-refresh-state'),
    artifact(3, 200, 1, 'catalog-candidate'),
    artifact(4, 200, 2, 'trusted-source-suppressions', NEW),
  ], REPOSITORY, REPOSITORY_ID, async (id, attempt) => {
    calls.push(`${id}:${attempt}`);
    return run(id, attempt, attempt === 2 ? { status: 'in_progress', conclusion: '' } : {});
  });
  assert.deepEqual(calls, ['200:2', '200:1']);
  for (const candidate of Object.values(result)) assert.equal(candidate.attempt, 1);
  assert.equal(Object.keys(result).length, 3);
});

test('only exact positive run-attempt artifact names can identify restoration data', () => {
  for (const name of ['trusted-source-suppressions-1', 'trusted-source-suppressions-01-1', 'trusted-source-suppressions-1-0',
    'trusted-source-suppressions-1-01', 'trusted-source-suppressions-1-1.zip', '../trusted-source-suppressions-1-1',
    'trusted-source-suppressions-9007199254740992-1', 'trusted-refresh-state-1-9007199254740992', 'foreign-1-1']) {
    assert.equal(parseRestoreArtifact({ ...artifact(1), name }), undefined, name);
  }
  assert.equal(parseRestoreArtifact(artifact(1, 100, 2))?.attempt, 2);
  assert.equal(parseRestoreArtifact(artifact(1, 100, 2, 'catalog-candidate'))?.kind, 'catalog');
});

test('artifact origin must agree with its claimed run and the current repository before requesting an attempt', async () => {
  const base = artifact(1), origin = base.workflow_run!;
  const untrusted: Artifact[] = [
    { ...base, workflow_run: undefined },
    { ...base, workflow_run: { ...origin, id: 999 } },
    { ...base, workflow_run: { ...origin, repository_id: 999 } },
    { ...base, workflow_run: { ...origin, head_repository_id: 999 } },
    { ...base, workflow_run: { ...origin, head_branch: 'untrusted' } },
    { ...base, name: 'unrelated-artifact' },
    { ...base, expired: true },
  ];
  let called = false;
  const selected = await selectRestoreArtifacts(untrusted, REPOSITORY, REPOSITORY_ID, async () => { called = true; return run(); });
  assert.deepEqual(selected, {}); assert.equal(called, false);
});

test('each exact attempt must prove the matching identity, trusted workflow, main branch and completion', async () => {
  for (const override of [
    { id: 201 }, { run_attempt: 2 }, { status: 'in_progress' }, { conclusion: '' },
    { event: 'pull_request' }, { event: 'workflow_run' }, { head_branch: 'untrusted' },
    { path: '.github/workflows/ci.yml' }, { head_repository: { full_name: 'outsider/network' } },
  ]) {
    assert.deepEqual(await selectRestoreArtifacts([artifact(1)], REPOSITORY, REPOSITORY_ID, async () => run(200, 1, override)), {}, JSON.stringify(override));
  }
  assert.equal(trustedRun(run(0), REPOSITORY, false), false);
  assert.equal(trustedRun(run(200, -1), REPOSITORY, false), false);
  assert.equal(trustedRun(null, REPOSITORY, false), false);
});

test('a failed exact attempt can restore only its negative ledger and not accepted public state or history', async () => {
  const selected = await selectRestoreArtifacts([
    artifact(1, 200, 1, 'trusted-source-suppressions'), artifact(2, 200, 1, 'trusted-refresh-state'), artifact(3, 200, 1, 'catalog-candidate'),
  ], REPOSITORY, REPOSITORY_ID, async () => run(200, 1, { conclusion: 'failure' }));
  assert.deepEqual(Object.keys(selected), ['negative']);
});

test('ambiguous names or oversized newest trusted evidence fail instead of falling back to older state', async () => {
  await assert.rejects(selectRestoreArtifacts([artifact(1), artifact(2)], REPOSITORY, REPOSITORY_ID, async () => run()), /Ambiguous/);
  await assert.rejects(selectRestoreArtifacts([
    artifact(1), { ...artifact(2, 100, 2, 'trusted-source-suppressions', NEW), size_in_bytes: 100_000_000 },
  ], REPOSITORY, REPOSITORY_ID, async (id, attempt) => run(id, attempt)), /bounded restore size/);
});

test('attempt-read failure never silently selects older evidence', async () => {
  await assert.rejects(selectRestoreArtifacts([artifact(1)], REPOSITORY, REPOSITORY_ID, async () => { throw new Error('GitHub observation failed'); }), /GitHub observation failed/);
});
