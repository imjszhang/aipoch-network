export interface Session { id: string; expiresAt: number; demo: boolean }
export interface Request { id: string; sessionId: string; objectId: string; content: string }
export interface Receipt extends Request { outcome: 'received' | 'continue'; receivedAt: number }
export type Cancel = () => void;
export interface WorkbenchAdapter {
  readonly demo: boolean;
  connect(attempt: string, receive: (attempt: string, session: Session | null, reason?: string) => void): Cancel;
  send(request: Request, receive: (receipt: Receipt) => void, fail: (message: string) => void): Cancel;
  valid(session: Session): boolean;
  disconnect(session: Session): void;
  dispose(): void;
}
export class UnavailableAdapter implements WorkbenchAdapter {
  readonly demo = false;
  connect(attempt: string, receive: (attempt: string, session: Session | null, reason?: string) => void) {
    const timer = setTimeout(() => receive(attempt, null, 'This website cannot confirm an Open-Science connection yet. Continue browsing or use the complete manual reference. This does not tell us whether Open-Science is installed.'), 0);
    return () => clearTimeout(timer);
  }
  send(_request: Request, _receive: (receipt: Receipt) => void, fail: (message: string) => void) { fail('Reference transport is not available. Use the manual reference.'); return () => {}; }
  valid(_session: Session) { return false; }
  disconnect(_session: Session) {}
  dispose() {}
}
export type DemoOutcome = 'automatic' | 'manual' | 'silent' | 'failure' | 'continue';
/** Local preview only. This adapter never calls a client service or launches an application. */
export class DemoAdapter implements WorkbenchAdapter {
  readonly demo = true;
  connectionOutcome: DemoOutcome = 'automatic';
  receiptOutcome: DemoOutcome = 'automatic';
  private sessions = new Set<string>();
  private jobs = new Set<ReturnType<typeof setTimeout>>();
  private connection?: { attempt: string; receive: (attempt: string, session: Session | null, reason?: string) => void };
  private request?: { request: Request; receive: (receipt: Receipt) => void; fail: (message: string) => void };
  constructor(private delay = 650, private now = () => Date.now()) {}
  private schedule(fn: () => void) { const timer = setTimeout(() => { this.jobs.delete(timer); fn(); }, this.delay); this.jobs.add(timer); return () => { clearTimeout(timer); this.jobs.delete(timer); }; }
  connect(attempt: string, receive: (attempt: string, session: Session | null, reason?: string) => void) {
    this.connection = { attempt, receive };
    if (this.connectionOutcome === 'automatic') return this.schedule(() => this.confirmConnection(attempt));
    if (this.connectionOutcome === 'failure') return this.schedule(() => receive(attempt, null, 'Demo connection failed. No connection was confirmed. You can retry or continue browsing.'));
    return () => {};
  }
  confirmConnection(attempt = this.connection?.attempt) {
    if (!this.connection || !attempt) return;
    const session = { id: `demo-session-${attempt}`, expiresAt: this.now() + 30 * 60_000, demo: true };
    this.sessions.add(session.id);
    this.connection.receive(attempt, session);
  }
  send(request: Request, receive: (receipt: Receipt) => void, fail: (message: string) => void) {
    this.request = { request, receive, fail };
    if (this.receiptOutcome === 'automatic' || this.receiptOutcome === 'continue') return this.schedule(() => this.deliver({}, this.receiptOutcome === 'continue' ? 'continue' : 'received'));
    if (this.receiptOutcome === 'failure') return this.schedule(() => fail('Demo transport failed. Delivery is not confirmed; the workbench may already have received the reference.'));
    return () => {};
  }
  deliver(change: Partial<Request> = {}, outcome: Receipt['outcome'] = 'received') {
    if (this.request) this.request.receive({ ...this.request.request, ...change, outcome, receivedAt: this.now() });
  }
  valid(session: Session) { return session.demo && this.sessions.has(session.id) && session.expiresAt > this.now(); }
  disconnect(session: Session) { this.sessions.delete(session.id); }
  expire() { this.sessions.clear(); }
  dispose() { this.jobs.forEach(clearTimeout); this.jobs.clear(); this.sessions.clear(); this.connection = undefined; this.request = undefined; }
}
