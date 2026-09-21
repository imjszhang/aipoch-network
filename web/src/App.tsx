import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { allEntries, displayDate, routeFor, tombstoneRoutesFor, type SiteData } from './model.js';
import { directoryPageCount, parseDirectoryPath } from './directory-routes.js';
import { applySeoToDocument, seoForPath } from './seo.js';
import { OFFICIAL_ORIGIN } from './site-url.js';
import { Link, NavigationProvider, useNavigation } from './navigation.js';
import { loadCatalog } from './catalog-loader.js';
import { loadBrowseData, BrowserDataError } from './browser-data-loader.js';
import { ArrowLink } from './catalog-components.js';
import { ObservationClock } from './catalog-observations.js';
import { PublicHome } from './pages/PublicHome.js';
import { Directory } from './pages/Directory.js';
import { Detail } from './pages/Detail.js';
import { Community, Contribute } from './pages/Community.js';
import { Submit } from './pages/Submit.js';
import { WorkbenchProvider, WorkbenchControl, ResearchHome, JoinPage, LegacyLibraryPage, ReviewPage, useWorkbench } from './workbench/index.js';
const REPO = 'https://github.com/imjszhang/aipoch-network';
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
function useInteractive() { const [ready, setReady] = useState(false); useEffect(() => setReady(true), []); return ready; }
function Logo() { return <span className="logo"><svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="none" stroke="currentColor" opacity=".4"/><circle cx="16" cy="16" r="2" fill="currentColor"/><path d="M6 8 25 23M8 26 22 5M2 17 29 12" stroke="currentColor" opacity=".5"/></svg><strong>AIPOCH</strong><span className="mono">Network</span></span>; }
function Header({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const controlsReady = useInteractive();
  const directory = parseDirectoryPath(path.split('?')[0] ?? '');
  const activePath = directory ? `/${directory.section}/` : path;
  const items = [['Explore', '/explore/'], ['Projects', '/projects/'], ['Capabilities', '/capabilities/'], ['Organizations', '/organizations/'], ['Community', '/community/']];
  return <header><div className="header-inner"><Link to="/" aria-label="AIPOCH Network home"><Logo/></Link><nav aria-label="Main navigation" className={open ? 'nav open' : 'nav'}>{items.map(([label, to]) => <Link key={to} to={to} aria-current={activePath.startsWith(to) ? 'page' : undefined}>{label}</Link>)}</nav><WorkbenchControl/><button disabled={!controlsReady} className="icon-button mobile-menu" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X/> : <Menu/>}</button></div></header>;
}
function Pages({ data, browseState, browseVerifiedScope, browseError, retryBrowse, onDataUnavailable }: { data: SiteData; browseState: 'loading' | 'ready' | 'failed'; browseVerifiedScope: string; browseError: string; retryBrowse(): void; onDataUnavailable(error: BrowserDataError): void }) {
  const { path, base, href } = useNavigation();
  const { connected } = useWorkbench();
  const route = path.replace(/\?.*$/,'').replace(/\/$/,'') || '/';
  const directory = parseDirectoryPath(path.split('?')[0] ?? '');
  const directoryState = browseState === 'ready' && browseVerifiedScope !== directory?.section ? 'loading' : browseState;
  const listKind: Record<string,string> = { '/explore':'all', '/projects':'project', '/capabilities':'resource', '/organizations':'organization', '/collections':'collection', '/sources':'source_repository', '/researchers':'actor' };
  const entry = allEntries(data.catalog).find(entry => routeFor(entry).replace(/\/$/,'') === route);
  const tombstone = data.catalog.tombstones.find(row => tombstoneRoutesFor(row).some(path => path.replace(/\/$/,'') === route));
  const replacement = tombstone?.replacement_id ? allEntries(data.catalog).find(row => row.id === tombstone.replacement_id) : undefined;
  const pathPageMissing = Boolean(directory?.page && directory.page > directoryPageCount(data, directory.kind));
  useEffect(() => {
    const labels: Record<string,string> = { '/':'Science Open to All', '/explore':'Explore', '/projects':'Research projects', '/capabilities':'Reusable capabilities', '/organizations':'Organizations', '/researchers':'Researchers', '/collections':'Collections', '/sources':'Sources', '/community':'Community', '/submit':'Share research', '/contribute':'Contribute', '/join':'Join with Open-Science', '/me':'Saved research', '/review':'Connection scenarios' };
    const directoryTitle = directory ? `${labels[`/${directory.section}`] ?? 'Explore'}${directory.page && directory.page > 1 ? `, page ${directory.page}` : ''}` : undefined;
    document.title = `${entry?.title ?? (route === '/' && connected ? 'Your research home' : directoryTitle ?? labels[route] ?? (tombstone ? 'Catalog record withdrawn' : 'Entry not found'))} | AIPOCH Network`;
    const config = { origin: OFFICIAL_ORIGIN, base, indexing: import.meta.env.VITE_SITE_INDEXING ?? (base === '/') };
    applySeoToDocument(document, seoForPath(path, data, config), route === '/');
  }, [route, entry?.title, connected, tombstone, path, data, base, directory]);
  let content;
  if (route === '/') content = <>{connected ? <ResearchHome data={data}/> : <PublicHome data={data}/>}</>;
  else if (directory && !pathPageMissing) content = <Directory key={directory.section} data={data} kind={directory.kind} base={base} browseState={directoryState} browseError={browseError} retryBrowse={retryBrowse} onDataUnavailable={onDataUnavailable}/>;
  else if (listKind[route]) content = <Directory key={route} data={data} kind={listKind[route]} base={base} browseState={directoryState} browseError={browseError} retryBrowse={retryBrowse} onDataUnavailable={onDataUnavailable}/>;
  else if (entry) content = <Detail key={entry.id} entry={entry} data={data}/>;
  else if (route === '/community') content = <Community data={data}/>;
  else if (route === '/submit') {
    const params = new URLSearchParams(path.split('?')[1] ?? '');
    content = <Submit key={`${route}:${params.get('intent') ?? ''}:${params.get('entry') ?? ''}`} data={data}/>;
  }
  else if (route === '/contribute') content = <Contribute/>;
  else if (route === '/join') content = <JoinPage/>;
  else if (route === '/me') content = <LegacyLibraryPage/>;
  else if (route === '/review') content = <ReviewPage/>;
  else if (tombstone) content = <main className="wrap error-page"><p className="eyebrow">Catalog record · {tombstone.id}</p><h1>{tombstone.status === 'superseded' ? 'Entry superseded' : 'Entry withdrawn'}</h1><p>This record is no longer available in the catalog. Updated {displayDate(tombstone.withdrawn_at)}.</p>{tombstone.replacement_id && <p>Replacement: {replacement ? <Link to={routeFor(replacement)}>{replacement.title} ({replacement.id})</Link> : tombstone.replacement_id}</p>}<ArrowLink to="/explore/">Explore available research</ArrowLink></main>;
  else content = <main className="wrap error-page"><p className="eyebrow">404 / AIPOCH Network</p><h1>Entry not found</h1><p>This page may have moved or been withdrawn. Explore the current catalog to find available research.</p><ArrowLink to="/explore/" primary>Explore the network</ArrowLink></main>;
  return <><a className="skip-link" href="#content">Skip to content</a><Header path={path}/><div id="content" data-catalog-kind={data.data_kind} tabIndex={-1}>{content}</div><footer><div className="wide"><Link to="/"><Logo/></Link><p className="mono">Open research, connected by people and organizations.</p><div className="footer-links"><Link to="/contribute/">Contribute</Link><a href={href('/catalog/v1/manifest.json')}>Catalog data</a><a href={REPO}>GitHub <ArrowUpRight size={13}/></a><a href={href('/assets/open-science-product-notice.txt')}>Artwork notice</a></div><p className="footer-note">Catalog observed {displayDate(data.generated_at)} · Sources retain their own terms.</p></div></footer></>;
}

