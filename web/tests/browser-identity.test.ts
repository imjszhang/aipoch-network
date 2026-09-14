import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserIdentityStore, BROWSER_IDENTITY_CONTROL, type IdentityBackend, type IdentityChange, type IdentityChangeBus } from '../src/workbench/browser-identity.js';

class MemoryBackend implements IdentityBackend {
  value: unknown;
  failRead = false;
  failWrite = false;
  dropWrite = false;
  reads = 0;
  updates = 0;
  private queue: Promise<unknown> = Promise.resolve();
  async read() { this.reads++; await this.queue; if (this.failRead) throw new Error('Unavailable'); return structuredClone(this.value); }
  update(change: (current: unknown) => unknown) {
    this.updates++;
    const next = this.queue.then(() => {
      if (this.failWrite) throw new Error('Unavailable');
      const value = change(structuredClone(this.value));
      if (!this.dropWrite) this.value = structuredClone(value);
      return structuredClone(value);
    });
    this.queue = next.catch(() => {}); return next;
  }
}
class MemoryStorage {
  values = new Map<string, string>();
  fail = false;
  getItem(key: string) { if (this.fail) throw new Error('Blocked'); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error('Blocked'); this.values.set(key, value); }
}
class SharedBus {
  listeners = new Set<(change: IdentityChange) => void>();
  endpoint(): IdentityChangeBus {
    let receive: ((change: IdentityChange) => void) | undefined;
    return {
      publish: change => { for (const listener of this.listeners) if (listener !== receive) listener({ ...change, external: true }); },
      subscribe: listener => { receive = listener; this.listeners.add(listener); return () => this.listeners.delete(listener); },
    };
  }
}
function fixture() {
  const backend = new MemoryBackend(), storage = new MemoryStorage(), bus = new SharedBus();
  const create = () => new BrowserIdentityStore({ backend, storage, bus: bus.endpoint() });
  return { backend, storage, bus, create };
}
const grant = { connectorId: 'connector-installation', grantId: 'grant-1' };
const bytes = new TextEncoder().encode('a one-time server challenge');
const decode = (text: string) => new Uint8Array(Buffer.from(text, 'base64url'));

test('passive load never creates a key or a remembered grant', async t => {
  const environment = fixture(); const store = environment.create(); t.after(() => store.dispose());
  assert.equal(await store.load(), null); assert.equal(environment.backend.updates, 0); assert.equal(store.warning, '');
});

test('a saved nonextractable key reloads, signs P1363, and never enters public metadata or notifications', async t => {
  const environment = fixture(); const store = environment.create(); t.after(() => store.dispose());
  const events: IdentityChange[] = []; store.subscribe(event => events.push(event));
  const identity = await store.prepare(); assert.ok(identity);
  const stored = environment.backend.value as { privateKey: CryptoKey };
  assert.equal(stored.privateKey.extractable, false); assert.equal(stored.privateKey.type, 'private');
  await assert.rejects(crypto.subtle.exportKey('jwk', stored.privateKey));
  assert.equal('privateKey' in identity, false);
  assert.deepEqual(Object.keys(identity.publicKeyJwk).sort(), ['crv', 'kty', 'x', 'y']);
  assert.equal(await store.remember(identity.credentialId, grant, identity.revision), true);
  const reloaded = environment.create(); t.after(() => reloaded.dispose());
  const current = await reloaded.load(); assert.ok(current); assert.deepEqual(current.grant, grant);
  const signed = await reloaded.sign(current.credentialId, bytes); assert.ok(signed); assert.equal(decode(signed).length, 64);
  const verifier = await crypto.subtle.importKey('jwk', current.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, decode(signed), bytes), true);
  const publicData = JSON.stringify({ identity, current, events, storage: [...environment.storage.values] });
  assert.doesNotMatch(publicData, /privateKey|"d"|token|CryptoKey/);
  assert.ok(events.every(event => Object.keys(event).every(key => ['kind', 'revision', 'credentialId', 'external'].includes(key))));
});

test('concurrent first connections atomically choose the same durable key', async t => {
  const environment = fixture(); const first = environment.create(), second = environment.create(); t.after(() => { first.dispose(); second.dispose(); });
  const [a, b] = await Promise.all([first.prepare(), second.prepare()]);
  assert.ok(a); assert.ok(b); assert.equal(a.credentialId, b.credentialId); assert.deepEqual(a.publicKeyJwk, b.publicKeyJwk);
  assert.equal((await first.load())?.credentialId, a.credentialId);
});

