import { createHash } from 'node:crypto';

// Deliberately independent of the website, generator, and repository schema code.
export const COLLECTIONS = Object.freeze(['sources', 'actors', 'organizations', 'projects', 'resources', 'collections', 'relations', 'claims', 'tombstones']);
const kinds = { sources: 'source_repository', actors: 'actor', organizations: 'organization', projects: 'project', resources: 'resource', collections: 'collection', relations: 'relation', claims: 'claim', tombstones: 'tombstone' };
const idPattern = /^(?:(?:source|actor):github:[1-9][0-9]*|(?:project|resource|collection|relation|claim):[a-z0-9][a-z0-9._-]{0,127})$/;
const versionPattern = /^1\.[0-9]+\.[0-9]+$/;
const commitPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const entityKinds = ['source_repository', 'actor', 'project', 'resource', 'collection'];
const defaults = Object.freeze({ manifestBytes: 1024 * 1024, shardBytes: 8 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, shards: 4096, records: 100000, timeoutMs: 15000 });

export class CatalogError extends Error {
  constructor(message) { super(message); this.name = 'CatalogError'; }
}
function assert(condition, message) { if (!condition) throw new CatalogError(message); }
function obj(value, at) { assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${at}: expected object`); return value; }
function text(value, at, max = 20000) { assert(typeof value === 'string' && value.length > 0 && value.length <= max, `${at}: expected bounded nonempty string`); return value; }
function array(value, at) { assert(Array.isArray(value) && value.length <= 100000, `${at}: expected bounded array`); return value; }
function oneOf(value, values, at) { assert(values.includes(value), `${at}: unsupported value`); return value; }
function integer(value, at, min = 0) { assert(Number.isSafeInteger(value) && value >= min, `${at}: expected safe integer`); return value; }
function boolean(value, at) { assert(typeof value === 'boolean', `${at}: expected boolean`); }
function id(value, at) { assert(typeof value === 'string' && idPattern.test(value), `${at}: invalid ID`); return value; }
function date(value, at) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), `${at}: expected UTC timestamp`);
  const parsed = new Date(value);
  assert(Number.isFinite(parsed.getTime()) && parsed.toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z'), `${at}: invalid timestamp`);
}
function pattern(value, regex, at) { assert(typeof value === 'string' && regex.test(value), `${at}: invalid format`); }
function optional(record, key, validate, at) { if (record[key] !== undefined) validate(record[key], `${at}.${key}`); }
function ids(value, at) { const list = array(value, at); list.forEach(item => id(item, at)); assert(new Set(list).size === list.length, `${at}: duplicate reference`); return list; }
function texts(value, at, max = 2000) { array(value, at).forEach(item => text(item, at, max)); }

function safeRelative(value, at) {
  text(value, at, 2048);
  assert(!value.startsWith('/') && !/[?#:\\\u0000-\u0020\u007f]/.test(value), `${at}: unsafe relative path`);
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw new CatalogError(`${at}: invalid path encoding`); }
  assert(!/%[a-f0-9]{2}/i.test(decoded) && !/[?#:\\\u0000-\u0020\u007f]/.test(decoded) && !decoded.startsWith('/'), `${at}: unsafe encoded path`);
  assert(decoded.split('/').every(part => part && part !== '.' && part !== '..'), `${at}: path traversal or empty segment`);
  return value;
}
function repositoryPath(value, at) {
  text(value, at, 2048);
  assert(!value.startsWith('/') && !/[?#:%\\\u0000-\u001f\u007f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'), `${at}: unsafe repository path`);
  return value;
}
function https(value, at) {
  text(value, at, 4096);
  let url;
  try { url = new URL(value); } catch { throw new CatalogError(`${at}: invalid URL`); }
  const credentialQuery = [...url.searchParams.keys()].some(key => /^(?:access_token|token|secret|password|authorization|api_key|client_secret)$/i.test(key));
  assert(url.protocol === 'https:' && !url.username && !url.password && !credentialQuery && !url.port && !/[\u0000-\u0020\u007f\\]/.test(value), `${at}: expected HTTPS URL without credentials`);
  return value;
}
function entryUrl(value) {
  text(value, 'manifest URL', 4096);
  let url;
  try { url = new URL(value); } catch { throw new CatalogError('Invalid manifest URL'); }
  assert(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && !/[\u0000-\u0020\u007f\\]/.test(value), 'Manifest URL must be HTTP(S), without credentials, query, fragment or control characters');
  const rawPath = value.replace(/^[a-z]+:\/\/[^/]+/i, '');
  assert(rawPath.startsWith('/') && !rawPath.endsWith('/'), 'Manifest URL must identify a JSON file');
  safeRelative(rawPath.slice(1), 'manifest path');
  return url;
}
export function resolveShardUrl(manifestUrl, href) {
  const base = entryUrl(manifestUrl);
  safeRelative(href, 'shard href');
  const root = new URL('.', base);
  const resolved = new URL(href, base);
  assert(resolved.origin === root.origin && resolved.pathname.startsWith(root.pathname) && !resolved.username && !resolved.password, 'Shard URL escapes catalog publication scope');
  return resolved.href;
}

function provenance(value, at, reference) {
  obj(value, at);
  oneOf(value.role, ['github', 'community', 'maintainer', 'editor', 'automatic'], `${at}.role`);
  oneOf(value.review, ['pending', 'reviewed', 'disputed', 'stale'], `${at}.review`);
  https(value.url, `${at}.url`); date(value.observed_at, `${at}.observed_at`);
  if (value.source_id !== undefined) reference(value.source_id, ['source_repository'], `${at}.source_id`);
  if (value.actor_id !== undefined) reference(value.actor_id, ['actor'], `${at}.actor_id`);
  optional(value, 'path', repositoryPath, at);
  optional(value, 'commit', (v, location) => pattern(v, commitPattern, location), at);
  assert(!(value.path || value.commit) || value.source_id, `${at}: path/commit evidence requires source_id`);
  optional(value, 'scope', text, at); optional(value, 'method', text, at);
}
function evidence(value, at, reference) { const values = array(value, at); assert(values.length > 0, `${at}: missing evidence`); values.forEach((item, n) => provenance(item, `${at}[${n}]`, reference)); }
function license(value, at) {
  obj(value, at); oneOf(value.status, ['unknown', 'identified', 'conflicting'], `${at}.status`);
  optional(value, 'url', https, at); optional(value, 'path', repositoryPath, at);
  optional(value, 'commit', (v, location) => pattern(v, commitPattern, location), at);
  for (const key of ['spdx_id', 'name', 'conditions']) optional(value, key, text, at);
  assert(value.status !== 'unknown' || (!value.spdx_id && !value.name), `${at}: unknown license cannot identify a license`);
  assert(value.status !== 'identified' || ((value.spdx_id || value.name) && value.url), `${at}: identified license requires name and URL`);
}
function sourceRefs(value, at, reference) {
  const refs = array(value, at); assert(refs.length > 0, `${at}: at least one source required`);
  refs.forEach((item, n) => {
    const location = `${at}[${n}]`; obj(item, location);
    reference(item.source_id, ['source_repository'], location);
    oneOf(item.role, ['primary', 'documentation', 'implementation', 'data', 'evidence', 'related'], `${location}.role`);
    optional(item, 'path', repositoryPath, location); optional(item, 'url', https, location); optional(item, 'ref', text, location);
    optional(item, 'commit', (v, p) => pattern(v, commitPattern, p), location);
    optional(item, 'sha256', (v, p) => pattern(v, hashPattern, p), location);
    optional(item, 'resolved_at', date, location);
    assert(!item.resolved_at || item.commit, `${location}: resolved_at requires immutable commit`);
    assert(!item.sha256 || item.commit || item.url, `${location}: checksum has no content locator`);
  });
}

// Public relation semantics are implemented locally so this example stays portable.
function relationKindsAllowed(type, from, to) {
  if (from === 'tombstone' || to === 'tombstone') return true;
  if (type === 'fork_of') return from === 'source_repository' && to === 'source_repository';
  if (type === 'produces') return from === 'project' && to === 'resource';
  if (['authored_by', 'maintained_by', 'curated_by'].includes(type)) return to === 'actor' && from !== 'actor';
  if (type === 'uses') return ['project', 'resource'].includes(from) && ['source_repository', 'resource'].includes(to);
  if (type === 'supersedes') return from === to;
  return true;
}

function validateData(data, generatedAt) {
  const records = new Map();
  const byCollection = new Map();
  for (const name of COLLECTIONS) {
    const local = new Map(); byCollection.set(name, local);
    for (const item of data[name]) {
      obj(item, name); id(item.id, `${name}.id`);
      assert(item.kind === kinds[name], `${name}: incorrect record kind`);
      assert(!local.has(item.id), `${name}: duplicate ID`); local.set(item.id, item);
      if (name !== 'organizations') {
        assert(!records.has(item.id), 'ID occurs in multiple collections or both active and withdrawn'); records.set(item.id, item);
      }
    }
  }
  const reference = (value, allowed, at) => {
    id(value, at); const target = records.get(value);
    assert(target, `${at}: missing reference`);
    assert(target.kind === 'tombstone' || allowed.includes(target.kind), `${at}: wrong reference kind`);
    return target;
  };
  const listRefs = (value, allowed, at) => ids(value, at).forEach(item => reference(item, allowed, at));
  for (const name of COLLECTIONS) for (const item of data[name]) {
    const at = `${name}/${item.id}`;
    if (['sources', 'actors', 'organizations', 'projects', 'resources', 'collections'].includes(name)) {
      text(item.title, `${at}.title`, 500); optional(item, 'description', (v, p) => text(v, p, 20000), at);
      oneOf(item.status, ['candidate', 'listed'], `${at}.status`); date(item.updated_at, `${at}.updated_at`);
      const fields = obj(item.provenance, `${at}.provenance`);
      assert(Object.keys(fields).length <= 1000, `${at}: too many provenance fields`);
      for (const [key, values] of Object.entries(fields)) evidence(values, `${at}.provenance.${key}`, reference);
      assert(fields.title?.length && (!item.description || fields.description?.length), `${at}: title/description lacks provenance`);
    }
    if (name === 'sources' || name === 'actors') {
      assert(item.provider === 'github', `${at}: unsupported provider`); integer(item.provider_id, `${at}.provider_id`, 1);
      assert(item.id === `${name === 'sources' ? 'source' : 'actor'}:github:${item.provider_id}`, `${at}: provider identity mismatch`);
      https(item.canonical_url, `${at}.canonical_url`);
      const canonical = new URL(item.canonical_url);
      const segments = canonical.pathname.split('/').filter(Boolean);
      assert(canonical.hostname === 'github.com' && !canonical.search && !canonical.hash && segments.length === (name === 'sources' ? 2 : 1), `${at}: canonical URL has wrong GitHub shape`);
      array(item.aliases, `${at}.aliases`).forEach(alias => {
        obj(alias, `${at}.aliases`); https(alias.url, `${at}.aliases.url`); date(alias.verified_at, `${at}.aliases.verified_at`);
        assert(alias.provider_id === item.provider_id, `${at}: alias identity mismatch`);
      });
    }
    if (name === 'sources') {
      reference(item.owner_id, ['actor'], `${at}.owner_id`);
      oneOf(item.availability, ['accessible', 'temporarily_unavailable', 'unknown', 'private', 'deleted'], `${at}.availability`);
      assert(item.availability !== 'private', `${at}: private content must be withheld`);
      boolean(item.archived, `${at}.archived`); boolean(item.stale, `${at}.stale`); date(item.observed_at, `${at}.observed_at`); license(item.license, `${at}.license`);
      assert(item.availability !== 'temporarily_unavailable' || item.stale, `${at}: unavailable source must be stale`);
      optional(item, 'homepage', https, at); optional(item, 'latest_commit', (v, p) => pattern(v, commitPattern, p), at);
      if (item.fork_of !== undefined) { reference(item.fork_of, ['source_repository'], `${at}.fork_of`); assert(item.fork_of !== item.id, `${at}: self fork`); }
    } else if (name === 'actors') {
      oneOf(item.account_type, ['user', 'organization'], `${at}.account_type`); text(item.login, `${at}.login`, 100);
    } else if (name === 'organizations') {
      assert(item.id === item.actor_id, `${at}: organization identity differs from actor`);
      assert(byCollection.get('actors').get(item.actor_id)?.account_type === 'organization', `${at}: missing organization actor`);
      listRefs(item.source_ids, ['source_repository'], `${at}.source_ids`); listRefs(item.resource_ids, ['resource'], `${at}.resource_ids`);
      oneOf(item.participation, ['community_indexed', 'maintainer_acknowledged', 'actively_curated'], `${at}.participation`);
      assert(item.participation === 'community_indexed' || data.claims.some(claim => claim.subject_id === item.id && claim.type === 'organization_curation' && claim.status === 'verified'), `${at}: curation lacks separate verified claim`);
    } else if (name === 'projects' || name === 'resources') {
      assert(item.id.startsWith(name === 'projects' ? 'project:' : 'resource:'), `${at}: wrong identity prefix`);
      texts(item.domains, `${at}.domains`, 100); sourceRefs(item.source_refs, `${at}.source_refs`, reference);
      if (name === 'projects') listRefs(item.resource_ids, ['resource'], `${at}.resource_ids`);
      else {
        pattern(item.resource_type, /^[a-z][a-z0-9_-]{0,99}$/, `${at}.resource_type`);
        listRefs(item.project_ids, ['project'], `${at}.project_ids`); license(item.license, `${at}.license`);
        obj(item.runtime, `${at}.runtime`); oneOf(item.runtime.status, ['not_described', 'maintainer_described', 'community_described'], `${at}.runtime.status`);
        optional(item.runtime, 'documentation_url', https, `${at}.runtime`);
        assert(item.runtime.status === 'not_described' || item.runtime.documentation_url, `${at}: described runtime needs documentation`);
        optional(item, 'documentation_url', https, at); optional(item, 'download_url', https, at);
        for (const key of ['inputs', 'outputs', 'conditions']) optional(item, key, texts, at);
      }
    } else if (name === 'collections') {
      assert(item.id.startsWith('collection:'), `${at}: wrong identity prefix`);
      listRefs(item.actor_ids, ['actor'], `${at}.actor_ids`); listRefs(item.item_ids, entityKinds, `${at}.item_ids`); text(item.selection_basis, `${at}.selection_basis`, 5000);
    } else if (name === 'relations') {
      assert(item.id.startsWith('relation:'), `${at}: wrong identity prefix`);
      const from = reference(item.from_id, entityKinds, `${at}.from_id`), to = reference(item.to_id, entityKinds, `${at}.to_id`);
      assert(item.from_id !== item.to_id, `${at}: self relation`);
      oneOf(item.type, ['uses', 'produces', 'references', 'authored_by', 'maintained_by', 'curated_by', 'fork_of', 'derived_from', 'supersedes', 'split_from'], `${at}.type`);
      assert(relationKindsAllowed(item.type, from.kind, to.kind), `${at}: relation endpoint kinds do not match its meaning`);
      evidence(item.evidence, `${at}.evidence`, reference); date(item.recorded_at, `${at}.recorded_at`);
      optional(item, 'commit', (v, p) => pattern(v, commitPattern, p), at);
    } else if (name === 'claims') {
      assert(item.id.startsWith('claim:'), `${at}: wrong identity prefix`);
      reference(item.subject_id, entityKinds, `${at}.subject_id`); reference(item.actor_id, ['actor'], `${at}.actor_id`);
      oneOf(item.type, ['maintainership', 'organization_curation', 'capability', 'execution_evidence', 'scientific_validation'], `${at}.type`);
      oneOf(item.status, ['unverified', 'verified', 'disputed', 'revoked', 'expired'], `${at}.status`);
      text(item.scope, `${at}.scope`, 2000); evidence(item.evidence, `${at}.evidence`, reference); date(item.recorded_at, `${at}.recorded_at`);
      const conditions = array(item.recheck_on, `${at}.recheck_on`); assert(conditions.length > 0, `${at}: missing recheck conditions`);
      conditions.forEach(value => oneOf(value, ['transfer', 'rename', 'permission_change', 'evidence_expiry', 'dispute'], `${at}.recheck_on`));
      optional(item, 'verified_at', date, at); optional(item, 'expires_at', date, at);
      if (item.verified_by !== undefined) reference(item.verified_by, ['actor'], `${at}.verified_by`);
      if (item.authority !== undefined) oneOf(item.authority, ['repository_maintainer', 'organization_owner', 'delegated_by_owner'], `${at}.authority`);
      if (item.status === 'verified') {
        assert(item.verified_at && item.verified_by && item.evidence.some(v => v.review === 'reviewed'), `${at}: verified claim lacks review evidence`);
        if (item.type === 'organization_curation') oneOf(item.authority, ['organization_owner', 'delegated_by_owner'], `${at}.authority`);
        if (item.type === 'maintainership') oneOf(item.authority, ['repository_maintainer', 'organization_owner', 'delegated_by_owner'], `${at}.authority`);
        assert(!item.expires_at || Date.parse(item.expires_at) > Date.parse(item.verified_at), `${at}: invalid claim expiry`);
        // A consumer must not silently present already-expired evidence as currently verified.
        assert(!item.expires_at || Date.parse(item.expires_at) > Date.parse(generatedAt), `${at}: expired verified claim in snapshot`);
      }
      if (item.type === 'organization_curation') assert(byCollection.get('actors').get(item.subject_id)?.account_type === 'organization', `${at}: curation target is not organization`);
    } else if (name === 'tombstones') {
      const allowed = ['kind', 'id', 'status', 'withdrawn_at', 'replacement_id', 'reason'];
      assert(Object.keys(item).every(key => allowed.includes(key)), `${at}: tombstone contains non-minimal fields`);
      oneOf(item.status, ['withdrawn', 'superseded'], `${at}.status`); date(item.withdrawn_at, `${at}.withdrawn_at`);
      if (item.reason !== undefined) oneOf(item.reason, ['withdrawn', 'unavailable', 'merged', 'policy'], `${at}.reason`);
      if (item.replacement_id !== undefined) reference(item.replacement_id, entityKinds, `${at}.replacement_id`);
      assert(item.status !== 'superseded' || item.replacement_id, `${at}: missing replacement`);
      const visited = new Set([item.id]); let cursor = item.replacement_id;
      while (cursor) { assert(!visited.has(cursor), `${at}: cyclic replacement`); visited.add(cursor); cursor = byCollection.get('tombstones').get(cursor)?.replacement_id; }
    }
  }
  return records;
}

async function fetchBytes(url, limit, fetcher, timeoutMs) {
  let response;
  try { response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) }); }
  catch { throw new CatalogError('Catalog request failed; no partial or cached snapshot was accepted'); }
  assert(response.status === 200 && !response.redirected, 'Catalog response must be an unredirected HTTP 200');
  assert(!response.url || response.url === url, 'Catalog response URL changed');
  const declared = response.headers.get('content-length');
  if (declared !== null) assert(/^\d+$/.test(declared) && Number(declared) <= limit, 'Catalog response exceeds byte budget');
  assert(response.body, 'Catalog response is empty');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new CatalogError('Catalog response exceeds byte budget'); }
      chunks.push(Buffer.from(value));
    }
  } catch (error) { if (error instanceof CatalogError) throw error; throw new CatalogError('Catalog body was interrupted'); }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
function parse(bytes, at) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new CatalogError(`${at}: invalid UTF-8 JSON`); }
}

/** Read and validate one complete v1 snapshot. No environment variables, credentials, disk cache, or source requests are used. */
export async function loadCatalog(manifestUrl, options = {}) {
  const entry = entryUrl(manifestUrl).href;
  const limits = { ...defaults, ...options.limits };
  for (const [key, value] of Object.entries(limits)) integer(value, `limits.${key}`, 1);
  const fetcher = options.fetch ?? globalThis.fetch;
  const manifestBytes = await fetchBytes(entry, Math.min(limits.manifestBytes, limits.totalBytes), fetcher, limits.timeoutMs);
  const manifest = obj(parse(manifestBytes, 'manifest'), 'manifest');
  pattern(manifest.contract_version, versionPattern, 'manifest.contract_version');
  pattern(manifest.snapshot_id, /^[a-z0-9][a-z0-9._-]{0,127}$/, 'manifest.snapshot_id');
  date(manifest.generated_at, 'manifest.generated_at'); obj(manifest.collections, 'manifest.collections');
  const data = Object.fromEntries(COLLECTIONS.map(name => [name, []]));
  const descriptors = []; const hrefs = new Set(); let declaredTotal = manifestBytes.length;
  for (const name of COLLECTIONS) for (const part of array(manifest.collections[name], `manifest.collections.${name}`)) {
    obj(part, `${name}.descriptor`); integer(part.bytes, `${name}.bytes`);
    pattern(part.sha256, hashPattern, `${name}.sha256`);
    if (part.count !== undefined) integer(part.count, `${name}.count`);
    const url = resolveShardUrl(entry, part.href);
    assert(!hrefs.has(url), 'Duplicate shard URL'); hrefs.add(url);
    declaredTotal += part.bytes;
    assert(part.bytes <= limits.shardBytes && declaredTotal <= limits.totalBytes && descriptors.length < limits.shards, 'Catalog manifest exceeds download budget');
    descriptors.push({ name, part, url });
  }
  const taxonomyParts = manifest.taxonomies === undefined ? [] : array(manifest.taxonomies,'manifest.taxonomies');
  assert(taxonomyParts.length <= 16,'Too many taxonomies');
  const taxonomyKeys = new Set();
  for (const part of taxonomyParts) {
    obj(part,'taxonomy descriptor'); text(part.scheme,'taxonomy.scheme',100); text(part.version,'taxonomy.version',100);
    if (part.revision !== undefined) text(part.revision,'taxonomy.revision',100);
    integer(part.bytes,'taxonomy.bytes',1); pattern(part.sha256,hashPattern,'taxonomy.sha256');
    assert(part.href === `taxonomies/${part.sha256}.json`,'Invalid taxonomy path');
    const key = JSON.stringify([part.scheme,part.version]), url = resolveShardUrl(entry,part.href);
    assert(!taxonomyKeys.has(key) && !hrefs.has(url),'Duplicate taxonomy descriptor'); taxonomyKeys.add(key); hrefs.add(url);
    declaredTotal += part.bytes; assert(part.bytes <= 1048576 && declaredTotal <= limits.totalBytes,'Taxonomy download budget exceeded');
  }
  const taxonomies = [];
  for (const part of taxonomyParts) {
    const bytes = await fetchBytes(resolveShardUrl(entry,part.href),part.bytes,fetcher,limits.timeoutMs);
    assert(bytes.length === part.bytes && createHash('sha256').update(bytes).digest('hex') === part.sha256,'Taxonomy bytes or hash mismatch');
    const value = parse(bytes,'taxonomy'); validateTaxonomy(value,part); taxonomies.push(value);
  }
  let totalRecords = 0;
  for (const { name, part, url } of descriptors) {
    const bytes = await fetchBytes(url, Math.min(part.bytes, limits.shardBytes), fetcher, limits.timeoutMs);
    assert(bytes.length === part.bytes, 'Shard byte length mismatch');
    assert(createHash('sha256').update(bytes).digest('hex') === part.sha256, 'Shard SHA-256 mismatch');
    const shard = obj(parse(bytes, 'shard'), 'shard');
    assert(shard.contract_version === manifest.contract_version && shard.snapshot_id === manifest.snapshot_id && shard.collection === name, 'Shard version, snapshot or collection mismatch');
    const records = array(shard.records, `${name}.records`);
    assert(part.count === undefined || part.count === records.length, 'Shard record count mismatch');
    totalRecords += records.length; assert(totalRecords <= limits.records, 'Catalog record budget exceeded');
    data[name].push(...records);
  }
  const records = validateData(data, manifest.generated_at);
  validateClassification(data,taxonomies);
  const listResources = (query = '') => {
    assert(typeof query === 'string', 'Resource query must be text'); const term = query.normalize('NFKC').toLowerCase();
    return data.resources.filter(item => item.status === 'listed' && (!term || `${item.title} ${item.description ?? ''} ${item.domains.join(' ')} ${taxonomySearch(item,taxonomies)}`.normalize('NFKC').toLowerCase().includes(term)));
  };
  return {
    manifest, taxonomies, collections: data,
    get: value => records.get(value),
    listResources,
    locateResource(value) {
      const item = records.get(value);
      if (!item) return { id: value, status: 'not_found' };
      if (item.kind === 'tombstone') return { id: item.id, status: item.status, ...(item.replacement_id ? { replacement_id: item.replacement_id } : {}) };
      assert(item.kind === 'resource', 'Requested ID is not a resource');
      return { id: item.id, status: item.status, sources: item.source_refs.map(ref => {
        const source = records.get(ref.source_id);
        if (source.kind === 'tombstone') return { source_id: ref.source_id, availability: 'withdrawn', version: { status: 'unavailable' } };
        const content_url = ref.commit ? `${source.canonical_url.replace(/\/+$/, '')}/tree/${ref.commit}${ref.path ? `/${ref.path.split('/').map(encodeURIComponent).join('/')}` : ''}` : ref.url && ref.sha256 ? ref.url : undefined;
        return { source_id: source.id, canonical_url: source.canonical_url, availability: source.availability,
          version: { status: ref.commit || (ref.url && ref.sha256) ? 'fixed' : 'unfixed', ...(content_url ? { content_url } : {}), ...(ref.commit ? { basis: 'commit', commit: ref.commit } : ref.url && ref.sha256 ? { basis: 'content_checksum' } : {}), ...(ref.path ? { path: ref.path } : {}), ...(ref.ref ? { ref: ref.ref } : {}), ...(ref.sha256 ? { sha256: ref.sha256 } : {}), ...(ref.url ? { url: ref.url } : {}) } };
      }) };
    },
  };
}

// v1.2 optional dictionaries. Integrity and total budgets are checked before interpretation.
function validateTaxonomy(value, part) {
  obj(value, 'taxonomy');
  assert(value.scheme === part.scheme && value.version === part.version && (part.revision === undefined || value.revision === part.revision), 'Taxonomy identity mismatch');
  if (part.scheme === 'oecd-ford' && part.version === '2015') {
    const expected = new Set(); [7,11,5,5,9,5].forEach((n,i) => { expected.add(String(i+1)); for (let j=1;j<=n;j++) expected.add(`${i+1}.${j}`); });
    const seen = new Set();
    for (const field of array(value.fields,'taxonomy.fields')) {
      obj(field,'field'); assert(expected.has(field.code) && !seen.has(field.code), 'Invalid or duplicate FORD code'); seen.add(field.code);
      const parent = field.code.includes('.') ? field.code.split('.')[0] : null;
      assert(field.parent_code === parent && field.level === (parent ? 2 : 1), 'Invalid FORD hierarchy');
      text(field.label_en,'field.label_en',2000); text(field.label_zh,'field.label_zh',2000);
    }
    assert(seen.size === expected.size, 'Incomplete FORD dictionary');
  }
  if (part.scheme === 'aipoch-research-tags' && part.version === '1') {
    const seen = new Set(), names = new Map();
    for (const tag of array(value.tags,'taxonomy.tags')) {
      obj(tag,'tag'); pattern(tag.id,/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,'tag.id');
      assert(!seen.has(tag.id),'Duplicate research tag'); seen.add(tag.id);
      oneOf(tag.category,['method','task','topic'],'tag.category'); text(tag.description,'tag.description',2000);
      text(tag.label_en,'tag.label_en',2000); text(tag.label_zh,'tag.label_zh',2000); texts(tag.aliases,'tag.aliases');
      for (const name of [tag.id,tag.label_en,tag.label_zh,...tag.aliases]) {
        const key = name.normalize('NFKC').trim().toLowerCase(); assert(!names.has(key) || names.get(key) === tag.id,'Ambiguous research tag alias'); names.set(key,tag.id);
      }
    }
    assert(seen.size > 0,'Empty research tag dictionary');
  }
}
function validateClassification(data, dictionaries) {
  for (const row of [...data.projects,...data.resources]) for (const field of ['classification','research_tags']) {
    if (row[field] === undefined) continue;
    const value = obj(row[field],field); text(value.scheme,`${field}.scheme`,100); text(value.version,`${field}.version`,100);
    const values = array(value[field === 'classification' ? 'codes' : 'ids'],field); texts(values,field,100);
    assert(values.length <= 100 && new Set(values).size === values.length,'Duplicate or excessive classification values');
    assert(row.provenance[field]?.length,'Classification requires field provenance');
    assert(row.provenance[field].every(evidence => !evidence.source_id || row.source_refs.some(ref => ref.source_id === evidence.source_id)), 'Classification evidence is not an entry source');
    const dictionary = dictionaries.find(item => item.scheme === value.scheme && item.version === value.version);
    assert(dictionary,'Missing snapshot taxonomy');
    if (field === 'classification' && value.scheme === 'oecd-ford' && value.version === '2015') {
      assert(values.every(code => dictionary.fields.some(item => item.code === code && item.level === 2)),'Unknown FORD leaf code');
      if (!values.length) text(value.unclassified_reason,'unclassified_reason',2000);
      else assert(value.unclassified_reason === undefined,'Classified entry cannot have unclassified reason');
    }
    if (field === 'research_tags' && value.scheme === 'aipoch-research-tags' && value.version === '1') assert(values.every(id => dictionary.tags.some(tag => tag.id === id)),'Unknown research tag');
  }
}
function taxonomySearch(row, dictionaries) {
  const terms = [];
  const field = row.classification, tags = row.research_tags;
  for (const dictionary of dictionaries) {
    if (field?.scheme === 'oecd-ford' && field.version === '2015' && dictionary.scheme === field.scheme && dictionary.version === field.version) for (const item of dictionary.fields) if (field.codes.some(code => code === item.code || code.split('.')[0] === item.code)) terms.push(item.code,item.label_en,item.label_zh);
    if (tags?.scheme === 'aipoch-research-tags' && tags.version === '1' && dictionary.scheme === tags.scheme && dictionary.version === tags.version) for (const item of dictionary.tags) if (tags.ids.includes(item.id)) terms.push(item.id,item.label_en,item.label_zh,...item.aliases);
  }
  return terms.join(' ');
}
