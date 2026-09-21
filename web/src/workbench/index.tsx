import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Bookmark, Check, FlaskConical, GitBranch, Laptop, Unplug, X } from 'lucide-react';
import { allEntries, routeFor, type Entry, type SiteData } from '../model.js';
import { Link, useNavigation } from '../navigation.js';
import { LibraryStore } from '../library/storage.js';
import { DemoAdapter, UnavailableAdapter, type DemoOutcome } from './adapter.js';
import { RealAdapter, REAL_REFERENCE_WAIT_MS } from './real-adapter.js';
import { WorkbenchEngine, type WorkbenchState } from './engine.js';
import type { ResearchReference } from './reference.js';
import { DEMO_MODE, WORKBENCH_MODE } from '../build-mode.js';
export { DEMO_MODE };

export const OPEN_SCIENCE_URL = 'https://aipoch.com/open-science';
export const connectionLabels = { disconnected: 'Not connected', connecting: 'Connecting', restoring: 'Restoring connection', waiting: 'Waiting for connection', paused: 'Connection paused', forgetting: 'Forgetting browser', connected: 'Connected', unconfirmed: 'Not confirmed', interrupted: 'Interrupted' };
type WorkbenchContextValue = {
  engine: WorkbenchEngine; state: WorkbenchState; data: SiteData; catalogReady: boolean;
  demo: boolean; review: boolean; connected: boolean;
  recordView(entry: Entry): void; enterReview(): void; exitReview(): void; resetReview(): void;
};
const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);
export function useWorkbench() { const value = useContext(WorkbenchContext); if (!value) throw new Error('WorkbenchProvider is required'); return value; }
const libraryKey = () => `aipoch-network.browser-library.v1.${DEMO_MODE ? 'demo' : 'public'}`;
const createEngine = (data: SiteData, catalogReady: boolean, review = false, catalogUnavailable = false) => {
  const engine = new WorkbenchEngine(data, catalogReady, DEMO_MODE ? new DemoAdapter() : WORKBENCH_MODE === 'real' ? new RealAdapter() : new UnavailableAdapter(), new LibraryStore(review ? 'aipoch-network.review.temporary' : libraryKey()), { connect: 8000, pairing: 180000, send: WORKBENCH_MODE === 'real' ? REAL_REFERENCE_WAIT_MS : 15000 });
  if (catalogUnavailable) engine.retireCatalog();
  return engine;
};

export function WorkbenchProvider({ data, catalogReady, catalogUnavailable = false, children }: { data: SiteData; catalogReady: boolean; catalogUnavailable?: boolean; children: ReactNode }) {
  const [ordinary] = useState(() => createEngine(data, catalogReady, false, catalogUnavailable));
  const [engine, setEngine] = useState(ordinary);
  const activeRef = useRef(engine); activeRef.current = engine;
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const review = engine !== ordinary;
  useEffect(() => {
    let library: LibraryStore;
    try { library = new LibraryStore(libraryKey(), window.localStorage); } catch { library = new LibraryStore(libraryKey(), { getItem() { throw new Error('Storage denied'); }, setItem() { throw new Error('Storage denied'); } }); }
    ordinary.hydrateLibrary(library);
    ordinary.startRestoration();
    const onStorage = (event: StorageEvent) => { if (event.key === libraryKey()) ordinary.storageEvent(event.newValue); };
    const check = () => { ordinary.checkSession(); if (activeRef.current !== ordinary) activeRef.current.checkSession(); };
    const onFocus = () => { ordinary.focusSession(); if (activeRef.current !== ordinary) activeRef.current.focusSession(); };
    window.addEventListener('storage', onStorage); window.addEventListener('focus', onFocus);
    const interval = setInterval(check, 1000);
    return () => { clearInterval(interval); window.removeEventListener('storage', onStorage); window.removeEventListener('focus', onFocus); ordinary.dispose(); if (activeRef.current !== ordinary) activeRef.current.dispose(); };
  }, [ordinary]);
  useEffect(() => {
    if (catalogUnavailable) { ordinary.retireCatalog(); if (engine !== ordinary) engine.retireCatalog(); }
    ordinary.updateData(data, catalogReady); if (engine !== ordinary) engine.updateData(data, catalogReady);
  }, [data, catalogReady, catalogUnavailable, ordinary, engine]);
  const enterReview = useCallback(() => { if (!DEMO_MODE || activeRef.current !== ordinary) return; ordinary.suspend(); setEngine(createEngine(data, catalogReady, true, catalogUnavailable)); }, [ordinary, data, catalogReady, catalogUnavailable]);
  const exitReview = useCallback(() => { if (activeRef.current === ordinary) return; activeRef.current.dispose(); ordinary.checkSession(); setEngine(ordinary); }, [ordinary]);
  const resetReview = useCallback(() => { if (activeRef.current === ordinary || !DEMO_MODE) return; activeRef.current.dispose(); setEngine(createEngine(data, catalogReady, true, catalogUnavailable)); }, [ordinary, data, catalogReady, catalogUnavailable]);
  const recordView = useCallback((entry: Entry) => engine.recordView(entry), [engine]);
  const value = { engine, state, data, catalogReady, connected: engine.isConnected(), demo: DEMO_MODE, review, recordView, enterReview, exitReview, resetReview };
  return <WorkbenchContext.Provider value={value}>
    <div className="wb-app-surface" inert={state.overlay !== null ? true : undefined}>{children}
    {state.storageWarning && <p role="status" className="wb-storage-warning">{state.storageWarning}</p>}
    {review && <ReviewControls />}</div>
    <span className="wb-sr-only" role="status" aria-live="polite" aria-atomic="true">Open-Science: {connectionLabels[state.connection]}. {state.reason} {state.notice}</span>
    <WorkbenchOverlay />
  </WorkbenchContext.Provider>;
}

