import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyRegistryEnhancement, validateRegistry, validateSourceCandidate, type Registry } from '../registry.js';
import type { Actor, Claim, Relation } from '../../spec/types.js';

const A = 'https://github.com/example-lab/methods';
const B = 'https://github.com/example-lab/observations';
const NOW = '2026-09-12T08:00:00.000Z';
function fixture(): Registry {
  return {
    version: 1,
    sources: [A, B].map(url => ({ url, reviewed_at: NOW, review_note: 'Synthetic reviewed research source.' })),
    projects: [{ key: 'study', title: 'A study', description: 'Reviewed research question.', domains: ['Medicine'], sources: [A, B], resources: ['workflow', 'method'] }],
    resources: [
      { key: 'workflow', title: 'Analysis workflow', type: 'workflow', domains: ['Medicine'], sources: [A, B], documentation_url: 'https://docs.example.org/workflow', inputs: ['Data'], outputs: ['Report'] },
      { key: 'method', title: 'A method', description: 'Reviewed methodology.', type: 'method', domains: [], sources: [A] },
    ],
    collections: [{ key: 'medical', title: 'Medical research', description: 'Selected tools.', selection_basis: 'Research relevance.', item_ids: ['project:study', 'resource:workflow'] }],
    withdrawals: [],
  };
}

