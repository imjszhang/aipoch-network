import { compareDiscovery, parseDiscovery } from './discovery.js';
import { allEntries, isSharedCatalogRoute, routeFor, tombstoneRoutesFor, type Entry, type SiteData } from './model.js';

export const PAGE_SIZE = 8;
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
export const DIRECTORY_LABELS: Record<string, { title: string; heading: string; description: string }> = {
  all: { title: 'Explore', heading: 'Explore the network', description: 'Discover research projects, reusable capabilities, and the people behind them.' },
  project: { title: 'Research projects', heading: 'Research projects', description: 'Find a direction, understand the work, and discover what you can build on.' },
  resource: { title: 'Reusable capabilities', heading: 'Reusable capabilities', description: 'Tools, methods, and workflows to bring into your own research.' },
  organization: { title: 'Organizations', heading: 'Organizations', description: 'Explore the research and capabilities shared through existing GitHub organizations.' },
  actor: { title: 'Researchers', heading: 'Researchers & maintainers', description: 'Public GitHub profiles connected to the sources in this directory.' },
  collection: { title: 'Collections', heading: 'Research collections', description: 'Curated starting points for a research question or field.' },
  source_repository: { title: 'Sources', heading: 'Source repositories', description: 'Original repositories behind the projects and capabilities in this network.' },
};
export const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'] as const;

export interface DirectoryRoute {
  section: DirectorySection;
  kind: string;
  page: number | null;
}

export function sectionForKind(kind: string): DirectorySection {
  const found = (Object.entries(DIRECTORY_SECTIONS) as [DirectorySection, string][]).find(([, value]) => value === kind);
  return found?.[0] ?? 'explore';
}

export function parseDirectoryPath(pathname: string): DirectoryRoute | undefined {
  const parts = pathname.replace(/\/$/, '').split('/').filter(Boolean);
  const section = parts[0];
  if (!section || !Object.hasOwn(DIRECTORY_SECTIONS, section)) return;
  const kind = DIRECTORY_SECTIONS[section as DirectorySection];
  if (parts.length === 1) return { section: section as DirectorySection, kind, page: null };
  if (parts.length === 3 && parts[1] === 'page') {
    if (!/^[1-9]\d{0,6}$/.test(parts[2]!)) return;
    const page = Number(parts[2]);
    if (page === 1) return;
    return { section: section as DirectorySection, kind, page };
  }
  return;
}

export function isDefaultDirectoryParams(params: URLSearchParams, equivalentSorts = false): boolean {
  for (const key of params.keys()) {
    if (key === 'page') continue;
    if ((TRACKING_PARAMS as readonly string[]).includes(key)) continue;
    if (key === 'sort' && (params.get(key) === 'relevance' || equivalentSorts && params.get(key) === 'title')) continue;
    return false;
  }
  return true;
}

export function directoryHref(section: DirectorySection, page: number, params: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const [key, value] of params) {
    if (key === 'page') continue;
    next.append(key, value);
  }
  if (isDefaultDirectoryParams(next)) return page <= 1 ? `/${section}/` : `/${section}/page/${page}/`;
  if (page > 1) next.set('page', String(page));
  const query = next.toString();
  return `/${section}/${query ? `?${query}` : ''}`;
}

export function defaultDirectoryEntries(data: SiteData, kind: string): Entry[] {
  const discovery = parseDiscovery(new URLSearchParams(), kind, data.generated_at);
  return allEntries(data.catalog)
    .filter(entry => kind === 'all' || entry.kind === kind)
    .sort((a, b) => compareDiscovery(a, b, data.catalog, discovery));
}

export function directoryPageCount(data: SiteData, kind: string): number {
  return Math.max(1, Math.ceil(defaultDirectoryEntries(data, kind).length / PAGE_SIZE));
}

export function directoryPageItems(data: SiteData, kind: string, page: number): Entry[] {
  return defaultDirectoryEntries(data, kind).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}

export function prerenderPaths(data: SiteData, demo = false): string[] {
  const paths = ['/', '/explore/', '/projects/', '/capabilities/', '/organizations/', '/researchers/', '/collections/', '/sources/', '/community/', '/submit/', '/join/', '/me/', '/contribute/'];
  if (demo) paths.push('/review/');
  for (const [section, kind] of Object.entries(DIRECTORY_SECTIONS) as [DirectorySection, string][]) {
    const pages = directoryPageCount(data, kind);
    for (let page = 2; page <= pages; page++) paths.push(`/${section}/page/${page}/`);
  }
  paths.push(...allEntries(data.catalog).map(routeFor), ...data.catalog.tombstones.flatMap(tombstoneRoutesFor), '/404/');
  return paths;
}

export { isSharedCatalogRoute };
