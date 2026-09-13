import type { License } from '../../../spec/types.js';
import { allEntries, routeFor, type SiteData } from '../model.js';

export interface ResearchReference {
  format: 'aipoch-network-internal-review-1';
  object: { id: string; kind: 'project' | 'resource'; title: string };
  action: 'Open' | 'Use';
  target: 'Open-Science';
  public_location: string;
  snapshot: { id: string; generated_at: string };
  sources: Array<{
    id: string; role: string; url: string | null; reference_url: string | null;
    commit: string | null; named_reference: string | null; path: string | null;
    version_status: 'fixed' | 'unfixed'; path_status: 'provided' | 'not_supplied';
    sha256: string | null; resolved_at: string | null;
    availability: string; archived: boolean | null; stale: boolean | null;
    observed_at: string | null; license: License;
  }>;
  license: License | { status: 'per_source'; conditions: string };
  conditions: string[];
}
export type ReferenceResolution = { status: 'ready'; reference: ResearchReference; content: string } | { status: 'loading' | 'missing' | 'withdrawn' | 'unsupported'; message: string };
/** Complete review content, deliberately separate from the public contract / future wire schema. */
export function resolveReference(data: SiteData, id: string, catalogReady: boolean, publicBase = 'https://aipoch.network'): ReferenceResolution {
  if (data.catalog.tombstones.some(row => row.id === id)) return { status: 'withdrawn', message: 'This record has been withdrawn or superseded. It cannot be sent. Find a current record in the catalog.' };
  const entry = allEntries(data.catalog).find(row => row.id === id);
  if (!entry) return catalogReady ? { status: 'missing', message: 'This record is not available in the current catalog. It cannot be sent.' } : { status: 'loading', message: 'Waiting for the full catalog to check the selected record. Your selection is kept.' };
  if (entry.kind !== 'project' && entry.kind !== 'resource') return { status: 'unsupported', message: 'This directory entry is for reading. Choose a project or capability to review a research reference.' };
  if (entry.source_refs.some(ref => data.catalog.tombstones.some(row => row.id === ref.source_id) || data.catalog.sources.some(source => source.id === ref.source_id && ['private', 'deleted'].includes(source.availability)))) return { status: 'withdrawn', message: 'A required source is withdrawn or no longer public. This reference cannot be sent. Check the current catalog and source notices.' };
  if (!catalogReady && entry.source_refs.some(ref => !data.catalog.sources.some(source => source.id === ref.source_id))) return { status: 'loading', message: 'Waiting for the full catalog to resolve all sources. Your selection is kept; an incomplete reference cannot be sent.' };
  const reference: ResearchReference = {
    format: 'aipoch-network-internal-review-1',
    object: { id: entry.id, kind: entry.kind, title: entry.title },
    action: entry.kind === 'project' ? 'Open' : 'Use', target: 'Open-Science',
    public_location: `${publicBase.replace(/\/$/, '')}${routeFor(entry)}`,
    snapshot: { id: data.snapshot_id, generated_at: data.generated_at },
    sources: entry.source_refs.map(ref => {
      const source = data.catalog.sources.find(row => row.id === ref.source_id);
      return { id: ref.source_id, role: ref.role, url: source?.canonical_url ?? null, reference_url: ref.url ?? null,
        commit: ref.commit ?? null, named_reference: ref.ref ?? null, path: ref.path ?? null,
        version_status: ref.commit ? 'fixed' : 'unfixed', path_status: ref.path === undefined ? 'not_supplied' : 'provided',
        sha256: ref.sha256 ?? null, resolved_at: ref.resolved_at ?? null,
        availability: source?.availability ?? 'unknown', archived: source?.archived ?? null, stale: source?.stale ?? null,
        observed_at: source?.observed_at ?? null, license: source?.license ?? { status: 'unknown' } };
    }),
    license: entry.kind === 'resource' ? entry.license : { status: 'per_source', conditions: 'Each source retains its own license and conditions.' },
    conditions: entry.kind === 'resource' ? entry.conditions ?? [] : [],
  };
  // Fixed property order makes exact displayed-content comparisons deterministic, without truncation.
  return { status: 'ready', reference, content: JSON.stringify(reference, null, 2) };
}
