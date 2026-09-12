import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { normalizeGitHubUrl, assertValidCatalog } from '../spec/index.js';
import { GitHubReader, type SourceSnapshot } from './github.js';
import { normalize, type SnapshotBatch } from './normalize.js';
import { stableJson } from './build.js';
import type { Registry } from './registry.js';
import { readSuppressions, saveSuppressions, suppressSnapshot, observeSuppression } from './suppressions.js';

const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_STATE_BYTES = 20_000_000;
const urlKey = (url: string) => normalizeGitHubUrl(url).canonical_url;

/** Deliberately smaller than the local reader cache: no README, headers or arbitrary response fields. */
export function refreshState(batch: SnapshotBatch): SnapshotBatch {
  return { as_of: batch.as_of, sources: batch.sources.map(source => {
    const repo = source.repository;
    return {
      requested_url: source.requested_url, checked_at: source.checked_at,
      ...(source.observed_at ? { observed_at: source.observed_at } : {}),
      availability: source.availability, suppressed: source.suppressed,
      ...(source.error ? { error: source.error } : {}),
      ...(repo ? { repository: {
        id: repo.id, name: repo.name, full_name: repo.full_name, html_url: repo.html_url,
        default_branch: repo.default_branch, archived: repo.archived, fork: repo.fork,
        owner: { id: repo.owner.id, login: repo.owner.login, type: repo.owner.type, html_url: repo.owner.html_url },
        topics: repo.topics, updated_at: repo.updated_at, has_issues: repo.has_issues, has_discussions: repo.has_discussions,
        ...(repo.description ? { description: repo.description } : {}),
        ...(repo.language ? { language: repo.language } : {}),
        ...(repo.homepage ? { homepage: repo.homepage } : {}),
        ...(repo.pushed_at ? { pushed_at: repo.pushed_at } : {}),
        ...(repo.commit ? { commit: repo.commit } : {}),
        ...(repo.license ? { license: { spdx_id: repo.license.spdx_id, url: repo.license.url } } : {}),
        ...(repo.latest_release ? { latest_release: { tag: repo.latest_release.tag, name: repo.latest_release.name, url: repo.latest_release.url, published_at: repo.latest_release.published_at } } : {}),
      } } : {}),
    };
  }) };
}

export function validateBatch(registry: Registry, input: unknown, now = new Date(), options: { allowMissing?: boolean } = {}): asserts input is SnapshotBatch {
  if (!input || typeof input !== 'object') throw new Error('Invalid refresh state');
  const batch = input as SnapshotBatch;
  if (!Number.isFinite(Date.parse(batch.as_of)) || Date.parse(batch.as_of) > now.getTime() + 60_000 || !Array.isArray(batch.sources)) throw new Error('Invalid refresh state time or sources');
  const seen = new Set<string>();
  for (const source of batch.sources) {
    const key = urlKey(source.requested_url);
    if (seen.has(key)) throw new Error('Duplicate source in refresh state');
    seen.add(key);
    if (!['accessible', 'temporarily_unavailable', 'unknown', 'private', 'deleted'].includes(source.availability)
      || typeof source.suppressed !== 'boolean' || !Number.isFinite(Date.parse(source.checked_at))
      || Date.parse(source.checked_at) > Date.parse(batch.as_of)
      || (source.observed_at && (!Number.isFinite(Date.parse(source.observed_at)) || Date.parse(source.observed_at) > Date.parse(source.checked_at)))) throw new Error('Invalid source observation state');
    if (source.availability === 'accessible' && (!source.repository || !source.observed_at || source.suppressed)) throw new Error('Accessible source requires a public observation');
  }
  if (!options.allowMissing && registry.sources.some(source => !seen.has(urlKey(source.url)))) throw new Error('Refresh batch is incomplete; a missing source is not a withdrawal');
  // Uses the same semantic and cross-reference checks as a release, including URL and public-field bounds.
  assertValidCatalog(normalize(registry, batch).catalog);
}

