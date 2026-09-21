import { resourceTypeLabel } from '../../spec/identity.js';
import { allEntries, routeFor, tombstoneRoutesFor, type Entry, type SiteData } from './model.js';
import { DIRECTORY_LABELS, directoryPageCount, directoryPageItems, parseDirectoryPath } from './directory-routes.js';
import { absoluteUrl, type SiteConfig } from './site-url.js';

export const HOME_TITLE = 'Science Open to All | AIPOCH Network';
export const HOME_DESCRIPTION = 'Discover research projects and reusable capabilities, connected to their original GitHub sources.';
const PAGE_TITLES: Record<string, string> = {
  '/': 'Science Open to All',
  '/explore/': 'Explore',
  '/projects/': 'Research projects',
  '/capabilities/': 'Reusable capabilities',
  '/organizations/': 'Organizations',
  '/researchers/': 'Researchers',
  '/collections/': 'Collections',
  '/sources/': 'Sources',
  '/community/': 'Community',
  '/submit/': 'Share research',
  '/join/': 'Join with Open-Science',
  '/me/': 'Saved research',
  '/review/': 'Connection scenarios',
  '/contribute/': 'Contribute',
  '/404/': 'Entry not found',
};
const PAGE_DESCRIPTIONS: Record<string, string> = {
  '/': HOME_DESCRIPTION,
  '/community/': 'Follow the connections, shared resources and carefully documented contributions behind the network.',
  '/contribute/': 'Connect it to a wider network. Start with the GitHub projects and organizations you already use.',
  '/submit/': 'A public GitHub link is enough to begin. Review exactly what you want to share.',
  '/join/': 'Connect your workbench to continue with the projects and capabilities you find here.',
  '/me/': 'Saved research stays in this browser until you connect a workbench.',
  '/review/': 'Isolated connection scenarios for review. Not a public catalog page.',
  '/404/': 'This page may have moved or been withdrawn.',
};

export interface SeoDecision {
  title: string;
  description: string;
  canonicalUrl: string | null;
  canonicalPath: string | null;
  robots: 'index, follow' | 'noindex, follow';
  indexable: boolean;
  sitemap: boolean;
  jsonLd: Record<string, unknown>[];
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function splitPath(path: string): { pathname: string; params: URLSearchParams } {
  const [pathname = '/', search = ''] = path.split('?');
  return { pathname: pathname.endsWith('/') || pathname === '/' ? pathname : `${pathname}/`, params: new URLSearchParams(search) };
}

function entryDescription(entry: Entry): string {
  if (entry.description) return entry.description;
  if (entry.kind === 'organization') return 'Selected public research from this GitHub organization.';
  return 'Description not yet supplied.';
}

function withTitle(label: string): string { return `${label} | AIPOCH Network`; }

export function seoForPath(path: string, data: SiteData, config: SiteConfig): SeoDecision {
  const { pathname, params } = splitPath(path);
  const entries = allEntries(data.catalog);
  const entry = entries.find(item => routeFor(item) === pathname);
  const tombstone = data.catalog.tombstones.find(row => tombstoneRoutesFor(row).includes(pathname));
  const directory = parseDirectoryPath(pathname);
  // GitHub Pages serves one HTML document per path regardless of query. Keep its
  // head stable; legacy queries migrate to browse before fetching directory data.
  const defaultListing = Boolean(directory && !directory.browse);
  const pageNumber = directory?.page ?? 1;
  const action = ['/submit/', '/join/', '/me/', '/review/'].includes(pathname);
  const notFound = Boolean(directory?.page && directory.page > directoryPageCount(data, directory.kind)) || pathname === '/404/' || (!entry && !directory && !PAGE_TITLES[pathname] && !tombstone);
  const canonicalPath = directory?.browse ? null : pathname;

  const robots: SeoDecision['robots'] = !config.indexing || action || Boolean(tombstone) || notFound || directory?.browse ? 'noindex, follow' : 'index, follow';
  const indexable = robots === 'index, follow';

  let title = HOME_TITLE;
  let description = HOME_DESCRIPTION;
  if (pathname === '/') { title = HOME_TITLE; description = HOME_DESCRIPTION; }
  else if (entry) { title = withTitle(entry.title); description = entryDescription(entry); }
  else if (tombstone) { title = withTitle('Catalog record withdrawn'); description = 'This record is no longer available in the catalog.'; }
  else if (directory) {
    const labels = DIRECTORY_LABELS[directory.kind] ?? DIRECTORY_LABELS.all;
    const page = directory.page && directory.page > 1 ? directory.page : undefined;
    title = withTitle(page && page > 1 ? `${labels.title}, page ${page}` : labels.title);
    description = labels.description;
  } else if (PAGE_TITLES[pathname]) {
    title = withTitle(PAGE_TITLES[pathname]);
    description = PAGE_DESCRIPTIONS[pathname] ?? HOME_DESCRIPTION;
  } else {
    title = withTitle('Entry not found');
    description = PAGE_DESCRIPTIONS['/404/']!;
  }

  const canonicalUrl = canonicalPath === null ? null : absoluteUrl(canonicalPath, config);
  const barePath = [...params.keys()].length === 0;
  const firstDirectoryPage = Boolean(directory && !directory.browse && !directory.page && barePath && canonicalPath === `/${directory.section}/`);
  return {
    title, description, canonicalUrl, canonicalPath, robots, indexable,
    sitemap: Boolean(config.indexing && indexable && barePath && canonicalPath === pathname && (pathname === '/' || pathname === '/community/' || pathname === '/contribute/' || Boolean(entry) || firstDirectoryPage)),
    jsonLd: canonicalUrl === null ? [] : structuredData({ pathname, canonicalUrl, title, description, data, entry, directory, indexable, defaultListing, pageNumber, config }),
  };
}

function structuredData(input: {
  pathname: string; canonicalUrl: string; title: string; description: string; data: SiteData; entry?: Entry;
  directory?: ReturnType<typeof parseDirectoryPath>; indexable: boolean; defaultListing: boolean; pageNumber: number; config: SiteConfig;
}): Record<string, unknown>[] {
  if (!input.indexable) return [];
  if (input.pathname === '/') {
    return [{
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'AIPOCH Network',
      url: input.canonicalUrl,
      description: HOME_DESCRIPTION,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${absoluteUrl('/browse/explore/', input.config)}?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    }];
  }
  if (input.directory && input.defaultListing) {
    const page = input.directory.page && input.directory.page > 1 ? input.directory.page : Math.max(1, input.pageNumber);
    const items = directoryPageItems(input.data, input.directory.kind, page);
    const labels = DIRECTORY_LABELS[input.directory.kind] ?? DIRECTORY_LABELS.all;
    return [{
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: labels.heading,
      url: input.canonicalUrl,
      description: labels.description,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: items.length,
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: absoluteUrl(routeFor(item), input.config),
          name: item.title,
        })),
      },
    }];
  }
  if (input.pathname === '/community/' || input.pathname === '/contribute/') {
    return [{ '@context': 'https://schema.org', '@type': 'WebPage', name: input.title.replace(/ \| AIPOCH Network$/, ''), url: input.canonicalUrl, description: input.description }];
  }
  if (!input.entry) return [];
  const entry = input.entry;
  const common = { '@context': 'https://schema.org', name: entry.title, url: input.canonicalUrl, description: entryDescription(entry) };
  if (entry.kind === 'organization') return [{ ...common, '@type': 'Organization' }];
  if (entry.kind === 'actor') return [{ ...common, '@type': 'Person' }];
  if (entry.kind === 'collection') return [{ ...common, '@type': 'Collection' }];
  if (entry.kind === 'source_repository') return [{ ...common, '@type': 'SoftwareSourceCode', codeRepository: entry.canonical_url }];
  if (entry.kind === 'resource') return [{ ...common, '@type': 'CreativeWork', additionalType: resourceTypeLabel(entry.resource_type) }];
  return [{ ...common, '@type': 'CreativeWork' }];
}

