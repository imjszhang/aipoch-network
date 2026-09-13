import type { SiteData } from './model.js';

const MAX_CATALOG_BYTES = 32_000_000;
/** One snapshot-bound reader for initial hydration and later client navigation. */
export async function loadCatalog(base: string, snapshot?: string, fetcher: typeof fetch = fetch): Promise<SiteData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(`${base}internal/catalog.json`, { signal: controller.signal });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_CATALOG_BYTES || !response.body) throw new Error('Catalog unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_CATALOG_BYTES) { await reader.cancel(); throw new Error('Catalog too large'); }
      chunks.push(chunk.value);
    }
    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(combined)) as SiteData;
    if (!data || typeof data.snapshot_id !== 'string' || !data.catalog ||
      !['projects', 'resources', 'sources', 'actors', 'organizations', 'collections', 'claims', 'relations', 'tombstones']
        .every(key => Array.isArray(data.catalog[key as keyof SiteData['catalog']]))) throw new Error('Catalog invalid');
    if (snapshot && data.snapshot_id !== snapshot) throw new Error('Catalog snapshot changed. Refresh this page to load one consistent version.');
    return data;
  } finally { clearTimeout(timer); }
}
