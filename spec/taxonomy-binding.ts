import type { CatalogData, CatalogManifest } from './types.js';
import { validateFordDictionary, validateResearchTagDictionary, type FordDictionary, type ResearchTagDictionary } from './taxonomy.js';
/** Dictionaries are supplied only after the caller verifies their manifest bytes and hash. */
export function validateTaxonomyBindings(catalog: CatalogData, manifest: CatalogManifest, dictionaries: unknown[]): void {
  const bound = new Map<string, Record<string, unknown>>();
  for (const [i, part] of (manifest.taxonomies ?? []).entries()) {
    const value = dictionaries[i] as Record<string, unknown> | undefined;
    if (!value || value.scheme !== part.scheme || value.version !== part.version || (part.revision !== undefined && value.revision !== part.revision)) throw new Error('Taxonomy identity differs from manifest');
    if (part.scheme === 'oecd-ford' && part.version === '2015' && !validateFordDictionary(value).ok) throw new Error('Invalid FORD dictionary');
    if (part.scheme === 'aipoch-research-tags' && part.version === '1' && !validateResearchTagDictionary(value).ok) throw new Error('Invalid research tag dictionary');
    bound.set(JSON.stringify([part.scheme,part.version]), value);
  }
  for (const row of [...catalog.projects,...catalog.resources]) {
    for (const field of ['classification','research_tags'] as const) {
      const value = row[field];
      if (!value) continue;
      if (!row.provenance[field]?.length) throw new Error(`${row.id}: missing ${field} evidence`);
      for (const evidence of row.provenance[field] ?? []) if (evidence.source_id && !row.source_refs.some(ref => ref.source_id === evidence.source_id)) throw new Error('Classification evidence is not an entry source');
      const dictionary = bound.get(JSON.stringify([value.scheme,value.version]));
      if (!dictionary) throw new Error(`${row.id}: missing snapshot taxonomy`);
      if (field === 'classification' && row.classification?.scheme === 'oecd-ford' && row.classification.version === '2015') {
        const c = row.classification, fields = (dictionary as unknown as FordDictionary).fields;
        if (c.codes.some(code => !fields.some(item => item.code === code && item.level === 2)) || (c.codes.length ? c.unclassified_reason !== undefined : !c.unclassified_reason?.trim())) throw new Error('Invalid FORD assignment');
      }
      if (field === 'research_tags' && row.research_tags?.scheme === 'aipoch-research-tags' && row.research_tags.version === '1') {
        const tags = (dictionary as unknown as ResearchTagDictionary).tags;
        if (row.research_tags.ids.some(id => !tags.some(tag => tag.id === id))) throw new Error('Unknown research tag');
      }
    }
  }
}
