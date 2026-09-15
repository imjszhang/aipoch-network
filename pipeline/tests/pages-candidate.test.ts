import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, stableJson, sha256 } from '../build.js';
import type { SnapshotBatch } from '../normalize.js';
import type { Registry } from '../registry.js';
import { candidateFileTree, validateCandidateMetadata, verifyPagesCandidate, type PagesMetadata, type PagesSelection } from '../../scripts/prepare-pages-candidate.js';

const T = '2026-09-12T12:00:00.000Z', NOW = Date.parse(T) + 60_000, SHA = 'a'.repeat(40), DIGEST = `sha256:${'b'.repeat(64)}`;
const execute = promisify(execFile);
function metadata(): PagesMetadata {
  const run = { id: 100, run_attempt: 1, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', head_branch: 'main', head_sha: SHA, path: '.github/workflows/refresh.yml', created_at: '2026-09-12T11:59:00Z', updated_at: T, head_repository: { full_name: 'lab/network' } };
  return { selection: { repository: 'lab/network', run_id: 100, snapshot_id: 'a'.repeat(24), artifact_sha256: DIGEST, file_tree_sha256: DIGEST, source_sha: SHA, site_base: '/' },
    repository: { full_name: 'lab/network', default_branch: 'main' }, main_sha: SHA, run,
    artifact: { id: 200, name: 'catalog-candidate-100-1', expired: false, expires_at: '2026-09-19T12:00:00Z', size_in_bytes: 1000, digest: DIGEST, workflow_run: { id: 100, head_sha: SHA } }, latest_runs: [structuredClone(run)], latest_runs_total_count: 1 };
}
async function temporary(t: TestContext) { const root = await mkdtemp(join(tmpdir(), 'aipoch-pages-test-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
async function fixture(t: TestContext, history = false, sourceObservedAt = '2026-09-12T11:59:00Z'): Promise<{ root: string; selection: PagesSelection }> {
  const root = await temporary(t);
  const registry = JSON.parse(await readFile('registry/catalog.json', 'utf8')) as Registry;
  const batch = JSON.parse(await readFile('fixtures/pilot/snapshots.json', 'utf8')) as SnapshotBatch;
  // This verifier fixture has a frozen synthetic clock; pilot observations may be newer.
  // Only the in-memory test copy is rebased, never the actual source fixture evidence.
  delete batch.accounts;
  for (const source of batch.sources) { source.checked_at = sourceObservedAt; source.observed_at = sourceObservedAt;
    delete source.observation; delete source.github_metrics; delete source.source_activity;
  }
  if (history) { batch.as_of = '2026-09-12T11:59:00Z'; await generate(registry, batch, root, 200, { candidateKind: 'refresh' }); }
  batch.as_of = T;
  const manifest = await generate(registry, batch, root, 200, { candidateKind: 'refresh' });
  for (const file of ['index.html', '404.html']) await writeFile(join(root, file), '<!doctype html><html><body>Skip to content<script>window.__AIPOCH__={}</script></body></html>');
  await writeFile(join(root, '.nojekyll'), '');
  await writeFile(join(root, 'routes.json'), stableJson({ base: '/', paths: ['/'], snapshot_id: manifest.snapshot_id }));
  await writeFile(join(root, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  await writeFile(join(root, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://aipoch.network/</loc></url></urlset>');
  await writeFile(join(root, 'third-party-notices.txt'), 'Synthetic verifier fixture only; this file does not prove real license review.');
  return { root, selection: { ...metadata().selection, snapshot_id: manifest.snapshot_id, file_tree_sha256: (await candidateFileTree(root)).file_tree_sha256 } };
}

test('Pages verifier checks source observation age independently of a fresh batch timestamp', async t => {
  for (const sourceObservedAt of ['2026-09-12T12:10:00Z', '2026-09-01T00:00:00Z']) {
    const { root, selection } = await fixture(t, false, sourceObservedAt);
    await assert.rejects(verifyPagesCandidate(root, selection, NOW), /expired or from the future/);
  }
});

test('Pages metadata binds one successful current main refresh and exact artifact digest', () => {
  validateCandidateMetadata(metadata(), NOW);
  const mutations: ((m: PagesMetadata) => void)[] = [m => { m.main_sha = 'c'.repeat(40); }, m => { m.run.event = 'pull_request'; }, m => { m.run.head_repository!.full_name = 'other/network'; }, m => { m.run.conclusion = 'failure'; }, m => { m.artifact.digest = `sha256:${'d'.repeat(64)}`; }, m => { m.artifact.expired = true; }, m => { m.artifact.workflow_run.head_sha = 'c'.repeat(40); }];
  for (const mutate of mutations) { const m = metadata(); mutate(m); assert.throws(() => validateCandidateMetadata(m, NOW)); }
  assert.throws(() => validateCandidateMetadata(metadata(), NOW + 60 * 60 * 1000), /expired/);
});

test('Pages rejects an explicitly reviewed Demo build while accepting the unavailable production adapter', async t => {
  const { root, selection } = await fixture(t);
  await writeFile(join(root, 'build-info.json'), JSON.stringify({ design: 'v9-r2', workbench_mode: 'demo', real_connector: false }));
  selection.file_tree_sha256 = (await candidateFileTree(root)).file_tree_sha256;
  await assert.rejects(verifyPagesCandidate(root, selection, NOW), /Demo or unverified Connector/);
  await writeFile(join(root, 'build-info.json'), JSON.stringify({ design: 'v9-r2', workbench_mode: 'unavailable', real_connector: false }));
  selection.file_tree_sha256 = (await candidateFileTree(root)).file_tree_sha256;
  await verifyPagesCandidate(root, selection, NOW);
});
test('real Connector publication requires an explicit matching reviewed mode and supported protocol', async t => {
  const { root, selection } = await fixture(t);
  const info = { design: 'v9-r2', workbench_mode: 'real', real_connector: true, connector_protocol: '1.0', connector_endpoint: 'http://127.0.0.1:47821' };
  await writeFile(join(root, 'build-info.json'), JSON.stringify(info));
  selection.file_tree_sha256 = (await candidateFileTree(root)).file_tree_sha256;
  await assert.rejects(verifyPagesCandidate(root, selection, NOW), /unverified Connector/);
  await verifyPagesCandidate(root, { ...selection, workbench_mode: 'real' }, NOW);
  await writeFile(join(root, 'build-info.json'), JSON.stringify({ ...info, connector_protocol: '2.0' }));
  selection.file_tree_sha256 = (await candidateFileTree(root)).file_tree_sha256;
  await assert.rejects(verifyPagesCandidate(root, { ...selection, workbench_mode: 'real' }, NOW), /protocol/);
});
test('Pages selection cannot bypass a newer failed run, an older-ID rerun or a live refresh', () => {
  for (const newer of [{ id: 101, status: 'completed', conclusion: 'failure' }, { id: 10, status: 'completed', conclusion: 'failure' }, { id: 9, status: 'in_progress', conclusion: null }]) {
    const m = metadata(); m.latest_runs.push({ ...m.run, ...newer, run_attempt: 2, updated_at: '2026-09-12T12:00:30Z' }); m.latest_runs_total_count = 2;
    assert.throws(() => validateCandidateMetadata(m, NOW), /newer or live/);
  }
  const m = metadata(); m.latest_runs_total_count = 101;
  assert.throws(() => validateCandidateMetadata(m, NOW), /truncated/);
});
test('Pages verifier accepts intact current and retained history without changing input bytes', async t => {
  const { root, selection } = await fixture(t, true);
  const before = await readFile(join(root, 'catalog/v1/history.json'));
  const result = await verifyPagesCandidate(root, selection, NOW);
  assert.equal(result.snapshot_id, selection.snapshot_id); assert.equal(result.valid_until, '2026-09-12T13:00:00.000Z');
  assert.deepEqual(await readFile(join(root, 'catalog/v1/history.json')), before);
});
test('Pages verifier rejects wrong base, snapshot, stale candidate and offline build', async t => {
  const { root, selection } = await fixture(t);
  await assert.rejects(verifyPagesCandidate(root, { ...selection, site_base: '/aipoch-network/' }, NOW), /SITE_BASE/);
  await assert.rejects(verifyPagesCandidate(root, { ...selection, snapshot_id: 'f'.repeat(24) }, NOW), /Reviewed snapshot/);
  await assert.rejects(verifyPagesCandidate(root, selection, NOW + 60 * 60 * 1000), /expired/);
  const file = join(root, 'build-report.json'), report = JSON.parse(await readFile(file, 'utf8')); report.candidate_kind = 'offline'; await writeFile(file, stableJson(report));
  selection.file_tree_sha256 = (await candidateFileTree(root)).file_tree_sha256;
  await assert.rejects(verifyPagesCandidate(root, selection, NOW), /offline/);
});
test('Pages verifier rejects retired history resurrection even with recomputed report hash', async t => {
  const { root, selection } = await fixture(t, true);
  const file = join(root, 'catalog/v1/history.json'), ledger = JSON.parse(await readFile(file, 'utf8'));
  const old = ledger.snapshots.find((row: { snapshot_id: string }) => row.snapshot_id !== selection.snapshot_id); old.status = 'withdrawn'; old.reason = 'current_withdrawal';
  await writeFile(file, stableJson(ledger));
  const reportFile = join(root, 'build-report.json'), report = JSON.parse(await readFile(reportFile, 'utf8')); report.history_sha256 = sha256(stableJson(ledger)); await writeFile(reportFile, stableJson(report));
  selection.file_tree_sha256 = (await candidateFileTree(root)).file_tree_sha256;
  await assert.rejects(verifyPagesCandidate(root, selection, NOW), /retired snapshots/);
});
test('Pages verifier rejects mismatched browser data and unmanifested public files', async t => {
  const { root, selection } = await fixture(t);
  const file = join(root, 'internal/catalog.json'), content = await readFile(file), value = JSON.parse(content.toString()); value.catalog.resources[0].title = 'Unreviewed resource'; await writeFile(file, stableJson(value));
  await assert.rejects(verifyPagesCandidate(root, selection, NOW), /file-tree digest/);
  selection.file_tree_sha256 = (await candidateFileTree(root)).file_tree_sha256;
  await assert.rejects(verifyPagesCandidate(root, selection, NOW), /Browser catalog/);
  await writeFile(file, content); await writeFile(join(root, '.env'), 'SHOULD_NOT_BE_PUBLISHED');
  selection.file_tree_sha256 = (await candidateFileTree(root)).file_tree_sha256;
  await assert.rejects(verifyPagesCandidate(root, selection, NOW), /Unexpected file/);
  await rm(join(root, '.env')); await rm(join(root, 'third-party-notices.txt'));
  selection.file_tree_sha256 = (await candidateFileTree(root)).file_tree_sha256;
  await assert.rejects(verifyPagesCandidate(root, selection, NOW), /ENOENT/);
});
test('Artifact extraction requires the reviewed SHA and refuses traversal and symlinks', async t => {
  const root = await temporary(t), archive = join(root, 'candidate.zip');
  const create = async (name: string, symlink = false) => {
    await execute('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); i=zipfile.ZipInfo(sys.argv[2]); i.external_attr=(0o120777 if sys.argv[3]=="yes" else 0o100644)<<16; z.writestr(i,"content"); z.close()', archive, name, symlink ? 'yes' : 'no']);
    return `sha256:${sha256(await readFile(archive))}`;
  };
  const helper = 'docs/deployment/verify-artifact.py';
  const digest = await create('index.html');
  await assert.rejects(execute('python3', [helper, archive, DIGEST, join(root, 'bad-digest')]));
  await execute('python3', [helper, archive, digest, join(root, 'valid')]); assert.equal(await readFile(join(root, 'valid/index.html'), 'utf8'), 'content');
  const treeDigest = (await candidateFileTree(join(root, 'valid'))).file_tree_sha256;
  const reviewedContent = await execute('python3', [helper, archive, DIGEST, join(root, 'reviewed-content'), treeDigest]);
  const receipt = JSON.parse(reviewedContent.stdout);
  assert.equal(receipt.archive_digest_matches_metadata, false); assert.equal(receipt.acceptance_policy, 'reviewed-file-tree-v1'); assert.equal(receipt.file_tree_sha256, treeDigest);
  await assert.rejects(execute('python3', [helper, archive, digest, join(root, 'different-content'), DIGEST]));
  for (const [name, link] of [['../escape', false], ['/escape', false], ['safe-link', true]] as const) {
    const hash = await create(name, link); await assert.rejects(execute('python3', [helper, archive, hash, join(root, 'unsafe')]));
  }
  assert.deepEqual((await readdir(root)).sort(), ['candidate.zip', 'reviewed-content', 'valid']);
});
