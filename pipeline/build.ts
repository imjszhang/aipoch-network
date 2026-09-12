import { mkdir, mkdtemp, writeFile, rename, rm, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { COLLECTION_NAMES, CONTRACT_VERSION, type CatalogManifest, type CatalogShard } from '../spec/types.js';
import { assertValidCatalog, validateManifest, validateShard } from '../spec/index.js';
import { makeSearchIndex, searchDocuments } from '../web/src/search.js';
import { normalize, type SnapshotBatch } from './normalize.js';
import type { Registry } from './registry.js';
import { stableJson, sha256 } from './json.js';
import { retainHistory } from './history.js';
export { stableJson, sha256 } from './json.js';
export const MAX_SHARD_BYTES = 4_000_000;

export async function generate(registry: Registry, batch: SnapshotBatch, destination = 'generated', shardSize = 200, options: { historyDirectory?: string; candidateKind?: 'refresh' | 'withdrawal_only' | 'offline' } = {}): Promise<CatalogManifest> {
  if (!Number.isSafeInteger(shardSize) || shardSize < 1 || shardSize > 1000) throw new Error('Invalid shard size');
  const result = normalize(registry, batch);
  // The public catalog publishes repository summaries and evidence links, not full README copies.
  result.catalog.sources = result.catalog.sources.map(({ readme, ...source }) => source);
  assertValidCatalog(result.catalog);
  const snapshot_id = sha256(stableJson({ catalog: result.catalog, generated_at: result.generated_at, contract_version: CONTRACT_VERSION, shard_size: shardSize, max_shard_bytes: MAX_SHARD_BYTES })).slice(0, 24);
  const manifest: CatalogManifest = { contract_version: CONTRACT_VERSION, snapshot_id, generated_at: result.generated_at,
    collections: { sources: [], actors: [], organizations: [], projects: [], resources: [], collections: [], relations: [], claims: [], tombstones: [] } };
  await mkdir(dirname(destination), { recursive: true });
  const lock = `${destination}.build-lock`;
  try { await mkdir(lock); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another or interrupted catalog build owns the output lock; inspect it before retrying'); throw error; }
  let staging: string | undefined;
  try {
    await writeFile(join(lock, 'owner.json'), stableJson({ pid: process.pid, started_at: new Date().toISOString() }));
    staging = await mkdtemp(`${destination}.staging-`);
    await mkdir(join(staging, 'catalog/v1/snapshots', snapshot_id), { recursive: true });
    const history = await retainHistory(options.historyDirectory ?? destination, staging, result.catalog, manifest);
    for (const name of COLLECTION_NAMES) {
      const records = result.catalog[name];
      const groups: typeof records[] = [];
      let group: typeof records = [], groupBytes = 0;
      const overhead = Buffer.byteLength(stableJson({ contract_version: CONTRACT_VERSION, snapshot_id, collection: name, records: [] }));
      for (const record of records) {
        const size = Buffer.byteLength(stableJson(record)) - 1;
        if (size + overhead > MAX_SHARD_BYTES) throw new Error('A public record exceeds the shard byte budget');
        if (group.length && (group.length >= shardSize || groupBytes + group.length + size + overhead > MAX_SHARD_BYTES)) {
          groups.push(group); group = []; groupBytes = 0;
        }
        (group as typeof record[]).push(record); groupBytes += size;
      }
      if (group.length || !groups.length) groups.push(group);
      for (const [partIndex, records] of groups.entries()) {
        const shard: CatalogShard = { contract_version: CONTRACT_VERSION, snapshot_id, collection: name, records };
        const validation = validateShard(shard);
        if (!validation.ok) throw new Error(validation.errors.join('\n'));
        const content = stableJson(shard);
        if (Buffer.byteLength(content) > MAX_SHARD_BYTES) throw new Error('Public shard exceeds the byte budget');
        const href = `snapshots/${snapshot_id}/${name}-${partIndex}.json`;
        await writeFile(join(staging, 'catalog/v1', href), content);
        manifest.collections[name].push({ href, bytes: Buffer.byteLength(content), sha256: sha256(content), count: shard.records.length });
      }
    }
    const check = validateManifest(manifest);
    if (!check.ok) throw new Error(check.errors.join('\n'));
    await writeFile(join(staging, 'catalog/v1/manifest.json'), stableJson(manifest));
    await writeFile(join(staging, 'catalog/v1/snapshots', snapshot_id, 'manifest.json'), stableJson({ ...manifest,
      collections: Object.fromEntries(COLLECTION_NAMES.map(name => [name, manifest.collections[name].map(part => ({ ...part, href: part.href.split('/').at(-1)! }))])) }));
    const documents = searchDocuments(result.catalog);
    const webCatalog = { ...result.catalog, sources: result.catalog.sources.map(({ readme, ...source }) => source) };
    await mkdir(join(staging, 'internal'), { recursive: true });
    await writeFile(join(staging, 'internal/catalog.json'), stableJson({ snapshot_id, generated_at: result.generated_at, catalog: webCatalog }));
    await writeFile(join(staging, 'internal/search.json'), stableJson({ snapshot_id, index: makeSearchIndex(documents).toJSON() }));
    await writeFile(join(staging, 'build-report.json'), stableJson({ snapshot_id, generated_at: result.generated_at, candidate_kind: options.candidateKind ?? 'offline', diagnostics: result.diagnostics.map(item => ({
      id: /^https?:/i.test(item.id) ? `candidate:${sha256(item.id).slice(0, 24)}` : item.id,
      message: item.message,
    })),
      counts: Object.fromEntries(COLLECTION_NAMES.map(name => [name, result.catalog[name].length])), inputs_sha256: sha256(stableJson({ registry, batch })),
      history_sha256: sha256(stableJson(history)), history: { available: history.snapshots.filter(item => item.status === 'available').length, retired: history.snapshots.filter(item => item.status !== 'available').length } }));
    // Swap only after every shard validates; an interrupted build cannot replace the last good output.
    const previous = `${destination}.previous-${randomUUID()}`;
    let hadPrevious = false;
    try { await rename(destination, previous); hadPrevious = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try { await rename(staging, destination); }
    catch (error) {
      if (hadPrevious) {
        try { await rename(previous, destination); }
        catch (restoreError) { throw new AggregateError([error, restoreError], `Catalog switch and automatic restore failed; prior output remains at ${previous}`); }
      }
      throw error;
    }
    staging = undefined;
    if (hadPrevious) await rm(previous, { recursive: true, force: true }).catch(() => console.warn(`Catalog built; review cleanup of the local previous-output directory: ${previous}`));
    return manifest;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
export async function readJson<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }
