import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCatalogDates, appendPublicationReceipt, buildPublicationIndex, catalogDatesDryRun, checkpointPublicationLedger, contentFingerprint, readPublicationLedger, validatePublicationLedger, validatePublicationReceipt, writePublicationLedger, type PublicationLedger, type PublicationReceipt } from '../catalog-dates.js';
import { normalize, type SnapshotBatch } from '../normalize.js';
import type { Registry } from '../registry.js';

const T = '2026-09-12T10:00:00Z';
const T2 = '2026-09-13T10:00:00Z';
const SHA = 'a'.repeat(40);
const URL = 'https://github.com/example/tool';
function fixture() {
  const registry: Registry = { version: 1, sources: [{ url: URL, reviewed_at: T, review_note: 'Synthetic public fixture' }], projects: [{ key: 'p', title: 'Study', domains: ['A', 'B'], sources: [URL], resources: ['r'] }], resources: [{ key: 'r', title: 'Tool', type: 'tool', domains: ['A', 'B'], sources: [URL], inputs: ['two', 'one'] }], collections: [{ key: 'c', title: 'Collection', selection_basis: 'Reviewed relevance', item_ids: ['project:p', 'resource:r'] }], withdrawals: [] };
  const batch: SnapshotBatch = { as_of: T, sources: [{ requested_url: URL, checked_at: T, observed_at: T, availability: 'accessible', suppressed: false, repository: { id: 1, name: 'tool', full_name: 'example/tool', html_url: URL, description: 'Observed description', default_branch: 'main', archived: false, fork: false, owner: { id: 2, login: 'example', type: 'Organization', html_url: 'https://github.com/example' }, topics: ['A', 'B'], license: { spdx_id: 'MIT', url: `${URL}/blob/${SHA}/LICENSE` }, updated_at: T, has_issues: true, has_discussions: false, commit: SHA } }] };
  return { registry, batch, catalog: normalize(registry, batch).catalog };
}
function receipt(index = buildPublicationIndex(fixture().catalog, fixture().registry), overrides: Partial<PublicationReceipt> = {}): PublicationReceipt {
  return { ...index, repository: 'example/network', deployment_run_id: 100, deployment_run_attempt: 1, refresh_run_id: 90, source_sha: SHA, snapshot_id: 'a'.repeat(24), artifact_sha256: `sha256:${'b'.repeat(64)}`, file_tree_sha256: `sha256:${'c'.repeat(64)}`, deployed_at: T, evidence: 'https://github.com/example/network/actions/runs/100/attempts/1', ...overrides };
}
function ledger(receipts = [receipt()], coverage: 'complete' | 'partial' = 'complete'): PublicationLedger { return { version: 1, fingerprint_version: 1, repository: 'example/network', coverage, releases: receipts }; }

test('publication evidence distinguishes exact first publication, content observation bound, and absent history', () => {
  const { catalog, registry } = fixture();
  const published = applyCatalogDates(catalog, registry, ledger());
  assert.deepEqual(published.projects[0].catalog_dates?.first_published, { value: T, basis: 'exact', evidence: receipt().evidence });
  assert.deepEqual(published.projects[0].catalog_dates?.content_updated, { value: T, basis: 'observed_bound', evidence: receipt().evidence });
  assert.equal(applyCatalogDates(catalog, registry, ledger([receipt()], 'partial')).projects[0].catalog_dates?.first_published.basis, 'observed_bound');
  assert.deepEqual(applyCatalogDates(catalog, registry).projects[0].catalog_dates, { first_published: { basis: 'unknown' }, content_updated: { basis: 'unknown' } });
  assert.equal(catalog.projects[0].catalog_dates, undefined, 'The input catalog is not mutated');
  assert.deepEqual(published.actors[0].catalog_dates?.first_published, published.organizations[0].catalog_dates?.first_published, 'One GitHub identity shares its first publication date');
});

test('metric refresh, moving HEAD, provenance time and unordered sets do not advance content', () => {
  const { catalog, registry } = fixture();
  const before = buildPublicationIndex(catalog, registry);
  const after = structuredClone(catalog);
  after.sources[0].latest_commit = 'd'.repeat(40); after.sources[0].stars = 100;
  after.sources[0].github_metrics = { stars: { value: 100, observed_at: T2, last_attempt_at: T2, result: 'ok', visibility: 'public_api' } };
  after.sources[0].observed_at = T2; after.sources[0].updated_at = T2;
  after.sources[0].license.url = `${URL}/blob/${'d'.repeat(40)}/LICENSE`;
  after.sources[0].topics?.reverse(); after.resources[0].inputs?.reverse();
  for (const item of [...after.projects, ...after.resources]) { item.domains.reverse(); item.source_refs[0].commit = 'd'.repeat(40); item.source_refs[0].resolved_at = T2; item.updated_at = T2; }
  after.collections[0].item_ids.reverse();
  after.projects[0].provenance.title[0].observed_at = T2;
  assert.deepEqual(buildPublicationIndex(after, registry), before);
  assert.equal(applyCatalogDates(after, registry, ledger()).projects[0].catalog_dates?.content_updated.value, T);
});

