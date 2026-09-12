import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readRefreshState, refreshState } from '../pipeline/refresh.js';
import { stableJson } from '../pipeline/build.js';
import type { Registry } from '../pipeline/registry.js';
import { readSuppressions, saveSuppressions } from '../pipeline/suppressions.js';
import { readHistoricalSnapshot } from '../pipeline/history.js';

const execute = promisify(execFile);
type Run = { id: number; run_attempt: number; status: string; conclusion: string; event: string; head_branch: string; path: string; head_repository?: { full_name: string } };
type Artifact = { id: number; name: string; expired: boolean; size_in_bytes: number };
export function trustedRun(run: Run, repository: string, requireSuccess = true): boolean {
  return Number.isSafeInteger(run.id) && Number.isSafeInteger(run.run_attempt) && run.status === 'completed' && (!requireSuccess || run.conclusion === 'success')
    && run.event === 'workflow_dispatch' && run.head_branch === 'main' && run.path === '.github/workflows/refresh.yml'
    && run.head_repository?.full_name.toLowerCase() === repository.toLowerCase();
}
async function singleFile(directory: string, name: string): Promise<string> {
  const files = await readdir(directory, { withFileTypes: true });
  if (files.length !== 1 || files[0].name !== name || !files[0].isFile() || files[0].isSymbolicLink()) throw new Error('Unexpected trusted state artifact layout');
  return join(directory, name);
}
async function restoreHistory(directory: string): Promise<void> {
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
  // Copy manifested snapshots and the retirement ledger, never old HTML or raw caches.
  const destination = '.cache/restored-history';
  await rm(destination, { recursive: true, force: true });
  await mkdir(join(destination, 'catalog/v1/snapshots'), { recursive: true });
  for (const entry of entries) {
    const snapshot = await readHistoricalSnapshot(join(root, entry.name), entry.name);
    const output = join(destination, 'catalog/v1/snapshots', entry.name);
    await mkdir(output, { recursive: true });
    for (const [file, content] of snapshot.files) { await mkdir(join(output, file, '..'), { recursive: true }); await writeFile(join(output, file), content); }
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

/** Only the private repository's completed main refresh workflow can supply prior state. */
export async function restoreRefresh(repository = process.env.GITHUB_REPOSITORY): Promise<boolean> {
  if (!repository || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY must name the current repository');
  const metadata = JSON.parse(await gh(['api', `repos/${repository}`])) as { private: boolean };
  if (metadata.private !== true) throw new Error('Cross-run state restore is currently restricted to private development; review publication policy first');
  const response = JSON.parse(await gh(['api', `repos/${repository}/actions/workflows/refresh.yml/runs?branch=main&status=completed&event=workflow_dispatch&per_page=20`])) as { workflow_runs: Run[] };
  let restoredState = false, restoredNegative = false, restoredCatalog = false;
  for (const run of response.workflow_runs.filter(run => trustedRun(run, repository, false))) {
    const listed = JSON.parse(await gh(['api', `repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`])) as { artifacts: Artifact[] };
    const artifact = (prefix: string) => listed.artifacts.find(item => item.name === `${prefix}-${run.id}-${run.run_attempt}` && !item.expired && item.size_in_bytes < 100_000_000);
    await mkdir('.cache', { recursive: true });
    const temporary = await mkdtemp('.cache/restore-refresh-');
    try {
      const download = async (item: Artifact, folder: string) => {
        const path = join(temporary, folder); await mkdir(path);
        await gh(['run', 'download', String(run.id), '--repo', repository, '--name', item.name, '--dir', path]);
        return path;
      };
      const negative = artifact('trusted-source-suppressions');
      if (!restoredNegative && negative) {
        const folder = await download(negative, 'negative');
        const state = await readSuppressions(await singleFile(folder, 'source-suppressions.json'));
        await saveSuppressions('.cache/source-suppressions.json', state);
        restoredNegative = true;
        console.log(`Restored current suppression evidence from completed trusted main run ${run.id}.`);
      }
      if (trustedRun(run, repository)) {
        const candidate = artifact('catalog-candidate');
        const accepted = artifact('trusted-refresh-state');
        if (!restoredState && accepted) {
          const folder = await download(accepted, 'accepted');
          const registry = JSON.parse(await readFile(process.env.REGISTRY_FILE ?? 'registry/catalog.json', 'utf8')) as Registry;
          const state = await readRefreshState(await singleFile(folder, 'refresh-state.json'), registry);
          if (!state) throw new Error('Trusted state artifact is empty');
          await mkdir('.cache/restored-refresh', { recursive: true });
          const destination = '.cache/restored-refresh/refresh-state.json';
          await writeFile(`${destination}.tmp`, stableJson(refreshState(state))); await rename(`${destination}.tmp`, destination);
          restoredState = true;
          console.log(`Restored accepted public observations from successful private main run ${run.id}.`);
        }
        if (!restoredCatalog && candidate) {
          await restoreHistory(await download(candidate, 'candidate'));
          restoredCatalog = true;
          console.log(`Restored validated catalog history from successful private main run ${run.id}.`);
        }
      }
    } finally { await rm(temporary, { recursive: true, force: true }); }
    if (restoredState && restoredNegative && restoredCatalog) break;
  }
  if (!restoredState) console.log('No retained successful refresh state exists. The live refresh must meet completeness gates using available reviewed inputs.');
  return restoredState;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  restoreRefresh().catch(error => { console.error(error instanceof Error ? error.message : 'State restore failed'); process.exitCode = 1; });
}
