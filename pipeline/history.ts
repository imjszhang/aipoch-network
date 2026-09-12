import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { assertValidCatalog, isSafeRelativePath, validateManifest, validateShard } from '../spec/index.js';
import { COLLECTION_NAMES, emptyCatalog, type CatalogData, type CatalogManifest, type CatalogRecord, type CatalogShard } from '../spec/types.js';
import { sha256, stableJson } from './json.js';

const SNAPSHOT = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SHARD_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
const MAX_HISTORY_ENTRIES = 4096;
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export interface HistoryEntry {
  snapshot_id: string;
  status: 'available' | 'withdrawn' | 'invalid';
  checked_at: string;
  generated_at?: string;
  reason?: 'current_withdrawal' | 'source_not_currently_publishable' | 'authority_changed' | 'invalid_snapshot';
}
export interface SnapshotHistory { version: 1; current_snapshot_id: string; checked_at: string; snapshots: HistoryEntry[] }
interface VerifiedSnapshot { manifest: CatalogManifest; catalog: CatalogData; files: Map<string, Buffer>; bytes: number }

async function boundedFile(directory: string, relative: string, limit: number): Promise<Buffer> {
  if (!isSafeRelativePath(relative)) throw new Error('Unsafe historical snapshot path');
  const root = await realpath(directory), path = resolve(root, decodeURIComponent(relative));
  const actual = await realpath(path);
  if (!actual.startsWith(root + sep)) throw new Error('Historical reference leaves its snapshot directory');
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Historical snapshot file is invalid or exceeds limits');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error('Historical snapshot file exceeds byte limit');
  return bytes;
}

/** Only manifested files that pass byte, hash, count, snapshot and full graph checks can be retained. */
export async function readHistoricalSnapshot(directory: string, expectedId: string): Promise<VerifiedSnapshot> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || !SNAPSHOT.test(expectedId)) throw new Error('Invalid historical snapshot directory');
  const manifestBytes = await boundedFile(directory, 'manifest.json', MAX_MANIFEST_BYTES);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as CatalogManifest;
  const manifestCheck = validateManifest(manifest);
  if (!manifestCheck.ok || manifest.snapshot_id !== expectedId) throw new Error('Invalid historical snapshot manifest');
  const catalog = emptyCatalog(), files = new Map<string, Buffer>([['manifest.json', manifestBytes]]);
  let total = manifestBytes.length, count = 0;
  for (const name of COLLECTION_NAMES) for (const part of manifest.collections[name]) {
    if (++count > 4096 || part.bytes > MAX_SHARD_BYTES || total + part.bytes > MAX_HISTORY_BYTES) throw new Error('Historical snapshot exceeds retention limits');
    const bytes = await boundedFile(directory, part.href, Math.min(part.bytes, MAX_SHARD_BYTES));
    if (bytes.length !== part.bytes || sha256(bytes) !== part.sha256) throw new Error('Historical shard bytes or hash differ');
    const shard = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as CatalogShard;
    const check = validateShard(shard);
    if (!check.ok || shard.contract_version !== manifest.contract_version || shard.snapshot_id !== manifest.snapshot_id || shard.collection !== name || (part.count !== undefined && part.count !== shard.records.length)) throw new Error('Historical shard is incomplete or belongs to another snapshot');
    (catalog[name] as CatalogRecord[]).push(...shard.records);
    files.set(part.href, bytes); total += bytes.length;
  }
  assertValidCatalog(catalog);
  return { manifest, catalog, files, bytes: total };
}

async function previousHistory(directory: string): Promise<HistoryEntry[]> {
  let bytes: Buffer;
  try { bytes = await boundedFile(join(directory, 'catalog/v1'), 'history.json', MAX_MANIFEST_BYTES); }
  catch (error) { if (absent(error)) return []; throw error; }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as SnapshotHistory;
  if (value.version !== 1 || !Array.isArray(value.snapshots) || value.snapshots.length > MAX_HISTORY_ENTRIES) throw new Error('Historical retirement ledger is invalid');
  const seen = new Set<string>();
  for (const row of value.snapshots) {
    if (!row || !SNAPSHOT.test(row.snapshot_id) || seen.has(row.snapshot_id) || !['available', 'withdrawn', 'invalid'].includes(row.status) || !Number.isFinite(Date.parse(row.checked_at))) throw new Error('Historical retirement ledger entry is invalid');
    if (row.generated_at !== undefined && !Number.isFinite(Date.parse(row.generated_at))) throw new Error('Historical snapshot time is invalid');
    if (row.reason !== undefined && !['current_withdrawal', 'source_not_currently_publishable', 'authority_changed', 'invalid_snapshot'].includes(row.reason)) throw new Error('Historical retirement reason is invalid');
    seen.add(row.snapshot_id);
  }
  // Keep a strict public whitelist; do not forward extra local/audit fields from an input ledger.
  return value.snapshots.map(row => ({ snapshot_id: row.snapshot_id, status: row.status, checked_at: row.checked_at, ...(row.generated_at ? { generated_at: row.generated_at } : {}), ...(row.reason ? { reason: row.reason } : {}) }));
}

