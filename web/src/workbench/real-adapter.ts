import type { Cancel, ConnectionMemory, PairingProgress, Receipt, Request, Session, WorkbenchAdapter } from './adapter.js';
import { BrowserIdentityStore, type BrowserIdentity } from './browser-identity.js';

const PROTOCOL = '1.0';
export const CONNECTOR_ENDPOINT = 'http://127.0.0.1:47821';
export const REAL_REFERENCE_WAIT_MS = 60_000;
interface PrivateSession { session: Session; token: string; verifiedAt: number; credentialId?: string; grantId?: string; timer?: ReturnType<typeof setTimeout> }
type IdentityAccess = Pick<BrowserIdentityStore, 'load' | 'prepare' | 'remember' | 'setPaused' | 'forget' | 'sign' | 'subscribe' | 'dispose' | 'takeForRevocation' | 'warning'>;
interface Capabilities { connectorId: string }
interface Authorization { id: string; connectorId: string; origin: string; expiresAt: number; createdAt: number; lastUsedAt: number }
interface Options { identity?: IdentityAccess | null; origin?: string; browserName?: string; fetch?: typeof fetch; now?: () => number; endpoint?: string; requestTimeout?: number; receiptTimeout?: number; pollInterval?: number; heartbeatInterval?: number; freshness?: number }
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Connector response');
  return value as Record<string, unknown>;
};
const bounded = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0020\u007f]/.test(value);
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
class ConnectorHttpError extends Error {
  constructor(readonly status: number, readonly code?: string) { super('Connector request was not confirmed'); }
}
class ConnectorResponseError extends Error {}
const sessionFailure = (error: unknown): boolean => error instanceof ConnectorHttpError &&
  (error.status === 401 || ['unauthorized', 'session_expired', 'session_mismatch', 'host_unavailable', 'host_changed'].includes(error.code ?? ''));
const uncertain = (error: unknown): boolean => !(error instanceof ConnectorResponseError) &&
  (!(error instanceof ConnectorHttpError) || error.status === 408 || error.status === 429 || error.status >= 500);
const unconfirmed = 'Delivery is unconfirmed. The Connector may already have received this reference. No automatic retry will occur.';

