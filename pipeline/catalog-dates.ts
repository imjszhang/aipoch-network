import assert from 'node:assert/strict';
import { lstat, readFile, writeFile, rename } from 'node:fs/promises';
import Ajv from 'ajv';
import type { CatalogData, CatalogDate, CatalogDates, CatalogEntity, SourceRef } from '../spec/types.js';
import type { Registry } from './registry.js';
import { normalizeGitHubUrl } from '../spec/identity.js';
import { sha256, stableJson } from './json.js';

export const FINGERPRINT_VERSION = 1 as const;
export const MAX_PUBLICATION_LEDGER_BYTES = 8_000_000;
export const MAX_PUBLICATION_RELEASES = 128;
const entityCollections = ['sources', 'actors', 'organizations', 'projects', 'resources', 'collections'] as const;
type PublicEntity = CatalogData[typeof entityCollections[number]][number];
export interface PublicationIndexEntry { id: string; kind: PublicEntity['kind']; fingerprint: string }
export interface PublicationIndex { version: 1; fingerprint_version: 1; entries: PublicationIndexEntry[] }
export interface PublicationReceipt extends PublicationIndex {
  repository: string;
  deployment_run_id: number;
  deployment_run_attempt: number;
  refresh_run_id: number;
  source_sha: string;
  snapshot_id: string;
  artifact_sha256: string;
  file_tree_sha256: string;
  deployed_at: string;
  evidence: string;
}
export interface PublicationHistoryEntry extends PublicationIndexEntry {
  first_published: CatalogDate;
  content_updated: CatalogDate;
  last_published_at: string;
  evidence: string;
  listed: boolean;
  relisted_at?: string;
}
export interface PublicationLedger {
  version: 1;
  fingerprint_version: 1;
  repository: string;
  /** Partial historic coverage never proves an exact first appearance. */
  coverage: 'complete' | 'partial';
  checkpoint?: { through: string; entries: PublicationHistoryEntry[] };
  releases: PublicationReceipt[];
}

