import { createHash } from 'node:crypto';

export function stableJson(value: unknown): string {
  const canonicalize = (item: unknown): unknown => Array.isArray(item) ? item.map(canonicalize) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, canonicalize(value)])) : item;
  return JSON.stringify(canonicalize(value)) + '\n';
}
export const sha256 = (content: string | Uint8Array): string => createHash('sha256').update(content).digest('hex');
