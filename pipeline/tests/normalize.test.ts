import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, type SnapshotBatch } from '../normalize.js';
import type { SourceSnapshot } from '../github.js';
import type { Registry } from '../registry.js';
import { validateCatalog } from '../../spec/index.js';
import type { Actor, Claim } from '../../spec/types.js';

const NOW = '2026-09-12T08:00:00.000Z';
const A = 'https://github.com/lab/methods';
const B = 'https://github.com/lab/data';
const OLD_A = 'https://github.com/old-lab/old-methods';
const SHA = 'a'.repeat(40);
function snapshot(url: string, id: number, overrides: Partial<SourceSnapshot> = {}): SourceSnapshot {
  return {
    requested_url: url, checked_at: NOW, observed_at: NOW, availability: 'accessible', suppressed: false,
    repository: {
      id, name: url.split('/').at(-1)!, full_name: url.split('/').slice(-2).join('/'), html_url: url,
      description: `Upstream public summary ${id}`, default_branch: 'main', archived: false, fork: false,
      owner: { id: 90, login: 'lab', type: 'Organization', html_url: 'https://github.com/lab' },
      topics: ['science'], language: 'Python', license: { spdx_id: 'MIT', url: `${url}/blob/${SHA}/COPYING` },
      updated_at: NOW, has_issues: true, has_discussions: false, commit: SHA,
      readme: `README_MARKER_${id}`,
    }, ...overrides,
  };
}
function fixture(): { registry: Registry; batch: SnapshotBatch } {
  return {
    registry: {
      version: 1,
      sources: [A, B].map(url => ({ url, reviewed_at: NOW, review_note: 'Synthetic public test source.' })),
      resources: [
        { key: 'workflow', title: 'Analysis workflow', description: 'Editor-reviewed workflow summary.', type: 'workflow', domains: ['Biostatistics'], sources: [A], inputs: ['Cohort'], outputs: ['Report'] },
        { key: 'tool', title: 'Sensitivity tool', type: 'tool', domains: ['Clinical research'], sources: [A] },
        { key: 'data', title: 'Research dataset', type: 'dataset', domains: ['Data science'], sources: [B] },
      ],
      projects: [
        { key: 'joint', title: 'Cross-repository study', description: 'Editor-reviewed project summary.', domains: ['Clinical research'], sources: [A, B], resources: ['workflow', 'tool', 'data'] },
        { key: 'data', title: 'Dataset validation', domains: ['Data science'], sources: [B], resources: ['data'] },
      ],
      collections: [{ key: 'clinical', title: 'Clinical collection', description: 'Selected public studies.', selection_basis: 'Human curation for method diversity.', item_ids: ['project:joint', 'resource:workflow', 'resource:data'] }],
      withdrawals: [],
    },
    batch: { as_of: NOW, sources: [snapshot(A, 101), snapshot(B, 102)] },
  };
}

test('separate research entities preserve one-to-many and many-to-many repository relationships', () => {
  const { registry, batch } = fixture();
  const catalog = normalize(registry, batch).catalog;
  assert.equal(catalog.sources.length, 2);
  assert.equal(catalog.resources.length, 3);
  assert.equal(catalog.projects.length, 2);
  assert.deepEqual(catalog.projects.find(row => row.id === 'project:joint')?.source_refs.map(ref => ref.source_id), ['source:github:101', 'source:github:102']);
  assert.deepEqual(catalog.projects.find(row => row.id === 'project:joint')?.resource_ids, ['resource:workflow', 'resource:tool', 'resource:data']);
  assert.deepEqual(catalog.resources.find(row => row.id === 'resource:data')?.project_ids, ['project:joint', 'project:data']);
  assert.equal(catalog.resources.find(row => row.id === 'resource:workflow')?.source_refs[0]?.commit, SHA);
  assert.equal(catalog.actors.length, 1);
  assert.equal(catalog.organizations.length, 1);
  assert.equal(catalog.organizations[0]?.participation, 'community_indexed');
  assert.equal(catalog.claims.length, 0, 'indexing must not manufacture maintainer or scientific claims');
});