test('write/readback failure offers no remembered identity and does not persist a bearer fallback', async t => {
  for (const failure of ['failRead', 'failWrite', 'dropWrite'] as const) await t.test(failure, async t => {
    const environment = fixture(); environment.backend[failure] = true; const store = environment.create(); t.after(() => store.dispose());
    assert.equal(await store.prepare(), null); assert.match(store.warning, /page only/); assert.equal(environment.storage.values.size, 0);
  });
});

test('a transient storage error preserves the existing identity for later recovery', async t => {
  const environment = fixture(); const store = environment.create(); t.after(() => store.dispose());
  const identity = await store.prepare(); assert.ok(identity); assert.equal(await store.remember(identity.credentialId, grant), true);
  environment.backend.failRead = true;
  assert.equal(await store.load(), null); assert.equal(await store.prepare(), null);
  environment.backend.failRead = false;
  assert.equal((await store.load())?.credentialId, identity.credentialId); assert.equal(store.warning, '');
});

test('blocked control storage fails closed even if IndexedDB remains available', async t => {
  const environment = fixture(); const store = environment.create(); t.after(() => store.dispose());
  const identity = await store.prepare(); assert.ok(identity);
  environment.storage.fail = true;
  assert.equal(await store.load(), null); assert.equal(await store.sign(identity.credentialId, bytes), null); assert.match(store.warning, /page only/);
});

test('disconnect pauses immediately across tabs and stays paused after reload until explicit resume', async t => {
  const environment = fixture(); const first = environment.create(), second = environment.create(); t.after(() => { first.dispose(); second.dispose(); });
  const identity = await first.prepare(); assert.ok(identity); assert.equal(await first.remember(identity.credentialId, grant), true);
  await second.load(); const events: IdentityChange[] = []; second.subscribe(change => events.push(change));
  const pausing = first.setPaused(true);
  assert.equal(events.at(-1)?.kind, 'pause'); assert.equal(events.at(-1)?.external, true);
  assert.equal(await second.sign(identity.credentialId, bytes), null); assert.equal(await pausing, true);
  const reloaded = environment.create(); t.after(() => reloaded.dispose());
  assert.equal((await reloaded.load())?.paused, true); assert.equal(await reloaded.sign(identity.credentialId, bytes), null);
  assert.equal(await reloaded.setPaused(false), true); assert.equal((await second.load())?.paused, false); assert.ok(await second.sign(identity.credentialId, bytes));
});

test('a failed pause write still leaves a durable guard that prevents next-page restoration', async t => {
  const environment = fixture(); const first = environment.create(); t.after(() => first.dispose());
  const identity = await first.prepare(); assert.ok(identity);
  environment.backend.failWrite = true;
  assert.equal(await first.setPaused(true), false);
  const reloaded = environment.create(); t.after(() => reloaded.dispose());
  assert.equal((await reloaded.load())?.paused, true); assert.equal(await reloaded.sign(identity.credentialId, bytes), null);
  environment.backend.failWrite = false;
  assert.equal(await reloaded.setPaused(false), true); assert.ok(await reloaded.sign(identity.credentialId, bytes));
});

test('forget removes key material, invalidates peers, and only explicit new pairing creates a new identity', async t => {
  const environment = fixture(); const first = environment.create(), second = environment.create(); t.after(() => { first.dispose(); second.dispose(); });
  const identity = await first.prepare(); assert.ok(identity); await second.load();
  assert.equal(await first.forget(), true); assert.equal(await second.load(), null); assert.equal(await second.sign(identity.credentialId, bytes), null);
  assert.deepEqual(Object.keys(environment.backend.value as object).sort(), ['paused', 'revision', 'version']);
  assert.equal(await second.setPaused(false), false); assert.equal(await second.load(), null);
  const fresh = await second.prepare(); assert.ok(fresh); assert.notEqual(fresh.credentialId, identity.credentialId); assert.equal(fresh.grant, undefined);
});

test('a failed delete leaves a durable forget guard and never revives the old key', async t => {
  const environment = fixture(); const store = environment.create(); t.after(() => store.dispose());
  const identity = await store.prepare(); assert.ok(identity); await store.remember(identity.credentialId, grant);
  environment.backend.failWrite = true;
  assert.equal(await store.forget(), false);
  const reloaded = environment.create(); t.after(() => reloaded.dispose());
  assert.equal(await reloaded.load(), null); assert.equal(await reloaded.setPaused(false), false);
  environment.backend.failWrite = false;
  const fresh = await reloaded.prepare(); assert.ok(fresh); assert.notEqual(fresh.credentialId, identity.credentialId); assert.equal(fresh.grant, undefined);
});

