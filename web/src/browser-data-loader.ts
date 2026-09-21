import MiniSearch from 'minisearch';
import { stableUiJson, UI_SCHEMA_VERSION, type BrowseData, type UiManifest, type UiManifestReference, type UiFileDescriptor, type UiSearchData } from '../../shared/browser-projection.js';
import { searchOptions, type SearchDocument } from './search.js';
import { BrowserDataError, cancellationError, parseJsonBytes, readBoundedBytes, verifyBytes } from './bounded-fetch.js';

export { BrowserDataError } from './bounded-fetch.js';
export type { UiManifestReference, BrowseData } from '../../shared/browser-projection.js';

const SNAPSHOT = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_DATA_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_BYTES = 1024 * 1024;
const MAX_HISTORY_ENTRIES = 4096;
const CATALOG_KEYS = ['projects', 'resources', 'sources', 'actors', 'organizations', 'collections', 'claims', 'relations', 'tombstones'] as const;

export interface BrowserDataLoadOptions { signal?: AbortSignal; fetcher?: typeof fetch }
export interface BrowserDataLoaderOptions {
  fetcher?: typeof fetch;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  /** Bounds retained JSON bytes; decoded values and MiniSearch are also bounded by entry count. */
  maxCacheBytes?: number;
  maxVersions?: number;
}