test('curated collections have field provenance and the entire normalized catalog meets its public contract', () => {
  const { registry, batch } = fixture();
  const catalog = normalize(registry, batch).catalog;
  const check = validateCatalog(catalog);
  assert.equal(check.ok, true, check.errors.join('\n'));
  const collection = catalog.collections[0]!;
  assert.ok(collection.provenance.title?.length);
  assert.ok(collection.provenance.description?.length);
  assert.ok(collection.provenance.title?.every(item => item.role === 'editor' || item.role === 'community'));
});

test('editor descriptions survive source refresh and remain distinguished from upstream claims', () => {
  const { registry, batch } = fixture();
  const input = JSON.stringify({ registry, batch });
  const before = normalize(registry, batch).catalog;
  assert.equal(JSON.stringify({ registry, batch }), input, 'normalization must leave authoritative inputs unchanged');
  const changed = structuredClone(batch);
  changed.sources[0]!.repository!.description = 'An upstream rewrite with different wording.';
  changed.sources[0]!.repository!.commit = 'b'.repeat(40);
  const after = normalize(registry, changed).catalog;
  assert.notEqual(before.sources[0]?.description, after.sources[0]?.description);
  assert.equal(after.projects.find(row => row.id === 'project:joint')?.description, 'Editor-reviewed project summary.');
  assert.equal(after.resources.find(row => row.id === 'resource:workflow')?.description, 'Editor-reviewed workflow summary.');
  assert.ok(after.projects.find(row => row.id === 'project:joint')?.provenance.description?.every(item => item.role === 'editor'));
  assert.ok(after.sources[0]?.provenance.description?.every(item => item.role === 'github'));
});

test('confirmed aliases collapse to one GitHub identity, including references through both addresses', () => {
  const { registry, batch } = fixture();
  registry.sources.push({ url: OLD_A, reviewed_at: NOW, review_note: 'Confirmed rename preserving repository ID.' });
  batch.sources.push({ ...snapshot(A, 101), requested_url: OLD_A });
  registry.resources[0]!.sources.push(OLD_A);
  registry.projects[0]!.sources.push(OLD_A);
  const catalog = normalize(registry, batch).catalog;
  assert.equal(catalog.sources.length, 2);
  assert.deepEqual(catalog.sources.find(row => row.id === 'source:github:101')?.aliases, [{ url: OLD_A, verified_at: NOW, provider_id: 101 }]);
  assert.equal(catalog.resources.find(row => row.id === 'resource:workflow')?.source_refs.length, 1);
  assert.equal(catalog.projects.find(row => row.id === 'project:joint')?.source_refs.length, 2);
});

test('a source older than 48 hours is marked stale while its last public content remains usable', () => {
  const { registry, batch } = fixture();
  batch.sources[0]!.observed_at = new Date(Date.parse(NOW) - 49 * 60 * 60 * 1000).toISOString();
  const catalog = normalize(registry, batch).catalog;
  const older = catalog.sources.find(row => row.id === 'source:github:101')!;
  assert.equal(older.stale, true);
  assert.equal(older.readme, 'README_MARKER_101');
  assert.equal(catalog.sources.find(row => row.id === 'source:github:102')?.stale, false);
  assert.ok(catalog.resources.some(row => row.id === 'resource:workflow'));
});

test('temporary failure is visibly stale even before the normal age threshold', () => {
  const { registry, batch } = fixture();
  batch.sources[0]!.availability = 'temporarily_unavailable';
  batch.sources[0]!.error = 'rate_limited';
  const result = normalize(registry, batch);
  assert.equal(result.catalog.sources.find(row => row.id === 'source:github:101')?.stale, true);
  assert.ok(result.catalog.resources.some(row => row.id === 'resource:workflow'));
  assert.ok(result.diagnostics.some(row => row.message.includes('rate_limited')));
});

test('after seven days harvested content and dependent resources are withheld, preserving unrelated sources', () => {
  const { registry, batch } = fixture();
  batch.sources[0]!.observed_at = new Date(Date.parse(NOW) - 8 * 24 * 60 * 60 * 1000).toISOString();
  const result = normalize(registry, batch);
  const old = result.catalog.sources.find(row => row.id === 'source:github:101')!;
  assert.equal(old.stale, true);
  assert.equal(old.description, undefined);
  assert.equal(old.readme, undefined);
  assert.equal(old.latest_commit, undefined);
  assert.equal(old.default_branch, undefined);
  assert.equal(old.license.status, 'unknown');
  assert.deepEqual(result.catalog.resources.map(row => row.id), ['resource:data']);
  assert.deepEqual(result.catalog.projects.map(row => row.id), ['project:data']);
  assert.doesNotMatch(JSON.stringify(result.catalog), /README_MARKER_101|Upstream public summary 101/);
  assert.ok(result.diagnostics.some(row => row.id === old.id && /7 days/.test(row.message)));
});