/** Independent browser transport. Bearer tokens stay in memory; persisted proof keys are isolated in BrowserIdentityStore. */
export class RealAdapter implements WorkbenchAdapter {
  readonly demo = false;
  private sessions = new Map<string, PrivateSession>();
  private operations = new Set<AbortController>();
  private sends = new Map<AbortController, PrivateSession>();
  private disposed = false;
  private readonly options: Required<Omit<Options, 'identity' | 'origin' | 'browserName'>>;
  private readonly identity: IdentityAccess | null;
  private readonly origin: string;
  private readonly browserName: string;
  private memory: ConnectionMemory = { status: 'none', message: '', canForget: false };
  private memoryListeners = new Set<(state: ConnectionMemory) => void>();
  private identityUnsubscribe?: Cancel;
  private epoch = 0;
  getMemory = () => this.memory;
  observeMemory = (receive: (state: ConnectionMemory) => void) => { this.memoryListeners.add(receive); return () => { this.memoryListeners.delete(receive); }; };
  private setMemory(change: ConnectionMemory) { if (this.disposed) return; this.memory = change; for (const receive of this.memoryListeners) receive(change); }
  private abandon() {
    this.epoch++;
    for (const operation of this.operations) operation.abort();
    for (const value of [...this.sessions.values()]) { this.invalidate(value); void this.json('/v1/session', 'DELETE', value.token).catch(() => {}); }
  }
  constructor(options: Options = {}) {
    const endpoint = options.endpoint ?? CONNECTOR_ENDPOINT;
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Connector endpoint must be an explicit loopback HTTP origin');
    this.options = { fetch: options.fetch ?? globalThis.fetch.bind(globalThis), now: options.now ?? Date.now, endpoint: url.origin, requestTimeout: options.requestTimeout ?? 8000, receiptTimeout: options.receiptTimeout ?? REAL_REFERENCE_WAIT_MS, pollInterval: options.pollInterval ?? 1000, heartbeatInterval: options.heartbeatInterval ?? 5000, freshness: options.freshness ?? 15000 };
    this.origin = options.origin ?? (typeof location !== 'undefined' ? location.origin : '');
    this.browserName = options.browserName ?? (typeof navigator !== 'undefined' && /Firefox/i.test(navigator.userAgent) ? 'Firefox' : 'Web browser');
    this.identity = options.identity === undefined ? (typeof window !== 'undefined' ? new BrowserIdentityStore() : null) : options.identity;
    this.identityUnsubscribe = this.identity?.subscribe(change => {
      if (change.kind === 'pause') { this.abandon(); this.setMemory({ status: 'paused', message: 'Automatic connection is paused in this browser. Choose Connect to resume.', canForget: this.memory.canForget }); }
      if (change.kind === 'forget') { this.abandon(); this.setMemory({ status: 'forgotten', message: 'This browser no longer has a saved connection identity.', canForget: false }); }
      if (change.kind === 'resume' && this.memory.status === 'paused') this.setMemory({ status: 'remembered', message: 'Automatic connection was resumed in this browser.', canForget: this.memory.canForget, retryable: true });
    });
  }
  private async json(path: string, method: string, token?: string, body?: unknown, signal?: AbortSignal, remaining = this.options.requestTimeout): Promise<Record<string, unknown>> {
    const operation = new AbortController();
    // Session retirement must survive repeated pause/forget notifications. Its own timeout still bounds it.
    if (!(path === '/v1/session' && method === 'DELETE')) this.operations.add(operation);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let rejectWait!: (error: Error) => void;
    const stopped = new Promise<never>((_resolve, reject) => { rejectWait = reject; });
    const abort = () => {
      operation.abort(); void reader?.cancel().catch(() => {});
      rejectWait(new Error('Connector wait stopped'));
    };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.max(0, Math.min(this.options.requestTimeout, remaining)));
    try {
      // The race also bounds a stalled body or a transport that ignores AbortSignal.
      return await Promise.race([stopped, (async () => {
        if (operation.signal.aborted) throw new Error('Connector wait stopped');
        const response = await this.options.fetch(`${this.options.endpoint}${path}`, { method, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: operation.signal, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        if (operation.signal.aborted) throw new Error('Connector wait stopped');
        if (method === 'DELETE' && response.status === 204) return {};
        reader = response.body?.getReader();
        if (!reader) { if (!response.ok) throw new ConnectorHttpError(response.status); throw new ConnectorResponseError('Empty Connector response'); }
        const chunks: Uint8Array[] = []; let length = 0;
        while (true) {
          const next = await reader.read();
          if (operation.signal.aborted) throw new Error('Connector wait stopped');
          if (next.done) break;
          length += next.value.byteLength;
          if (length > 1024 * 1024) { await reader.cancel(); throw new ConnectorResponseError('Connector response exceeds limit'); }
          chunks.push(next.value);
        }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        let result: Record<string, unknown>;
        try { result = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
        catch { if (!response.ok) throw new ConnectorHttpError(response.status); throw new ConnectorResponseError('Invalid Connector response'); }
        if (!response.ok) {
          const error = result.error;
          const code = error && typeof error === 'object' && 'code' in error && bounded(error.code, 100) ? error.code : undefined;
          throw new ConnectorHttpError(response.status, code);
        }
        return result;
      })()]);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.operations.delete(operation); }
  }
  private wait(signal: AbortSignal, remaining = this.options.pollInterval): Promise<void> {
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error('Connector wait stopped')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.max(0, Math.min(this.options.pollInterval, remaining)));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
  }
  private async capabilities(signal: AbortSignal): Promise<Capabilities | null> {
    try {
      const value = await this.json('/v1/capabilities', 'GET', undefined, undefined, signal);
      const extension = value.persistentAuthorization;
      if (!extension || typeof extension !== 'object' || Array.isArray(extension)) return null;
      const capability = extension as Record<string, unknown>;
      if (value.protocolVersion !== PROTOCOL || capability.version !== '1.0' || capability.algorithm !== 'ECDSA-P256-SHA256' || !bounded(capability.connectorId) || capability.idleTtlMs !== 7_776_000_000 || capability.challengeTtlMs !== 60_000) return null;
      return { connectorId: capability.connectorId };
    } catch (error) {
      if (error instanceof ConnectorHttpError && [404, 400, 501].includes(error.status)) return null;
      if (error instanceof ConnectorResponseError) return null;
      throw error;
    }
  }
  private authorization(value: unknown, connectorId: string): Authorization {
    const grant = record(value);
    if (!bounded(grant.id) || grant.connectorId !== connectorId || grant.origin !== this.origin || !timestamp(grant.createdAt) || !timestamp(grant.lastUsedAt) || !timestamp(grant.expiresAt) || grant.createdAt > grant.lastUsedAt || grant.expiresAt <= this.options.now() || grant.expiresAt - grant.lastUsedAt !== 7_776_000_000) throw new ConnectorResponseError('Invalid authorization');
    return grant as unknown as Authorization;
  }
  private async sameIdentity(identity: BrowserIdentity) {
    const current = await this.identity?.load();
    return !!current && !current.paused && current.credentialId === identity.credentialId && current.revision === identity.revision;
  }
  private async proof(identity: BrowserIdentity, purpose: 'resume' | 'revoke', signal: AbortSignal, signer?: (bytes: Uint8Array) => Promise<string | null>) {
    const grant = identity.grant;
    if (!grant) throw new ConnectorResponseError('No browser authorization');
    const base = `/v1/authorizations/${encodeURIComponent(grant.grantId)}`;
    const value = await this.json(`${base}/challenge`, 'POST', undefined, { version: '1.0', connectorId: grant.connectorId, purpose }, signal);
    if (!bounded(value.challengeId) || typeof value.challenge !== 'string' || value.challenge.length > 2000 || !timestamp(value.expiresAt) || value.expiresAt <= this.options.now() || value.expiresAt > this.options.now() + 60_000) throw new ConnectorResponseError('Invalid challenge');
    let fields: unknown;
    try { fields = JSON.parse(value.challenge); } catch { throw new ConnectorResponseError('Invalid challenge'); }
    if (!Array.isArray(fields) || fields.length !== 9 || fields[0] !== 'aipoch-browser-authorization' || fields[1] !== '1.0' || fields[2] !== grant.connectorId || fields[3] !== this.origin || fields[4] !== grant.grantId || fields[5] !== purpose || fields[6] !== value.challengeId || !bounded(fields[7], 128) || fields[8] !== value.expiresAt || JSON.stringify(fields) !== value.challenge) throw new ConnectorResponseError('Challenge binding mismatch');
    if (signal.aborted) throw new Error('Connection stopped');
    const bytes = new TextEncoder().encode(value.challenge);
    const signature = signer ? await signer(bytes) : await this.identity?.sign(identity.credentialId, bytes);
    if (!signature || signal.aborted) throw new Error('Browser identity unavailable');
    return { base, body: { version: '1.0', connectorId: grant.connectorId, challengeId: value.challengeId, signature } };
  }
  private async acceptSession(candidateValue: unknown, signal: AbortSignal, epoch: number, identity?: BrowserIdentity, authorization?: Authorization, remember = false): Promise<Session> {
    const candidate = record(candidateValue);
    let installed = false;
    try {
      if (candidate.protocolVersion !== PROTOCOL || !bounded(candidate.id) || !bounded(candidate.token) || !timestamp(candidate.expiresAt) || candidate.expiresAt <= this.options.now()) throw new ConnectorResponseError('Unsupported session');
      const verified = await this.json('/v1/session', 'GET', candidate.token, undefined, signal);
      if (verified.id !== candidate.id || verified.hostReady !== true || verified.expiresAt !== candidate.expiresAt || (authorization && verified.authorizationId !== authorization.id)) throw new ConnectorResponseError('Workbench not ready');
      if (identity && !await this.sameIdentity(identity)) throw new Error('Browser identity changed');
      if (signal.aborted || this.disposed || epoch !== this.epoch) throw new Error('Connection stopped');
      if (authorization && identity && remember) {
        const saved = await this.identity!.remember(identity.credentialId, { connectorId: authorization.connectorId, grantId: authorization.id }, identity.revision);
        if (!saved) {
          this.setMemory({ status: 'storage-unavailable', message: 'Browser authorization could not be saved. Manage the authorization in Open-Science and try again.', canForget: true });
          throw new Error('Browser authorization not saved');
        }
        const current = await this.identity!.load();
        if (!current || current.paused || current.credentialId !== identity.credentialId || current.grant?.grantId !== authorization.id || current.grant.connectorId !== authorization.connectorId) throw new Error('Browser identity changed');
      }
      if (signal.aborted || this.disposed || epoch !== this.epoch) throw new Error('Connection stopped');
      const session: Session = { id: candidate.id, expiresAt: candidate.expiresAt, demo: false };
      const value: PrivateSession = { session, token: candidate.token, verifiedAt: this.options.now(), ...(identity && authorization ? { credentialId: identity.credentialId, grantId: authorization.id } : {}) };
      this.sessions.set(session.id, value); this.heartbeat(value); installed = true;
      if (authorization) this.setMemory({ status: 'remembered', message: 'This browser is remembered. Future visits verify a new connection automatically.', canForget: true });
      return session;
    } finally {
      // A valid token may arrive before verification, storage or cancellation fails. Such a
      // candidate never reaches sessions, so normal disconnect cannot otherwise retire it.
      if (!installed && bounded(candidate.token) && ![...this.sessions.values()].some(value => value.token === candidate.token)) void this.json('/v1/session', 'DELETE', candidate.token).catch(() => {});
    }
  }
  private restoreFailure(error: unknown) {
    const code = error instanceof ConnectorHttpError ? error.code : undefined;
    if (code === 'authorized_host_unavailable') this.setMemory({ status: 'host-unavailable', message: 'Authorization is remembered. Waiting for Open-Science to be ready.', canForget: true, retryable: true });
    else if (['authorization_unknown', 'authorization_revoked', 'authorization_expired', 'connector_changed', 'host_changed', 'invalid_proof'].includes(code ?? '')) this.setMemory({ status: 'reauthorize', message: 'The saved authorization is no longer valid for this connection. Choose Connect to approve again.', canForget: true });
    else this.setMemory({ status: 'unreachable', message: 'The saved connection could not be verified. Check AIPOCH Connector; your authorization has not been forgotten.', canForget: true, retryable: true });
  }
  private async restoreIdentity(identity: BrowserIdentity, signal: AbortSignal, epoch: number): Promise<Session | null> {
    if (!identity.grant || identity.paused) return null;
    this.setMemory({ status: 'checking', message: 'Verifying the saved browser authorization…', canForget: true });
    try {
      const capabilities = await this.capabilities(signal);
      if (!capabilities) { this.setMemory({ status: 'unsupported', message: 'This Connector does not support saved authorizations. Choose Connect for a session-only connection.', canForget: true }); return null; }
      if (capabilities.connectorId !== identity.grant.connectorId) throw new ConnectorHttpError(409, 'connector_changed');
      const proof = await this.proof(identity, 'resume', signal);
      const result = await this.json(`${proof.base}/resume`, 'POST', undefined, proof.body, signal);
      const authorization = this.authorization(result.authorization, identity.grant.connectorId);
      if (authorization.id !== identity.grant.grantId) throw new ConnectorResponseError('Authorization changed');
      return await this.acceptSession(result.session, signal, epoch, identity, authorization);
    } catch (error) {
      if (!signal.aborted && epoch === this.epoch && !this.disposed) this.restoreFailure(error);
      return null;
    }
  }
  restore(attempt: string, receive: (attempt: string, session: Session | null, reason?: string) => void): Cancel {
    const operation = new AbortController(); this.operations.add(operation); const epoch = this.epoch;
    void (async () => {
      let session: Session | null = null;
      try {
        const identity = await this.identity?.load();
        if (operation.signal.aborted || epoch !== this.epoch) return;
        if (identity?.paused) this.setMemory({ status: 'paused', message: 'Automatic connection is paused in this browser. Choose Connect to resume.', canForget: !!identity.grant });
        else if (identity?.grant) session = await this.restoreIdentity(identity, operation.signal, epoch);
        else if (this.identity?.warning) this.setMemory({ status: 'storage-unavailable', message: 'Browser storage is unavailable. Connect for this visit; authorization cannot be remembered.', canForget: false });
        else this.setMemory({ status: 'none', message: '', canForget: false });
        if (!operation.signal.aborted && epoch === this.epoch && !this.disposed) receive(attempt, session, this.memory.message);
      } catch {
        if (!operation.signal.aborted && epoch === this.epoch && !this.disposed) receive(attempt, null, 'Saved browser identity could not be read.');
      } finally { this.operations.delete(operation); }
    })();
    return () => operation.abort();
  }
  connect(attempt: string, receive: (attempt: string, session: Session | null, reason?: string) => void, progress?: (attempt: string, pairing: PairingProgress) => void): Cancel {
    const operation = new AbortController(); this.operations.add(operation); const epoch = this.epoch; let completed = false;
    void (async () => {
      try {
        if (this.disposed) throw new Error('Disposed');
        let identity: BrowserIdentity | null | undefined;
        let capability: Capabilities | null = null;
        if (this.identity) {
          await this.identity.setPaused(false);
          identity = await this.identity.load();
          if (identity?.grant) {
            const restored = await this.restoreIdentity(identity, operation.signal, epoch);
            if (restored) { completed = true; receive(attempt, restored); return; }
            if (!['reauthorize', 'unsupported'].includes(this.memory.status)) { completed = true; receive(attempt, null, this.memory.message); return; }
          }
          try { capability = await this.capabilities(operation.signal); } catch { capability = null; }
          if (capability) identity = await this.identity.prepare();
          else this.setMemory({ status: 'unsupported', message: 'This connection is for this visit. Saved authorization is unavailable in this Connector.', canForget: !!identity?.grant });
          if (capability && !identity) this.setMemory({ status: 'storage-unavailable', message: 'This connection is for this visit. Your browser could not save an identity.', canForget: false });
        }
        if (operation.signal.aborted || epoch !== this.epoch) return;
        const browserAuthorization = capability && identity ? { version: '1.0', publicKey: identity.publicKeyJwk, browserName: this.browserName } : undefined;
        const pairing = await this.json('/v1/pairings', 'POST', undefined, { protocolVersion: PROTOCOL, attemptId: attempt, ...(browserAuthorization ? { browserAuthorization } : {}) }, operation.signal);
        if (!bounded(pairing.pairingId) || !bounded(pairing.pollToken) || typeof pairing.verificationCode !== 'string' || !/^[A-Za-z0-9 -]{4,32}$/.test(pairing.verificationCode) || !timestamp(pairing.expiresAt) || pairing.expiresAt <= this.options.now()) throw new Error('Invalid pairing');
        const expiresAt = Math.min(pairing.expiresAt, this.options.now() + 180000);
        if (operation.signal.aborted) return;
        progress?.(attempt, { verificationCode: pairing.verificationCode, expiresAt });
        while (!operation.signal.aborted && this.options.now() < expiresAt) {
          const result = await this.json(`/v1/pairings/${encodeURIComponent(pairing.pairingId)}`, 'GET', pairing.pollToken, undefined, operation.signal);
          if (result.status === 'approved') {
            const authorization = result.authorization && browserAuthorization && capability ? this.authorization(result.authorization, capability.connectorId) : undefined;
            const session = await this.acceptSession(result.session, operation.signal, epoch, browserAuthorization && identity ? identity : undefined, authorization, true);
            if (!authorization && browserAuthorization) this.setMemory({ status: 'none', message: 'Connected for this visit only. This browser was not remembered.', canForget: !!identity?.grant });
            completed = true; receive(attempt, session); return;
          }
          if (result.status !== 'pending') throw new Error('Pairing was not approved');
          await this.wait(operation.signal);
        }
        if (!operation.signal.aborted) throw new Error('Pairing expired');
      } catch {
        if (!operation.signal.aborted && epoch === this.epoch && !this.disposed) { completed = true; receive(attempt, null, 'A connection was not confirmed. Check AIPOCH Connector in your running Open-Science workbench, then retry or continue browsing.'); }
      } finally { this.operations.delete(operation); }
    })();
    return () => { if (!completed) operation.abort(); };
  }
  async pause() {
    this.abandon();
    this.setMemory({ status: 'paused', message: 'Automatic connection is paused in this browser. Choose Connect to resume.', canForget: this.memory.canForget });
    const saved = this.identity ? await this.identity.setPaused(true) : true;
    if (!saved) {
      if (this.memory.status === 'paused') this.setMemory({ status: 'storage-unavailable', message: 'This page is disconnected, but the browser could not save the pause. Automatic restoration after reopening is not guaranteed.', canForget: this.memory.canForget });
      throw new Error('Browser pause could not be saved');
    }
  }
  async forget() {
    this.abandon();
    this.setMemory({ status: 'forgetting', message: 'Forgetting this browser and revoking its authorization…', canForget: false });
    let saved: Awaited<ReturnType<IdentityAccess['takeForRevocation']>> | undefined;
    let removalFailed = false;
    try { saved = await this.identity?.takeForRevocation(); } catch { removalFailed = true; }
    if (removalFailed || (!saved && this.identity?.warning)) {
      this.setMemory({ status: 'storage-unavailable', message: 'This page is disconnected. Removal of the saved browser identity could not be confirmed. Use authorization management in Open-Science to revoke it, then clear this website’s browser data.', canForget: true });
      return;
    }
    let revoked = false;
    if (saved?.identity.grant) {
      const operation = new AbortController(); this.operations.add(operation);
      try {
        const proof = await this.proof(saved.identity, 'revoke', operation.signal, saved.sign);
        const result = await this.json(`${proof.base}/revoke`, 'POST', undefined, proof.body, operation.signal);
        revoked = result.revoked === true;
      } catch (error) {
        revoked = error instanceof ConnectorHttpError && ['authorization_revoked', 'authorization_expired', 'authorization_unknown'].includes(error.code ?? '');
      } finally { saved.dispose(); this.operations.delete(operation); }
    }
    this.setMemory({ status: 'forgotten', message: revoked ? 'This browser was forgotten and its authorization was revoked.' : saved?.identity.grant ? 'This browser was forgotten locally. Connector revocation could not be confirmed; use authorization management in Open-Science to remove the saved authorization.' : 'This browser was forgotten. Any authorization not available here can be removed in Open-Science.', canForget: false });
  }
  private async checkIdentity(value: PrivateSession) {
    if (!value.credentialId) return true;
    const identity = await this.identity?.load();
    return !!identity && !identity.paused && identity.credentialId === value.credentialId && identity.grant?.grantId === value.grantId;
  }
  private heartbeat(value: PrivateSession) {
    value.timer = setTimeout(() => {
      void (async () => {
        if (!await this.checkIdentity(value)) throw new Error('Browser identity changed');
        return this.json('/v1/session', 'GET', value.token);
      })().then(result => {
        if (result.id !== value.session.id || result.hostReady !== true || result.expiresAt !== value.session.expiresAt) throw new Error('Session changed');
        value.verifiedAt = this.options.now();
        if (this.sessions.get(value.session.id) === value && !this.disposed) this.heartbeat(value);
      }).catch(() => {
        // An aborted heartbeat can settle after a pause and a newer connection.
        // Only the session that still owns this heartbeat may change its status.
        if (this.sessions.get(value.session.id) !== value || this.disposed) return;
        this.invalidate(value);
        if (value.grantId && !['paused', 'forgetting', 'forgotten'].includes(this.memory.status)) this.setMemory({ status: 'unreachable', message: 'The connection needs to be verified again. Saved authorization has not been forgotten.', canForget: true, retryable: true });
      });
    }, this.options.heartbeatInterval);
  }
  valid(session: Session) {
    const value = this.sessions.get(session.id);
    return !this.disposed && !session.demo && !!value && value.session.expiresAt === session.expiresAt && session.expiresAt > this.options.now() && this.options.now() - value.verifiedAt <= this.options.freshness;
  }
  private invalidate(value: PrivateSession) {
    if (this.sessions.get(value.session.id) !== value) return;
    this.sessions.delete(value.session.id); clearTimeout(value.timer);
    for (const [operation, session] of this.sends) if (session === value) operation.abort();
  }
  send(input: Request, receive: (receipt: Receipt) => void, fail: (message: string) => void): Cancel {
    const request = { ...input };
    const operation = new AbortController(); this.operations.add(operation);
    const startedAt = this.options.now(), deadline = performance.now() + this.options.receiptTimeout;
    let settled = false;
    const failOnce = () => {
      if (!settled && !operation.signal.aborted && !this.disposed) { settled = true; fail(unconfirmed); }
    };
    const timer = setTimeout(() => { failOnce(); operation.abort(); }, this.options.receiptTimeout);
    void (async () => {
      try {
        const current = this.sessions.get(request.sessionId);
        if (!current || !this.valid(current.session) || !await this.checkIdentity(current)) throw new Error('No current session');
        this.sends.set(operation, current);
        const active = () => !operation.signal.aborted && !this.disposed && this.sessions.get(request.sessionId) === current && this.valid(current.session);
        const remaining = () => Math.max(0, deadline - performance.now());
        const bytes = new TextEncoder().encode(request.content);
        if (bytes.byteLength > 256 * 1024) throw new ConnectorResponseError('Reference exceeds limit');
        const digest = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        if (!active()) return;
        const envelope = { protocolVersion: PROTOCOL, requestId: request.id, sessionId: request.sessionId, objectId: request.objectId, action: 'receive_reference', review: { format: 'aipoch-network-internal-review-1', content: request.content, sha256: digest } };
        if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > 260 * 1024) throw new ConnectorResponseError('Encoded reference exceeds limit');
        const accept = (result: Record<string, unknown>) => {
          if (result.protocolVersion !== PROTOCOL || result.requestId !== request.id || result.sessionId !== request.sessionId || result.objectId !== request.objectId || result.contentSha256 !== digest || result.outcome !== 'received' || !timestamp(result.receivedAt) || result.receivedAt < startedAt || result.receivedAt > this.options.now()) throw new ConnectorResponseError('Receipt mismatch');
          if (remaining() <= 0) throw new Error('Receipt wait expired');
          if (!settled && active()) { settled = true; receive({ ...request, outcome: 'received', receivedAt: result.receivedAt }); }
        };
        try {
          // Submission happens once. Every recovery request below is a read for this exact ID.
          const result = await this.json('/v1/references', 'POST', current.token, envelope, operation.signal, remaining());
          accept(result); return;
        } catch (error) {
          if (sessionFailure(error)) { this.invalidate(current); return; }
          if (!uncertain(error)) throw error;
        }
        while (active() && remaining() > 0) {
          try {
            const result = await this.json(`/v1/receipts/${encodeURIComponent(request.id)}`, 'GET', current.token, undefined, operation.signal, remaining());
            accept(result); return;
          } catch (error) {
            if (sessionFailure(error)) { this.invalidate(current); return; }
            if (!(error instanceof ConnectorHttpError && error.status === 404) && !uncertain(error)) throw error;
          }
          if (active() && remaining() > 0) await this.wait(operation.signal, remaining());
        }
        if (active()) throw new Error('Receipt wait expired');
      } catch { failOnce(); }
      finally { clearTimeout(timer); this.operations.delete(operation); this.sends.delete(operation); }
    })();
    return () => { settled = true; clearTimeout(timer); operation.abort(); };
  }
  disconnect(session: Session) {
    const value = this.sessions.get(session.id);
    if (value) { this.invalidate(value); void this.json('/v1/session', 'DELETE', value.token).catch(() => {}); }
  }
  dispose() {
    this.disposed = true;
    for (const value of this.sessions.values()) clearTimeout(value.timer);
    this.sessions.clear(); for (const operation of this.operations) operation.abort(); this.operations.clear();
    this.identityUnsubscribe?.(); this.identity?.dispose(); this.memoryListeners.clear();
  }
}
