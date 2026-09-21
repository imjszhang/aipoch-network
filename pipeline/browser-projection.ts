import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { CatalogData, CatalogEntity, SourceRef } from '../spec/types.js';
import { UI_SCHEMA_VERSION, stableUiJson, type BrowseData, type UiManifest, type UiManifestReference, type UiSearchData } from '../shared/browser-projection.js';
import { makeSearchIndex, searchDocuments } from '../web/src/search.js';
import { readHistoricalSnapshot, type SnapshotHistory } from './history.js';
import { sha256, stableJson } from './json.js';

export const MAX_UI_HISTORY_BYTES = 32 * 1024 * 1024;
export const MAX_UI_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_UI_MANIFEST_BYTES = 16 * 1024;
const SNAPSHOT = /^[a-f0-9]{24}$/;
const HASH = /^[a-f0-9]{64}$/;
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const common = (row: CatalogEntity) => ({ id: row.id, title: row.title, ...(row.description === undefined ? {} : { description: row.description }), status: row.status, updated_at: row.updated_at, provenance: {}, ...(row.catalog_dates ? { catalog_dates: row.catalog_dates } : {}) });
const sourceRefs = (refs: SourceRef[]) => refs.map(({ source_id, role, commit }) => ({ source_id, role, ...(commit ? { commit } : {}) }));

