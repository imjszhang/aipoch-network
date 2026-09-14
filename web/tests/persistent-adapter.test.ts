import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { BrowserIdentityStore, type IdentityBackend } from '../src/workbench/browser-identity.js';
import { RealAdapter } from '../src/workbench/real-adapter.js';
import type { Session } from '../src/workbench/adapter.js';

const origin = 'http://127.0.0.1:4186';
const connectorId = 'connector-test-identity';
const grantId = 'grant-test-identity';
const ttl = 7_776_000_000;
const crypto = webcrypto as unknown as Crypto;
class MemoryBackend implements IdentityBackend {
  value: unknown;
  async read() { return structuredClone(this.value); }
  async update(change: (value: unknown) => unknown) { this.value = structuredClone(change(this.value)); return structuredClone(this.value); }
}
function store(backend = new MemoryBackend()) {
  const values = new Map<string, string>();
  return new BrowserIdentityStore({ backend, crypto, origin, storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } } });
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const failure = (code: string, status = 401) => response({ error: { code, message: 'Fixture failure' } }, status);
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
async function until(predicate: () => boolean) { for (let i = 0; i < 500 && !predicate(); i++) await tick(); assert.ok(predicate()); }
function fixture(identity = store()) {
  const now = Date.now();
  let publicKey: CryptoKey | undefined, paired = 0, restored = 0, revoked = false, code: string | undefined, forgedChallenge = false;
  let releaseResume: (() => void) | undefined, holdResume = false;
  let releaseSession: (() => void) | undefined, holdSession = false, invalidVerification = false;
  let extensionOverride: unknown, overrideCapabilities = false, pairingPersistent = false;
  const deletedTokens: string[] = [];
  let afterVerification: (() => void) | undefined;
  const calls: string[] = [];
  const challenges = new Map<string, string>();
  const authorization = { id: grantId, connectorId, origin, browserName: 'Fixture browser', createdAt: now, lastUsedAt: now, expiresAt: now + ttl };
  const session = (suffix: string) => ({ id: `session-${suffix}`, token: `private-bearer-${suffix}`, expiresAt: now + 1_800_000, protocolVersion: '1.0' });
  const fetcher = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname; calls.push(path);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (path === '/v1/capabilities' && overrideCapabilities) return response(extensionOverride);
    if (path === '/v1/capabilities') return response({ protocolVersion: '1.0', persistentAuthorization: { version: '1.0', connectorId, algorithm: 'ECDSA-P256-SHA256', idleTtlMs: ttl, challengeTtlMs: 60_000 } });
    if (path === '/v1/pairings') {
      paired++;
      pairingPersistent = !!body.browserAuthorization;
      if (pairingPersistent) publicKey = await crypto.subtle.importKey('jwk', body.browserAuthorization.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
      return response({ pairingId: 'pairing-test', pollToken: 'private-poll-token', verificationCode: '123456', expiresAt: now + 180_000 });
    }
    if (path === '/v1/pairings/pairing-test') return response({ status: 'approved', session: session(paired === 1 ? 'paired' : `paired-${paired}`), ...(pairingPersistent ? { authorization } : {}) });
    if (path === '/v1/session') {
      if (init.method === 'DELETE') { deletedTokens.push(new Headers(init.headers).get('Authorization') ?? ''); return response({ disconnected: true }); }
      if (holdSession) await new Promise<void>(resolve => { releaseSession = resolve; });
      if (revoked) return failure('authorization_revoked');
      const token = new Headers(init.headers).get('Authorization');
      const suffix = token?.slice('Bearer private-bearer-'.length);
      afterVerification?.();
      return response({ id: invalidVerification ? 'different-session' : `session-${suffix}`, expiresAt: now + 1_800_000, hostReady: true, authorizationId: grantId });
    }
    if (path.endsWith('/challenge')) {
      if (code && code !== 'authorized_host_unavailable') return failure(code);
      const id = crypto.randomUUID();
      const challenge = JSON.stringify(['aipoch-browser-authorization', '1.0', connectorId, forgedChallenge ? 'https://other.example' : origin, grantId, body.purpose, id, crypto.randomUUID(), now + 60_000]);
      challenges.set(id, challenge);
      return response({ challengeId: id, challenge, expiresAt: now + 60_000 });
    }
    if (path.endsWith('/resume') || path.endsWith('/revoke')) {
      const challenge = challenges.get(body.challengeId); assert.ok(challenge); challenges.delete(body.challengeId);
      assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey!, Buffer.from(body.signature, 'base64url'), new TextEncoder().encode(challenge)));
      if (path.endsWith('/revoke')) { revoked = true; return response({ revoked: true }); }
      restored++;
      if (holdResume) await new Promise<void>(resolve => { releaseResume = resolve; });
      if (code) return failure(code, 503);
      return response({ session: session(`restored-${restored}`), authorization });
    }
    throw new Error(`Unexpected fixture request ${path}`);
  }) as typeof fetch;
  const adapter = new RealAdapter({ identity, origin, fetch: fetcher, now: () => now, heartbeatInterval: 60_000 });
  return { adapter, identity, calls, fetcher, now, deletedTokens,
    capabilities: (value: unknown) => { extensionOverride = value; overrideCapabilities = true; },
    holdSession: () => { holdSession = true; }, sessionPending: () => !!releaseSession, releaseSession: () => releaseSession?.(),
    badVerification: () => { invalidVerification = true; }, afterVerification: (callback: () => void) => { afterVerification = callback; },
    pairCount: () => paired, restoreCount: () => restored, revoked: () => revoked,
    fail: (value?: string) => { code = value; }, forge: () => { forgedChallenge = true; }, hold: () => { holdResume = true; }, pending: () => !!releaseResume, release: () => releaseResume?.() };
}
const connect = (adapter: RealAdapter) => new Promise<Session | null>(resolve => adapter.connect('attempt-fixture', (_id, value) => resolve(value)));
const restore = (adapter: RealAdapter) => new Promise<Session | null>(resolve => adapter.restore('restore-fixture', (_id, value) => resolve(value)));

