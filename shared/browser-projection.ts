import type { CatalogData } from '../spec/types.js';

/** Browser presentation format, deliberately separate from public catalog/v1. */
export const UI_SCHEMA_VERSION = 1 as const;
export interface UiFileDescriptor { href: string; bytes: number; sha256: string }
export interface UiManifest {
  schema_version: typeof UI_SCHEMA_VERSION;
  snapshot_id: string;
  generated_at: string;
  projection_hash: string;
  files: { browse: UiFileDescriptor; search: UiFileDescriptor };
}
export interface UiManifestReference extends UiFileDescriptor {
  schema_version: typeof UI_SCHEMA_VERSION;
  snapshot_id: string;
  projection_hash: string;
}
/** This catalogue-shaped display projection is never a full workbench/Connector entity graph. */
export interface BrowseData {
  schema_version: typeof UI_SCHEMA_VERSION;
  data_kind: 'browse';
  snapshot_id: string;
  generated_at: string;
  catalog: CatalogData;
}
export interface UiSearchData { schema_version: typeof UI_SCHEMA_VERSION; snapshot_id: string; index: unknown }

/** Canonical bytes for projection identities in Node and Web Crypto. */
export function stableUiJson(value: unknown): string {
  const canonicalize = (item: unknown): unknown => Array.isArray(item) ? item.map(canonicalize) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, canonicalize(value)])) : item;
  return JSON.stringify(canonicalize(value)) + '\n';
}
