import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../build.js';
import type { Registry } from '../registry.js';
import type { SnapshotBatch } from '../normalize.js';
import { COLLECTION_NAMES, validateCatalog, validateManifest, validateShard, emptyCatalog, type CatalogData, type CatalogManifest, type CatalogRecord, type CatalogShard } from '../../spec/index.js';

const NOW = '2026-09-12T08:00:00.000Z';
function fixture(): { registry: Registry; batch: SnapshotBatch } {
  const url = 'https://github.com/lab/research';
  return {
    registry: {
      version: 1, sources: [{ url, reviewed_at: NOW, review_note: 'Synthetic test source.' }],
      projects: [{ key: 'research', title: 'Clinical study', description: 'Curated public study.', domains: ['Clinical research'], sources: [url], resources: ['method', 'workflow', 'data'] }],
      resources: ['method', 'workflow', 'data'].map(key => ({ key, title: `Research ${key}`, description: `Reusable ${key}.`, type: key === 'data' ? 'dataset' : key, domains: ['Clinical research'], sources: [url] })),
      collections: [], withdrawals: [],
    },
    batch: { as_of: NOW, sources: [{
      requested_url: url, checked_at: NOW, observed_at: NOW, availability: 'accessible', suppressed: false,
      repository: {
        id: 101, name: 'research', full_name: 'lab/research', html_url: url, description: 'PUBLIC_SOURCE_DESCRIPTION',
        default_branch: 'main', archived: false, fork: false,
        owner: { id: 90, login: 'lab', type: 'Organization', html_url: 'https://github.com/lab' },
        topics: ['science'], updated_at: NOW, has_issues: true, has_discussions: false,
        commit: 'a'.repeat(40), readme: 'PUBLIC_README_MARKER',
      },
    }] },
  };
}
async function bytesInTree(directory: string): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  async function visit(relative: string): Promise<void> {
    const entries = await readdir(join(directory, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await visit(path);
      else contents[path] = (await readFile(join(directory, path))).toString('base64');
    }
  }
  await visit('');
  return contents;
}

test('fixed independent inputs produce byte-identical builds and snapshot identities', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aipoch-build-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { registry, batch } = fixture();
  const a = join(root, 'first');
  const b = join(root, 'second');
  const first = await generate(registry, batch, a, 2);
  const second = await generate(structuredClone(registry), structuredClone(batch), b, 2);
  assert.deepEqual(first, second);
  assert.deepEqual(await bytesInTree(a), await bytesInTree(b));
  assert.equal(first.generated_at, NOW);
  assert.match(first.snapshot_id, /^[a-f0-9]{24}$/);
});

test('manifest shards have verifiable byte counts and hashes and reconstruct the complete public catalog', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aipoch-shard-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { registry, batch } = fixture();
  const manifest = await generate(registry, batch, root, 2);
  assert.equal(validateManifest(manifest).ok, true);
  assert.equal(manifest.collections.resources.length, 2, 'three resources must span multiple size-two shards');
  const catalog = emptyCatalog();
  for (const name of COLLECTION_NAMES) {
    for (const descriptor of manifest.collections[name]) {
      const bytes = await readFile(join(root, 'catalog/v1', descriptor.href));
      assert.equal(bytes.byteLength, descriptor.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), descriptor.sha256);
      const shard = JSON.parse(bytes.toString('utf8')) as CatalogShard;
      assert.equal(validateShard(shard).ok, true);
      assert.equal(shard.snapshot_id, manifest.snapshot_id);
      assert.equal(shard.collection, name);
      assert.equal(shard.records.length, descriptor.count);
      assert.ok(shard.records.length <= 2);
      (catalog[name] as CatalogRecord[]).push(...shard.records);
    }
  }
  const check = validateCatalog(catalog);
  assert.equal(check.ok, true, check.errors.join('\n'));
  assert.equal(catalog.resources.length, 3);
  assert.equal(catalog.sources[0]?.readme, 'PUBLIC_README_MARKER');

  const snapshotRoot = join(root, 'catalog/v1/snapshots', manifest.snapshot_id);
  const pinned = JSON.parse(await readFile(join(snapshotRoot, 'manifest.json'), 'utf8')) as CatalogManifest;
  assert.equal(validateManifest(pinned).ok, true);
  assert.equal(pinned.snapshot_id, manifest.snapshot_id);
  for (const name of COLLECTION_NAMES) for (const descriptor of pinned.collections[name]) {
    const bytes = await readFile(join(snapshotRoot, descriptor.href));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), descriptor.sha256);
  }
});

test('internal website payload and search index share the catalog revision without exposing full source README', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aipoch-internal-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { registry, batch } = fixture();
  const manifest = await generate(registry, batch, root);
  const webText = await readFile(join(root, 'internal/catalog.json'), 'utf8');
  const web = JSON.parse(webText) as { snapshot_id: string; catalog: CatalogData };
  const search = JSON.parse(await readFile(join(root, 'internal/search.json'), 'utf8')) as { snapshot_id: string };
  assert.equal(web.snapshot_id, manifest.snapshot_id);
  assert.equal(search.snapshot_id, manifest.snapshot_id);
  assert.doesNotMatch(webText, /PUBLIC_README_MARKER/);
  assert.equal(web.catalog.resources.length, 3);
  const report = JSON.parse(await readFile(join(root, 'build-report.json'), 'utf8')) as { inputs_sha256: string; counts: Record<string, number> };
  assert.match(report.inputs_sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.counts.resources, 3);
});

test('invalid registry, invalid generated contract and invalid shard sizing preserve the previous complete output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aipoch-atomic-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = join(root, 'generated');
  const { registry, batch } = fixture();
  await generate(registry, batch, destination);
  const before = await bytesInTree(destination);

  const invalidRegistry = structuredClone(registry);
  invalidRegistry.resources[0]!.title = '';
  await assert.rejects(generate(invalidRegistry, batch, destination), /Invalid resource title/);
  assert.deepEqual(await bytesInTree(destination), before);

  const invalidBatch = structuredClone(batch);
  invalidBatch.sources[0]!.repository!.owner.html_url = 'javascript:alert(1)';
  await assert.rejects(generate(registry, invalidBatch, destination), /Catalog validation failed/);
  assert.deepEqual(await bytesInTree(destination), before);

  await assert.rejects(generate(registry, batch, destination, 0), /Invalid shard size/);
  assert.deepEqual(await bytesInTree(destination), before);
  assert.deepEqual(await readdir(root), ['generated']);
});

test('a withdrawn source is removed from all newly generated public and internal files including the prior snapshot', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aipoch-withdraw-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = join(root, 'generated');
  const { registry, batch } = fixture();
  const before = await generate(registry, batch, destination);
  registry.withdrawals.push({ id: 'source:github:101', withdrawn_at: NOW, reason: 'withdrawn' });
  const after = await generate(registry, batch, destination);
  assert.notEqual(after.snapshot_id, before.snapshot_id);
  const tree = await bytesInTree(destination);
  const allText = Object.values(tree).map(bytes => Buffer.from(bytes, 'base64').toString('utf8')).join('\n');
  assert.doesNotMatch(allText, /PUBLIC_README_MARKER|PUBLIC_SOURCE_DESCRIPTION|https:\/\/github.com\/lab\/research/);
  assert.ok(!Object.keys(tree).some(path => path.includes(before.snapshot_id)));
  assert.deepEqual(await readdir(root), ['generated'], 'no previous or staging copies remain at the managed destination');
  assert.equal(after.collections.sources[0]?.count, 0);
  assert.ok(after.collections.tombstones[0]!.count! >= 4);
});
