import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Search, SlidersHorizontal, X } from 'lucide-react';
import MiniSearch from 'minisearch';
import { searchOptions, type SearchDocument } from '../search.js';
import { allEntries, displayDate, relatedEntriesFor, routeFor, type Entry, type SiteData } from '../model.js';
import { Link, useNavigation } from '../navigation.js';
import { ArrowLink, PageHeader, ProjectRows, CapabilityCard, OrganizationCard } from '../catalog-components.js';

const PAGE_SIZE = 8;
const sections: Record<string, { title: string; description: string; tab: string }> = {
  all: { title: 'Explore the network', description: 'Discover research projects, reusable capabilities, and the people behind them.', tab: 'All' },
  project: { title: 'Research projects', description: 'Find a direction, understand the work, and discover what you can build on.', tab: 'Projects' },
  resource: { title: 'Reusable capabilities', description: 'Tools, methods, and workflows to bring into your own research.', tab: 'Capabilities' },
  organization: { title: 'Organizations', description: 'Explore the research and capabilities shared through existing GitHub organizations.', tab: 'Organizations' },
  actor: { title: 'Researchers & maintainers', description: 'Public GitHub profiles connected to the sources in this directory.', tab: 'Researchers' },
  collection: { title: 'Research collections', description: 'Curated starting points for a research question or field.', tab: 'Collections' },
  source_repository: { title: 'Source repositories', description: 'Original repositories behind the projects and capabilities in this network.', tab: 'Source repositories' },
};
const accessOptions: Record<string, string> = {
  pinned: 'Pinned source version',
  unpinned: 'No pinned source version',
  unknown: 'License unknown',
  stale: 'Stale source observation',
};
type FilterChanges = Partial<Record<'q' | 'domain' | 'type' | 'organization' | 'collection' | 'access' | 'sort' | 'page', string>>;

