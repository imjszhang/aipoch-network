import { build as viteBuild } from 'vite';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { gzipSync } from 'node:zlib';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { stableJson, sha256 } from '../pipeline/build.js';
import { makeSearchIndex, searchDocuments } from '../web/src/search.js';
import { allEntries, routeFor, tombstoneRoutesFor, type SiteData } from '../web/src/model.js';
import { assertValidCatalog, validateManifest, validateShard, emptyCatalog, COLLECTION_NAMES, CONTRACT_VERSION, type CatalogManifest, type CatalogShard, type Provenance } from '../spec/index.js';
import { renderPage } from './render-page.js';
import { validateOutput } from './build.js';

const AT = '2026-09-12T00:00:00.000Z';
const COMMIT = 'a'.repeat(40);
/** Entirely synthetic, contract-valid states; none of these URLs are requested. */
export function verificationData(entryCount = 100, options: { largeCollection?: boolean } = {}): SiteData {
  if (!Number.isSafeInteger(entryCount) || entryCount < 12) throw new Error('Use at least twelve synthetic entries');
  const catalog = emptyCatalog();
  const evidence = (url: string, role: Provenance['role'] = 'github'): Provenance[] => [{ role, url, observed_at: AT, review: 'reviewed' }];
  for (const [id, login, type] of [[42, 'benchmark-org', 'organization'], [84, 'benchmark-researcher', 'user']] as const) {
    const url = `https://github.com/${login}`;
    catalog.actors.push({ kind: 'actor', id: `actor:github:${id}`, provider: 'github', provider_id: id, account_type: type,
      title: type === 'user' ? 'Synthetic independent researcher' : 'Synthetic research organization', login, canonical_url: url, aliases: [], status: 'listed', updated_at: AT,
      provenance: { title: evidence(url), provider_id: evidence(url) } });
  }
  for (let i = 1; i <= 3; i++) {
    const owner = i === 3 ? 'benchmark-researcher' : 'benchmark-org';
    const url = `https://github.com/${owner}/synthetic-source-${i}`;
    catalog.sources.push({ kind: 'source_repository', id: `source:github:${i}`, provider: 'github', provider_id: i, title: `Synthetic public source ${i}`,
      description: `Synthetic source ${i}; used only for isolated application verification.`, status: 'listed', updated_at: AT,
      canonical_url: url, owner_id: `actor:github:${i === 3 ? 84 : 42}`, default_branch: 'main', availability: 'accessible', archived: false,
      observed_at: AT, stale: false, license: { status: 'unknown' }, aliases: [], latest_commit: COMMIT,
      provenance: { title: evidence(url), description: evidence(url), license: evidence(url) } });
  }
  catalog.sources[0]!.collaboration = { issues_url: `${catalog.sources[0]!.canonical_url}/issues`, discussions_url: `${catalog.sources[0]!.canonical_url}/discussions` };
  catalog.sources[1]!.collaboration = { issues_url: `${catalog.sources[1]!.canonical_url}/issues` };
  const labels = ['cohort risk / 合成队列风险', 'genomics / 合成基因分析', 'materials / 合成材料稳定性'];
  for (let i = 0; i < entryCount - 9; i++) {
    const source = catalog.sources[i % 3]!;
    catalog.resources.push({ kind: 'resource', id: `resource:method-${i}`, title: `Synthetic ${labels[i % 3]} method ${String(i).padStart(5, '0')}`,
      description: `Synthetic research resource ${i}. Reproducibility, evidence and sensitivity analysis / 研究方法与敏感性分析. This is a performance fixture, not a scientific finding.`,
      status: 'listed', updated_at: AT, resource_type: i % 2 ? 'method' : 'workflow', domains: [i % 3 === 0 ? 'Clinical research' : i % 3 === 1 ? 'Bioinformatics' : 'Materials science'],
      source_refs: [{ source_id: source.id, role: 'primary', url: source.canonical_url, commit: COMMIT }], project_ids: [], license: { status: 'unknown' },
      inputs: ['Synthetic tabular data'], outputs: ['Synthetic report'], runtime: { status: 'not_described' },
      provenance: { title: evidence(source.canonical_url, 'editor'), description: evidence(source.canonical_url, 'editor') } });
  }
  Object.assign(catalog.resources[0]!, { conditions: ['Requires an approved local dataset; no data is hosted by AIPOCH.'],
    documentation_url: 'https://github.com/benchmark-org/synthetic-source-1/blob/main/README.md',
    download_url: 'https://github.com/benchmark-org/synthetic-source-1/releases/download/synthetic-v1/method.zip',
    runtime: { status: 'community_described', documentation_url: 'https://github.com/benchmark-org/synthetic-source-1/blob/main/RUNNING.md' } });
  for (const [key, title, sourceIds, resourceIds] of [
    ['methods', 'Synthetic cross-repository methods project', [1, 2], [0, 1]],
    ['independent', 'Synthetic independent research project', [3], [2]],
    ['replication', 'Synthetic replication project', [2], [1]],
  ] as const) {
    const refs = sourceIds.map(id => ({ source_id: `source:github:${id}`, role: 'primary' as const, url: catalog.sources[id - 1]!.canonical_url, commit: COMMIT }));
    const projectId = `project:${key}`;
    catalog.projects.push({ kind: 'project', id: projectId, title, description: 'Synthetic study description for browser verification.', status: 'listed', updated_at: AT,
      domains: ['Clinical research'], source_refs: refs, resource_ids: resourceIds.map(id => `resource:method-${id}`),
      provenance: { title: evidence(refs[0]!.url, 'editor'), description: evidence(refs[0]!.url, 'editor') } });
    for (const id of resourceIds) catalog.resources[id]!.project_ids.push(projectId);
  }
  catalog.organizations.push({ kind: 'organization', id: 'actor:github:42', actor_id: 'actor:github:42', title: 'Synthetic research organization', status: 'listed', updated_at: AT,
    source_ids: ['source:github:1', 'source:github:2'], resource_ids: catalog.resources.filter(row => row.source_refs[0]!.source_id !== 'source:github:3').map(row => row.id),
    participation: 'actively_curated', provenance: { title: evidence('https://github.com/benchmark-org') } });
  catalog.collections.push({ kind: 'collection', id: 'collection:synthetic', title: 'Synthetic methods collection', description: 'A curated collection including a researcher.', status: 'listed', updated_at: AT,
    actor_ids: ['actor:github:84'], item_ids: ['project:methods', 'resource:method-0', 'actor:github:84', ...(options.largeCollection ? catalog.resources.slice(1).map(row => row.id) : [])], selection_basis: 'Synthetic human-curation fixture.',
    provenance: { title: evidence('https://github.com/benchmark-org', 'editor'), description: evidence('https://github.com/benchmark-org', 'editor') } });
  catalog.claims.push({ kind: 'claim', id: 'claim:scoped-curation', subject_id: 'actor:github:42', actor_id: 'actor:github:84', type: 'organization_curation', status: 'verified',
    scope: 'catalog-curation:source:github:1,source:github:2', evidence: evidence('https://github.com/benchmark-org/synthetic-source-1/issues/1', 'maintainer'), recorded_at: AT,
    verified_at: AT, verified_by: 'actor:github:84', authority: 'organization_owner', recheck_on: ['transfer', 'permission_change', 'dispute'] });
  catalog.claims.push({ kind: 'claim', id: 'claim:documentation-only', subject_id: 'resource:method-0', actor_id: 'actor:github:84', type: 'capability', status: 'unverified',
    scope: 'Documentation only; execution has not been verified.', evidence: evidence('https://github.com/benchmark-org/synthetic-source-1/blob/main/README.md', 'community'),
    recorded_at: AT, recheck_on: ['evidence_expiry', 'dispute'] });
  catalog.tombstones.push({ kind: 'tombstone', id: 'resource:withdrawn', status: 'withdrawn', withdrawn_at: AT, reason: 'policy' },
    { kind: 'tombstone', id: 'actor:github:999', status: 'withdrawn', withdrawn_at: AT, reason: 'withdrawn' },
    { kind: 'tombstone', id: 'resource:old-method', status: 'superseded', withdrawn_at: AT, reason: 'merged', replacement_id: 'resource:method-0' });
  assertValidCatalog(catalog);
  const data = { snapshot_id: sha256(stableJson(catalog)).slice(0, 24), generated_at: AT, catalog };
  if (allEntries(catalog).length !== entryCount) throw new Error('Synthetic entry count is inconsistent');
  return data;
}