function Button({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button type="button" className={`wb-button ${className}`} {...props}>{children}</button>; }
export function ConnectionStatus() {
  const { connected, demo, state } = useWorkbench();
  return <span className="wb-connection-inline"><i aria-hidden="true" className={`wb-dot ${connected ? 'is-connected' : ''}`} /><span>{connected ? 'Open-Science connected' : connectionLabels[state.connection]}</span>{demo && <small>Demo</small>}</span>;
}
export function WorkbenchControl() {
  const { engine, state, connected, demo } = useWorkbench();
  return <button type="button" className={`wb-trigger ${connected ? 'is-connected' : ''}`} aria-label={`Open-Science — ${connectionLabels[state.connection]}${demo ? ' · Demo' : ''}`} aria-haspopup="dialog" aria-expanded={state.overlay !== null} onClick={engine.openConnection}>
    <FlaskConical size={18} aria-hidden="true" /><span><strong>Open-Science</strong><small><i className={`wb-dot ${connected ? 'is-connected' : ''}`} aria-hidden="true" />{connectionLabels[state.connection]}{demo && ' · Demo'}</small></span>
  </button>;
}
export function EntryActions({ entry, compact = false }: { entry: Entry; compact?: boolean }) {
  const { engine, connected, state } = useWorkbench();
  const nav = useNavigation();
  const action = entry.kind === 'project' ? (connected ? 'Open in Open-Science' : 'Connect to open') : entry.kind === 'resource' ? (connected ? 'Use in Open-Science' : 'Connect to use') : null;
  const saved = state.library.saved.includes(entry.id);
  return <div className={`wb-entry-actions ${compact ? 'is-compact' : ''}`}>
    {action && <Button className={compact ? 'wb-text-action' : 'wb-primary'} aria-label={`${action}: ${entry.title}`} onClick={() => engine.select(entry, typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}${window.location.hash}` : nav.path)}>{compact ? (connected ? entry.kind === 'project' ? 'Open' : 'Use' : 'Connect') : action}<ArrowUpRight size={15} aria-hidden="true" /></Button>}
    {connected && <Button className={compact ? 'wb-text-action' : ''} aria-label={`${saved ? 'Unsave' : 'Save'} ${entry.title}`} aria-pressed={saved} onClick={() => engine.toggleSave(entry.id)}><Bookmark size={15} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />{saved ? 'Saved' : 'Save'}</Button>}
  </div>;
}

function Dialog({ title, compact = false, children, onClose }: { title: string; compact?: boolean; children: ReactNode; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const targets = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
      if (!targets.length) { event.preventDefault(); ref.current?.focus(); return; }
      const first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus({ preventScroll: true }); else document.querySelector<HTMLElement>('.wb-trigger')?.focus({ preventScroll: true }); };
  }, []);
  // Capture the opening control above before recovering focus after a pairing control disappears.
  useEffect(() => {
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus({ preventScroll: true });
  });
  return <div className={`wb-overlay ${compact ? 'wb-overlay-compact' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`wb-dialog ${compact ? 'wb-dialog-compact' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} ref={ref}>
      <div className="wb-dialog-heading"><h2 id={id}>{title}</h2><Button className="wb-icon-button" aria-label="Close Open-Science panel" onClick={onClose}><X size={20} aria-hidden="true" /></Button></div>
      {children}
    </div>
  </div>;
}
function ConnectionHelp() {
  return <details className="wb-connection-help"><summary>Can’t find the confirmation page?</summary>
    <p>Start a new chat in Open-Science if AIPOCH Connector was just set up; an older chat may not have its tools. Ask it to open the matching pending connection using the request from this website.</p>
    <p>If Connector tools are unavailable or the page still does not open, follow the <a href="https://github.com/imjszhang/aipoch-connector#connect-a-running-workbench" target="_blank" rel="noreferrer">connection setup help</a>. If the request expires, start a new connection here and use its new request.</p>
    <p>Keep the private confirmation page address on this computer. You only need the website and comparison code in your request.</p>
  </details>;
}
function PairingGuide() {
  const { state } = useWorkbench();
  const pairing = state.pairing!;
  const [now, setNow] = useState(Date.now);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const requestRef = useRef<HTMLTextAreaElement>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const prompt = `In AIPOCH Connector, find the pending Network connection from ${origin} with code ${pairing.verificationCode} and open its local confirmation page. I will compare the website and code and approve it myself. Do not approve it for me.`;
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 1000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [pairing.expiresAt]);
  const remaining = Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000));
  return <section className="wb-pairing-guide" aria-label="Confirm this connection">
    <p className="wb-eyebrow">Confirm on this computer</p>
    <div className="wb-pairing-code"><span>Connection code</span><strong>{pairing.verificationCode}</strong><span role="timer" aria-live="off" aria-label="Time remaining">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} remaining</span></div>
    <p>Do not enter this code on this website. Compare it with the code on the local confirmation page.</p>
    <ol className="wb-connection-steps">
      <li>Switch to Open-Science on this computer. AIPOCH Connector is the tool that opens your connection confirmation page.</li>
      <li>Paste the request below into your Open-Science chat and send it.</li>
      <li>On the page it opens, check <strong className="wb-origin">{origin}</strong> and this code. Approve only if both match, then return here.</li>
    </ol>
    <label className="wb-pairing-request">Request for Open-Science<textarea ref={requestRef} readOnly rows={4} value={prompt} onFocus={event => event.currentTarget.select()} /></label>
    <Button onClick={async () => { try { await navigator.clipboard.writeText(prompt); setCopied(true); setCopyFailed(false); } catch { setCopyFailed(true); requestRef.current?.focus(); requestRef.current?.select(); } }}>{copied ? 'Request copied' : 'Copy request'}</Button>
    {copyFailed && <p role="status" className="wb-muted">Copy is unavailable. Select the request above and copy it manually.</p>}
    <ConnectionHelp />
  </section>;
}
function ConnectButtons() {
  const { engine, state, connected, demo } = useWorkbench();
  return <>{state.pairing && <PairingGuide key={state.attempt} />}<div className="wb-actions">
    {!connected && (['connecting', 'restoring'].includes(state.connection) ? <Button onClick={() => engine.cancelConnection()}>Cancel connection</Button> : <Button className="wb-primary" disabled={state.connection === 'forgetting'} onClick={engine.connect}>Connect Open-Science<ArrowUpRight size={16} aria-hidden="true" /></Button>)}
    {!connected && <a className="wb-button" href={OPEN_SCIENCE_URL} target="_blank" rel="noreferrer">Get Open-Science<ArrowUpRight size={16} aria-hidden="true" /></a>}
  </div>{['connecting', 'restoring'].includes(state.connection) && <p className="wb-muted">{demo ? 'Demo is simulating confirmation. ' : ''}Closing this panel keeps waiting. Cancel connection stops waiting on this website.</p>}{WORKBENCH_MODE === 'real' && ['unconfirmed', 'interrupted', 'waiting'].includes(state.connection) && <ConnectionHelp />}</>;
}
function BrowserAuthorization() {
  const { state, connected, engine } = useWorkbench();
  const memory = state.memory;
  if (WORKBENCH_MODE !== 'real' || (memory.status === 'none' && !connected)) return null;
  const remembered = memory.status === 'remembered' && memory.canForget;
  return <section className="wb-browser-authorization" aria-label="Browser authorization">
    <p className="wb-eyebrow">{remembered ? 'This browser is remembered' : 'Browser authorization'}</p>
    {memory.message && (connected || memory.message !== state.reason) && <p>{memory.message}</p>}
    {remembered && <p>Refreshing, reopening this website or restarting the browser will verify the saved authorization before connecting. After 90 days without use, approve again on this computer.</p>}
    {connected && !memory.canForget && <p>Only this visit is connected. A new visit will need approval again.</p>}
    {memory.canForget && <>{memory.status !== 'storage-unavailable' && <p>Disconnect pauses automatic connection across this website’s tabs and browser restarts. Forgetting removes this browser’s authorization.</p>}<Button className="wb-text-action" disabled={state.connection === 'forgetting'} onClick={() => void engine.forget()}>Forget this browser</Button></>}
    {['forgotten', 'storage-unavailable', 'reauthorize'].includes(memory.status) && <p><a href="https://github.com/imjszhang/aipoch-connector#manage-authorized-browsers" target="_blank" rel="noreferrer">Manage authorized browsers in AIPOCH Connector<ArrowUpRight size={13} aria-hidden="true" /></a></p>}
  </section>;
}
function ConnectionPanel() {
  const { engine, state, connected } = useWorkbench();
  const selected = state.resolution?.status === 'ready' ? state.resolution.reference.object.title : state.selected;
  return <>
    <ConnectionStatus />
    <p className="wb-muted">{connected ? 'Your workbench is connected. Connecting does not send a research reference.' : state.pairing ? 'Waiting for you to approve on the local confirmation page.' : state.reason || 'Start a connection, then confirm it on this computer. Your research selection stays here.'}</p>
    {connected ? <div className="wb-actions"><Link className="wb-button wb-primary" to="/" onClick={engine.close}>Your research home<ArrowRight size={16} aria-hidden="true" /></Link><Button onClick={() => engine.disconnect()}><Unplug size={15} aria-hidden="true" />Disconnect</Button></div> : <ConnectButtons />}
    <BrowserAuthorization />
    {selected && <section className="wb-pending-research" aria-label="Selected research"><p className="wb-eyebrow">{connected ? 'Ready when you are' : 'After connecting'}</p><h3>{selected}</h3><p className="wb-muted">{connected ? 'Continue to review this reference before choosing whether to send it.' : 'Your selection is kept. Connecting will not send it.'}</p>{connected ? <Button className="wb-text-action" onClick={engine.resume}>Review reference for {selected}<ArrowRight size={16} aria-hidden="true" /></Button> : !['connecting', 'restoring', 'forgetting'].includes(state.connection) && <Button className="wb-text-action" onClick={engine.manualReview}>Read or copy reference<ArrowRight size={16} aria-hidden="true" /></Button>}</section>}
    {!connected && ['unconfirmed', 'interrupted', 'waiting', 'paused', 'forgetting'].includes(state.connection) && <Button className="wb-text-action wb-browse" onClick={engine.close}>Continue browsing</Button>}
  </>;
}
function ReferenceFields({ reference }: { reference: ResearchReference }) {
  const license = reference.license;
  return <div className="wb-reference-fields">
    <dl className="wb-reference-summary"><dt>Object</dt><dd>{reference.object.title} · {reference.object.kind === 'resource' ? 'Capability' : 'Project'}<code>{reference.object.id}</code></dd><dt>Action / workbench</dt><dd>{reference.action} · {reference.target}</dd><dt>Public location</dt><dd><a href={reference.public_location}>{reference.public_location}</a></dd><dt>Catalog snapshot</dt><dd><code>{reference.snapshot.id}</code><small>{reference.snapshot.generated_at}</small></dd><dt>License</dt><dd>{license.status === 'per_source' ? license.conditions : `${license.status}${license.spdx_id || license.name ? ` · ${license.spdx_id ?? license.name}` : ' — check source terms'}`}{license.status !== 'per_source' && license.conditions && <p>{license.conditions}</p>}{license.status !== 'per_source' && license.url && <a href={license.url}>Read license</a>}</dd>{license.status !== 'per_source' && license.commit && <><dt>Object license commit</dt><dd><code>{license.commit}</code></dd></>}{license.status !== 'per_source' && license.path && <><dt>Object license path</dt><dd><code>{license.path}</code></dd></>}<dt>Conditions</dt><dd>{reference.conditions.length ? reference.conditions.join('; ') : 'No additional conditions supplied; source terms still apply.'}</dd></dl>
    <h3>All source references</h3>
    {!reference.sources.length && <p>No sources supplied. Version, path and source terms are unknown.</p>}
    {reference.sources.map((source, index) => <section className="wb-reference-source" key={`${source.id}-${index}`}><h4>{source.id}</h4><dl><dt>Source / role</dt><dd>{source.url ? <a href={source.url}>{source.url}</a> : 'Source location unknown'} · {source.role}</dd><dt>Exact reference URL</dt><dd>{source.reference_url ? <a href={source.reference_url}>{source.reference_url}</a> : 'Not supplied'}</dd><dt>Full fixed commit</dt><dd><code>{source.commit ?? 'Not fixed — no immutable commit supplied'}</code></dd><dt>Named reference</dt><dd>{source.named_reference ?? 'Not supplied'}{source.named_reference && !source.commit && ' · mutable, not a fixed version'}</dd><dt>Path</dt><dd><code>{source.path ?? 'Not supplied; no subpath inferred'}</code></dd><dt>Content SHA-256</dt><dd><code>{source.sha256 ?? 'Not supplied'}</code></dd><dt>Source status</dt><dd>{source.availability.replaceAll('_', ' ')} · {source.archived === null ? 'archive status unknown' : source.archived ? 'archived' : 'not archived'} · {source.stale === null ? 'freshness unknown' : source.stale ? 'stale observation' : 'current catalog observation'}</dd><dt>Observed / resolved</dt><dd>{source.observed_at ?? 'Unknown'} / {source.resolved_at ?? 'Not supplied'}</dd><dt>Source license</dt><dd>{source.license.status} {source.license.spdx_id ?? source.license.name ?? '— check source terms'}{source.license.url && <p><a href={source.license.url}>Read source license</a></p>}</dd><dt>License conditions</dt><dd>{source.license.conditions ?? 'Not supplied; do not assume unrestricted use.'}</dd>{source.license.commit && <><dt>License commit</dt><dd><code>{source.license.commit}</code></dd></>}{source.license.path && <><dt>License path</dt><dd><code>{source.license.path}</code></dd></>}</dl></section>)}
    <p className="wb-muted">A fixed version identifies content. Catalog inclusion and connection do not establish scientific validity.</p>
  </div>;
}
function ReferenceReview() {
  const { state, engine, connected, demo } = useWorkbench();
  const [copyStatus, setCopyStatus] = useState('');
  const { resolution } = state;
  useEffect(() => setCopyStatus(''), [resolution]);
  if (!resolution || resolution.status !== 'ready') return <><p role="status">{resolution && 'message' in resolution ? resolution.message : 'No research object is selected.'}</p><Link className="wb-button" to="/explore/" onClick={engine.close}>Explore research</Link></>;
  const { reference, content } = resolution;
  const sending = state.referenceStatus === 'sending';
  const done = ['received', 'continue'].includes(state.referenceStatus);
  const copy = async () => { try { await navigator.clipboard.writeText(content); setCopyStatus('Complete reference copied. No reference was sent to a workbench.'); } catch { setCopyStatus('Copy was unavailable. Select and copy the complete reference below.'); } };
  return <>
    <div className="wb-review-topline"><ConnectionStatus /><span>{reference.action} reference</span></div>
    {demo && <p className="wb-muted">Demo: this preview does not send to a real workbench.</p>}
    <ReferenceFields reference={reference} />
    <details className="wb-manual-reference"><summary>Complete manual reference</summary><p>The full text remains available if copying or connection is unavailable.</p><textarea aria-label="Complete research reference" readOnly value={content} rows={12} onFocus={event => event.currentTarget.select()} /><Button onClick={copy}>Copy complete reference</Button><p role="status">{copyStatus}</p></details>
    {!connected ? <div className="wb-review-footer"><p>{state.reason || 'Connect before sending. You can still read or copy this exact reference.'}</p><ConnectButtons /></div> : done ? <div className="wb-review-footer wb-received"><h3><Check size={20} aria-hidden="true" />Reference received{demo ? ' · Demo' : ''}</h3><p role="status">{state.notice}</p>{state.referenceStatus === 'continue' && <p><strong>Continue in Open-Science with {reference.object.title}.</strong> The next step belongs in your running workbench.</p>}<Button onClick={engine.close}>Return to research</Button></div> : <div className="wb-review-footer">
      {state.notice && <p role="status">{state.notice}</p>}
      {!sending && <label className="wb-consent"><input type="checkbox" checked={!!state.approval} onChange={event => engine.approve(event.target.checked)} /><span>I reviewed this exact object, all sources, full versions, licenses and conditions for {reference.action.toLowerCase()} in Open-Science.</span></label>}
      <div className="wb-actions">{sending ? <><Button disabled>Waiting for matching receipt…</Button><Button onClick={engine.stopWaiting}>Stop waiting</Button></> : <><Button className="wb-primary" disabled={!state.approval} onClick={engine.send}>Send reference{demo ? ' · Demo' : ''}<ArrowRight size={16} aria-hidden="true" /></Button>{['cancelled', 'unconfirmed'].includes(state.referenceStatus) && <Button onClick={engine.retryReview}>Review for a new request</Button>}</>}<Button onClick={engine.close}>Close review</Button></div>
      {sending && <p className="wb-muted">Closing this view keeps waiting. Stop waiting ends only this browser’s wait, not workbench delivery.</p>}
    </div>}
  </>;
}
function WorkbenchOverlay() {
  const { state, engine, data } = useWorkbench();
  if (!state.overlay) return null;
  const replacing = state.overlay === 'replacement';
  const title = state.overlay === 'connection' ? 'Open-Science' : replacing ? state.request ? 'Another reference is waiting' : 'Change selected reference' : 'Review research reference';
  return <Dialog title={title} compact={state.overlay === 'connection'} onClose={engine.close}>
    {state.overlay === 'connection' ? <ConnectionPanel /> : replacing ? <><p>{state.request ? 'A request for ' : 'Your selected reference is '}<strong>{state.resolution?.status === 'ready' ? state.resolution.reference.object.title : state.selected}</strong>{state.request ? ' is still waiting.' : ' — the wait has ended.'}</p><p>Choose whether to {state.request ? 'keep waiting' : 'keep this reference'} or review <strong>{allEntries(data.catalog).find(entry => entry.id === state.replacement)?.title ?? state.replacement}</strong>.{state.request && ' Replacing stops this browser’s wait; it cannot withdraw delivery.'}</p><div className="wb-actions"><Button onClick={engine.keepWaiting}>{state.request ? 'Keep waiting for current reference' : 'Keep current reference'}</Button><Button className="wb-primary" onClick={engine.replace}>Replace and review new reference</Button></div></> : <ReferenceReview />}
  </Dialog>;
}

const personalViews = [['feed', 'Your feed'], ['projects', 'Your projects'], ['saved', 'Saved'], ['following', 'Following'], ['contributions', 'Contributions']] as const;
function LibraryEntries({ ids, data, saved = false }: { ids: string[]; data: SiteData; saved?: boolean }) {
  const { engine, catalogReady } = useWorkbench();
  const entries = new Map(allEntries(data.catalog).map(row => [row.id, row]));
  return <div className="wb-library"><p className="wb-muted">Saved and recently viewed research stays in this browser. It is not synced between devices, and is kept after disconnecting.</p>{!ids.length ? <div className="wb-empty"><h3>{saved ? 'Keep useful research close.' : 'Your next research step starts here'}</h3><p>{saved ? 'Save a project or capability while exploring the network.' : 'Research you visit while connected will appear here.'}</p><Link className="wb-text-action" to="/explore/">Explore research<ArrowRight size={16} aria-hidden="true" /></Link></div> : <div className="wb-library-list">{ids.map(id => {
    const entry = entries.get(id);
    return <article key={id}>{entry ? <><div><small>{entry.kind === 'resource' ? 'Capability' : entry.kind.replaceAll('_', ' ')}</small><h3><Link to={routeFor(entry)}>{entry.title}<ArrowUpRight size={15} aria-hidden="true" /></Link></h3><p>{entry.description ?? 'Read the source and catalog relationships.'}</p></div><EntryActions entry={entry} compact /></> : <><h3>{id}</h3><p>{catalogReady ? 'This saved record is unavailable or withdrawn from the current catalog. Your saved ID is kept.' : 'Waiting for the full catalog to resolve this saved record. It has not been marked missing.'}</p>{saved && <Button onClick={() => engine.toggleSave(id)}>Remove saved record</Button>}</>}</article>;
  })}</div>}{!!ids.length && <Button className="wb-text-action" onClick={engine.clearLibrary}>Clear this browser’s saved items and history</Button>}</div>;
}
function ReferenceHistory() {
  const { state, demo } = useWorkbench();
  return <section className="wb-library"><p className="wb-muted">{demo ? 'Demo receipts' : 'Receipts'} from this visit only. A historical receipt is not proof of a current connection or executed research.</p>{state.receipts.length ? state.receipts.map(receipt => <article key={receipt.id} className="wb-receipt"><h3>{receipt.title}</h3><p>Reference received{demo ? ' · Demo' : ''} · {new Date(receipt.receivedAt).toLocaleString()}</p><p>{receipt.outcome === 'continue' ? 'Continue with this object in Open-Science for the next step.' : 'Receipt confirmed only; no import, installation or execution is claimed.'}</p><details><summary>Reviewed reference and receipt identity</summary><dl><dt>Request</dt><dd><code>{receipt.id}</code></dd><dt>Session at receipt</dt><dd><code>{receipt.sessionId}</code></dd></dl><pre>{receipt.content}</pre></details></article>) : <div className="wb-empty"><h3>No reference receipts yet</h3><p>Choose a project or capability, review its reference, then explicitly send it. Connection alone does not create a receipt.</p></div>}</section>;
}
export function ResearchHome({ data }: { data: SiteData }) {
  const { engine, state, connected, demo } = useWorkbench();
  const nav = useNavigation();
  const query = new URLSearchParams(nav.path.includes('?') ? nav.path.slice(nav.path.indexOf('?')) : typeof window !== 'undefined' ? window.location.search : '');
  const requestedView = query.get('personal') ?? 'feed';
  const view = personalViews.some(([id]) => id === requestedView) ? requestedView : 'feed';
  const activity = query.get('activity') === 'receipts' ? 'receipts' : 'recent';
  if (!connected) return null;
  const heading = personalViews.find(([id]) => id === view)?.[1] ?? 'Your feed';
  const selected = state.resolution?.status === 'ready' ? state.resolution.reference.object : null;
  return <main>
    <section className="wb-home-hero"><div className="wb-wrap"><div className="wb-home-heading"><div><p className="wb-eyebrow">Your research</p><h1>Welcome back</h1><p>Return to useful research, saved capabilities, and your next step.</p><ConnectionStatus /></div><div className="wb-actions"><Link className="wb-button" to="/explore/">Explore<ArrowRight size={16} aria-hidden="true" /></Link><Link className="wb-button wb-primary" to="/submit/">Share your research<ArrowUpRight size={16} aria-hidden="true" /></Link></div></div><nav className="wb-home-nav" aria-label="Your research views">{personalViews.map(([id, label]) => <Link key={id} to={`/?personal=${id}`} aria-current={view === id ? 'page' : undefined}>{label}</Link>)}</nav></div></section>
    <div className="wb-wrap wb-home-layout"><section aria-label={heading}><p className="wb-eyebrow">{view === 'feed' ? 'Your research feed' : 'Your network content'}</p><h2>{view === 'feed' ? 'Pick up where you left off' : heading}</h2>{view === 'feed' && state.selected && <div className="wb-panel wb-home-pending"><p className="wb-eyebrow">Selected research</p><h3>{selected?.title ?? state.selected}</h3><p>Continue with the same reference. Review is required before sending.</p><Button onClick={engine.resume}>Continue with this {selected?.kind === 'resource' ? 'capability' : 'project'}<ArrowRight size={16} aria-hidden="true" /></Button></div>}{view === 'feed' && <nav className="wb-feed-nav" aria-label="Research activity"><Link className="wb-button" aria-current={activity === 'recent' ? 'page' : undefined} to="/?personal=feed">Recently viewed</Link><Link className="wb-button" aria-current={activity === 'receipts' ? 'page' : undefined} to="/?personal=feed&activity=receipts">Reference receipts</Link></nav>}
      {view === 'saved' ? <LibraryEntries ids={state.library.saved} data={data} saved /> : view === 'feed' ? activity === 'receipts' ? <ReferenceHistory /> : <LibraryEntries ids={state.library.recent} data={data} /> : view === 'projects' ? <div className="wb-panel wb-empty"><h3>No workbench project list available</h3><p>No project list has been received from your workbench. Catalog projects are not automatically your projects.</p><Link className="wb-text-action" to="/submit/">Share an existing project<ArrowRight size={16} aria-hidden="true" /></Link></div> : view === 'following' ? <div className="wb-panel wb-empty"><h3>No following data available</h3><p>This site has not received your followed research or updates from Open-Science.</p><Link className="wb-text-action" to="/community/">Explore the community<ArrowRight size={16} aria-hidden="true" /></Link></div> : <div className="wb-panel wb-empty"><h3>No confirmed contributions available</h3><p>Preparing a public recommendation does not confirm it was submitted or included. No workbench contribution history is available.</p><Link className="wb-text-action" to="/contribute/">Ways to contribute<ArrowRight size={16} aria-hidden="true" /></Link></div>}
    </section><aside><div className="wb-panel"><h3>Your connected workbench</h3><p>Choose a project or capability, review its reference, and continue in Open-Science.</p><Button onClick={engine.openConnection}>Connection details</Button></div><div className="wb-panel"><h3>{demo ? 'This preview' : 'This visit'}</h3><p>{state.receipts.length} reference receipts in this session. Receiving a reference does not mean research was executed.</p><Link className="wb-button" to="/?personal=feed&activity=receipts">View receipts</Link></div><p className="wb-muted">Saved and recently viewed research stays in this browser. Workbench projects, following and contribution data are not available{demo ? ' in this demo' : ''}.</p></aside></div>
  </main>;
}
export function JoinPage() {
  const { engine, state, connected, demo } = useWorkbench();
  const selected = state.resolution?.status === 'ready' ? state.resolution.reference.object : null;
  return <main>
    <section className="wb-join-hero"><div className="wb-wrap"><p className="wb-eyebrow">Join with Open-Science</p><h1>Discover here. Research locally.</h1><p>Connect your workbench to continue with the projects and capabilities you find here.</p></div></section>
    <div className="wb-wrap wb-join-layout"><section>
      <div className="wb-panel wb-join-intro"><span className="wb-join-icon"><Laptop size={23} aria-hidden="true" /></span><h2>A workbench for your research.</h2><p>Keep a project’s purpose, sources and versions together. Review a capability’s conditions, then continue the work in your own environment.</p><div className="wb-actions">
        {connected ? selected ? <Button className="wb-primary" onClick={engine.resume}>Continue with {selected.title}<ArrowRight size={16} aria-hidden="true" /></Button> : <ConnectionStatus /> : <Button className="wb-primary" onClick={engine.openConnection}>Connect Open-Science<ArrowUpRight size={16} aria-hidden="true" /></Button>}
        <a className="wb-button" href={OPEN_SCIENCE_URL} target="_blank" rel="noreferrer">Get Open-Science<ArrowUpRight size={16} aria-hidden="true" /></a>
      </div></div>
      <div className="wb-join-sequence">{[
        ['01', 'Choose useful research', 'Browse projects and capabilities without connecting. Sources and collaboration stay where they already work.'],
        ['02', 'Connect your workbench', 'Continue from the same project or capability. Your selection stays with you.'],
        ['03', 'Review, then continue', 'Check the exact sources, versions and conditions before passing the reference to your workbench.'],
      ].map(([number, title, description]) => <article key={number}><b>{number}</b><div><h3>{title}</h3><p>{description}</p></div></article>)}</div>
      {state.selected && <div className="wb-panel wb-join-selected"><p className="wb-eyebrow">Continue with this research</p><h3>{selected?.title ?? state.selected}</h3><p>Your selection is kept. The current reference must be reviewed before sending.</p><Button onClick={engine.resume}>Continue with selected research<ArrowRight size={16} aria-hidden="true" /></Button></div>}
    </section><aside>
      <div className="wb-panel wb-join-status"><div className="wb-join-status-heading"><span className={`wb-join-status-icon ${connected ? 'is-connected' : ''}`}>{connected ? <Check size={23} aria-hidden="true" /> : <Laptop size={23} aria-hidden="true" />}</span><div><p className="wb-eyebrow">Open-Science workbench</p><h2>{connectionLabels[state.connection]}</h2><p>{state.reason || (connected ? 'Projects and capabilities can now continue in your workbench.' : 'Connect to take research from this network into your own workbench.')}</p></div>{demo && <small>Demo</small>}</div>
        {connected ? <><ConnectionStatus /><div className="wb-actions"><Button onClick={engine.openConnection}>Connection details</Button></div></> : <Button onClick={engine.openConnection}>Connect Open-Science</Button>}
        <p className="wb-muted">{demo ? 'This preview demonstrates the connection flow. No live client is connected.' : WORKBENCH_MODE === 'real' ? 'AIPOCH Connector connects to your running workbench on this computer. Public browsing remains available without connecting.' : 'Real Connector communication is not available yet. You can continue browsing and use complete manual references.'}</p>
      </div>
      <div className="wb-panel wb-join-existing"><GitBranch size={25} aria-hidden="true" /><h3>Already have a GitHub project?</h3><p>Share a public repository or organization directly. You do not need a workbench to suggest a source.</p><Link to="/submit/" className="wb-text-action">Share an existing project<ArrowRight size={16} aria-hidden="true" /></Link></div>
      <Link to="/explore/" className="wb-text-action">Keep exploring<ArrowRight size={16} aria-hidden="true" /></Link>
      {demo && <Link to="/review/" className="wb-text-action wb-muted">Review connection scenarios</Link>}
    </aside></div>
  </main>;
}
export function LegacyLibraryPage() {
  const { connected, engine } = useWorkbench();
  const { navigate } = useNavigation();
  useEffect(() => { if (connected) void navigate('/?personal=saved'); }, [connected, navigate]);
  return <main className="wb-wrap wb-join"><h1>{connected ? 'Your saved research' : 'Connect to return to saved research'}</h1><p>Saved items are kept in this browser and available while Open-Science is connected.</p>{connected ? <Link className="wb-button" to="/?personal=saved">Continue to saved research</Link> : <Button className="wb-primary" onClick={engine.openConnection}>Connect Open-Science</Button>}</main>;
}
function ReviewControls() {
  const { engine, state, exitReview, resetReview } = useWorkbench();
  const { navigate } = useNavigation();
  const adapter = engine.adapter as DemoAdapter;
  const [connection, setConnection] = useState<DemoOutcome>(adapter.connectionOutcome);
  const [receipt, setReceipt] = useState<DemoOutcome>(adapter.receiptOutcome);
  useEffect(() => { setConnection(adapter.connectionOutcome); setReceipt(adapter.receiptOutcome); }, [adapter]);
  return <aside className="wb-review-controls" aria-label="Isolated demo Review controls"><details><summary>Review scenarios · isolated Demo <small>{connectionLabels[state.connection]}</small></summary><p>Temporary session, library and receipts. Ordinary saved research is kept separately. Late or mismatched responses must be ignored. Close an open panel to deliver a manual response; closing keeps its wait active.</p><div className="wb-review-grid"><label>Connection response<select value={connection} onChange={event => { adapter.connectionOutcome = event.target.value as DemoOutcome; setConnection(adapter.connectionOutcome); }}>{['automatic', 'manual', 'silent', 'failure'].map(value => <option key={value}>{value}</option>)}</select></label><label>Reference response<select value={receipt} onChange={event => { adapter.receiptOutcome = event.target.value as DemoOutcome; setReceipt(adapter.receiptOutcome); }}>{['automatic', 'manual', 'silent', 'failure', 'continue'].map(value => <option key={value}>{value}</option>)}</select></label></div><div className="wb-actions"><Button onClick={() => adapter.confirmConnection()}>Deliver connection response</Button><Button onClick={() => adapter.deliver()}>Deliver matching receipt</Button><Button onClick={() => adapter.deliver({ sessionId: 'wrong-session' })}>Wrong session receipt</Button><Button onClick={() => adapter.deliver({ id: 'wrong-request' })}>Wrong request receipt</Button><Button onClick={() => adapter.deliver({ objectId: 'wrong-object' })}>Wrong object receipt</Button><Button onClick={() => adapter.deliver({ content: 'different-content' })}>Wrong content receipt</Button><Button onClick={() => engine.disconnect(true)}>Interrupt connection</Button><Button onClick={() => { adapter.expire(); engine.checkSession(); }}>Expire session</Button><Button onClick={resetReview}>Reset Review</Button><Button onClick={() => { exitReview(); void navigate('/'); }}>Exit Review</Button></div></details></aside>;
}
export function ReviewPage() {
  const { demo, review, enterReview, exitReview } = useWorkbench();
  return <main className="wb-wrap wb-join"><p className="wb-eyebrow">Design verification</p><h1>Connection scenarios</h1>{demo ? <><p>Review runs in an isolated temporary domain. Your ordinary session is checked again on return, old sending and consent cannot resume, and ordinary saved records are preserved.</p>{review ? <><p role="status">Review is active. The scenario controls remain available while browsing.</p><Link className="wb-button wb-primary" to="/explore/">Choose research to review</Link><Button onClick={exitReview}>Exit Review</Button></> : <Button className="wb-primary" onClick={enterReview}>Enter isolated Review</Button>}</> : <><p>Review scenarios are available only in the separate Demo build. This production website cannot enable simulated connection through a URL.</p><Link className="wb-button" to="/explore/">Explore research</Link></>}</main>;
}
