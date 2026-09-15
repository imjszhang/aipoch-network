import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { generate } from '../build.js';
import { normalize, type SnapshotBatch } from '../normalize.js';
import { refreshRegistry, validateBatch } from '../refresh.js';
import { applySuppressions, observeSuppression, readSuppressions, saveSuppressions, type SuppressionState } from '../suppressions.js';
import type { SourceSnapshot } from '../github.js';
import type { Registry } from '../registry.js';
import type { CatalogData } from '../../spec/types.js';

const OLD = '2026-09-12T07:00:00.000Z';
const NOW = '2026-09-12T08:00:00.000Z';
const NEXT = '2026-09-12T08:01:00.000Z';
const A = 'https://github.com/example-lab/withdrawal-target';
const B = 'https://github.com/example-lab/retained-study';
const A_ID = 'source:github:501';
const run = promisify(execFile);
const cliFile = fileURLToPath(new URL('../cli.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');

function source(url: string, id: number, observed = OLD): SourceSnapshot {
  return {
    requested_url: url, checked_at: observed, observed_at: observed, availability: 'accessible', suppressed: false,
    repository: {
      id, name: url.split('/').at(-1)!, full_name: url.split('/').slice(-2).join('/'), html_url: url,
      description: id === 501 ? 'WITHDRAWN_SOURCE_DESCRIPTION' : 'Unrelated public source',
      default_branch: 'main', archived: false, fork: false,
      owner: { id: 601, login: 'example-lab', type: 'Organization', html_url: 'https://github.com/example-lab' },
      topics: [], updated_at: OLD, has_issues: true, has_discussions: true,
      readme: id === 501 ? 'WITHDRAWN_SOURCE_README' : 'Unrelated README',
    },
  };
}
function fixture(): { registry: Registry; batch: SnapshotBatch } {
  return {
    registry: {
      version: 1,
      sources: [A, B].map(url => ({ url, reviewed_at: OLD, review_note: 'Synthetic public source for lifecycle regression.' })),
      resources: [
        { key: 'target', title: 'WITHDRAWN_RESOURCE_TITLE', type: 'method', domains: ['science'], sources: [A] },
        { key: 'retained', title: 'Unrelated research method', type: 'method', domains: ['science'], sources: [B] },
      ],
      projects: [{ key: 'target', title: 'WITHDRAWN_PROJECT_TITLE', domains: ['science'], sources: [A], resources: ['target'] }],
      collections: [{ key: 'selected', title: 'Selected methods', selection_basis: 'Synthetic test collection', item_ids: ['resource:target', 'resource:retained'] }],
      withdrawals: [],
    },
    batch: { as_of: OLD, sources: [source(A, 501), source(B, 502)] },
  };
}
function ledger(): SuppressionState {
  return { version: 1, sources: [{ requested_url: A, provider_id: 501, checked_at: NOW, reason: 'not_public' }] };
}
async function directory(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'aipoch-suppression-test-'));
  await writeFile(join(path, 'publication-ledger.json'), JSON.stringify({ version: 1, fingerprint_version: 1, repository: 'example/catalog', coverage: 'partial', releases: [] }));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
function assertWithdrawn(catalog: CatalogData): void {
  assert.ok(!catalog.sources.some(item => item.id === A_ID));
  assert.ok(!catalog.resources.some(item => item.id === 'resource:target'));
  assert.ok(catalog.tombstones.some(item => item.id === A_ID));
  assert.doesNotMatch(JSON.stringify(catalog), /withdrawal-target|WITHDRAWN_SOURCE|WITHDRAWN_RESOURCE|WITHDRAWN_PROJECT/);
}
async function filesText(root: string): Promise<string> {
  const parts: string[] = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    const path = join(root, item.name);
    parts.push(item.isDirectory() ? await filesText(path) : await readFile(path, 'utf8'));
  }
  return parts.join('\n');
}
async function runCli(root: string, args: string[], overrides: NodeJS.ProcessEnv = {}) {
  return run(process.execPath, ['--import', tsxLoader, cliFile, ...args], {
    cwd: root,
    env: {
      ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', ENHANCEMENT_FILE: '', REFRESH_REPORT: '', HISTORY_DIRECTORY: '',
      REGISTRY_FILE: join(root, 'registry.json'), SOURCE_BATCH: join(root, 'batch.json'), SUPPRESSION_STATE: join(root, 'suppressions.json'),
      PUBLICATION_LEDGER: join(root, 'publication-ledger.json'),
      ...overrides,
    },
    timeout: 30_000, maxBuffer: 1_000_000,
  });
}