/** Emit a contract-validated synthetic payload into a caller-owned temporary directory. */
async function emitData(data: SiteData, directory: string) {
  const manifest: CatalogManifest = { contract_version: CONTRACT_VERSION, snapshot_id: data.snapshot_id, generated_at: data.generated_at,
    collections: { sources: [], actors: [], organizations: [], projects: [], resources: [], collections: [], relations: [], claims: [], tombstones: [] } };
  const snapshotDir = join(directory, 'catalog/v1/snapshots', data.snapshot_id);
  await mkdir(snapshotDir, { recursive: true });
  for (const name of COLLECTION_NAMES) {
    for (let start = 0; start < Math.max(1, data.catalog[name].length); start += 200) {
      const shard: CatalogShard = { contract_version: CONTRACT_VERSION, snapshot_id: data.snapshot_id, collection: name, records: data.catalog[name].slice(start, start + 200) };
      const check = validateShard(shard); if (!check.ok) throw new Error(check.errors.join('\n'));
      const content = stableJson(shard), filename = `${name}-${start / 200}.json`;
      await writeFile(join(snapshotDir, filename), content);
      manifest.collections[name].push({ href: `snapshots/${data.snapshot_id}/${filename}`, sha256: sha256(content), bytes: Buffer.byteLength(content), count: shard.records.length });
    }
  }
  const check = validateManifest(manifest); if (!check.ok) throw new Error(check.errors.join('\n'));
  await writeFile(join(directory, 'catalog/v1/manifest.json'), stableJson(manifest));
  await writeFile(join(snapshotDir, 'manifest.json'), stableJson({ ...manifest, collections: Object.fromEntries(COLLECTION_NAMES.map(name => [name, manifest.collections[name].map(part => ({ ...part, href: part.href.split('/').at(-1)! }))])) }));
  await mkdir(join(directory, 'internal'), { recursive: true });
  await writeFile(join(directory, 'internal/catalog.json'), stableJson(data));
  await writeFile(join(directory, 'internal/search.json'), stableJson({ snapshot_id: data.snapshot_id, index: makeSearchIndex(searchDocuments(data.catalog)).toJSON() }));
}

