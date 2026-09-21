import { compareDiscovery, parseDiscovery } from './discovery.js';
import { allEntries, isSharedCatalogRoute, routeFor, tombstoneRoutesFor, type Entry, type SiteData } from './model.js';
import { DIRECTORY_SECTIONS, type DirectorySection } from './directory-url.js';
export { DIRECTORY_SECTIONS, TRACKING_PARAMS, directoryHref, isDefaultDirectoryParams, legacyDirectoryRedirect, normalizeDirectoryParams, parseDirectoryPath, sectionForKind, type DirectoryRoute, type DirectorySection } from './directory-url.js';

export const PAGE_SIZE = 8;
export const DIRECTORY_LABELS: Record<string, { title: string; heading: string; description: string }> = {
  all: { title: 'Explore', heading: 'Explore the network', description: 'Discover research projects, reusable capabilities, and the people behind them.' },
  project: { title: 'Research projects', heading: 'Research projects', description: 'Find a direction, understand the work, and discover what you can build on.' },
  resource: { title: 'Reusable capabilities', heading: 'Reusable capabilities', description: 'Tools, methods, and workflows to bring into your own research.' },
  organization: { title: 'Organizations', heading: 'Organizations', description: 'Explore the research and capabilities shared through existing GitHub organizations.' },
  actor: { title: 'Researchers', heading: 'Researchers & maintainers', description: 'Public GitHub profiles connected to the sources in this directory.' },
  collection: { title: 'Collections', heading: 'Research collections', description: 'Curated starting points for a research question or field.' },
  source_repository: { title: 'Sources', heading: 'Source repositories', description: 'Original repositories behind the projects and capabilities in this network.' },
};

export function defaultDirectoryEntries(data: SiteData, kind: string): Entry[] {
  const bootstrap = data.data_kind === 'page' && data.directory_bootstrap?.kind === kind ? data.directory_bootstrap : undefined;
  if (bootstrap) {
    const entries = new Map(allEntries(data.catalog).map(entry => [entry.id, entry]));
    return bootstrap.ids.map(id => entries.get(id)).filter((entry): entry is Entry => Boolean(entry));
  }
  const discovery = parseDiscovery(new URLSearchParams(), kind, data.generated_at);
  return allEntries(data.catalog)
    .filter(entry => kind === 'all' || entry.kind === kind)
    .sort((a, b) => compareDiscovery(a, b, data.catalog, discovery));
}

export function directoryPageCount(data: SiteData, kind: string): number {
  if (data.data_kind === 'page' && data.directory_bootstrap?.kind === kind) return Math.max(1, Math.ceil(data.directory_bootstrap.total / PAGE_SIZE));
  return Math.max(1, Math.ceil(defaultDirectoryEntries(data, kind).length / PAGE_SIZE));
}

export function directoryPageItems(data: SiteData, kind: string, page: number): Entry[] {
  if (data.data_kind === 'page' && data.directory_bootstrap?.kind === kind && data.directory_bootstrap.page === page) return defaultDirectoryEntries(data, kind);
  return defaultDirectoryEntries(data, kind).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}

export function prerenderPaths(data: SiteData, demo = false): string[] {
  const paths = ['/', '/explore/', '/projects/', '/capabilities/', '/organizations/', '/researchers/', '/collections/', '/sources/', '/community/', '/submit/', '/join/', '/me/', '/contribute/'];
  if (demo) paths.push('/review/');
  for (const [section, kind] of Object.entries(DIRECTORY_SECTIONS) as [DirectorySection, string][]) {
    paths.push(`/browse/${section}/`);
    const pages = directoryPageCount(data, kind);
    for (let page = 2; page <= pages; page++) paths.push(`/${section}/page/${page}/`);
  }
  paths.push(...allEntries(data.catalog).map(routeFor), ...data.catalog.tombstones.flatMap(tombstoneRoutesFor), '/404/');
  return paths;
}

export { isSharedCatalogRoute };
