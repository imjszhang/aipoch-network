/** URL policy is deliberately independent of catalog data and UI code.
 * Legacy links can therefore migrate before any data request starts. */
export const DIRECTORY_SECTIONS = {
  explore: 'all',
  projects: 'project',
  capabilities: 'resource',
  organizations: 'organization',
  collections: 'collection',
  sources: 'source_repository',
  researchers: 'actor',
} as const;
export type DirectorySection = keyof typeof DIRECTORY_SECTIONS;
export const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'] as const;

export interface DirectoryRoute {
  section: DirectorySection;
  kind: string;
  page: number | null;
  browse?: true;
}

export function sectionForKind(kind: string): DirectorySection {
  const found = (Object.entries(DIRECTORY_SECTIONS) as [DirectorySection, string][]).find(([, value]) => value === kind);
  return found?.[0] ?? 'explore';
}

export function parseDirectoryPath(pathname: string): DirectoryRoute | undefined {
  const parts = pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
  const browse = parts[0] === 'browse';
  if (browse) parts.shift();
  const section = parts[0];
  if (!section || !Object.hasOwn(DIRECTORY_SECTIONS, section)) return;
  const kind = DIRECTORY_SECTIONS[section as DirectorySection];
  if (parts.length === 1) return { section: section as DirectorySection, kind, page: null, ...(browse ? { browse: true as const } : {}) };
  if (!browse && parts.length === 3 && parts[1] === 'page' && /^[1-9]\d{0,6}$/.test(parts[2]!)) {
    const page = Number(parts[2]);
    if (page > 1) return { section: section as DirectorySection, kind, page };
  }
  return;
}

/** Preserve unknown, invalid and repeated conditions for the existing repair UI. */
export function normalizeDirectoryParams(params: URLSearchParams, equivalentSorts = true): URLSearchParams {
  const next = new URLSearchParams();
  const plainListing = [...params].every(([key, value]) => key === 'sort' || key === 'page' || (TRACKING_PARAMS as readonly string[]).includes(key) || key === 'q' && !value.trim() || key === 'type' && value === 'all');
  for (const [key, value] of params) {
    if ((TRACKING_PARAMS as readonly string[]).includes(key)) continue;
    if (params.getAll(key).length === 1) {
      if (key === 'q' && !value.trim()) continue;
      if (key === 'type' && value === 'all') continue;
      if (key === 'sort' && (value === 'relevance' || equivalentSorts && value === 'title' && plainListing)) continue;
      if (key === 'page' && (value === '1' || value === '')) continue;
    }
    next.append(key, value);
  }
  next.sort(); // Stable for repeated keys; never silently chooses one of their values.
  return next;
}

export function isDefaultDirectoryParams(params: URLSearchParams, equivalentSorts = false): boolean {
  const normalized = normalizeDirectoryParams(params, equivalentSorts);
  for (const key of normalized.keys()) {
    if (key === 'page' && normalized.getAll(key).length === 1) continue;
    return false;
  }
  return true;
}

export function directoryHref(section: DirectorySection, page: number, params: URLSearchParams): string {
  const next = normalizeDirectoryParams(params);
  const repeatedPage = next.getAll('page').length > 1;
  if (!repeatedPage) next.delete('page');
  const pageNumber = Number.isSafeInteger(page) && page > 1 ? page : 1;
  if (!next.size) return pageNumber === 1 ? `/${section}/` : `/${section}/page/${pageNumber}/`;
  if (!repeatedPage && pageNumber > 1) next.set('page', String(pageNumber));
  next.sort();
  return `/browse/${section}/?${next}`;
}

/** Returns a same-site replacement href, including the deployment base and hash.
 * maxPage comes from the page's embedded counts, not a catalog network request.
 * Browse URLs remain at their explicitly noindex endpoint even without filters. */
export function legacyDirectoryRedirect(pathWithQuery: string, base = '/', maxPage?: number): string | undefined {
  if (!/^\/(?:[a-zA-Z0-9._-]+\/)*$/.test(base) || base.split('/').some(part => part === '.' || part === '..')) return;
  if (!pathWithQuery.startsWith('/') || pathWithQuery.startsWith('//')) return;
  const url = new URL(pathWithQuery, 'https://aipoch.invalid');
  if (url.origin !== 'https://aipoch.invalid') return;
  if (!url.pathname.startsWith(base)) return;
  const relativePath = `/${url.pathname.slice(base.length)}`;
  const directory = parseDirectoryPath(relativePath);
  if (!directory || directory.browse || !url.search) return;
  const params = new URLSearchParams(url.search);
  const rawPage = Number(params.get('page') ?? 1);
  const requestedPage = directory.page ?? (Number.isFinite(rawPage) && rawPage > 0 ? Math.max(1, Math.floor(rawPage)) : 1);
  const page = Number.isSafeInteger(maxPage) && maxPage! > 0 ? Math.min(requestedPage, maxPage!) : requestedPage <= 9_999_999 ? requestedPage : 1;
  const target = `${base}${directoryHref(directory.section, page, params).slice(1)}${url.hash}`;
  return target === `${url.pathname}${url.search}${url.hash}` ? undefined : target;
}
