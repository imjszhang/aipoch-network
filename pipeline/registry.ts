import Ajv from 'ajv';
import { validateClassificationDraft } from '../spec/taxonomy.js';
import { ford, researchTags } from '../spec/classification.js';
import type { ResearchClassification, Provenance } from '../spec/types.js';
import type { ErrorObject } from 'ajv';
import { normalizeGitHubUrl, entityId, actorId, ID_PATTERN, FULL_COMMIT_PATTERN, SHA256_PATTERN, isSafeHttpsUrl, isSafeRepositoryPath } from '../spec/identity.js';
import { classificationProperties, definitions } from '../spec/schema.js';
import { relationKindsAllowed } from '../spec/relations.js';
import type { Actor, Claim, Relation, Resource, ResourceType, SourceRef } from '../spec/types.js';

export interface RegistrySource { url: string; reviewed_at: string; review_note: string }
export interface RegistrySourceRef extends Omit<SourceRef, 'source_id' | 'url'> { source_url: string; source_id?: string }
export interface RegistryAttribution { role: 'editor' | 'community'; url: string; observed_at: string }
export interface RegistryClassification extends ResearchClassification { content_provenance?: Partial<Record<'description' | 'audience' | 'getting_started' | 'inputs' | 'outputs' | 'conditions' | 'documentation_url', Provenance[]>>; classification_provenance?: Provenance[]; research_tags_provenance?: Provenance[] }
export interface RegistryProject extends RegistryClassification { key: string; title: string; description?: string; domains: string[]; sources: string[]; resources: string[]; source_refs?: RegistrySourceRef[]; attribution?: RegistryAttribution }
export interface RegistryResource extends RegistryClassification { key: string; title: string; description?: string; type: ResourceType; domains: string[]; sources: string[]; documentation_url?: string; download_url?: string; audience?: string[]; getting_started?: Resource['getting_started']; inputs?: string[]; outputs?: string[]; conditions?: string[]; runtime?: Resource['runtime']; source_refs?: RegistrySourceRef[]; attribution?: RegistryAttribution }
export interface RegistryCollection { key: string; title: string; description?: string; selection_basis: string; item_ids: string[] }
export interface Registry {
  version: 1;
  sources: RegistrySource[];
  projects: RegistryProject[];
  resources: RegistryResource[];
  collections: RegistryCollection[];
  withdrawals: { id: string; withdrawn_at: string; reason: 'withdrawn' | 'unavailable' | 'merged' | 'policy'; replacement_id?: string }[];
  /** Public GitHub identity observations for contributors who do not own indexed repositories. */
  actors?: Omit<Actor, 'catalog_dates' | 'github_metrics' | 'observation'>[];
  /** Reviewed catalog records, never a direct promotion of an untrusted submission. */
  claims?: Claim[];
  relations?: Relation[];
}
const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S' });
const key = { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,127}$' };
const id = { type: 'string', pattern: ID_PATTERN };
const date = { type: 'string', format: 'registry-utc-time' };
const safeUrl = { type: 'string', minLength: 1, maxLength: 4096, format: 'registry-https-url' };
const sourceUrl = { ...safeUrl, format: 'registry-repository-url' };
const array = (items: unknown, minItems = 0, maxItems = 10000) => ({ type: 'array', items, minItems, maxItems, uniqueItems: true });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const metadata = { key, title: text(300), description: text(20000) };
const declaredRef = object({ source_url: sourceUrl, source_id: { type: 'string', pattern: '^source:github:[1-9][0-9]*$' }, role: { enum: ['primary', 'documentation', 'implementation', 'data', 'evidence', 'related'] }, path: { type: 'string', format: 'safe-repository-path' }, commit: { type: 'string', pattern: FULL_COMMIT_PATTERN }, ref: text(500), sha256: { type: 'string', pattern: SHA256_PATTERN }, resolved_at: date }, ['source_url', 'role']);
const attributed = { ...classificationProperties, classification_provenance: array({ $ref: '#/$defs/provenance' }, 1, 100), research_tags_provenance: array({ $ref: '#/$defs/provenance' }, 1, 100), source_refs: array(declaredRef, 1, 100), attribution: object({ role: { enum: ['editor', 'community'] }, url: safeUrl, observed_at: date }) };
const contentEvidence = (fields: string[]) => object(Object.fromEntries(fields.map(field => [field, array({ $ref: '#/$defs/provenance' }, 1, 20)])), []);
const projectSchema = object({ ...metadata, ...attributed, content_provenance: contentEvidence(['description']), domains: array(text(100), 0, 100), sources: array(sourceUrl, 1, 100), resources: array(key, 0, 10000) }, ['key', 'title', 'domains', 'sources', 'resources']);
const resourceSchema = object({ ...metadata, ...attributed, content_provenance: contentEvidence(['description','audience','getting_started','inputs','outputs','conditions','documentation_url']), audience: array(text(2000), 1, 20), getting_started: array(object({ text: text(2000), url: safeUrl }), 1, 10), type: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,99}$' }, domains: array(text(100), 0, 100), sources: array(sourceUrl, 1, 100), documentation_url: safeUrl, download_url: safeUrl, inputs: array(text(2000), 0, 100), outputs: array(text(2000), 0, 100), conditions: array(text(2000), 0, 100), runtime: object({ status: { enum: ['not_described', 'maintainer_described', 'community_described'] }, documentation_url: safeUrl }, ['status']) }, ['key', 'title', 'type', 'domains', 'sources']);
const strictClaim = { ...structuredClone(definitions.claim), additionalProperties: false };
// Generated publication dates and public API observations never come from curation input.
const strictActor = { ...structuredClone(definitions.actor), properties: Object.fromEntries(Object.entries(definitions.actor.properties).filter(([key]) => !['catalog_dates', 'github_metrics', 'observation'].includes(key))), additionalProperties: false };
const strictProvenance = { ...structuredClone(definitions.provenance), additionalProperties: false };
const strictAlias = { ...structuredClone(definitions.alias), additionalProperties: false };
const strictRelation = { ...structuredClone(definitions.relation), additionalProperties: false };
const publicActorFields = ['title', 'description', 'provider_id', 'canonical_url', 'login', 'account_type', 'aliases'];
const actorProvenance = object(Object.fromEntries(publicActorFields.map(field => [field, array({ $ref: '#/$defs/provenance' }, 1, 100)])), ['title', 'provider_id']);

/** Explicit catalog scope; no wildcard, implied organization-wide membership or future sources. */
export function parseOrganizationCurationScope(scope: string): string[] | undefined {
  const prefix = 'catalog-curation:';
  if (!scope.startsWith(prefix)) return undefined;
  const ids = scope.slice(prefix.length).split(',');
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) return undefined;
  return ids.every(id => /^(?:source:github:[1-9][0-9]*|resource:[a-z0-9][a-z0-9._-]{0,127})$/.test(id)) ? ids : undefined;
}

