import test from 'node:test';
import assert from 'node:assert/strict';
import { recordPublication, reconcilePublication, type PreparedPublication, type PublicationJobs, type PublicationRun } from '../../scripts/publication-ledger.js';
import { readDeploymentRuns, receiptArtifact, requiredPublicationReceipts, type DeploymentRun } from '../../scripts/restore-publications.js';
import type { PublicationLedger } from '../catalog-dates.js';
import type { Artifact } from '../../scripts/restore-refresh.js';

const repository = 'example/network', SHA = 'a'.repeat(40), T0 = '2026-09-12T09:00:00Z', T1 = '2026-09-12T10:00:00Z', T2 = '2026-09-12T11:00:00Z';
function prepared(): PreparedPublication { return { version: 1, fingerprint_version: 1, entries: [{ id: 'project:p', kind: 'project', fingerprint: 'd'.repeat(64) }], selection: { repository, run_id: 90, snapshot_id: 'a'.repeat(24), source_sha: SHA, artifact_sha256: `sha256:${'b'.repeat(64)}`, file_tree_sha256: `sha256:${'c'.repeat(64)}`, site_base: '/' }, deployment_run_id: 100, deployment_run_attempt: 1, prepared_at: T0 }; }
function run(overrides: Partial<DeploymentRun> = {}): DeploymentRun { return { id: 100, run_attempt: 1, head_sha: SHA, head_branch: 'main', event: 'workflow_dispatch', path: '.github/workflows/deploy-pages.yml', head_repository: { full_name: repository }, status: 'completed', updated_at: T2, ...overrides }; }
function jobs(overrides: Partial<PublicationJobs['jobs'][number]> = {}): PublicationJobs { return { total_count: 3, jobs: [{ name: 'verify', conclusion: 'success', status: 'completed', completed_at: T0, run_id: 100, run_attempt: 1 }, { name: 'deploy', conclusion: 'success', status: 'completed', completed_at: T1, run_id: 100, run_attempt: 1 }, { name: 'smoke', conclusion: 'success', status: 'completed', completed_at: T2, run_id: 100, run_attempt: 1, ...overrides }] }; }
function ledger(): PublicationLedger { return { version: 1, fingerprint_version: 1, repository, coverage: 'partial', checkpoint: { through: T0, entries: [] }, releases: [] }; }

test('the successful deploy completion, not preparation or smoke time, establishes publication', () => {
  const receipt = recordPublication(prepared(), run(), jobs());
  assert.equal(receipt.deployed_at, T1); assert.equal(receipt.source_sha, SHA);
  assert.equal(receipt.evidence, 'https://github.com/example/network/actions/runs/100/attempts/1');
  assert.deepEqual(receipt.entries, prepared().entries);
  assert.deepEqual(recordPublication(prepared(), run(), jobs()), receipt, 'Recorder rerun over identical evidence is deterministic');
});

test('failed smoke is pending reconciliation after a successful deployment, and failed deploy is not published', () => {
  const failedSmoke = jobs({ conclusion: 'failure' });
  const pending = reconcilePublication(prepared(), run(), failedSmoke);
  assert.equal(pending.status, 'pending_reconciliation'); assert.equal(pending.receipt?.deployed_at, T1);
  assert.throws(() => recordPublication(prepared(), run(), failedSmoke), /reconciliation/);
  const failedDeploy = jobs(); failedDeploy.jobs[1].conclusion = 'failure';
  const failed = reconcilePublication(prepared(), run(), failedDeploy);
  assert.equal(failed.status, 'not_published'); assert.equal(failed.receipt, undefined);
});

test('publication binding rejects a different commit, repository, attempt, incomplete jobs, or changed clock', () => {
  for (const invalid of [run({ head_sha: 'b'.repeat(40) }), run({ run_attempt: 2 }), run({ head_branch: 'feature' }), run({ head_repository: { full_name: 'other/network' } })]) assert.throws(() => recordPublication(prepared(), invalid, jobs()), /exact trusted/);
  assert.throws(() => recordPublication(prepared(), run(), { ...jobs(), total_count: 5 }), /truncated/);
  assert.throws(() => recordPublication(prepared(), run(), { ...jobs(), jobs: jobs().jobs.map(job => ({ ...job, run_attempt: 2 })) }), /attempt/);
  assert.throws(() => recordPublication(prepared(), run(), jobs(), Date.parse(T0)), /completion/);
});

