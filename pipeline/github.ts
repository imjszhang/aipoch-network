import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
}

const MAX_BYTES = 512_000;
export function publicWebUrl(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
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
    const base = { ...previous, requested_url, checked_at };
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    try {
      const headers: Record<string, string> = {};
      // A previously suppressed entry must be fetched again, never resurrected from 304.
      if (!previous?.suppressed && previous?.etag) headers['If-None-Match'] = previous.etag;
      if (!previous?.suppressed && !previous?.etag && previous?.last_modified) headers['If-Modified-Since'] = previous.last_modified;
      const response = await this.request(endpoint, headers);
      if (response.status === 304 && previous?.repository && !previous.suppressed) {
        return { ...base, availability: 'accessible', suppressed: false, error: undefined, observed_at: checked_at };
      }
      const limited = response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
      if (limited || response.status >= 500) {
        await response.body?.cancel();
        return { ...base, availability: 'temporarily_unavailable', suppressed: previous?.suppressed ?? false, error: limited ? 'rate_limited' : 'unavailable' };
      }
      if ([403, 404, 410].includes(response.status)) {
        await response.body?.cancel();
        return { ...base, availability: 'unknown', suppressed: true, error: 'not_public' };
      }
      if (!response.ok) throw new Error('Invalid response status');
      const raw = JSON.parse(await limitedText(response));
      if (raw.private !== false || raw.visibility && raw.visibility !== 'public') {
        return { ...base, availability: 'private', suppressed: true, error: 'not_public' };
      }
      if (!Number.isSafeInteger(raw.id) || !Number.isSafeInteger(raw.owner?.id) || !['User', 'Organization'].includes(raw.owner.type)
        || typeof raw.full_name !== 'string' || typeof raw.default_branch !== 'string' || typeof raw.updated_at !== 'string'
        || !publicWebUrl(raw.html_url)?.startsWith('https://github.com/')) throw new Error('Invalid source identity');
      if (previous?.repository && previous.repository.id !== raw.id) {
        return { ...base, availability: 'unknown', suppressed: true, error: 'identity_changed' };
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
      // Auxiliary reads are independent. Missing README, commits, or releases never reject a public source.
      try {
        const commit = await this.json(`${endpoint}/commits/${encodeURIComponent(raw.default_branch)}`) as { sha?: string };
        if (/^[a-f0-9]{40}$/.test(commit.sha ?? '')) repository.commit = commit.sha;
      } catch { /* Missing version remains unknown. */ }
      try {
        const readme = await this.json(`${endpoint}/readme${repository.commit ? `?ref=${repository.commit}` : ''}`) as { encoding?: string; content?: string; html_url?: string };
        if (readme.encoding === 'base64' && typeof readme.content === 'string') {
          const decoded = Buffer.from(readme.content, 'base64');
          if (decoded.length <= 64_000) {
            repository.readme = decoded.toString('utf8');
            repository.readme_url = publicWebUrl(readme.html_url);
          }
        }
      } catch { /* A README is optional. */ }
      try {
        const release = await this.json(`${endpoint}/releases/latest`) as Record<string, unknown>;
        const url = publicWebUrl(release.html_url);
        if (url && typeof release.tag_name === 'string' && typeof release.published_at === 'string') {
          repository.latest_release = { tag: release.tag_name, name: String(release.name ?? release.tag_name), url, published_at: release.published_at };
        }
      } catch { /* No release is a normal source state. */ }
      return { requested_url, checked_at, observed_at: checked_at, availability: 'accessible', suppressed: false,
        etag: response.headers.get('etag') ?? undefined, last_modified: response.headers.get('last-modified') ?? undefined, repository };
    } catch {
      return { ...base, availability: 'temporarily_unavailable', suppressed: previous?.suppressed ?? false, error: 'unavailable' };
    }
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
