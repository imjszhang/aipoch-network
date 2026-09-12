import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFixtureCatalog, fixtureEvidence, FIXTURE_COMMIT, FIXTURE_TIME } from '../fixtures/catalog.js';
import { actorId, assertValidCatalog, COLLECTION_NAMES, entityId, isSafeRelativePath, normalizeGitHubUrl, resolveCatalogHref, resourceTypeLabel, sourceId, validateCatalog, validateEnhancement, validateManifest, validateShard } from '../index.js';
import type { CatalogManifest } from '../types.js';
import { catalogSchema, enhancementSchema, manifestSchema, shardSchema } from '../schema.js';

test('URL-only intake accepts repository, organization, and concrete paths without requiring metadata', () => {
  assert.deepEqual(normalizeGitHubUrl(' https://github.com/Example-Lab/Research.git?tab=readme-ov-file#readme '), { kind: 'repository', provider: 'github', owner: 'example-lab', repository: 'research', canonical_url: 'https://github.com/example-lab/research', requires_resolution: true });
  assert.equal(normalizeGitHubUrl('https://github.com/orgs/example-lab/repositories').kind, 'organization');
  assert.deepEqual(normalizeGitHubUrl('https://github.com/example-lab/research/blob/feature/update/data/file.csv').location, { type: 'blob', ref_and_path: 'feature/update/data/file.csv' });
  const data = createFixtureCatalog();
  data.sources[0]!.description = undefined;
  assert.equal(validateCatalog(data).ok, true);
  assert.equal(data.sources[0]!.license.status, 'unknown');
  assert.equal(data.sources[0]!.default_branch, undefined);
});

test('intake rejects credential, host, route, and encoding ambiguity instead of inventing an identity', () => {
  for (const value of ['http://github.com/a/b', 'https://user:secret@github.com/a/b', 'https://github.com/a/b?access_token=secret', 'https://github.com.evil.example/a/b', 'https://github.com/search', 'https://github.com/a/b/issues/1', 'https://github.com/a/b/../../other', 'https://github.com/a/%2E%2E', 'https://github.com/a/b/tree/%252e%252e', 'javascript:alert(1)', 'https://github.com/a/b%2Fc']) {
    assert.throws(() => normalizeGitHubUrl(value), value);
  }
});

test('provider identity survives transfers; reused names and forks remain separate', () => {
  const data = createFixtureCatalog();
  const original = data.sources[0]!;
  original.aliases.push({ url: original.canonical_url, verified_at: FIXTURE_TIME, provider_id: 201 });
  original.canonical_url = 'https://github.com/other-lab/new-name';
  assert.equal(original.id, sourceId(201));
  assert.notEqual(sourceId(201), sourceId(999));
  data.sources.push({ ...structuredClone(original), id: sourceId(999), provider_id: 999, canonical_url: 'https://github.com/example-lab/research', aliases: [], fork_of: original.id });
  assertValidCatalog(data);
  data.sources[2]!.aliases = original.aliases;
  assert.match(validateCatalog(data).errors.join('\n'), /alias identity/);
  assert.throws(() => sourceId(Number.MAX_SAFE_INTEGER + 1));
  assert.throws(() => actorId(0));
  assert.equal(entityId('project', 'stable-001'), 'project:stable-001');
});

test('graph preserves many resources per repository and multiple source repositories per project', () => {
  const data = createFixtureCatalog();
  assertValidCatalog(data);
  assert.equal(data.resources.filter(resource => resource.source_refs.some(ref => ref.source_id === sourceId(201))).length, 2);
  assert.equal(data.projects[0]!.source_refs.length, 2);
  data.resources[0]!.source_refs[0]!.source_id = 'source:github:999';
  assert.match(validateCatalog(data).errors.join('\n'), /missing reference source:github:999/);
});

test('relation kinds preserve project outputs, authorship, and repository fork meanings', () => {
  const data = createFixtureCatalog();
  data.relations[0].type = 'fork_of';
  assert.match(validateCatalog(data).errors.join('\n'), /endpoint kinds/);
  data.relations[0].type = 'authored_by';
  assert.match(validateCatalog(data).errors.join('\n'), /endpoint kinds/);
  data.relations[0].to_id = 'actor:github:102';
  assertValidCatalog(data);
  data.relations[0].type = 'fork_of';
  data.relations[0].from_id = 'source:github:202';
  data.relations[0].to_id = 'source:github:201';
  assertValidCatalog(data);
});

