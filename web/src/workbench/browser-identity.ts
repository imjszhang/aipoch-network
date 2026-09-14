/** Browser proof keys are local to this origin. No pairing or session bearer token is persisted. */
export interface BrowserPublicKey { kty: 'EC'; crv: 'P-256'; x: string; y: string }
export interface BrowserGrant { connectorId: string; grantId: string }
export interface BrowserIdentity {
  version: 1; credentialId: string; publicKeyJwk: BrowserPublicKey;
  grant?: BrowserGrant; paused: boolean; revision: string;
}
export interface BrowserRevocation {
  identity: BrowserIdentity;
  sign(bytes: Uint8Array): Promise<string | null>;
  dispose(): void;
}
interface StoredIdentity extends BrowserIdentity { privateKey: CryptoKey }
interface Tombstone { version: 1; paused: true; revision: string }
export interface IdentityChange {
  kind: 'pause' | 'resume' | 'forget' | 'changed'; credentialId?: string; revision: string; external: boolean;
}
/** update must synchronously read and replace one record in a single read/write transaction. */
export interface IdentityBackend {
  read(): Promise<unknown>;
  update(change: (current: unknown) => unknown): Promise<unknown>;
  close?(): void;
}
export interface IdentityChangeBus {
  publish(change: IdentityChange): void;
  subscribe(listener: (change: IdentityChange) => void): () => void;
  close?(): void;
}
interface Control { version: 1; mode: 'active' | 'pause' | 'forget'; revision: string; credentialId?: string }
interface Options {
  backend?: IdentityBackend;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  bus?: IdentityChangeBus;
  crypto?: Crypto;
  origin?: string;
  now?: () => number;
}
export const BROWSER_IDENTITY_DATABASE = 'aipoch-network-browser-identity-v1';
export const BROWSER_IDENTITY_CONTROL = 'aipoch-network:browser-identity-control:v1';
const warning = 'This browser could not safely save or read its authorization. A connection can still be approved for this page only.';
const bounded = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,256}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const coordinate = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) && 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(value.at(-1)!) % 4 === 0;
const publicJwk = (value: unknown): value is BrowserPublicKey => object(value) && exact(value, ['kty', 'crv', 'x', 'y']) &&
  value.kty === 'EC' && value.crv === 'P-256' && coordinate(value.x) && coordinate(value.y);
const grant = (value: unknown): value is BrowserGrant => object(value) && exact(value, ['connectorId', 'grantId']) && bounded(value.connectorId) && bounded(value.grantId);
function stored(value: unknown): value is StoredIdentity {
  if (!object(value) || !exact(value, ['version', 'credentialId', 'publicKeyJwk', 'grant', 'paused', 'revision', 'privateKey']) || value.version !== 1 || !bounded(value.credentialId) || !bounded(value.revision) || typeof value.paused !== 'boolean' || !publicJwk(value.publicKeyJwk) || (value.grant !== undefined && !grant(value.grant))) return false;
  const key = value.privateKey as CryptoKey | undefined;
  return !!key && key.type === 'private' && key.extractable === false && key.algorithm?.name === 'ECDSA' &&
    (key.algorithm as EcKeyAlgorithm).namedCurve === 'P-256' && key.usages.length === 1 && key.usages[0] === 'sign';
}
const tombstone = (value: unknown): value is Tombstone => object(value) && exact(value, ['version', 'paused', 'revision']) && value.version === 1 && value.paused === true && bounded(value.revision);
function visible(value: StoredIdentity): BrowserIdentity {
  return { version: 1, credentialId: value.credentialId, publicKeyJwk: { ...value.publicKeyJwk }, ...(value.grant ? { grant: { ...value.grant } } : {}), paused: value.paused, revision: value.revision };
}
function base64url(value: Uint8Array): string {
  return btoa(Array.from(value, byte => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

class IndexedDBIdentityBackend implements IdentityBackend {
  private database?: Promise<IDBDatabase>;
  private stopped = false;
  private open(): Promise<IDBDatabase> {
    if (this.stopped) return Promise.reject(new Error('Closed'));
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = globalThis.indexedDB.open(BROWSER_IDENTITY_DATABASE, 1);
      let settled = false;
      const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Browser identity storage unavailable')); } };
      const timer = setTimeout(fail, 1500);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('identity')) request.result.createObjectStore('identity'); };
      request.onerror = fail; request.onblocked = fail;
      request.onsuccess = () => {
        if (settled || this.stopped) { request.result.close(); fail(); return; }
        settled = true; clearTimeout(timer);
        request.result.onversionchange = () => { request.result.close(); this.database = undefined; };
        resolve(request.result);
      };
    }).catch(error => { this.database = undefined; throw error; });
  }
  private async transaction(change?: (current: unknown) => unknown): Promise<unknown> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('identity', change ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('identity');
      let value: unknown;
      const timer = setTimeout(() => { try { transaction.abort(); } catch { /* It may already be complete. */ } reject(new Error('Browser identity storage timed out')); }, 1500);
      transaction.oncomplete = () => { clearTimeout(timer); resolve(value); };
      transaction.onerror = transaction.onabort = () => { clearTimeout(timer); reject(new Error('Browser identity storage unavailable')); };
      const request = store.get('current');
      request.onsuccess = () => {
        try { value = change ? change(request.result) : request.result; if (change) store.put(value, 'current'); }
        catch { transaction.abort(); }
      };
    });
  }
  read() { return this.transaction(); }
  update(change: (current: unknown) => unknown) { return this.transaction(change); }
  close() { this.stopped = true; void this.database?.then(db => db.close()).catch(() => {}); }
}