test('a cleanup candidate persists suppression across a second refresh that starts from older accepted inputs', async t => {
  const root = await directory(t), { registry, batch } = fixture();
  const first = await refreshRegistry(registry, { directory: root, previous: batch, now: () => new Date(NOW), reader: {
    refresh: async (_owner, repo, previous) => repo === 'withdrawal-target'
      ? { ...previous!, checked_at: NOW, availability: 'private', suppressed: true, error: 'not_public' }
      : { requested_url: B, checked_at: NOW, availability: 'temporarily_unavailable', suppressed: false, error: 'unavailable' },
  } });
  assert.equal(first.report.complete, false);
  assert.equal(first.report.candidate_kind, 'withdrawal_only');
  assert.equal(first.report.withheld, 1);
  assertWithdrawn(normalize(registry, first.batch).catalog);
  assert.equal((await readSuppressions(join(root, 'source-suppressions.json'), new Date(NOW))).sources[0]?.provider_id, 501);
  const second = await refreshRegistry(registry, { directory: root, previous: batch, now: () => new Date(NEXT), reader: {
    refresh: async (_owner, repo, previous) => {
      if (repo === 'withdrawal-target') {
        assert.equal(previous?.suppressed, true, 'negative knowledge must override the older public cache before requesting');
        return { ...previous!, checked_at: NEXT, availability: 'temporarily_unavailable', error: 'unavailable' };
      }
      return source(B, 502, NEXT);
    },
  } });
  assertWithdrawn(normalize(registry, second.batch).catalog);
  assert.equal(second.report.withheld, 1);
  assert.ok(normalize(registry, second.batch).catalog.resources.some(item => item.id === 'resource:retained'));
});

test('a source denial survives interruption or a later invalid observation without promoting partial accepted inputs', async t => {
  for (const failure of ['interruption', 'validation'] as const) {
    const root = await directory(t), { registry, batch } = fixture();
    await writeFile(join(root, 'batch.json'), JSON.stringify(batch));
    await assert.rejects(refreshRegistry(registry, { directory: root, previous: batch, now: () => new Date(NOW), reader: {
      refresh: async (_owner, repo, previous) => {
        if (repo === 'withdrawal-target') return { ...previous!, checked_at: NOW, availability: 'unknown', suppressed: true, error: 'not_public' };
        if (failure === 'interruption') throw new Error('Synthetic interrupted source read');
        const invalid = source(B, 502, NOW); invalid.repository!.commit = 'not-an-immutable-commit'; return invalid;
      },
    } }), failure === 'interruption' ? /interrupted source read/ : /Catalog validation failed/);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'batch.json'), 'utf8')), batch);
    const state = await readSuppressions(join(root, 'source-suppressions.json'), new Date(NOW));
    assert.equal(state.sources.length, 1);
    assertWithdrawn(normalize(registry, applySuppressions(batch, state)).catalog);
    await assert.rejects(readFile(join(root, 'refresh-lock/owner.json')), /ENOENT/);
  }
});

test('withdrawal cleanup also withholds unrelated expired harvested content without claiming a complete refresh', async t => {
  const root = await directory(t), { registry, batch } = fixture();
  const result = await refreshRegistry(registry, { directory: root, previous: batch, now: () => new Date(NOW), reader: {
    refresh: async (_owner, repo, previous) => repo === 'withdrawal-target'
      ? { ...previous!, checked_at: NOW, availability: 'private', suppressed: true, error: 'not_public' }
      : { ...previous!, checked_at: NOW, observed_at: '2026-09-01T00:00:00.000Z', availability: 'temporarily_unavailable', error: 'unavailable' },
  } });
  assert.equal(result.report.candidate_kind, 'withdrawal_only');
  assert.equal(result.report.complete, false);
  const catalog = normalize(registry, result.batch).catalog;
  assertWithdrawn(catalog);
  assert.equal(catalog.resources.length, 0);
  assert.equal(catalog.sources[0]?.readme, undefined);
  assert.equal(catalog.sources[0]?.collaboration, undefined);
});

test('explicit SOURCE_BATCH build applies the current ledger and keeps all generated public files free of withdrawn data', async t => {
  const root = await directory(t), { registry, batch } = fixture();
  await writeFile(join(root, 'registry.json'), JSON.stringify(registry));
  await writeFile(join(root, 'batch.json'), JSON.stringify(batch));
  await saveSuppressions(join(root, 'suppressions.json'), ledger());
  await runCli(root, ['build']);
  const result = JSON.parse(await readFile(join(root, 'generated/internal/catalog.json'), 'utf8')) as { catalog: CatalogData };
  assertWithdrawn(result.catalog);
  assert.doesNotMatch(await filesText(join(root, 'generated')), /withdrawal-target|WITHDRAWN_SOURCE|WITHDRAWN_RESOURCE|WITHDRAWN_PROJECT/);
});