export function Directory({ data, kind, base }: { data: SiteData; kind: string; base: string }) {
  const { path, navigate } = useNavigation();
  const catalog = data.catalog;
  const config = sections[kind] ?? sections.all;
  const [controlsReady, setControlsReady] = useState(false);
  useEffect(() => setControlsReady(true), []);
  const params = useMemo(() => new URLSearchParams(path.split('?')[1] ?? ''), [path]);
  const query = params.get('q') ?? '';
  const domain = params.get('domain') ?? '';
  const organizationId = params.get('organization') ?? '';
  const collectionId = params.get('collection') ?? '';
  const access = params.get('access') ?? '';
  const filter = kind === 'all' ? params.get('type') || 'all' : kind;
  const sort = ['title', 'updated'].includes(params.get('sort') ?? '') ? params.get('sort')! : 'relevance';
  const entries = useMemo(() => allEntries(catalog), [catalog]);
  const sources = useMemo(() => new Map(catalog.sources.map(source => [source.id, source])), [catalog]);
  const domains = useMemo(() => [...new Set([...catalog.projects, ...catalog.resources].flatMap(row => row.domains))].sort(), [catalog]);
  const organization = catalog.organizations.find(row => row.id === organizationId);
  const collection = catalog.collections.find(row => row.id === collectionId);
  const organizationMembers = useMemo(() => organizationId ? new Set(organization ? relatedEntriesFor(organization, catalog).map(row => row.id) : []) : undefined, [organizationId, organization, catalog]);
  const collectionMembers = useMemo(() => collectionId ? new Set(collection ? relatedEntriesFor(collection, catalog).map(row => row.id) : []) : undefined, [collectionId, collection, catalog]);

  const [index, setIndex] = useState<MiniSearch<SearchDocument>>();
  const [searchState, setSearchState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    setSearchState('loading');
    setIndex(undefined);
    fetch(`${base}internal/search.json`, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Search index unavailable');
      return response.json();
    }).then(payload => {
      if (payload.snapshot_id !== data.snapshot_id) throw new Error('Search snapshot changed');
      const nextIndex = MiniSearch.loadJSON<SearchDocument>(JSON.stringify(payload.index), searchOptions);
      if (active) { setIndex(nextIndex); setSearchState('ready'); }
    }).catch(() => { if (active) setSearchState('failed'); }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [base, data.snapshot_id, retry]);

  function update(next: FilterChanges, push = false) {
    const nextParams = new URLSearchParams(params);
    if (next.page === undefined) nextParams.delete('page');
    for (const [key, value] of Object.entries(next)) {
      if (value && !(key === 'type' && value === 'all') && !(key === 'sort' && value === 'relevance') && !(key === 'page' && value === '1')) nextParams.set(key, value);
      else nextParams.delete(key);
    }
    void navigate(`${path.split('?')[0]}${nextParams.size ? `?${nextParams}` : ''}`, { replace: !push, preserveScroll: true });
  }
  const reset = () => update({ q: '', domain: '', type: '', organization: '', collection: '', access: '', sort: '' });
  const matches = useMemo(() => query.trim() && index ? new Map(index.search(query).map((row, position) => [String(row.id), position])) : undefined, [query, index]);
  const results = useMemo(() => {
    function matchesAccess(entry: Entry): boolean {
      if (!access) return true;
      // Pinning describes an explicit immutable reference, never a repository's observed HEAD.
      if (access === 'pinned' || access === 'unpinned') {
        if (entry.kind !== 'project' && entry.kind !== 'resource') return false;
        const pinned = entry.source_refs.some(ref => Boolean(ref.commit));
        return access === 'pinned' ? pinned : !pinned;
      }
      if (access === 'unknown') {
        if (entry.kind === 'resource' || entry.kind === 'source_repository') return entry.license.status === 'unknown';
        // Projects have no project-level license; expose unknown referenced source conditions.
        return entry.kind === 'project' && (!entry.source_refs.length || entry.source_refs.some(ref => !sources.has(ref.source_id) || sources.get(ref.source_id)?.license.status === 'unknown'));
      }
      if (access === 'stale') {
        if (entry.kind === 'source_repository') return entry.stale;
        return (entry.kind === 'project' || entry.kind === 'resource') && entry.source_refs.some(ref => sources.get(ref.source_id)?.stale);
      }
      return false;
    }
    const filtered = entries.filter(entry =>
      (!organizationMembers || organizationMembers.has(entry.id)) &&
      (!collectionMembers || collectionMembers.has(entry.id)) &&
      (filter === 'all' || entry.kind === filter) &&
      (!domain || ('domains' in entry && entry.domains.includes(domain))) &&
      matchesAccess(entry) &&
      (!query.trim() || searchState !== 'ready' || matches?.has(entry.id)),
    );
    return filtered.sort((a, b) => {
      const rank = sort === 'updated' ? b.updated_at.localeCompare(a.updated_at) : sort === 'relevance' && matches && searchState === 'ready' ? (matches.get(a.id) ?? Infinity) - (matches.get(b.id) ?? Infinity) : 0;
      return rank || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
  }, [entries, organizationMembers, collectionMembers, filter, domain, access, sources, query, searchState, matches, sort]);
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const requestedPage = Number(params.get('page') ?? '1');
  const pageNumber = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  // Render the clamped page immediately, then repair shared URLs without a navigation/focus reset.
  useEffect(() => {
    if (!controlsReady || (query.trim() && searchState === 'loading') || !params.has('page')) return;
    const canonicalPage = pageNumber === 1 ? null : String(pageNumber);
    if (params.get('page') === canonicalPage) return;
    const nextParams = new URLSearchParams(params);
    if (canonicalPage) nextParams.set('page', canonicalPage); else nextParams.delete('page');
    void navigate(`${path.split('?')[0]}${nextParams.size ? `?${nextParams}` : ''}`, { replace: true, preserveScroll: true });
  }, [controlsReady, query, searchState, params, pageNumber, path, navigate]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!filtersOpen || !filterDialog.current) return;
    const dialog = filterDialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); document.body.style.overflow = previousOverflow; };
  }, [filtersOpen]);
  const closeFilters = () => filterDialog.current?.close();
  const filterContent = (prefix: string) => <>
    <label htmlFor={`${prefix}-domain`}>Research area</label>
    <select id={`${prefix}-domain`} disabled={!controlsReady} value={domain} onChange={event => update({ domain: event.target.value })}>
      <option value="">All areas</option>
      {domains.map(value => <option key={value}>{value}</option>)}
      {domain && !domains.includes(domain) && <option value={domain}>{domain} (unknown)</option>}
    </select>
    <label htmlFor={`${prefix}-organization`}>Organization</label>
    <select id={`${prefix}-organization`} disabled={!controlsReady} value={organizationId} onChange={event => update({ organization: event.target.value })}>
      <option value="">All organizations</option>
      {catalog.organizations.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
      {organizationId && !organization && <option value={organizationId}>Unknown organization</option>}
    </select>
    <label htmlFor={`${prefix}-collection`}>Collection</label>
    <select id={`${prefix}-collection`} disabled={!controlsReady} value={collectionId} onChange={event => update({ collection: event.target.value })}>
      <option value="">All collections</option>
      {catalog.collections.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
      {collectionId && !collection && <option value={collectionId}>Unknown collection</option>}
    </select>
    <label htmlFor={`${prefix}-access`}>Version &amp; conditions</label>
    <select id={`${prefix}-access`} disabled={!controlsReady} value={access} onChange={event => update({ access: event.target.value })}>
      <option value="">Any status</option>
      {Object.entries(accessOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      {access && !accessOptions[access] && <option value={access}>Unknown status</option>}
    </select>
    <button className="directory-reset" disabled={!controlsReady} onClick={reset}>Reset filters</button>
    <p className="filter-note">Inclusion in the directory is separate from maintainer acknowledgement and scientific validation.</p>
  </>;
  const activeFilters = [domain, organizationId && (organization?.title ?? 'Unknown organization'), collectionId && (collection?.title ?? 'Unknown collection'), access && (accessOptions[access] ?? 'Unknown status')].filter(Boolean);
  const hasSearchResults = Boolean(query.trim()) && searchState === 'ready';
  return <>
    <div className="directory-page-heading"><PageHeader title={config.title} description={config.description} action={<ArrowLink to="/submit/" primary>Share research</ArrowLink>}/></div>
    <main className={`wrap directory directory-v9 ${kind}-directory`}>
      <form className="search-box directory-search" role="search" onSubmit={event => event.preventDefault()}>
        <Search size={21}/>
        <input disabled={!controlsReady} type="search" aria-label="Search directory" placeholder="Search the network…" value={query} onChange={event => update({ q: event.target.value })}/>
        {query && <button disabled={!controlsReady} type="button" className="icon-button" aria-label="Clear search" onClick={() => update({ q: '' })}><X size={18}/></button>}
      </form>
      <nav className="directory-tabs" aria-label="Directory types">
        {kind === 'all' ? <>
          {Object.entries(sections).map(([value, section]) => <button disabled={!controlsReady} key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => update({ type: value })}>{section.tab}</button>)}
          {!sections[filter] && <span className="active">Unknown type</span>}
        </> : <><span className="active">{config.title}</span><Link to="/explore/">All of the network <ArrowUpRight size={14}/></Link></>}
      </nav>
      <noscript><p className="notice">Search and filters require JavaScript. The entries below and their detail links remain readable.</p></noscript>
      <div className="directory-columns">
        <aside className="panel directory-filters desktop-filters" aria-label="Directory filters"><h3>Refine results</h3>{filterContent('desktop')}</aside>
        <div className="directory-results">
          <div className="results-heading">
            <h2 aria-label={`${hasSearchResults ? 'Search results' : config.title} (${results.length})`}><b>{results.length}</b> {hasSearchResults ? 'matching entries' : 'entries'} <span>· {filter === 'all' ? 'All types' : sections[filter]?.tab ?? 'Unknown type'}</span></h2>
            <div className="directory-result-controls">
              <button className="mobile-filter-toggle" disabled={!controlsReady} onClick={() => setFiltersOpen(true)}><SlidersHorizontal size={15}/>Filters</button>
              <select disabled={!controlsReady} aria-label="Sort results" value={sort} onChange={event => update({ sort: event.target.value })}>
                <option value="relevance">Most relevant</option><option value="title">Name A–Z</option><option value="updated">Recently observed</option>
              </select>
            </div>
          </div>
          {activeFilters.length > 0 && <div className="directory-active-filters" aria-label="Active filters">{activeFilters.map((label, i) => <span className="badge" key={`${i}-${label}`}>{label}</span>)}<button className="text-button" disabled={!controlsReady} onClick={reset}>Clear all</button></div>}
          {searchState === 'loading' && query.trim() && <p className="directory-search-status" role="status">Loading search index… You can browse the directory while it loads.</p>}
          {searchState === 'failed' && <div className="notice" role="status">Search is unavailable. You can still browse the directory.<button disabled={!controlsReady} className="text-button" onClick={() => setRetry(value => value + 1)}>Retry search</button></div>}
          {!results.length && (searchState !== 'loading' || !query.trim()) && <div className="empty panel"><Search size={28}/><h3>No matching entries</h3><p>Try a different phrase or clear the filters.</p><button disabled={!controlsReady} onClick={reset}>Clear filters</button></div>}
          <div className="results-list">
            {results.slice((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE).map(entry => entry.kind === 'project' ? <ProjectRows key={entry.id} projects={[entry]} catalog={catalog}/> : entry.kind === 'resource' ? <CapabilityCard key={entry.id} resource={entry}/> : entry.kind === 'organization' ? <OrganizationCard key={entry.id} organization={entry} catalog={catalog}/> : <Link to={routeFor(entry)} className="panel simple-card" key={entry.id}><p className="eyebrow">{entry.kind === 'collection' ? 'Collection' : entry.kind === 'actor' ? 'GitHub profile' : 'GitHub source'}</p><h3>{entry.title}<ArrowUpRight size={17}/></h3><p>{entry.description ?? 'Description not supplied.'}</p></Link>)}
          </div>
          {pages > 1 && <nav className="pagination" aria-label="Results pages"><button disabled={!controlsReady || pageNumber === 1} onClick={() => update({ page: String(pageNumber - 1) }, true)}>Previous</button><span>Page {pageNumber} of {pages}</span><button disabled={!controlsReady || pageNumber === pages} onClick={() => update({ page: String(pageNumber + 1) }, true)}>Next</button></nav>}
          <p className="directory-observation">Catalog observed {displayDate(data.generated_at)}. Research stays at its original source.</p>
        </div>
      </div>
    </main>
    {filtersOpen && <dialog ref={filterDialog} className="directory-filter-dialog" aria-labelledby="directory-filter-title" aria-describedby="directory-filter-description" onClose={() => setFiltersOpen(false)} onClick={event => { if (event.target === event.currentTarget) closeFilters(); }} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="directory-filter-dialog-content">
        <div className="directory-filter-dialog-heading"><h2 id="directory-filter-title">Refine results</h2><button className="icon-button" aria-label="Close filters" onClick={closeFilters} autoFocus><X size={19}/></button></div>
        <p id="directory-filter-description">Narrow the directory by research area, organization, collection, or source conditions.</p>
        <div className="directory-filters mobile-filters">{filterContent('mobile')}</div>
        <button className="primary directory-show-results" onClick={closeFilters}>Show {results.length} entries</button>
      </div>
    </dialog>}
  </>;
}