test('field provenance preserves competing scopes; missing attribution is rejected', () => {
  const data = createFixtureCatalog();
  data.resources[0]!.provenance.description!.push({ ...fixtureEvidence('maintainer'), review: 'disputed', scope: 'Only commit ' + FIXTURE_COMMIT });
  assertValidCatalog(data);
  assert.equal(data.resources[0]!.provenance.description!.length, 2);
  delete data.resources[0]!.provenance.description;
  assert.match(validateCatalog(data).errors.join('\n'), /description must have provenance/);
});

test('organization claims require separate owner authority; community indexing stays unendorsed', () => {
  const data = createFixtureCatalog();
  data.organizations[0]!.participation = 'actively_curated';
  assert.match(validateCatalog(data).errors.join('\n'), /separately verified/);
  data.claims.push({ kind: 'claim', id: 'claim:org-curation', subject_id: actorId(101), actor_id: actorId(102), type: 'organization_curation', status: 'verified', scope: 'Selected repository list only', evidence: [fixtureEvidence()], recorded_at: FIXTURE_TIME, verified_at: FIXTURE_TIME, verified_by: actorId(102), authority: 'repository_maintainer', recheck_on: ['permission_change', 'dispute'] });
  assert.match(validateCatalog(data).errors.join('\n'), /owner authority/);
  data.claims[1]!.authority = 'delegated_by_owner';
  assertValidCatalog(data);
  data.claims[1]!.verified_at = undefined;
  assert.match(validateCatalog(data).errors.join('\n'), /reviewer, time/);
});

test('unknown licenses do not block discovery or become automatic grants', () => {
  const data = createFixtureCatalog();
  assertValidCatalog(data);
  data.resources[0]!.license.spdx_id = 'MIT';
  assert.match(validateCatalog(data).errors.join('\n'), /unknown license/);
  data.resources[0]!.license = { status: 'identified', spdx_id: 'MIT' };
  assert.match(validateCatalog(data).errors.join('\n'), /source URL/);
  data.resources[0]!.license.url = 'https://github.com/example-lab/research/blob/main/LICENSE';
  assertValidCatalog(data);
});

test('immutable commit references remain distinct from mutable branches and tags', () => {
  const data = createFixtureCatalog();
  assert.equal(data.resources[0]!.source_refs[0]!.commit, FIXTURE_COMMIT);
  assert.equal(data.resources[1]!.source_refs[0]!.commit, undefined);
  data.sources[0]!.latest_commit = 'a'.repeat(40);
  assertValidCatalog(data);
  assert.equal(data.resources[0]!.source_refs[0]!.commit, FIXTURE_COMMIT);
  data.resources[0]!.source_refs[0]!.commit = 'main';
  assert.equal(validateCatalog(data).ok, false);
});

test('source paths allow ordinary file names while forbidding traversal', () => {
  const data = createFixtureCatalog();
  data.resources[0]!.source_refs[0]!.path = '研究说明/experiment notes.md';
  assertValidCatalog(data);
  for (const path of ['../secret', 'docs/../../secret', '/etc/passwd', 'docs\\secret', 'docs/%2e%2e/secret']) {
    data.resources[0]!.source_refs[0]!.path = path;
    assert.equal(validateCatalog(data).ok, false, path);
  }
});

test('unknown optional fields and new resource classifications are compatible, unknown safety states fail closed', () => {
  const data = createFixtureCatalog();
  data.resources[0]!.resource_type = 'future-kind';
  Object.assign(data.resources[0]!, { future_optional_field: { anything: true } });
  assertValidCatalog(data);
  assert.equal(resourceTypeLabel('future-kind'), 'Other resource');
  Object.assign(data.sources[0]!, { availability: 'probably-safe' });
  assert.equal(validateCatalog(data).ok, false);
});

test('optional source collaboration fields preserve older records and validate public HTTPS URLs', () => {
  const data = createFixtureCatalog();
  assert.equal(data.sources[0]!.collaboration, undefined);
  assertValidCatalog(data);
  data.sources[0]!.collaboration = {
    issues_url: `${data.sources[0]!.canonical_url}/issues`,
    discussions_url: `${data.sources[0]!.canonical_url}/discussions`,
  };
  assertValidCatalog(data);
  for (const unsafe of ['http://github.com/example-lab/research/issues', 'javascript:alert(1)', 'https://github.com/example-lab/research/issues?token=secret', 'https://user:secret@github.com/example-lab/research/discussions']) {
    data.sources[0]!.collaboration.issues_url = unsafe;
    assert.equal(validateCatalog(data).ok, false, unsafe);
  }
});

