/** Only browser preferences are persisted. Sessions, approval and requests are never stored. */
export interface LocalLibrary {
  version: 1;
  saved: string[];
  recent: string[];
  language: 'en' | 'zh';
  selection: { id: string; returnTo: string } | null;
}
export type BrowserStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const emptyLibrary = (): LocalLibrary => ({ version: 1, saved: [], recent: [], language: 'en', selection: null });
export const MAX_LIBRARY_BYTES = 2_000_000;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0 && item.length < 600);
export function parseLibrary(raw: string): LocalLibrary {
  // Bound bytes before JSON parsing; use the same limit before persisting our own output.
  if (raw.length > MAX_LIBRARY_BYTES || new TextEncoder().encode(raw).byteLength > MAX_LIBRARY_BYTES) throw new Error('Browser preferences exceed the supported size');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid browser preferences');
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || !strings(row.saved) || !strings(row.recent) || !['en', 'zh'].includes(String(row.language))) throw new Error('Invalid browser preferences');
  let selection: LocalLibrary['selection'] = null;
  if (row.selection != null) {
    const selected = row.selection as Record<string, unknown>;
    if (typeof selected.id !== 'string' || selected.id.length >= 600 || typeof selected.returnTo !== 'string' || !selected.returnTo.startsWith('/') || selected.returnTo.startsWith('//') || selected.returnTo.length > 10000) throw new Error('Invalid selected object');
    selection = { id: selected.id, returnTo: selected.returnTo };
  }
  return { version: 1, saved: [...new Set(row.saved)], recent: [...new Set(row.recent)].slice(0, 60), language: row.language as 'en' | 'zh', selection };
}
export class LibraryStore {
  value = emptyLibrary();
  warning = '';
  private storage?: BrowserStorage;
  constructor(readonly key: string, storage?: BrowserStorage) {
    this.storage = storage;
    if (storage) try {
      const raw = storage.getItem(key);
      if (raw !== null) this.value = parseLibrary(raw);
    } catch {
      // Preserve invalid or older records for recovery; never overwrite them with empty data.
      this.storage = undefined;
      this.warning = 'Browser storage could not be read. Changes stay in memory for this visit; existing stored data is preserved.';
    }
  }
  update(change: Partial<LocalLibrary>) {
    this.value = { ...this.value, ...change };
    if (this.storage) try {
      const raw = JSON.stringify(this.value);
      parseLibrary(raw);
      this.storage.setItem(this.key, raw);
    } catch {
      this.storage = undefined;
      this.warning = 'Browser storage could not retain these changes. They stay in memory for this visit.';
    }
  }
  /** A storage event may update preferences, never connection or send authority. */
  receive(raw: string | null) {
    if (!this.storage || raw === null) return;
    try { this.value = parseLibrary(raw); } catch { this.warning = 'Another tab contains unreadable preferences. Your current local records were kept.'; }
  }
}
