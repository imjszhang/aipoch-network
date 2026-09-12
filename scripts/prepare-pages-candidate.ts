import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateOutput } from './build.js';
import { readHistoricalSnapshot, retainHistory, type SnapshotHistory } from '../pipeline/history.js';
import { sha256, stableJson } from '../pipeline/json.js';
import { makeSearchIndex, searchDocuments } from '../web/src/search.js';
import { COLLECTION_NAMES, type CatalogManifest } from '../spec/types.js';

const HOUR = 60 * 60 * 1000;
export interface PagesSelection {
  repository: string; run_id: number; snapshot_id: string; artifact_sha256: string; file_tree_sha256: string; source_sha: string; site_base: '/' | '/aipoch-network/';
}
interface Run {
  id: number; run_attempt: number; status: string; conclusion: string | null; event: string; head_branch: string;
  head_sha: string; path: string; created_at: string; updated_at: string; head_repository?: { full_name: string };
}
export interface PagesMetadata {
  selection: PagesSelection;
  repository: { full_name: string; default_branch: string };
  main_sha: string;
  run: Run;
  artifact: { id: number; name: string; expired: boolean; expires_at: string; size_in_bytes: number; digest: string; workflow_run: { id: number; head_sha: string } };
  // From this repository's refresh.yml runs endpoint, branch=main and event=workflow_dispatch,
  // without a status filter: a newer failed/queued refresh may contain withdrawal evidence.
  latest_runs: Run[];
  latest_runs_total_count: number;
}
function time(value: string): number { const result = Date.parse(value); assert(Number.isFinite(result), 'Invalid candidate time'); return result; }
function fresh(value: string, now: number, budget: number): void {
  const age = now - time(value); assert(age >= 0 && age <= budget, 'Candidate or source observation is expired or from the future');
}
export function validateCandidateMetadata(metadata: PagesMetadata, now = Date.now()): void {
  const { selection: s, run: r, artifact: a } = metadata;
  assert(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(s.repository), 'Invalid repository');
  assert(Number.isSafeInteger(s.run_id) && s.run_id > 0 && /^[a-f0-9]{24}$/.test(s.snapshot_id), 'Invalid reviewed run or snapshot');
  assert(/^sha256:[a-f0-9]{64}$/.test(s.artifact_sha256) && /^sha256:[a-f0-9]{64}$/.test(s.file_tree_sha256) && /^[a-f0-9]{40}$/.test(s.source_sha), 'Expected digests and source commit must be exact');
  assert(s.site_base === '/' || s.site_base === '/aipoch-network/', 'Unsupported reviewed site base');
  assert(metadata.repository.full_name.toLowerCase() === s.repository.toLowerCase() && metadata.repository.default_branch === 'main', 'Repository identity or default branch differs');
  assert(metadata.main_sha === s.source_sha && r.head_sha === s.source_sha, 'Candidate is not from the currently reviewed main commit');
  assert(r.id === s.run_id && Number.isSafeInteger(r.run_attempt) && r.run_attempt > 0, 'Run identity differs');
  assert(r.status === 'completed' && r.conclusion === 'success' && r.event === 'workflow_dispatch' && r.head_branch === 'main'
    && r.path === '.github/workflows/refresh.yml' && r.head_repository?.full_name.toLowerCase() === s.repository.toLowerCase(), 'Untrusted or unsuccessful refresh run');
  fresh(r.updated_at, now, HOUR);
  assert(time(r.created_at) <= time(r.updated_at), 'Invalid refresh interval');
  assert(metadata.latest_runs.length > 0 && metadata.latest_runs.length <= 1000 && metadata.latest_runs_total_count === metadata.latest_runs.length, 'Refresh listing is truncated; bounded complete pagination must be reviewed before release');
  assert(new Set(metadata.latest_runs.map(item => item.id)).size === metadata.latest_runs.length, 'Duplicate refresh runs');
  const selected = metadata.latest_runs.find(item => item.id === r.id);
  assert(selected?.run_attempt === r.run_attempt && selected.updated_at === r.updated_at && selected.status === r.status && selected.conclusion === r.conclusion, 'Selected run changed during review');
  assert(metadata.latest_runs.every(item => item.id === r.id || (item.status === 'completed' && time(item.updated_at) < time(r.updated_at))), 'A newer or live refresh may have withdrawal evidence; refresh and review again');
  assert(Number.isSafeInteger(a.id) && a.id > 0 && a.name === `catalog-candidate-${r.id}-${r.run_attempt}` && a.workflow_run.id === r.id && a.workflow_run.head_sha === s.source_sha, 'Artifact identity differs');
  assert(a.expired === false && time(a.expires_at) > now && Number.isSafeInteger(a.size_in_bytes) && a.size_in_bytes > 0 && a.size_in_bytes <= 250_000_000, 'Artifact expired or exceeds its byte budget');
  assert(a.digest === s.artifact_sha256, 'GitHub artifact digest differs from the reviewed digest');
}

