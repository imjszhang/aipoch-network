import type { Entry, SiteData } from '../model.js';
import { LibraryStore, type LocalLibrary } from '../library/storage.js';
import type { WorkbenchAdapter, Session, Request, Receipt, Cancel, PairingProgress, ConnectionMemory } from './adapter.js';
import { resolveReference, type ReferenceResolution } from './reference.js';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'restoring' | 'waiting' | 'paused' | 'forgetting' | 'connected' | 'unconfirmed' | 'interrupted';
export type ReferenceStatus = 'selected' | 'reviewing' | 'ready' | 'sending' | 'received' | 'needs-review' | 'cancelled' | 'unconfirmed' | 'continue';
export interface WorkbenchState {
  connection: ConnectionStatus; reason: string; session: Session | null; attempt: string | null;
  pairing: PairingProgress | null; memory: ConnectionMemory;
  selected: string | null; resolution: ReferenceResolution | null;
  referenceStatus: ReferenceStatus; approval: { sessionId: string; content: string } | null;
  request: Request | null; receipts: Array<Receipt & { title: string }>;
  replacement: string | null; overlay: 'connection' | 'review' | 'replacement' | null;
  library: LocalLibrary; storageWarning: string; notice: string;
}
let sequence = 0;
const nextId = (type: string) => `${type}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${++sequence}`}`;
const stopped = 'Waiting stopped. This does not withdraw a reference the workbench may already have received. Retry only when you choose to.';
const connectionTimeoutReason = 'No response was confirmed. You can retry or continue browsing; this does not mean Open-Science is not installed.';
const emptyMemory: ConnectionMemory = { status: 'none', message: '', canForget: false };
const restoreDelays = [5000, 10000, 30000, 60000];
const waitingForConnection = (value: ConnectionStatus) => value === 'connecting' || value === 'restoring';
const memoryConnection = (memory: ConnectionMemory): ConnectionStatus => memory.status === 'paused' ? 'paused' : memory.status === 'forgetting' ? 'forgetting' : ['host-unavailable', 'unreachable'].includes(memory.status) ? 'waiting' : memory.status === 'reauthorize' ? 'unconfirmed' : 'disconnected';
const pairingTimeoutReason = 'Pairing expired without a confirmed connection. You can retry or continue browsing.';
export class WorkbenchEngine {
  private state: WorkbenchState;
  private listeners = new Set<() => void>();
  private cancelConnect?: Cancel;
  private cancelSend?: Cancel;
  private connectTimeout?: ReturnType<typeof setTimeout>;
  private connectDeadline: number | null = null;
  private sendTimeout?: ReturnType<typeof setTimeout>;
  private replacementReturnTo: string | null = null;
  private disposed = false;
  private memoryUnsubscribe?: Cancel;
  private restorationStarted = false;
  private restorationSuppressed = false;
  private retryCount = 0;
  private nextRestoreAt: number | null = null;
  private lastFocusRestore = -Infinity;
  private memoryAction = 0;
  private forgetting = false;
  private catalogUnavailable = false;
  constructor(private data: SiteData, private catalogReady: boolean, readonly adapter: WorkbenchAdapter, private library: LibraryStore, private timeouts: { connect: number; send: number; pairing?: number } = { connect: 8000, send: 15000, pairing: 180000 }, private now = () => Date.now()) {
    this.state = { connection: 'disconnected', reason: '', session: null, attempt: null, pairing: null, memory: adapter.getMemory?.() ?? emptyMemory, selected: null, resolution: null, referenceStatus: 'selected', approval: null, request: null, receipts: [], replacement: null, overlay: null, library: library.value, storageWarning: library.warning, notice: '' };
    if (library.value.selection) this.state = { ...this.state, selected: library.value.selection.id, resolution: this.resolve(library.value.selection.id) };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private set(change: Partial<WorkbenchState>) { if (this.disposed) return; this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener()); }
  private refreshLibrary() { this.set({ library: this.library.value, storageWarning: this.library.warning }); }
  private resolve(id: string): ReferenceResolution {
    if (this.catalogUnavailable) return { status: 'withdrawn', message: 'This page snapshot is no longer available. Refresh the page before reviewing or sending a research reference. Your selection is kept.' };
    return resolveReference(this.data, id, this.catalogReady);
  }
  /** Terminal for this page session, including complete embedded subgraphs. */
  retireCatalog() {
    if (this.catalogUnavailable) return;
    this.catalogUnavailable = true;
    const hadRequest = Boolean(this.state.request);
    this.endSend();
    this.set({ resolution: this.state.selected ? this.resolve(this.state.selected) : null, approval: null, request: null, referenceStatus: 'needs-review', notice: `This page snapshot is no longer available. Refresh to check the current catalog.${hadRequest ? ` ${stopped}` : ''}` });
  }
  hydrateLibrary(library: LibraryStore) {
    this.library = library;
    const id = library.value.selection?.id ?? this.state.selected;
    this.set({ library: library.value, storageWarning: library.warning, selected: id, resolution: id ? this.resolve(id) : null });
  }
  storageEvent(raw: string | null) { this.library.receive(raw); this.refreshLibrary(); }
  updateData(data: SiteData, ready: boolean) {
    this.data = data; this.catalogReady = ready;
    if (!this.state.selected) return;
    const resolution = this.resolve(this.state.selected);
    const previous = this.state.resolution;
    if (JSON.stringify(resolution) === JSON.stringify(previous)) return;
    this.endSend();
    this.set({ resolution, approval: null, request: null, referenceStatus: 'needs-review', notice: 'The current catalog reference changed. Review the updated content before sending.' });
  }
  isConnected() { return this.state.connection === 'connected' && !!this.state.session && this.adapter.valid(this.state.session); }
  checkSession() {
    this.expireConnectionWait();
    if (this.state.connection === 'connected' && !this.isConnected()) this.disconnect(true);
    if (this.nextRestoreAt !== null && this.now() >= this.nextRestoreAt && !this.restorationSuppressed && !waitingForConnection(this.state.connection) && this.state.connection !== 'forgetting') {
      this.nextRestoreAt = null; this.restoreConnection();
    }
    return this.isConnected();
  }
  /** Called once after browser storage hydration; never creates a pairing request. */
  startRestoration = () => {
    if (this.restorationStarted || this.disposed || !this.adapter.restore) return;
    this.restorationStarted = true;
    this.memoryUnsubscribe = this.adapter.observeMemory?.(memory => this.memoryChanged(memory));
    this.memoryChanged(this.adapter.getMemory?.() ?? emptyMemory);
    if (!this.restorationSuppressed && !this.isConnected() && !waitingForConnection(this.state.connection)) this.restoreConnection();
  };
  focusSession = () => {
    this.checkSession();
    if (!this.restorationSuppressed && this.canRestoreMemory() && !this.isConnected() && !waitingForConnection(this.state.connection) && this.state.connection !== 'forgetting' && this.now() - this.lastFocusRestore >= 60000) {
      this.lastFocusRestore = this.now(); this.retryCount = 0; this.nextRestoreAt = null; this.restoreConnection();
    }
  };
  private canRestoreMemory() { return this.state.memory.retryable || (this.state.memory.status === 'remembered' && this.state.memory.canForget); }
  private scheduleRestoration() {
    if (this.restorationStarted && this.adapter.restore && this.canRestoreMemory() && !this.restorationSuppressed && this.nextRestoreAt === null && this.retryCount < restoreDelays.length) this.nextRestoreAt = this.now() + restoreDelays[this.retryCount++];
  }
  private memoryChanged(memory: ConnectionMemory) {
    if (this.disposed) return;
    const previous = this.state.memory;
    this.set({ memory });
    if (previous.status === 'paused' && memory.status === 'remembered' && memory.retryable && !this.forgetting) {
      this.restorationSuppressed = false; this.retryCount = 0; this.nextRestoreAt = this.now();
    }
    if (['paused', 'forgetting', 'forgotten'].includes(memory.status)) {
      const session = this.state.session, hadRequest = !!this.state.request;
      this.restorationSuppressed = true; this.nextRestoreAt = null;
      this.endConnect(); this.endSend();
      this.set({ connection: this.forgetting ? 'forgetting' : memoryConnection(memory), attempt: null, pairing: null, session: null, approval: null, request: null, referenceStatus: 'needs-review', reason: memory.message, notice: hadRequest ? stopped : this.state.notice });
      if (session) this.adapter.disconnect(session);
      return;
    }
    if (waitingForConnection(this.state.connection) || this.state.connection === 'forgetting') {
      if (this.state.connection === 'restoring' && memory.status === 'checking') this.set({ reason: memory.message });
      return;
    }
    if (this.state.connection === 'connected') {
      if (!this.isConnected()) this.disconnect(true);
      return;
    }
    if (memory.status !== 'checking') this.set({ connection: memoryConnection(memory), reason: memory.message });
  }
  private restoreConnection() {
    if (!this.adapter.restore || this.disposed || this.restorationSuppressed || this.isConnected() || waitingForConnection(this.state.connection) || this.state.connection === 'forgetting') return;
    this.endConnect(); this.endSend();
    const attempt = nextId('restore'), budget = Math.max(30000, this.timeouts.connect);
    this.connectDeadline = this.now() + budget;
    this.set({ connection: 'restoring', attempt, pairing: null, session: null, approval: null, request: null, referenceStatus: 'needs-review', reason: 'Checking whether this browser has a saved connection. You can keep browsing.' });
    this.connectTimeout = setTimeout(() => { if (this.state.attempt === attempt) this.finishRestoreFailure('The connection check could not finish. Try connecting again when the Connector is available.'); }, budget);
    const cancel = this.adapter.restore(attempt, (returned, session, reason) => {
      if (this.disposed || this.state.connection !== 'restoring' || this.state.attempt !== attempt || returned !== attempt) { this.discardConnectionSession(session); return; }
      if (this.expireConnectionWait()) { this.discardConnectionSession(session); return; }
      if (!session || session.demo !== this.adapter.demo || !this.adapter.valid(session)) { this.discardConnectionSession(session); this.finishRestoreFailure(reason); return; }
      this.endConnect(); this.retryCount = 0; this.nextRestoreAt = null;
      this.set({ connection: 'connected', attempt: null, pairing: null, session, reason: '', approval: null, referenceStatus: this.state.selected ? 'needs-review' : 'selected' });
    });
    if (this.state.attempt === attempt) this.cancelConnect = cancel; else cancel();
  }
  private finishRestoreFailure(reason?: string) {
    this.endConnect();
    const memory = this.adapter.getMemory?.() ?? this.state.memory;
    this.set({ connection: memoryConnection(memory), memory, attempt: null, pairing: null, session: null, approval: null, reason: reason || memory.message });
    this.scheduleRestoration();
  }
  private expireConnectionWait(now = this.now()) {
    if (!waitingForConnection(this.state.connection) || this.connectDeadline === null || now < this.connectDeadline) return false;
    if (this.state.connection === 'restoring') { this.finishRestoreFailure('The connection check could not finish in time. You can retry or continue browsing.'); return true; }
    this.cancelConnection(this.state.pairing ? pairingTimeoutReason : connectionTimeoutReason);
    return true;
  }
  private discardConnectionSession(session: Session | null) {
    // An adapter may create its private session immediately before a deadline is rechecked here.
    // Revoke that unused session, but do not revoke the current one for a duplicate callback.
    if (session && session.id !== this.state.session?.id) this.adapter.disconnect(session);
  }
  openConnection = () => { this.checkSession(); this.set({ overlay: 'connection' }); };
  close = () => this.set({ overlay: null });
  select(entry: Entry, returnTo = '/') { this.selectId(entry.id, returnTo); }
  private selectId(id: string, returnTo = '/') {
    if (this.state.request && this.state.selected !== id) { this.replacementReturnTo = returnTo; this.set({ replacement: id, overlay: 'replacement' }); return; }
    if (this.state.request && this.state.selected === id) { this.set({ overlay: 'review' }); return; }
    this.checkSession();
    this.replacementReturnTo = null;
    this.library.update({ selection: { id, returnTo } });
    this.set({ selected: id, resolution: this.resolve(id), approval: null, referenceStatus: 'selected', request: null, replacement: null, overlay: this.isConnected() ? 'review' : 'connection', notice: '', library: this.library.value, storageWarning: this.library.warning });
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
    this.checkSession();
    if (this.state.connection === 'connecting' || this.state.connection === 'forgetting' || this.isConnected()) return;
    this.restorationSuppressed = false; this.nextRestoreAt = null; this.retryCount = 0; this.memoryAction++;
    this.endConnect(); this.endSend();
    const attempt = nextId('connection');
    const budget = this.adapter.restore ? Math.max(30000, this.timeouts.connect) : this.timeouts.connect;
    this.connectDeadline = this.now() + budget;
    this.set({ attempt, pairing: null, connection: 'connecting', reason: 'Waiting for Open-Science to confirm this connection.', session: null, approval: null, request: null, referenceStatus: 'needs-review', overlay: this.state.overlay === 'review' ? 'connection' : this.state.overlay, notice: '' });
    this.connectTimeout = setTimeout(() => { if (this.state.attempt === attempt) this.cancelConnection(connectionTimeoutReason); }, budget);
    const cancel = this.adapter.connect(attempt, (returned, session, reason) => {
      if (this.disposed || this.state.connection !== 'connecting' || this.state.attempt !== attempt || returned !== attempt) { this.discardConnectionSession(session); return; }
      if (this.expireConnectionWait()) { this.discardConnectionSession(session); return; }
      this.endConnect();
      if (!session || session.demo !== this.adapter.demo || !this.adapter.valid(session)) {
        this.discardConnectionSession(session);
        const memory = this.adapter.getMemory?.() ?? this.state.memory;
        this.set({ connection: memory.retryable ? 'waiting' : 'unconfirmed', memory, attempt: null, pairing: null, reason: reason ?? 'This connection could not be confirmed.', session: null }); this.scheduleRestoration(); return;
      }
      // Connection confirmation grants no review consent and must not move or reopen the user's current panel.
      this.retryCount = 0; this.nextRestoreAt = null;
      this.set({ connection: 'connected', attempt: null, pairing: null, session, reason: '', approval: null, referenceStatus: this.state.selected ? 'needs-review' : 'selected' });
    }, (returned, pairing) => {
      if (this.disposed || this.state.connection !== 'connecting' || this.state.attempt !== attempt || returned !== attempt || this.state.pairing) return;
      const now = this.now();
      if (this.expireConnectionWait(now)) return;
      const remaining = Math.min(pairing.expiresAt - now, this.timeouts.pairing ?? 180000);
      if (!Number.isFinite(remaining) || remaining <= 0) return this.cancelConnection('Pairing expired. Retry when you are ready.');
      clearTimeout(this.connectTimeout);
      this.connectDeadline = now + remaining;
      this.set({ pairing: { ...pairing, expiresAt: now + remaining }, reason: 'Check that this code matches AIPOCH Connector on this computer, then approve the connection there.' });
      this.connectTimeout = setTimeout(() => { if (this.state.attempt === attempt) this.cancelConnection(pairingTimeoutReason); }, remaining);
    });
    if (this.state.attempt === attempt) this.cancelConnect = cancel; else cancel();
  };
  cancelConnection = (reason = 'Connection waiting was cancelled. No connection was confirmed.') => {
    this.restorationSuppressed = true; this.nextRestoreAt = null; this.memoryAction++;
    this.endConnect(); this.set({ connection: 'unconfirmed', attempt: null, pairing: null, session: null, approval: null, reason });
  };
  disconnect = (interrupted = false) => {
    const session = this.state.session, hadRequest = !!this.state.request;
    this.endConnect(); this.endSend();
    const action = ++this.memoryAction;
    if (!interrupted) { this.restorationSuppressed = true; this.nextRestoreAt = null; }
    this.set({ connection: interrupted ? 'interrupted' : this.adapter.pause ? 'paused' : 'disconnected', session: null, attempt: null, pairing: null, approval: null, request: null, referenceStatus: 'needs-review', reason: interrupted ? (this.state.memory.status === 'remembered' ? 'This connection needs to be verified again.' : this.state.memory.message) || 'This connection was interrupted. Reconnect before continuing; research already in the workbench is unaffected.' : this.adapter.pause ? 'Automatic connection is paused for this browser across tabs and restarts. Choose Connect Open-Science to resume.' : '', notice: hadRequest ? stopped : '' });
    if (!interrupted && this.adapter.pause) void this.adapter.pause().catch(() => {
      if (action === this.memoryAction) this.set({ reason: 'This page is disconnected, but the browser could not save the pause. Automatic restoration after reopening is not guaranteed.' });
    });
    if (session) this.adapter.disconnect(session);
    if (interrupted) {
      if (this.canRestoreMemory()) this.set({ connection: 'waiting' });
      this.scheduleRestoration();
    }
  };
  forget = async () => {
    if (!this.adapter.forget || this.forgetting || this.state.connection === 'forgetting') return;
    this.forgetting = true;
    const session = this.state.session, hadRequest = !!this.state.request, action = ++this.memoryAction;
    this.restorationSuppressed = true; this.nextRestoreAt = null; this.endConnect(); this.endSend();
    this.set({ connection: 'forgetting', session: null, attempt: null, pairing: null, approval: null, request: null, referenceStatus: 'needs-review', reason: 'Forgetting this browser and requesting authorization revocation.', notice: hadRequest ? stopped : '' });
    try {
      const forgetting = this.adapter.forget();
      if (session) this.adapter.disconnect(session);
      await forgetting;
      if (action !== this.memoryAction || this.disposed) return;
      this.forgetting = false;
      const memory = this.adapter.getMemory?.() ?? emptyMemory;
      this.set({ connection: memoryConnection(memory), memory, reason: memory.message });
    } catch {
      if (action === this.memoryAction) { this.forgetting = false; this.set({ connection: 'unconfirmed', reason: 'Forgetting this browser could not be confirmed. Use AIPOCH Connector’s authorized-browser list to check or revoke its authorization.' }); }
    }
  };
  approve = (checked: boolean) => {
    if (this.catalogUnavailable) return;
    const resolution = this.state.resolution;
    if (this.state.request) return;
    if (!checked) { this.set({ approval: null, referenceStatus: 'reviewing' }); return; }
    if (!this.checkSession() || resolution?.status !== 'ready') return;
    this.set({ approval: { sessionId: this.state.session!.id, content: resolution.content }, referenceStatus: 'ready' });
  };
  send = () => {
    if (this.catalogUnavailable) return;
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
  suspend = () => { if (waitingForConnection(this.state.connection)) this.cancelConnection(); if (this.state.request) this.stopWaiting(); this.set({ approval: null, referenceStatus: 'needs-review', overlay: null }); };
  private endConnect() { this.cancelConnect?.(); this.cancelConnect = undefined; clearTimeout(this.connectTimeout); this.connectDeadline = null; }
  private endSend() { this.cancelSend?.(); this.cancelSend = undefined; clearTimeout(this.sendTimeout); }
  dispose() { this.memoryUnsubscribe?.(); this.nextRestoreAt = null; this.endConnect(); this.endSend(); this.adapter.dispose(); this.disposed = true; this.listeners.clear(); }
}