test('approved persistent identity survives a new adapter and restores a verified short session without pairing again', async t => {
  const f = fixture(); t.after(() => f.adapter.dispose());
  const first = await connect(f.adapter); assert.ok(first); assert.equal(f.adapter.getMemory().status, 'remembered');
  const saved = await f.identity.load(); assert.equal(saved?.grant?.grantId, grantId);
  assert.equal(JSON.stringify(saved).includes('private-bearer'), false);
  const next = new RealAdapter({ identity: f.identity, origin, fetch: f.fetcher, now: () => f.now, heartbeatInterval: 60_000 }); t.after(() => next.dispose());
  const recovered = await restore(next); assert.ok(recovered); assert.notEqual(recovered.id, first.id); assert.equal(next.valid(recovered), true);
  assert.equal(f.pairCount(), 1); assert.equal(f.restoreCount(), 1);
  assert.equal(f.calls.some(path => path.includes('/references')), false);
});

test('automatic restore never generates a key or initiates pairing when there is no saved authorization', async t => {
  const f = fixture(); t.after(() => f.adapter.dispose());
  assert.equal(await restore(f.adapter), null); assert.deepEqual(f.calls, []); assert.equal(await f.identity.load(), null);
});

test('pause invalidates current sessions, survives restore, and explicit connect resumes the remembered identity', async t => {
  const f = fixture(); t.after(() => f.adapter.dispose());
  const first = await connect(f.adapter); assert.ok(first);
  await f.adapter.pause(); assert.equal(f.adapter.valid(first), false); assert.equal((await f.identity.load())?.paused, true);
  assert.equal(await restore(f.adapter), null); assert.equal(f.restoreCount(), 0); assert.equal(f.adapter.getMemory().status, 'paused');
  assert.ok(await connect(f.adapter)); assert.equal(f.pairCount(), 1); assert.equal(f.restoreCount(), 1);
});

test('verified unavailable host preserves authorization; revoked authorization never silently pairs', async t => {
  const f = fixture(); t.after(() => f.adapter.dispose()); await connect(f.adapter);
  f.fail('authorized_host_unavailable'); assert.equal(await restore(f.adapter), null);
  assert.equal(f.adapter.getMemory().status, 'host-unavailable'); assert.ok((await f.identity.load())?.grant);
  f.fail('authorization_revoked'); assert.equal(await restore(f.adapter), null);
  assert.equal(f.adapter.getMemory().status, 'reauthorize'); assert.equal(f.pairCount(), 1);
});

test('restore refuses to sign a challenge with a different origin', async t => {
  const f = fixture(); t.after(() => f.adapter.dispose()); await connect(f.adapter); f.forge();
  assert.equal(await restore(f.adapter), null); assert.equal(f.restoreCount(), 0);
});

test('pause wins a delayed restore and no late callback installs a session', async t => {
  const f = fixture(); t.after(() => f.adapter.dispose()); await connect(f.adapter); f.hold();
  let callbacks = 0; f.adapter.restore('delayed', () => { callbacks++; }); await until(f.pending);
  await f.adapter.pause(); f.release(); await tick(); await tick();
  assert.equal(callbacks, 0); assert.equal(f.adapter.getMemory().status, 'paused');
});