export async function buildVerificationSite(directory: string, data: SiteData, base = '/', progress?: (message: string) => void) {
  const start = performance.now();
  const generated = join(directory, 'generated'), output = join(directory, 'site');
  await emitData(data, generated);
  const afterData = performance.now();
  await viteBuild({ configFile: false, root: resolve('web'), publicDir: generated, base, logLevel: 'error', build: { outDir: output, emptyOutDir: true, sourcemap: false } });
  const afterAssets = performance.now();
  const template = await readFile(join(output, 'index.html'), 'utf8');
  const paths = ['/', '/explore/', '/projects/', '/capabilities/', '/organizations/', '/researchers/', '/collections/', '/sources/', '/community/', '/submit/',
    ...allEntries(data.catalog).map(routeFor), ...data.catalog.tombstones.flatMap(tombstoneRoutesFor), '/404/'];
  let rendered = 0;
  for (const path of paths) {
    const file = path === '/404/' ? join(output, '404.html') : join(output, path.slice(1), 'index.html');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, renderPage(template, data, path, base));
    if (++rendered % 1000 === 0) progress?.(`Rendered ${rendered}/${paths.length} actual HTML pages.`);
  }
  await writeFile(join(output, '.nojekyll'), '');
  await writeFile(join(output, 'routes.json'), stableJson({ base, paths: paths.filter(path => path !== '/404/'), snapshot_id: data.snapshot_id }));
  const afterRender = performance.now();
  const validated = await validateOutput(output, base);
  const afterValidation = performance.now();
  return { directory: output, ...validated, timings_ms: { emit_synthetic_contract: afterData - start, vite_assets: afterAssets - afterData,
    all_route_render: afterRender - afterAssets, full_output_validation: afterValidation - afterRender, total: afterValidation - start } };
}