test('private and suppressed sources are removed with dependent research metadata and minimal tombstones', () => {
  for (const mode of ['private', 'suppressed'] as const) {
    const { registry, batch } = fixture();
    if (mode === 'private') batch.sources[0]!.availability = 'private';
    else batch.sources[0]!.suppressed = true;
    const catalog = normalize(registry, batch).catalog;
    assert.deepEqual(catalog.sources.map(row => row.id), ['source:github:102']);
    assert.deepEqual(catalog.resources.map(row => row.id), ['resource:data']);
    assert.deepEqual(catalog.projects.map(row => row.id), ['project:data']);
    assert.deepEqual(catalog.collections[0]?.item_ids, ['resource:data']);
    assert.deepEqual(catalog.organizations[0]?.source_ids, ['source:github:102']);
    assert.deepEqual(catalog.organizations[0]?.resource_ids, ['resource:data']);
    assert.doesNotMatch(JSON.stringify(catalog), /README_MARKER_101|https:\/\/github.com\/lab\/methods|Editor-reviewed workflow summary/);
    for (const id of ['source:github:101', 'resource:workflow', 'resource:tool', 'project:joint']) {
      const marker = catalog.tombstones.find(row => row.id === id);
      assert.ok(marker, `missing withdrawal marker for ${id}`);
      assert.ok(Object.keys(marker).every(key => ['kind', 'id', 'status', 'withdrawn_at', 'reason', 'replacement_id'].includes(key)));
    }
  }
});

test('a private observation through any confirmed alias suppresses the same source regardless of registry order', () => {
  for (const oldFirst of [false, true]) {
    const { registry, batch } = fixture();
    const alias = { url: OLD_A, reviewed_at: NOW, review_note: 'Verified old URL.' };
    if (oldFirst) registry.sources.unshift(alias); else registry.sources.push(alias);
    batch.sources.push({ ...snapshot(A, 101), requested_url: OLD_A, availability: 'private', suppressed: true });
    const catalog = normalize(registry, batch).catalog;
    assert.ok(!catalog.sources.some(row => row.id === 'source:github:101'));
    assert.ok(catalog.tombstones.some(row => row.id === 'source:github:101'));
    assert.doesNotMatch(JSON.stringify(catalog), /README_MARKER_101/);
    assert.ok(!catalog.resources.some(row => row.id === 'resource:workflow'));
  }
});

test('explicit source and resource withdrawals clean associations without withdrawing unrelated content', () => {
  const sourceFixture = fixture();
  sourceFixture.registry.withdrawals.push({ id: 'source:github:101', withdrawn_at: NOW, reason: 'policy' });
  const sourceCatalog = normalize(sourceFixture.registry, sourceFixture.batch).catalog;
  assert.deepEqual(sourceCatalog.sources.map(row => row.id), ['source:github:102']);
  assert.deepEqual(sourceCatalog.resources.map(row => row.id), ['resource:data']);
  assert.equal(sourceCatalog.tombstones.find(row => row.id === 'source:github:101')?.reason, 'policy');

  const resourceFixture = fixture();
  resourceFixture.registry.withdrawals.push({ id: 'resource:workflow', withdrawn_at: NOW, reason: 'withdrawn' });
  const resourceCatalog = normalize(resourceFixture.registry, resourceFixture.batch).catalog;
  assert.equal(resourceCatalog.sources.length, 2);
  assert.equal(resourceCatalog.projects.length, 2);
  assert.ok(!resourceCatalog.resources.some(row => row.id === 'resource:workflow'));
  assert.ok(!resourceCatalog.projects.some(row => row.resource_ids.includes('resource:workflow')));
  assert.ok(!resourceCatalog.collections.some(row => row.item_ids.includes('resource:workflow')));
});