/** Authoritative human-edited registry, deliberately stricter than the extensible public contract. */
export const registrySchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'AIPOCH reviewed registry v1',
  ...object({
    version: { const: 1 },
    sources: array(object({ url: sourceUrl, reviewed_at: date, review_note: text(2000) })),
    projects: array(projectSchema),
    resources: array(resourceSchema),
    collections: array(object({ ...metadata, selection_basis: text(5000), item_ids: array(id, 1, 10000) }, ['key', 'title', 'selection_basis', 'item_ids'])),
    withdrawals: array(object({ id, withdrawn_at: date, reason: { enum: ['withdrawn', 'unavailable', 'merged', 'policy'] }, replacement_id: id }, ['id', 'withdrawn_at', 'reason'])),
    actors: array(strictActor),
    claims: array(strictClaim),
    relations: array(strictRelation),
  }, ['version', 'sources', 'projects', 'resources', 'collections', 'withdrawals']),
  $defs: { provenance: strictProvenance, provenance_map: actorProvenance, alias: strictAlias },
};

export interface RegistryEnhancement {
  version: 1;
  source_url: string;
  reviewed_at: string;
  review_note: string;
  projects?: RegistryProject[];
  resources?: RegistryResource[];
  relations?: Relation[];
}
export const registryEnhancementSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#', title: 'Optional reviewed registry enhancement v1',
  ...object({ version: { const: 1 }, source_url: sourceUrl, reviewed_at: date, review_note: text(2000), projects: array(projectSchema, 1), resources: array(resourceSchema, 1), relations: array(strictRelation, 1) }, ['version', 'source_url', 'reviewed_at', 'review_note']),
  minProperties: 5,
  $defs: { provenance: strictProvenance },
};

