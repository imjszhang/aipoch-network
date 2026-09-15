import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSafeHttpsUrl } from '../spec/identity.js';
import type { MetricObservation, Observation, SourceActivity } from '../spec/types.js';
import { failedActivity, failedMetric, metricObservation, observation, revalidatedMetric, utcTimestamp } from './github-observations.js';

export interface AccountSnapshot {
  provider_id: number;
  login: string;
  account_type: 'user' | 'organization';
  canonical_url: string;
  observation: Observation;
  github_metrics: { followers?: MetricObservation; following?: MetricObservation; public_repositories?: MetricObservation };
  etag?: string;
  last_modified?: string;
}

export type Availability = 'accessible' | 'temporarily_unavailable' | 'unknown' | 'private' | 'deleted';
export interface SourceSnapshot {
  requested_url: string;
  checked_at: string;
  observed_at?: string;
  availability: Availability;
  suppressed: boolean;
  error?: 'not_public' | 'unavailable' | 'rate_limited' | 'invalid_response' | 'identity_changed';
  etag?: string;
  last_modified?: string;
  observation?: Observation;
  github_metrics?: { stars?: MetricObservation; forks?: MetricObservation };
  source_activity?: SourceActivity;
  repository?: {
    id: number; name: string; full_name: string; html_url: string;
    description?: string; default_branch: string; archived: boolean; fork: boolean;
    owner: { id: number; login: string; type: 'User' | 'Organization'; html_url: string };
    topics: string[]; language?: string; license?: { spdx_id: string; url: string };
    updated_at: string; pushed_at?: string; homepage?: string;
    has_issues: boolean; has_discussions: boolean;
    commit?: string; readme?: string; readme_url?: string;
    latest_release?: { tag: string; name: string; url: string; published_at: string };
  };
}
export interface RequestOptions {
  fetch?: typeof fetch;
  token?: string;
  now?: () => Date;
  wait?: (ms: number) => Promise<void>;
  maxRetries?: number;
  maxWaitMs?: number;
  /** Bulk refresh gives the anonymous request budget to branch heads and account metrics. */
  enrichContent?: boolean;
}