test('actor withdrawal removes owned sources, research metadata and organizations without dangling owners', () => {
  const { registry, batch } = fixture();
  registry.withdrawals.push({ id: 'actor:github:90', withdrawn_at: NOW, reason: 'policy' });
  const hidden = batch.sources[0]!.repository!;
  hidden.owner.login = 'WITHDRAWN_ACTOR_MARKER';
  hidden.owner.html_url = 'https://github.com/withdrawn-actor-marker';
  hidden.description = 'WITHDRAWN_SOURCE_DESCRIPTION';
  const unrelated = batch.sources[1]!.repository!;
  unrelated.owner = { id: 91, login: 'another-lab', type: 'Organization', html_url: 'https://github.com/another-lab' };
  const result = normalize(registry, batch);
  const { catalog } = result;
  assert.deepEqual(catalog.actors.map(row => row.id), ['actor:github:91']);
  assert.deepEqual(catalog.organizations.map(row => row.id), ['actor:github:91']);
  assert.deepEqual(catalog.sources.map(row => row.id), ['source:github:102']);
  assert.deepEqual(catalog.resources.map(row => row.id), ['resource:data']);
  assert.deepEqual(catalog.projects.map(row => row.id), ['project:data']);
  assert.deepEqual(catalog.collections[0]?.item_ids, ['resource:data']);
  for (const id of ['actor:github:90', 'source:github:101', 'resource:workflow', 'resource:tool', 'project:joint']) assert.ok(catalog.tombstones.some(row => row.id === id), id);
  assert.equal(catalog.tombstones.find(row => row.id === 'actor:github:90')?.reason, 'policy');
  assert.ok(catalog.sources.every(source => catalog.actors.some(actor => actor.id === source.owner_id)));
  assert.doesNotMatch(JSON.stringify(result), /WITHDRAWN_ACTOR_MARKER|withdrawn-actor-marker|WITHDRAWN_SOURCE_DESCRIPTION|README_MARKER_101|Editor-reviewed workflow summary/);
  const validation = validateCatalog(catalog);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
});

test('actor withdrawal suppresses every selected owned repository and leaves only minimal tombstones', () => {
  const { registry, batch } = fixture();
  registry.withdrawals.push({ id: 'actor:github:90', withdrawn_at: NOW, reason: 'withdrawn' });
  const catalog = normalize(registry, batch).catalog;
  for (const name of ['sources', 'actors', 'organizations', 'projects', 'resources', 'collections'] as const) assert.equal(catalog[name].length, 0, name);
  assert.doesNotMatch(JSON.stringify(catalog), /https:\/\/github.com\/lab|README_MARKER|Clinical collection|Cross-repository study/);
  for (const marker of catalog.tombstones) assert.ok(Object.keys(marker).every(key => ['kind', 'id', 'status', 'withdrawn_at', 'reason', 'replacement_id'].includes(key)));
  const validation = validateCatalog(catalog);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
});

test('an actor withdrawal discovered through a selected alias applies before any source projection', () => {
  for (const aliasFirst of [false, true]) {
    const { registry, batch } = fixture();
    registry.withdrawals.push({ id: 'actor:github:90', withdrawn_at: NOW, reason: 'withdrawn' });
    const alias = { url: OLD_A, reviewed_at: NOW, review_note: 'Old ownership observation.' };
    if (aliasFirst) registry.sources.unshift(alias); else registry.sources.push(alias);
    batch.sources.push({ ...snapshot(A, 101), requested_url: OLD_A });
    // Even a conflicting/newer owner observation cannot publish one side before
    // the known withdrawn identity is processed through the other alias.
    batch.sources[0]!.repository!.owner = { id: 92, login: 'other-owner', type: 'User', html_url: 'https://github.com/other-owner' };
    const catalog = normalize(registry, batch).catalog;
    assert.ok(!catalog.sources.some(row => row.id === 'source:github:101'));
    assert.ok(!catalog.actors.some(row => row.id === 'actor:github:92'));
    assert.ok(catalog.tombstones.some(row => row.id === 'source:github:101'));
    assert.doesNotMatch(JSON.stringify(catalog), /README_MARKER_101|old-lab|other-owner/);
  }
});

function nestedCollections(registry: Registry): void {
  registry.collections = [
    { key: 'root', title: 'Root collection', selection_basis: 'Nested organization.', item_ids: ['collection:middle', 'resource:data'] },
    { key: 'middle', title: 'Middle collection', selection_basis: 'Grouped methods.', item_ids: ['collection:leaf'] },
    { key: 'leaf', title: 'Leaf collection', description: 'LEAF_COLLECTION_DESCRIPTION', selection_basis: 'Specific workflow.', item_ids: ['resource:workflow'] },
  ];
}