class BrowserChangeBus implements IdentityChangeBus {
  private listeners = new Set<(change: IdentityChange) => void>();
  private channel?: BroadcastChannel;
  constructor() {
    try { if (typeof window !== 'undefined') { this.channel = new BroadcastChannel(BROWSER_IDENTITY_CONTROL); this.channel.onmessage = event => this.receive(event.data); } } catch { /* Storage events remain available. */ }
    globalThis.addEventListener?.('storage', this.storage);
  }
  private receive(value: unknown) {
    if (!object(value) || !['pause', 'resume', 'forget', 'changed'].includes(String(value.kind)) || !bounded(value.revision) || (value.credentialId !== undefined && !bounded(value.credentialId))) return;
    const change = { kind: value.kind, revision: value.revision, ...(value.credentialId ? { credentialId: value.credentialId } : {}), external: true } as IdentityChange;
    for (const listener of this.listeners) listener(change);
  }
  private storage = (event: StorageEvent) => {
    if (event.key !== BROWSER_IDENTITY_CONTROL && event.key !== null) return;
    try {
      const value: unknown = event.newValue ? JSON.parse(event.newValue) : null;
      const previous: unknown = event.oldValue ? JSON.parse(event.oldValue) : null;
      if (object(value)) this.receive({ ...value, kind: value.mode === 'pause' ? 'pause' : value.mode === 'forget' ? 'forget' : value.mode === 'active' && object(previous) && previous.mode === 'pause' ? 'resume' : 'changed' });
      else this.receive({ kind: 'forget', revision: globalThis.crypto.randomUUID() });
    } catch { this.receive({ kind: 'forget', revision: globalThis.crypto.randomUUID() }); }
  };
  publish(change: IdentityChange) { try { this.channel?.postMessage(change); } catch { /* Readback still guards late responses. */ } }
  subscribe(listener: (change: IdentityChange) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  close() { this.channel?.close(); globalThis.removeEventListener?.('storage', this.storage); this.listeners.clear(); }
}

export class BrowserIdentityStore {
  warning = '';
  private readonly backend: IdentityBackend;
  private readonly crypto: Crypto;
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
  private readonly bus: IdentityChangeBus;
  private readonly origin: string;
  private readonly now: () => number;
  private readonly listeners = new Set<(change: IdentityChange) => void>();
  private readonly unsubscribe: () => void;
  private stopped = false;
  private locallyBlocked = false;
  private last: BrowserIdentity | null = null;
  constructor(options: Options = {}) {
    this.backend = options.backend ?? new IndexedDBIdentityBackend();
    this.crypto = options.crypto ?? globalThis.crypto;
    this.origin = options.origin ?? globalThis.location?.origin ?? '';
    this.now = options.now ?? Date.now;
    try { this.storage = options.storage ?? globalThis.localStorage; } catch { this.warning = warning; }
    this.bus = options.bus ?? new BrowserChangeBus();
    this.unsubscribe = this.bus.subscribe(change => {
      if (change.kind === 'pause' || change.kind === 'forget') this.locallyBlocked = true;
      else this.locallyBlocked = false;
      this.emit({ ...change, external: true });
    });
  }
  private emit(change: IdentityChange) { for (const listener of this.listeners) listener(change); }
  private notify(kind: IdentityChange['kind'], revision: string, credentialId?: string) {
    const change: IdentityChange = { kind, revision, ...(credentialId ? { credentialId } : {}), external: false };
    this.emit(change); this.bus.publish(change);
  }
  private control(): { raw: string | null; value: Control | null } {
    if (!this.storage) throw new Error('No durable control storage');
    const raw = this.storage.getItem(BROWSER_IDENTITY_CONTROL);
    if (raw === null) return { raw, value: null };
    const value: unknown = JSON.parse(raw);
    if (!object(value) || !exact(value, ['version', 'mode', 'revision', 'credentialId']) || value.version !== 1 || !['active', 'pause', 'forget'].includes(String(value.mode)) || !bounded(value.revision) || (value.credentialId !== undefined && !bounded(value.credentialId))) throw new Error('Invalid durable control');
    return { raw, value: value as unknown as Control };
  }
  private writeControl(value: Control) {
    if (!this.storage) throw new Error('No durable control storage');
    const raw = JSON.stringify(value); this.storage.setItem(BROWSER_IDENTITY_CONTROL, raw);
    if (this.storage.getItem(BROWSER_IDENTITY_CONTROL) !== raw) throw new Error('Control storage did not persist');
  }
  private async verified(value: unknown): Promise<StoredIdentity | null> {
    if (value === undefined || value === null || tombstone(value)) return null;
    if (!stored(value)) throw new Error('Invalid browser identity');
    const key = await this.crypto.subtle.importKey('jwk', value.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const challenge = this.crypto.getRandomValues(new Uint8Array(32));
    const signature = await this.crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, value.privateKey, challenge);
    if (signature.byteLength !== 64 || !await this.crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, challenge)) throw new Error('Stored proof key is unusable');
    return value;
  }
  /** Passive restoration never generates a key and never treats saved metadata as a connection. */
  async load(): Promise<BrowserIdentity | null> {
    if (this.stopped) return null;
    try {
      const identity = await this.verified(await this.backend.read());
      const { value: control } = this.control();
      if (!identity || control?.mode === 'forget') { this.last = null; return null; }
      if (!control || control.credentialId !== identity.credentialId || (control.mode === 'active' && control.revision !== identity.revision)) throw new Error('Identity control changed');
      this.warning = ''; this.last = { ...visible(identity), paused: identity.paused || control.mode === 'pause' || this.locallyBlocked };
      return this.last;
    } catch { this.warning = warning; return null; }
  }
  /** Only explicit connection may create a durable proof key. A failed write is session-only. */
  async prepare(): Promise<BrowserIdentity | null> {
    if (this.stopped) return null;
    try {
      const control = this.control();
      const previous = await this.backend.read();
      const existing = await this.verified(previous);
      if (existing && control.value?.mode !== 'forget') {
        const mode = existing.paused || control.value?.mode === 'pause' ? 'pause' : 'active';
        if (this.control().raw !== control.raw) return null;
        this.writeControl({ version: 1, mode, revision: existing.revision, credentialId: existing.credentialId });
        this.locallyBlocked = mode === 'pause';
        return await this.load();
      }
      const keys = await this.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      const jwk = await this.crypto.subtle.exportKey('jwk', keys.publicKey);
      const publicKeyJwk: BrowserPublicKey = { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! };
      const candidate: StoredIdentity = { version: 1, credentialId: this.crypto.randomUUID(), publicKeyJwk, privateKey: keys.privateKey, paused: false, revision: this.crypto.randomUUID() };
      const expectedRevision = object(previous) ? previous.revision : undefined;
      const saved = await this.backend.update(current => {
        if (this.control().raw !== control.raw) return current;
        const revision = object(current) ? current.revision : undefined;
        return revision === expectedRevision ? candidate : current;
      });
      const identity = await this.verified(await this.backend.read());
      if (!identity || !stored(saved)) throw new Error('Proof key did not persist');
      if (identity.revision !== saved.revision) return null;
      const latestControl = this.control();
      if (latestControl.raw !== control.raw && !(latestControl.value?.mode === 'active' && latestControl.value.credentialId === identity.credentialId && latestControl.value.revision === identity.revision)) return null;
      this.writeControl({ version: 1, mode: identity.paused ? 'pause' : 'active', revision: identity.revision, credentialId: identity.credentialId });
      this.locallyBlocked = identity.paused;
      this.notify('changed', identity.revision, identity.credentialId);
      return await this.load();
    } catch { this.warning = warning; return null; }
  }
  async remember(credentialId: string, value: BrowserGrant, expectedRevision?: string): Promise<boolean> {
    if (this.stopped || !grant(value)) return false;
    try {
      const control = this.control();
      const previous = await this.load();
      if (!previous || previous.paused || previous.credentialId !== credentialId || (expectedRevision !== undefined && previous.revision !== expectedRevision)) return false;
      const revision = this.crypto.randomUUID();
      const saved = await this.backend.update(current => stored(current) && current.credentialId === credentialId && current.revision === previous.revision && !current.paused && this.control().raw === control.raw ? { ...current, grant: { ...value }, revision } : current);
      if (!stored(saved) || saved.revision !== revision || this.control().raw !== control.raw) return false;
      this.writeControl({ version: 1, mode: 'active', revision, credentialId });
      this.notify('changed', revision, credentialId);
      return !!await this.load();
    } catch { this.warning = warning; return false; }
  }
  /** A session-only approval retires only the grant captured by that pairing, retaining its proof key. */
  async clearGrant(identity: BrowserIdentity): Promise<BrowserIdentity | null> {
    if (this.stopped) return null;
    this.warning = '';
    if (!identity.grant) return identity;
    const expectedGrant = identity.grant;
    const matches = (current: BrowserIdentity) => !current.paused && current.credentialId === identity.credentialId && current.revision === identity.revision &&
      current.grant?.connectorId === expectedGrant.connectorId && current.grant.grantId === expectedGrant.grantId;
    try {
      const control = this.control();
      const previous = await this.load();
      if (!previous || !matches(previous) || this.control().raw !== control.raw) return null;
      const revision = this.crypto.randomUUID();
      const saved = await this.backend.update(current => {
        if (!stored(current) || !matches(current) || this.control().raw !== control.raw) return current;
        const { grant: _grant, ...retained } = current;
        return { ...retained, revision };
      });
      if (!stored(saved) || saved.revision !== revision) return null;
      const persisted = await this.verified(await this.backend.read());
      if (!persisted || persisted.credentialId !== identity.credentialId || persisted.revision !== revision || persisted.grant || persisted.paused || this.control().raw !== control.raw) return null;
      this.writeControl({ version: 1, mode: 'active', revision, credentialId: identity.credentialId });
      this.notify('changed', revision, identity.credentialId);
      const current = await this.load();
      return current && !current.paused && !current.grant && current.credentialId === identity.credentialId && current.revision === revision ? current : null;
    } catch { this.warning = warning; return null; }
  }
  async setPaused(paused: boolean): Promise<boolean> {
    if (this.stopped) return false;
    const revision = this.crypto.randomUUID();
    if (paused) {
      this.locallyBlocked = true;
      let controlSaved = true;
      try { this.writeControl({ version: 1, mode: 'pause', revision, ...(this.last ? { credentialId: this.last.credentialId } : {}) }); } catch { this.warning = warning; controlSaved = false; }
      this.notify('pause', revision, this.last?.credentialId);
      try {
        const saved = await this.backend.update(current => stored(current) ? { ...current, paused: true, revision } : { version: 1, paused: true, revision });
        if (stored(saved) && this.control().value?.revision === revision) this.writeControl({ version: 1, mode: 'pause', revision, credentialId: saved.credentialId });
        return controlSaved;
      } catch { this.warning = warning; return false; }
    }
    try {
      const control = this.control();
      if (control.value?.mode === 'forget') return false;
      const saved = await this.backend.update(current => stored(current) && this.control().raw === control.raw ? { ...current, paused: false, revision } : current);
      if (!stored(saved) || saved.revision !== revision || this.control().raw !== control.raw) return false;
      await this.verified(saved);
      this.writeControl({ version: 1, mode: 'active', revision, credentialId: saved.credentialId });
      this.locallyBlocked = false; this.notify('resume', revision, saved.credentialId);
      return !!await this.load();
    } catch { this.warning = warning; return false; }
  }
  /** Stop all local use immediately; a tombstone prevents old async writes reviving the key. */
  async forget(): Promise<boolean> {
    if (this.stopped) return false;
    this.locallyBlocked = true;
    const revision = this.crypto.randomUUID();
    let controlSaved = true;
    try { this.writeControl({ version: 1, mode: 'forget', revision }); } catch { this.warning = warning; controlSaved = false; }
    this.notify('forget', revision, this.last?.credentialId); this.last = null;
    try { await this.backend.update(() => ({ version: 1, paused: true, revision })); return controlSaved; }
    catch { this.warning = warning; return false; }
  }
  /** Remove the durable key first; retain one bounded, revoke-only proof capability in memory. */
  async takeForRevocation(): Promise<BrowserRevocation | null> {
    if (this.stopped) return null;
    this.locallyBlocked = true;
    const revision = this.crypto.randomUUID();
    try { this.writeControl({ version: 1, mode: 'forget', revision }); } catch { this.warning = warning; }
    this.notify('forget', revision, this.last?.credentialId); this.last = null;
    let captured: unknown;
    try {
      await this.backend.update(current => { captured = current; return { version: 1, paused: true, revision }; });
      const existing = await this.verified(captured);
      captured = undefined;
      if (!existing?.grant || !this.origin) return null;
      const identity = visible(existing);
      let privateKey: CryptoKey | undefined = existing.privateKey;
      const dispose = () => { privateKey = undefined; };
      return {
        identity,
        dispose,
        sign: async bytes => {
          const key = privateKey; dispose();
          if (!key || this.stopped || bytes.byteLength > 4096) return null;
          try {
            const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            const challenge: unknown = JSON.parse(content);
            if (!Array.isArray(challenge) || challenge.length !== 9 || JSON.stringify(challenge) !== content ||
              challenge[0] !== 'aipoch-browser-authorization' || challenge[1] !== '1.0' || challenge[2] !== identity.grant!.connectorId ||
              challenge[3] !== this.origin || challenge[4] !== identity.grant!.grantId || challenge[5] !== 'revoke' ||
              !bounded(challenge[6]) || !bounded(challenge[7]) || !Number.isSafeInteger(challenge[8]) ||
              challenge[8] <= this.now() || challenge[8] > this.now() + 60_000) return null;
            const signature = new Uint8Array(await this.crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new Uint8Array(bytes)));
            return signature.byteLength === 64 && challenge[8] > this.now() ? base64url(signature) : null;
          } catch { return null; }
        },
      };
    } catch { captured = undefined; this.warning = warning; return null; }
  }
  /** A challenge is signed only while the exact durable identity remains active. */
  async sign(credentialId: string, bytes: Uint8Array): Promise<string | null> {
    if (this.stopped || this.locallyBlocked) return null;
    try {
      const previous = await this.load();
      if (!previous || previous.paused || previous.credentialId !== credentialId) return null;
      const identity = await this.verified(await this.backend.read());
      if (!identity || identity.revision !== previous.revision) return null;
      const signature = new Uint8Array(await this.crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.privateKey, new Uint8Array(bytes)));
      const current = await this.load();
      if (this.stopped || !current || current.paused || current.revision !== previous.revision || current.credentialId !== credentialId || signature.byteLength !== 64) return null;
      return base64url(signature);
    } catch { this.warning = warning; return null; }
  }
  subscribe(listener: (change: IdentityChange) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  dispose() { this.stopped = true; this.unsubscribe(); this.bus.close?.(); this.backend.close?.(); this.listeners.clear(); }
}
