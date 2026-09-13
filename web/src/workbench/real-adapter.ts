import type { Cancel, PairingProgress, Receipt, Request, Session, WorkbenchAdapter } from './adapter.js';

const PROTOCOL = '1.0';
export const CONNECTOR_ENDPOINT = 'http://127.0.0.1:47821';
export const REAL_REFERENCE_WAIT_MS = 60_000;
interface PrivateSession { session: Session; token: string; verifiedAt: number; timer?: ReturnType<typeof setTimeout> }
interface Options { fetch?: typeof fetch; now?: () => number; endpoint?: string; requestTimeout?: number; receiptTimeout?: number; pollInterval?: number; heartbeatInterval?: number; freshness?: number }
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

/** Independent browser transport. Tokens never enter UI state, storage, URLs, or references. */
export class RealAdapter implements WorkbenchAdapter {
  readonly demo = false;
  private sessions = new Map<string, PrivateSession>();
  private operations = new Set<AbortController>();
  private sends = new Map<AbortController, PrivateSession>();
  private disposed = false;
  private readonly options: Required<Options>;
  constructor(options: Options = {}) {
    const endpoint = options.endpoint ?? CONNECTOR_ENDPOINT;
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Connector endpoint must be an explicit loopback HTTP origin');
    this.options = { fetch: options.fetch ?? globalThis.fetch.bind(globalThis), now: options.now ?? Date.now, endpoint: url.origin, requestTimeout: options.requestTimeout ?? 8000, receiptTimeout: options.receiptTimeout ?? REAL_REFERENCE_WAIT_MS, pollInterval: options.pollInterval ?? 1000, heartbeatInterval: options.heartbeatInterval ?? 5000, freshness: options.freshness ?? 15000 };
  }
  private async json(path: string, method: string, token?: string, body?: unknown, signal?: AbortSignal, remaining = this.options.requestTimeout): Promise<Record<string, unknown>> {
    const operation = new AbortController(); this.operations.add(operation);
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
  connect(attempt: string, receive: (attempt: string, session: Session | null, reason?: string) => void, progress?: (attempt: string, pairing: PairingProgress) => void): Cancel {
    const operation = new AbortController(); this.operations.add(operation); let completed = false;
    void (async () => {
      try {
        if (this.disposed) throw new Error('Disposed');
        const pairing = await this.json('/v1/pairings', 'POST', undefined, { protocolVersion: PROTOCOL, attemptId: attempt }, operation.signal);
        if (!bounded(pairing.pairingId) || !bounded(pairing.pollToken) || typeof pairing.verificationCode !== 'string' || !/^[A-Za-z0-9 -]{4,32}$/.test(pairing.verificationCode) || !timestamp(pairing.expiresAt) || pairing.expiresAt <= this.options.now()) throw new Error('Invalid pairing');
        const expiresAt = Math.min(pairing.expiresAt, this.options.now() + 180000);
        if (operation.signal.aborted) return;
        progress?.(attempt, { verificationCode: pairing.verificationCode, expiresAt });
        while (!operation.signal.aborted && this.options.now() < expiresAt) {
          const result = await this.json(`/v1/pairings/${encodeURIComponent(pairing.pairingId)}`, 'GET', pairing.pollToken, undefined, operation.signal);
          if (result.status === 'approved') {
            const candidate = record(result.session);
            if (candidate.protocolVersion !== PROTOCOL || !bounded(candidate.id) || !bounded(candidate.token) || !timestamp(candidate.expiresAt) || candidate.expiresAt <= this.options.now()) throw new Error('Unsupported session');
            const verified = await this.json('/v1/session', 'GET', candidate.token, undefined, operation.signal);
            if (verified.id !== candidate.id || verified.hostReady !== true || verified.expiresAt !== candidate.expiresAt) throw new Error('Workbench not ready');
            if (operation.signal.aborted || this.disposed) return;
            const session: Session = { id: candidate.id, expiresAt: candidate.expiresAt, demo: false };
            const value: PrivateSession = { session, token: candidate.token, verifiedAt: this.options.now() };
            this.sessions.set(session.id, value); this.heartbeat(value);
            completed = true; receive(attempt, session); return;
          }
          if (result.status !== 'pending') throw new Error('Pairing was not approved');
          await this.wait(operation.signal);
        }
        if (!operation.signal.aborted) throw new Error('Pairing expired');
      } catch {
        if (!operation.signal.aborted && !this.disposed) { completed = true; receive(attempt, null, 'A connection was not confirmed. Check AIPOCH Connector in your running Open-Science workbench, then retry or continue browsing.'); }
      } finally { this.operations.delete(operation); }
    })();
    return () => { if (!completed) operation.abort(); };
  }
  private heartbeat(value: PrivateSession) {
    value.timer = setTimeout(() => {
      void this.json('/v1/session', 'GET', value.token).then(result => {
        if (result.id !== value.session.id || result.hostReady !== true || result.expiresAt !== value.session.expiresAt) throw new Error('Session changed');
        value.verifiedAt = this.options.now();
        if (this.sessions.get(value.session.id) === value && !this.disposed) this.heartbeat(value);
      }).catch(() => this.invalidate(value));
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
        if (!current || !this.valid(current.session)) throw new Error('No current session');
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
  }
}