test('nested collections preserve stable IDs, ordering and complete references independently of input order', () => {
  const { registry, batch } = fixture();
  nestedCollections(registry);
  const input = JSON.stringify(registry);
  const before = normalize(registry, batch).catalog;
  assert.equal(JSON.stringify(registry), input);
  registry.collections.reverse();
  const after = normalize(registry, batch).catalog;
  assert.deepEqual(after, before);
  assert.deepEqual(before.collections.map(row => row.id), ['collection:leaf', 'collection:middle', 'collection:root']);
  assert.deepEqual(before.collections.find(row => row.id === 'collection:root')?.item_ids, ['collection:middle', 'resource:data']);
  assert.deepEqual(before.collections.find(row => row.id === 'collection:middle')?.item_ids, ['collection:leaf']);
  const validation = validateCatalog(before);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
});

test('withdrawn child collections and unavailable leaves prune upward while preserving unrelated entries', () => {
  for (const target of ['collection:leaf', 'resource:workflow', 'source:github:101']) {
    const { registry, batch } = fixture();
    nestedCollections(registry);
    registry.withdrawals.push({ id: target, withdrawn_at: NOW, reason: 'withdrawn' });
    const catalog = normalize(registry, batch).catalog;
    assert.deepEqual(catalog.collections.map(row => row.id), ['collection:root']);
    assert.deepEqual(catalog.collections[0]?.item_ids, ['resource:data']);
    for (const id of ['collection:leaf', 'collection:middle']) assert.ok(catalog.tombstones.some(row => row.id === id), `${target}: ${id}`);
    assert.doesNotMatch(JSON.stringify(catalog), /LEAF_COLLECTION_DESCRIPTION|Middle collection/);
    const validation = validateCatalog(catalog);
    assert.equal(validation.ok, true, validation.errors.join('\n'));
  }
});

test('withdrawing a parent collection does not cascade down into separately available children', () => {
  const { registry, batch } = fixture();
  nestedCollections(registry);
  registry.withdrawals.push({ id: 'collection:root', withdrawn_at: NOW, reason: 'policy' });
  const catalog = normalize(registry, batch).catalog;
  assert.deepEqual(catalog.collections.map(row => row.id), ['collection:leaf', 'collection:middle']);
  assert.ok(catalog.resources.some(row => row.id === 'resource:workflow'));
  assert.ok(catalog.tombstones.some(row => row.id === 'collection:root' && row.reason === 'policy'));
  const validation = validateCatalog(catalog);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
});

const CLAIM_TIME = '2026-09-11T08:00:00.000Z';
function independentActor(provider_id: number, login: string): Actor {
  const id = `actor:github:${provider_id}`;
  const evidence = { role: 'github' as const, review: 'reviewed' as const, url: `https://api.github.com/users/${login}`, actor_id: id, observed_at: CLAIM_TIME };
  return { kind: 'actor', id, title: login, provider: 'github', provider_id, login, account_type: 'user', canonical_url: `https://github.com/${login}`, aliases: [], status: 'listed', updated_at: CLAIM_TIME, provenance: { title: [evidence], provider_id: [evidence] } };
}
function curationClaim(): Claim {
  const scope = 'catalog-curation:source:github:101,resource:workflow';
  return { kind: 'claim', id: 'claim:organization-curation', subject_id: 'actor:github:90', actor_id: 'actor:github:901', type: 'organization_curation', status: 'verified', scope,
    evidence: [{ role: 'maintainer', review: 'reviewed', observed_at: CLAIM_TIME, url: `${A}/issues/10`, source_id: 'source:github:101', actor_id: 'actor:github:90', scope, method: 'PUBLIC_CLAIM_EVIDENCE_MARKER' }],
    recorded_at: CLAIM_TIME, verified_at: CLAIM_TIME, expires_at: '2026-10-11T08:00:00Z', verified_by: 'actor:github:902', authority: 'organization_owner', recheck_on: ['rename', 'transfer', 'permission_change', 'evidence_expiry', 'dispute'] };
}
function addGovernance(registry: Registry): void {
  registry.actors = [independentActor(901, 'independent-contributor'), independentActor(902, 'catalog-reviewer')];
  registry.claims = [curationClaim()];
}
test('a reviewed public owner claim activates only its exact organization curation scope', () => {
  const { registry, batch } = fixture(); addGovernance(registry);
  const input = JSON.stringify(registry);
  const catalog = normalize(registry, batch).catalog;
  assert.equal(JSON.stringify(registry), input, 'claim projection must not mutate reviewed inputs');
  assert.equal(catalog.claims[0]?.status, 'verified');
  assert.ok(catalog.actors.some(row => row.id === 'actor:github:901'));
  assert.ok(catalog.actors.some(row => row.id === 'actor:github:902'));
  const organization = catalog.organizations.find(row => row.id === 'actor:github:90')!;
  assert.equal(organization.participation, 'actively_curated');
  assert.deepEqual(organization.source_ids, ['source:github:101']);
  assert.deepEqual(organization.resource_ids, ['resource:workflow']);
  assert.equal(catalog.sources.length, 2, 'unscoped sources remain discoverable without inheriting participation');
  assert.ok(organization.provenance.participation?.length);
  const checked = validateCatalog(catalog);
  assert.equal(checked.ok, true, checked.errors.join('\n'));
});

