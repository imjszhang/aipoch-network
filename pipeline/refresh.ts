import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { normalizeGitHubUrl, assertValidCatalog } from '../spec/index.js';
import { GitHubReader, type AccountSnapshot, type SourceSnapshot } from './github.js';
import { copyActivity, copyMetric, copyObservation, utcTimestamp } from './github-observations.js';
import type { MetricObservation, Observation, SourceActivity } from '../spec/types.js';
import { normalize, type SnapshotBatch } from './normalize.js';
import { stableJson } from './build.js';
import { validateRegistry, type Registry } from './registry.js';
import { applySuppressions, readSuppressions, saveSuppressions, suppressSnapshot, observeSuppression } from './suppressions.js';

const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_STATE_BYTES = 20_000_000;
const urlKey = (url: string) => normalizeGitHubUrl(url).canonical_url;
function withoutWithdrawnAccounts(input: unknown, registry: Registry): unknown {
  if (!input || typeof input !== 'object' || !('accounts' in input) || !Array.isArray(input.accounts)) return input;
  const withdrawn = new Set(registry.withdrawals.map(item => item.id));
  return { ...input, accounts: input.accounts.filter(account => !account || !withdrawn.has(`actor:github:${account.provider_id}`)) };
}

/** Deliberately smaller than the local reader cache: no README, headers or arbitrary response fields. */
export function refreshState(batch: SnapshotBatch): SnapshotBatch {
  return { as_of: batch.as_of, sources: batch.sources.map(source => {
    const repo = source.repository;
    return {
      requested_url: source.requested_url, checked_at: source.checked_at,
      ...(source.observed_at ? { observed_at: source.observed_at } : {}),
      availability: source.availability, suppressed: source.suppressed,
      ...(source.error ? { error: source.error } : {}),
      ...(source.observation ? { observation: copyObservation(source.observation) } : {}),
      ...(source.github_metrics ? { github_metrics: {
        ...(source.github_metrics.stars ? { stars: copyMetric(source.github_metrics.stars) } : {}),
        ...(source.github_metrics.forks ? { forks: copyMetric(source.github_metrics.forks) } : {}),
      } } : {}),
      ...(source.source_activity ? { source_activity: copyActivity(source.source_activity) } : {}),
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
  }), ...(batch.accounts ? { accounts: batch.accounts.map(account => ({
    provider_id: account.provider_id, login: account.login, account_type: account.account_type, canonical_url: account.canonical_url,
    observation: copyObservation(account.observation), github_metrics: {
      ...(account.github_metrics.followers ? { followers: copyMetric(account.github_metrics.followers) } : {}),
      ...(account.github_metrics.following ? { following: copyMetric(account.github_metrics.following) } : {}),
      ...(account.github_metrics.public_repositories ? { public_repositories: copyMetric(account.github_metrics.public_repositories) } : {}),
    },
  })) } : {}) };
}

function validateObservation(value: Observation, ceiling: string): void {
  if (!value || !utcTimestamp(value.last_attempt_at) || Date.parse(value.last_attempt_at) > Date.parse(ceiling)
    || !['ok', 'unavailable', 'unsupported', 'invalid_response'].includes(value.result)
    || (value.last_success_at !== undefined && (!utcTimestamp(value.last_success_at) || Date.parse(value.last_success_at) > Date.parse(value.last_attempt_at)))
    || (value.result === 'ok' && value.last_success_at !== value.last_attempt_at)) throw new Error('Invalid independent observation state');
}
function validateMetric(value: MetricObservation, ceiling: string): void {
  if (!value || !utcTimestamp(value.last_attempt_at) || Date.parse(value.last_attempt_at) > Date.parse(ceiling)
    || value.visibility !== 'public_api' || !['ok', 'unavailable', 'unsupported', 'invalid_response'].includes(value.result)
    || (value.value !== undefined && (!Number.isSafeInteger(value.value) || value.value < 0 || !utcTimestamp(value.observed_at) || Date.parse(value.observed_at!) > Date.parse(value.last_attempt_at)))
    || (value.value === undefined && value.observed_at !== undefined)
    || (value.result === 'ok' && (value.value === undefined || value.observed_at !== value.last_attempt_at))) throw new Error('Invalid metric observation');
}
function validateActivity(value: SourceActivity, ceiling: string): void {
  if (!value || typeof value !== 'object') throw new Error('Invalid source activity');
  if (value.observation) validateObservation(value.observation, ceiling);
  const head = value.default_branch_head;
  if (head && (!/^[a-f0-9]{40}$/.test(head.sha) || !utcTimestamp(head.observed_at) || Date.parse(head.observed_at) > Date.parse(ceiling)
    || !['valid', 'unknown', 'invalid', 'future'].includes(head.date_status)
    || (head.date_status === 'valid' ? !utcTimestamp(head.committed_at) || Date.parse(head.committed_at!) > Date.parse(head.observed_at) : head.committed_at !== undefined))) throw new Error('Invalid default-branch observation');
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
    if (source.observation) validateObservation(source.observation, source.checked_at);
    if (source.github_metrics) for (const metric of [source.github_metrics.stars, source.github_metrics.forks]) if (metric) validateMetric(metric, source.checked_at);
    if (source.source_activity) validateActivity(source.source_activity, source.checked_at);
  }
  if (batch.accounts !== undefined) {
    if (!Array.isArray(batch.accounts) || batch.accounts.length > 10000) throw new Error('Invalid account observation list');
    const accounts = new Set<number>();
    const ownerTypes = new Map(batch.sources.flatMap(source => source.repository ? [[source.repository.owner.id, source.repository.owner.type] as const] : []));
    for (const actor of registry.actors ?? []) if (!ownerTypes.has(actor.provider_id) && actor.status === 'listed'
      && actor.id === `actor:github:${actor.provider_id}` && Object.values(actor.provenance).flat().every(item => Date.parse(item.observed_at) <= Date.parse(batch.as_of))) ownerTypes.set(actor.provider_id, actor.account_type === 'organization' ? 'Organization' : 'User');
    for (const account of batch.accounts) {
      if (!account || !Number.isSafeInteger(account.provider_id) || account.provider_id < 1 || accounts.has(account.provider_id)
        || !ownerTypes.has(account.provider_id) || !['user', 'organization'].includes(account.account_type)
        || account.account_type !== (ownerTypes.get(account.provider_id) === 'Organization' ? 'organization' : 'user')
        || !/^[a-z\d][a-z\d-]{0,38}$/i.test(account.login) || account.canonical_url !== `https://github.com/${account.login}`
        || !account.github_metrics || typeof account.github_metrics !== 'object') throw new Error('Invalid or duplicate account identity');
      accounts.add(account.provider_id);
      validateObservation(account.observation, batch.as_of);
      for (const metric of [account.github_metrics.followers, account.github_metrics.following, account.github_metrics.public_repositories]) if (metric) validateMetric(metric, account.observation.last_attempt_at);
    }
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
  const batch = withoutWithdrawnAccounts(JSON.parse(content.toString('utf8')), registry);
  validateBatch(registry, batch, now, { allowMissing: true });
  const state = refreshState(batch);
  for (let i = 0; i < state.sources.length; i++) {
    for (const key of ['etag', 'last_modified'] as const) {
      const value = batch.sources[i][key];
      if (typeof value === 'string' && value.length <= 1024 && !/[\r\n]/.test(value)) state.sources[i][key] = value;
    }
  }
  for (let i = 0; i < (state.accounts?.length ?? 0); i++) for (const key of ['etag', 'last_modified'] as const) {
    const value = batch.accounts![i][key];
    if (typeof value === 'string' && value.length <= 1024 && !/[\r\n]/.test(value)) state.accounts![i][key] = value;
  }
  return applySuppressions(state, { version: 1, sources: [] }, registry);
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
  directory?: string; previous?: SnapshotBatch; reader?: Pick<GitHubReader, 'refresh'> & Partial<Pick<GitHubReader, 'refreshAccount'>>;
  now?: () => Date; log?: (message: string) => void;
} = {}): Promise<{ batch: SnapshotBatch; report: RefreshReport }> {
  const registryErrors = validateRegistry(registry);
  if (registryErrors.length) throw new Error(registryErrors.join('\n'));
  const directory = options.directory ?? '.cache';
  const lock = join(directory, 'refresh-lock');
  await mkdir(directory, { recursive: true });
  try { await mkdir(lock); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Refresh already running or interrupted; inspect ${lock} before removing it`); throw error; }
  const now = options.now ?? (() => new Date());
  try {
    await writeFile(join(lock, 'owner.json'), stableJson({ pid: process.pid, started_at: now().toISOString() }));
    const reader = options.reader ?? new GitHubReader({ token: process.env.GITHUB_TOKEN, enrichContent: false });
    const suppressionFile = join(directory, 'source-suppressions.json');
    let suppressionState = await readSuppressions(suppressionFile, now());
    await saveSuppressions(suppressionFile, suppressionState);
    const batch: SnapshotBatch = { as_of: now().toISOString(), sources: [] };
    const previousBatch = withoutWithdrawnAccounts(options.previous, registry) as SnapshotBatch | undefined;
    if (previousBatch) validateBatch(registry, previousBatch, now(), { allowMissing: true });
    const previousByUrl = new Map(previousBatch?.sources.map(source => [urlKey(source.requested_url), source]));
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
    if (reader.refreshAccount) {
      const previousAccounts = new Map(previousBatch?.accounts?.map(account => [account.provider_id, account]));
      const owners = new Map<number, NonNullable<SourceSnapshot['repository']>['owner']>();
      const withdrawn = new Set(registry.withdrawals.map(item => item.id));
      for (const source of batch.sources) if (!source.suppressed && source.repository && source.observed_at
        && !['private', 'deleted'].includes(source.availability) && now().getTime() - Date.parse(source.observed_at) <= MAX_AGE
        && !withdrawn.has(`source:github:${source.repository.id}`) && !withdrawn.has(`actor:github:${source.repository.owner.id}`)) owners.set(source.repository.owner.id, source.repository.owner);
      for (const actor of registry.actors ?? []) if (!owners.has(actor.provider_id) && !withdrawn.has(actor.id)
        && Object.values(actor.provenance).flat().every(item => Date.parse(item.observed_at) <= now().getTime())) owners.set(actor.provider_id, {
        id: actor.provider_id, login: actor.login, type: actor.account_type === 'organization' ? 'Organization' : 'User', html_url: actor.canonical_url,
      });
      batch.accounts = [];
      for (const owner of [...owners.values()].sort((a, b) => a.id - b.id)) {
        let account: AccountSnapshot;
        try { account = await reader.refreshAccount(owner, previousAccounts.get(owner.id)); }
        catch {
          const at = now().toISOString();
          account = { provider_id: owner.id, login: owner.login, account_type: owner.type === 'Organization' ? 'organization' : 'user', canonical_url: `https://github.com/${owner.login}`,
            observation: { last_attempt_at: at, result: 'unavailable' }, github_metrics: {} };
        }
        batch.accounts.push(account);
        options.log?.(`https://github.com/${owner.login}: public account metrics ${account.observation.result}`);
      }
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