interface SharedRequest<T> {
  controller: AbortController;
  promise: Promise<T>;
  subscribers: number;
  settled: boolean;
  discard: () => void;
}
interface Version {
  key: string;
  base: string;
  reference: UiManifestReference;
  touched: number;
  bytes: number;
  manifest?: SharedRequest<UiManifest>;
  browse?: SharedRequest<BrowseData>;
  search?: SharedRequest<MiniSearch<SearchDocument>>;
}
interface History {
  version: 1;
  current_snapshot_id: string;
  checked_at: string;
  snapshots: Array<{ snapshot_id: string; status: 'available' | 'withdrawn' | 'invalid'; checked_at: string }>;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
function invalid(message: string): never { throw new BrowserDataError('invalid_data', message); }
function validateDescriptor(value: unknown, href: string, limit: number): asserts value is UiFileDescriptor {
  if (!record(value) || value.href !== href || typeof value.sha256 !== 'string' || !SHA256.test(value.sha256) ||
    !Number.isSafeInteger(value.bytes) || (value.bytes as number) <= 0 || (value.bytes as number) > limit) invalid('The data manifest has an invalid file descriptor.');
}
function validateReference(reference: UiManifestReference): void {
  if (!record(reference) || reference.schema_version !== UI_SCHEMA_VERSION) invalid('This browser data schema is not supported.');
  if (typeof reference.snapshot_id !== 'string' || !SNAPSHOT.test(reference.snapshot_id) || typeof reference.projection_hash !== 'string' || !SHA256.test(reference.projection_hash)) invalid('The page data reference is invalid.');
  validateDescriptor(reference, `internal/ui/v1/${reference.snapshot_id}/${reference.projection_hash}/manifest.json`, MAX_MANIFEST_BYTES);
}
function normalizeBase(base: string): string {
  // The page supplies a deployment-relative base, never an arbitrary data origin.
  if (!base.startsWith('/') || base.startsWith('//') || /[?#\\%]/.test(base) || base.split('/').some(part => part === '.' || part === '..')) invalid('The site data base is invalid.');
  return base.endsWith('/') ? base : `${base}/`;
}

function shared<T>(load: (signal: AbortSignal) => Promise<T>, discard: () => void, fulfilled?: (value: T) => void): SharedRequest<T> {
  const state: SharedRequest<T> = { controller: new AbortController(), promise: undefined!, subscribers: 0, settled: false, discard };
  state.promise = Promise.resolve().then(() => {
    if (state.controller.signal.aborted) throw cancellationError(state.controller.signal);
    return load(state.controller.signal);
  }).then(value => {
    if (state.controller.signal.aborted) throw cancellationError(state.controller.signal);
    state.settled = true;
    fulfilled?.(value);
    return value;
  }).catch(error => {
    state.settled = true;
    discard();
    throw error;
  });
  // A cancelled last subscriber may leave no reader of the underlying promise.
  void state.promise.catch(() => {});
  return state;
}

function subscribe<T>(request: SharedRequest<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(cancellationError(signal));
  request.subscribers++;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const finish = (callback: () => void) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      request.subscribers--;
      callback();
      if (!request.settled && request.subscribers === 0) {
        request.discard();
        request.controller.abort(new BrowserDataError('cancelled', 'All data request subscribers left the page.'));
      }
    };
    const abort = () => finish(() => reject(cancellationError(signal)));
    signal?.addEventListener('abort', abort, { once: true });
    request.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}

/** In-memory only. Every new use revalidates availability against the public retirement ledger. */
export class BrowserDataLoader {
  private readonly versions = new Map<string, Version>();
  private readonly histories = new Map<string, SharedRequest<History>>();
  /** A terminal retirement observed in this session cannot be undone by an older CDN response. */
  private readonly retired = new Map<string, Set<string>>();
  private tick = 0;
  private readonly maxCacheBytes: number;
  private readonly maxVersions: number;
  constructor(private readonly options: BrowserDataLoaderOptions = {}) {
    this.maxCacheBytes = options.maxCacheBytes ?? 32 * 1024 * 1024;
    this.maxVersions = options.maxVersions ?? 3;
    if (!Number.isSafeInteger(this.maxCacheBytes) || this.maxCacheBytes <= 0 || !Number.isSafeInteger(this.maxVersions) || this.maxVersions <= 0) invalid('The browser cache bounds are invalid.');
  }

  private read(url: string, maxBytes: number, signal: AbortSignal, cache?: RequestCache): Promise<Uint8Array<ArrayBuffer>> {
    return readBoundedBytes(url, { maxBytes, signal, cache, fetcher: this.options.fetcher, idleTimeoutMs: this.options.idleTimeoutMs, totalTimeoutMs: this.options.totalTimeoutMs });
  }

  private discardVersion(version: Version, reason?: BrowserDataError): void {
    if (this.versions.get(version.key) === version) this.versions.delete(version.key);
    if (reason) for (const request of [version.manifest, version.browse, version.search]) if (request && !request.settled) request.controller.abort(reason);
  }

  private prune(protectedVersion?: Version): void {
    let retainedBytes = [...this.versions.values()].reduce((sum, version) => sum + version.bytes, 0);
    const inactive = [...this.versions.values()].filter(version => version !== protectedVersion && ![version.manifest, version.browse, version.search].some(request => request && !request.settled)).sort((a, b) => a.touched - b.touched);
    for (const version of inactive) {
      if (this.versions.size <= this.maxVersions && retainedBytes <= this.maxCacheBytes) break;
      this.discardVersion(version);
      retainedBytes -= version.bytes;
    }
    // A result may be returned without being retained when its own size fills the cache.
    if (retainedBytes > this.maxCacheBytes && protectedVersion) this.discardVersion(protectedVersion);
  }

  private async available(base: string, snapshot: string, signal?: AbortSignal): Promise<void> {
    let request = this.histories.get(base);
    if (!request) {
      const remove = () => { if (this.histories.get(base) === request) this.histories.delete(base); };
      request = shared(async innerSignal => {
        const bytes = await this.read(`${base}catalog/v1/history.json`, MAX_HISTORY_BYTES, innerSignal, 'no-store');
        const value = parseJsonBytes(bytes);
        if (!record(value) || value.version !== 1 || typeof value.current_snapshot_id !== 'string' || !SNAPSHOT.test(value.current_snapshot_id) || !validTime(value.checked_at) || !Array.isArray(value.snapshots) || value.snapshots.length > MAX_HISTORY_ENTRIES) invalid('The snapshot retirement ledger is invalid.');
        const seen = new Set<string>();
        for (const row of value.snapshots) {
          if (!record(row) || typeof row.snapshot_id !== 'string' || !SNAPSHOT.test(row.snapshot_id) || seen.has(row.snapshot_id) || !['available', 'withdrawn', 'invalid'].includes(String(row.status)) || !validTime(row.checked_at)) invalid('The snapshot retirement ledger contains an invalid entry.');
          seen.add(row.snapshot_id);
        }
        if (!value.snapshots.some(row => row.snapshot_id === value.current_snapshot_id && row.status === 'available')) invalid('The snapshot retirement ledger has no available current snapshot.');
        const history = value as unknown as History;
        const statuses = new Map(history.snapshots.map(row => [row.snapshot_id, row.status]));
        const retired = this.retired.get(base) ?? new Set<string>();
        for (const row of history.snapshots) if (row.status !== 'available') retired.add(row.snapshot_id);
        if (retired.size > MAX_HISTORY_ENTRIES) invalid('The snapshot retirement ledger exceeds the supported session capacity.');
        this.retired.set(base, retired);
        for (const version of this.versions.values()) if (version.base === base && (statuses.get(version.reference.snapshot_id) !== 'available' || retired.has(version.reference.snapshot_id))) this.discardVersion(version, new BrowserDataError('retired', 'This page snapshot is no longer available. Refresh the page.'));
        return history;
      }, remove, remove);
      this.histories.set(base, request);
    }
    const history = await subscribe(request, signal);
    if (history.snapshots.find(row => row.snapshot_id === snapshot)?.status !== 'available' || this.retired.get(base)?.has(snapshot)) throw new BrowserDataError('retired', 'This page snapshot is no longer available. Refresh the page.');
  }

  private version(base: string, reference: UiManifestReference): Version {
    const key = `${base}|${reference.schema_version}|${reference.snapshot_id}|${reference.projection_hash}`;
    let version = this.versions.get(key);
    if (version) {
      if (version.reference.sha256 !== reference.sha256 || version.reference.bytes !== reference.bytes) throw new BrowserDataError('version_mismatch', 'An immutable data reference changed. Refresh the page.');
      version.touched = ++this.tick;
      return version;
    }
    // Make one slot available without interrupting requests belonging to other subscribers.
    if (this.versions.size >= this.maxVersions) {
      const oldest = [...this.versions.values()].filter(item => ![item.manifest, item.browse, item.search].some(request => request && !request.settled)).sort((a, b) => a.touched - b.touched)[0];
      if (oldest) this.discardVersion(oldest);
      else throw new BrowserDataError('too_large', 'Too many browser data versions are being loaded. Try again when the current request finishes.');
    }
    version = { key, base, reference: { ...reference }, touched: ++this.tick, bytes: 0 };
    this.versions.set(key, version);
    return version;
  }

  private manifest(version: Version, signal: AbortSignal): Promise<UiManifest> {
    if (!version.manifest) {
      const request = shared(async innerSignal => {
        const bytes = await this.read(`${version.base}${version.reference.href}`, MAX_MANIFEST_BYTES, innerSignal);
        await verifyBytes(bytes, version.reference);
        const value = parseJsonBytes(bytes);
        if (!record(value) || value.schema_version !== UI_SCHEMA_VERSION || !record(value.files) || !validTime(value.generated_at)) invalid('The browser data manifest is invalid or has an unsupported schema.');
        if (value.snapshot_id !== version.reference.snapshot_id || value.projection_hash !== version.reference.projection_hash) throw new BrowserDataError('version_mismatch', 'The data manifest belongs to a different page version.');
        validateDescriptor(value.files.browse, 'browse.json', MAX_DATA_BYTES);
        validateDescriptor(value.files.search, 'search.json', MAX_DATA_BYTES);
        const { projection_hash: _hash, ...identity } = value;
        const identityBytes = new TextEncoder().encode(stableUiJson(identity));
        await verifyBytes(identityBytes, { bytes: identityBytes.byteLength, sha256: version.reference.projection_hash });
        return value as unknown as UiManifest;
      }, () => { if (version.manifest === request) version.manifest = undefined; }, () => { version.bytes += version.reference.bytes; this.prune(version); });
      version.manifest = request;
    }
    return subscribe(version.manifest, signal);
  }

  private async withAvailability<T>(base: string, reference: UiManifestReference, signal: AbortSignal | undefined, load: (version: Version, signal: AbortSignal) => Promise<T>): Promise<T> {
    validateReference(reference);
    base = normalizeBase(base);
    if (signal?.aborted) throw cancellationError(signal);
    if (this.retired.get(base)?.has(reference.snapshot_id)) throw new BrowserDataError('retired', 'This page snapshot is no longer available. Refresh the page.');
    const version = this.version(base, reference);
    const controller = new AbortController();
    const abort = () => controller.abort(cancellationError(signal));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      // Fetch immutable bytes while checking the ledger, but expose no data until both pass.
      // This avoids adding a retirement-ledger round trip to the data waterfall.
      const [, value] = await Promise.all([this.available(base, reference.snapshot_id, controller.signal), load(version, controller.signal)]);
      if (this.retired.get(base)?.has(reference.snapshot_id)) throw new BrowserDataError('retired', 'This page snapshot is no longer available. Refresh the page.');
      return value;
    } finally {
      signal?.removeEventListener('abort', abort);
      // A failure in either branch releases only this caller's remaining subscriptions.
      controller.abort(new BrowserDataError('cancelled', 'The page data request has finished.'));
    }
  }

  async loadBrowseData(base: string, reference: UiManifestReference, options: Pick<BrowserDataLoadOptions, 'signal'> = {}): Promise<BrowseData> {
    return this.withAvailability(base, reference, options.signal, (version, subscriberSignal) => {
      if (!version.browse) {
        let size = 0;
        const request = shared(async signal => {
          const manifest = await this.manifest(version, signal);
          const descriptor = manifest.files.browse;
          const bytes = await this.read(`${version.base}${reference.href.slice(0, -'manifest.json'.length)}${descriptor.href}`, MAX_DATA_BYTES, signal);
          await verifyBytes(bytes, descriptor);
          const value = parseJsonBytes(bytes);
          if (!record(value) || value.schema_version !== UI_SCHEMA_VERSION || value.data_kind !== 'browse' || !record(value.catalog) || !validTime(value.generated_at)) invalid('The browse data is invalid or has an unsupported schema.');
          if (value.snapshot_id !== reference.snapshot_id || value.generated_at !== manifest.generated_at) throw new BrowserDataError('version_mismatch', 'The browse data belongs to a different page version.');
          const catalog = value.catalog;
          if (!CATALOG_KEYS.every(key => Array.isArray(catalog[key]) && catalog[key].every(row => record(row) && typeof row.id === 'string'))) invalid('The browse data collections are invalid.');
          size = bytes.byteLength;
          return value as unknown as BrowseData;
        }, () => { if (version.browse === request) version.browse = undefined; }, () => { version.bytes += size; this.prune(version); });
        version.browse = request;
      }
      return subscribe(version.browse, subscriberSignal);
    });
  }

  async loadSearchIndex(base: string, reference: UiManifestReference, options: Pick<BrowserDataLoadOptions, 'signal'> = {}): Promise<MiniSearch<SearchDocument>> {
    return this.withAvailability(base, reference, options.signal, (version, subscriberSignal) => {
      if (!version.search) {
        let size = 0;
        const request = shared(async signal => {
          const manifest = await this.manifest(version, signal);
          const descriptor = manifest.files.search;
          const bytes = await this.read(`${version.base}${reference.href.slice(0, -'manifest.json'.length)}${descriptor.href}`, MAX_DATA_BYTES, signal);
          await verifyBytes(bytes, descriptor);
          const value = parseJsonBytes(bytes);
          if (!record(value) || value.schema_version !== UI_SCHEMA_VERSION || !record(value.index)) invalid('The search data is invalid or has an unsupported schema.');
          if (value.snapshot_id !== reference.snapshot_id) throw new BrowserDataError('version_mismatch', 'The search data belongs to a different page version.');
          let index: MiniSearch<SearchDocument>;
          try { index = MiniSearch.loadJSON<SearchDocument>(JSON.stringify((value as unknown as UiSearchData).index), searchOptions); }
          catch { return invalid('The search index is invalid.'); }
          size = bytes.byteLength;
          return index;
        }, () => { if (version.search === request) version.search = undefined; }, () => { version.bytes += size; this.prune(version); });
        version.search = request;
      }
      return subscribe(version.search, subscriberSignal);
    });
  }
}

const defaultLoader = new BrowserDataLoader();
const customLoaders = new WeakMap<typeof fetch, BrowserDataLoader>();
function loaderFor(fetcher?: typeof fetch): BrowserDataLoader {
  if (!fetcher) return defaultLoader;
  let loader = customLoaders.get(fetcher);
  if (!loader) { loader = new BrowserDataLoader({ fetcher }); customLoaders.set(fetcher, loader); }
  return loader;
}
export function loadBrowseData(base: string, reference: UiManifestReference, options: BrowserDataLoadOptions = {}): Promise<BrowseData> {
  return loaderFor(options.fetcher).loadBrowseData(base, reference, options);
}
export function loadSearchIndex(base: string, reference: UiManifestReference, options: BrowserDataLoadOptions = {}): Promise<MiniSearch<SearchDocument>> {
  return loaderFor(options.fetcher).loadSearchIndex(base, reference, options);
}