test('recorder-only reruns cannot borrow preparation or completion from another deployment attempt', () => {
  assert.throws(() => recordPublication(prepared(), run({ run_attempt: 2 }), jobs()), /exact trusted/);
  const rerun = { ...prepared(), deployment_run_attempt: 2 };
  assert.throws(() => recordPublication(rerun, run({ run_attempt: 2 }), jobs()), /Jobs do not belong/);
  // Repair uses the original immutable attempt evidence through read-only reconcile.
  assert.equal(reconcilePublication(prepared(), run(), jobs()).status, 'verified_publication');
});

test('deployment inventory requires complete bounded pagination, with no changed totals or duplicate IDs', async () => {
  const values = Array.from({ length: 101 }, (_, i) => run({ id: i + 1 }));
  assert.equal((await readDeploymentRuns(async page => ({ total_count: 101, workflow_runs: values.slice((page - 1) * 100, page * 100) }))).length, 101);
  await assert.rejects(readDeploymentRuns(async () => ({ total_count: 101, workflow_runs: [run()] })), /incomplete/);
  await assert.rejects(readDeploymentRuns(async () => ({ total_count: 1001, workflow_runs: [] })), /budget/);
  await assert.rejects(readDeploymentRuns(async page => ({ total_count: page === 1 ? 101 : 102, workflow_runs: values.slice((page - 1) * 100, page * 100) })), /changed/);
  await assert.rejects(readDeploymentRuns(async () => ({ total_count: 2, workflow_runs: [run(), run()] })), /Duplicate/);
});

test('a newer accepted receipt never hides an intervening successful deploy with a missing receipt', async () => {
  const baseline = ledger();
  baseline.releases = [recordPublication({ ...prepared(), deployment_run_id: 101 }, run({ id: 101 }), { total_count: 3, jobs: jobs().jobs.map(job => ({ ...job, run_id: 101, completed_at: job.name === 'deploy' ? T2 : job.completed_at === T2 ? '2026-09-12T11:01:00Z' : job.completed_at })) })];
  const required = await requiredPublicationReceipts(baseline, [run()], async () => run(), async () => jobs());
  assert.equal(required.length, 1); assert.equal(required[0].run.id, 100);
});

test('restore checks every rerun attempt and preserves smoke failure as an actionable reconciliation gap', async () => {
  const listing = run({ run_attempt: 2 });
  const attempted: number[] = [];
  const required = await requiredPublicationReceipts(ledger(), [listing], async (_, attempt) => { attempted.push(attempt); return run({ run_attempt: attempt }); }, async (_, attempt) => {
    if (attempt === 1) return jobs({ conclusion: 'failure' });
    return { total_count: 1, jobs: [{ ...jobs().jobs[0], run_attempt: 2, conclusion: 'failure' }] };
  });
  assert.deepEqual(attempted, [1, 2]); assert.equal(required.length, 1); assert.equal(required[0].smokeConfirmed, false);
  await assert.rejects(requiredPublicationReceipts(ledger(), [run({ status: 'in_progress' })], async () => run(), async () => jobs()), /live deployment/);
});

test('receipt artifact identity, origin and byte budget are enforced before downloading', () => {
  const artifact: Artifact = { id: 7, name: 'catalog-publication-receipt-100-1', expired: false, size_in_bytes: 1000, created_at: T2, workflow_run: { id: 100, repository_id: 1, head_repository_id: 1, head_branch: 'main' } };
  assert.deepEqual(receiptArtifact(artifact, 1), { runId: 100, attempt: 1 });
  assert.equal(receiptArtifact(artifact, 2), undefined);
  assert.equal(receiptArtifact({ ...artifact, workflow_run: { ...artifact.workflow_run!, head_repository_id: 2 } }, 1), undefined);
  assert.throws(() => receiptArtifact({ ...artifact, size_in_bytes: 8_000_001 }, 1), /budget/);
});