test('delegated owner authority is supported while ordinary membership and undeclared identities are not promoted', () => {
  const { registry, batch } = fixture(); addGovernance(registry);
  registry.claims![0].authority = 'delegated_by_owner';
  assert.equal(normalize(registry, batch).catalog.organizations[0]?.participation, 'actively_curated');
  registry.claims![0].authority = 'repository_maintainer';
  assert.throws(() => normalize(registry, batch), /matching owner/);
  registry.claims![0].authority = 'organization_owner';
  registry.actors = [];
  const unavailable = normalize(registry, batch).catalog;
  assert.equal(unavailable.claims.length, 0);
  assert.equal(unavailable.organizations[0]?.participation, 'community_indexed');
  assert.ok(unavailable.tombstones.some(row => row.id === 'claim:organization-curation'));
});

test('revocation, disputes and evidence expiry remove active participation without rewriting the reviewed record', () => {
  for (const status of ['revoked', 'disputed', 'expired', 'unverified'] as const) {
    const { registry, batch } = fixture(); addGovernance(registry);
    registry.claims![0].status = status;
    const catalog = normalize(registry, batch).catalog;
    assert.equal(catalog.claims[0]?.status, status);
    assert.equal(catalog.organizations[0]?.participation, 'community_indexed');
  }
  const { registry, batch } = fixture(); addGovernance(registry);
  registry.claims![0].expires_at = '2026-09-12T07:59:59Z';
  const result = normalize(registry, batch);
  assert.equal(result.catalog.claims[0]?.status, 'expired');
  assert.equal(result.catalog.organizations[0]?.participation, 'community_indexed');
  assert.equal(registry.claims![0].status, 'verified');
  assert.ok(result.diagnostics.some(row => /expired/.test(row.message)));
});

test('source rename or transfer reopens verified authority review rather than inheriting it', () => {
  for (const kind of ['rename', 'transfer'] as const) {
    const { registry, batch } = fixture(); addGovernance(registry);
    const source = batch.sources[0]!.repository!;
    source.html_url = kind === 'rename' ? 'https://github.com/lab/renamed-methods' : 'https://github.com/different-lab/methods';
    source.full_name = new URL(source.html_url).pathname.slice(1);
    if (kind === 'transfer') source.owner = { id: 91, login: 'different-lab', type: 'Organization', html_url: 'https://github.com/different-lab' };
    const catalog = normalize(registry, batch).catalog;
    assert.equal(catalog.claims[0]?.status, 'unverified', kind);
    assert.equal(catalog.organizations.find(row => row.id === 'actor:github:90')?.participation, 'community_indexed');
    assert.ok(!catalog.organizations.some(row => row.id === 'actor:github:91' && row.participation === 'actively_curated'));
    const checked = validateCatalog(catalog);
    assert.equal(checked.ok, true, checked.errors.join('\n'));
  }
});

