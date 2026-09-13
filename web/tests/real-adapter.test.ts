import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RealAdapter } from '../src/workbench/real-adapter.js';
import type { PairingProgress, Receipt, Request as ReferenceRequest, Session } from '../src/workbench/adapter.js';

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const time = 1900000000000;
const session = { id: 'session-1', token: 'secret-session-token', expiresAt: time + 1800000, protocolVersion: '1.0' };
const request: ReferenceRequest = { id: 'request-1', sessionId: session.id, objectId: 'project:example', content: '{"title":"研究", "sources":[]}\n' };
const digest = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
const expectedReceipt = () => ({ protocolVersion: '1.0', requestId: request.id, sessionId: session.id, objectId: request.objectId, contentSha256: digest(request.content), outcome: 'received', receivedAt: time });
function transport(handler?: (path: string, init: RequestInit) => Response | Promise<Response> | undefined): typeof fetch {
  return (async (url: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname;
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.cache, 'no-store');
    const custom = handler?.(path, init); if (custom !== undefined) return custom;
    if (path === '/v1/pairings') { assert.deepEqual(JSON.parse(String(init.body)), { protocolVersion: '1.0', attemptId: 'attempt-1' }); return response({ pairingId: 'pairing-1', pollToken: 'secret-poll-token', verificationCode: '123 456', expiresAt: time + 180000 }); }
    if (path === '/v1/pairings/pairing-1') { assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer secret-poll-token'); return response({ status: 'approved', session }); }
    if (path === '/v1/session') { assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${session.token}`); return init.method === 'DELETE' ? new Response(null, { status: 204 }) : response({ id: session.id, expiresAt: session.expiresAt, hostReady: true }); }
    if (path === '/v1/references') return response(expectedReceipt());
    throw new Error('Unexpected endpoint');
  }) as typeof fetch;
}
function connect(adapter: RealAdapter, progress?: (attempt: string, value: PairingProgress) => void) {
  return new Promise<Session | null>(resolve => adapter.connect('attempt-1', (_attempt, value) => resolve(value), progress));
}
function send(adapter: RealAdapter) {
  return new Promise<Receipt | string>(resolve => adapter.send(request, resolve, resolve));
}

test('real pairing verifies the live host, keeps credentials private and sends exact reviewed bytes once', async t => {
  const calls: string[] = [];
  const adapter = new RealAdapter({ now: () => time, fetch: transport((path, init) => {
    calls.push(path);
    if (path === '/v1/references') {
      assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${session.token}`);
      assert.deepEqual(JSON.parse(String(init.body)), { protocolVersion: '1.0', requestId: request.id, sessionId: request.sessionId, objectId: request.objectId, action: 'receive_reference', review: { format: 'aipoch-network-internal-review-1', content: request.content, sha256: digest(request.content) } });
    }
  }) }); t.after(() => adapter.dispose());
  let progress: PairingProgress | undefined;
  const connected = await connect(adapter, (attempt, value) => { assert.equal(attempt, 'attempt-1'); progress = value; });
  assert.deepEqual(progress, { verificationCode: '123 456', expiresAt: time + 180000 });
  assert.deepEqual(connected, { id: session.id, expiresAt: session.expiresAt, demo: false });
  assert.ok(adapter.valid(connected!)); assert.deepEqual(calls, ['/v1/pairings', '/v1/pairings/pairing-1', '/v1/session']);
  assert.deepEqual(await send(adapter), { ...request, outcome: 'received', receivedAt: time });
  assert.equal(calls.filter(path => path === '/v1/references').length, 1);
  adapter.disconnect(connected!); assert.equal(adapter.valid(connected!), false);
});

test('pairing denial, unsupported versions and an unready host never become connected', async t => {
  for (const [path, result] of [
    ['/v1/pairings/pairing-1', { status: 'denied' }],
    ['/v1/pairings/pairing-1', { status: 'approved', session: { ...session, protocolVersion: '2.0' } }],
    ['/v1/session', { id: session.id, expiresAt: session.expiresAt, hostReady: false }],
  ] as const) await t.test(path + JSON.stringify(result), async t => {
    const adapter = new RealAdapter({ now: () => time, fetch: transport(candidate => candidate === path ? response(result) : undefined) }); t.after(() => adapter.dispose());
    assert.equal(await connect(adapter), null);
    assert.equal(adapter.valid({ id: session.id, expiresAt: session.expiresAt, demo: false }), false);
  });
});

test('each mismatched receipt is unconfirmed, without automatic resend', async t => {
  for (const change of [{ protocolVersion: '2.0' }, { requestId: 'other' }, { sessionId: 'other' }, { objectId: 'other' }, { contentSha256: digest(request.content.trim()) }, { outcome: 'executed' }, { receivedAt: null }]) await t.test(JSON.stringify(change), async t => {
    let sends = 0;
    const adapter = new RealAdapter({ now: () => time, fetch: transport(path => { if (path === '/v1/references') { sends++; return response({ ...expectedReceipt(), ...change }); } }) }); t.after(() => adapter.dispose());
    await connect(adapter); assert.match(String(await send(adapter)), /unconfirmed/); assert.equal(sends, 1);
  });
});

test('cancelling a send ignores a late receipt even when fetch cannot abort', async t => {
  let complete: ((value: Response) => void) | undefined;
  const adapter = new RealAdapter({ now: () => time, fetch: transport(path => path === '/v1/references' ? new Promise<Response>(resolve => { complete = resolve; }) : undefined) }); t.after(() => adapter.dispose());
  await connect(adapter); let callbacks = 0;
  const cancel = adapter.send(request, () => callbacks++, () => callbacks++);
  while (!complete) await new Promise(resolve => setTimeout(resolve, 1));
  cancel(); complete(response(expectedReceipt())); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(callbacks, 0);
});

test('freshness and failed heartbeats invalidate connection without persisted credentials', async t => {
  let now = time, checks = 0;
  const adapter = new RealAdapter({ now: () => now, heartbeatInterval: 5, freshness: 20, fetch: transport(path => { if (path === '/v1/session' && ++checks > 1) return response({ error: { message: 'private diagnostic' } }, 503); }) }); t.after(() => adapter.dispose());
  const connected = await connect(adapter); assert.ok(adapter.valid(connected!));
  now += 21; assert.equal(adapter.valid(connected!), false);
  await new Promise(resolve => setTimeout(resolve, 15)); now = time;
  assert.equal(adapter.valid(connected!), false);
});

test('only an explicit loopback origin is accepted and network waits are bounded', async t => {
  for (const endpoint of ['https://evil.example', 'http://127.0.0.1:47821/path', 'http://token@127.0.0.1:47821', 'http://127.0.0.1:47821/?token=secret']) assert.throws(() => new RealAdapter({ endpoint }));
  const adapter = new RealAdapter({ requestTimeout: 5, fetch: (async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('Timeout'))))) as typeof fetch }); t.after(() => adapter.dispose());
  assert.equal(await connect(adapter), null);
});

test('reference and encoded-envelope limits count UTF-8 bytes and JSON escaping before any send', async t => {
  for (const content of ['研'.repeat(87382), '\n'.repeat(140000)]) await t.test(content[0] === '研' ? 'multibyte content' : 'escaped envelope', async t => {
    let sends = 0;
    const adapter = new RealAdapter({ now: () => time, fetch: transport(path => { if (path === '/v1/references') sends++; }) }); t.after(() => adapter.dispose());
    await connect(adapter);
    const result = await new Promise<Receipt | string>(resolve => adapter.send({ ...request, content }, resolve, resolve));
    assert.match(String(result), /unconfirmed/); assert.equal(sends, 0);
  });
});
