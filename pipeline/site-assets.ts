import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SnapshotHistory } from './history.js';
import { sha256, stableJson } from './json.js';

export const MAX_SITE_ASSET_BYTES = 16 * 1024 * 1024;
export const MAX_SITE_NOTICE_BYTES = 1_000_000;
const HASHED_BUNDLE = /^assets\/[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]{8,}\.(?:js|css)$/;
const NOTICE = /^assets\/notices-([a-f0-9]{64})\.txt$/;
const SNAPSHOT = /^[a-f0-9]{24}$/;
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export interface SiteAssetPart { href: string; bytes: number; sha256: string; snapshots: string[] }
export interface SiteAssets { version: 1; current_snapshot_id: string; assets: SiteAssetPart[]; notices: SiteAssetPart[] }
const inventoryPath = 'internal/site-assets.json';
async function bounded(directory: string, href: string, maximum: number) {
  const file = join(directory, href), stat = await lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, 'Invalid or oversized retained site asset');
  const bytes = await readFile(file); assert(bytes.length <= maximum, 'Site asset grew beyond its limit'); return bytes;
}
function aggregateNotices(parts: SiteAssetPart[], files: Map<string, Buffer>) {
  return Buffer.from(parts.map(part => files.get(part.href)!.toString('utf8')).join('\n\n' + '='.repeat(72) + '\nRetained browser bundle license notices\n' + '='.repeat(72) + '\n\n'));
}
/** Inventory is restored only from a successful trusted candidate; hashes bind its exact retained executable bytes. */
export async function readSiteAssets(directory: string, history: SnapshotHistory): Promise<{ manifest: SiteAssets; files: Map<string, Buffer> } | undefined> {
  let bytes: Buffer;
  try { bytes = await bounded(directory, inventoryPath, 1024 * 1024); }
  catch (error) { if (absent(error)) return; throw error; }
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as SiteAssets;
  assert(manifest.version === 1 && manifest.current_snapshot_id === history.current_snapshot_id && Array.isArray(manifest.assets) && Array.isArray(manifest.notices), 'Invalid site asset inventory');
  assert.deepEqual(Object.keys(manifest).sort(), ['assets','current_snapshot_id','notices','version'], 'Unknown site asset inventory fields');
  const available = new Set(history.snapshots.filter(row => row.status === 'available').map(row => row.snapshot_id));
  assert(available.has(manifest.current_snapshot_id), 'Current site asset snapshot is retired');
  const files = new Map<string, Buffer>([[inventoryPath, bytes]]); let total = 0, noticeBytes = 0;
  assert(manifest.assets.length <= 4096 && manifest.notices.length > 0 && manifest.notices.length <= 256, 'Site asset inventory exceeds item limits');
  for (const [kind, parts] of [['assets',manifest.assets], ['notices',manifest.notices]] as const) for (const part of parts) {
    assert(part && (kind === 'assets' ? HASHED_BUNDLE.test(part.href) : NOTICE.test(part.href)) && !files.has(part.href), 'Unexpected or duplicated retained asset path');
    assert.deepEqual(Object.keys(part).sort(), ['bytes','href','sha256','snapshots'], 'Unknown site asset descriptor fields');
    assert(Number.isSafeInteger(part.bytes) && part.bytes > 0 && part.bytes <= (kind === 'assets' ? MAX_SITE_ASSET_BYTES : MAX_SITE_NOTICE_BYTES) && /^[a-f0-9]{64}$/.test(part.sha256), 'Invalid site asset descriptor');
    assert(Array.isArray(part.snapshots) && part.snapshots.length > 0 && new Set(part.snapshots).size === part.snapshots.length && part.snapshots.every(id => SNAPSHOT.test(id) && available.has(id)), 'Retired or invalid snapshot retains site assets');
    if (kind === 'notices') assert(part.href === `assets/notices-${part.sha256}.txt`, 'Notice content address differs');
    const content = await bounded(directory, part.href, part.bytes);
    assert(content.length === part.bytes && sha256(content) === part.sha256, 'Retained site asset bytes or hash differ');
    if (kind === 'assets') total += content.length; else noticeBytes += content.length;
    assert(total <= MAX_SITE_ASSET_BYTES && noticeBytes <= MAX_SITE_NOTICE_BYTES, 'Retained site assets exceed their byte budget'); files.set(part.href, content);
  }
  const notices = aggregateNotices(manifest.notices, files);
  assert(notices.length <= MAX_SITE_NOTICE_BYTES, 'Combined retained license notices exceed limit');
  assert((await bounded(directory, 'third-party-notices.txt', MAX_SITE_NOTICE_BYTES)).equals(notices), 'Combined license notices differ from retained inventory');
  files.set('third-party-notices.txt', notices);
  return { manifest, files };
}
/** Run after Vite, before prerender validation. Retired snapshot associations never survive into the next inventory. */
export async function prepareSiteAssets(output: string, previous: string | undefined, history: SnapshotHistory) {
  const current = history.current_snapshot_id, available = new Set(history.snapshots.filter(row => row.status === 'available').map(row => row.snapshot_id));
  assert(SNAPSHOT.test(current) && available.has(current), 'Cannot build assets for an unavailable snapshot');
  const files = new Map<string, Buffer>(), assetParts = new Map<string, SiteAssetPart>(), noticeParts = new Map<string, SiteAssetPart>();
  if (previous) {
    let previousHistory: SnapshotHistory | undefined;
    try { previousHistory = JSON.parse((await bounded(previous, 'catalog/v1/history.json', 1024 * 1024)).toString()) as SnapshotHistory; }
    catch (error) { if (!absent(error)) throw error; }
    if (previousHistory) {
      const prior = await readSiteAssets(previous, previousHistory);
      if (prior) for (const [parts, destination] of [[prior.manifest.assets,assetParts],[prior.manifest.notices,noticeParts]] as const) for (const part of parts) {
        const snapshots = part.snapshots.filter(id => available.has(id));
        if (snapshots.length) { destination.set(part.href, { ...part, snapshots }); files.set(part.href, prior.files.get(part.href)!); }
      }
    }
  }
  let names: string[];
  try { names = await readdir(join(output, 'assets')); } catch (error) { if (!absent(error)) throw error; names = []; }
  for (const name of names.sort()) {
    const href = `assets/${name}`; if (!HASHED_BUNDLE.test(href)) continue;
    const content = await bounded(output, href, MAX_SITE_ASSET_BYTES), digest = sha256(content), old = assetParts.get(href);
    assert(!old || old.sha256 === digest && old.bytes === content.length, 'Immutable bundle address would change its bytes');
    files.set(href, content); assetParts.set(href, { href, bytes: content.length, sha256: digest, snapshots: [...new Set([...(old?.snapshots ?? []), current])].sort() });
  }
  const currentNotice = await bounded(output, 'third-party-notices.txt', MAX_SITE_NOTICE_BYTES), digest = sha256(currentNotice), noticeHref = `assets/notices-${digest}.txt`, oldNotice = noticeParts.get(noticeHref);
  files.set(noticeHref, currentNotice); noticeParts.set(noticeHref, { href: noticeHref, bytes: currentNotice.length, sha256: digest, snapshots: [...new Set([...(oldNotice?.snapshots ?? []), current])].sort() });
  const ordered = (parts: Map<string,SiteAssetPart>) => [...parts.values()].sort((a,b) => a.href.localeCompare(b.href, 'en'));
  const manifest: SiteAssets = { version: 1, current_snapshot_id: current, assets: ordered(assetParts), notices: ordered(noticeParts) };
  assert(manifest.assets.reduce((sum, part) => sum + part.bytes, 0) <= MAX_SITE_ASSET_BYTES, 'Retained site assets exceed 16 MiB; review retention explicitly');
  const combined = aggregateNotices(manifest.notices, files); assert(combined.length <= MAX_SITE_NOTICE_BYTES, 'Retained license notices exceed 1 MB; review retention explicitly');
  for (const [href, content] of files) { await mkdir(join(output, href, '..'), { recursive: true }); await writeFile(join(output, href), content); }
  await writeFile(join(output, 'third-party-notices.txt'), combined);
  await mkdir(join(output, 'internal'), { recursive: true }); await writeFile(join(output, inventoryPath), stableJson(manifest));
  return manifest;
}
