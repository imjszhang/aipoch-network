import { actorId, sourceId } from '../identity.js';
import { emptyCatalog } from '../types.js';
import type { CatalogData, FieldProvenance, Provenance } from '../types.js';

export const FIXTURE_TIME = '2026-09-12T00:00:00.000Z';
export const FIXTURE_COMMIT = '1234567890abcdef1234567890abcdef12345678';
export function fixtureEvidence(role: Provenance['role'] = 'editor'): Provenance {
  return { role, url: 'https://github.com/example-lab/research', observed_at: FIXTURE_TIME, review: 'reviewed', scope: 'Synthetic catalog fixture; no real research claim' };
}
function provenance(): FieldProvenance { return { title: [fixtureEvidence()], description: [fixtureEvidence()] }; }

/** Entirely synthetic: no external service, credentials, client source, or workbench needed. */
export function createFixtureCatalog(): CatalogData {
  const data = emptyCatalog();
  data.actors = [
    { kind: 'actor', id: actorId(101), provider: 'github', provider_id: 101, account_type: 'organization', login: 'example-lab', canonical_url: 'https://github.com/example-lab', aliases: [], title: 'Example Lab', status: 'listed', updated_at: FIXTURE_TIME, provenance: provenance() },
    { kind: 'actor', id: actorId(102), provider: 'github', provider_id: 102, account_type: 'user', login: 'example-curator', canonical_url: 'https://github.com/example-curator', aliases: [], title: 'Example Curator', status: 'listed', updated_at: FIXTURE_TIME, provenance: provenance() },
  ];
  data.sources = [201, 202].map((provider_id, index) => ({
    kind: 'source_repository', id: sourceId(provider_id), provider: 'github', provider_id,
    canonical_url: `https://github.com/example-lab/${index === 0 ? 'research' : 'observations'}`,
    owner_id: actorId(101), availability: 'accessible', archived: false, observed_at: FIXTURE_TIME,
    stale: false, license: { status: 'unknown' }, aliases: [], title: index === 0 ? 'Research source' : 'Observations source',
    status: 'listed', updated_at: FIXTURE_TIME, provenance: provenance(),
  }));
  data.resources = [
    { kind: 'resource', id: 'resource:method-001', title: 'Synthetic research method', description: 'An illustrative method, not a validated result.', status: 'listed', updated_at: FIXTURE_TIME, provenance: provenance(), resource_type: 'method', domains: ['biology'], source_refs: [{ source_id: sourceId(201), role: 'primary', path: 'methods/protocol.md', commit: FIXTURE_COMMIT }], project_ids: ['project:study-001'], license: { status: 'unknown' }, runtime: { status: 'not_described' } },
    { kind: 'resource', id: 'resource:analysis-001', title: 'Synthetic analysis workflow', status: 'listed', updated_at: FIXTURE_TIME, provenance: provenance(), resource_type: 'workflow', domains: ['biology'], source_refs: [{ source_id: sourceId(201), role: 'implementation', path: 'workflows/analysis.yaml', ref: 'main' }, { source_id: sourceId(202), role: 'data' }], project_ids: ['project:study-001'], license: { status: 'unknown' }, runtime: { status: 'not_described' } },
  ];
  data.projects = [{ kind: 'project', id: 'project:study-001', title: 'Synthetic multi-repository study', question: 'How can independent sources be described without assuming scientific validity?', status: 'listed', updated_at: FIXTURE_TIME, provenance: provenance(), domains: ['biology'], source_refs: [{ source_id: sourceId(201), role: 'primary' }, { source_id: sourceId(202), role: 'data' }], resource_ids: data.resources.map(resource => resource.id) }];
  data.organizations = [{ kind: 'organization', id: actorId(101), actor_id: actorId(101), title: 'Example Lab', status: 'listed', updated_at: FIXTURE_TIME, provenance: provenance(), source_ids: data.sources.map(source => source.id), resource_ids: data.resources.map(resource => resource.id), participation: 'community_indexed' }];
  data.collections = [{ kind: 'collection', id: 'collection:sample-research', title: 'Sample research directory', status: 'listed', updated_at: FIXTURE_TIME, provenance: provenance(), actor_ids: [actorId(102)], item_ids: ['project:study-001', 'resource:method-001'], selection_basis: 'Synthetic examples selected to test repository/project/resource distinctions.' }];
  data.relations = [{ kind: 'relation', id: 'relation:study-produces-method', from_id: 'project:study-001', to_id: 'resource:method-001', type: 'produces', evidence: [fixtureEvidence('community')], recorded_at: FIXTURE_TIME, commit: FIXTURE_COMMIT }];
  data.claims = [{ kind: 'claim', id: 'claim:unverified-maintainer', subject_id: sourceId(201), actor_id: actorId(102), type: 'maintainership', status: 'unverified', scope: 'Only this repository', evidence: [fixtureEvidence('community')], recorded_at: FIXTURE_TIME, recheck_on: ['transfer', 'permission_change', 'dispute'] }];
  data.tombstones = [{ kind: 'tombstone', id: 'resource:withdrawn-example', status: 'withdrawn', withdrawn_at: FIXTURE_TIME, reason: 'withdrawn' }];
  return data;
}