test('unpublished edits, including a later revert, are reconciled against the last published fingerprint', () => {
  const { catalog, registry } = fixture();
  const edited = structuredClone(catalog); edited.projects[0].description = 'Unpublished change';
  const pending = applyCatalogDates(edited, registry, ledger());
  assert.equal(pending.projects[0].catalog_dates?.content_updated.basis, 'unknown');
  const reverted = applyCatalogDates(catalog, registry, ledger());
  assert.equal(reverted.projects[0].catalog_dates?.content_updated.value, T);
  const changedRelease = receipt(buildPublicationIndex(edited, registry), { deployment_run_id: 101, deployed_at: T2, evidence: 'https://github.com/example/network/actions/runs/101/attempts/1' });
  assert.equal(applyCatalogDates(edited, registry, ledger([receipt(), changedRelease])).projects[0].catalog_dates?.content_updated.value, T2);
  assert.equal(applyCatalogDates(edited, registry, ledger([receipt(), changedRelease])).resources[0].catalog_dates?.content_updated.value, T);
});

test('curated pins and fixed refs remain material, including source URL resolution without source_id', () => {
  const { catalog, registry } = fixture();
  const first = contentFingerprint(catalog.resources[0], catalog, registry);
  registry.resources[0].source_refs = [{ source_url: URL, role: 'primary', ref: 'reviewed-v1' }];
  assert.notEqual(contentFingerprint(catalog.resources[0], catalog, registry), first);
  const refHash = contentFingerprint(catalog.resources[0], catalog, registry);
  registry.resources[0].source_refs[0].ref = 'reviewed-v2';
  assert.notEqual(contentFingerprint(catalog.resources[0], catalog, registry), refHash);
  registry.resources[0].source_refs[0] = { source_id: 'source:github:1', source_url: URL, role: 'primary', commit: SHA };
  const pinnedHash = contentFingerprint(catalog.resources[0], catalog, registry);
  registry.resources[0].source_refs[0].commit = 'e'.repeat(40); catalog.resources[0].source_refs[0].commit = 'e'.repeat(40);
  assert.notEqual(contentFingerprint(catalog.resources[0], catalog, registry), pinnedHash);
  const licenseHash = contentFingerprint(catalog.sources[0], catalog, registry); catalog.sources[0].license.spdx_id = 'GPL-3.0';
  assert.notEqual(contentFingerprint(catalog.sources[0], catalog, registry), licenseHash);
});

test('membership, classification, fallback description and relationship changes are material', () => {
  const { catalog, registry } = fixture();
  for (const change of [
    () => { catalog.projects[0].domains.push('C'); },
    () => { catalog.projects[0].description = 'Changed upstream fallback'; },
    () => { catalog.projects[0].resource_ids = []; },
    () => { catalog.relations.push({ kind: 'relation', id: 'relation:test', from_id: 'project:p', to_id: 'resource:r', type: 'uses', recorded_at: T, evidence: [] }); },
  ]) { const before = contentFingerprint(catalog.projects[0], catalog, registry); change(); assert.notEqual(contentFingerprint(catalog.projects[0], catalog, registry), before); }
});

test('withdrawn identities are not resurrected; relisting preserves original identity dates', () => {
  const { catalog, registry } = fixture();
  const removed = structuredClone(catalog); removed.projects = []; removed.resources[0].project_ids = []; removed.collections[0].item_ids = ['resource:r'];
  const withdrawalRelease = receipt(buildPublicationIndex(removed, registry), { deployment_run_id: 101, deployed_at: T2, evidence: 'https://github.com/example/network/actions/runs/101/attempts/1' });
  const prior = ledger([receipt(), withdrawalRelease]);
  assert.equal(applyCatalogDates(removed, registry, prior).projects.length, 0);
  const relistedRelease = receipt(buildPublicationIndex(catalog, registry), { deployment_run_id: 102, deployed_at: '2026-09-14T10:00:00Z', evidence: 'https://github.com/example/network/actions/runs/102/attempts/1' });
  const compact = checkpointPublicationLedger(ledger([receipt(), withdrawalRelease, relistedRelease]));
  const row = compact.checkpoint?.entries.find(entry => entry.id === 'project:p');
  assert.equal(row?.first_published.value, T); assert.equal(row?.relisted_at, relistedRelease.deployed_at);
  const newIdentity = structuredClone(catalog); newIdentity.projects[0].id = 'project:new';
  assert.equal(applyCatalogDates(newIdentity, registry, prior).projects[0].catalog_dates?.first_published.basis, 'unknown');
});

