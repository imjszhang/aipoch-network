import { assertValidCatalog, type CatalogData, type CatalogManifest } from '../spec/index.js';
import { generate } from './build.js';
import { normalize, type SnapshotBatch } from './normalize.js';
import { type Registry } from './registry.js';
import { sha256, stableJson } from './json.js';

export interface RecoveryReport {
  version: 1;
  policy: 'current_scope_sources_withdrawals_and_authority';
  restored: { projects: number; resources: number; collections: number };
  skipped: { projects: number; resources: number; collections: number };
  historical_inputs_sha256: string;
  current_inputs_sha256: string;
}
export interface RecoveryInputs { registry: Registry; batch: SnapshotBatch; report: RecoveryReport }

/** Recover safe prior editorial values, never old source visibility, withdrawn membership, or authority. */
export function prepareRecoveryInputs(historicalRegistry: Registry, historicalBatch: SnapshotBatch, currentRegistry: Registry, currentBatch: SnapshotBatch): RecoveryInputs {
  const historical = normalize(historicalRegistry, historicalBatch).catalog;
  const current = normalize(currentRegistry, currentBatch).catalog;
  assertValidCatalog(historical); assertValidCatalog(current);
  if (Date.parse(currentBatch.as_of) < Date.parse(historicalBatch.as_of)) throw new Error('Recovery policy observations cannot precede the historical inputs');
  const registry = structuredClone(currentRegistry), batch = structuredClone(currentBatch);
  const report: RecoveryReport = {
    version: 1, policy: 'current_scope_sources_withdrawals_and_authority',
    restored: { projects: 0, resources: 0, collections: 0 }, skipped: { projects: 0, resources: 0, collections: 0 },
    historical_inputs_sha256: sha256(stableJson({ registry: historicalRegistry, batch: historicalBatch })),
    current_inputs_sha256: sha256(stableJson({ registry: currentRegistry, batch: currentBatch })),
  };
  const currentSources = new Map(current.sources.map(source => [source.id, source]));
  const historicalSources = new Map(historical.sources.map(source => [source.id, source]));
  function safeSources(ids: string[]): boolean {
    return ids.every(id => {
      const before = historicalSources.get(id), now = currentSources.get(id);
      return before && now && !['private', 'deleted'].includes(now.availability)
        && Date.parse(currentBatch.as_of) - Date.parse(now.observed_at) <= 7 * 24 * 60 * 60 * 1000
        && before.owner_id === now.owner_id
        && (before.canonical_url.toLowerCase() === now.canonical_url.toLowerCase() || now.aliases.some(alias => alias.url.toLowerCase() === before.canonical_url.toLowerCase() && alias.provider_id === before.provider_id));
    });
  }
  const same = (left: string[], right: string[]) => stableJson([...left].sort()) === stableJson([...right].sort());
  function restore(target: object, source: object, keys: string[]): void {
    const destination = target as Record<string, unknown>, previous = source as Record<string, unknown>;
    for (const key of keys) {
      if (previous[key] === undefined) delete destination[key];
      else destination[key] = structuredClone(previous[key]);
    }
  }
  function restoreObjects(name: 'resources' | 'projects'): void {
    const beforeRecords = new Map(historical[name].map(item => [item.id, item]));
    const nowRecords = new Map(current[name].map(item => [item.id, item]));
    for (const row of registry[name]) {
      const id = `${name === 'resources' ? 'resource' : 'project'}:${row.key}`;
      const old = historicalRegistry[name].find(item => item.key === row.key), before = beforeRecords.get(id), now = nowRecords.get(id);
      const sources = before?.source_refs.map(ref => ref.source_id) ?? [];
      let allowed = old && before && now && safeSources(sources) && same(sources, now.source_refs.map(ref => ref.source_id));
      if (allowed && name === 'projects') {
        const a = historical.projects.find(item => item.id === id)!, b = current.projects.find(item => item.id === id)!;
        allowed = same(a.resource_ids, b.resource_ids);
      }
      if (allowed) {
        restore(row, old!, name === 'resources' ? ['title', 'description', 'type', 'domains', 'inputs', 'outputs'] : ['title', 'description', 'domains']);
        report.restored[name]++;
      } else report.skipped[name]++;
    }
  }
  restoreObjects('resources'); restoreObjects('projects');
  function sourceDependencies(data: CatalogData, start: string, visited = new Set<string>()): string[] {
    if (visited.has(start)) return []; visited.add(start);
    if (start.startsWith('source:')) return [start];
    const resource = data.resources.find(item => item.id === start), project = data.projects.find(item => item.id === start);
    if (resource || project) return (resource ?? project)!.source_refs.map(ref => ref.source_id);
    const collection = data.collections.find(item => item.id === start);
    if (collection) return collection.item_ids.flatMap(id => sourceDependencies(data, id, visited));
    return data.sources.filter(source => source.owner_id === start).map(source => source.id);
  }
  for (const row of registry.collections) {
    const id = `collection:${row.key}`, old = historicalRegistry.collections.find(item => item.key === row.key);
    const before = historical.collections.find(item => item.id === id), now = current.collections.find(item => item.id === id);
    if (old && before && now && same(before.item_ids, now.item_ids) && safeSources(sourceDependencies(historical, id))) {
      restore(row, old, ['title', 'description', 'selection_basis']); report.restored.collections++;
    } else report.skipped.collections++;
  }
  // This is a new current-policy candidate. Old authority and removed registry members never enter it.
  assertValidCatalog(normalize(registry, batch).catalog);
  return { registry, batch, report };
}

export async function rebuildRecoveryCandidate(historicalRegistry: Registry, historicalBatch: SnapshotBatch, currentRegistry: Registry, currentBatch: SnapshotBatch, destination = 'generated', options: { historyDirectory?: string; shardSize?: number } = {}): Promise<{ manifest: CatalogManifest; report: RecoveryReport }> {
  const input = prepareRecoveryInputs(historicalRegistry, historicalBatch, currentRegistry, currentBatch);
  const manifest = await generate(input.registry, input.batch, destination, options.shardSize ?? 200, { historyDirectory: options.historyDirectory });
  return { manifest, report: input.report };
}
