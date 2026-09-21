import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readRefreshState, refreshState } from '../pipeline/refresh.js';
import { stableJson } from '../pipeline/build.js';
import type { Registry } from '../pipeline/registry.js';
import { readSuppressions, saveSuppressions } from '../pipeline/suppressions.js';
import { readHistoricalSnapshot, type SnapshotHistory } from '../pipeline/history.js';
import { readSiteAssets } from '../pipeline/site-assets.js';
import { verifyUiHistoryPublication } from '../pipeline/browser-projection.js';
import type { CatalogManifest } from '../spec/types.js';

const execute = promisify(execFile);
export type Run = { id: number; run_attempt: number; status: string; conclusion: string; event: string; head_branch: string; path: string; head_repository?: { full_name: string } };
export type Artifact = {
  id: number; name: string; expired: boolean; size_in_bytes: number; created_at: string;
  workflow_run?: { id: number; repository_id: number; head_repository_id: number; head_branch: string };
};
type RestoreKind = 'accepted' | 'negative' | 'catalog';
export type RestoreArtifact = { artifact: Artifact; runId: number; attempt: number; kind: RestoreKind };
const MAX_ARTIFACTS = 1000;
const PAGE_SIZE = 100;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
export function trustedRun(run: Run | null | undefined, repository: string, requireSuccess = true): boolean {
  return !!run && positiveInteger(run.id) && positiveInteger(run.run_attempt) && run.status === 'completed'
    && ['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale', 'startup_failure'].includes(run.conclusion)
    && (!requireSuccess || run.conclusion === 'success')
    && run.event === 'workflow_dispatch' && run.head_branch === 'main' && run.path === '.github/workflows/refresh.yml'
    && typeof run.head_repository?.full_name === 'string' && run.head_repository.full_name.toLowerCase() === repository.toLowerCase();
}

/** Read the complete bounded inventory before selecting evidence; omitted pages cannot mean "no newer state". */
export async function readArtifactInventory(readPage: (page: number, pageSize: number) => Promise<unknown>, options: { maxArtifacts?: number; pageSize?: number } = {}): Promise<Artifact[]> {
  const maximum = options.maxArtifacts ?? MAX_ARTIFACTS, pageSize = options.pageSize ?? PAGE_SIZE;
  if (!positiveInteger(maximum) || maximum > MAX_ARTIFACTS || !positiveInteger(pageSize) || pageSize > PAGE_SIZE) throw new Error('Invalid artifact inventory bounds');
  const artifacts: Artifact[] = [], seen = new Set<number>();
  let total: number | undefined;
  for (let page = 1; page <= Math.ceil(maximum / pageSize); page++) {
    const response = await readPage(page, pageSize) as { total_count?: unknown; artifacts?: unknown } | null;
    if (!response || !Number.isSafeInteger(response.total_count) || Number(response.total_count) < 0 || !Array.isArray(response.artifacts)) throw new Error('Invalid artifact inventory response');
    if (Number(response.total_count) > maximum) throw new Error('Artifact inventory exceeds the complete restore limit; review retained artifacts before retrying');
    if (total === undefined) total = Number(response.total_count);
    if (response.total_count !== total) throw new Error('Artifact inventory changed during pagination; retry before restoring state');
    if (response.artifacts.length !== Math.min(pageSize, total - artifacts.length)) throw new Error('Artifact inventory is incomplete or truncated');
    for (const item of response.artifacts as Artifact[]) {
      if (!item || !positiveInteger(item.id) || typeof item.name !== 'string' || !item.name || item.name.length > 256
        || typeof item.expired !== 'boolean' || !Number.isSafeInteger(item.size_in_bytes) || item.size_in_bytes < 0
        || typeof item.created_at !== 'string' || !Number.isFinite(Date.parse(item.created_at))) throw new Error('Invalid artifact inventory record');
      if (seen.has(item.id)) throw new Error('Artifact inventory repeated an ID; complete enumeration cannot be proven');
      seen.add(item.id); artifacts.push(item);
    }
    if (artifacts.length === total) return artifacts;
  }
  throw new Error('Artifact inventory is incomplete or truncated');
}

export function parseRestoreArtifact(artifact: Artifact): RestoreArtifact | undefined {
  const match = /^(trusted-refresh-state|trusted-source-suppressions|catalog-candidate)-([1-9][0-9]*)-([1-9][0-9]*)$/.exec(artifact.name);
  if (!match) return;
  const runId = Number(match[2]), attempt = Number(match[3]);
  if (!positiveInteger(runId) || !positiveInteger(attempt)) return;
  return { artifact, runId, attempt, kind: match[1] === 'trusted-refresh-state' ? 'accepted' : match[1] === 'trusted-source-suppressions' ? 'negative' : 'catalog' };
}