/** Whitelist presentation facts; no evidence bodies, runtime instructions or executable material. */
export function browseProjection(catalog: CatalogData, snapshot_id: string, generated_at: string): BrowseData {
  return { schema_version: UI_SCHEMA_VERSION, data_kind: 'browse', snapshot_id, generated_at, catalog: {
    projects: catalog.projects.map(row => ({ ...common(row), kind: row.kind, domains: row.domains, classification: row.classification, research_tags: row.research_tags, source_refs: sourceRefs(row.source_refs), resource_ids: row.resource_ids })),
    resources: catalog.resources.map(row => ({ ...common(row), kind: row.kind, domains: row.domains, classification: row.classification, research_tags: row.research_tags, source_refs: sourceRefs(row.source_refs), project_ids: row.project_ids, resource_type: row.resource_type, license: { status: row.license.status, spdx_id: row.license.spdx_id, name: row.license.name }, runtime: { status: row.runtime.status } })),
    sources: catalog.sources.map(row => ({ ...common(row), kind: row.kind, provider: row.provider, provider_id: row.provider_id, canonical_url: row.canonical_url, owner_id: row.owner_id, availability: row.availability, archived: row.archived, observed_at: row.observed_at, stale: row.stale, license: { status: row.license.status, spdx_id: row.license.spdx_id, name: row.license.name }, aliases: [], github_metrics: row.github_metrics, source_activity: row.source_activity, observation: row.observation })),
    actors: catalog.actors.map(row => ({ ...common(row), kind: row.kind, provider: row.provider, provider_id: row.provider_id, account_type: row.account_type, login: row.login, canonical_url: row.canonical_url, aliases: [], github_metrics: row.github_metrics ? { followers: row.github_metrics.followers } : undefined, observation: row.observation })),
    organizations: catalog.organizations.map(row => ({ ...common(row), kind: row.kind, actor_id: row.actor_id, source_ids: row.source_ids, resource_ids: row.resource_ids, participation: row.participation })),
    collections: catalog.collections.map(row => ({ ...common(row), kind: row.kind, actor_ids: row.actor_ids, item_ids: row.item_ids, selection_basis: row.selection_basis })),
    claims: [], relations: [], tombstones: catalog.tombstones,
  } };
}
export function uiManifestHash(manifest: Omit<UiManifest, 'projection_hash'>): string { return sha256(stableUiJson(manifest)); }
export function uiDirectory(snapshot: string, hash: string): string {
  assert(SNAPSHOT.test(snapshot) && HASH.test(hash), 'Invalid browser projection identity');
  return `internal/ui/v1/${snapshot}/${hash}`;
}
export function createUiArtifact(catalog: CatalogData, snapshot_id: string, generated_at: string) {
  const browse = stableJson(browseProjection(catalog, snapshot_id, generated_at));
  const search = stableJson({ schema_version: UI_SCHEMA_VERSION, snapshot_id, index: makeSearchIndex(searchDocuments(catalog)).toJSON() } satisfies UiSearchData);
  const files = { browse: { href: 'browse.json', bytes: Buffer.byteLength(browse), sha256: sha256(browse) }, search: { href: 'search.json', bytes: Buffer.byteLength(search), sha256: sha256(search) } };
  for (const descriptor of Object.values(files)) assert(descriptor.bytes <= MAX_UI_FILE_BYTES, 'Browser projection file exceeds 8 MiB');
  const identity = { schema_version: UI_SCHEMA_VERSION, snapshot_id, generated_at, files };
  const manifest: UiManifest = { ...identity, projection_hash: uiManifestHash(identity) };
  const manifestBytes = stableJson(manifest), directory = uiDirectory(snapshot_id, manifest.projection_hash);
  const reference: UiManifestReference = { schema_version: UI_SCHEMA_VERSION, snapshot_id, projection_hash: manifest.projection_hash, href: `${directory}/manifest.json`, bytes: Buffer.byteLength(manifestBytes), sha256: sha256(manifestBytes) };
  return { manifest, reference, files: new Map([['manifest.json', Buffer.from(manifestBytes)], ['browse.json', Buffer.from(browse)], ['search.json', Buffer.from(search)]]), browse_gzip_bytes: gzipSync(browse).length };
}
async function boundedFile(directory: string, name: string, maximum: number): Promise<Buffer> {
  assert(['manifest.json','browse.json','search.json'].includes(name), 'Unexpected browser projection file');
  const root = await realpath(directory), file = join(directory, name), info = await lstat(file), actual = await realpath(file);
  assert(actual.startsWith(root + sep) && info.isFile() && !info.isSymbolicLink() && info.size <= maximum, 'Invalid or oversized browser projection file');
  const bytes = await readFile(file);
  assert(bytes.length <= maximum, 'Browser projection file grew beyond limit'); return bytes;
}
/** Validate hashes AND deterministic semantics against a verified public snapshot, not a cache's self-asserted hash. */
export async function readUiArtifact(directory: string, catalog: CatalogData, snapshot: string, hash: string, generatedAt: string) {
  const info = await lstat(directory);
  assert(info.isDirectory() && !info.isSymbolicLink(), 'Invalid browser projection directory');
  const manifestBytes = await boundedFile(directory, 'manifest.json', MAX_UI_MANIFEST_BYTES);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as UiManifest;
  const { projection_hash, ...identity } = manifest;
  assert(manifest.schema_version === UI_SCHEMA_VERSION && manifest.snapshot_id === snapshot && manifest.generated_at === generatedAt && projection_hash === hash && uiManifestHash(identity) === hash, 'Browser projection manifest identity differs');
  assert.deepEqual(Object.keys(manifest).sort(), ['schema_version','snapshot_id','generated_at','projection_hash','files'].sort(), 'Unknown browser projection manifest fields');
  assert.deepEqual(Object.keys(manifest.files).sort(), ['browse','search'], 'Browser projection file list differs');
  const files = new Map<string, Buffer>([['manifest.json', manifestBytes]]);
  const expected = createUiArtifact(catalog, snapshot, generatedAt);
  for (const key of ['browse','search'] as const) {
    const descriptor = manifest.files[key];
    assert(descriptor.href === `${key}.json` && Number.isSafeInteger(descriptor.bytes) && descriptor.bytes > 0 && descriptor.bytes <= MAX_UI_FILE_BYTES && HASH.test(descriptor.sha256), 'Invalid browser projection descriptor');
    assert.deepEqual(Object.keys(descriptor).sort(), ['bytes','href','sha256'], 'Unknown browser projection descriptor fields');
    const bytes = await boundedFile(directory, descriptor.href, descriptor.bytes);
    assert(bytes.length === descriptor.bytes && sha256(bytes) === descriptor.sha256, 'Browser projection bytes or hash differ');
    // JSON whitespace/key order may differ between implementations. Their addresses differ, their display semantics must not.
    assert.deepEqual(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), JSON.parse(expected.files.get(`${key}.json`)!.toString()), 'Browser projection differs from its public snapshot');
    files.set(descriptor.href, bytes);
  }
  assert.deepEqual((await readdir(directory)).sort(), ['browse.json','manifest.json','search.json'], 'Unmanifested browser projection files');
  return { manifest, files, bytes: [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0) };
}
/** All prior UI files are gated by the existing retirement ledger; retired snapshots have no copies. */
export async function retainUiHistory(input: string, staging: string, history: SnapshotHistory) {
  const root = join(input, 'internal/ui/v1');
  let snapshots: string[];
  try { snapshots = await readdir(root); } catch (error) { if (absent(error)) return { files: [] as string[], bytes: 0 }; throw error; }
  const rootInfo = await lstat(root);
  assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'Invalid browser history root');
  assert.deepEqual((await readdir(join(input, 'internal/ui'))).sort(), ['v1'], 'Unsupported browser history schema');
  const available = new Set(history.snapshots.filter(row => row.status === 'available').map(row => row.snapshot_id));
  let bytes = 0; const files: string[] = [];
  for (const snapshot of snapshots.sort()) {
    assert(SNAPSHOT.test(snapshot), 'Unexpected browser history snapshot path');
    if (!available.has(snapshot)) continue;
    const snapshotDirectory = join(root, snapshot), info = await lstat(snapshotDirectory);
    assert(info.isDirectory() && !info.isSymbolicLink(), 'Invalid browser history snapshot directory');
    const publicSnapshot = await readHistoricalSnapshot(join(input, 'catalog/v1/snapshots', snapshot), snapshot);
    for (const hash of (await readdir(snapshotDirectory)).sort()) {
      assert(HASH.test(hash), 'Unexpected browser history projection path');
      const artifact = await readUiArtifact(join(snapshotDirectory, hash), publicSnapshot.catalog, snapshot, hash, publicSnapshot.manifest.generated_at);
      bytes += artifact.bytes;
      assert(bytes <= MAX_UI_HISTORY_BYTES, 'Browser projection history exceeds 32 MiB; review retention explicitly');
      for (const [name, content] of artifact.files) {
        const relative = `${uiDirectory(snapshot, hash)}/${name}`, output = join(staging, relative);
        await mkdir(dirname(output), { recursive: true }); await writeFile(output, content); files.push(relative);
      }
    }
  }
  return { files, bytes };
}
export async function writeUiArtifact(staging: string, artifact: ReturnType<typeof createUiArtifact>) {
  for (const [name, bytes] of artifact.files) {
    const path = join(staging, uiDirectory(artifact.manifest.snapshot_id, artifact.manifest.projection_hash), name);
    await mkdir(dirname(path), { recursive: true });
    try { const previous = await readFile(path); assert(previous.equals(bytes), 'An immutable browser projection address cannot be overwritten'); }
    catch (error) { if (!absent(error)) throw error; await writeFile(path, bytes); }
  }
  await writeFile(join(staging, 'internal/ui-manifest.json'), stableJson(artifact.reference));
}