export async function readRefreshState(path: string, registry: Registry, now = new Date()): Promise<SnapshotBatch | undefined> {
  let content: Buffer;
  try { content = await readFile(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (content.length > MAX_STATE_BYTES) throw new Error('Refresh state exceeds size limit');
  const batch: unknown = JSON.parse(content.toString('utf8'));
  validateBatch(registry, batch, now, { allowMissing: true });
  const state = refreshState(batch);
  for (let i = 0; i < state.sources.length; i++) {
    for (const key of ['etag', 'last_modified'] as const) {
      const value = batch.sources[i][key];
      if (typeof value === 'string' && value.length <= 1024 && !/[\r\n]/.test(value)) state.sources[i][key] = value;
    }
  }
  return state;
}

export interface RefreshReport {
  complete: boolean;
  candidate_kind: 'refresh' | 'withdrawal_only' | 'rejected';
  observed: number;
  withheld: number;
  retained: number;
  problems: string[];
}
export function assessRefresh(registry: Registry, batch: SnapshotBatch): RefreshReport {
  const report: RefreshReport = { complete: true, candidate_kind: 'refresh', observed: 0, withheld: 0, retained: 0, problems: [] };
  const expected = new Set(registry.sources.map(source => urlKey(source.url)));
  for (const source of batch.sources) {
    const key = urlKey(source.requested_url);
    if (!expected.delete(key)) report.problems.push('Unexpected or repeated source observation');
    if (source.suppressed || ['private', 'deleted'].includes(source.availability)) { report.withheld++; continue; }
    if (source.availability === 'accessible' && source.repository && source.observed_at) { report.observed++; continue; }
    if (!source.repository || !source.observed_at) report.problems.push(`${key}: unavailable without a last public observation`);
    else if (Date.parse(batch.as_of) - Date.parse(source.observed_at) > MAX_AGE) report.problems.push(`${key}: last public observation exceeds seven days`);
    else report.retained++;
  }
  if (expected.size) report.problems.push('Refresh batch is incomplete');
  // Privacy suppression must still be able to remove content during a wider outage.
  if (registry.sources.length && !report.observed && !report.withheld) report.problems.push('All sources failed; keep the last accepted candidate');
  report.complete = report.problems.length === 0;
  report.candidate_kind = report.complete ? 'refresh' : report.withheld > 0 && expected.size === 0 ? 'withdrawal_only' : 'rejected';
  return report;
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, stableJson(value));
  await rename(temporary, path);
}

/** Only the completed, validated batch replaces accepted state. An interruption cannot promote half a refresh. */
export async function refreshRegistry(registry: Registry, options: {
  directory?: string; previous?: SnapshotBatch; reader?: Pick<GitHubReader, 'refresh'>;
  now?: () => Date; log?: (message: string) => void;
} = {}): Promise<{ batch: SnapshotBatch; report: RefreshReport }> {
  const directory = options.directory ?? '.cache';
  const lock = join(directory, 'refresh-lock');
  await mkdir(directory, { recursive: true });
  try { await mkdir(lock); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Refresh already running or interrupted; inspect ${lock} before removing it`); throw error; }
  const now = options.now ?? (() => new Date());
  try {
    await writeFile(join(lock, 'owner.json'), stableJson({ pid: process.pid, started_at: now().toISOString() }));
    const reader = options.reader ?? new GitHubReader({ token: process.env.GITHUB_TOKEN });
    const suppressionFile = join(directory, 'source-suppressions.json');
    let suppressionState = await readSuppressions(suppressionFile, now());
    await saveSuppressions(suppressionFile, suppressionState);
    const batch: SnapshotBatch = { as_of: now().toISOString(), sources: [] };
    if (options.previous) validateBatch(registry, options.previous, now(), { allowMissing: true });
    const previousByUrl = new Map(options.previous?.sources.map(source => [urlKey(source.requested_url), source]));
    for (const source of registry.sources) {
      const candidate = normalizeGitHubUrl(source.url);
      const cached = previousByUrl.get(candidate.canonical_url);
      const previous = cached ? suppressSnapshot(cached, suppressionState) : undefined;
      let snapshot = await reader.refresh(candidate.owner, candidate.repository!, previous);
      const priorRule = suppressionState.sources.find(row => row.requested_url === candidate.canonical_url);
      if (priorRule?.provider_id && snapshot.repository && priorRule.provider_id !== snapshot.repository.id) snapshot = { ...snapshot, suppressed: true, availability: 'unknown', error: 'identity_changed', repository: previous?.repository };
      suppressionState = observeSuppression(suppressionState, snapshot);
      // Persist negative knowledge before another source, validation, or build can fail.
      await saveSuppressions(suppressionFile, suppressionState);
      batch.sources.push(snapshot);
      options.log?.(`${candidate.canonical_url}: ${snapshot.availability}${snapshot.suppressed ? ' (withheld)' : ''}`);
    }
    batch.as_of = now().toISOString();
    validateBatch(registry, batch, now());
    const report = assessRefresh(registry, batch);
    await atomicJson(join(directory, 'refresh-report.json'), report);
    await atomicJson(join(directory, 'refresh-attempt.json'), refreshState(batch));
    if (report.candidate_kind === 'rejected') throw new Error(`Refresh candidate rejected: ${report.problems.join('; ')}`);
    await atomicJson(join(directory, 'batch.json'), batch);
    await atomicJson(join(directory, 'refresh-state.json'), refreshState(batch));
    return { batch, report };
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
