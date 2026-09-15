import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { normalizeGitHubUrl } from '../spec/identity.js';
import { GitHubReader } from './github.js';
import { generate, readJson, stableJson } from './build.js';
import { validateRegistry, type Registry } from './registry.js';
import type { SnapshotBatch } from './normalize.js';
import { readRefreshState, refreshRegistry, validateBatch } from './refresh.js';
import { applySuppressions, readSuppressions } from './suppressions.js';
import { readPublicationLedger } from './catalog-dates.js';

async function loadRegistry(): Promise<Registry> {
  const registry = await readJson<Registry>(process.env.REGISTRY_FILE ?? 'registry/catalog.json');
  if (!process.env.ENHANCEMENT_FILE) return registry;
  try {
    const content = await readFile(process.env.ENHANCEMENT_FILE);
    if (content.length > 512_000) throw new Error('Enhancement exceeds 512 KB');
    const { applyRegistryEnhancement } = await import('./registry.js');
    const result = applyRegistryEnhancement(registry, JSON.parse(content.toString('utf8')));
    if (!result.applied) console.warn(`Optional enhancement ignored (${result.errors.length} validation problems); using reviewed baseline.`);
    return result.registry;
  } catch {
    console.warn('Optional enhancement unavailable or invalid; using reviewed baseline.');
    return registry;
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const registry = await loadRegistry();
  const registryErrors = validateRegistry(registry);
  if (registryErrors.length) throw new Error(registryErrors.join('\n'));
  if (command === 'check') { console.log(`Registry valid: ${registry.sources.length} reviewed sources.`); return; }
  if (command === 'intake') {
    if (!args[0]) throw new Error('Usage: npm run intake -- https://github.com/owner/repository [--resolve]');
    const candidate = normalizeGitHubUrl(args[0]);
    const duplicate = registry.sources.some(source => normalizeGitHubUrl(source.url).canonical_url === candidate.canonical_url);
    console.log(stableJson({ ...candidate, status: duplicate ? 'duplicate' : 'candidate' }).trim());
    if (args.includes('--resolve')) {
      const reader = new GitHubReader({ token: process.env.GITHUB_TOKEN });
      if (candidate.kind === 'organization') console.log(stableJson({ ...(await reader.organizationRepositories(candidate.owner)), notice: 'Candidates only. Select and review individual repositories.' }).trim());
      else { const observation = await reader.refresh(candidate.owner, candidate.repository!); console.log(stableJson({ availability: observation.availability, provider_id: observation.repository?.id, suppressed: observation.suppressed }).trim()); }
    }
    return;
  }
  if (command === 'refresh') {
    const previous = process.env.REFRESH_STATE
      ? await readRefreshState(process.env.REFRESH_STATE, registry)
      : await readRefreshState('.cache/batch.json', registry) ?? await readRefreshState('.cache/restored-refresh/refresh-state.json', registry)
        ?? await readRefreshState('fixtures/pilot/snapshots.json', registry);
    const { report } = await refreshRegistry(registry, { previous, log: console.log });
    console.log(`${report.candidate_kind === 'withdrawal_only' ? 'Withdrawal cleanup candidate' : 'Complete refresh candidate'} saved locally: ${report.observed} checked, ${report.retained} retained, ${report.withheld} withheld. No deployment performed.`);
    return;
  }
  if (command === 'recover') {
    if (args.length !== 3) throw new Error('Usage: npm run catalog:recover -- historical-registry.json historical-batch.json current-batch.json');
    const { prepareRecoveryInputs } = await import('./recovery.js');
    const historicalRegistry = await readJson<Registry>(args[0]);
    const historicalBatch = await readJson<SnapshotBatch>(args[1]);
    const currentBatch = applySuppressions(await readJson<SnapshotBatch>(args[2]), await readSuppressions(process.env.SUPPRESSION_STATE ?? '.cache/source-suppressions.json'), registry);
    validateBatch(registry, currentBatch);
    const candidate = prepareRecoveryInputs(historicalRegistry, historicalBatch, registry, currentBatch);
    await mkdir('.cache/recovery', { recursive: true });
    await writeFile('.cache/recovery/registry.json', stableJson(candidate.registry));
    await writeFile('.cache/recovery/batch.json', stableJson(candidate.batch));
    await writeFile('.cache/recovery/report.json', stableJson(candidate.report));
    console.log('Recovery inputs prepared with current withdrawals and source state. Review .cache/recovery/report.json, then build with REGISTRY_FILE=.cache/recovery/registry.json SOURCE_BATCH=.cache/recovery/batch.json.');
    return;
  }
  if (command === 'build') {
    let batch: SnapshotBatch;
    if (process.env.SOURCE_BATCH) batch = await readJson<SnapshotBatch>(process.env.SOURCE_BATCH);
    else {
      try { batch = await readJson<SnapshotBatch>('.cache/batch.json'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; batch = await readJson<SnapshotBatch>('fixtures/pilot/snapshots.json'); }
    }
    batch = applySuppressions(batch, await readSuppressions(process.env.SUPPRESSION_STATE ?? '.cache/source-suppressions.json'), registry);
    validateBatch(registry, batch);
    const report = process.env.REFRESH_REPORT ? await readJson<{ candidate_kind: string }>(process.env.REFRESH_REPORT) : undefined;
    if (report && !['refresh', 'withdrawal_only'].includes(report.candidate_kind)) throw new Error('A rejected refresh cannot become a build candidate');
    const publicationLedger = await readPublicationLedger(process.env.PUBLICATION_LEDGER ?? 'registry/publication-ledger.json');
    if (!publicationLedger) throw new Error('A reviewed publication ledger is required; missing history must not reset catalog dates');
    const manifest = await generate(registry, batch, 'generated', 200, {
      historyDirectory: process.env.HISTORY_DIRECTORY,
      publicationLedger,
      candidateKind: report?.candidate_kind as 'refresh' | 'withdrawal_only' | undefined,
    });
    console.log(`Catalog ${manifest.snapshot_id} built from observations at ${manifest.generated_at}.`);
    return;
  }
  throw new Error('Commands: check, intake, refresh, recover, build');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Catalog operation failed'); process.exitCode = 1; });