test('temporary failure must be stale; private content cannot remain in a public record', () => {
  const data = createFixtureCatalog();
  data.sources[0]!.availability = 'temporarily_unavailable';
  assert.match(validateCatalog(data).errors.join('\n'), /marked stale/);
  data.sources[0]!.stale = true;
  assertValidCatalog(data);
  data.sources[0]!.availability = 'private';
  assert.match(validateCatalog(data).errors.join('\n'), /minimal tombstone/);
});

test('tombstones protect removed content and detect replacement cycles', () => {
  const data = createFixtureCatalog();
  Object.assign(data.tombstones[0]!, { description: 'must never survive removal' });
  assert.equal(validateCatalog(data).ok, false);
  data.tombstones = [{ kind: 'tombstone', id: 'resource:old-a', status: 'superseded', withdrawn_at: FIXTURE_TIME, replacement_id: 'resource:old-b' }, { kind: 'tombstone', id: 'resource:old-b', status: 'superseded', withdrawn_at: FIXTURE_TIME, replacement_id: 'resource:old-a' }];
  assert.match(validateCatalog(data).errors.join('\n'), /cyclic replacement chain/);
});

function manifest(): CatalogManifest {
  return { contract_version: '1.0.0', snapshot_id: 'example-snapshot', generated_at: FIXTURE_TIME, collections: Object.fromEntries(COLLECTION_NAMES.map(name => [name, [{ href: `snapshots/example-snapshot/${name}-0.json`, sha256: 'a'.repeat(64), bytes: 100, count: 0 }]])) as CatalogManifest['collections'] };
}
test('manifest references work under a Pages subpath and reject traversal and cross-origin loads', () => {
  assert.equal(validateManifest(manifest()).ok, true);
  assert.equal(resolveCatalogHref('https://example.test/aipoch-network/catalog/v1/manifest.json', 'snapshots/example/resources.json', 'https://example.test/aipoch-network/catalog/v1/'), 'https://example.test/aipoch-network/catalog/v1/snapshots/example/resources.json');
  for (const href of ['../secret.json', '%2e%2e/secret.json', '%252e%252e/secret.json', '/root.json', '//evil.test/a.json', 'https://evil.test/a.json', 'a\\b.json', 'a.json?token=secret', 'a.json#fragment']) {
    assert.equal(isSafeRelativePath(href), false, href);
    const bad = manifest(); bad.collections.resources[0]!.href = href;
    assert.equal(validateManifest(bad).ok, false, href);
  }
  assert.throws(() => resolveCatalogHref('https://evil.test/manifest.json', 'safe.json', 'https://example.test/catalog/v1/'));
  const duplicate = manifest(); duplicate.collections.projects[0]!.href = duplicate.collections.resources[0]!.href;
  assert.equal(validateManifest(duplicate).ok, false);
});

test('shards are self describing and reject cross-kind records, duplicate IDs, and unsupported major versions', () => {
  const shard = { contract_version: '1.0.0', snapshot_id: 'snapshot-001', collection: 'resources', records: createFixtureCatalog().resources };
  assert.equal(validateShard(shard).ok, true);
  assert.equal(validateShard({ ...shard, contract_version: '2.0.0' }).ok, false);
  assert.equal(validateShard({ ...shard, collection: 'sources' }).ok, false);
  assert.equal(validateShard({ ...shard, records: [shard.records[0], shard.records[0]] }).ok, false);
  assert.equal(validateManifest({ ...manifest(), generated_at: '2026-02-30T00:00:00Z' }).ok, false);
});

test('optional enrichment failure does not alter validity of the base source URL', () => {
  const source_url = 'https://github.com/example-lab/research';
  const good = { contract_version: '1.0.0', source_url, resources: createFixtureCatalog().resources };
  assert.equal(validateEnhancement(good).ok, true);
  assert.equal(validateEnhancement({ ...good, resources: [{ title: 'broken incomplete resource' }] }).ok, false);
  assert.equal(normalizeGitHubUrl(source_url).canonical_url, source_url);
  assert.equal(validateEnhancement({ ...good, source_url: 'https://github.com/example-lab' }).ok, false);
});

test('portable JSON schemas and synthetic fixture stay in sync with the actual contract', async () => {
  for (const [name, schema] of Object.entries({ catalog: catalogSchema, manifest: manifestSchema, shard: shardSchema, enhancement: enhancementSchema })) {
    const exported = JSON.parse(await readFile(new URL(`../schema/${name}.schema.json`, import.meta.url), 'utf8'));
    assert.deepEqual(exported, schema, `Re-export ${name}.schema.json after changing the contract`);
  }
  const fixture = JSON.parse(await readFile(new URL('../fixtures/catalog.json', import.meta.url), 'utf8'));
  assert.deepEqual(fixture, createFixtureCatalog());
  assertValidCatalog(fixture);
});
