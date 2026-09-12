import MiniSearch from 'minisearch';
import type { CatalogData } from '../../spec/types.js';

export interface SearchDocument { id: string; title: string; text: string; kind: string; domains: string[] }
export function tokenize(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  const words = normalized.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu, ' ').match(/[\p{L}\p{N}_]+/gu) ?? [];
  const tokens = [...words];
  for (const run of normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? []) {
    const chars = [...run];
    // Bigrams support interior terms; prefix search covers each starting character.
    // Keep the final character for single-character queries at the end of a run.
    if (chars.length) tokens.push(chars.at(-1)!);
    for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1]);
  }
  return [...new Set(tokens)];
}
export const searchOptions = { fields: ['title', 'text'], storeFields: ['id', 'title', 'kind', 'domains'], tokenize,
  searchOptions: { boost: { title: 3 }, prefix: true, combineWith: 'AND' as const } };
export function searchDocuments(catalog: CatalogData): SearchDocument[] {
  return [...catalog.sources, ...catalog.projects, ...catalog.resources, ...catalog.organizations, ...catalog.collections, ...catalog.actors.filter(actor => actor.account_type === 'user')].map(row => ({
    id: row.id, title: row.title, text: [row.description ?? '', ...('domains' in row ? row.domains : []), ...('topics' in row ? row.topics ?? [] : [])].join(' '),
    kind: row.kind, domains: 'domains' in row ? row.domains : [],
  }));
}
export function makeSearchIndex(documents: SearchDocument[]): MiniSearch<SearchDocument> {
  const index = new MiniSearch<SearchDocument>(searchOptions);
  index.addAll(documents);
  return index;
}