const timestamp = { type: 'string', format: 'publication-utc-time' };
const positiveInteger = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const indexProperties = { id: { type: 'string', pattern: '^(?:source:github:[1-9][0-9]*|actor:github:[1-9][0-9]*|(?:project|resource|collection):[a-z0-9][a-z0-9._-]{0,127})$' }, kind: { enum: ['source_repository', 'actor', 'organization', 'project', 'resource', 'collection'] }, fingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' } };
const evidence = { type: 'string', pattern: '^https://github\\.com/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+/actions/runs/[1-9][0-9]*(?:/attempts/[1-9][0-9]*)?$' };
const dateSchema = { ...object({ value: timestamp, basis: { enum: ['exact', 'observed_bound', 'unknown'] }, evidence }, ['basis']), allOf: [{ if: { properties: { basis: { const: 'unknown' } } }, then: { not: { required: ['value'] } }, else: { required: ['value', 'evidence'] } }] };
const indexSchema = object({ version: { const: 1 }, fingerprint_version: { const: 1 }, entries: { type: 'array', maxItems: 50_000, items: object(indexProperties) } });
export const publicationReceiptSchema = object({ ...indexSchema.properties, repository: { type: 'string', pattern: '^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$' }, deployment_run_id: positiveInteger, deployment_run_attempt: positiveInteger, refresh_run_id: positiveInteger, source_sha: { type: 'string', pattern: '^[a-f0-9]{40}$' }, snapshot_id: { type: 'string', pattern: '^[a-f0-9]{24}$' }, artifact_sha256: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, file_tree_sha256: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, deployed_at: timestamp, evidence });
export const publicationLedgerSchema = object({
  version: { const: 1 }, fingerprint_version: { const: 1 }, repository: publicationReceiptSchema.properties.repository,
  coverage: { enum: ['complete', 'partial'] },
  checkpoint: object({ through: timestamp, entries: { type: 'array', maxItems: 50_000, items: object({ ...indexProperties, first_published: dateSchema, content_updated: dateSchema, last_published_at: timestamp, evidence, listed: { type: 'boolean' }, relisted_at: timestamp }, [...Object.keys(indexProperties), 'first_published', 'content_updated', 'last_published_at', 'evidence', 'listed']) } }),
  releases: { type: 'array', maxItems: MAX_PUBLICATION_RELEASES, items: publicationReceiptSchema },
}, ['version', 'fingerprint_version', 'repository', 'coverage', 'releases']);
function validTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
}
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addFormat('publication-utc-time', validTime);
const checkIndex = ajv.compile<PublicationIndex>(indexSchema);
const checkReceipt = ajv.compile<PublicationReceipt>(publicationReceiptSchema);
const checkLedger = ajv.compile<PublicationLedger>(publicationLedgerSchema);
const entryKey = (entry: Pick<PublicationIndexEntry, 'id' | 'kind'>) => `${entry.kind}/${entry.id}`;
const compareTimes = (a: string, b: string) => Date.parse(a) - Date.parse(b);
function uniqueEntries(entries: PublicationIndexEntry[]): void {
  assert(new Set(entries.map(entryKey)).size === entries.length, 'Duplicate publication identity/projection');
  for (const entry of entries) assert(entry.kind === 'source_repository' ? entry.id.startsWith('source:github:') : entry.kind === 'actor' || entry.kind === 'organization' ? entry.id.startsWith('actor:github:') : entry.id.startsWith(`${entry.kind}:`), 'Publication kind and identity disagree');
}
export function validatePublicationIndex(input: unknown): asserts input is PublicationIndex {
  assert(checkIndex(input), 'Invalid publication index schema'); uniqueEntries(input.entries);
}
export function validatePublicationReceipt(input: unknown, now = Date.now()): asserts input is PublicationReceipt {
  assert(checkReceipt(input), 'Invalid publication receipt schema'); uniqueEntries(input.entries);
  assert(Date.parse(input.deployed_at) <= now, 'Publication receipt is from the future');
  assert(input.evidence === `https://github.com/${input.repository}/actions/runs/${input.deployment_run_id}/attempts/${input.deployment_run_attempt}`, 'Publication receipt evidence does not identify its exact deployment attempt');
}
export function validatePublicationLedger(input: unknown, now = Date.now()): asserts input is PublicationLedger {
  assert(checkLedger(input), 'Invalid publication ledger schema');
  assert(Buffer.byteLength(stableJson(input)) <= MAX_PUBLICATION_LEDGER_BYTES, 'Publication ledger exceeds its byte budget; create a reviewed checkpoint');
  const releases = new Set<string>();
  for (const receipt of input.releases) {
    validatePublicationReceipt(receipt, now);
    assert(receipt.repository === input.repository, 'Publication receipt belongs to another repository');
    const key = `${receipt.deployment_run_id}/${receipt.deployment_run_attempt}`;
    assert(!releases.has(key), 'Duplicate deployment receipt'); releases.add(key);
    assert(!input.checkpoint || Date.parse(receipt.deployed_at) > Date.parse(input.checkpoint.through), 'Receipt overlaps compacted checkpoint');
  }
  if (input.checkpoint) {
    uniqueEntries(input.checkpoint.entries);
    assert(Date.parse(input.checkpoint.through) <= now, 'Publication checkpoint is from the future');
    for (const entry of input.checkpoint.entries) {
      assert(Date.parse(entry.last_published_at) <= Date.parse(input.checkpoint.through), 'Checkpoint membership postdates its coverage');
      for (const date of [entry.first_published, entry.content_updated]) if (date.value) assert(Date.parse(date.value) <= Date.parse(entry.last_published_at), 'Checkpoint date postdates its last publication');
      if (entry.relisted_at) assert(Date.parse(entry.relisted_at) <= Date.parse(entry.last_published_at), 'Checkpoint relisting postdates publication');
    }
  }
}

