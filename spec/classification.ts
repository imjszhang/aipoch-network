/** Pure presentation helpers use the same dictionaries pinned by this build's manifest. */
import fordData from '../registry/taxonomies/oecd-ford-2015.json' with { type: 'json' };
import tagData from '../registry/taxonomies/research-tags-v1.json' with { type: 'json' };
import type { FordDictionary, ResearchTagDictionary } from './taxonomy.js';
import type { ResearchClassification } from './types.js';
export const ford = fordData as FordDictionary;
export const researchTags = tagData as ResearchTagDictionary;
export function knownClassification(row: ResearchClassification) { return row.classification?.scheme === ford.scheme && row.classification.version === ford.version ? row.classification : undefined; }
export function knownTags(row: ResearchClassification) { return row.research_tags?.scheme === researchTags.scheme && row.research_tags.version === researchTags.version ? row.research_tags.ids : []; }
export function fieldMatches(row: ResearchClassification, code: string): boolean {
  const field = knownClassification(row);
  if (code === 'unrecorded') return !row.classification;
  if (code === 'unclassified') return Boolean(field && !field.codes.length);
  return Boolean(field?.codes.some(value => value === code || value.split('.')[0] === code));
}
export function disciplineLabels(row: ResearchClassification & { domains?: string[] }): string[] {
  const classification = knownClassification(row);
  if (!classification) return row.classification ? ['Unrecognized discipline scheme'] : (row.domains ?? []).map(value => `Legacy: ${value}`);
  return classification.codes.length ? classification.codes.map(code => ford.fields.find(field => field.code === code)?.label_en ?? code) : ['Awaiting discipline classification'];
}
export function classificationText(row: ResearchClassification): string {
  const codes = knownClassification(row)?.codes ?? [], ids = knownTags(row);
  return [...ford.fields.filter(field => codes.some(code => code === field.code || code.split('.')[0] === field.code)).flatMap(field => [field.code,field.label_en,field.label_zh]), ...researchTags.tags.filter(tag => ids.includes(tag.id)).flatMap(tag => [tag.id,tag.label_en,tag.label_zh,...tag.aliases])].join(' ');
}