test('forget deletes local identity and uses a revoke-only proof without a bearer credential', async t => {
  const f = fixture(); t.after(() => f.adapter.dispose()); const session = await connect(f.adapter); assert.ok(session);
  await f.adapter.forget(); assert.equal(await f.identity.load(), null); assert.equal(f.revoked(), true);
  assert.equal(f.adapter.valid(session), false); assert.equal(f.adapter.getMemory().status, 'forgotten');
  assert.match(f.adapter.getMemory().message, /authorization was revoked/);
  assert.equal(await restore(f.adapter), null); assert.equal(f.pairCount(), 1);
});


for (const [name, value] of [
  ['missing extension', { protocolVersion: '1.0' }],
  ['null extension', { protocolVersion: '1.0', persistentAuthorization: null }],
  ['array extension', { protocolVersion: '1.0', persistentAuthorization: [] }],
  ['string extension', { protocolVersion: '1.0', persistentAuthorization: 'unsupported' }],
  ['unknown extension version', { protocolVersion: '1.0', persistentAuthorization: { version: '9.0' } }],
] as const) test(`a remembered identity with ${name} falls back to explicit session-only pairing`, async t => {
  const f = fixture(); t.after(() => f.adapter.dispose()); assert.ok(await connect(f.adapter));
  f.capabilities(value);
  assert.equal(await restore(f.adapter), null); assert.equal(f.adapter.getMemory().status, 'unsupported');
  assert.equal(f.pairCount(), 1, 'automatic restoration must not pair');
  assert.ok(await connect(f.adapter)); assert.equal(f.pairCount(), 2); assert.equal(f.restoreCount(), 0);
  assert.equal(f.adapter.getMemory().status, 'unsupported');
});

test('failed durable pause still invalidates this page and reports that reopening may reconnect', async t => {
  const f = fixture(); t.after(() => f.adapter.dispose()); const session = await connect(f.adapter); assert.ok(session);
  f.identity.setPaused = async () => false;
  await assert.rejects(f.adapter.pause(), /could not be saved/);
  assert.equal(f.adapter.valid(session), false); assert.equal(f.adapter.getMemory().status, 'storage-unavailable');
  assert.match(f.adapter.getMemory().message, /could not save the pause/);
  assert.match(f.adapter.getMemory().message, /not guaranteed/);
});

for (const mode of ['reported failure', 'thrown failure'] as const) test(`forget with ${mode} does not claim local removal or remote revocation`, async t => {
  const f = fixture(); t.after(() => f.adapter.dispose()); const session = await connect(f.adapter); assert.ok(session);
  f.identity.takeForRevocation = async () => {
    if (mode === 'thrown failure') throw new Error('Storage failed');
    f.identity.warning = 'Storage failed'; return null;
  };
  await f.adapter.forget();
  assert.equal(f.adapter.valid(session), false); assert.equal(f.revoked(), false);
  assert.equal(f.adapter.getMemory().status, 'storage-unavailable'); assert.equal(f.adapter.getMemory().canForget, true);
  assert.match(f.adapter.getMemory().message, /Removal.*could not be confirmed/);
  assert.equal(f.adapter.getMemory().message.includes('was forgotten'), false);
});

for (const action of ['pause', 'forget'] as const) test(`${action} during session verification retires the unused candidate token`, async t => {
  const f = fixture(); t.after(() => f.adapter.dispose()); assert.ok(await connect(f.adapter)); f.holdSession();
  let callbacks = 0; f.adapter.restore('verification-race', () => { callbacks++; }); await until(f.sessionPending);
  if (action === 'pause') await f.adapter.pause(); else await f.adapter.forget();
  await until(() => f.deletedTokens.includes('Bearer private-bearer-restored-1'));
  f.releaseSession(); await tick(); await tick();
  assert.equal(callbacks, 0); assert.equal(f.adapter.getMemory().status, action === 'pause' ? 'paused' : 'forgotten');
});

