import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, readFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readArtifactInventory, type Artifact } from './restore-refresh.js';
import { appendPublicationReceipt, readPublicationLedger, validatePublicationReceipt, writePublicationLedger, MAX_PUBLICATION_LEDGER_BYTES, type PublicationLedger, type PublicationReceipt } from '../pipeline/catalog-dates.js';
import type { PublicationJob, PublicationJobs, PublicationRun } from './publication-ledger.js';

const execute = promisify(execFile);
export interface DeploymentRun extends PublicationRun { status: string; updated_at: string }
export async function readDeploymentRuns(readPage: (page: number) => Promise<unknown>): Promise<DeploymentRun[]> {
  const runs: DeploymentRun[] = []; let total: number | undefined;
  for (let page = 1; page <= 10; page++) {
    const part = await readPage(page) as { total_count: number; workflow_runs: DeploymentRun[] };
    assert(Number.isSafeInteger(part?.total_count) && part.total_count >= 0 && part.total_count <= 1000 && Array.isArray(part.workflow_runs), 'Deployment history exceeds its complete inventory budget');
    total ??= part.total_count;
    assert(part.total_count === total && part.workflow_runs.length === Math.min(100, total - runs.length), 'Deployment history changed or pagination is incomplete');
    for (const run of part.workflow_runs) {
      assert(Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0 && run.run_attempt <= 20 && Number.isFinite(Date.parse(run.updated_at)), 'Invalid deployment run metadata');
      assert(!runs.some(item => item.id === run.id), 'Duplicate deployment history entry'); runs.push(run);
    }
    if (runs.length === total) return runs;
  }
  throw new Error('Incomplete deployment history inventory');
}
export function receiptArtifact(artifact: Artifact, repositoryId: number): { runId: number; attempt: number } | undefined {
  const match = /^catalog-publication-receipt-([1-9][0-9]*)-([1-9][0-9]*)$/.exec(artifact.name);
  if (!match) return;
  const runId = Number(match[1]), attempt = Number(match[2]), origin = artifact.workflow_run;
  assert(Number.isSafeInteger(runId) && Number.isSafeInteger(attempt), 'Invalid receipt artifact identity');
  if (!origin || origin.id !== runId || origin.repository_id !== repositoryId || origin.head_repository_id !== repositoryId || origin.head_branch !== 'main') return;
  assert(artifact.size_in_bytes > 0 && artifact.size_in_bytes <= MAX_PUBLICATION_LEDGER_BYTES, 'Receipt artifact exceeds its byte budget');
  return { runId, attempt };
}
function trustedDeployment(run: DeploymentRun, repository: string): boolean {
  return run.path === '.github/workflows/deploy-pages.yml' && run.event === 'workflow_dispatch' && run.head_branch === 'main' && run.head_repository?.full_name === repository;
}
/** Inspects every attempt after the reviewed checkpoint, including failed smoke/recorder runs. */
export async function requiredPublicationReceipts(ledger: PublicationLedger, runs: DeploymentRun[], readAttempt: (runId: number, attempt: number) => Promise<DeploymentRun>, readJobs: (runId: number, attempt: number) => Promise<PublicationJobs>): Promise<{ run: DeploymentRun; deploy: PublicationJob; smokeConfirmed: boolean }[]> {
  // An individual newer receipt does not prove that an intervening deployment had
  // no missing recorder. Only an explicitly reviewed checkpoint closes history.
  const through = Date.parse(ledger.checkpoint?.through ?? '') || 0;
  const required: { run: DeploymentRun; deploy: PublicationJob; smokeConfirmed: boolean }[] = [];
  for (const listing of runs) {
    assert(trustedDeployment(listing, ledger.repository), 'Untrusted deployment inventory');
    if (Date.parse(listing.updated_at) <= through) continue;
    assert(listing.status === 'completed', 'A live deployment must finish before publication history is restored');
    for (let attempt = 1; attempt <= listing.run_attempt; attempt++) {
      const run = await readAttempt(listing.id, attempt);
      assert(run.id === listing.id && run.run_attempt === attempt && trustedDeployment(run, ledger.repository) && run.status === 'completed', 'Untrusted deployment attempt');
      const jobs = await readJobs(run.id, attempt);
      assert(Number.isSafeInteger(jobs.total_count) && jobs.total_count >= 1 && jobs.total_count <= 100 && jobs.total_count === jobs.jobs.length && jobs.jobs.every(job => job.run_id === run.id && job.run_attempt === attempt), 'Deployment jobs inventory is incomplete');
      const deploys = jobs.jobs.filter(job => job.name === 'deploy'); assert(deploys.length <= 1, 'Ambiguous deploy job');
      const deploy = deploys[0];
      if (!deploy || deploy.status !== 'completed' || deploy.conclusion !== 'success') continue;
      assert(deploy.completed_at && Number.isFinite(Date.parse(deploy.completed_at)), 'Successful deployment lacks its completion time');
      if (Date.parse(deploy.completed_at) <= through) continue;
      const smoke = jobs.jobs.filter(job => job.name === 'smoke'); assert(smoke.length <= 1, 'Ambiguous smoke job');
      required.push({ run, deploy, smokeConfirmed: smoke[0]?.status === 'completed' && smoke[0]?.conclusion === 'success' });
    }
  }
  return required.sort((a, b) => Date.parse(a.deploy.completed_at!) - Date.parse(b.deploy.completed_at!) || a.run.id - b.run.id || a.run.run_attempt - b.run.run_attempt);
}
async function gh(args: string[]): Promise<string> {
  try { return (await execute('gh', args, { env: { ...process.env, GH_HOST: 'github.com' }, timeout: 30_000, maxBuffer: 8_000_000 })).stdout; }
  catch { throw new Error('Read-only publication evidence retrieval failed'); }
}
export async function restorePublications(repository = process.env.GITHUB_REPOSITORY, baselineFile = 'registry/publication-ledger.json', output = '.cache/publication-ledger.json'): Promise<PublicationLedger> {
  assert(repository && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository), 'Invalid publication repository');
  let ledger = await readPublicationLedger(baselineFile); assert(ledger && ledger.repository === repository, 'A reviewed publication checkpoint is required');
  const api = async (path: string) => JSON.parse(await gh(['api', `repos/${repository}/${path}`]));
  const repo = JSON.parse(await gh(['api', `repos/${repository}`])) as { id: number };
  assert(Number.isSafeInteger(repo.id) && repo.id > 0, 'Invalid publication repository identity');
  const runs = await readDeploymentRuns(page => api(`actions/workflows/deploy-pages.yml/runs?branch=main&event=workflow_dispatch&per_page=100&page=${page}`));
  const required = await requiredPublicationReceipts(ledger, runs, (id, attempt) => api(`actions/runs/${id}/attempts/${attempt}`), (id, attempt) => api(`actions/runs/${id}/attempts/${attempt}/jobs?per_page=100`));
  const artifacts = required.length ? await readArtifactInventory((page, pageSize) => api(`actions/artifacts?per_page=${pageSize}&page=${page}`)) : [];
  await mkdir('.cache', { recursive: true });
  const temporary = await mkdtemp('.cache/restore-publications-');
  try {
    for (const { run, deploy, smokeConfirmed } of required) {
      const existing = ledger.releases.find(receipt => receipt.deployment_run_id === run.id && receipt.deployment_run_attempt === run.run_attempt);
      if (existing) {
        assert(existing.source_sha === run.head_sha && existing.deployed_at === deploy.completed_at, 'Reviewed receipt differs from the successful deployment');
        // A reviewed reconciliation can cover a deployment whose original smoke
        // failed; its receipt remains valid after the temporary artifact expires.
        continue;
      }
      const matches = artifacts.filter(artifact => { const identity = receiptArtifact(artifact, repo.id); return identity?.runId === run.id && identity.attempt === run.run_attempt; });
      assert(matches.length === 1 && !matches[0].expired && smokeConfirmed, `Deployment ${run.id} attempt ${run.run_attempt} needs explicit publication reconciliation or a reviewed checkpoint; missing/expired receipts never mean unpublished`);
      const directory = join(temporary, `${run.id}-${run.run_attempt}`); await mkdir(directory);
      await gh(['run', 'download', String(run.id), '--repo', repository, '--name', matches[0].name, '--dir', directory]);
      const files = await readdir(directory, { withFileTypes: true });
      assert(files.length === 1 && files[0].name === 'publication-receipt.json' && files[0].isFile() && !files[0].isSymbolicLink(), 'Unexpected publication receipt artifact layout');
      const path = join(directory, files[0].name); assert((await lstat(path)).size <= MAX_PUBLICATION_LEDGER_BYTES, 'Publication receipt exceeds its byte budget');
      const receipt: unknown = JSON.parse(await readFile(path, 'utf8')); validatePublicationReceipt(receipt);
      assert(receipt.repository === repository && receipt.deployment_run_id === run.id && receipt.deployment_run_attempt === run.run_attempt && receipt.source_sha === run.head_sha && receipt.deployed_at === deploy.completed_at, 'Restored receipt differs from the successful deployment');
      ledger = appendPublicationReceipt(ledger, receipt);
    }
    await writePublicationLedger(output, ledger);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  console.log(`Restored ${required.length} deployment receipts after the reviewed publication checkpoint.`);
  return ledger;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) restorePublications().catch(error => { console.error(error instanceof Error ? error.message : 'Publication restore failed'); process.exitCode = 1; });