function unsafeReason(previous: CatalogData, current: CatalogData, at: string): HistoryEntry['reason'] | undefined {
  const withdrawn = new Set(current.tombstones.map(item => item.id));
  const active = new Set(COLLECTION_NAMES.filter(name => name !== 'tombstones').flatMap(name => current[name].map(item => item.id)));
  for (const name of COLLECTION_NAMES) if (name !== 'tombstones') for (const item of previous[name]) {
    if (withdrawn.has(item.id)) return 'current_withdrawal';
    // Removal from the reviewed catalog is not a license to keep a hidden old copy online.
    if (!active.has(item.id)) return 'source_not_currently_publishable';
  }
  const sources = new Map(current.sources.map(source => [source.id, source]));
  for (const source of previous.sources) {
    const now = sources.get(source.id);
    // Old public copies of complete README text do not meet the current publication policy.
    if (source.readme !== undefined && now?.readme === undefined) return 'source_not_currently_publishable';
    if (!now || ['private', 'deleted'].includes(now.availability) || Date.parse(at) - Date.parse(now.observed_at) > 7 * 24 * 60 * 60 * 1000) return 'source_not_currently_publishable';
    if (source.provider_id !== now.provider_id || source.owner_id !== now.owner_id) return 'source_not_currently_publishable';
    if (source.canonical_url.toLowerCase() !== now.canonical_url.toLowerCase() && !now.aliases.some(alias => alias.url.toLowerCase() === source.canonical_url.toLowerCase() && alias.provider_id === source.provider_id)) return 'source_not_currently_publishable';
  }
  const currentClaims = new Map(current.claims.map(claim => [claim.id, claim]));
  for (const claim of previous.claims) if (claim.status === 'verified') {
    const now = currentClaims.get(claim.id);
    if (!now || now.status !== 'verified' || now.actor_id !== claim.actor_id || now.subject_id !== claim.subject_id || now.authority !== claim.authority || now.scope !== claim.scope || (claim.expires_at && Date.parse(claim.expires_at) <= Date.parse(at))) return 'authority_changed';
  }
  return undefined;
}

/** Retire whole affected snapshots rather than silently editing immutable files and invalidating their hashes. */
export async function retainHistory(inputDirectory: string, stagingDirectory: string, current: CatalogData, currentManifest: CatalogManifest): Promise<SnapshotHistory> {
  const old = await previousHistory(inputDirectory), entries = new Map(old.map(row => [row.snapshot_id, row]));
  const currentId = currentManifest.snapshot_id, at = currentManifest.generated_at;
  if (entries.has(currentId) && entries.get(currentId)!.status !== 'available') throw new Error('A retired snapshot ID cannot be reused; create a new candidate with a current observation time');
  let directories: string[];
  try { directories = await readdir(join(inputDirectory, 'catalog/v1/snapshots')); }
  catch (error) { if (!absent(error)) throw error; directories = []; }
  let retainedBytes = 0;
  for (const name of directories.sort()) {
    if (!SNAPSHOT.test(name) || name === currentId) continue;
    const prior = entries.get(name);
    if (prior && prior.status !== 'available') continue;
    let snapshot: VerifiedSnapshot;
    try { snapshot = await readHistoricalSnapshot(join(inputDirectory, 'catalog/v1/snapshots', name), name); }
    catch { entries.set(name, { snapshot_id: name, status: 'invalid', checked_at: at, reason: 'invalid_snapshot' }); continue; }
    const reason = unsafeReason(snapshot.catalog, current, at);
    if (reason) {
      entries.set(name, { snapshot_id: name, status: 'withdrawn', generated_at: snapshot.manifest.generated_at, checked_at: at, reason });
      continue;
    }
    retainedBytes += snapshot.bytes;
    if (retainedBytes > MAX_HISTORY_BYTES) throw new Error('Validated snapshot history exceeds 64 MiB; review retention explicitly before rebuilding');
    for (const [relative, bytes] of snapshot.files) {
      const output = join(stagingDirectory, 'catalog/v1/snapshots', name, decodeURIComponent(relative));
      await mkdir(dirname(output), { recursive: true }); await writeFile(output, bytes);
    }
    entries.set(name, { snapshot_id: name, status: 'available', generated_at: snapshot.manifest.generated_at, checked_at: at });
  }
  // An available ledger row without its validated directory cannot advertise a downloadable snapshot.
  const present = new Set(directories);
  for (const [id, row] of entries) if (row.status === 'available' && id !== currentId && !present.has(id)) entries.set(id, { snapshot_id: id, status: 'invalid', checked_at: at, reason: 'invalid_snapshot' });
  entries.set(currentId, { snapshot_id: currentId, status: 'available', generated_at: at, checked_at: at });
  if (entries.size > MAX_HISTORY_ENTRIES) throw new Error('Snapshot retirement ledger exceeds supported retention capacity');
  const history: SnapshotHistory = { version: 1, current_snapshot_id: currentId, checked_at: at, snapshots: [...entries.values()].sort((a, b) => a.snapshot_id.localeCompare(b.snapshot_id, 'en')) };
  const historyText = stableJson(history);
  if (Buffer.byteLength(historyText) > MAX_MANIFEST_BYTES) throw new Error('Snapshot retirement ledger exceeds its byte budget');
  await writeFile(join(stagingDirectory, 'catalog/v1/history.json'), historyText);
  return history;
}
