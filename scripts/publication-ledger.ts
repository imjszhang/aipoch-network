import assert from 'node:assert/strict';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateRegistry, type Registry } from '../pipeline/registry.js';
import { readHistoricalSnapshot } from '../pipeline/history.js';
import { appendPublicationReceipt, buildPublicationIndex, catalogDatesDryRun, checkpointPublicationLedger, readPublicationLedger, validatePublicationIndex, validatePublicationReceipt, writePublicationLedger, type PublicationIndex, type PublicationLedger, type PublicationReceipt } from '../pipeline/catalog-dates.js';
import { sha256, stableJson } from '../pipeline/json.js';
import type { CatalogData } from '../spec/types.js';
import { validateCandidateMetadata, verifyPagesCandidate, type PagesMetadata, type PagesSelection } from './prepare-pages-candidate.js';

export interface PreparedPublication extends PublicationIndex {
  selection: PagesSelection;
  deployment_run_id: number;
  deployment_run_attempt: number;
  prepared_at: string;
}
export interface PublicationRun {
  id: number; run_attempt: number; head_sha: string; head_branch: string; event: string; path: string;
  head_repository: { full_name: string };
}
export interface PublicationJob { name: string; conclusion: string | null; status: string; completed_at: string | null; run_id: number; run_attempt: number }
export interface PublicationJobs { total_count: number; jobs: PublicationJob[] }