test('organization curation cannot extend to repositories belonging to another organization', () => {
  const { registry, batch } = fixture(); addGovernance(registry);
  batch.sources[1]!.repository!.owner = { id: 91, login: 'different-lab', type: 'Organization', html_url: 'https://github.com/different-lab' };
  const claim = registry.claims![0];
  claim.scope = 'catalog-curation:source:github:102,resource:data';
  claim.evidence[0].scope = claim.scope;
  const catalog = normalize(registry, batch).catalog;
  assert.equal(catalog.claims[0]?.status, 'unverified');
  assert.ok(catalog.organizations.every(row => row.participation === 'community_indexed'));
  const checked = validateCatalog(catalog);
  assert.equal(checked.ok, true, checked.errors.join('\n'));
});

test('claimant account rename and stale evidence trigger review before continued authority', () => {
  const { registry, batch } = fixture(); addGovernance(registry);
  registry.actors![0].aliases.push({ url: 'https://github.com/former-contributor', provider_id: 901, verified_at: NOW });
  assert.equal(normalize(registry, batch).catalog.claims[0]?.status, 'unverified');
  registry.actors![0].aliases = [];
  registry.claims![0].evidence.push({ ...registry.claims![0].evidence[0], review: 'stale' });
  assert.equal(normalize(registry, batch).catalog.claims[0]?.status, 'unverified');
  registry.claims![0].evidence[1].review = 'disputed';
  assert.equal(normalize(registry, batch).catalog.claims[0]?.status, 'disputed');
});

test('claim withdrawal and withdrawal of its subject, contributor, reviewer or evidence remove public claim content', () => {
  for (const id of ['claim:organization-curation', 'actor:github:90', 'actor:github:901', 'actor:github:902', 'source:github:101', 'resource:workflow']) {
    const { registry, batch } = fixture(); addGovernance(registry);
    registry.withdrawals.push({ id, withdrawn_at: NOW, reason: 'policy' });
    const catalog = normalize(registry, batch).catalog;
    assert.equal(catalog.claims.length, 0, id);
    assert.ok(catalog.tombstones.some(row => row.id === 'claim:organization-curation'), id);
    assert.ok(!catalog.organizations.some(row => row.participation === 'actively_curated'), id);
    assert.doesNotMatch(JSON.stringify(catalog), /PUBLIC_CLAIM_EVIDENCE_MARKER/, id);
    const checked = validateCatalog(catalog);
    assert.equal(checked.ok, true, checked.errors.join('\n'));
  }
});

test('repository maintenance, capability and scientific claims remain separate from organization curation', () => {
  const { registry, batch } = fixture(); addGovernance(registry);
  registry.claims = [{ ...curationClaim(), id: 'claim:repository-maintainer', type: 'maintainership', subject_id: 'source:github:101', authority: 'repository_maintainer', scope: 'Maintain this repository only', evidence: [{ ...curationClaim().evidence[0], scope: 'Maintain this repository only' }] },
    { ...curationClaim(), id: 'claim:method-capability', type: 'capability', subject_id: 'resource:workflow', scope: 'Handles a declared CSV input', status: 'unverified' },
    { ...curationClaim(), id: 'claim:scientific-evidence', type: 'scientific_validation', subject_id: 'project:joint', scope: 'One externally reviewed experiment', status: 'unverified' }];
  const catalog = normalize(registry, batch).catalog;
  assert.equal(catalog.claims.length, 3);
  assert.equal(catalog.organizations[0]?.participation, 'community_indexed');
  assert.equal(catalog.resources[0]?.runtime.status, 'not_described');
  const checked = validateCatalog(catalog);
  assert.equal(checked.ok, true, checked.errors.join('\n'));
});

test('a candidate without a verified snapshot cannot create invented GitHub metadata', () => {
  const { registry, batch } = fixture();
  batch.sources = [];
  const result = normalize(registry, batch);
  assert.equal(result.catalog.sources.length, 0);
  assert.equal(result.catalog.actors.length, 0);
  assert.equal(result.catalog.projects.length, 0);
  assert.equal(result.catalog.resources.length, 0);
  assert.ok(result.diagnostics.every(row => row.message.includes('candidate')));
});

test('unregistered references and invalid batch dates are rejected before normalization', () => {
  const { registry, batch } = fixture();
  assert.throws(() => normalize(registry, { ...batch, as_of: 'not-a-date' }), /Invalid snapshot batch time/);
  registry.resources[0]!.sources.push('https://github.com/other/unreviewed');
  assert.throws(() => normalize(registry, batch), /Unregistered source/);
});
