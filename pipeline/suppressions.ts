import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalizeGitHubUrl } from '../spec/index.js';
import type { SourceSnapshot } from './github.js';
import type { SnapshotBatch } from './normalize.js';
import type { Registry } from './registry.js';
import { stableJson } from './json.js';

export interface SourceSuppression {
  requested_url: string;
  provider_id?: number;
  checked_at: string;
  reason: 'not_public' | 'identity_changed';
}
export interface SuppressionState { version: 1; sources: SourceSuppression[] }
const key = (url: string) => normalizeGitHubUrl(url).canonical_url;
export async function readSuppressions(path: string, now = new Date()): Promise<SuppressionState> {
  let content: Buffer;
  try { content = await readFile(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, sources: [] }; throw error; }
  if (content.length > 5_000_000) throw new Error('Suppression state exceeds size limit');
  const parsed = JSON.parse(content.toString('utf8')) as SuppressionState;
  if (parsed.version !== 1 || !Array.isArray(parsed.sources) || parsed.sources.length > 10000) throw new Error('Invalid suppression state');
  const seen = new Set<string>();
  const sources = parsed.sources.map(row => {
    const url = key(row.requested_url);
    if (seen.has(url) || !Number.isFinite(Date.parse(row.checked_at)) || Date.parse(row.checked_at) > now.getTime() + 60_000
      || !['not_public', 'identity_changed'].includes(row.reason) || (row.provider_id !== undefined && (!Number.isSafeInteger(row.provider_id) || row.provider_id < 1))) throw new Error('Invalid source suppression');
    seen.add(url);
    return { requested_url: url, checked_at: row.checked_at, reason: row.reason, ...(row.provider_id ? { provider_id: row.provider_id } : {}) };
  });
  return { version: 1, sources };
}
export async function saveSuppressions(path: string, state: SuppressionState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp-${process.pid}`, stableJson(state));
  await rename(`${path}.tmp-${process.pid}`, path);
}
export function suppressSnapshot(snapshot: SourceSnapshot, state: SuppressionState): SourceSnapshot {
  const rule = state.sources.find(row => key(row.requested_url) === key(snapshot.requested_url) || (row.provider_id && row.provider_id === snapshot.repository?.id));
  return rule ? { ...snapshot, checked_at: [snapshot.checked_at, rule.checked_at].sort().at(-1)!, suppressed: true, availability: 'unknown', error: rule.reason } : snapshot;
}
export function applySuppressions(batch: SnapshotBatch, state: SuppressionState, registry?: Registry): SnapshotBatch {
  const sources = batch.sources.map(source => suppressSnapshot(source, state));
  const withdrawn = new Set(registry?.withdrawals.map(item => item.id));
  const publicOwners = new Set(sources.flatMap(source => !source.suppressed && source.repository && !['private', 'deleted'].includes(source.availability)
    && !withdrawn.has(`source:github:${source.repository.id}`) && !withdrawn.has(`actor:github:${source.repository.owner.id}`) ? [source.repository.owner.id] : []));
  // A separately reviewed public account is eligible independently of repository
  // visibility. Source-only owners still disappear after their last source is suppressed.
  for (const actor of registry?.actors ?? []) if (!withdrawn.has(actor.id) && actor.status === 'listed'
    && actor.id === `actor:github:${actor.provider_id}` && Object.values(actor.provenance).flat().every(item => Date.parse(item.observed_at) <= Date.parse(batch.as_of))) publicOwners.add(actor.provider_id);
  return { as_of: [batch.as_of, ...sources.map(source => source.checked_at)].sort().at(-1)!, sources,
    ...(batch.accounts ? { accounts: batch.accounts.filter(account => publicOwners.has(account.provider_id)) } : {}) };
}
/** Current successful public evidence may clear automatic suppression, never a registry withdrawal. */
export function observeSuppression(state: SuppressionState, snapshot: SourceSnapshot): SuppressionState {
  const url = key(snapshot.requested_url);
  const prior = state.sources.find(row => row.requested_url === url || (row.provider_id && row.provider_id === snapshot.repository?.id));
  const sources = state.sources.filter(row => row !== prior);
  if (snapshot.suppressed || ['private', 'deleted'].includes(snapshot.availability)) {
    sources.push({ requested_url: url, checked_at: snapshot.checked_at,
      reason: snapshot.error === 'identity_changed' ? 'identity_changed' : 'not_public',
      ...(snapshot.repository?.id ?? prior?.provider_id ? { provider_id: snapshot.repository?.id ?? prior!.provider_id } : {}),
    });
  } else if (prior) {
    const freshPublic = snapshot.availability === 'accessible' && snapshot.repository
      && Number.isSafeInteger(snapshot.repository.id) && snapshot.repository.id > 0
      && (!prior.provider_id || prior.provider_id === snapshot.repository.id)
      && snapshot.observed_at === snapshot.checked_at
      && Number.isFinite(Date.parse(snapshot.observed_at ?? ''))
      && Date.parse(snapshot.observed_at!) >= Date.parse(prior.checked_at);
    if (!freshPublic) sources.push(prior);
  }
  return { version: 1, sources: sources.sort((a, b) => a.requested_url.localeCompare(b.requested_url)) };
}
