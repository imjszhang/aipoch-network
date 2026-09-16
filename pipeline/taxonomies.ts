import { readFile } from 'node:fs/promises';
import { sha256 } from './json.js';
import { validateFordDictionary, validateResearchTagDictionary } from '../spec/taxonomy.js';
import type { TaxonomyDescriptor } from '../spec/types.js';
export async function publicationTaxonomies() {
  return Promise.all(['oecd-ford-2015.json','research-tags-v1.json'].map(async (file, index) => {
    const bytes = await readFile(new URL(`../registry/taxonomies/${file}`, import.meta.url));
    if (bytes.length > 1048576) throw new Error('Taxonomy exceeds byte budget');
    const value = JSON.parse(bytes.toString('utf8'));
    const check = (index === 0 ? validateFordDictionary : validateResearchTagDictionary)(value);
    if (!check.ok) throw new Error(check.errors.join('; '));
    const hash = sha256(bytes);
    const descriptor: TaxonomyDescriptor = { scheme: value.scheme, version: value.version, ...(value.revision ? { revision: value.revision } : {}), href: `taxonomies/${hash}.json`, sha256: hash, bytes: bytes.length };
    return { bytes, value, descriptor };
  }));
}