async function json(directory: string, file: string, maximum = 1024 * 1024): Promise<unknown> {
  const path = join(directory, file), stat = await lstat(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, `Invalid or oversized candidate file: ${file}`);
  const bytes = await readFile(path); assert(bytes.length <= maximum, 'Candidate file grew beyond its limit');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** Hash every file, with deterministic UTF-8 byte path ordering and stable JSON.
 * This describes exact reviewed content independently of ZIP container metadata. */
export async function candidateFileTree(directory: string) {
  const files: { path: string; bytes: number; sha256: string }[] = [];
  let total = 0;
  async function visit(path = ''): Promise<void> {
    for (const entry of await readdir(join(directory, path), { withFileTypes: true })) {
      const file = path ? `${path}/${entry.name}` : entry.name;
      assert(!entry.isSymbolicLink() && !/[\\\u0000-\u001f\u007f]/.test(file), 'Unsafe candidate inventory path');
      if (entry.isDirectory()) await visit(file);
      else {
        assert(entry.isFile() && files.length < 250_000, 'Candidate inventory contains a device or too many files');
        const stat = await lstat(join(directory, file)); total += stat.size;
        assert(total <= 250_000_000, 'Candidate inventory exceeds its byte budget');
        const bytes = await readFile(join(directory, file)); assert(bytes.length === stat.size, 'Candidate changed during inventory');
        files.push({ path: file, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await visit(); files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const manifest = { version: 1, files };
  return { manifest, file_tree_sha256: `sha256:${sha256(stableJson(manifest))}`, bytes: total };
}

/** Read-only validation; never builds, updates the candidate, enables Pages, or deploys. */
export async function verifyPagesCandidate(directory: string, selection: PagesSelection, now = Date.now()) {
  const tree = await candidateFileTree(directory);
  assert(tree.file_tree_sha256 === selection.file_tree_sha256, 'Candidate bytes differ from the reviewed file-tree digest');
  const output = await validateOutput(directory, selection.site_base);
  assert(output.snapshot_id === selection.snapshot_id, 'Reviewed snapshot differs from site');
  const notices = await lstat(join(directory, 'third-party-notices.txt'));
  assert(notices.isFile() && !notices.isSymbolicLink() && notices.size > 0 && notices.size <= 1_000_000, 'Bundled third-party notices are missing or invalid');
  const manifest = await json(directory, 'catalog/v1/manifest.json') as CatalogManifest;
  const current = await readHistoricalSnapshot(join(directory, 'catalog/v1/snapshots', manifest.snapshot_id), manifest.snapshot_id);
  assert.deepEqual(manifest, { ...current.manifest, collections: Object.fromEntries(COLLECTION_NAMES.map(name => [name, current.manifest.collections[name].map(part => ({ ...part, href: `snapshots/${manifest.snapshot_id}/${part.href}` }))])) }, 'Current and pinned manifests differ');
  fresh(manifest.generated_at, now, HOUR);
  for (const source of current.catalog.sources) {
    assert(source.readme === undefined && ['accessible', 'temporarily_unavailable'].includes(source.availability), 'Unsafe source content remains in candidate');
    fresh(source.observed_at, now, 7 * 24 * HOUR);
  }
  for (const claim of current.catalog.claims) if (claim.status === 'verified' && claim.expires_at) assert(time(claim.expires_at) > now, 'Verified claim has expired since refresh');
  const internal = await json(directory, 'internal/catalog.json', 32_000_000) as { catalog: unknown; snapshot_id: string; generated_at: string };
  assert.deepEqual(internal, { catalog: current.catalog, snapshot_id: manifest.snapshot_id, generated_at: manifest.generated_at }, 'Browser catalog differs from public catalog');
  assert.deepEqual(await json(directory, 'internal/search.json', 32_000_000), { snapshot_id: manifest.snapshot_id, index: makeSearchIndex(searchDocuments(current.catalog)).toJSON() }, 'Search contains inconsistent catalog data');
  const ledger = await json(directory, 'catalog/v1/history.json') as SnapshotHistory;
  const report = await json(directory, 'build-report.json') as { snapshot_id: string; generated_at: string; candidate_kind: string; history_sha256: string; counts: unknown; history: unknown };
  assert(report.snapshot_id === manifest.snapshot_id && report.generated_at === manifest.generated_at && ['refresh', 'withdrawal_only'].includes(report.candidate_kind), 'An offline or inconsistent build cannot be released');
  assert(report.history_sha256 === sha256(stableJson(ledger)), 'History ledger differs from build report');
  assert.deepEqual(report.counts, Object.fromEntries(COLLECTION_NAMES.map(name => [name, current.catalog[name].length])), 'Build counts differ');
  let validUntil = Math.min(time(manifest.generated_at) + HOUR, ...current.catalog.sources.map(source => time(source.observed_at) + 7 * 24 * HOUR));
  const scratch = await mkdtemp(join(tmpdir(), 'aipoch-pages-verify-'));
  try {
    await mkdir(join(scratch, 'catalog/v1'), { recursive: true });
    // Run the existing retirement policy, so deployment cannot silently retain an unsafe
    // historical snapshot or erase a withdrawal merely because individual hashes match.
    const policy = await retainHistory(directory, scratch, current.catalog, manifest);
    assert.deepEqual(ledger, policy, 'History fails the current withdrawal and retention policy');
    const currentPolicy = await retainHistory(directory, scratch, current.catalog, { ...manifest, generated_at: new Date(now).toISOString() });
    assert.deepEqual(currentPolicy.snapshots.map(row => [row.snapshot_id, row.status]), policy.snapshots.map(row => [row.snapshot_id, row.status]), 'Historical permissions or claims expired since candidate generation');
    const available = policy.snapshots.filter(row => row.status === 'available').map(row => row.snapshot_id).sort();
    const routes = await json(directory, 'routes.json') as { paths: string[] };
    const expectedFiles = new Set(['index.html', '404.html', '.nojekyll', 'routes.json', 'build-report.json', 'third-party-notices.txt', 'internal/catalog.json', 'internal/search.json', 'catalog/v1/manifest.json', 'catalog/v1/history.json', ...routes.paths.map(path => `${path.slice(1)}index.html`)]);
    assert.deepEqual((await readdir(join(directory, 'catalog/v1/snapshots'))).sort(), available, 'Unlisted or retired snapshots remain downloadable');
    for (const id of available) {
      const snapshot = await readHistoricalSnapshot(join(directory, 'catalog/v1/snapshots', id), id);
      for (const claim of snapshot.catalog.claims) if (claim.status === 'verified' && claim.expires_at) validUntil = Math.min(validUntil, time(claim.expires_at));
      assert.deepEqual((await readdir(join(directory, 'catalog/v1/snapshots', id))).sort(), [...snapshot.files.keys()].sort(), 'Unmanifested historical files remain downloadable');
      for (const file of snapshot.files.keys()) expectedFiles.add(`catalog/v1/snapshots/${id}/${file}`);
    }
    async function visit(path = ''): Promise<void> {
      for (const entry of await readdir(join(directory, path), { withFileTypes: true })) {
        const file = path ? `${path}/${entry.name}` : entry.name;
        assert(!entry.isSymbolicLink(), 'Symlink in publishable output');
        if (entry.isDirectory()) await visit(file);
        else assert(entry.isFile() && (expectedFiles.has(file) || /^assets\/[a-zA-Z0-9_.-]+\.(?:js|css|woff2?|svg|png|webp|jpe?g|ico)$/.test(file)), 'Unexpected file would be published');
      }
    }
    await visit();
    assert.deepEqual(report.history, { available: available.length, retired: policy.snapshots.length - available.length }, 'History counts differ');
  } finally { await rm(scratch, { recursive: true, force: true }); }
  return { ...output, generated_at: manifest.generated_at, source_sha: selection.source_sha, run_id: selection.run_id, artifact_sha256: selection.artifact_sha256, file_tree_sha256: tree.file_tree_sha256, site_base: selection.site_base, verified_at: new Date(now).toISOString(), valid_until: new Date(validUntil).toISOString() };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [metadataFile, directory] = process.argv.slice(2);
  if (metadataFile === '--inventory' && directory) {
    console.log(stableJson(await candidateFileTree(directory)));
    process.exit(0);
  }
  if (!metadataFile) throw new Error('Usage: tsx scripts/prepare-pages-candidate.ts metadata.json [extracted-candidate-directory]');
  const metadata = await json(dirname(resolve(metadataFile)), basename(metadataFile), 32_000_000) as PagesMetadata;
  validateCandidateMetadata(metadata);
  if (directory) {
    const result = await verifyPagesCandidate(directory, metadata.selection);
    assert(time(result.generated_at) >= time(metadata.run.created_at) && time(result.generated_at) <= time(metadata.run.updated_at), 'Candidate observation time is outside its selected refresh run');
    console.log(JSON.stringify(result));
  }
  else console.log('Reviewed artifact metadata passed. Archive bytes and extracted output still require verification.');
}