/** Unordered catalog sets are sorted; metric/check/build time and moving HEAD are absent. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => stableJson(a).localeCompare(stableJson(b), 'en'));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, value]) => [key, canonical(value)]));
  return value;
}
function fixedReferences(entry: PublicEntity, registry: Registry, catalog: CatalogData): unknown {
  if (!('source_refs' in entry)) return undefined;
  const records = entry.kind === 'project' ? registry.projects : registry.resources;
  const curated = records.find(record => `${entry.kind}:${record.key}` === entry.id);
  return entry.source_refs.map((ref: SourceRef) => {
    const source = catalog.sources.find(source => source.id === ref.source_id);
    const declared = curated?.source_refs?.find(item => (item.source_id ? item.source_id === ref.source_id : source && [source.canonical_url, ...source.aliases.map(alias => alias.url)].some(url => normalizeGitHubUrl(url).canonical_url === normalizeGitHubUrl(item.source_url).canonical_url)) && item.role === ref.role && item.path === ref.path && (!item.commit || item.commit === ref.commit));
    return { source_id: ref.source_id, role: ref.role, path: ref.path,
      ...(declared ? { commit: declared.commit, ref: declared.ref, sha256: declared.sha256 } : {}) };
  });
}
export function contentFingerprint(entry: PublicEntity, catalog: CatalogData, registry: Registry): string {
  const selected: Record<string, unknown> = { version: FINGERPRINT_VERSION, kind: entry.kind, id: entry.id, title: entry.title, description: entry.description, status: entry.status };
  const fields = ['question', 'domains', 'resource_type', 'documentation_url', 'download_url', 'inputs', 'outputs', 'conditions', 'runtime', 'resource_ids', 'project_ids', 'actor_ids', 'item_ids', 'selection_basis', 'source_ids', 'actor_id', 'participation', 'provider', 'provider_id', 'canonical_url', 'owner_id', 'account_type', 'login', 'default_branch', 'archived', 'topics', 'language', 'homepage', 'collaboration', 'fork_of'];
  for (const field of fields) if (field in entry) selected[field] = (entry as unknown as Record<string, unknown>)[field];
  if ('license' in entry) {
    // A license URL may itself contain an automatically observed commit. Its legal
    // meaning, path and curated conditions matter; automatic revision churn does not.
    const { status, spdx_id, name, path, conditions } = entry.license;
    // Preserve a meaningful license document/location change while normalizing
    // the automatic GitHub revision embedded in the repository observation.
    const url = entry.license.url?.replace(/(https:\/\/(?:www\.)?github\.com\/[^/]+\/[^/]+\/(?:blob|tree)\/)[a-f0-9]{40}(\/)/, '$1{observed-revision}$2').replace(/([?&]ref=)[a-f0-9]{40}(?=&|$)/, '$1{observed-revision}');
    selected.license = { status, spdx_id, name, path, conditions, url };
  }
  selected.source_refs = fixedReferences(entry, registry, catalog);
  selected.relations = catalog.relations.filter(item => item.from_id === entry.id || item.to_id === entry.id).map(item => ({ from_id: item.from_id, to_id: item.to_id, type: item.type, commit: item.commit }));
  return sha256(stableJson(canonical(selected)));
}
export function buildPublicationIndex(catalog: CatalogData, registry: Registry): PublicationIndex {
  const entries = entityCollections.flatMap(name => catalog[name] as PublicEntity[]).map(entry => ({ id: entry.id, kind: entry.kind, fingerprint: contentFingerprint(entry, catalog, registry) })).sort((a, b) => entryKey(a).localeCompare(entryKey(b), 'en'));
  const result: PublicationIndex = { version: 1, fingerprint_version: 1, entries };
  validatePublicationIndex(result); return result;
}
function history(ledger: PublicationLedger): Map<string, PublicationHistoryEntry> {
  const state = new Map((ledger.checkpoint?.entries ?? []).map(entry => [entryKey(entry), structuredClone(entry)]));
  const firstIdentity = new Map<string, CatalogDate>();
  for (const entry of state.values()) {
    const prior = firstIdentity.get(entry.id);
    if (!prior?.value || (entry.first_published.value && compareTimes(entry.first_published.value, prior.value) < 0)) firstIdentity.set(entry.id, entry.first_published);
  }
  for (const receipt of [...ledger.releases].sort((a, b) => compareTimes(a.deployed_at, b.deployed_at) || a.deployment_run_id - b.deployment_run_id || a.deployment_run_attempt - b.deployment_run_attempt)) {
    const present = new Set(receipt.entries.map(entryKey));
    for (const entry of state.values()) if (!present.has(entryKey(entry))) entry.listed = false;
    for (const entry of receipt.entries) {
      const key = entryKey(entry), previous = state.get(key);
      const date: CatalogDate = { basis: ledger.coverage === 'complete' ? 'exact' : 'observed_bound', value: receipt.deployed_at, evidence: receipt.evidence };
      const first = firstIdentity.get(entry.id) ?? date; firstIdentity.set(entry.id, first);
      const contentDate: CatalogDate = { ...date, basis: 'observed_bound' };
      state.set(key, { ...entry, first_published: first, content_updated: previous?.fingerprint === entry.fingerprint ? previous.content_updated : contentDate, last_published_at: receipt.deployed_at, evidence: receipt.evidence, listed: true, ...(previous?.relisted_at ? { relisted_at: previous.relisted_at } : {}), ...(previous && !previous.listed ? { relisted_at: receipt.deployed_at } : {}) });
    }
  }
  return state;
}
/** New or changed candidates remain pending. Only accepted publication membership advances dates. */
export function applyCatalogDates(catalog: CatalogData, registry: Registry, ledger?: PublicationLedger): CatalogData {
  const result = structuredClone(catalog);
  if (ledger) validatePublicationLedger(ledger);
  const published = ledger ? history(ledger) : new Map<string, PublicationHistoryEntry>();
  const unknown: CatalogDate = { basis: 'unknown' };
  const current = buildPublicationIndex(catalog, registry);
  const fingerprints = new Map(current.entries.map(entry => [entryKey(entry), entry.fingerprint]));
  for (const name of entityCollections) for (const entry of result[name] as PublicEntity[]) {
    const past = published.get(entryKey(entry));
    const dates: CatalogDates = {
      first_published: structuredClone(past?.first_published ?? unknown),
      content_updated: structuredClone(past && past.fingerprint === fingerprints.get(entryKey(entry)) ? past.content_updated : unknown),
    };
    (entry as CatalogEntity).catalog_dates = dates;
  }
  return result;
}
export function appendPublicationReceipt(ledger: PublicationLedger, receipt: PublicationReceipt): PublicationLedger {
  validatePublicationLedger(ledger); validatePublicationReceipt(receipt);
  assert(ledger.repository === receipt.repository, 'Receipt repository differs');
  const existing = ledger.releases.find(item => item.deployment_run_id === receipt.deployment_run_id && item.deployment_run_attempt === receipt.deployment_run_attempt);
  if (existing) { assert(stableJson(existing) === stableJson(receipt), 'Conflicting receipt for one deployment'); return structuredClone(ledger); }
  assert(!ledger.checkpoint || compareTimes(receipt.deployed_at, ledger.checkpoint.through) > 0, 'Reconcile older receipts by reviewing the checkpoint, not by replaying history');
  const result = { ...structuredClone(ledger), releases: [...ledger.releases, receipt].sort((a, b) => compareTimes(a.deployed_at, b.deployed_at) || a.deployment_run_id - b.deployment_run_id || a.deployment_run_attempt - b.deployment_run_attempt) };
  validatePublicationLedger(result); return result;
}
/** Explicit reviewed compaction preserves minimal dates and one fingerprint per identity. */
export function checkpointPublicationLedger(ledger: PublicationLedger): PublicationLedger {
  validatePublicationLedger(ledger);
  if (!ledger.releases.length) return structuredClone(ledger);
  const through = ledger.releases.map(item => item.deployed_at).sort(compareTimes).at(-1)!;
  const result: PublicationLedger = { version: 1, fingerprint_version: 1, repository: ledger.repository, coverage: ledger.coverage, checkpoint: { through, entries: [...history(ledger).values()].sort((a, b) => entryKey(a).localeCompare(entryKey(b), 'en')) }, releases: [] };
  validatePublicationLedger(result); return result;
}
export function catalogDatesDryRun(catalog: CatalogData, registry: Registry, ledger?: PublicationLedger) {
  const next = applyCatalogDates(catalog, registry, ledger);
  return entityCollections.flatMap(name => next[name] as PublicEntity[]).map(entry => {
    const before = (catalog[entityCollections.find(name => (catalog[name] as PublicEntity[]).some(item => entryKey(item) === entryKey(entry)))!] as PublicEntity[]).find(item => entryKey(item) === entryKey(entry))?.catalog_dates;
    return { id: entry.id, kind: entry.kind, dates: entry.catalog_dates!, changed: stableJson(before) !== stableJson(entry.catalog_dates), reason: entry.catalog_dates?.first_published.basis === 'unknown' ? 'No verified publication membership' : entry.catalog_dates?.content_updated.basis === 'unknown' ? 'Current content is not in the last published membership' : ledger?.coverage === 'partial' ? 'Incomplete historical deployment coverage: dates are observed bounds' : 'Verified deployment membership' };
  }).sort((a, b) => entryKey(a).localeCompare(entryKey(b), 'en'));
}
export async function readPublicationLedger(path: string, now = Date.now()): Promise<PublicationLedger | undefined> {
  let stat;
  try { stat = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_PUBLICATION_LEDGER_BYTES, 'Invalid publication ledger file');
  const bytes = await readFile(path); assert(bytes.length <= MAX_PUBLICATION_LEDGER_BYTES, 'Publication ledger exceeds byte budget');
  const ledger: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  validatePublicationLedger(ledger, now); return ledger;
}
export async function writePublicationLedger(path: string, ledger: PublicationLedger): Promise<boolean> {
  validatePublicationLedger(ledger);
  const content = stableJson(ledger);
  try { if (await readFile(path, 'utf8') === content) return false; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await writeFile(`${path}.tmp`, content, { mode: 0o600 }); await rename(`${path}.tmp`, path); return true;
}
