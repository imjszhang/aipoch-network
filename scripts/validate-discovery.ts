import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const sections = ['explore', 'projects', 'capabilities', 'organizations', 'researchers', 'collections', 'sources'] as const;
const actionPaths = new Set(['/submit/', '/join/', '/me/', '/review/', '/404/']);
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Static discovery: ${message}`); }
function decode(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, match => {
    if (match.startsWith('&#')) return String.fromCodePoint(match[2].toLowerCase() === 'x' ? parseInt(match.slice(3, -1), 16) : parseInt(match.slice(2, -1), 10));
    return ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' } as Record<string, string>)[match.toLowerCase()]!;
  });
}
function attributes(tag: string): Map<string, string> {
  return new Map([...tag.matchAll(/\s([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4])]));
}
const stripHidden = (html: string) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');

function listingHrefs(html: string): string[] {
  const stack: { tag: string; classes: string[] }[] = [], hrefs: string[] = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const match of stripHidden(html).matchAll(/<\/?[a-zA-Z][^>]*>/g)) {
    const tag = match[0], name = tag.match(/^<\/?([\w-]+)/)![1].toLowerCase();
    if (tag.startsWith('</')) {
      const index = stack.findLastIndex(frame => frame.tag === name);
      if (index >= 0) stack.length = index;
      continue;
    }
    const attr = attributes(tag), classes = (attr.get('class') ?? '').split(/\s+/);
    const within = (className: string) => stack.some(frame => frame.classes.includes(className));
    // A project row also links its source; that is provenance, not another result.
    const primary = classes.includes('simple-card') || classes.includes('organization-card') || within('row-title') || within('capability-card') && stack.at(-1)?.tag === 'h3';
    if (name === 'a' && within('results-list') && primary && attr.has('href')) hrefs.push(attr.get('href')!);
    if (!voidTags.has(name) && !tag.endsWith('/>')) stack.push({ tag: name, classes });
  }
  return hrefs;
}

/** Independent assertions over the published HTML, not the renderer's SEO model.
 * A sitemap never substitutes for a real anchor path through directory pages. */
export async function validateDiscoveryOutput(directory: string, options: { base?: string; origin?: string; indexing?: boolean } = {}): Promise<{ pages: number; sitemapUrls: number; reachableDetails: number }> {
  const base = options.base ?? '/', origin = options.origin ?? 'https://aipoch.network';
  const indexing = options.indexing ?? (base === '/');
  assert(/^\/(?:[a-zA-Z0-9._-]+\/)*$/.test(base) && !base.split('/').some(part => part === '.' || part === '..'), 'invalid deployment base');
  const routes = JSON.parse(await readFile(join(directory, 'routes.json'), 'utf8')) as { paths: string[]; base: string };
  assert(routes.base === base && Array.isArray(routes.paths), 'route manifest disagrees with the deployment base');
  const paths = new Set(routes.paths);
  const graph = new Map<string, Set<string>>(), indexable = new Map<string, boolean>();
  const data = JSON.parse(await readFile(join(directory, 'internal/catalog.json'), 'utf8')) as { catalog?: Record<string, { id: string; account_type?: string }[]> };
  const catalog = data.catalog;
  if (sections.some(section => paths.has(`/${section}/`))) assert(catalog, 'directory output is missing its catalog graph');
  const expected = new Map<string, Set<string>>(sections.map(section => [section, new Set()]));
  const withdrawn = new Set<string>();
  if (catalog) {
    for (const [collection, section] of [['projects', 'projects'], ['resources', 'capabilities'], ['organizations', 'organizations'], ['actors', 'researchers'], ['collections', 'collections'], ['sources', 'sources']]) {
      assert(Array.isArray(catalog[collection]), `missing catalog collection ${collection}`);
      for (const row of catalog[collection]) {
        if (collection === 'actors' && row.account_type !== 'user') continue;
        const path = `/${section}/${row.id.replaceAll(':', '~')}/`;
        assert(paths.has(path), `catalog detail has no published route: ${path}`);
        expected.get(section)!.add(path); expected.get('explore')!.add(path);
      }
    }
    for (const row of catalog.tombstones ?? []) {
      const section = ({ source: 'sources', project: 'projects', resource: 'capabilities', actor: 'organizations', collection: 'collections' } as Record<string, string>)[row.id.split(':')[0]] ?? 'entries';
      withdrawn.add(`/${section}/${row.id.replaceAll(':', '~')}/`);
      if (row.id.startsWith('actor:')) withdrawn.add(`/researchers/${row.id.replaceAll(':', '~')}/`);
    }
    for (const section of sections) {
      assert(paths.has(`/${section}/`), `missing directory entrance /${section}/`);
      assert(paths.has(`/browse/${section}/`), `missing operation entrance /browse/${section}/`);
    }
  }

  const sitemapText = await readFile(join(directory, 'sitemap.xml'), 'utf8');
  const sitemap = [...sitemapText.matchAll(/<loc>([^<]*)<\/loc>/g)].map(match => decode(match[1]));
  assert(new Set(sitemap).size === sitemap.length, 'duplicate sitemap URL');
  assert(indexing || sitemap.length === 0, 'a non-indexing build must have an empty sitemap');
  for (const path of [...routes.paths, '/404/']) {
    assert(/^\/(?:[^/?#\\\u0000-\u0020]+\/)*$/.test(path) && !path.split('/').some(part => part === '.' || part === '..'), `invalid published route ${path}`);
    const html = await readFile(join(directory, path === '/404/' ? '404.html' : `${path.slice(1)}index.html`), 'utf8');
    const head = stripHidden(html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '');
    const tags = [...head.matchAll(/<[^>]+>/g)].map(match => ({ tag: match[0], attr: attributes(match[0]) }));
    const robots = tags.filter(({ tag, attr }) => /^<meta\b/i.test(tag) && attr.get('name')?.toLowerCase() === 'robots');
    const canonical = tags.filter(({ tag, attr }) => /^<link\b/i.test(tag) && attr.get('rel')?.toLowerCase().split(/\s+/).includes('canonical'));
    const browse = /^\/browse\/(?:explore|projects|capabilities|organizations|researchers|collections|sources)\/$/.test(path);
    const shouldIndex = indexing && !browse && !actionPaths.has(path) && !withdrawn.has(path);
    assert(robots.length === 1, `${path} must have exactly one initial robots directive`);
    assert(robots[0].attr.get('content') === (shouldIndex ? 'index, follow' : 'noindex, follow'), `${path} has an inconsistent initial robots directive`);
    assert(canonical.length === (browse ? 0 : 1), `${path} has an inconsistent canonical count`);
    const pageUrl = new URL(`${base}${path.slice(1)}`, origin);
    if (!browse) assert(canonical[0].attr.get('href') === pageUrl.href, `${path} does not self-canonicalize to its static path`);
    indexable.set(path, shouldIndex);
    const links = new Set<string>();
    for (const match of stripHidden(html).matchAll(/<a\b[^>]*>/gi)) {
      const href = attributes(match[0]).get('href');
      if (!href) continue;
      const target = new URL(href, pageUrl);
      if (target.origin !== origin || !target.pathname.startsWith(base) || target.search) continue;
      const linkedPath = `/${target.pathname.slice(base.length)}`;
      if (paths.has(linkedPath)) links.add(linkedPath);
    }
    graph.set(path, links);
    const listing = path.match(/^\/(explore|projects|capabilities|organizations|researchers|collections|sources)\/(?:page\/[1-9]\d*\/)?$/);
    if (catalog && shouldIndex && listing) {
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match => attributes(`<script ${match[1]}>`).get('type') === 'application/ld+json');
      const records = scripts.map(match => JSON.parse(match[2]) as Record<string, unknown>);
      const lists = records.filter(record => record['@type'] === 'CollectionPage');
      assert(lists.length === 1, `${path} must describe one static CollectionPage`);
      const itemList = lists[0].mainEntity as { '@type'?: string; numberOfItems?: number; itemListElement?: { position?: number; url?: string }[] };
      assert(itemList?.['@type'] === 'ItemList' && Array.isArray(itemList.itemListElement), `${path} has no static ItemList`);
      const actual = listingHrefs(html).map(href => new URL(href, pageUrl)).filter(url => url.origin === origin && url.pathname.startsWith(base) && !url.search)
        .map(url => `/${url.pathname.slice(base.length)}`).filter(link => expected.get(listing[1])!.has(link));
      assert(itemList.numberOfItems === actual.length && itemList.itemListElement.length === actual.length, `${path} ItemList count disagrees with its HTML links`);
      for (const [index, item] of itemList.itemListElement.entries()) {
        assert(item.position === index + 1 && item.url === new URL(`${base}${actual[index].slice(1)}`, origin).href, `${path} ItemList order disagrees with its HTML links`);
      }
    }
  }

  for (const loc of sitemap) {
    const url = new URL(loc);
    assert(url.origin === origin && url.pathname.startsWith(base) && !url.search && !url.hash && !url.username && !url.password, `invalid sitemap URL ${loc}`);
    const path = `/${url.pathname.slice(base.length)}`;
    assert(paths.has(path) && indexable.get(path), `sitemap points to a missing or noindex page: ${path}`);
    assert(!/\/page\/\d+\/$/.test(path), `sitemap contains pagination: ${path}`);
  }

  for (const [section, details] of expected) {
    if (!catalog) break;
    const seen = new Set<string>(), discovered = new Set<string>(), queue = [`/${section}/`];
    const paged = new RegExp(`^/${section}/(?:page/[1-9]\\d*/)?$`);
    while (queue.length) {
      const path = queue.shift()!;
      if (seen.has(path)) continue;
      seen.add(path);
      for (const link of graph.get(path) ?? []) {
        if (paged.test(link) && !seen.has(link)) queue.push(link);
        if (details.has(link)) discovered.add(link);
      }
    }
    for (const path of paths) if (paged.test(path)) assert(seen.has(path), `directory pagination is unreachable from /${section}/: ${path}`);
    for (const path of details) assert(discovered.has(path), `detail is unreachable through ${section} directory HTML: ${path}`);
  }
  return { pages: graph.size, sitemapUrls: sitemap.length, reachableDetails: catalog ? expected.get('explore')!.size : 0 };
}