export async function treeMeasurements(directory: string) {
  let files = 0, bytes = 0, gzipBytes = 0, htmlBytes = 0, htmlFiles = 0, largestHtml = { path: '', bytes: 0 };
  const groups: Record<string, { files: number; bytes: number; embedded_data_script_bytes: number; inline_svg_bytes: number; other_html_bytes: number }> = {};
  const samples: Record<string, { path: string; html_bytes: number; embedded_data_script_bytes: number; inline_svg_bytes: number; other_html_bytes: number; embedded_catalog_collection_bytes: Record<string, number> }> = {};
  async function walk(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const metadata = await stat(full); files++; bytes += metadata.size;
        const content = await readFile(full); gzipBytes += gzipSync(content, { level: 6 }).byteLength;
        const path = full.slice(directory.length + 1);
        const category = entry.name.endsWith('.html') ? path.split('/').length > 2 ? `${path.split('/')[0]}_detail_html` : 'common_html'
          : path.startsWith('catalog/') ? 'public_catalog' : path.startsWith('internal/') ? path : 'assets_and_manifests';
        const group = groups[category] ??= { files: 0, bytes: 0, embedded_data_script_bytes: 0, inline_svg_bytes: 0, other_html_bytes: 0 };
        group.files++; group.bytes += metadata.size;
        if (entry.name.endsWith('.html')) {
          htmlFiles++; htmlBytes += metadata.size; if (metadata.size > largestHtml.bytes) largestHtml = { path, bytes: metadata.size };
          const html = content.toString('utf8');
          const script = html.match(/<script>window\.__AIPOCH__=([\s\S]*?)<\/script>/);
          const dataBytes = Buffer.byteLength(script?.[0] ?? ''), svgBytes = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].reduce((sum, match) => sum + Buffer.byteLength(match[0]), 0);
          group.embedded_data_script_bytes += dataBytes; group.inline_svg_bytes += svgBytes; group.other_html_bytes += metadata.size - dataBytes - svgBytes;
          const sampleKey = category === 'common_html' ? path : category;
          if (!samples[sampleKey]) {
            const data = script?.[1] ? JSON.parse(script[1].split(';window.__AIPOCH_BOOTSTRAP__=')[0]) as SiteData | null : undefined;
            samples[sampleKey] = { path, html_bytes: metadata.size, embedded_data_script_bytes: dataBytes, inline_svg_bytes: svgBytes, other_html_bytes: metadata.size - dataBytes - svgBytes,
              embedded_catalog_collection_bytes: Object.fromEntries(Object.entries(data?.catalog ?? {}).map(([name, rows]) => [name, Buffer.byteLength(JSON.stringify(rows))])) };
          }
        }
      }
    }
  }
  await walk(directory);
  return { files, bytes, sum_individual_file_gzip_bytes: gzipBytes, html_files: htmlFiles, html_bytes: htmlBytes, largest_html: largestHtml, composition: { groups, samples } };
}

export async function startVerificationServer(directory: string, base = '/') {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('Missing preview port');
  const port = address.port; await new Promise<void>((resolveClose, reject) => reservation.close(error => error ? reject(error) : resolveClose()));
  const processHandle: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'scripts/serve.ts', '--dir', directory, '--base', base, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; processHandle.stderr?.on('data', chunk => { errors += String(chunk); });
  const url = `http://127.0.0.1:${port}${base}`;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (processHandle.exitCode !== null) throw new Error(`Static server failed: ${errors}`);
    try { if ((await fetch(url)).ok) return { url, process: processHandle, close: async () => { if (processHandle.exitCode === null) { processHandle.kill('SIGTERM'); await once(processHandle, 'exit'); } } }; } catch { /* Wait for the known live process to bind. */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  processHandle.kill('SIGTERM'); throw new Error('Static preview did not start');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { output: { type: 'string' }, entries: { type: 'string', default: '100' }, base: { type: 'string', default: '/' }, catalog: { type: 'string' }, 'large-collection': { type: 'boolean', default: false } } });
  if (!values.output) throw new Error('A caller-owned temporary --output directory is required');
  const data = values.catalog ? JSON.parse(await readFile(values.catalog, 'utf8')) as SiteData : verificationData(Number(values.entries), { largeCollection: values['large-collection'] });
  const result = await buildVerificationSite(resolve(values.output), data, values.base);
  process.stdout.write(JSON.stringify(result) + '\n');
}