async function boundedJson(path: string, maximum = 8_000_000): Promise<unknown> {
  const stat = await lstat(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, 'Invalid or oversized publication evidence file');
  const bytes = await readFile(path); assert(bytes.length <= maximum, 'Publication evidence grew beyond its byte budget');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
/** Runs in the unprivileged verifier after binding exact source and immutable candidate bytes. */
export async function preparePublication(metadata: PagesMetadata, directory: string, registry: Registry, deploymentRunId: number, deploymentAttempt: number, now = Date.now()): Promise<PreparedPublication> {
  validateCandidateMetadata(metadata, now);
  await verifyPagesCandidate(directory, metadata.selection, now);
  assert.deepEqual(validateRegistry(registry), [], 'Invalid publication registry');
  assert(Number.isSafeInteger(deploymentRunId) && deploymentRunId > 0 && Number.isSafeInteger(deploymentAttempt) && deploymentAttempt > 0, 'Invalid deployment attempt');
  const snapshot = await readHistoricalSnapshot(join(directory, 'catalog/v1/snapshots', metadata.selection.snapshot_id), metadata.selection.snapshot_id);
  return { ...buildPublicationIndex(snapshot.catalog, registry), selection: metadata.selection, deployment_run_id: deploymentRunId, deployment_run_attempt: deploymentAttempt, prepared_at: new Date(now).toISOString() };
}

/** An artifact is only a candidate. The successful deploy job supplies publication time. */
export function reconcilePublication(prepared: PreparedPublication, run: PublicationRun, jobs: PublicationJobs, now = Date.now()) {
  validatePublicationIndex({ version: prepared.version, fingerprint_version: prepared.fingerprint_version, entries: prepared.entries });
  const selection = prepared.selection;
  assert(Number.isFinite(Date.parse(prepared.prepared_at)) && Date.parse(prepared.prepared_at) <= now, 'Invalid preparation time');
  assert(run.id === prepared.deployment_run_id && run.run_attempt === prepared.deployment_run_attempt && run.head_sha === selection.source_sha && run.head_branch === 'main' && run.event === 'workflow_dispatch' && run.path === '.github/workflows/deploy-pages.yml' && run.head_repository?.full_name === selection.repository, 'Publication run is not the exact trusted deployment attempt');
  assert(Number.isSafeInteger(jobs.total_count) && jobs.total_count >= 2 && jobs.total_count <= 100 && jobs.jobs.length === jobs.total_count, 'Deployment jobs inventory is truncated or exceeds its budget');
  assert(jobs.jobs.every(job => job.run_id === run.id && job.run_attempt === run.run_attempt), 'Jobs do not belong to the reviewed deployment attempt');
  const named = (name: string) => { const matches = jobs.jobs.filter(job => job.name === name); assert(matches.length === 1, 'Missing or ambiguous deployment job'); return matches[0]; };
  const verify = named('verify'), deploy = named('deploy'), smoke = named('smoke');
  assert(verify.status === 'completed' && verify.conclusion === 'success' && verify.completed_at && Number.isFinite(Date.parse(verify.completed_at)) && Date.parse(verify.completed_at) >= Date.parse(prepared.prepared_at), 'Publication membership lacks a completed successful artifact verifier');
  if (deploy.status !== 'completed' || deploy.conclusion !== 'success' || !deploy.completed_at) return { status: 'not_published' as const, reason: 'The deployment job has no successful completion', receipt: undefined };
  assert(Number.isFinite(Date.parse(deploy.completed_at)) && Date.parse(deploy.completed_at) >= Date.parse(verify.completed_at) && Date.parse(deploy.completed_at) <= now, 'Invalid deployment completion time');
  const receipt: PublicationReceipt = { version: 1, fingerprint_version: 1, repository: selection.repository, deployment_run_id: run.id, deployment_run_attempt: run.run_attempt, refresh_run_id: selection.run_id, source_sha: selection.source_sha, snapshot_id: selection.snapshot_id, artifact_sha256: selection.artifact_sha256, file_tree_sha256: selection.file_tree_sha256, deployed_at: deploy.completed_at, evidence: `https://github.com/${selection.repository}/actions/runs/${run.id}/attempts/${run.run_attempt}`, entries: prepared.entries };
  validatePublicationReceipt(receipt, now);
  const smokeSucceeded = smoke.status === 'completed' && smoke.conclusion === 'success' && smoke.completed_at && Date.parse(smoke.completed_at) >= Date.parse(deploy.completed_at) && Date.parse(smoke.completed_at) <= now;
  return { status: smokeSucceeded ? 'verified_publication' as const : 'pending_reconciliation' as const, reason: smokeSucceeded ? 'Exact artifact deployed and public smoke succeeded' : 'Deployment succeeded, but smoke did not confirm the public page; review public evidence before applying this proposed receipt', receipt, receipt_sha256: sha256(stableJson(receipt)) };
}
export function recordPublication(prepared: PreparedPublication, run: PublicationRun, jobs: PublicationJobs, now = Date.now()): PublicationReceipt {
  const report = reconcilePublication(prepared, run, jobs, now);
  assert(report.status === 'verified_publication' && report.receipt, 'Publication requires reconciliation; a failed smoke must not silently record success');
  return report.receipt;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'prepare') {
    const [metadataFile, site, registryFile, output] = args;
    assert(metadataFile && site && registryFile && output, 'Usage: publication-ledger prepare metadata.json site registry.json output.json');
    const metadata = await boundedJson(metadataFile) as PagesMetadata;
    assert(process.env.GITHUB_SHA === metadata.selection.source_sha, 'Verifier checkout must equal reviewed source SHA');
    const prepared = await preparePublication(metadata, site, await boundedJson(registryFile) as Registry, Number(process.env.GITHUB_RUN_ID), Number(process.env.GITHUB_RUN_ATTEMPT));
    await writeFile(output, stableJson(prepared)); return;
  }
  if (command === 'record' || command === 'reconcile') {
    const [preparedFile, runFile, jobsFile, output] = args;
    assert(preparedFile && runFile && jobsFile && output, 'Usage: publication-ledger record|reconcile prepared.json run.json jobs.json output.json');
    const prepared = await boundedJson(preparedFile) as PreparedPublication, run = await boundedJson(runFile) as PublicationRun, jobs = await boundedJson(jobsFile) as PublicationJobs;
    const result = command === 'record' ? recordPublication(prepared, run, jobs) : reconcilePublication(prepared, run, jobs);
    await writeFile(output, stableJson(result)); return;
  }
  if (command === 'apply') {
    const [receiptFile, ledgerFile, expectedDigest] = args;
    assert(receiptFile && ledgerFile && /^[a-f0-9]{64}$/.test(expectedDigest ?? ''), 'Usage: publication-ledger apply reviewed-receipt.json ledger.json exact-reviewed-receipt-sha256');
    const receipt = await boundedJson(receiptFile); validatePublicationReceipt(receipt);
    assert(sha256(stableJson(receipt)) === expectedDigest, 'Reviewed receipt digest differs');
    const prior = await readPublicationLedger(ledgerFile); assert(prior, 'Apply requires a reviewed baseline ledger');
    const changed = await writePublicationLedger(ledgerFile, appendPublicationReceipt(prior, receipt));
    console.log(changed ? 'Applied reviewed receipt to local ledger.' : 'No changes: receipt already applied.'); return;
  }
  if (command === 'checkpoint') {
    const [ledgerFile, output, expectedDigest] = args;
    assert(ledgerFile && output && /^[a-f0-9]{64}$/.test(expectedDigest ?? ''), 'Usage: publication-ledger checkpoint ledger.json output.json exact-reviewed-ledger-sha256');
    const ledger = await readPublicationLedger(ledgerFile); assert(ledger, 'Missing ledger');
    assert(sha256(stableJson(ledger)) === expectedDigest, 'Reviewed ledger digest differs');
    await writePublicationLedger(output, checkpointPublicationLedger(ledger)); return;
  }
  if (command === 'backfill') {
    const [catalogFile, registryFile, ledgerFile, output] = args;
    assert(catalogFile && registryFile && ledgerFile && output, 'Usage: publication-ledger backfill internal-catalog.json registry.json ledger.json report.json');
    const input = await boundedJson(catalogFile, 32_000_000) as CatalogData | { catalog: CatalogData };
    const registry = await boundedJson(registryFile) as Registry; assert.deepEqual(validateRegistry(registry), [], 'Invalid publication registry');
    const ledger = await readPublicationLedger(ledgerFile); assert(ledger, 'Missing ledger');
    const report = catalogDatesDryRun('catalog' in input ? input.catalog : input, registry, ledger);
    await writeFile(output, stableJson({ version: 1, ledger_sha256: sha256(stableJson(ledger)), rows: report })); return;
  }
  throw new Error('Expected prepare, record, reconcile, apply, checkpoint, or backfill');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error instanceof Error ? error.message : 'Publication history operation failed'); process.exitCode = 1; });