/** A new candidate must reproduce the current implementation's exact bytes. */
export async function verifyUiPublication(directory: string, history: SnapshotHistory, catalog: CatalogData, snapshot: string, generatedAt: string) {
  return verifyUiInventory(directory, history, catalog, snapshot, generatedAt, true);
}

/** Trusted older candidates retain their own byte encoding and content address.
 * Their reference, bytes and display semantics are still checked against the public snapshot. */
export async function verifyUiHistoryPublication(directory: string, history: SnapshotHistory, catalog: CatalogData, snapshot: string, generatedAt: string) {
  return verifyUiInventory(directory, history, catalog, snapshot, generatedAt, false);
}

/** No unknown or retired UI file is included in either publication inventory. */
async function verifyUiInventory(directory: string, history: SnapshotHistory, catalog: CatalogData, snapshot: string, generatedAt: string, currentEncoding: boolean) {
  const expected = createUiArtifact(catalog, snapshot, generatedAt);
  const pointerPath = join(directory, 'internal/ui-manifest.json'), pointerInfo = await lstat(pointerPath);
  assert(pointerInfo.isFile() && !pointerInfo.isSymbolicLink() && pointerInfo.size <= MAX_UI_MANIFEST_BYTES, 'Invalid browser projection reference');
  const pointerBytes = await readFile(pointerPath);
  assert(pointerBytes.length <= MAX_UI_MANIFEST_BYTES, 'Browser projection reference grew beyond limit');
  const pointer = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pointerBytes)) as UiManifestReference;
  assert(pointer && typeof pointer === 'object' && !Array.isArray(pointer), 'Invalid browser projection reference');
  assert.deepEqual(Object.keys(pointer).sort(), ['schema_version','snapshot_id','projection_hash','href','bytes','sha256'].sort(), 'Unknown browser projection reference fields');
  assert(history.current_snapshot_id === snapshot && pointer.schema_version === UI_SCHEMA_VERSION && pointer.snapshot_id === snapshot && typeof pointer.projection_hash === 'string' && HASH.test(pointer.projection_hash), 'Browser projection reference identity differs');
  assert(pointer.href === `${uiDirectory(snapshot, pointer.projection_hash)}/manifest.json` && Number.isSafeInteger(pointer.bytes) && pointer.bytes > 0 && pointer.bytes <= MAX_UI_MANIFEST_BYTES && typeof pointer.sha256 === 'string' && HASH.test(pointer.sha256), 'Invalid browser projection reference descriptor');
  if (currentEncoding) assert.deepEqual(pointer, expected.reference, 'Current browser projection reference differs from deterministic build');
  const files = ['internal/ui-manifest.json']; let bytes = 0;
  let browseGzipBytes: number | undefined;
  const root = join(directory, 'internal/ui/v1'), available = new Set(history.snapshots.filter(row => row.status === 'available').map(row => row.snapshot_id));
  const rootInfo = await lstat(root);
  assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'Invalid browser projection root');
  assert.deepEqual((await readdir(join(directory, 'internal/ui'))).sort(), ['v1'], 'Unsupported browser projection schema');
  for (const id of (await readdir(root)).sort()) {
    assert(SNAPSHOT.test(id) && available.has(id), 'Unlisted or retired snapshots have downloadable browser projections');
    const source = id === snapshot ? { catalog, manifest: { generated_at: generatedAt } } : await readHistoricalSnapshot(join(directory, 'catalog/v1/snapshots', id), id);
    const snapshotRoot = join(root, id), snapshotInfo = await lstat(snapshotRoot);
    assert(snapshotInfo.isDirectory() && !snapshotInfo.isSymbolicLink(), 'Invalid browser projection snapshot directory');
    for (const hash of (await readdir(snapshotRoot)).sort()) {
      assert(HASH.test(hash), 'Invalid browser projection hash path');
      const artifact = await readUiArtifact(join(snapshotRoot, hash), source.catalog, id, hash, source.manifest.generated_at);
      bytes += artifact.bytes;
      assert(bytes <= MAX_UI_HISTORY_BYTES, 'Browser projection history exceeds 32 MiB');
      for (const file of artifact.files.keys()) files.push(`${uiDirectory(id, hash)}/${file}`);
      if (id === snapshot && hash === pointer.projection_hash) {
        const manifestBytes = artifact.files.get('manifest.json')!;
        assert(manifestBytes.length === pointer.bytes && sha256(manifestBytes) === pointer.sha256, 'Browser projection reference bytes or hash differ');
        browseGzipBytes = gzipSync(artifact.files.get('browse.json')!).length;
        if (currentEncoding) for (const [name, content] of expected.files) assert(content.equals(artifact.files.get(name)!), 'Current browser projection bytes differ from deterministic build');
      }
    }
  }
  assert(files.includes(pointer.href), 'Current browser projection files are missing');
  assert(browseGzipBytes !== undefined, 'Referenced browser projection was not verified');
  return { files, bytes, reference: pointer, browse_gzip_bytes: browseGzipBytes };
}