test('repeated pause notifications cannot abort bounded cleanup of installed or unused candidate sessions', async t => {
  const f = fixture(); t.after(() => f.adapter.dispose());
  const cleanupSignals = new Map<string, AbortSignal>();
  let releaseCleanup!: () => void;
  const gate = new Promise<void>(resolve => { releaseCleanup = resolve; });
  const fetcher = (async (url: string | URL | Request, init: RequestInit = {}) => {
    if (new URL(String(url)).pathname === '/v1/session' && init.method === 'DELETE') {
      cleanupSignals.set(new Headers(init.headers).get('Authorization')!, init.signal!);
      await gate;
      if (init.signal?.aborted) throw new Error('Cleanup was aborted before network delivery');
    }
    return f.fetcher(url, init);
  }) as typeof fetch;
  const adapter = new RealAdapter({ identity: f.identity, origin, fetch: fetcher, now: () => f.now, heartbeatInterval: 60_000 });
  t.after(() => { releaseCleanup(); f.releaseSession(); adapter.dispose(); });
  assert.ok(await connect(adapter)); f.holdSession();
  let callbacks = 0; adapter.restore('repeated-pause-race', () => { callbacks++; }); await until(f.sessionPending);
  await adapter.pause(); await until(() => cleanupSignals.has('Bearer private-bearer-restored-1'));
  await adapter.pause();
  assert.equal(cleanupSignals.size, 2);
  assert.ok([...cleanupSignals.values()].every(signal => !signal.aborted), 'Pause may stop normal operations, but must let each bounded cleanup finish');
  releaseCleanup(); await until(() => f.deletedTokens.includes('Bearer private-bearer-paired') && f.deletedTokens.includes('Bearer private-bearer-restored-1'));
  f.releaseSession(); await tick(); await tick(); assert.equal(callbacks, 0); assert.equal(adapter.getMemory().status, 'paused');
});

test('session verification mismatch retires the candidate but preserves the installed session', async t => {
  const f = fixture(); t.after(() => f.adapter.dispose()); const first = await connect(f.adapter); assert.ok(first);
  f.badVerification(); assert.equal(await restore(f.adapter), null);
  await until(() => f.deletedTokens.includes('Bearer private-bearer-restored-1'));
  assert.equal(f.deletedTokens.includes('Bearer private-bearer-paired'), false); assert.equal(f.adapter.valid(first), true);
});

test('identity revision mismatch after verification retires the unused candidate', async t => {
  const f = fixture(); t.after(() => f.adapter.dispose()); assert.ok(await connect(f.adapter));
  const load = f.identity.load.bind(f.identity); let changed = false;
  f.afterVerification(() => { changed = true; });
  f.identity.load = async () => { const identity = await load(); return identity && changed ? { ...identity, revision: 'changed-revision' } : identity; };
  assert.equal(await restore(f.adapter), null);
  await until(() => f.deletedTokens.includes('Bearer private-bearer-restored-1'));
});

for (const failure of ['remember write', 'remember readback'] as const) test(`${failure} failure retires a newly approved candidate`, async t => {
  const f = fixture(); t.after(() => f.adapter.dispose());
  if (failure === 'remember write') f.identity.remember = async () => false;
  else {
    const remember = f.identity.remember.bind(f.identity), load = f.identity.load.bind(f.identity); let saved = false;
    f.identity.remember = async (...args) => { const result = await remember(...args); saved = true; return result; };
    f.identity.load = async () => { const identity = await load(); return identity && saved ? { ...identity, grant: undefined } : identity; };
  }
  assert.equal(await connect(f.adapter), null); await until(() => f.deletedTokens.includes('Bearer private-bearer-paired'));
});

test('an abandoned heartbeat timeout cannot replace the memory status of a newly restored session', async t => {
  const f = fixture();
  let holdHeartbeat = false, oldHeartbeatStarted = false;
  const fetcher = (async (url, init = {}) => {
    if (new URL(String(url)).pathname === '/v1/session' && init.method === 'GET' &&
      new Headers(init.headers).get('Authorization') === 'Bearer private-bearer-paired' && holdHeartbeat) {
      oldHeartbeatStarted = true;
      // Exercise a transport that neither returns nor rejects when aborted.
      return await new Promise<Response>(() => {});
    }
    return f.fetcher(url, init);
  }) as typeof fetch;
  const adapter = new RealAdapter({ identity: f.identity, origin, fetch: fetcher, now: () => f.now, heartbeatInterval: 5, requestTimeout: 80 });
  t.after(() => { adapter.dispose(); f.adapter.dispose(); });
  assert.ok(await connect(adapter)); holdHeartbeat = true; await until(() => oldHeartbeatStarted);
  await adapter.pause(); holdHeartbeat = false;
  const restored = await connect(adapter); assert.ok(restored); assert.equal(adapter.getMemory().status, 'remembered');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(adapter.valid(restored), true);
  assert.equal(adapter.getMemory().status, 'remembered');
});
