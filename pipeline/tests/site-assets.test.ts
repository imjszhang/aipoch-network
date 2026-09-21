import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSiteAssets, readSiteAssets } from '../site-assets.js';
import type { SnapshotHistory } from '../history.js';
import { stableJson } from '../json.js';
import { generate } from '../build.js';
import { restoreHistory } from '../../scripts/restore-refresh.js';
const FIRST = 'a'.repeat(24), NEXT = 'b'.repeat(24), NOW = '2026-09-21T00:00:00.000Z';
const ledger = (current = FIRST, retired = false): SnapshotHistory => ({ version: 1, current_snapshot_id: current, checked_at: NOW, snapshots: [...new Set([FIRST,current])].map(snapshot_id => ({ snapshot_id, status: retired && snapshot_id !== current ? 'withdrawn' : 'available', checked_at: NOW })) });
async function temp(t: TestContext) { const root = await mkdtemp(join(tmpdir(), 'aipoch-assets-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
async function output(root: string, stem: string, license: string, history: SnapshotHistory) {
  await mkdir(join(root, 'assets'), { recursive: true }); await mkdir(join(root, 'catalog/v1'), { recursive: true });
  await writeFile(join(root, `assets/${stem}-abcdefgh.js`), `export const release = '${stem}';`);
  await writeFile(join(root, `assets/${stem}-abcdefgh.css`), `body{--release:${stem}}`);
  await writeFile(join(root, 'third-party-notices.txt'), license);
  await writeFile(join(root, 'catalog/v1/history.json'), stableJson(history));
}
test('two releases retain exact hashed bundle addresses and all applicable license notices', async t => {
  const first = await temp(t), next = await temp(t);
  await output(first, 'first', 'First package license\n', ledger()); await prepareSiteAssets(first, undefined, ledger());
  await output(next, 'next', 'Second package license\n', ledger(NEXT)); await prepareSiteAssets(next, first, ledger(NEXT));
  assert.deepEqual(await readFile(join(next, 'assets/first-abcdefgh.js')), await readFile(join(first, 'assets/first-abcdefgh.js')));
  const inventory = await readSiteAssets(next, ledger(NEXT)); assert.equal(inventory?.manifest.assets.length, 4); assert.equal(inventory?.manifest.notices.length, 2);
  const notices = await readFile(join(next, 'third-party-notices.txt'), 'utf8'); assert.match(notices, /First package license/); assert.match(notices, /Second package license/);
});
test('retired snapshots retain neither historical code nor licenses, while shared identical code associates with new snapshot', async t => {
  const first = await temp(t), next = await temp(t), retired = await temp(t);
  await output(first, 'first', 'First license\n', ledger()); await prepareSiteAssets(first, undefined, ledger());
  await output(next, 'first', 'First license\n', ledger(NEXT)); await prepareSiteAssets(next, first, ledger(NEXT));
  assert.deepEqual((await readSiteAssets(next, ledger(NEXT)))!.manifest.assets[0].snapshots, [FIRST,NEXT]);
  await output(retired, 'replacement', 'Replacement license\n', ledger(NEXT, true)); await prepareSiteAssets(retired, first, ledger(NEXT, true));
  assert.ok(!(await readdir(join(retired, 'assets'))).includes('first-abcdefgh.js'));
  assert.doesNotMatch(await readFile(join(retired, 'third-party-notices.txt'), 'utf8'), /First license/);
});
test('altered history, conflicting immutable filenames and unsafe inventory paths fail before publication', async t => {
  const first = await temp(t), next = await temp(t); await output(first, 'first', 'License\n', ledger()); await prepareSiteAssets(first, undefined, ledger());
  const js = join(first, 'assets/first-abcdefgh.js'), original = await readFile(js); await writeFile(js, 'altered code');
  await assert.rejects(readSiteAssets(first, ledger()), /bytes or hash differ/); await writeFile(js, original);
  await output(next, 'first', 'License\n', ledger(NEXT)); await writeFile(join(next, 'assets/first-abcdefgh.js'), 'different bytes at same hash filename');
  await assert.rejects(prepareSiteAssets(next, first, ledger(NEXT)), /Immutable bundle address/);
  const manifestFile = join(first, 'internal/site-assets.json'), manifest = JSON.parse(await readFile(manifestFile, 'utf8')); manifest.assets[0].href = '../secret.js'; await writeFile(manifestFile, stableJson(manifest));
  await assert.rejects(readSiteAssets(first, ledger()), /Unexpected or duplicated/);
});
test('legacy outputs without an inventory are not trusted as a source of executable retained bundles', async t => {
  const first = await temp(t), next = await temp(t); await output(first, 'legacy', 'Old license\n', ledger());
  await output(next, 'new', 'New license\n', ledger(NEXT)); await prepareSiteAssets(next, first, ledger(NEXT));
  assert.ok(!(await readdir(join(next, 'assets'))).includes('legacy-abcdefgh.js'));
});
test('trusted restore carries the verified site asset inventory into the next build', async t => {
  const first = await temp(t), restored = await temp(t), next = await temp(t);
  const registry = { version: 1 as const, sources: [], projects: [], resources: [], collections: [], withdrawals: [] };
  const current = await generate(registry, { as_of: NOW, sources: [] }, first);
  const history = JSON.parse(await readFile(join(first, 'catalog/v1/history.json'), 'utf8')) as SnapshotHistory;
  await output(first, 'first', 'First license\n', history); await prepareSiteAssets(first, undefined, history);
  await restoreHistory(first, restored);
  assert.deepEqual(await readFile(join(restored, 'assets/first-abcdefgh.js')), await readFile(join(first, 'assets/first-abcdefgh.js')));
  await generate(registry, { as_of: '2026-09-21T01:00:00.000Z', sources: [] }, next, 200, { historyDirectory: restored });
  const nextHistory = JSON.parse(await readFile(join(next, 'catalog/v1/history.json'), 'utf8')) as SnapshotHistory;
  await output(next, 'next', 'Next license\n', nextHistory); await prepareSiteAssets(next, restored, nextHistory);
  const retained = await readSiteAssets(next, nextHistory);
  assert.ok(retained?.manifest.assets.find(row => row.href === 'assets/first-abcdefgh.js')?.snapshots.includes(current.snapshot_id));
});
