/** Fixed codes let the UI explain recovery without logging URLs or catalog contents. */
export type BrowserDataErrorCode = 'network' | 'http' | 'total_timeout' | 'idle_timeout' | 'too_large' | 'invalid_data' | 'version_mismatch' | 'digest_mismatch' | 'retired' | 'cancelled';

export class BrowserDataError extends Error {
  constructor(readonly code: BrowserDataErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = 'BrowserDataError';
  }
}

export interface BoundedFetchOptions {
  maxBytes: number;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  /** At most one retry; disabled for deterministic data/format/withdrawal failures. */
  retries?: 0 | 1;
  cache?: RequestCache;
}

export function cancellationError(signal?: AbortSignal): BrowserDataError {
  return signal?.reason instanceof BrowserDataError ? signal.reason : new BrowserDataError('cancelled', 'The data request was cancelled.');
}

function isTransient(error: unknown): boolean {
  return error instanceof BrowserDataError && (
    ['network', 'total_timeout', 'idle_timeout'].includes(error.code) ||
    (error.code === 'http' && (error.status === 408 || error.status === 429 || (error.status !== undefined && error.status >= 500 && error.status <= 599)))
  );
}

async function readAttempt(url: string, options: BoundedFetchOptions): Promise<Uint8Array<ArrayBuffer>> {
  const { maxBytes, signal, fetcher = fetch, idleTimeoutMs = 10_000, totalTimeoutMs = 45_000 } = options;
  if (signal?.aborted) throw cancellationError(signal);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let idleTimer: ReturnType<typeof setTimeout>;
  const abort = () => controller.abort(cancellationError(signal));
  signal?.addEventListener('abort', abort, { once: true });
  const totalTimer = setTimeout(() => controller.abort(new BrowserDataError('total_timeout', 'The data request exceeded its total time limit.')), totalTimeoutMs);
  const progress = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(new BrowserDataError('idle_timeout', 'The data download stopped making progress.')), idleTimeoutMs);
  };
  // A race also bounds fetch/read implementations that do not honor AbortSignal.
  let rejectAborted: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAborted = reject; });
  const onAbort = () => {
    void reader?.cancel(controller.signal.reason).catch(() => {});
    rejectAborted(controller.signal.reason);
  };
  controller.signal.addEventListener('abort', onAbort, { once: true });
  progress();
  try {
    const response = await Promise.race([fetcher(url, { signal: controller.signal, redirect: 'error', cache: options.cache }), aborted]);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new BrowserDataError('http', 'The data server returned an unsuccessful response.', response.status);
    }
    const declared = response.headers.get('content-length');
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
      void response.body?.cancel().catch(() => {});
      throw new BrowserDataError('too_large', 'The data response exceeds its byte limit.');
    }
    if (!response.body) throw new BrowserDataError('invalid_data', 'The data response has no body.');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (chunk.done) break;
      if (!chunk.value.byteLength) continue;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new BrowserDataError('too_large', 'The decoded data exceeds its byte limit.');
      chunks.push(chunk.value);
      progress();
    }
    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
    return combined;
  } catch (error) {
    void reader?.cancel().catch(() => {});
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof BrowserDataError) throw error;
    throw new BrowserDataError('network', 'The data download failed.');
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(idleTimer!);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

/** Progress is measured on received bytes, not headers or empty stream chunks. */
export async function readBoundedBytes(url: string, options: BoundedFetchOptions): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0 ||
    (options.idleTimeoutMs !== undefined && (!Number.isFinite(options.idleTimeoutMs) || options.idleTimeoutMs <= 0)) ||
    (options.totalTimeoutMs !== undefined && (!Number.isFinite(options.totalTimeoutMs) || options.totalTimeoutMs <= 0))) {
    throw new BrowserDataError('invalid_data', 'The data request has invalid bounds.');
  }
  const retries = options.retries === 0 ? 0 : 1;
  for (let attempt = 0; ; attempt++) {
    try { return await readAttempt(url, options); }
    catch (error) {
      if (options.signal?.aborted) throw cancellationError(options.signal);
      if (attempt >= retries || !isTransient(error)) throw error;
    }
  }
}

export function parseJsonBytes(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new BrowserDataError('invalid_data', 'The data response is not valid UTF-8 JSON.'); }
}

export async function verifyBytes(bytes: Uint8Array<ArrayBuffer>, expected: { bytes: number; sha256: string }): Promise<void> {
  if (bytes.byteLength !== expected.bytes) throw new BrowserDataError('digest_mismatch', 'The data length differs from the page manifest.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const actual = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expected.sha256) throw new BrowserDataError('digest_mismatch', 'The data digest differs from the page manifest.');
}