test('stale pairing approval cannot remember a grant after pause and resume', async t => {
  const environment = fixture(); const store = environment.create(); t.after(() => store.dispose());
  const identity = await store.prepare(); assert.ok(identity);
  await store.setPaused(true); await store.setPaused(false);
  assert.equal(await store.remember(identity.credentialId, grant, identity.revision), false); assert.equal((await store.load())?.grant, undefined);
  const resumed = await store.load(); assert.ok(resumed);
  assert.equal(await store.remember(resumed.credentialId, grant, resumed.revision), true);
});

test('a late key generation cannot undo a forget action', async t => {
  const environment = fixture(); let generated!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { generated = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const customCrypto = { randomUUID: () => crypto.randomUUID(), getRandomValues: crypto.getRandomValues.bind(crypto), subtle: new Proxy(crypto.subtle, {
    get(target, property) { if (property === 'generateKey') return async (...args: Parameters<SubtleCrypto['generateKey']>) => { generated(); await resume; return Reflect.apply(target.generateKey, target, args); }; const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value; },
  }) } as Crypto;
  const store = new BrowserIdentityStore({ ...environment, crypto: customCrypto, bus: environment.bus.endpoint() }); t.after(() => store.dispose());
  const preparing = store.prepare(); await started; await store.forget(); release();
  assert.equal(await preparing, null); assert.equal(await store.load(), null); assert.equal('privateKey' in (environment.backend.value as object), false);
});

test('corrupt or extractable keys and private JWK fields never become remembered', async t => {
  for (const mutation of ['extractable', 'wrong-key', 'private-jwk', 'unknown-version', 'invalid-coordinate'] as const) await t.test(mutation, async t => {
    const environment = fixture(); const store = environment.create(); t.after(() => store.dispose());
    const identity = await store.prepare(); assert.ok(identity);
    const raw = environment.backend.value as Record<string, any>;
    if (mutation === 'extractable') raw.privateKey = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])).privateKey;
    if (mutation === 'wrong-key') raw.privateKey = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])).privateKey;
    if (mutation === 'private-jwk') raw.publicKeyJwk.d = 'private-material';
    if (mutation === 'unknown-version') raw.version = 2;
    if (mutation === 'invalid-coordinate') raw.publicKeyJwk.x = 'invalid';
    assert.equal(await store.load(), null); assert.equal(await store.prepare(), null); assert.equal(await store.sign(identity.credentialId, bytes), null);
    assert.match(store.warning, /page only/);
  });
});

test('disposing a page leaves the durable authorization active', async t => {
  const environment = fixture(); const first = environment.create();
  const identity = await first.prepare(); assert.ok(identity); await first.remember(identity.credentialId, grant); first.dispose();
  const reloaded = environment.create(); t.after(() => reloaded.dispose());
  const current = await reloaded.load(); assert.ok(current); assert.equal(current.paused, false); assert.deepEqual(current.grant, grant);
  assert.ok(await reloaded.sign(current.credentialId, bytes)); assert.equal(JSON.parse(environment.storage.getItem(BROWSER_IDENTITY_CONTROL)!).mode, 'active');
});

test('a pause during an unfinished signature invalidates the proof even when signing cannot be aborted', async t => {
  const environment = fixture(); let started!: () => void, release!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  const proceed = new Promise<void>(resolve => { release = resolve; });
  const customCrypto = { randomUUID: () => crypto.randomUUID(), getRandomValues: crypto.getRandomValues.bind(crypto), subtle: new Proxy(crypto.subtle, {
    get(target, property) {
      if (property === 'sign') return async (...args: Parameters<SubtleCrypto['sign']>) => { if ((args[2] as Uint8Array).byteLength === bytes.byteLength) { started(); await proceed; } return Reflect.apply(target.sign, target, args); };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    },
  }) } as Crypto;
  const store = new BrowserIdentityStore({ ...environment, crypto: customCrypto, bus: environment.bus.endpoint() }); t.after(() => store.dispose());
  const identity = await store.prepare(); assert.ok(identity);
  const signing = store.sign(identity.credentialId, bytes); await pending; await store.setPaused(true); release();
  assert.equal(await signing, null);
});

test('a missing or changed durable control never passively restores a saved grant', async t => {
  const environment = fixture(); const store = environment.create(); t.after(() => store.dispose());
  const identity = await store.prepare(); assert.ok(identity); await store.remember(identity.credentialId, grant);
  const savedControl = environment.storage.getItem(BROWSER_IDENTITY_CONTROL)!;
  environment.storage.values.delete(BROWSER_IDENTITY_CONTROL);
  assert.equal(await store.load(), null); assert.equal(await store.sign(identity.credentialId, bytes), null);
  environment.storage.setItem(BROWSER_IDENTITY_CONTROL, JSON.stringify({ ...JSON.parse(savedControl), revision: 'stale-revision' }));
  assert.equal(await store.load(), null);
  environment.backend.value = undefined; environment.storage.values.clear();
  assert.equal(await store.load(), null);
  const fresh = await store.prepare(); assert.ok(fresh); assert.notEqual(fresh.credentialId, identity.credentialId); assert.equal(fresh.grant, undefined);
});

