import type { Entry, SiteData } from '../model.js';
import { LibraryStore, type LocalLibrary } from '../library/storage.js';
import type { WorkbenchAdapter, Session, Request, Receipt, Cancel } from './adapter.js';
import { resolveReference, type ReferenceResolution } from './reference.js';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'unconfirmed' | 'interrupted';
export type ReferenceStatus = 'selected' | 'reviewing' | 'ready' | 'sending' | 'received' | 'needs-review' | 'cancelled' | 'unconfirmed' | 'continue';
export interface WorkbenchState {
  connection: ConnectionStatus; reason: string; session: Session | null; attempt: string | null;
  selected: string | null; resolution: ReferenceResolution | null;
  referenceStatus: ReferenceStatus; approval: { sessionId: string; content: string } | null;
  request: Request | null; receipts: Array<Receipt & { title: string }>;
  replacement: string | null; overlay: 'connection' | 'review' | 'replacement' | null;
  library: LocalLibrary; storageWarning: string; notice: string;
}
let sequence = 0;
const nextId = (type: string) => `${type}-${Date.now().toString(36)}-${++sequence}`;
const stopped = 'Waiting stopped. This does not withdraw a reference the workbench may already have received. Retry only when you choose to.';
export class WorkbenchEngine {
  private state: WorkbenchState;
  private listeners = new Set<() => void>();
  private cancelConnect?: Cancel;
  private cancelSend?: Cancel;
  private connectTimeout?: ReturnType<typeof setTimeout>;
  private sendTimeout?: ReturnType<typeof setTimeout>;
  private replacementReturnTo: string | null = null;
  private disposed = false;
  constructor(private data: SiteData, private catalogReady: boolean, readonly adapter: WorkbenchAdapter, private library: LibraryStore, private timeouts = { connect: 8000, send: 15000 }, private now = () => Date.now()) {
    this.state = { connection: 'disconnected', reason: '', session: null, attempt: null, selected: null, resolution: null, referenceStatus: 'selected', approval: null, request: null, receipts: [], replacement: null, overlay: null, library: library.value, storageWarning: library.warning, notice: '' };
    if (library.value.selection) this.state = { ...this.state, selected: library.value.selection.id, resolution: resolveReference(data, library.value.selection.id, catalogReady) };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private set(change: Partial<WorkbenchState>) { if (this.disposed) return; this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener()); }
  private refreshLibrary() { this.set({ library: this.library.value, storageWarning: this.library.warning }); }
  hydrateLibrary(library: LibraryStore) {
    this.library = library;
    const id = library.value.selection?.id ?? this.state.selected;
    this.set({ library: library.value, storageWarning: library.warning, selected: id, resolution: id ? resolveReference(this.data, id, this.catalogReady) : null });
  }
  storageEvent(raw: string | null) { this.library.receive(raw); this.refreshLibrary(); }
  updateData(data: SiteData, ready: boolean) {
    this.data = data; this.catalogReady = ready;
    if (!this.state.selected) return;
    const resolution = resolveReference(data, this.state.selected, ready);
    const previous = this.state.resolution;
    if (JSON.stringify(resolution) === JSON.stringify(previous)) return;
    this.endSend();
    this.set({ resolution, approval: null, request: null, referenceStatus: 'needs-review', notice: 'The current catalog reference changed. Review the updated content before sending.' });
  }
  isConnected() { return this.state.connection === 'connected' && !!this.state.session && this.adapter.valid(this.state.session); }
  checkSession() { if (this.state.connection === 'connected' && !this.isConnected()) this.disconnect(true); return this.isConnected(); }
  openConnection = () => { this.checkSession(); this.set({ overlay: 'connection' }); };
  close = () => this.set({ overlay: null });
  select(entry: Entry, returnTo = '/') { this.selectId(entry.id, returnTo); }
  private selectId(id: string, returnTo = '/') {
    if (this.state.request && this.state.selected !== id) { this.replacementReturnTo = returnTo; this.set({ replacement: id, overlay: 'replacement' }); return; }
    if (this.state.request && this.state.selected === id) { this.set({ overlay: 'review' }); return; }
    this.checkSession();
    this.replacementReturnTo = null;
    this.library.update({ selection: { id, returnTo } });
    this.set({ selected: id, resolution: resolveReference(this.data, id, this.catalogReady), approval: null, referenceStatus: 'selected', request: null, replacement: null, overlay: this.isConnected() ? 'review' : 'connection', notice: '', library: this.library.value, storageWarning: this.library.warning });
  }
  replace = () => {
    const replacement = this.state.replacement;
    if (!replacement) return;
    const returnTo = this.replacementReturnTo ?? '/';
    const wasWaiting = !!this.state.request;
    const wasReceived = ['received', 'continue'].includes(this.state.referenceStatus);
    if (wasWaiting) this.stopWaiting();
    this.selectId(replacement, returnTo);
    this.set({ notice: wasWaiting ? 'The previous wait was stopped. Its delivery remains unconfirmed. Review this new object separately.' : wasReceived ? 'The previous reference was received. Review this new object separately.' : 'Review this new object separately. No new reference has been sent.' });
  };
  keepWaiting = () => { this.replacementReturnTo = null; this.set({ replacement: null, overlay: 'review' }); };
  resume = () => { if (!this.state.selected) return this.openConnection(); this.checkSession(); this.set({ overlay: this.isConnected() ? 'review' : 'connection' }); };
  manualReview = () => { if (this.state.selected) this.set({ overlay: 'review' }); };
  connect = () => {
    if (this.state.connection === 'connecting' || this.checkSession()) return;
    this.endConnect(); this.endSend();
    const attempt = nextId('connection');
    this.set({ attempt, connection: 'connecting', reason: 'Waiting for Open-Science to confirm this connection.', session: null, approval: null, request: null, referenceStatus: 'needs-review', notice: '' });
    this.connectTimeout = setTimeout(() => { if (this.state.attempt === attempt) this.cancelConnection('No response was confirmed. You can retry or continue browsing; this does not mean Open-Science is not installed.'); }, this.timeouts.connect);
    this.cancelConnect = this.adapter.connect(attempt, (returned, session, reason) => {
      if (this.disposed || this.state.connection !== 'connecting' || this.state.attempt !== attempt || returned !== attempt) return;
      this.endConnect();
      if (!session || session.demo !== this.adapter.demo || !this.adapter.valid(session)) {
        this.set({ connection: 'unconfirmed', attempt: null, reason: reason ?? 'This connection could not be confirmed.', session: null }); return;
      }
      this.set({ connection: 'connected', attempt: null, session, reason: '', approval: null, referenceStatus: 'reviewing', overlay: this.state.selected ? 'review' : this.state.overlay });
    });
  };
  cancelConnection = (reason = 'Connection waiting was cancelled. No connection was confirmed.') => { this.endConnect(); this.set({ connection: 'unconfirmed', attempt: null, session: null, approval: null, reason }); };
  disconnect = (interrupted = false) => {
    const session = this.state.session;
    this.endConnect(); this.endSend();
    if (session) this.adapter.disconnect(session);
    this.set({ connection: interrupted ? 'interrupted' : 'disconnected', session: null, attempt: null, approval: null, request: null, referenceStatus: 'needs-review', reason: interrupted ? 'This connection was interrupted. Reconnect before continuing; research already in the workbench is unaffected.' : '', notice: this.state.request ? stopped : '' });
  };
  approve = (checked: boolean) => {
    const resolution = this.state.resolution;
    if (this.state.request) return;
    if (!checked) { this.set({ approval: null, referenceStatus: 'reviewing' }); return; }
    if (!this.checkSession() || resolution?.status !== 'ready') return;
    this.set({ approval: { sessionId: this.state.session!.id, content: resolution.content }, referenceStatus: 'ready' });
  };
  send = () => {
    if (this.state.request || !this.checkSession()) return;
    const { resolution, approval, session } = this.state;
    if (resolution?.status !== 'ready' || !approval || !session || approval.sessionId !== session.id || approval.content !== resolution.content) return;
    const request: Request = { id: nextId('reference'), sessionId: session.id, objectId: resolution.reference.object.id, content: resolution.content };
    this.set({ request, approval: null, referenceStatus: 'sending', notice: 'Waiting for this request’s matching receipt. No research has been imported or executed by this website.' });
    this.sendTimeout = setTimeout(() => this.failRequest(request, 'No matching receipt arrived in time. Delivery is unconfirmed; the workbench may already have received the reference. No automatic retry will occur.'), this.timeouts.send);
    this.cancelSend = this.adapter.send(request, receipt => this.receive(receipt), message => this.failRequest(request, message));
  };
  private failRequest(request: Request, message: string) {
    if (this.state.request?.id !== request.id) return;
    this.endSend(); this.set({ request: null, approval: null, referenceStatus: 'unconfirmed', notice: message });
  }
  receive(receipt: Receipt) {
    const request = this.state.request;
    if (!request || !this.checkSession() || this.state.resolution?.status !== 'ready') return;
    if (receipt.id !== request.id || receipt.sessionId !== request.sessionId || receipt.sessionId !== this.state.session?.id || receipt.objectId !== request.objectId || receipt.content !== request.content || receipt.content !== this.state.resolution.content || !['received', 'continue'].includes(receipt.outcome) || !Number.isFinite(receipt.receivedAt)) return;
    this.endSend();
    this.set({ request: null, approval: null, referenceStatus: receipt.outcome, receipts: [{ ...receipt, title: this.state.resolution.reference.object.title }, ...this.state.receipts].slice(0, 60), notice: receipt.outcome === 'continue' ? 'The reference was received. Continue with this object in Open-Science for the next step.' : 'Reference received. Receiving a reference does not mean cloning, importing, installing, executing, or validating research.' });
  }
  stopWaiting = () => { const sent = !!this.state.request; this.endSend(); this.set({ request: null, approval: null, referenceStatus: 'cancelled', notice: sent ? stopped : 'Review cancelled. No reference was sent.' }); };
  retryReview = () => { this.checkSession(); this.set({ approval: null, referenceStatus: 'reviewing', notice: 'Review the current reference before explicitly sending a new request. A previous request may already have been received.' }); };
  toggleSave(id: string) { if (!this.checkSession()) return; const saved = this.library.value.saved; this.library.update({ saved: saved.includes(id) ? saved.filter(item => item !== id) : [...saved, id] }); this.refreshLibrary(); }
  recordView(entry: Entry) { if (!this.checkSession()) return; this.library.update({ recent: [entry.id, ...this.library.value.recent.filter(item => item !== entry.id)].slice(0, 60) }); this.refreshLibrary(); }
  clearLibrary = () => { if (!this.checkSession()) return; this.library.update({ saved: [], recent: [] }); this.refreshLibrary(); };
  setLanguage = (language: 'en' | 'zh') => { this.library.update({ language }); this.refreshLibrary(); };
  /** Leaving a domain invalidates work in flight and review consent, but may retain a valid session. */
  suspend = () => { if (this.state.connection === 'connecting') this.cancelConnection(); if (this.state.request) this.stopWaiting(); this.set({ approval: null, referenceStatus: 'needs-review', overlay: null }); };
  private endConnect() { this.cancelConnect?.(); this.cancelConnect = undefined; clearTimeout(this.connectTimeout); }
  private endSend() { this.cancelSend?.(); this.cancelSend = undefined; clearTimeout(this.sendTimeout); }
  dispose() { this.endConnect(); this.endSend(); this.adapter.dispose(); this.disposed = true; this.listeners.clear(); }
}