const MAX_BYTES = 512_000;
export function publicWebUrl(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  try {
    const url = new URL(input);
    if (!isSafeHttpsUrl(input) || url.port) return undefined;
    return url.href;
  } catch { return undefined; }
}
export function apiPath(input: string): URL {
  const url = new URL(input, 'https://api.github.com');
  if (url.origin !== 'https://api.github.com' || url.username || url.password) throw new Error('Untrusted API location');
  return url;
}
export async function limitedText(response: Response, limit = MAX_BYTES): Promise<string> {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Response exceeds limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Response exceeds limit');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}

export class GitHubReader {
  private fetcher: typeof fetch;
  private now: () => Date;
  private wait: (ms: number) => Promise<void>;
  constructor(private options: RequestOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.wait = options.wait ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
  }
  async request(path: string, headers: Record<string, string> = {}): Promise<Response> {
    let location = apiPath(path);
    let redirects = 0;
    let retries = 0;
    while (true) {
      const response = await this.fetcher(location, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AIPOCH-Network-Catalog',
          'X-GitHub-Api-Version': '2022-11-28', ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {}), ...headers },
        redirect: 'manual', signal: AbortSignal.timeout(15_000),
      });
      if ([301, 302, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        if (++redirects > 3) throw new Error('Redirect limit reached');
        const next = response.headers.get('location');
        if (!next) throw new Error('Missing redirect location');
        location = apiPath(new URL(next, location).href);
        continue;
      }
      const limited = response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
      if (!limited || retries >= (this.options.maxRetries ?? 2)) return response;
      const retryAfter = response.headers.get('retry-after');
      const seconds = Number(retryAfter);
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - this.now().getTime();
      const hinted = retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - this.now().getTime()) : reset;
      const delay = Math.max(1000 * 2 ** retries, Number.isFinite(hinted) ? hinted : 0);
      if (delay > (this.options.maxWaitMs ?? 5000)) return response;
      await response.body?.cancel();
      await this.wait(delay);
      retries++;
    }
  }
  async json(path: string): Promise<unknown> {
    const response = await this.request(path);
    if (!response.ok) { await response.body?.cancel(); throw new Error(`GitHub status ${response.status}`); }
    return JSON.parse(await limitedText(response));
  }
  async refresh(owner: string, repo: string, previous?: SourceSnapshot): Promise<SourceSnapshot> {
    const requested_url = `https://github.com/${owner}/${repo}`;
    const checked_at = this.now().toISOString();
    const previousObservation = previous?.observation ?? (previous?.observed_at ? { last_attempt_at: previous.checked_at, last_success_at: previous.observed_at, result: 'ok' as const } : undefined);
    const base = { ...previous, requested_url, checked_at,
      observation: observation(checked_at, 'unavailable', previousObservation),
      github_metrics: { stars: failedMetric(previous?.github_metrics?.stars, checked_at, 'unavailable'), forks: failedMetric(previous?.github_metrics?.forks, checked_at, 'unavailable') },
      source_activity: failedActivity(previous?.source_activity, checked_at),
    };
    const withheld = { observation: observation(checked_at, 'unavailable'),
      github_metrics: { stars: failedMetric(undefined, checked_at, 'unavailable'), forks: failedMetric(undefined, checked_at, 'unavailable') },
      source_activity: failedActivity(undefined, checked_at),
    };
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    try {
      const headers: Record<string, string> = {};
      // A previously suppressed entry must be fetched again, never resurrected from 304.
      if (!previous?.suppressed && previous?.etag) headers['If-None-Match'] = previous.etag;
      if (!previous?.suppressed && !previous?.etag && previous?.last_modified) headers['If-Modified-Since'] = previous.last_modified;
      const response = await this.request(endpoint, headers);
      if (response.status === 304 && previous?.repository && !previous.suppressed) {
        const repository = { ...previous.repository };
        const source_activity = await this.enrich(repository, endpoint, checked_at, previous.source_activity);
        return { ...base, repository, availability: 'accessible', suppressed: false, error: undefined, observed_at: checked_at,
          observation: observation(checked_at, 'ok'), source_activity,
          github_metrics: { stars: revalidatedMetric(previous.github_metrics?.stars, checked_at), forks: revalidatedMetric(previous.github_metrics?.forks, checked_at) } };
      }
      const limited = response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
      if (limited || response.status >= 500) {
        await response.body?.cancel();
        return { ...base, availability: 'temporarily_unavailable', suppressed: previous?.suppressed ?? false, error: limited ? 'rate_limited' : 'unavailable' };
      }
      if ([403, 404, 410].includes(response.status)) {
        await response.body?.cancel();
        return { ...base, ...withheld, availability: 'unknown', suppressed: true, error: 'not_public' };
      }
      if (!response.ok) throw new Error('Invalid response status');
      const raw = JSON.parse(await limitedText(response));
      if (raw.private !== false || raw.visibility && raw.visibility !== 'public') {
        return { ...base, ...withheld, availability: 'private', suppressed: true, error: 'not_public' };
      }
      if (!Number.isSafeInteger(raw.id) || !Number.isSafeInteger(raw.owner?.id) || !['User', 'Organization'].includes(raw.owner.type)
        || typeof raw.full_name !== 'string' || typeof raw.default_branch !== 'string' || typeof raw.updated_at !== 'string'
        || !publicWebUrl(raw.html_url)?.startsWith('https://github.com/')) throw new Error('Invalid source identity');
      if (previous?.repository && previous.repository.id !== raw.id) {
        return { ...base, ...withheld, availability: 'unknown', suppressed: true, error: 'identity_changed' };
      }
      const repository: NonNullable<SourceSnapshot['repository']> = {
        id: raw.id, name: String(raw.name), full_name: raw.full_name, html_url: raw.html_url,
        ...(typeof raw.description === 'string' ? { description: raw.description.slice(0, 4000) } : {}),
        default_branch: raw.default_branch, archived: raw.archived === true, fork: raw.fork === true,
        owner: { id: raw.owner.id, login: String(raw.owner.login), type: raw.owner.type, html_url: `https://github.com/${raw.owner.login}` },
        topics: Array.isArray(raw.topics) ? raw.topics.filter((t: unknown) => typeof t === 'string').slice(0, 40) : [],
        ...(typeof raw.language === 'string' ? { language: raw.language } : {}),
        ...(raw.license?.spdx_id && raw.license.spdx_id !== 'NOASSERTION' ? { license: { spdx_id: String(raw.license.spdx_id), url: raw.html_url } } : {}),
        updated_at: raw.updated_at, ...(typeof raw.pushed_at === 'string' ? { pushed_at: raw.pushed_at } : {}),
        ...(publicWebUrl(raw.homepage) ? { homepage: publicWebUrl(raw.homepage) } : {}),
        has_issues: raw.has_issues === true, has_discussions: raw.has_discussions === true,
      };
      const source_activity = await this.enrich(repository, endpoint, checked_at, previous?.repository?.default_branch === repository.default_branch ? previous.source_activity : undefined);
      return { requested_url, checked_at, observed_at: checked_at, availability: 'accessible', suppressed: false,
        etag: response.headers.get('etag') ?? undefined, last_modified: response.headers.get('last-modified') ?? undefined, repository,
        observation: observation(checked_at, 'ok'), source_activity,
        github_metrics: { stars: metricObservation(raw.stargazers_count, checked_at, previous?.github_metrics?.stars), forks: metricObservation(raw.forks_count, checked_at, previous?.github_metrics?.forks) } };
    } catch {
      return { ...base, availability: 'temporarily_unavailable', suppressed: previous?.suppressed ?? false, error: 'unavailable' };
    }
  }
  private async enrich(repository: NonNullable<SourceSnapshot['repository']>, endpoint: string, checked_at: string, previous?: SourceActivity): Promise<SourceActivity> {
    // Repository metadata validators do not validate branch heads, README or releases.
    // Auxiliary failures leave those observations unknown, not spuriously fresh.
    delete repository.commit;
    delete repository.readme;
    delete repository.readme_url;
    delete repository.latest_release;
    // Optional content is deliberately requested without a credential. A local
    // token with private-repository access must not widen this public catalog.
    const publicReader = new GitHubReader({ ...this.options, token: undefined });
    let activity = failedActivity(previous, checked_at);
      // Auxiliary reads are independent. Missing README, commits, or releases never reject a public source.
      try {
        // The single-commit endpoint includes potentially huge changed-file patches.
        // A one-item branch history page returns its HEAD metadata within the same byte budget.
        const commits = await publicReader.json(`${endpoint}/commits?sha=${encodeURIComponent(repository.default_branch)}&per_page=1`);
        const commit = Array.isArray(commits) && commits.length === 1 ? commits[0] as { sha?: string; commit?: { committer?: { date?: unknown } } } | null : undefined;
        if (commit && /^[a-f0-9]{40}$/.test(commit.sha ?? '')) {
          repository.commit = commit.sha;
          const suppliedDate = commit.commit?.committer?.date;
          const date = utcTimestamp(suppliedDate);
          const date_status = suppliedDate === undefined || suppliedDate === null ? 'unknown' : !date ? 'invalid'
            : Date.parse(date) > Date.parse(checked_at) ? 'future' : 'valid';
          activity = { default_branch_head: { sha: commit.sha!, ...(date_status === 'valid' ? { committed_at: date } : {}), observed_at: checked_at, date_status }, observation: observation(checked_at, 'ok') };
        } else activity = failedActivity(previous, checked_at, 'invalid_response');
      } catch { /* Missing version remains unknown. */ }
      if (this.options.enrichContent === false) return activity;
      try {
        const readme = await publicReader.json(`${endpoint}/readme${repository.commit ? `?ref=${repository.commit}` : ''}`) as { encoding?: string; content?: string; html_url?: string };
        if (readme.encoding === 'base64' && typeof readme.content === 'string') {
          const decoded = Buffer.from(readme.content, 'base64');
          if (decoded.length <= 64_000) {
            repository.readme = decoded.toString('utf8');
            repository.readme_url = publicWebUrl(readme.html_url);
          }
        }
      } catch { /* A README is optional. */ }
      try {
        const release = await publicReader.json(`${endpoint}/releases/latest`) as Record<string, unknown>;
        const url = publicWebUrl(release.html_url);
        if (url && typeof release.tag_name === 'string' && typeof release.published_at === 'string') {
          repository.latest_release = { tag: release.tag_name, name: String(release.name ?? release.tag_name), url, published_at: release.published_at };
        }
      } catch { /* No release is a normal source state. */ }
    return activity;
  }
  /** Profiles use the anonymous public endpoint; a repository token never widens profile visibility. */
  async refreshAccount(owner: NonNullable<SourceSnapshot['repository']>['owner'], previous?: AccountSnapshot): Promise<AccountSnapshot> {
    const at = this.now().toISOString();
    const prior = previous?.provider_id === owner.id ? previous : undefined;
    const base = { provider_id: owner.id, login: owner.login, account_type: owner.type === 'Organization' ? 'organization' as const : 'user' as const,
      canonical_url: `https://github.com/${owner.login}` };
    const fail = (result: 'unavailable' | 'unsupported' | 'invalid_response', retain = true): AccountSnapshot => ({ ...base,
      ...(retain && prior?.etag ? { etag: prior.etag } : {}), ...(retain && prior?.last_modified ? { last_modified: prior.last_modified } : {}),
      observation: observation(at, result, retain ? prior?.observation : undefined),
      github_metrics: { followers: failedMetric(retain ? prior?.github_metrics.followers : undefined, at, result),
        following: owner.type === 'User' ? failedMetric(retain ? prior?.github_metrics.following : undefined, at, result) : failedMetric(undefined, at, 'unsupported'),
        public_repositories: failedMetric(retain ? prior?.github_metrics.public_repositories : undefined, at, result) },
    });
    try {
      const publicReader = new GitHubReader({ ...this.options, token: undefined });
      const headers: Record<string, string> = {};
      if (prior?.etag) headers['If-None-Match'] = prior.etag;
      else if (prior?.last_modified) headers['If-Modified-Since'] = prior.last_modified;
      const response = await publicReader.request(`/${owner.type === 'Organization' ? 'orgs' : 'users'}/${encodeURIComponent(owner.login)}`, headers);
      if (response.status === 304 && prior) return { ...base, ...(prior.etag ? { etag: prior.etag } : {}), ...(prior.last_modified ? { last_modified: prior.last_modified } : {}),
        observation: observation(at, 'ok'), github_metrics: { followers: revalidatedMetric(prior.github_metrics.followers, at),
          following: owner.type === 'User' ? revalidatedMetric(prior.github_metrics.following, at) : failedMetric(undefined, at, 'unsupported'),
          public_repositories: revalidatedMetric(prior.github_metrics.public_repositories, at) } };
      if (!response.ok) {
        const rateLimited = response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
        await response.body?.cancel(); return fail('unavailable', rateLimited || ![403, 404, 410].includes(response.status));
      }
      let raw: Record<string, unknown>;
      try { raw = JSON.parse(await limitedText(response)); } catch { return fail('invalid_response'); }
      if (!raw || raw.id !== owner.id || raw.type !== owner.type || typeof raw.login !== 'string'
        || !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(raw.login) || publicWebUrl(raw.html_url) !== `https://github.com/${raw.login}`) return fail('invalid_response', false);
      // GitHub can mask private-profile follower counts as zero. Retain no count if restriction is detectable.
      if (raw.private === true || raw.profile_private === true || (raw.user_view_type !== undefined && raw.user_view_type !== 'public')) return fail('unavailable', false);
      return { ...base, login: raw.login, canonical_url: `https://github.com/${raw.login}`,
        etag: response.headers.get('etag') ?? undefined, last_modified: response.headers.get('last-modified') ?? undefined,
        observation: observation(at, 'ok'), github_metrics: {
          followers: metricObservation(raw.followers, at, prior?.github_metrics.followers),
          following: owner.type === 'User' ? metricObservation(raw.following, at, prior?.github_metrics.following) : failedMetric(undefined, at, 'unsupported'),
          public_repositories: metricObservation(raw.public_repos, at, prior?.github_metrics.public_repositories),
        } };
    } catch { return fail('unavailable'); }
  }
  async organizationRepositories(login: string, maxPages = 3): Promise<{ urls: string[]; truncated: boolean }> {
    const urls: string[] = [];
    let path: string | undefined = `/orgs/${encodeURIComponent(login)}/repos?type=public&per_page=100&sort=full_name`;
    for (let page = 0; path && page < maxPages; page++) {
      const response = await this.request(path);
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Organization listing unavailable (${response.status})`); }
      const rows = JSON.parse(await limitedText(response, 2_000_000));
      if (!Array.isArray(rows)) throw new Error('Invalid organization listing');
      for (const row of rows) if (row.private === false && publicWebUrl(row.html_url)?.startsWith('https://github.com/')) urls.push(row.html_url);
      const next = response.headers.get('link')?.match(/<([^>]+)>; rel="next"/);
      path = next ? apiPath(next[1]).href : undefined;
    }
    return { urls: [...new Set(urls)].sort(), truncated: Boolean(path) };
  }
}

export function cacheKey(url: string): string { return createHash('sha256').update(url.toLowerCase()).digest('hex'); }
export async function readSnapshot(directory: string, url: string): Promise<SourceSnapshot | undefined> {
  try { return JSON.parse(await readFile(join(directory, `${cacheKey(url)}.json`), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
export async function saveSnapshot(directory: string, snapshot: SourceSnapshot): Promise<void> {
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${cacheKey(snapshot.requested_url)}.json`);
  await writeFile(`${file}.tmp`, JSON.stringify(snapshot, null, 2) + '\n');
  await rename(`${file}.tmp`, file);
}