const origin = 'http://127.0.0.1:4186';
const now = 1_900_000_000_000;
const revokeChallenge = () => ['aipoch-browser-authorization', '1.0', grant.connectorId, origin, grant.grantId, 'revoke', 'challenge-1', 'nonce-1', now + 30_000];
const challengeBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test('forget provides one revoke-only proof after deleting the key and blocks all ordinary signatures', async t => {
  const environment = fixture(); const store = new BrowserIdentityStore({ ...environment, bus: environment.bus.endpoint(), origin, now: () => now }); t.after(() => store.dispose());
  const identity = await store.prepare(); assert.ok(identity); await store.remember(identity.credentialId, grant);
  await store.setPaused(true);
  const revocation = await store.takeForRevocation(); assert.ok(revocation);
  assert.equal('privateKey' in revocation.identity, false); assert.equal('privateKey' in (environment.backend.value as object), false);
  assert.equal(await store.load(), null); assert.equal(await store.sign(identity.credentialId, bytes), null);
  const proof = challengeBytes(revokeChallenge()); const signature = await revocation.sign(proof); assert.ok(signature);
  const verifier = await crypto.subtle.importKey('jwk', identity.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, decode(signature), proof), true);
  assert.equal(await revocation.sign(proof), null); revocation.dispose();
});

test('the ephemeral revocation signer rejects altered purpose, scope, expiry, or encoding and consumes that attempt', async t => {
  const changes = [
    (value: unknown[]) => { value[0] = 'other-domain'; },
    (value: unknown[]) => { value[1] = '2.0'; },
    (value: unknown[]) => { value[2] = 'other-connector'; },
    (value: unknown[]) => { value[3] = 'https://aipoch.network'; },
    (value: unknown[]) => { value[4] = 'other-grant'; },
    (value: unknown[]) => { value[5] = 'restore'; },
    (value: unknown[]) => { value[6] = ''; },
    (value: unknown[]) => { value[7] = 'invalid nonce'; },
    (value: unknown[]) => { value[8] = now; },
    (value: unknown[]) => { value[8] = now + 60_001; },
    (value: unknown[]) => { value[8] = now + 0.5; },
    (value: unknown[]) => { value.push('extra'); },
  ];
  for (const [index, change] of changes.entries()) await t.test(`scope ${index + 1}`, async t => {
    const environment = fixture(); const store = new BrowserIdentityStore({ ...environment, bus: environment.bus.endpoint(), origin, now: () => now }); t.after(() => store.dispose());
    const identity = await store.prepare(); assert.ok(identity); await store.remember(identity.credentialId, grant);
    const revocation = await store.takeForRevocation(); assert.ok(revocation);
    const altered = revokeChallenge(); change(altered);
    assert.equal(await revocation.sign(challengeBytes(altered)), null); assert.equal(await revocation.sign(challengeBytes(revokeChallenge())), null);
  });
  for (const formatting of ['space', 'disposed'] as const) await t.test(formatting, async t => {
    const environment = fixture(); const store = new BrowserIdentityStore({ ...environment, bus: environment.bus.endpoint(), origin, now: () => now }); t.after(() => store.dispose());
    const identity = await store.prepare(); assert.ok(identity); await store.remember(identity.credentialId, grant);
    const revocation = await store.takeForRevocation(); assert.ok(revocation);
    if (formatting === 'disposed') revocation.dispose();
    const data = new TextEncoder().encode(JSON.stringify(revokeChallenge()) + (formatting === 'space' ? ' ' : ''));
    assert.equal(await revocation.sign(data), null);
  });
});

test('no revoke proof escapes if durable key deletion fails', async t => {
  const environment = fixture(); const store = new BrowserIdentityStore({ ...environment, bus: environment.bus.endpoint(), origin, now: () => now }); t.after(() => store.dispose());
  const identity = await store.prepare(); assert.ok(identity); await store.remember(identity.credentialId, grant);
  environment.backend.failWrite = true;
  assert.equal(await store.takeForRevocation(), null); assert.equal(await store.load(), null); assert.match(store.warning, /page only/);
  const nextPage = environment.create(); t.after(() => nextPage.dispose());
  assert.equal(await nextPage.load(), null);
});
