import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { allEntries, displayDate, routeFor, tombstoneRoutesFor, type SiteData } from './model.js';
import { Link, NavigationProvider, useNavigation } from './navigation.js';
import { loadCatalog } from './catalog-loader.js';
import { ArrowLink } from './catalog-components.js';
import { PublicHome } from './pages/PublicHome.js';
import { Directory } from './pages/Directory.js';
import { Detail } from './pages/Detail.js';
import { Community, Contribute } from './pages/Community.js';
import { Submit } from './pages/Submit.js';
import { WorkbenchProvider, WorkbenchControl, ResearchHome, JoinPage, LegacyLibraryPage, ReviewPage, useWorkbench } from './workbench/index.js';
const REPO = 'https://github.com/imjszhang/aipoch-network';
function useInteractive() { const [ready, setReady] = useState(false); useEffect(() => setReady(true), []); return ready; }
function Logo() { return <span className="logo"><svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="none" stroke="currentColor" opacity=".4"/><circle cx="16" cy="16" r="2" fill="currentColor"/><path d="M6 8 25 23M8 26 22 5M2 17 29 12" stroke="currentColor" opacity=".5"/></svg><strong>AIPOCH</strong><span className="mono">Network</span></span>; }
function Header({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const controlsReady = useInteractive();
  const items = [['Explore', '/explore/'], ['Projects', '/projects/'], ['Capabilities', '/capabilities/'], ['Organizations', '/organizations/'], ['Community', '/community/']];
  return <header><div className="header-inner"><Link to="/" aria-label="AIPOCH Network home"><Logo/></Link><nav aria-label="Main navigation" className={open ? 'nav open' : 'nav'}>{items.map(([label, to]) => <Link key={to} to={to} aria-current={path.startsWith(to) ? 'page' : undefined}>{label}</Link>)}</nav><WorkbenchControl/><button disabled={!controlsReady} className="icon-button mobile-menu" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X/> : <Menu/>}</button></div></header>;
}
function Pages({ data }: { data: SiteData }) {
  const { path, base, href } = useNavigation();
  const { connected } = useWorkbench();
  const route = path.replace(/\?.*$/,'').replace(/\/$/,'') || '/';
  const listKind: Record<string,string> = { '/explore':'all', '/projects':'project', '/capabilities':'resource', '/organizations':'organization', '/collections':'collection', '/sources':'source_repository', '/researchers':'actor' };
  const entry = allEntries(data.catalog).find(entry => routeFor(entry).replace(/\/$/,'') === route);
  const tombstone = data.catalog.tombstones.find(row => tombstoneRoutesFor(row).some(path => path.replace(/\/$/,'') === route));
  const replacement = tombstone?.replacement_id ? allEntries(data.catalog).find(row => row.id === tombstone.replacement_id) : undefined;
  useEffect(() => {
    const labels: Record<string,string> = { '/':'Science Open to All', '/explore':'Explore', '/projects':'Research projects', '/capabilities':'Reusable capabilities', '/organizations':'Organizations', '/researchers':'Researchers', '/collections':'Collections', '/sources':'Sources', '/community':'Community', '/submit':'Share research', '/contribute':'Contribute', '/join':'Join with Open-Science', '/me':'Saved research', '/review':'Connection scenarios' };
    document.title = `${entry?.title ?? (route === '/' && connected ? 'Your research home' : labels[route] ?? (tombstone ? 'Catalog record withdrawn' : 'Entry not found'))} | AIPOCH Network`;
  }, [route, entry?.title, connected, tombstone]);
  let content;
  if (route === '/') content = <>{connected ? <ResearchHome data={data}/> : <PublicHome data={data}/>}</>;
  else if (listKind[route]) content = <Directory key={route} data={data} kind={listKind[route]} base={base}/>;
  else if (entry) content = <Detail key={entry.id} entry={entry} data={data}/>;
  else if (route === '/community') content = <Community data={data}/>;
  else if (route === '/submit') content = <Submit key={path} data={data}/>;
  else if (route === '/contribute') content = <Contribute/>;
  else if (route === '/join') content = <JoinPage/>;
  else if (route === '/me') content = <LegacyLibraryPage/>;
  else if (route === '/review') content = <ReviewPage/>;
  else if (tombstone) content = <main className="wrap error-page"><p className="eyebrow">Catalog record · {tombstone.id}</p><h1>{tombstone.status === 'superseded' ? 'Entry superseded' : 'Entry withdrawn'}</h1><p>This record is no longer available in the catalog. Updated {displayDate(tombstone.withdrawn_at)}.</p>{tombstone.replacement_id && <p>Replacement: {replacement ? <Link to={routeFor(replacement)}>{replacement.title} ({replacement.id})</Link> : tombstone.replacement_id}</p>}<ArrowLink to="/explore/">Explore available research</ArrowLink></main>;
  else content = <main className="wrap error-page"><p className="eyebrow">404 / AIPOCH Network</p><h1>Entry not found</h1><p>This page may have moved or been withdrawn. Explore the current catalog to find available research.</p><ArrowLink to="/explore/" primary>Explore the network</ArrowLink></main>;
  return <><a className="skip-link" href="#content">Skip to content</a><Header path={path}/><div id="content" tabIndex={-1}>{content}</div><footer><div className="wide"><Link to="/"><Logo/></Link><p className="mono">Open research, connected by people and organizations.</p><div className="footer-links"><Link to="/contribute/">Contribute</Link><a href={href('/catalog/v1/manifest.json')}>Catalog data</a><a href={REPO}>GitHub <ArrowUpRight size={13}/></a><a href={href('/assets/open-science-product-notice.txt')}>Artwork notice</a></div><p className="footer-note">Catalog observed {displayDate(data.generated_at)} · Sources retain their own terms.</p></div></footer></>;
}

export function App({ data: initialData, path, base = '/' }: { data: SiteData; path: string; base?: string }) {
  const [data, setData] = useState(initialData);
  const [catalogReady, setReady] = useState(!initialData.totals);
  const [error, setError] = useState('');
  const full = useRef(!initialData.totals);
  const pending = useRef<Promise<void> | undefined>(undefined);
  const prepare = useCallback(async () => {
    if (full.current) return;
    if (pending.current) return pending.current;
    pending.current = loadCatalog(base, initialData.snapshot_id).then(next => {
      full.current = true; setData(next); setReady(true); setError('');
    }).catch((error: unknown) => { setError(error instanceof Error && error.message.includes('snapshot changed') ? 'The catalog has changed since this page was built. Refresh this page to load one consistent version.' : 'The complete catalog could not be loaded. This page remains readable; retry to browse other entries and your library.'); throw new Error('Catalog unavailable'); })
      .finally(() => { pending.current = undefined; });
    return pending.current;
  }, [base, initialData.snapshot_id]);
  return <NavigationProvider initialPath={path} base={base} prepare={prepare}>
    <WorkbenchProvider data={data} catalogReady={catalogReady}>
      <LoadWorkbenchCatalog prepare={prepare}/>
      {error && <div className="wrap catalog-retry"><p className="notice" role="status">{error} <button onClick={() => void prepare().catch(() => {})}>Retry catalog</button> <button onClick={() => location.reload()}>Refresh page</button></p></div>}
      <Pages data={data}/>
    </WorkbenchProvider>
  </NavigationProvider>;
}

function LoadWorkbenchCatalog({ prepare }: { prepare(): Promise<void> }) {
  const { connected, state } = useWorkbench();
  useEffect(() => {
    if (connected || state.selected) void prepare().catch(() => {});
  }, [connected, state.selected, prepare]);
  return null;
}