/** Artifact creation time identifies the newest retained evidence, including a later attempt of an older run. */
export async function selectRestoreArtifacts(artifacts: readonly Artifact[], repository: string, repositoryId: number, readAttempt: (runId: number, attempt: number) => Promise<Run>): Promise<Partial<Record<RestoreKind, RestoreArtifact>>> {
  if (!positiveInteger(repositoryId)) throw new Error('Invalid repository identity for artifact restore');
  const candidates = artifacts.flatMap(artifact => {
    const candidate = parseRestoreArtifact(artifact), origin = artifact.workflow_run;
    return candidate && !artifact.expired && origin?.id === candidate.runId && origin.repository_id === repositoryId
      && origin.head_repository_id === repositoryId && origin.head_branch === 'main' ? [candidate] : [];
  }).sort((a, b) => Date.parse(b.artifact.created_at) - Date.parse(a.artifact.created_at) || b.artifact.id - a.artifact.id);
  const names = new Set<string>();
  for (const candidate of candidates) {
    if (names.has(candidate.artifact.name)) throw new Error('Ambiguous retained artifact name for a run attempt');
    names.add(candidate.artifact.name);
  }
  const result: Partial<Record<RestoreKind, RestoreArtifact>> = {}, attempts = new Map<string, Run>();
  for (const candidate of candidates) {
    if (result[candidate.kind]) continue;
    const key = `${candidate.runId}:${candidate.attempt}`;
    let run = attempts.get(key);
    if (!run) { run = await readAttempt(candidate.runId, candidate.attempt); attempts.set(key, run); }
    if (run.id !== candidate.runId || run.run_attempt !== candidate.attempt || !trustedRun(run, repository, candidate.kind !== 'negative')) continue;
    if (candidate.artifact.size_in_bytes <= 0 || candidate.artifact.size_in_bytes >= 100_000_000) throw new Error('Trusted artifact exceeds the bounded restore size');
    result[candidate.kind] = candidate;
    if (result.accepted && result.negative && result.catalog) break;
  }
  return result;
}
async function singleFile(directory: string, name: string): Promise<string> {
  const files = await readdir(directory, { withFileTypes: true });
  if (files.length !== 1 || files[0].name !== name || !files[0].isFile() || files[0].isSymbolicLink()) throw new Error('Unexpected trusted state artifact layout');
  return join(directory, name);
}
export async function restoreHistory(directory: string, destination = '.cache/restored-history'): Promise<void> {
  const root = join(directory, 'catalog/v1/snapshots');
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length > 4096) throw new Error('Historical candidate exceeds snapshot limit');
  let bytes = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Unexpected historical snapshot node');
    const result = await readHistoricalSnapshot(join(root, entry.name), entry.name);
    bytes += result.bytes;
    if (bytes > 96 * 1024 * 1024) throw new Error('Historical candidate exceeds total byte limit');
  }
  // The first migration accepts old candidates without a UI projection. Partial or unknown new UI artifacts fail closed.
  let hasUi = false;
  for (const path of ['internal/ui', 'internal/ui-manifest.json', 'internal/site-assets.json']) {
    try { await lstat(join(directory, path)); hasUi = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  let uiFiles: string[] = [];
  let siteAssetFiles = new Map<string, Buffer>();
  if (hasUi) {
    const manifestBytes = await readFile(join(directory, 'catalog/v1/manifest.json')), historyBytes = await readFile(join(directory, 'catalog/v1/history.json'));
    if (manifestBytes.length > 1024 * 1024 || historyBytes.length > 1024 * 1024) throw new Error('Historical UI metadata exceeds limit');
    const manifest = JSON.parse(manifestBytes.toString()) as CatalogManifest;
    const history = JSON.parse(historyBytes.toString()) as SnapshotHistory;
    const current = await readHistoricalSnapshot(join(root, manifest.snapshot_id), manifest.snapshot_id);
    uiFiles = (await verifyUiHistoryPublication(directory, history, current.catalog, manifest.snapshot_id, manifest.generated_at)).files;
    siteAssetFiles = (await readSiteAssets(directory, history))?.files ?? new Map();
  }
  // Copy validated snapshots and projection bytes, never old HTML or raw caches.
  await rm(destination, { recursive: true, force: true });
  await mkdir(join(destination, 'catalog/v1/snapshots'), { recursive: true });
  for (const entry of entries) {
    const snapshot = await readHistoricalSnapshot(join(root, entry.name), entry.name);
    const output = join(destination, 'catalog/v1/snapshots', entry.name);
    await mkdir(output, { recursive: true });
    for (const [file, content] of snapshot.files) { await mkdir(join(output, file, '..'), { recursive: true }); await writeFile(join(output, file), content); }
  }
  for (const [file, content] of siteAssetFiles) {
    const output = join(destination, file); await mkdir(join(output, '..'), { recursive: true }); await writeFile(output, content);
  }
  for (const file of uiFiles) {
    const output = join(destination, file); await mkdir(join(output, '..'), { recursive: true }); await writeFile(output, await readFile(join(directory, file)));
  }
  for (const file of ['manifest.json', 'history.json']) {
    const content = await readFile(join(directory, 'catalog/v1', file));
    if (content.length > 1024 * 1024) throw new Error('Historical manifest exceeds limit');
    await writeFile(join(destination, 'catalog/v1', file), content);
  }
}
async function gh(args: string[]): Promise<string> {
  try {
    const result = await execute('gh', args, { env: { ...process.env, GH_HOST: 'github.com' }, maxBuffer: 2_000_000, timeout: 60_000 });
    return result.stdout;
  } catch { throw new Error('Trusted refresh artifact could not be read; check workflow read access and GitHub availability.'); }
}

/** Only the current repository's completed main refresh workflow can supply prior state. */
export async function restoreRefresh(repository = process.env.GITHUB_REPOSITORY): Promise<boolean> {
  if (!repository || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY must name the current repository');
  const metadata = JSON.parse(await gh(['api', `repos/${repository}`])) as { private: boolean; id: number };
  const artifacts = await readArtifactInventory(async (page, pageSize) => JSON.parse(await gh(['api', `repos/${repository}/actions/artifacts?per_page=${pageSize}&page=${page}`])));
  const selected = await selectRestoreArtifacts(artifacts, repository, metadata.id,
    async (runId, attempt) => JSON.parse(await gh(['api', `repos/${repository}/actions/runs/${runId}/attempts/${attempt}?exclude_pull_requests=true`])) as Run);
  // A public deployment must never silently bootstrap after withdrawal evidence expires.
  if (!metadata.private && (!selected.accepted || !selected.negative || !selected.catalog)) {
    throw new Error('Public refresh requires retained accepted state, suppression evidence, and catalog history; recover the reviewed baseline before retrying');
  }
  let restoredState = false;
  await mkdir('.cache', { recursive: true });
  const temporary = await mkdtemp('.cache/restore-refresh-');
  try {
    const download = async (candidate: RestoreArtifact, folder: string) => {
      const path = join(temporary, folder); await mkdir(path);
      await gh(['run', 'download', String(candidate.runId), '--repo', repository, '--name', candidate.artifact.name, '--dir', path]);
      return path;
    };
    // Persist negative evidence first, even if a later accepted-state or history download fails.
    if (selected.negative) {
      const folder = await download(selected.negative, 'negative');
      const state = await readSuppressions(await singleFile(folder, 'source-suppressions.json'));
      await saveSuppressions('.cache/source-suppressions.json', state);
      console.log(`Restored current suppression evidence from completed trusted main run ${selected.negative.runId}, attempt ${selected.negative.attempt}.`);
    }
    if (selected.accepted) {
      const folder = await download(selected.accepted, 'accepted');
      const registry = JSON.parse(await readFile(process.env.REGISTRY_FILE ?? 'registry/catalog.json', 'utf8')) as Registry;
      const state = await readRefreshState(await singleFile(folder, 'refresh-state.json'), registry);
      if (!state) throw new Error('Trusted state artifact is empty');
      await mkdir('.cache/restored-refresh', { recursive: true });
      const destination = '.cache/restored-refresh/refresh-state.json';
      await writeFile(`${destination}.tmp`, stableJson(refreshState(state))); await rename(`${destination}.tmp`, destination);
      restoredState = true;
      console.log(`Restored accepted public observations from successful trusted main run ${selected.accepted.runId}, attempt ${selected.accepted.attempt}.`);
    }
    if (selected.catalog) {
      await restoreHistory(await download(selected.catalog, 'candidate'));
      console.log(`Restored validated catalog history from successful trusted main run ${selected.catalog.runId}, attempt ${selected.catalog.attempt}.`);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
  if (!restoredState) console.log('No retained successful refresh state exists. The live refresh must meet completeness gates using available reviewed inputs.');
  return restoredState;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  restoreRefresh().catch(error => { console.error(error instanceof Error ? error.message : 'State restore failed'); process.exitCode = 1; });
}