export function App({ data: initialData, path, base = '/' }: { data: SiteData; path: string; base?: string }) {
  // Display projections never reach WorkbenchProvider. Only full data or the
  // original complete page subgraph may resolve an exact research reference.
  const initiallyFull = initialData.data_kind === 'full' || (!initialData.data_kind && !initialData.totals);
  const [fullData, setFullData] = useState<SiteData | undefined>(initiallyFull ? initialData : undefined);
  const [browseData, setBrowseData] = useState<SiteData>();
  const [browseState, setBrowseState] = useState<'loading' | 'ready' | 'failed'>(initiallyFull ? 'ready' : 'loading');
  const [browseVerifiedScope, setBrowseVerifiedScope] = useState(initiallyFull ? parseDirectoryPath(path.split('?')[0] ?? '')?.section ?? '' : '');
  const [browseError, setBrowseError] = useState('');
  const [browseRetry, setBrowseRetry] = useState(0);
  const [error, setError] = useState('');
  const [preparingNavigation, setPreparingNavigation] = useState(false);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const retired = useRef(false);
  const full = useRef(initiallyFull);
  const pending = useRef<Promise<void> | undefined>(undefined);
  const pendingController = useRef<AbortController | undefined>(undefined);
  const preserveWorkbenchNavigation = useRef(false);
  const setWorkbenchNavigationContext = useCallback((active: boolean) => { preserveWorkbenchNavigation.current = active; }, []);
  useEffect(() => () => pendingController.current?.abort(), []);
  const browseLoading = useCallback(() => { if (!retired.current) { setBrowseState('loading'); setBrowseVerifiedScope(''); setBrowseError(''); } }, []);
  const browseReady = useCallback((next: SiteData, scope: string) => {
    if (retired.current) return;
    setBrowseData(next); setBrowseVerifiedScope(scope); setBrowseState('ready'); setBrowseError('');
  }, []);
  const browseFailed = useCallback((cause: unknown) => {
    if (cause instanceof BrowserDataError && cause.code === 'retired') {
      retired.current = true; setCatalogUnavailable(true); pendingController.current?.abort();
    } else if (retired.current) return;
    setBrowseState('failed'); setBrowseError(cause instanceof BrowserDataError ? cause.message : 'Discovery data could not be loaded.');
  }, []);
  const prepare = useCallback(async () => {
    if (retired.current) throw new BrowserDataError('retired', 'This page snapshot is no longer available. Refresh the page before reviewing a research reference.');
    if (full.current) return;
    if (pending.current) return pending.current;
    const controller = new AbortController();
    pendingController.current = controller;
    pending.current = loadCatalog(base, initialData.snapshot_id, fetch, { signal: controller.signal }).then(next => {
      if (controller.signal.aborted) return;
      full.current = true; setFullData({ ...next, data_kind: 'full', ui_manifest: initialData.ui_manifest }); setError('');
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) throw cause;
      setError(cause instanceof Error ? cause.message : 'The complete catalog could not be loaded.');
      throw cause;
    }).finally(() => { pending.current = undefined; pendingController.current = undefined; });
    return pending.current;
  }, [base, initialData.snapshot_id, initialData.ui_manifest]);
  const prepareNavigation = useCallback(async (): Promise<'ready' | 'native' | 'blocked'> => {
    if (!preserveWorkbenchNavigation.current || retired.current) return 'native';
    setPreparingNavigation(true);
    try { await prepare(); return full.current && !retired.current ? 'ready' : 'blocked'; }
    catch { return 'blocked'; } // The existing catalog retry notice explains the failure.
    finally { setPreparingNavigation(false); }
  }, [prepare]);
  const canNavigate = useCallback((to: string) => {
    if (browseState === 'failed') return false;
    if (full.current) return true;
    const current = parseDirectoryPath(path.split('?')[0] ?? '');
    const target = parseDirectoryPath(to.split('?')[0] ?? '');
    return Boolean(browseData && current && target);
  }, [path, browseData, browseState]);
  const displayData = fullData ?? browseData ?? initialData;
  return <ObservationClock generatedAt={initialData.generated_at}><NavigationProvider initialPath={path} base={base} canNavigate={canNavigate} prepareNavigation={prepareNavigation}>
    <LoadDirectoryData initialData={initialData} initiallyFull={initiallyFull} retry={browseRetry} onLoading={browseLoading} onReady={browseReady} onFailed={browseFailed}/>
    <WorkbenchProvider data={fullData ?? initialData} catalogReady={Boolean(fullData)} catalogUnavailable={catalogUnavailable}>
      <LoadWorkbenchCatalog prepare={prepare} onNavigationContextChange={setWorkbenchNavigationContext}/>
      {preparingNavigation && <div className="wrap catalog-retry"><p className="notice" role="status">Loading catalog data to keep your current workbench session. The current page remains available.</p></div>}
      {error && <div className="wrap catalog-retry"><p className="notice" role="status">{error} <button onClick={() => void prepare().catch(() => {})}>Retry catalog</button> <button onClick={() => location.reload()}>Refresh page</button></p></div>}
      <Pages data={displayData} browseState={browseState} browseVerifiedScope={browseVerifiedScope} browseError={browseError} retryBrowse={() => setBrowseRetry(value => value + 1)} onDataUnavailable={browseFailed}/>
    </WorkbenchProvider>
  </NavigationProvider></ObservationClock>;
}

