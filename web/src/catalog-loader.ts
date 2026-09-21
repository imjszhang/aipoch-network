import type { SiteData } from './model.js';
import { BrowserDataError, parseJsonBytes, readBoundedBytes, type BoundedFetchOptions } from './bounded-fetch.js';

const MAX_CATALOG_BYTES = 32_000_000;
/** Full entities are loaded only for features that explicitly require them. */
export async function loadCatalog(base: string, snapshot?: string, fetcher: typeof fetch = fetch, options: Omit<BoundedFetchOptions, 'maxBytes' | 'fetcher'> = {}): Promise<SiteData> {
  const bytes = await readBoundedBytes(`${base}internal/catalog.json`, { ...options, fetcher, maxBytes: MAX_CATALOG_BYTES });
  const data = parseJsonBytes(bytes) as SiteData;
  if (!data || data.data_kind === 'browse' || data.data_kind === 'page' || typeof data.snapshot_id !== 'string' || !data.catalog ||
    !['projects', 'resources', 'sources', 'actors', 'organizations', 'collections', 'claims', 'relations', 'tombstones']
      .every(key => Array.isArray(data.catalog[key as keyof SiteData['catalog']]))) throw new BrowserDataError('invalid_data', 'Catalog invalid');
  if (snapshot && data.snapshot_id !== snapshot) throw new BrowserDataError('version_mismatch', 'Catalog snapshot changed. Refresh this page to load one consistent version.');
  return data;
}
