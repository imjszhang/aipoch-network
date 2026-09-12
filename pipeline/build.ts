import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { COLLECTION_NAMES, CONTRACT_VERSION, type CatalogManifest, type CatalogShard } from '../spec/types.js';
import { assertValidCatalog, validateManifest, validateShard } from '../spec/index.js';
import { makeSearchIndex, searchDocuments } from '../web/src/search.js';
import { normalize, type SnapshotBatch } from './normalize.js';
import type { Registry } from './registry.js';

export function stableJson(value: unknown): string {
  const canonicalize = (item: unknown): unknown => Array.isArray(item) ? item.map(canonicalize) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, canonicalize(value)])) : item;
  return JSON.stringify(canonicalize(value)) + '\n';
}
export const sha256 = (content: string | Uint8Array): string => createHash('sha256').update(content).digest('hex');
export async function generate(registry: Registry, batch: SnapshotBatch, destination = 'generated', shardSize = 200): Promise<CatalogManifest> {
  if (!Number.isSafeInteger(shardSize) || shardSize < 1 || shardSize > 1000) throw new Error('Invalid shard size');
  const result = normalize(registry, batch);
  assertValidCatalog(result.catalog);
  const snapshot_id = sha256(stableJson({ catalog: result.catalog, generated_at: result.generated_at })).slice(0, 24);
  const manifest: CatalogManifest = { contract_version: CONTRACT_VERSION, snapshot_id, generated_at: result.generated_at,
    collections: { sources: [], actors: [], organizations: [], projects: [], resources: [], collections: [], relations: [], claims: [], tombstones: [] } };
  const staging = `${destination}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(join(staging, 'catalog/v1/snapshots', snapshot_id), { recursive: true });
  try {
    for (const name of COLLECTION_NAMES) {
      const records = result.catalog[name];
      for (let start = 0; start < Math.max(1, records.length); start += shardSize) {
        const shard: CatalogShard = { contract_version: CONTRACT_VERSION, snapshot_id, collection: name, records: records.slice(start, start + shardSize) };
        const validation = validateShard(shard);
        if (!validation.ok) throw new Error(validation.errors.join('\n'));
        const content = stableJson(shard);
        const href = `snapshots/${snapshot_id}/${name}-${start / shardSize}.json`;
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
    await writeFile(join(staging, 'build-report.json'), stableJson({ snapshot_id, generated_at: result.generated_at, diagnostics: result.diagnostics,
      counts: Object.fromEntries(COLLECTION_NAMES.map(name => [name, result.catalog[name].length])), inputs_sha256: sha256(stableJson({ registry, batch })) }));
    // Swap only after every shard validates; an interrupted build cannot replace the last good output.
    const previous = `${destination}.previous`;
    await rm(previous, { recursive: true, force: true });
    try { await rename(destination, previous); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try { await rename(staging, destination); }
    catch (error) { await rename(previous, destination).catch(() => {}); throw error; }
    await rm(previous, { recursive: true, force: true });
    return manifest;
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
export async function readJson<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }
