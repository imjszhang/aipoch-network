import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../build.js';
import { normalize, type SnapshotBatch } from '../normalize.js';
import type { Registry } from '../registry.js';
import { browseProjection, createUiArtifact, readUiArtifact, retainUiHistory, uiDirectory, uiManifestHash, verifyUiPublication } from '../browser-projection.js';
import { sha256, stableJson } from '../json.js';
import { type SnapshotHistory } from '../history.js';
import type { CatalogData, SourceRepository } from '../../spec/types.js';
import type { UiManifest, UiManifestReference } from '../../shared/browser-projection.js';
import { compareDiscovery, makeDiscoveryComparator, matchesDiscovery, parseDiscovery, representativeSource } from '../../web/src/discovery.js';
import { allEntries } from '../../web/src/model.js';

const NOW = '2026-09-12T08:00:00.000Z';
function fixture(): { registry: Registry; batch: SnapshotBatch } {
  const url = 'https://github.com/lab/research';
  return { registry: { version: 1, sources: [{ url, reviewed_at: NOW, review_note: 'Synthetic source.' }], projects: [{ key: 'research', title: 'Clinical study', description: 'Research description.', domains: ['Clinical research'], sources: [url], resources: ['method'] }], resources: [{ key: 'method', title: 'Research method', description: 'Reusable method.', type: 'method', domains: ['Clinical research'], sources: [url] }], collections: [], withdrawals: [] }, batch: { as_of: NOW, sources: [{ requested_url: url, checked_at: NOW, observed_at: NOW, availability: 'accessible', suppressed: false, repository: { id: 101, name: 'research', full_name: 'lab/research', html_url: url, description: 'Public description.', default_branch: 'main', archived: false, fork: false, owner: { id: 90, login: 'lab', type: 'Organization', html_url: 'https://github.com/lab' }, topics: ['science'], updated_at: NOW, has_issues: true, has_discussions: false, commit: 'a'.repeat(40), readme: 'LOCAL_README_ONLY' } }] } };
}
async function temp(t: TestContext) { const root = await mkdtemp(join(tmpdir(), 'aipoch-ui-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
async function internal(directory: string) { return JSON.parse(await readFile(join(directory, 'internal/catalog.json'), 'utf8')) as { snapshot_id: string; generated_at: string; catalog: CatalogData }; }
async function alternateEncoding(directory: string, mutate?: (browse: { catalog: CatalogData }) => void): Promise<UiManifestReference> {
  const full = await internal(directory), artifact = createUiArtifact(full.catalog, full.snapshot_id, full.generated_at);
  const browse = JSON.parse(artifact.files.get('browse.json')!.toString()); mutate?.(browse);
  const browseBytes = Buffer.from(JSON.stringify(browse, null, 2) + '\n');
  const identity = { schema_version: 1 as const, snapshot_id: full.snapshot_id, generated_at: full.generated_at, files: { ...artifact.manifest.files, browse: { href: 'browse.json', bytes: browseBytes.length, sha256: sha256(browseBytes) } } };
  const hash = uiManifestHash(identity), manifestBytes = Buffer.from(JSON.stringify({ ...identity, projection_hash: hash }, null, 2) + '\n');
  const root = join(directory, uiDirectory(full.snapshot_id, hash)); await mkdir(root, { recursive: true });
  await writeFile(join(root, 'manifest.json'), manifestBytes); await writeFile(join(root, 'browse.json'), browseBytes); await writeFile(join(root, 'search.json'), artifact.files.get('search.json')!);
  const reference: UiManifestReference = { schema_version: 1, snapshot_id: full.snapshot_id, projection_hash: hash, href: `${uiDirectory(full.snapshot_id, hash)}/manifest.json`, bytes: manifestBytes.length, sha256: sha256(manifestBytes) };
  await writeFile(join(directory, 'internal/ui-manifest.json'), stableJson(reference));
  return reference;
}
const metric = (value: number, at = NOW) => ({ value, observed_at: at, last_attempt_at: at, result: 'ok' as const, visibility: 'public_api' as const });

test('display projection preserves multi-source metric filtering, ranks, unknown/stale dates and identity at 1,000 projects', () => {
  const { registry, batch } = fixture(), catalog = normalize(registry, batch).catalog;
  const source = catalog.sources[0];
  source.github_metrics = { stars: metric(150), forks: metric(1) };
  source.observation = { last_success_at: NOW, last_attempt_at: NOW, result: 'ok' };
  source.source_activity = { default_branch_head: { sha: 'a'.repeat(40), committed_at: NOW, observed_at: NOW, date_status: 'valid' }, observation: source.observation };
  const second: SourceRepository = { ...structuredClone(source), id: 'source:github:102', provider_id: 102, github_metrics: { stars: metric(1), forks: metric(150) } };
  catalog.sources.push(second);
  catalog.projects[0].source_refs.push({ source_id: second.id, role: 'implementation' });
  catalog.resources[0].source_refs.push({ source_id: second.id, role: 'implementation' });
  catalog.actors[0].github_metrics = { followers: metric(25) };
  catalog.actors[0].observation = source.observation;
  catalog.projects = Array.from({ length: 1000 }, (_, i) => ({ ...structuredClone(catalog.projects[0]), id: `project:synthetic-${i}`, title: i % 2 ? 'Same title' : `Entry ${i}`, catalog_dates: { first_published: { basis: i % 3 === 0 ? 'exact' : i % 3 === 1 ? 'observed_bound' : 'unknown', ...(i % 3 !== 2 ? { value: NOW } : {}) }, content_updated: { basis: 'unknown' } } }));
  const projected = browseProjection(catalog, 'a'.repeat(24), NOW).catalog;
  const queries = ['', 'sort=title', 'sort=stars', 'sort=source_activity', 'sort=added', 'sort=catalog_updated', 'sort=followers', 'min_stars=100', 'min_stars=100&min_forks=100', 'organization=actor%3Agithub%3A90&min_stars=100', 'observation=fresh', 'observation=missing', 'access=pinned', 'access=unknown', 'added_date=unknown', 'added_after=2026-09-12', 'source_after=2026-09-12', 'min_followers=20', 'min_stars=100&include_stale_metrics=1'];
  for (const at of [NOW, '2026-09-16T08:00:00Z', '2026-09-21T08:00:00Z']) for (const query of queries) {
    const filters = parseDiscovery(new URLSearchParams(query), 'all', at);
    const select = (data: CatalogData) => allEntries(data).filter(row => matchesDiscovery(row, data, filters)).sort((a, b) => compareDiscovery(a, b, data, filters)).map(row => [row.id, representativeSource(row, data, filters)?.id]);
    assert.deepEqual(select(projected), select(catalog), `${at}: ${query}`);
    const optimized = allEntries(projected).filter(row => matchesDiscovery(row, projected, filters)).sort(makeDiscoveryComparator(projected,filters)).map(row => [row.id, representativeSource(row,projected,filters)?.id]);
    assert.deepEqual(optimized,select(catalog), `cached projection ${at}: ${query}`);
  }
  assert.equal(allEntries(projected).filter(row => matchesDiscovery(row, projected, parseDiscovery(new URLSearchParams('min_stars=100&min_forks=100'), 'all', NOW))).length, 0, 'different sources cannot lend each other popularity');
});

test('projection is explicitly browse-only and strips evidence and runtime instructions without changing full compatibility files', async t => {
  const root = await temp(t), { registry, batch } = fixture();
  await generate(registry, batch, root);
  const full = await internal(root), artifact = createUiArtifact(full.catalog, full.snapshot_id, full.generated_at);
  const browse = JSON.parse(artifact.files.get('browse.json')!.toString());
  assert.equal(browse.data_kind, 'browse'); assert.equal(browse.schema_version, 1);
  assert.deepEqual(browse.catalog.projects[0].provenance, {});
  assert.deepEqual(browse.catalog.claims, []); assert.deepEqual(browse.catalog.relations, []);
  assert.equal(browse.catalog.sources[0].readme, undefined);
  assert.ok(Object.keys(full.catalog.projects[0].provenance).length > 0);
  assert.equal((await internal(root)).catalog.resources[0].runtime.status, full.catalog.resources[0].runtime.status);
  assert.deepEqual(await verifyUiPublication(root, JSON.parse(await readFile(join(root, 'catalog/v1/history.json'), 'utf8')), full.catalog, full.snapshot_id, full.generated_at).then(row => row.reference), artifact.reference);
});

test('same snapshot can retain byte-distinct verified projections; pinned URLs do not change their bytes on rebuild', async t => {
  const root = await temp(t), { registry, batch } = fixture();
  await generate(registry, batch, root);
  const full = await internal(root), artifact = createUiArtifact(full.catalog, full.snapshot_id, full.generated_at);
  const oldBrowse = Buffer.from(JSON.stringify(JSON.parse(artifact.files.get('browse.json')!.toString()), null, 2) + '\n');
  const identity = { schema_version: 1 as const, snapshot_id: full.snapshot_id, generated_at: full.generated_at, files: { ...artifact.manifest.files, browse: { href: 'browse.json', bytes: oldBrowse.length, sha256: sha256(oldBrowse) } } };
  const hash = uiManifestHash(identity), alternate: UiManifest = { ...identity, projection_hash: hash }, directory = join(root, uiDirectory(full.snapshot_id, hash));
  assert.notEqual(hash, artifact.manifest.projection_hash);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'manifest.json'), stableJson(alternate)); await writeFile(join(directory, 'browse.json'), oldBrowse); await writeFile(join(directory, 'search.json'), artifact.files.get('search.json')!);
  await generate(registry, batch, root);
  assert.deepEqual(await readFile(join(directory, 'browse.json')), oldBrowse);
  assert.equal((await readdir(join(root, 'internal/ui/v1', full.snapshot_id))).length, 2);
  await readUiArtifact(directory, full.catalog, full.snapshot_id, hash, full.generated_at);
});

test('corrupted or semantically modified history fails closed even when hashes are recomputed', async t => {
  const root = await temp(t), { registry, batch } = fixture();
  await generate(registry, batch, root);
  const full = await internal(root), reference = JSON.parse(await readFile(join(root, 'internal/ui-manifest.json'), 'utf8')) as UiManifestReference;
  const directory = join(root, uiDirectory(reference.snapshot_id, reference.projection_hash));
  const original = await readFile(join(directory, 'browse.json'));
  await writeFile(join(directory, 'browse.json'), 'broken');
  await assert.rejects(generate(registry, batch, root), /bytes or hash differ/);
  await writeFile(join(directory, 'browse.json'), original);
  const artifact = createUiArtifact(full.catalog, full.snapshot_id, full.generated_at), changed = JSON.parse(original.toString()); changed.catalog.projects[0].title = 'Unreviewed';
  const content = Buffer.from(stableJson(changed));
  const identity = { schema_version: 1 as const, snapshot_id: full.snapshot_id, generated_at: full.generated_at, files: { ...artifact.manifest.files, browse: { href: 'browse.json', bytes: content.length, sha256: sha256(content) } } };
  const hash = uiManifestHash(identity), alternate = join(root, uiDirectory(full.snapshot_id, hash));
  await mkdir(alternate, { recursive: true });
  await writeFile(join(alternate, 'manifest.json'), stableJson({ ...identity, projection_hash: hash })); await writeFile(join(alternate, 'browse.json'), content); await writeFile(join(alternate, 'search.json'), artifact.files.get('search.json')!);
  await assert.rejects(generate(registry, batch, root), /differs from its public snapshot/);
  assert.deepEqual(await readFile(join(directory, 'browse.json')), original, 'failed build preserves previous directory');
});

test('retirement removes every UI projection together with its public snapshot and validation rejects resurrection', async t => {
  const root = await temp(t), { registry, batch } = fixture();
  const old = await generate(registry, batch, root);
  const oldFull = await internal(root), oldArtifact = createUiArtifact(oldFull.catalog, oldFull.snapshot_id, oldFull.generated_at);
  registry.withdrawals.push({ id: 'source:github:101', withdrawn_at: NOW, reason: 'withdrawn' });
  await generate(registry, batch, root);
  const current = await internal(root), ledger = JSON.parse(await readFile(join(root, 'catalog/v1/history.json'), 'utf8')) as SnapshotHistory;
  assert.equal(ledger.snapshots.find(row => row.snapshot_id === old.snapshot_id)?.status, 'withdrawn');
  assert.ok(!(await readdir(join(root, 'internal/ui/v1'))).includes(old.snapshot_id));
  const badDirectory = join(root, uiDirectory(old.snapshot_id, oldArtifact.manifest.projection_hash)); await mkdir(badDirectory, { recursive: true });
  for (const [name, bytes] of oldArtifact.files) await writeFile(join(badDirectory, name), bytes);
  await assert.rejects(verifyUiPublication(root, ledger, current.catalog, current.snapshot_id, current.generated_at), /retired snapshots/);
  const scratch = await temp(t); await retainUiHistory(root, scratch, ledger);
  await assert.rejects(readFile(join(scratch, oldArtifact.reference.href)), /ENOENT/);
});

test('trusted candidate restore retains immutable UI history across another build and omits retired projections', async t => {
  const { restoreHistory } = await import('../../scripts/restore-refresh.js');
  const root = await temp(t), restored = await temp(t), next = await temp(t), final = await temp(t), { registry, batch } = fixture();
  const first = await generate(registry, batch, root);
  const originalReference = JSON.parse(await readFile(join(root, 'internal/ui-manifest.json'), 'utf8')) as UiManifestReference;
  await restoreHistory(root, restored);
  assert.deepEqual(await readFile(join(restored, originalReference.href)), await readFile(join(root, originalReference.href)));
  batch.as_of = '2026-09-12T09:00:00.000Z';
  await generate(registry, batch, next, 200, { historyDirectory: restored });
  assert.deepEqual(await readFile(join(next, originalReference.href)), await readFile(join(root, originalReference.href)));
  registry.withdrawals.push({ id: 'source:github:101', withdrawn_at: batch.as_of, reason: 'withdrawn' });
  await generate(registry, batch, final, 200, { historyDirectory: next });
  assert.ok(!(await readdir(join(final, 'internal/ui/v1'))).includes(first.snapshot_id));
  await restoreHistory(final, restored);
  assert.ok(!(await readdir(join(restored, 'internal/ui/v1'))).includes(first.snapshot_id));
  // Old candidates remain a supported bootstrap, whereas half-migrated UI candidates do not.
  await rm(join(root, 'internal/ui'), { recursive: true });
  await assert.rejects(restoreHistory(root, restored), /ENOENT/);
  await rm(join(root, 'internal/ui-manifest.json'));
  await restoreHistory(root, restored);
  await assert.rejects(readFile(join(restored, originalReference.href)), /ENOENT/);
});

test('trusted restore accepts a prior current projection encoding while new candidates remain byte deterministic', async t => {
  const { restoreHistory } = await import('../../scripts/restore-refresh.js');
  const root = await temp(t), restored = await temp(t), next = await temp(t), { registry, batch } = fixture();
  await generate(registry, batch, root);
  const full = await internal(root), expected = createUiArtifact(full.catalog, full.snapshot_id, full.generated_at);
  const reference = await alternateEncoding(root);
  assert.notEqual(reference.projection_hash, expected.reference.projection_hash);
  const history = JSON.parse(await readFile(join(root, 'catalog/v1/history.json'), 'utf8')) as SnapshotHistory;
  await assert.rejects(verifyUiPublication(root, history, full.catalog, full.snapshot_id, full.generated_at), /reference differs from deterministic build/);
  await restoreHistory(root, restored);
  assert.deepEqual(JSON.parse(await readFile(join(restored, 'internal/ui-manifest.json'), 'utf8')), reference);
  assert.deepEqual(await readFile(join(restored, reference.href)), await readFile(join(root, reference.href)));
  await generate(registry, batch, next, 200, { historyDirectory: restored });
  assert.deepEqual(await readFile(join(next, reference.href)), await readFile(join(root, reference.href)), 'old HTML keeps its exact manifest bytes');
  assert.deepEqual((await verifyUiPublication(next, history, full.catalog, full.snapshot_id, full.generated_at)).reference, expected.reference);
});

test('trusted restore rejects malformed or falsely bound historical references and semantic changes', async t => {
  const { restoreHistory } = await import('../../scripts/restore-refresh.js');
  const root = await temp(t), restored = await temp(t), { registry, batch } = fixture();
  await generate(registry, batch, root);
  const reference = await alternateEncoding(root);
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ ...reference, extra: true }, /Unknown browser projection reference fields/],
    [{ ...reference, schema_version: 2 }, /reference identity differs/],
    [{ ...reference, snapshot_id: '0'.repeat(24) }, /reference identity differs/],
    [{ ...reference, projection_hash: [reference.projection_hash] }, /reference identity differs/],
    [{ ...reference, href: '../manifest.json' }, /Invalid browser projection reference descriptor/],
    [{ ...reference, href: reference.href.replace(reference.projection_hash, '0'.repeat(64)) }, /Invalid browser projection reference descriptor/],
    [{ ...reference, bytes: reference.bytes + 1 }, /reference bytes or hash differ/],
    [{ ...reference, sha256: '0'.repeat(64) }, /reference bytes or hash differ/],
  ];
  for (const [pointer, error] of cases) {
    await writeFile(join(root, 'internal/ui-manifest.json'), stableJson(pointer));
    await assert.rejects(restoreHistory(root, restored), error);
  }
  await writeFile(join(root, 'internal/ui-manifest.json'), stableJson(reference));
  await restoreHistory(root, restored);
  await alternateEncoding(root, browse => { browse.catalog.projects[0].title = 'Unreviewed semantic change'; });
  await assert.rejects(restoreHistory(root, restored), /differs from its public snapshot/);
});
