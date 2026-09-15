import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Search, SlidersHorizontal, X } from 'lucide-react';
import MiniSearch from 'minisearch';
import { searchOptions, type SearchDocument } from '../search.js';
import { allEntries, displayDate, relatedEntriesFor, routeFor, type Entry, type SiteData } from '../model.js';
import { Link, useNavigation } from '../navigation.js';
import { ArrowLink, PageHeader, ProjectRows, CapabilityCard, OrganizationCard } from '../catalog-components.js';
import { EntryFacts, useObservationTime } from '../catalog-observations.js';
import { changeDiscovery, compareDiscovery, discoveryKeys, isAccountKind, isRepositoryKind, matchesDiscovery, parseDiscovery, presetDates, sorts } from '../discovery.js';
import { DIRECTORY_LABELS, PAGE_SIZE, directoryHref, parseDirectoryPath, sectionForKind } from '../directory-routes.js';

const sections: Record<string, { title: string; description: string; tab: string }> = {
  all: { title: DIRECTORY_LABELS.all.heading, description: DIRECTORY_LABELS.all.description, tab: 'All' },
  project: { title: DIRECTORY_LABELS.project.heading, description: DIRECTORY_LABELS.project.description, tab: 'Projects' },
  resource: { title: DIRECTORY_LABELS.resource.heading, description: DIRECTORY_LABELS.resource.description, tab: 'Capabilities' },
  organization: { title: DIRECTORY_LABELS.organization.heading, description: DIRECTORY_LABELS.organization.description, tab: 'Organizations' },
  actor: { title: DIRECTORY_LABELS.actor.heading, description: DIRECTORY_LABELS.actor.description, tab: 'Researchers' },
  collection: { title: DIRECTORY_LABELS.collection.heading, description: DIRECTORY_LABELS.collection.description, tab: 'Collections' },
  source_repository: { title: DIRECTORY_LABELS.source_repository.heading, description: DIRECTORY_LABELS.source_repository.description, tab: 'Source repositories' },
};
const accessOptions: Record<string, string> = {
  pinned: 'Pinned source version',
  unpinned: 'Unpinned source reference',
  unknown: 'License unknown',
  stale: 'Stale source observation',
};
const filterLabels: Record<string,string> = { added_after:'Added from', added_before:'Added through', added_date:'Added date', updated_after:'Catalog updated from', updated_before:'Catalog updated through', updated_date:'Catalog update date', source_after:'Source commit from', source_before:'Source commit through', source_date:'Source commit date', min_stars:'Minimum stars', min_forks:'Minimum forks', min_followers:'Minimum followers', observation:'Observation', include_stale_metrics:'Allow stale metrics' };
type FilterChanges = Record<string, string>;

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
  const referenceTime = useObservationTime();
  const discovery = useMemo(() => parseDiscovery(params, kind, new Date(referenceTime).toISOString()), [params, kind, referenceTime]);
  const sort = discovery.sort;
  const [filterNotice, setFilterNotice] = useState('');
  const repositoryControls = filter === 'all' || isRepositoryKind(filter);
  const accountControls = filter === 'all' || isAccountKind(filter);
  const entries = useMemo(() => allEntries(catalog), [catalog]);
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
    const changed = changeDiscovery(params, next, kind);
    setFilterNotice(changed.notice);
    void navigate(directoryHref(sectionForKind(kind), Number(changed.params.get('page') ?? 1), changed.params), { replace: !push, preserveScroll: true });
  }
  const reset = () => { setFilterNotice('All filters were cleared.'); void navigate(`/${sectionForKind(kind)}/`, { replace: true, preserveScroll: true }); };
  const repair = () => update(Object.fromEntries(discovery.invalidKeys.map(key => [key, ''])));
  const matches = useMemo(() => query.trim() && index ? new Map(index.search(query).map((row, position) => [String(row.id), position])) : undefined, [query, index]);
  const results = useMemo(() => {
    const filtered = entries.filter(entry =>
      (!organizationMembers || organizationMembers.has(entry.id)) &&
      (!collectionMembers || collectionMembers.has(entry.id)) &&
      (filter === 'all' || entry.kind === filter) &&
      (!domain || ('domains' in entry && entry.domains.includes(domain))) &&
      matchesDiscovery(entry, catalog, discovery) &&
      (!query.trim() || searchState !== 'ready' || matches?.has(entry.id)),
    );
    return filtered.sort((a, b) => compareDiscovery(a,b,catalog,discovery,searchState === 'ready' ? matches : undefined));
  }, [entries, organizationMembers, collectionMembers, filter, domain, access, query, searchState, matches, catalog, discovery]);
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const directoryRoute = parseDirectoryPath(path.split('?')[0] ?? '');
  const section = directoryRoute?.section ?? sectionForKind(kind);
  const requestedPage = directoryRoute?.page ?? Number(params.get('page') ?? '1');
  const pageNumber = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const pageHref = (page: number) => directoryHref(section, page, params);
  // Render the clamped page immediately, then repair shared URLs without a navigation/focus reset.
  useEffect(() => {
    if (discovery.errors.length || !controlsReady || (query.trim() && searchState === 'loading')) return;
    const target = pageHref(pageNumber);
    const current = `${path.split('?')[0]}${params.size ? `?${params}` : ''}`;
    const same = (left: string, right: string) => {
      const a = new URL(left, 'https://aipoch.invalid'), b = new URL(right, 'https://aipoch.invalid');
      if (a.pathname !== b.pathname) return false;
      const keys = new Set([...a.searchParams.keys(), ...b.searchParams.keys()]);
      return [...keys].every(key => a.searchParams.get(key) === b.searchParams.get(key));
    };
    if (same(current, target)) return;
    if (!directoryRoute?.page && !params.has('page') && pageNumber === 1) return;
    void navigate(target, { replace: true, preserveScroll: true });
  }, [controlsReady, query, searchState, params, pageNumber, path, navigate, discovery.errors.length, directoryRoute?.page, section]);

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
  const dateControls = (prefix: string, field: 'added' | 'updated' | 'source', label: string, options: number[]) => <>
    <label htmlFor={`${prefix}-${field}`}>{label}</label>
    <select id={`${prefix}-${field}`} disabled={!controlsReady} value={params.get(`${field}_date`) === 'unknown' ? 'unknown' : params.has(`${field}_after`) || params.has(`${field}_before`) ? 'custom' : ''} onChange={event => {
      const value = event.target.value;
      update(value === 'unknown' ? { [`${field}_date`]: 'unknown', [`${field}_after`]: '', [`${field}_before`]: '' } : value === '' ? { [`${field}_date`]: '', [`${field}_after`]: '', [`${field}_before`]: '' } : presetDates(field,value === 'custom' ? 30 : Number(value),referenceTime));
    }}><option value="">Any date</option>{options.map(days => <option value={days} key={days}>Last {days} days</option>)}<option value="custom">Custom UTC dates</option><option value="unknown">{field === 'source' ? 'Unknown date' : 'Unknown or bounded date'}</option></select>
    {(params.has(`${field}_after`) || params.has(`${field}_before`)) && <div className="directory-date-range"><label htmlFor={`${prefix}-${field}-after`}>{label}: from (UTC)</label><input id={`${prefix}-${field}-after`} disabled={!controlsReady} type="date" value={params.get(`${field}_after`) ?? ''} onChange={event => update({ [`${field}_after`]: event.target.value })}/><label htmlFor={`${prefix}-${field}-before`}>{label}: through (UTC)</label><input id={`${prefix}-${field}-before`} disabled={!controlsReady} type="date" value={params.get(`${field}_before`) ?? ''} onChange={event => update({ [`${field}_before`]: event.target.value })}/></div>}
  </>;
  const minimumControl = (prefix: string, key: string, label: string) => <><label htmlFor={`${prefix}-${key}`}>{label}</label><input id={`${prefix}-${key}`} disabled={!controlsReady} inputMode="numeric" type="text" placeholder="Any count" value={params.get(key) ?? ''} aria-invalid={discovery.invalidKeys.includes(key)} onChange={event => update({ [key]: event.target.value })}/></>;
  const filterContent = (prefix: string) => <>
    {(filter === 'all' || filter === 'project' || filter === 'resource') && <><label htmlFor={`${prefix}-domain`}>Research area</label>
    <select id={`${prefix}-domain`} disabled={!controlsReady} value={domain} onChange={event => update({ domain: event.target.value })}>
      <option value="">All areas</option>
      {domains.map(value => <option key={value}>{value}</option>)}
      {domain && !domains.includes(domain) && <option value={domain}>{domain} (unknown)</option>}
    </select>
    </>}{(filter === 'all' || filter === 'project' || filter === 'resource') && <><label htmlFor={`${prefix}-organization`}>Organization</label>
    <select id={`${prefix}-organization`} disabled={!controlsReady} value={organizationId} onChange={event => update({ organization: event.target.value })}>
      <option value="">All organizations</option>
      {catalog.organizations.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
      {organizationId && !organization && <option value={organizationId}>Unknown organization</option>}
    </select>
    </>}<label htmlFor={`${prefix}-collection`}>Collection</label>
    <select id={`${prefix}-collection`} disabled={!controlsReady} value={collectionId} onChange={event => update({ collection: event.target.value })}>
      <option value="">All collections</option>
      {catalog.collections.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
      {collectionId && !collection && <option value={collectionId}>Unknown collection</option>}
    </select>
    {repositoryControls && <><label htmlFor={`${prefix}-access`}>Version &amp; conditions</label>
    <select id={`${prefix}-access`} disabled={!controlsReady} value={access} onChange={event => update({ access: event.target.value })}>
      <option value="">Any status</option>
      {Object.entries(accessOptions).filter(([value]) => filter !== 'source_repository' || !['pinned','unpinned'].includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      {access && !accessOptions[access] && <option value={access}>Unknown status</option>}
    </select>
    </>}
    <details className="directory-refinement-group"><summary>Catalog dates</summary>{dateControls(prefix,'added','Added to AIPOCH',[7,30,90])}{dateControls(prefix,'updated','Catalog updated',[7,30,90])}<p className="filter-note">Exact dates only match date ranges. Historical bounds appear as “Listed by” or “Change observed by”.</p></details>
    {(repositoryControls || accountControls) && <details className="directory-refinement-group"><summary>GitHub metrics &amp; activity</summary>
      {repositoryControls && <>{minimumControl(prefix,'min_stars','Minimum GitHub stars')}{minimumControl(prefix,'min_forks','Minimum GitHub forks')}{dateControls(prefix,'source','Latest source commit',[30,90,365])}</>}
      {accountControls && minimumControl(prefix,'min_followers','Minimum GitHub followers')}
      <label htmlFor={`${prefix}-observation`}>Observation status</label><select id={`${prefix}-observation`} disabled={!controlsReady} value={params.get('observation') ?? ''} onChange={event => update({ observation: event.target.value })}><option value="">Any observation</option><option value="fresh">Fresh (within 48 hours)</option><option value="stale">Stale (48 hours to 7 days)</option><option value="missing">Missing or older than 7 days</option></select>
      <label className="directory-checkbox" htmlFor={`${prefix}-include-stale`}><input id={`${prefix}-include-stale`} type="checkbox" disabled={!controlsReady} checked={discovery.includeStale} onChange={event => update({ include_stale_metrics: event.target.checked ? '1' : '' })}/>Allow stale metric values</label>
      <p className="filter-note">Publicly reported GitHub counts. Stale values rank or meet numeric thresholds only when allowed, for up to 7 days. GitHub metric and activity criteria must match one primary or implementation source.</p>
    </details>}
    <button className="directory-reset" disabled={!controlsReady} onClick={reset}>Reset filters</button>
    <p className="filter-note">Inclusion in the directory is separate from maintainer acknowledgement and scientific validation.</p>
  </>;
  const discoveryFeedback = () => <>
    {filterNotice && <p className="directory-filter-feedback" role="status">{filterNotice}</p>}
    {discovery.scope !== 'all' && <p className="directory-scope" role="status">{discovery.scope === 'repository' ? 'Repository criteria: Projects, Capabilities and Sources. Each result uses one matching source.' : 'Account criteria: Researchers and Organizations. Counts belong to the GitHub profile.'}</p>}
    {discovery.errors.length > 0 && <div className="notice directory-filter-errors" role="alert"><b>Check this filter link</b><ul>{discovery.errors.map((error,index) => <li key={index}>{error}</li>)}</ul><button disabled={!controlsReady} className="text-button" onClick={repair}>Clear incompatible filters</button></div>}
  </>;
  const activeFilters = [domain, organizationId && (organization?.title ?? 'Unknown organization'), collectionId && (collection?.title ?? 'Unknown collection'), access && (accessOptions[access] ?? 'Unknown status'), ...discoveryKeys.filter(key => key !== 'sort' && params.has(key)).map(key => `${filterLabels[key]}: ${key === 'include_stale_metrics' ? 'yes' : params.get(key)}`)].filter(Boolean);
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
          {discoveryFeedback()}
          <div className="results-heading">
            <h2 aria-label={`${hasSearchResults ? 'Search results' : config.title} (${results.length})`}><b>{results.length}</b> {hasSearchResults ? 'matching entries' : 'entries'} <span>· {filter === 'all' ? 'All types' : sections[filter]?.tab ?? 'Unknown type'}</span></h2>
            <div className="directory-result-controls">
              <button className="mobile-filter-toggle" disabled={!controlsReady} onClick={() => setFiltersOpen(true)}><SlidersHorizontal size={15}/>Filters</button>
              <select disabled={!controlsReady} aria-label="Sort results" value={sort} onChange={event => update({ sort: event.target.value })}>
                {Object.entries(sorts).filter(([value]) => value === sort || (!['stars','source_activity'].includes(value) || repositoryControls) && (value !== 'followers' || accountControls) && value !== 'updated').map(([value,label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>
          {activeFilters.length > 0 && <div className="directory-active-filters" aria-label="Active filters">{activeFilters.map((label, i) => <span className="badge" key={`${i}-${label}`}>{label}</span>)}<button className="text-button" disabled={!controlsReady} onClick={reset}>Clear all</button></div>}
          {searchState === 'loading' && query.trim() && <p className="directory-search-status" role="status">Loading search index… You can browse the directory while it loads.</p>}
          {searchState === 'failed' && <div className="notice" role="status">Search is unavailable. You can still browse the directory.<button disabled={!controlsReady} className="text-button" onClick={() => setRetry(value => value + 1)}>Retry search</button></div>}
          {!discovery.errors.length && !results.length && (searchState !== 'loading' || !query.trim()) && <div className="empty panel"><Search size={28}/><h3>No matching entries</h3><p>Try a different phrase or clear the filters.</p><button disabled={!controlsReady} onClick={reset}>Clear filters</button></div>}
          <div className="results-list">
            {results.slice((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE).map(entry => entry.kind === 'project' ? <ProjectRows key={entry.id} projects={[entry]} catalog={catalog} filters={discovery}/> : entry.kind === 'resource' ? <CapabilityCard key={entry.id} resource={entry} catalog={catalog} filters={discovery}/> : entry.kind === 'organization' ? <OrganizationCard key={entry.id} organization={entry} catalog={catalog} filters={discovery}/> : <Link to={routeFor(entry)} className="panel simple-card" key={entry.id}><p className="eyebrow">{entry.kind === 'collection' ? 'Collection' : entry.kind === 'actor' ? 'GitHub profile' : 'GitHub source'}</p><h3>{entry.title}<ArrowUpRight size={17}/></h3><p>{entry.description ?? 'Description not supplied.'}</p><EntryFacts entry={entry} catalog={catalog} filters={discovery}/></Link>)}
          </div>
          {pages > 1 && <nav className="pagination" aria-label="Results pages">{pageNumber === 1 ? <button disabled>Previous</button> : <Link className="button" to={pageHref(pageNumber - 1)}>Previous</Link>}<span>Page {pageNumber} of {pages}</span>{pageNumber === pages ? <button disabled>Next</button> : <Link className="button" to={pageHref(pageNumber + 1)}>Next</Link>}</nav>}
          <p className="directory-observation">Catalog snapshot {displayDate(data.generated_at)}. Date ranges use UTC. Filters use the captured page time; results can change with a new catalog snapshot. Research stays at its original source.</p>
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
        <p id="directory-filter-description">Narrow the directory by research area, catalog dates, GitHub metrics, or source conditions.</p>
        {discoveryFeedback()}
        <div className="directory-filters mobile-filters">{filterContent('mobile')}</div>
        <button className="primary directory-show-results" onClick={closeFilters}>Show {results.length} entries</button>
      </div>
    </dialog>}
  </>;
}