function LoadDirectoryData({ initialData, initiallyFull, retry, onLoading, onReady, onFailed }: {
  initialData: SiteData; initiallyFull: boolean; retry: number; onLoading(): void;
  onReady(data: SiteData, scope: string): void; onFailed(error: unknown): void;
}) {
  const { path, base } = useNavigation();
  const scope = parseDirectoryPath(path.split('?')[0] ?? '/')?.section ?? '';
  useEffect(() => {
    if (!scope) { onLoading(); return; }
    // A section visit is one browsing session. Canonical/browse URLs, pagination,
    // and query edits share its check; entering another section or re-entering
    // a directory checks retirement before exposing cached controls again.
    const reference = initialData.ui_manifest;
    if (!reference && initiallyFull) { onReady(initialData, scope); return; }
    const controller = new AbortController();
    onLoading();
    if (!reference) { onFailed(new BrowserDataError('invalid_data', 'This page has no discovery data reference. Refresh to load the current page.')); return; }
    loadBrowseData(base, reference, { signal: controller.signal }).then(next => {
      if (!controller.signal.aborted) onReady({ ...next, ui_manifest: reference }, scope);
    }).catch((cause: unknown) => { if (!controller.signal.aborted) onFailed(cause); });
    return () => controller.abort();
  }, [base, scope, initialData, initiallyFull, retry, onLoading, onReady, onFailed]);
  return null;
}

function LoadWorkbenchCatalog({ prepare, onNavigationContextChange }: { prepare(): Promise<void>; onNavigationContextChange(active: boolean): void }) {
  const { connected, review, state } = useWorkbench();
  const { path } = useNavigation();
  const correction = path.startsWith('/submit/') && new URLSearchParams(path.split('?')[1] ?? '').get('intent') === 'correction';
  const keepSession = review || connected || ['connecting', 'restoring'].includes(state.connection) || Boolean(state.selected);
  // Register before links become clickable after the connection/review commit.
  useBrowserLayoutEffect(() => {
    onNavigationContextChange(keepSession);
    return () => onNavigationContextChange(false);
  }, [keepSession, onNavigationContextChange]);
  useEffect(() => {
    if (connected || review || state.selected || correction) void prepare().catch(() => {});
  }, [connected, review, state.selected, correction, prepare]);
  return null;
}
