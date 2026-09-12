import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';
import { normalizeGitHubUrl, entityId, actorId, ID_PATTERN, isSafeHttpsUrl, isSafeRepositoryPath } from '../spec/identity.js';
import { definitions } from '../spec/schema.js';
import type { Actor, Claim, ResourceType } from '../spec/types.js';

export interface RegistrySource { url: string; reviewed_at: string; review_note: string }
export interface RegistryProject { key: string; title: string; description?: string; domains: string[]; sources: string[]; resources: string[] }
export interface RegistryResource { key: string; title: string; description?: string; type: ResourceType; domains: string[]; sources: string[]; documentation_url?: string; inputs?: string[]; outputs?: string[] }
export interface RegistryCollection { key: string; title: string; description?: string; selection_basis: string; item_ids: string[] }
export interface Registry {
  version: 1;
  sources: RegistrySource[];
  projects: RegistryProject[];
  resources: RegistryResource[];
  collections: RegistryCollection[];
  withdrawals: { id: string; withdrawn_at: string; reason: 'withdrawn' | 'unavailable' | 'merged' | 'policy'; replacement_id?: string }[];
  /** Public GitHub identity observations for contributors who do not own indexed repositories. */
  actors?: Actor[];
  /** Reviewed catalog records, never a direct promotion of an untrusted submission. */
  claims?: Claim[];
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
const strictClaim = { ...structuredClone(definitions.claim), additionalProperties: false };
const strictActor = { ...structuredClone(definitions.actor), additionalProperties: false };
const strictProvenance = { ...structuredClone(definitions.provenance), additionalProperties: false };
const strictAlias = { ...structuredClone(definitions.alias), additionalProperties: false };
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
    projects: array(object({ ...metadata, domains: array(text(100), 0, 100), sources: array(sourceUrl, 1, 100), resources: array(key, 0, 10000) }, ['key', 'title', 'domains', 'sources', 'resources'])),
    resources: array(object({
      ...metadata, type: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,99}$' }, domains: array(text(100), 0, 100),
      sources: array(sourceUrl, 1, 100), documentation_url: safeUrl, inputs: array(text(2000), 0, 100), outputs: array(text(2000), 0, 100),
    }, ['key', 'title', 'type', 'domains', 'sources'])),
    collections: array(object({ ...metadata, selection_basis: text(5000), item_ids: array(id, 1, 10000) }, ['key', 'title', 'selection_basis', 'item_ids'])),
    withdrawals: array(object({ id, withdrawn_at: date, reason: { enum: ['withdrawn', 'unavailable', 'merged', 'policy'] }, replacement_id: id }, ['id', 'withdrawn_at', 'reason'])),
    actors: array(strictActor),
    claims: array(strictClaim),
  }, ['version', 'sources', 'projects', 'resources', 'collections', 'withdrawals']),
  $defs: { provenance: strictProvenance, provenance_map: actorProvenance, alias: strictAlias },
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
      if ('sources' in record) {
        const referenced = new Set<string>();
        for (const url of record.sources) {
          const canonical = normalizeGitHubUrl(url).canonical_url;
          if (!urls.has(canonical)) errors.push(`Unregistered source for ${recordId}: ${canonical}`);
          if (referenced.has(canonical)) errors.push(`Duplicate source reference for ${recordId}: ${canonical}`);
          referenced.add(canonical);
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