test('receipt replay and reviewed checkpoint are idempotent and preserve date decisions', () => {
  const { catalog, registry } = fixture(); const prior = ledger();
  assert.deepEqual(appendPublicationReceipt(prior, receipt()), prior);
  assert.throws(() => appendPublicationReceipt(prior, receipt(undefined, { snapshot_id: 'd'.repeat(24) })), /Conflicting/);
  const compact = checkpointPublicationLedger(prior);
  assert.deepEqual(checkpointPublicationLedger(compact), compact);
  assert.deepEqual(applyCatalogDates(catalog, registry, compact), applyCatalogDates(catalog, registry, prior));
  assert.throws(() => appendPublicationReceipt(compact, receipt()), /checkpoint/);
  const dated = applyCatalogDates(catalog, registry, prior);
  assert.ok(catalogDatesDryRun(dated, registry, prior).every(row => !row.changed));
});

test('mixed millisecond and whole-second timestamps preserve actual publication chronology', () => {
  const { catalog, registry } = fixture();
  const earlier = receipt(undefined, { deployed_at: '2026-09-12T10:00:00Z' });
  const changed = structuredClone(catalog); changed.projects[0].title = 'Published half a second later';
  const later = receipt(buildPublicationIndex(changed, registry), { deployment_run_id: 101, deployed_at: '2026-09-12T10:00:00.500Z', evidence: 'https://github.com/example/network/actions/runs/101/attempts/1' });
  const unordered = ledger([later, earlier]);
  const dated = applyCatalogDates(changed, registry, unordered).projects[0].catalog_dates;
  assert.equal(dated?.first_published.value, earlier.deployed_at);
  assert.equal(dated?.content_updated.value, later.deployed_at);
  assert.equal(checkpointPublicationLedger(unordered).checkpoint?.through, later.deployed_at);
  const checkpoint = checkpointPublicationLedger(ledger([earlier]));
  assert.deepEqual(appendPublicationReceipt(checkpoint, later).releases, [later]);
  assert.deepEqual(appendPublicationReceipt(ledger([later]), earlier).releases, [earlier, later]);
});

test('strict receipt/ledger validation rejects forged shape, mismatched evidence, duplicates, and future dates', () => {
  for (const invalid of [
    { ...receipt(), deployed_at: '2099-01-01T00:00:00Z' },
    { ...receipt(), evidence: 'https://github.com/other/network/actions/runs/100/attempts/1' },
    { ...receipt(), private_payload: 'forbidden' },
    { ...receipt(), entries: [...receipt().entries, receipt().entries[0]] },
    { ...receipt(), entries: [{ id: 'project:p', kind: 'source_repository', fingerprint: 'a'.repeat(64) }] },
    { ...receipt(), deployed_at: '2026-02-30T00:00:00Z' },
    { ...receipt(), source_sha: 'main' },
  ]) assert.throws(() => validatePublicationReceipt(invalid));
  assert.throws(() => validatePublicationLedger(ledger([receipt(), receipt()])), /Duplicate/);
  assert.throws(() => validatePublicationLedger({ ...ledger(), checkpoint: { through: T2, entries: [] } }), /overlaps/);
});

test('ledger reads are bounded, strict, and repeat applications are a filesystem no-op', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aipoch-publication-test-'));
  try {
    const path = join(directory, 'ledger.json'); assert.equal(await readPublicationLedger(path), undefined);
    assert.equal(await writePublicationLedger(path, ledger()), true); const first = await readFile(path, 'utf8');
    assert.equal(await writePublicationLedger(path, ledger()), false); assert.equal(await readFile(path, 'utf8'), first);
    assert.deepEqual(await readPublicationLedger(path), ledger());
    await writeFile(path, JSON.stringify({ version: 2 })); await assert.rejects(readPublicationLedger(path), /schema/);
    await writeFile(path, ' '.repeat(8_000_001)); await assert.rejects(readPublicationLedger(path), /file/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