export function sitemapEntries(data: SiteData, config: SiteConfig, renderedPaths: string[]): string[] {
  const urls: string[] = [];
  for (const path of renderedPaths) {
    if (path === '/404/') continue;
    const seo = seoForPath(path, data, config);
    if (seo.sitemap && seo.canonicalUrl) urls.push(seo.canonicalUrl);
  }
  return [...new Set(urls)];
}

export function robotsText(config: SiteConfig): string {
  const lines = ['User-agent: *', 'Allow: /'];
  if (config.indexing) lines.push('', `Sitemap: ${absoluteUrl('sitemap.xml', config)}`);
  return `${lines.join('\n')}\n`;
}

export function sitemapXml(urls: string[]): string {
  const body = urls.map(url => `  <url>\n    <loc>${escapeAttribute(url)}</loc>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function seoHeadMarkup(decision: SeoDecision): string {
  const jsonLd = decision.jsonLd.map(item => `<script type="application/ld+json" data-aipoch-seo="true">${JSON.stringify(item).replaceAll('<', '\\u003c')}</script>`).join('');
  const canonical = decision.canonicalUrl === null ? '' : `<link rel="canonical" href="${escapeAttribute(decision.canonicalUrl)}" />`;
  return `${canonical}<meta name="robots" content="${decision.robots}" />${jsonLd}`;
}

export function applySeoToDocument(doc: Document, decision: SeoDecision, preserveHomeMetadata = false): void {
  if (!preserveHomeMetadata) {
    doc.title = decision.title;
  }
  const description = doc.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', decision.description);
  let canonical = doc.querySelector('link[rel="canonical"]');
  if (decision.canonicalUrl === null) {
    for (const node of doc.querySelectorAll('link[rel="canonical"]')) node.remove();
  } else {
    if (!canonical) { canonical = doc.createElement('link'); canonical.setAttribute('rel', 'canonical'); doc.head.appendChild(canonical); }
    canonical.setAttribute('href', decision.canonicalUrl);
  }
  let robots = doc.querySelector('meta[name="robots"]');
  if (!robots) { robots = doc.createElement('meta'); robots.setAttribute('name', 'robots'); doc.head.appendChild(robots); }
  robots.setAttribute('content', decision.robots);
  for (const node of [...doc.querySelectorAll('script[data-aipoch-seo]')]) node.remove();
  for (const item of decision.jsonLd) {
    const script = doc.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.aipochSeo = 'true';
    script.textContent = JSON.stringify(item);
    doc.head.appendChild(script);
  }
}

export function defaultSiteConfig(): SiteConfig {
  return { origin: 'https://aipoch.network', base: '/', indexing: true };
}