test('CLI recovery re-applies current negative knowledge before restoring historical editorial values', async t => {
  const root = await directory(t), { registry, batch } = fixture();
  await writeFile(join(root, 'registry.json'), JSON.stringify(registry));
  await writeFile(join(root, 'batch.json'), JSON.stringify(batch));
  await saveSuppressions(join(root, 'suppressions.json'), ledger());
  await runCli(root, ['recover', join(root, 'registry.json'), join(root, 'batch.json'), join(root, 'batch.json')]);
  const recoveredRegistry = JSON.parse(await readFile(join(root, '.cache/recovery/registry.json'), 'utf8')) as Registry;
  const recoveredBatch = JSON.parse(await readFile(join(root, '.cache/recovery/batch.json'), 'utf8')) as SnapshotBatch;
  assertWithdrawn(normalize(recoveredRegistry, recoveredBatch).catalog);
  const report = JSON.parse(await readFile(join(root, '.cache/recovery/report.json'), 'utf8'));
  assert.equal(report.skipped.resources, 1);
  assert.equal(report.restored.resources, 1);
});

test('a missing source is rejected by validation and explicit CLI build before replacing an existing output', async t => {
  const root = await directory(t), { registry, batch } = fixture();
  await writeFile(join(root, 'registry.json'), JSON.stringify(registry));
  await writeFile(join(root, 'batch.json'), JSON.stringify(batch));
  await runCli(root, ['build']);
  const original = await readFile(join(root, 'generated/catalog/v1/manifest.json'), 'utf8');
  const empty = { as_of: NOW, sources: [] };
  assert.throws(() => validateBatch(registry, empty, new Date(NOW)), /incomplete/);
  await writeFile(join(root, 'batch.json'), JSON.stringify(empty));
  await assert.rejects(runCli(root, ['build']), error => /incomplete/.test(String((error as { stderr?: string }).stderr)));
  assert.equal(await readFile(join(root, 'generated/catalog/v1/manifest.json'), 'utf8'), original);
});

test('first-observation denials retain only opaque candidate IDs in the public build report', async t => {
  const root = await directory(t), { registry, batch } = fixture();
  batch.as_of = NOW;
  batch.sources[0] = { requested_url: A, checked_at: NOW, availability: 'unknown', suppressed: true, error: 'not_public' };
  await generate(registry, batch, join(root, 'generated'), 200, { candidateKind: 'withdrawal_only' });
  const reportText = await readFile(join(root, 'generated/build-report.json'), 'utf8');
  const report = JSON.parse(reportText);
  assert.equal(report.candidate_kind, 'withdrawal_only');
  assert.match(report.diagnostics[0].id, /^candidate:[a-f0-9]{24}$/);
  assert.doesNotMatch(await filesText(join(root, 'generated')), /withdrawal-target|WITHDRAWN_SOURCE|WITHDRAWN_RESOURCE|WITHDRAWN_PROJECT/);
});

test('automatic suppression clears only after newer observed public evidence for the same identity', () => {
  const state = ledger();
  for (const snapshot of [
    { ...source(A, 501, NEXT), availability: 'temporarily_unavailable' as const },
    source(A, 999, NEXT),
    source(A, 501, OLD),
    { ...source(A, 501, NEXT), observed_at: undefined },
    { ...source(A, 501, NEXT), observed_at: OLD },
  ]) assert.deepEqual(observeSuppression(state, snapshot), state, JSON.stringify({ checked_at: snapshot.checked_at, observed_at: snapshot.observed_at, availability: snapshot.availability, id: snapshot.repository?.id }));
  assert.deepEqual(observeSuppression(state, source(A, 501, NEXT)), { version: 1, sources: [] });
});

test('same-identity public recovery clears automatic denial but never clears a reviewed manual withdrawal', async t => {
  const root = await directory(t), { registry, batch } = fixture();
  registry.withdrawals.push({ id: A_ID, withdrawn_at: NOW, reason: 'withdrawn' });
  await saveSuppressions(join(root, 'source-suppressions.json'), ledger());
  const result = await refreshRegistry(registry, { directory: root, previous: batch, now: () => new Date(NEXT), reader: {
    refresh: async (_owner, repo) => repo === 'withdrawal-target' ? source(A, 501, NEXT) : source(B, 502, NEXT),
  } });
  assert.deepEqual((await readSuppressions(join(root, 'source-suppressions.json'), new Date(NEXT))).sources, []);
  assertWithdrawn(normalize(registry, result.batch).catalog);
  assert.equal(registry.withdrawals.length, 1);
});

test('a name reused by a different repository cannot replace the identity retained in the negative ledger', async t => {
  const root = await directory(t), { registry, batch } = fixture();
  await saveSuppressions(join(root, 'source-suppressions.json'), ledger());
  const result = await refreshRegistry(registry, { directory: root, previous: batch, now: () => new Date(NEXT), reader: {
    refresh: async (_owner, repo) => repo === 'withdrawal-target' ? source(A, 999, NEXT) : source(B, 502, NEXT),
  } });
  const state = await readSuppressions(join(root, 'source-suppressions.json'), new Date(NEXT));
  assert.equal(state.sources[0]?.provider_id, 501);
  assert.equal(state.sources[0]?.reason, 'identity_changed');
  assertWithdrawn(normalize(registry, result.batch).catalog);
  assert.ok(!normalize(registry, result.batch).catalog.sources.some(item => item.provider_id === 999));
});
