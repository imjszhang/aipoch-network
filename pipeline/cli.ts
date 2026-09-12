import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeGitHubUrl } from '../spec/identity.js';
import { GitHubReader, readSnapshot, saveSnapshot } from './github.js';
import { generate, readJson, stableJson } from './build.js';
import { validateRegistry, type Registry } from './registry.js';
import type { SnapshotBatch } from './normalize.js';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const registry = await readJson<Registry>('registry/catalog.json');
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
    const reader = new GitHubReader({ token: process.env.GITHUB_TOKEN });
    const batch: SnapshotBatch = { as_of: new Date().toISOString(), sources: [] };
    for (const source of registry.sources) {
      const candidate = normalizeGitHubUrl(source.url);
      const previous = await readSnapshot('.cache/sources', candidate.canonical_url);
      const snapshot = await reader.refresh(candidate.owner, candidate.repository!, previous);
      await saveSnapshot('.cache/sources', snapshot);
      batch.sources.push(snapshot);
      console.log(`${candidate.canonical_url}: ${snapshot.availability}${snapshot.suppressed ? ' (withheld)' : ''}`);
    }
    batch.as_of = new Date().toISOString();
    await mkdir('.cache', { recursive: true });
    await writeFile('.cache/batch.json', stableJson(batch));
    console.log('Snapshot batch saved locally. Run npm run catalog:build to validate the candidate.');
    return;
  }
  if (command === 'build') {
    let batch: SnapshotBatch;
    if (process.env.SOURCE_BATCH) batch = await readJson<SnapshotBatch>(process.env.SOURCE_BATCH);
    else {
      try { batch = await readJson<SnapshotBatch>('.cache/batch.json'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; batch = await readJson<SnapshotBatch>('fixtures/pilot/snapshots.json'); }
    }
    const manifest = await generate(registry, batch);
    console.log(`Catalog ${manifest.snapshot_id} built from observations at ${manifest.generated_at}.`);
    return;
  }
  throw new Error('Commands: check, intake, refresh, build');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Catalog operation failed'); process.exitCode = 1; });