test('full registry fields, multi-source associations, and the actual seed validate', async () => {
  assert.deepEqual(validateRegistry(fixture()), []);
  const seed = JSON.parse(await readFile(new URL('../../registry/catalog.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateRegistry(seed), []);
});

test('one URL is enough for intake but formal source inclusion needs review', () => {
  for (const url of [A, 'https://github.com/example-lab', `${A}/blob/main/docs/method.md`]) assert.deepEqual(validateSourceCandidate({ url }), []);
  const registry = fixture();
  Object.assign(registry, { sources: [{ url: A }] });
  assert.match(validateRegistry(registry).join('\n'), /reviewed_at|review_note/);
  for (const invalid of [null, {}, { url: 42 }, { url: A, acknowledged: true }, { url: 'https://github.com/search' }]) assert.ok(validateSourceCandidate(invalid).length > 0);
});

test('malformed JSON values at every nested level return errors instead of throwing', () => {
  for (const input of [null, undefined, [], 1, true, '', {}, { version: 1 }, { ...fixture(), sources: null }]) {
    assert.doesNotThrow(() => validateRegistry(input));
    assert.ok(validateRegistry(input).length > 0);
  }
  for (const field of ['sources', 'projects', 'resources', 'collections', 'withdrawals'] as const) {
    for (const value of [null, 42, [], 'string', true]) {
      const input = { ...fixture(), [field]: [value] };
      assert.doesNotThrow(() => validateRegistry(input), `${field}: ${JSON.stringify(value)}`);
      assert.ok(validateRegistry(input).length > 0, field);
    }
  }
  for (const field of ['domains', 'sources', 'resources'] as const) {
    const registry = fixture();
    Object.assign(registry.projects[0], { [field]: null });
    assert.ok(validateRegistry(registry).length > 0, field);
  }
});

test('all registry objects reject unknown properties and never echo injected values', () => {
  for (const field of ['sources', 'projects', 'resources', 'collections'] as const) {
    const registry = fixture();
    Object.assign(registry[field][0], { token: 'SECRET_MUST_NOT_BE_LOGGED' });
    const errors = validateRegistry(registry);
    assert.ok(errors.length > 0, field);
    assert.doesNotMatch(errors.join('\n'), /SECRET_MUST_NOT_BE_LOGGED/);
  }
  assert.ok(validateRegistry({ ...fixture(), claims: [{ verified: true }] }).length > 0);
  for (const key of ['description', 'url', 'token', 'kind', 'status', 'provenance']) {
    const registry = fixture();
    registry.withdrawals.push({ id: 'resource:method', withdrawn_at: NOW, reason: 'withdrawn', [key]: 'PRIVATE_VALUE' } as Registry['withdrawals'][number]);
    const errors = validateRegistry(registry);
    assert.ok(errors.length > 0, key);
    assert.doesNotMatch(errors.join('\n'), /PRIVATE_VALUE/);
  }
});

test('GitHub source and reference URLs reject credentials, unsafe protocols, traversal and non-repository pages', () => {
  for (const url of ['https://someone:secret@github.com/a/b', 'https://github.com/a/b?token=SECRET_VALUE', 'javascript:alert(1)', 'http://github.com/a/b', 'https://github.com.evil.test/a/b', 'https://github.com/a/b/../../c', 'https://github.com/example-lab', `${A}/issues/1`, `${A}/blob/main/file.md`]) {
    const registry = fixture();
    registry.sources[0].url = url;
    assert.ok(validateRegistry(registry).length > 0, url);
    registry.sources[0].url = A;
    registry.resources[0].sources = [url];
    assert.ok(validateRegistry(registry).length > 0, url);
  }
  const registry = fixture();
  registry.resources[0].documentation_url = 'https://docs.example.org/guide';
  assert.deepEqual(validateRegistry(registry), []);
  for (const url of ['javascript:alert(1)', 'https://user:secret@docs.example.org/guide', 'https://docs.example.org/guide?access_token=secret', '//docs.example.org/guide']) {
    registry.resources[0].documentation_url = url;
    assert.ok(validateRegistry(registry).length > 0, url);
  }
});

test('normalization reveals duplicate source URLs and duplicate source references', () => {
  const registry = fixture();
  registry.sources.push({ ...registry.sources[0], url: 'https://github.com/EXAMPLE-LAB/METHODS.git#readme' });
  assert.match(validateRegistry(registry).join('\n'), /Duplicate source/);
  registry.sources.pop();
  registry.resources[0].sources.push('https://github.com/EXAMPLE-LAB/METHODS.git');
  assert.match(validateRegistry(registry).join('\n'), /Duplicate source reference/);
});

test('IDs, keys, required fields and limits validate before graph traversal', () => {
  for (const key of ['', 'A', 'has spaces', '../a', 'a'.repeat(129)]) {
    const registry = fixture(); registry.resources[0].key = key;
    assert.ok(validateRegistry(registry).length > 0, key);
  }
  for (const value of ['', '   ', 'x'.repeat(301)]) {
    const registry = fixture(); registry.projects[0].title = value;
    assert.ok(validateRegistry(registry).length > 0);
  }
  for (const value of ['yesterday', '2026-02-30T12:00:00Z', '2026-09-12', '2026-09-12T08:00:00+08:00']) {
    const registry = fixture(); registry.sources[0].reviewed_at = value;
    assert.ok(validateRegistry(registry).length > 0, value);
  }
  const registry = fixture();
  registry.resources.push({ ...registry.resources[0], title: 'Same key with a different title' });
  assert.match(validateRegistry(registry).join('\n'), /Duplicate identity/);
  registry.resources.pop();
  registry.resources[0].type = 'future-valid-category';
  assert.deepEqual(validateRegistry(registry), []);
  registry.resources[0].inputs = [null] as unknown as string[];
  assert.ok(validateRegistry(registry).length > 0);
});

test('references require registered sources and correctly typed editorial identities', () => {
  const registry = fixture();
  registry.resources[0].sources = ['https://github.com/example-lab/missing'];
  assert.match(validateRegistry(registry).join('\n'), /Unregistered source/);
  registry.resources[0].sources = [A];
  registry.projects[0].resources = ['study'];
  assert.match(validateRegistry(registry).join('\n'), /Unknown project resource/);
  registry.projects[0].resources = ['method'];
  registry.collections[0].item_ids.push('project:missing');
  assert.match(validateRegistry(registry).join('\n'), /Unknown collection item/);
});

test('withdrawals accept minimal records, retained references and valid replacements', () => {
  const registry = fixture();
  registry.withdrawals.push({ id: 'resource:old', withdrawn_at: NOW, reason: 'merged', replacement_id: 'resource:method' });
  registry.projects[0].resources.push('old');
  registry.collections[0].item_ids.push('resource:old');
  assert.deepEqual(validateRegistry(registry), []);
  registry.withdrawals.push({ id: 'source:github:123', withdrawn_at: NOW, reason: 'withdrawn' });
  assert.deepEqual(validateRegistry(registry), []);
});

test('withdrawals reject missing IDs, duplicates, unknown targets and incompatible kinds', () => {
  for (const withdrawal of [
    { id: 'not-an-id', withdrawn_at: NOW, reason: 'withdrawn' },
    { id: 'resource:old', withdrawn_at: 'wrong', reason: 'withdrawn' },
    { id: 'resource:old', withdrawn_at: NOW, reason: 'merged' },
    { id: 'resource:old', withdrawn_at: NOW, reason: 'withdrawn', replacement_id: 'resource:method' },
    { id: 'resource:old', withdrawn_at: NOW, reason: 'merged', replacement_id: 'resource:missing' },
    { id: 'resource:old', withdrawn_at: NOW, reason: 'merged', replacement_id: 'project:study' },
    { id: 'resource:old', withdrawn_at: NOW, reason: 'merged', replacement_id: 'resource:old' },
  ]) {
    const registry = fixture();
    registry.withdrawals.push(withdrawal as Registry['withdrawals'][number]);
    assert.ok(validateRegistry(registry).length > 0, JSON.stringify(withdrawal));
  }
  const registry = fixture();
  registry.withdrawals.push({ id: 'resource:method', withdrawn_at: NOW, reason: 'withdrawn' }, { id: 'resource:method', withdrawn_at: NOW, reason: 'policy' });
  assert.match(validateRegistry(registry).join('\n'), /Duplicate withdrawal/);
});

test('replacement chains must terminate at available identities, without loops or withdrawn endpoints', () => {
  const registry = fixture();
  registry.withdrawals = [
    { id: 'resource:old-a', withdrawn_at: NOW, reason: 'merged', replacement_id: 'resource:old-b' },
    { id: 'resource:old-b', withdrawn_at: NOW, reason: 'merged', replacement_id: 'resource:method' },
  ];
  assert.deepEqual(validateRegistry(registry), []);
  registry.withdrawals[1].replacement_id = 'resource:old-a';
  assert.match(validateRegistry(registry).join('\n'), /Cyclic withdrawal/);
  registry.withdrawals[1] = { id: 'resource:old-b', withdrawn_at: NOW, reason: 'withdrawn' };
  assert.match(validateRegistry(registry).join('\n'), /withdrawn identity/);
});

test('nested collection cycles are rejected with iterative traversal', () => {
  const registry = fixture();
  registry.collections.push({ key: 'nested', title: 'Nested set', selection_basis: 'Theme', item_ids: ['collection:medical'] });
  assert.deepEqual(validateRegistry(registry), []);
  registry.collections[0].item_ids.push('collection:nested');
  assert.match(validateRegistry(registry).join('\n'), /Cyclic collection/);
  registry.collections[0].item_ids = ['collection:medical'];
  assert.match(validateRegistry(registry).join('\n'), /include itself/);
});

function publicActor(provider_id: number, login: string): Actor {
  const id = `actor:github:${provider_id}`;
  const observation = { role: 'github' as const, review: 'reviewed' as const, url: `https://api.github.com/users/${login}`, actor_id: id, observed_at: NOW };
  return { kind: 'actor', id, title: login, provider: 'github', provider_id, login, account_type: 'user', canonical_url: `https://github.com/${login}`, aliases: [], status: 'listed', updated_at: NOW, provenance: { title: [observation], provider_id: [observation] } };
}
function reviewedClaim(): Claim {
  const scope = 'catalog-curation:source:github:101,resource:method';
  return { kind: 'claim', id: 'claim:curation', subject_id: 'actor:github:90', actor_id: 'actor:github:901', type: 'organization_curation', status: 'verified', scope,
    evidence: [{ role: 'maintainer', review: 'reviewed', observed_at: NOW, url: `${A}/issues/10`, source_id: 'source:github:101', actor_id: 'actor:github:90', scope }],
    recorded_at: NOW, verified_at: NOW, expires_at: '2026-10-12T08:00:00Z', authority: 'organization_owner', verified_by: 'actor:github:902', recheck_on: ['rename', 'transfer', 'permission_change', 'evidence_expiry', 'dispute'] };
}
test('optional reviewed actor identities and scoped governance claims use the same public model', () => {
  const registry = fixture();
  registry.actors = [publicActor(901, 'contributor'), publicActor(902, 'reviewer')];
  registry.claims = [reviewedClaim()];
  assert.deepEqual(validateRegistry(registry), []);
  registry.claims[0].authority = 'delegated_by_owner';
  assert.deepEqual(validateRegistry(registry), []);
});

test('independent actor IDs need public observed evidence and cannot copy private audit material', () => {
  const registry = fixture();
  registry.actors = [publicActor(901, 'contributor')];
  registry.actors[0].provenance.provider_id[0].url = 'https://github.com/contributor';
  assert.match(validateRegistry(registry).join('\n'), /public GitHub API observation/);
  registry.actors = [publicActor(901, 'contributor')];
  registry.actors[0].provider_id = 999;
  assert.match(validateRegistry(registry).join('\n'), /match observed GitHub ID/);
  registry.actors = [publicActor(901, 'contributor')];
  registry.actors[0].canonical_url = 'https://github.com/someone-else';
  assert.match(validateRegistry(registry).join('\n'), /URL and login/);
  for (const field of ['email', 'private_members', 'audit', 'access_token']) {
    registry.actors = [publicActor(901, 'contributor')];
    Object.assign(registry.actors[0], { [field]: 'PRIVATE_ACTOR_VALUE' });
    const errors = validateRegistry(registry);
    assert.ok(errors.length > 0, field);
    assert.doesNotMatch(errors.join('\n'), /PRIVATE_ACTOR_VALUE/);
  }
});

test('ordinary members cannot become organization representatives through a claimed badge', () => {
  const registry = fixture(); registry.claims = [reviewedClaim()];
  registry.claims[0].authority = 'repository_maintainer';
  assert.match(validateRegistry(registry).join('\n'), /matching owner/);
  registry.claims[0].authority = 'organization_owner';
  registry.claims[0].evidence[0].role = 'community';
  assert.match(validateRegistry(registry).join('\n'), /explicitly cover the reviewed scope/);
  registry.claims[0].evidence[0].role = 'maintainer';
  registry.claims[0].scope = 'all repositories and every member';
  assert.match(validateRegistry(registry).join('\n'), /explicit catalog-curation/);
});

test('verified authority requires explicit expiry, reviewer, lifecycle triggers and exact evidence scope', () => {
  for (const field of ['expires_at', 'verified_at', 'verified_by'] as const) {
    const registry = fixture(); registry.claims = [reviewedClaim()];
    delete registry.claims[0][field];
    assert.ok(validateRegistry(registry).length > 0, field);
  }
  const registry = fixture(); registry.claims = [reviewedClaim()];
  registry.claims[0].recheck_on = ['dispute'];
  assert.match(validateRegistry(registry).join('\n'), /recheck transfer/);
  registry.claims = [reviewedClaim()];
  registry.claims[0].evidence[0].scope = 'A different repository';
  assert.match(validateRegistry(registry).join('\n'), /reviewed scope/);
  registry.claims = [reviewedClaim()];
  registry.claims[0].expires_at = '2026-08-12T08:00:00Z';
  assert.match(validateRegistry(registry).join('\n'), /expiration/);
  registry.claims = [reviewedClaim()];
  registry.claims[0].evidence[0].observed_at = '2026-09-13T08:00:00Z';
  assert.match(validateRegistry(registry).join('\n'), /postdate claim verification/);
});

test('claim and nested evidence whitelists reject credential and private-permission fields', () => {
  for (const level of ['claim', 'evidence']) for (const field of ['token', 'private_members', 'permissions_response', 'audit']) {
    const registry = fixture(); registry.claims = [reviewedClaim()];
    Object.assign(level === 'claim' ? registry.claims[0] : registry.claims[0].evidence[0], { [field]: 'PRIVATE_CLAIM_VALUE' });
    const errors = validateRegistry(registry);
    assert.ok(errors.length > 0, `${level}.${field}`);
    assert.doesNotMatch(errors.join('\n'), /PRIVATE_CLAIM_VALUE/);
  }
  const registry = fixture(); registry.claims = [reviewedClaim(), { ...reviewedClaim(), scope: 'catalog-curation:source:github:101' }];
  assert.match(validateRegistry(registry).join('\n'), /Duplicate claim/);
});

test('declared immutable locations require stable identity and cover each selected source', () => {
  const registry = fixture();
  registry.resources[0].source_refs = [
    { source_url: A, source_id: 'source:github:101', role: 'implementation', path: '研究/run notes.md', commit: 'a'.repeat(40), sha256: 'c'.repeat(64), resolved_at: NOW },
    { source_url: B, role: 'data', ref: 'main' },
  ];
  assert.deepEqual(validateRegistry(registry), []);
  delete registry.resources[0].source_refs[0].source_id;
  assert.match(validateRegistry(registry).join('\n'), /stable source_id/);
  registry.resources[0].source_refs[0].source_id = 'source:github:101';
  registry.resources[0].source_refs.pop();
  assert.match(validateRegistry(registry).join('\n'), /cover every source/);
  registry.resources[0].source_refs.push({ source_url: B, role: 'data', resolved_at: NOW });
  assert.match(validateRegistry(registry).join('\n'), /requires an explicit immutable commit/);
});

test('declared location schemas reject traversal, short commits, credentials and unsupported fields', () => {
  for (const update of [{ path: '../outside' }, { commit: 'main' }, { commit: 'abc123' }, { source_url: 'https://user:secret@github.com/example/repo' }, { token: 'secret' }, { role: 'execute' }]) {
    const registry = fixture();
    registry.resources[1].source_refs = [{ source_url: A, source_id: 'source:github:101', role: 'documentation', commit: 'a'.repeat(40), path: 'docs/method.md', ...update } as NonNullable<Registry['resources'][number]['source_refs']>[number]];
    assert.ok(validateRegistry(registry).length > 0, JSON.stringify(update));
  }
  const registry = fixture();
  registry.resources[1].source_refs = [{ source_url: A, role: 'primary', path: 'file.md' }, { path: 'file.md', role: 'primary', source_url: 'https://github.com/EXAMPLE-LAB/METHODS.git' }];
  assert.match(validateRegistry(registry).join('\n'), /Duplicate declared source location/);
});

function reviewedRelation(): Relation {
  return { kind: 'relation', id: 'relation:study-produces-workflow', from_id: 'project:study', to_id: 'resource:workflow', type: 'produces', recorded_at: NOW,
    evidence: [{ role: 'editor', review: 'reviewed', url: A, source_id: 'source:github:101', observed_at: NOW, scope: 'Project output documented in the public repository.' }] };
}
test('reviewed relation input validates identities, endpoint meaning and public evidence', () => {
  const registry = fixture(); registry.relations = [reviewedRelation()];
  assert.deepEqual(validateRegistry(registry), []);
  registry.relations[0].to_id = 'resource:missing';
  assert.match(validateRegistry(registry).join('\n'), /Unknown relation endpoint/);
  registry.relations[0].to_id = 'project:study';
  assert.match(validateRegistry(registry).join('\n'), /endpoints must differ/);
  registry.relations = [{ ...reviewedRelation(), type: 'fork_of' }];
  assert.match(validateRegistry(registry).join('\n'), /endpoint kinds/);
  registry.relations = [reviewedRelation()]; registry.relations[0].evidence[0].review = 'pending';
  assert.match(validateRegistry(registry).join('\n'), /reviewed public evidence/);
  registry.relations = [reviewedRelation()]; Object.assign(registry.relations[0].evidence[0], { private_audit: 'DO_NOT_PUBLISH' });
  assert.ok(validateRegistry(registry).length > 0);
});

test('optional enhancements atomically supplement a reviewed URL baseline without acquiring authority', () => {
  const registry: Registry = { version: 1, sources: fixture().sources, projects: [], resources: [], collections: [], withdrawals: [] };
  const input = { version: 1, source_url: A, reviewed_at: NOW, review_note: 'Reviewed optional community description.',
    projects: fixture().projects, resources: fixture().resources.map(resource => ({ ...resource, sources: [A], attribution: { role: 'editor', url: A, observed_at: NOW } })), relations: [reviewedRelation()] };
  const before = JSON.stringify({ registry, input });
  const result = applyRegistryEnhancement(registry, input);
  assert.equal(result.applied, true, result.errors.join('\n'));
  assert.equal(result.registry.sources.length, 2);
  assert.equal(result.registry.resources.length, 2);
  assert.equal(result.registry.resources[0].attribution?.role, 'community');
  assert.equal(result.registry.relations?.[0].evidence[0].role, 'community');
  assert.equal(result.registry.claims, undefined);
  assert.equal(JSON.stringify({ registry, input }), before);
  assert.deepEqual(validateRegistry(result.registry), []);
});

test('invalid, colliding, unreviewed and source-mismatched enhancements leave baseline untouched', () => {
  const registry = fixture();
  for (const invalid of [null, '{ not JSON }', { version: 1, source_url: A },
    { version: 1, source_url: A, reviewed_at: NOW, review_note: 'Reviewed', resources: registry.resources },
    { version: 1, source_url: A, reviewed_at: NOW, review_note: 'Reviewed', resources: [{ ...registry.resources[0], key: 'new-resource', sources: [B] }] },
    { version: 1, source_url: 'https://github.com/unreviewed/repo', reviewed_at: NOW, review_note: 'Reviewed', resources: [{ ...registry.resources[0], key: 'new-resource' }] },
    { version: 1, source_url: A, reviewed_at: NOW, review_note: 'Reviewed', resources: [{ ...registry.resources[0], key: 'new-resource' }], claims: [reviewedClaim()] },
    { version: 1, source_url: A, reviewed_at: NOW, review_note: 'Reviewed', scripts: { postinstall: 'throw new Error("executed")' } },
  ]) {
    const before = JSON.stringify(registry);
    const result = applyRegistryEnhancement(registry, invalid);
    assert.equal(result.applied, false);
    assert.ok(result.errors.length > 0);
    assert.equal(result.registry, registry);
    assert.equal(JSON.stringify(registry), before);
  }
});

test('resource access conditions and described runtimes require bounded public data', () => {
  const registry = fixture();
  registry.resources[0].download_url = 'https://example.org/releases/workflow.zip';
  registry.resources[0].conditions = ['Research use described at the source.', 'Python 3 is required.'];
  registry.resources[0].runtime = { status: 'maintainer_described', documentation_url: 'https://example.org/docs/run' };
  assert.deepEqual(validateRegistry(registry), []);
  delete registry.resources[0].runtime.documentation_url;
  assert.match(validateRegistry(registry).join('\n'), /requires a public documentation URL/);
  registry.resources[0].runtime = { status: 'community_described', documentation_url: 'javascript:alert(1)' };
  assert.ok(validateRegistry(registry).length > 0);
  registry.resources[0].runtime = { status: 'not_described' };
  registry.resources[0].conditions = ['x'.repeat(2001)];
  assert.ok(validateRegistry(registry).length > 0);
  registry.resources[0].conditions = [];
  registry.resources[0].download_url = 'https://example.org/file?token=secret';
  assert.ok(validateRegistry(registry).length > 0);
});