/** Review belongs to inclusion, not intake: an unauthenticated submission can contain one URL. */
export const sourceCandidateSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'AIPOCH URL-only source candidate',
  ...object({ url: { ...safeUrl, format: 'registry-candidate-url' } }),
};

function validUtcTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
}
function validCandidateUrl(value: string): boolean {
  try { normalizeGitHubUrl(value); return true; } catch { return false; }
}
function validRepositoryUrl(value: string): boolean {
  try {
    const candidate = normalizeGitHubUrl(value);
    // A registry source identifies the repository, while file locations remain intake context.
    return candidate.kind === 'repository' && !candidate.location;
  } catch { return false; }
}
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addFormat('registry-utc-time', validUtcTime);
ajv.addFormat('registry-https-url', isSafeHttpsUrl);
ajv.addFormat('registry-repository-url', validRepositoryUrl);
ajv.addFormat('registry-candidate-url', validCandidateUrl);
ajv.addFormat('utc-date-time', validUtcTime);
ajv.addFormat('safe-https-url', isSafeHttpsUrl);
ajv.addFormat('safe-repository-path', isSafeRepositoryPath);
const checkRegistry = ajv.compile<Registry>(registrySchema);
const checkCandidate = ajv.compile(sourceCandidateSchema);
const checkEnhancement = ajv.compile<RegistryEnhancement>(registryEnhancementSchema);
function describeErrors(errors: ErrorObject[] | null | undefined): string[] {
  // Deliberately exclude property values, source URLs and entire JSON payloads from diagnostics.
  return (errors ?? []).map(error => {
    const title = /^\/(projects|resources|collections)\/\d+\/title$/.exec(error.instancePath);
    const prefix = title ? `Invalid ${title[1].slice(0, -1)} title at ` : '';
    return `${prefix}${error.instancePath || '/'}: ${error.message ?? 'is invalid'}${error.keyword === 'required' ? ` (${String(error.params.missingProperty)})` : ''}`;
  });
}
export function validateSourceCandidate(input: unknown): string[] {
  return checkCandidate(input) ? [] : describeErrors(checkCandidate.errors);
}
export function validateRegistry(input: unknown): string[] {
  if (!checkRegistry(input)) return describeErrors(checkRegistry.errors);
  const registry = input;
  const errors: string[] = [];
  const urls = new Set<string>();
  for (const source of registry.sources) {
    const canonical = normalizeGitHubUrl(source.url).canonical_url;
    if (urls.has(canonical)) errors.push(`Duplicate source: ${canonical}`);
    urls.add(canonical);
  }
  const ids = new Set<string>();
  for (const [kind, records] of [['project', registry.projects], ['resource', registry.resources], ['collection', registry.collections]] as const) {
    for (const record of records) {
      const recordId = entityId(kind, record.key);
      if (ids.has(recordId)) errors.push(`Duplicate identity: ${recordId}`);
      ids.add(recordId);
      if (kind === 'resource' && 'runtime' in record && record.runtime && record.runtime.status !== 'not_described' && !record.runtime.documentation_url) errors.push(`Described resource runtime requires a public documentation URL: ${recordId}`);
      if ('sources' in record) {
        for (const [field, evidence] of Object.entries(record.content_provenance ?? {})) {
          if (!(field in record)) errors.push(`${recordId}: content evidence requires an explicit ${field} value`);
          for (const item of evidence ?? []) if (item.review !== 'reviewed' || !['editor','community'].includes(item.role) || !item.scope) errors.push(`${recordId}: content evidence must be reviewed editorial evidence with a scope`);
        }
        if ('type' in record) for (const field of ['audience','getting_started'] as const) if (record[field] && !record.content_provenance?.[field]?.length) errors.push(`${recordId}: ${field} requires content evidence`);
        const draft = { ...(record.classification ? { classification: record.classification } : {}), ...(record.research_tags ? { research_tags: record.research_tags } : {}) };
        errors.push(...validateClassificationDraft(draft, ford, researchTags).errors.map(error => `${recordId}: ${error}`));
        for (const field of ['classification', 'research_tags'] as const) {
          const evidence = record[`${field}_provenance`];
          if (Boolean(record[field]) !== Boolean(evidence?.length)) errors.push(`${recordId}: ${field} requires separate evidence`);
          for (const item of evidence ?? []) {
            if (item.review !== 'reviewed' || !['editor','community'].includes(item.role) || !item.scope || !item.source_id || !item.commit || !item.path) errors.push(`${recordId}: ${field} requires reviewed editorial file evidence`);
            if (!record.sources.some(url => item.url.startsWith(`${url}/blob/${item.commit}/`))) errors.push(`${recordId}: ${field} evidence must belong to its source`);
          }
        }
        const referenced = new Set<string>();
        for (const url of record.sources) {
          const canonical = normalizeGitHubUrl(url).canonical_url;
          if (!urls.has(canonical)) errors.push(`Unregistered source for ${recordId}: ${canonical}`);
          if (referenced.has(canonical)) errors.push(`Duplicate source reference for ${recordId}: ${canonical}`);
          referenced.add(canonical);
        }
        if (record.source_refs) {
          const declaredSources = new Set<string>();
          const locations = new Set<string>();
          for (const ref of record.source_refs) {
            const canonical = normalizeGitHubUrl(ref.source_url).canonical_url;
            declaredSources.add(canonical);
            const location = JSON.stringify([canonical, ref.source_id, ref.role, ref.path, ref.commit, ref.ref, ref.sha256, ref.resolved_at]);
            if (locations.has(location)) errors.push(`Duplicate declared source location: ${recordId}`);
            locations.add(location);
            if (!referenced.has(canonical)) errors.push(`Declared source reference must belong to sources: ${recordId}`);
            if (ref.commit && !ref.source_id) errors.push(`Fixed commit requires a stable source_id: ${recordId}`);
            if ((ref.sha256 || ref.resolved_at) && !ref.commit) errors.push(`Checksum/resolution time requires an explicit immutable commit: ${recordId}`);
          }
          if ([...referenced].some(url => !declaredSources.has(url))) errors.push(`Declared source references must cover every source: ${recordId}`);
        }
      }
    }
  }
  const withdrawals = new Map<string, Registry['withdrawals'][number]>();
  for (const withdrawal of registry.withdrawals) {
    if (withdrawals.has(withdrawal.id)) errors.push(`Duplicate withdrawal: ${withdrawal.id}`);
    withdrawals.set(withdrawal.id, withdrawal);
  }
  const actorIds = new Set<string>();
  for (const actor of registry.actors ?? []) {
    if (actorIds.has(actor.id)) errors.push(`Duplicate actor identity: ${actor.id}`);
    actorIds.add(actor.id);
    if (actor.id !== actorId(actor.provider_id)) errors.push(`Actor ID must match observed GitHub ID: ${actor.id}`);
    let currentLogin: string | undefined;
    try {
      const profile = normalizeGitHubUrl(actor.canonical_url);
      if (profile.kind === 'organization') currentLogin = profile.owner;
    } catch { /* The diagnostic below excludes unsafe input values. */ }
    if (currentLogin !== actor.login.toLowerCase()) errors.push(`Actor URL and login must identify one GitHub account: ${actor.id}`);
    if (actor.status !== 'listed') errors.push(`Supplemental actor must have a reviewed public identity: ${actor.id}`);
    const identityEvidence = actor.provenance.provider_id ?? [];
    const apiUrls = [`https://api.github.com/users/${actor.login.toLowerCase()}`, ...(actor.account_type === 'organization' ? [`https://api.github.com/orgs/${actor.login.toLowerCase()}`] : [])];
    if (!identityEvidence.some(item => item.role === 'github' && item.review === 'reviewed' && item.actor_id === actor.id && apiUrls.includes(item.url.toLowerCase()))) errors.push(`Actor provider_id requires a reviewed public GitHub API observation: ${actor.id}`);
    if (actor.description && !actor.provenance.description?.length) errors.push(`Actor description requires provenance: ${actor.id}`);
    for (const evidence of Object.values(actor.provenance).flat()) {
      if (evidence.source_id || evidence.path || evidence.commit || (evidence.actor_id && evidence.actor_id !== actor.id)) errors.push(`Supplemental actor provenance must reference only that public account: ${actor.id}`);
    }
    for (const alias of actor.aliases) {
      if (alias.provider_id !== actor.provider_id) errors.push(`Actor alias must preserve the same GitHub identity: ${actor.id}`);
      try { if (normalizeGitHubUrl(alias.url).kind !== 'organization') errors.push(`Actor alias must be a GitHub account URL: ${actor.id}`); }
      catch { errors.push(`Actor alias must be a GitHub account URL: ${actor.id}`); }
    }
  }
  const claimIds = new Set<string>();
  for (const claim of registry.claims ?? []) {
    if (claimIds.has(claim.id)) errors.push(`Duplicate claim identity: ${claim.id}`);
    claimIds.add(claim.id);
    if (!claim.id.startsWith('claim:')) errors.push(`Invalid claim identity: ${claim.id}`);
    if (!claim.actor_id.startsWith('actor:github:') || (claim.verified_by && !claim.verified_by.startsWith('actor:github:'))) errors.push(`Claim author and reviewer must identify GitHub actors: ${claim.id}`);
    if (!/^(?:source|actor):github:/.test(claim.subject_id) && !ids.has(claim.subject_id) && !withdrawals.has(claim.subject_id)) errors.push(`Unknown claim subject: ${claim.id}`);
    if (claim.type === 'maintainership' && !claim.subject_id.startsWith('source:github:')) errors.push(`Maintainership must target a repository identity: ${claim.id}`);
    if (claim.type === 'organization_curation') {
      if (!claim.subject_id.startsWith('actor:github:')) errors.push(`Organization curation must target an organization Actor: ${claim.id}`);
      const scope = parseOrganizationCurationScope(claim.scope);
      if (!scope) errors.push(`Organization curation requires explicit catalog-curation source/resource IDs: ${claim.id}`);
      else for (const scopedId of scope) if (scopedId.startsWith('resource:') && !ids.has(scopedId) && !withdrawals.has(scopedId)) errors.push(`Unknown organization curation resource: ${claim.id}`);
    }
    for (const evidence of claim.evidence) {
      if (evidence.source_id && !evidence.source_id.startsWith('source:github:')) errors.push(`Claim evidence source_id must identify a repository: ${claim.id}`);
      if (evidence.actor_id && !evidence.actor_id.startsWith('actor:github:')) errors.push(`Claim evidence actor_id must identify an actor: ${claim.id}`);
      if ((evidence.path || evidence.commit) && !evidence.source_id) errors.push(`Claim file evidence requires a source identity: ${claim.id}`);
    }
    if (claim.status === 'verified') {
      if (!claim.verified_at || !claim.verified_by || !claim.evidence.some(item => item.review === 'reviewed')) errors.push(`Verified claim requires reviewer, verification time and reviewed evidence: ${claim.id}`);
      if (claim.verified_at && Date.parse(claim.verified_at) < Date.parse(claim.recorded_at)) errors.push(`Claim verification cannot precede recording: ${claim.id}`);
      if (claim.verified_at && claim.evidence.some(item => item.review === 'reviewed' && Date.parse(item.observed_at) > Date.parse(claim.verified_at!))) errors.push(`Reviewed evidence cannot postdate claim verification: ${claim.id}`);
      if (claim.expires_at && claim.verified_at && Date.parse(claim.expires_at) <= Date.parse(claim.verified_at)) errors.push(`Claim expiration must follow verification: ${claim.id}`);
      if (claim.type === 'maintainership' || claim.type === 'organization_curation') {
        const authorities = claim.type === 'organization_curation' ? ['organization_owner', 'delegated_by_owner'] : ['repository_maintainer', 'organization_owner', 'delegated_by_owner'];
        if (!authorities.includes(claim.authority ?? '')) errors.push(`Verified governance claim requires the matching owner/maintainer authority: ${claim.id}`);
        if (!claim.expires_at) errors.push(`Verified governance claim requires an explicit evidence expiry: ${claim.id}`);
        for (const trigger of ['rename', 'transfer', 'permission_change', 'evidence_expiry', 'dispute'] as const) if (!claim.recheck_on.includes(trigger)) errors.push(`Governance claim must recheck ${trigger}: ${claim.id}`);
        if (!claim.evidence.some(item => item.review === 'reviewed' && ['github', 'maintainer', 'editor'].includes(item.role) && item.scope === claim.scope)) errors.push(`Governance evidence must explicitly cover the reviewed scope: ${claim.id}`);
        if (claim.type === 'maintainership' && !claim.evidence.some(item => item.source_id === claim.subject_id)) errors.push(`Maintainership evidence must identify the claimed repository: ${claim.id}`);
      }
    }
  }
  const relationIds = new Set<string>();
  for (const relation of registry.relations ?? []) {
    if (!relation.id.startsWith('relation:')) errors.push(`Invalid relation identity: ${relation.id}`);
    if (relationIds.has(relation.id)) errors.push(`Duplicate relation identity: ${relation.id}`);
    relationIds.add(relation.id);
    if (relation.from_id === relation.to_id) errors.push(`Relation endpoints must differ: ${relation.id}`);
    const kind = (id: string) => id.startsWith('source:') ? 'source_repository' : id.split(':')[0];
    if (!relationKindsAllowed(relation.type, kind(relation.from_id), kind(relation.to_id))) errors.push(`Relation type does not match its endpoint kinds: ${relation.id}`);
    for (const endpoint of [relation.from_id, relation.to_id]) if (!/^(?:source|actor):github:/.test(endpoint) && !ids.has(endpoint) && !withdrawals.has(endpoint)) errors.push(`Unknown relation endpoint: ${relation.id}`);
    if (!relation.evidence.some(item => item.review === 'reviewed')) errors.push(`Relation requires reviewed public evidence: ${relation.id}`);
    for (const evidence of relation.evidence) {
      if (evidence.source_id && !evidence.source_id.startsWith('source:github:')) errors.push(`Relation evidence source_id must identify a repository: ${relation.id}`);
      if (evidence.actor_id && !evidence.actor_id.startsWith('actor:github:')) errors.push(`Relation evidence actor_id must identify an actor: ${relation.id}`);
      if ((evidence.path || evidence.commit) && !evidence.source_id) errors.push(`Relation file evidence requires a source identity: ${relation.id}`);
      if (evidence.review === 'reviewed' && Date.parse(evidence.observed_at) > Date.parse(relation.recorded_at)) errors.push(`Relation evidence cannot postdate its recorded review: ${relation.id}`);
    }
  }
  const knownEditorial = (target: string) => ids.has(target) || withdrawals.has(target);
  for (const project of registry.projects) for (const resourceKey of project.resources) {
    if (!knownEditorial(entityId('resource', resourceKey))) errors.push(`Unknown project resource: ${resourceKey}`);
  }
  for (const collection of registry.collections) for (const itemId of collection.item_ids) {
    if (!knownEditorial(itemId)) errors.push(`Unknown collection item: ${itemId}`);
    if (itemId === entityId('collection', collection.key)) errors.push(`Collection cannot include itself: ${itemId}`);
  }
  // Nested collection cycles otherwise disappear silently during traversal or recurse forever.
  const collectionGraph = new Map(registry.collections.map(collection => [entityId('collection', collection.key), collection.item_ids.filter(id => id.startsWith('collection:'))]));
  const incoming = new Map([...collectionGraph.keys()].map(id => [id, 0]));
  for (const children of collectionGraph.values()) for (const child of children) if (incoming.has(child)) incoming.set(child, incoming.get(child)! + 1);
  const ready = [...incoming.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  for (let cursor = 0; cursor < ready.length; cursor++) {
    for (const child of collectionGraph.get(ready[cursor]) ?? []) {
      if (!incoming.has(child)) continue;
      const remaining = incoming.get(child)! - 1;
      incoming.set(child, remaining);
      if (remaining === 0) ready.push(child);
    }
  }
  if (ready.length !== collectionGraph.size) errors.push('Cyclic collection references');
  for (const withdrawal of registry.withdrawals) {
    const replacement = withdrawal.replacement_id;
    if (withdrawal.reason === 'merged' && !replacement) errors.push(`Merged withdrawal requires replacement_id: ${withdrawal.id}`);
    if (replacement && withdrawal.reason !== 'merged') errors.push(`replacement_id requires merged reason: ${withdrawal.id}`);
    if (!replacement) continue;
    if (replacement === withdrawal.id) errors.push(`Withdrawal cannot replace itself: ${withdrawal.id}`);
    if (replacement.split(':')[0] !== withdrawal.id.split(':')[0]) errors.push(`Replacement must preserve object kind: ${withdrawal.id}`);
    // Provider identities cannot be resolved from URL-only registry metadata. Their existence
    // remains a mandatory check in the complete catalog after trusted snapshot normalization.
    if (!knownEditorial(replacement) && !/^(?:source|actor):github:/.test(replacement)) errors.push(`Unknown replacement identity: ${replacement}`);
    const visited = new Set([withdrawal.id]);
    let cursor: string | undefined = replacement;
    while (cursor) {
      if (visited.has(cursor)) { errors.push(`Cyclic withdrawal replacements: ${withdrawal.id}`); break; }
      visited.add(cursor);
      const target = withdrawals.get(cursor);
      if (!target) break;
      if (!target.replacement_id) { errors.push(`Replacement resolves to a withdrawn identity: ${withdrawal.id}`); break; }
      cursor = target.replacement_id;
    }
  }
  return errors;
}

/** A bad optional file never mutates or rejects an independently valid URL-only baseline. */
export function applyRegistryEnhancement(registry: Registry, input: unknown): { registry: Registry; errors: string[]; applied: boolean } {
  if (!checkEnhancement(input)) return { registry, errors: describeErrors(checkEnhancement.errors), applied: false };
  const baselineErrors = validateRegistry(registry);
  if (baselineErrors.length) return { registry, errors: baselineErrors, applied: false };
  const canonical = normalizeGitHubUrl(input.source_url).canonical_url;
  if (!registry.sources.some(source => normalizeGitHubUrl(source.url).canonical_url === canonical)) return { registry, errors: ['Enhancement source must already be a reviewed registry source'], applied: false };
  const newRecords = [...(input.projects ?? []), ...(input.resources ?? [])];
  if (newRecords.some(record => !record.sources.some(url => normalizeGitHubUrl(url).canonical_url === canonical))) return { registry, errors: ['Enhanced entries must reference the declared enhancement source'], applied: false };
  const attribution: RegistryAttribution = { role: 'community', url: canonical, observed_at: input.reviewed_at };
  const candidate: Registry = {
    ...structuredClone(registry),
    projects: [...registry.projects.map(record => structuredClone(record)), ...(input.projects ?? []).map(record => ({ ...structuredClone(record), attribution: { ...attribution }, ...(record.content_provenance ? { content_provenance: Object.fromEntries(Object.entries(record.content_provenance).map(([field, items]) => [field, items!.map(item => ({ ...item, role: 'community' as const }))])) } : {}) }))],
    resources: [...registry.resources.map(record => structuredClone(record)), ...(input.resources ?? []).map(record => ({ ...structuredClone(record), attribution: { ...attribution }, ...(record.content_provenance ? { content_provenance: Object.fromEntries(Object.entries(record.content_provenance).map(([field, items]) => [field, items!.map(item => ({ ...item, role: 'community' as const }))])) } : {}), ...(record.runtime ? { runtime: { ...structuredClone(record.runtime), status: record.runtime.status === 'not_described' ? 'not_described' as const : 'community_described' as const } } : {}) }))],
    ...(input.relations ? { relations: [...(registry.relations ?? []).map(record => structuredClone(record)), ...input.relations.map(record => ({ ...structuredClone(record), evidence: record.evidence.map(item => ({ ...structuredClone(item), role: 'community' as const })) }))] } : {}),
  };
  const errors = validateRegistry(candidate);
  return errors.length ? { registry, errors, applied: false } : { registry: candidate, errors: [], applied: true };
}
