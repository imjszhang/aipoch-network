/** Strict editorial vocabulary validation; public readers preserve unknown future schemes. */
import Ajv from 'ajv';
import { isSafeHttpsUrl } from './identity.js';
import type { ValidationResult } from './types.js';

export interface FordField {
  code: string; parent_code: string | null; level: 1 | 2; label_en: string; label_zh: string;
}
export interface FordDictionary {
  scheme: 'oecd-ford'; version: '2015'; revision: string;
  source: { url: string; doi: string; table: string; printed_page: number; verified_on: string };
  translation_notice: string; rights_notice: string; fields: FordField[];
}
export interface ResearchTag {
  id: string; category: 'method' | 'task' | 'topic'; label_en: string; label_zh: string;
  aliases: string[]; description: string;
}
export interface ResearchTagDictionary {
  scheme: 'aipoch-research-tags'; version: '1'; scope: string; tags: ResearchTag[];
}
export interface ClassificationDraft {
  classification?: { scheme: 'oecd-ford'; version: '2015'; codes: string[]; unclassified_reason?: string };
  research_tags?: { scheme: 'aipoch-research-tags'; version: '1'; ids: string[] };
}
const text = { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' };
const list = (items: object) => ({ type: 'array', items, maxItems: 1000, uniqueItems: true });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addFormat('safe-https-url', isSafeHttpsUrl);
const checkFord = ajv.compile<FordDictionary>(object({
  scheme: { const: 'oecd-ford' }, version: { const: '2015' }, revision: { type: 'string', pattern: '^[1-9][0-9]*$' },
  source: object({ url: { ...text, format: 'safe-https-url' }, doi: { ...text, format: 'safe-https-url' }, table: { const: '2.2' }, printed_page: { const: 59 }, verified_on: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }),
  translation_notice: text, rights_notice: text,
  fields: list(object({ code: { type: 'string', pattern: '^[1-6](\\.[1-9][0-9]*)?$' }, parent_code: { type: ['string', 'null'] }, level: { enum: [1, 2] }, label_en: text, label_zh: text })),
}));
const tagId = { type: 'string', pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$', maxLength: 100 };
const checkTags = ajv.compile<ResearchTagDictionary>(object({
  scheme: { const: 'aipoch-research-tags' }, version: { const: '1' }, scope: text,
  tags: { ...list(object({ id: tagId, category: { enum: ['method', 'task', 'topic'] }, label_en: text, label_zh: text, aliases: list(text), description: text })), minItems: 1 },
}));
const checkDraft = ajv.compile<ClassificationDraft>(object({
  classification: object({ scheme: { const: 'oecd-ford' }, version: { const: '2015' }, codes: list({ type: 'string' }), unclassified_reason: text }, ['scheme', 'version', 'codes']),
  research_tags: object({ scheme: { const: 'aipoch-research-tags' }, version: { const: '1' }, ids: list(tagId) }),
}, []));
const result = (errors: string[]): ValidationResult => ({ ok: !errors.length, errors });
const normalize = (s: string) => s.normalize('NFKC').trim().toLowerCase();

export function validateFordDictionary(input: unknown): ValidationResult {
  if (!checkFord(input)) return result([ajv.errorsText(checkFord.errors)]);
  const dictionary = input as FordDictionary, errors: string[] = [];
  // The fixed standard's full code set, not whatever categories happen to have entries.
  const expected = new Set<string>();
  [7, 11, 5, 5, 9, 5].forEach((count, index) => {
    const parent = String(index + 1); expected.add(parent);
    for (let n = 1; n <= count; n++) expected.add(`${parent}.${n}`);
  });
  const seen = new Set<string>(), labels = new Map<string, string>();
  for (const field of dictionary.fields) {
    if (seen.has(field.code)) errors.push(`duplicate code ${field.code}`);
    seen.add(field.code);
    if (!expected.has(field.code)) errors.push(`unknown FORD 2015 code ${field.code}`);
    const parent = field.code.includes('.') ? field.code.split('.')[0]! : null;
    if (field.parent_code !== parent || field.level !== (parent ? 2 : 1)) errors.push(`wrong parent/level for ${field.code}`);
    for (const [lang, label] of [['en', field.label_en], ['zh', field.label_zh]]) {
      const key = `${lang}:${normalize(label!)}`;
      if (labels.has(key)) errors.push(`duplicate label for ${field.code} and ${labels.get(key)}`);
      labels.set(key, field.code);
    }
  }
  for (const code of expected) if (!seen.has(code)) errors.push(`missing FORD 2015 code ${code}`);
  const date = dictionary.source.verified_on;
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) errors.push('invalid verification date');
  return result(errors);
}

export function validateResearchTagDictionary(input: unknown): ValidationResult {
  if (!checkTags(input)) return result([ajv.errorsText(checkTags.errors)]);
  const errors: string[] = [], ids = new Set<string>(), names = new Map<string, string>();
  for (const tag of (input as ResearchTagDictionary).tags) {
    if (ids.has(tag.id)) errors.push(`duplicate tag ID ${tag.id}`);
    ids.add(tag.id);
    for (const name of [tag.id, tag.label_en, tag.label_zh, ...tag.aliases]) {
      const key = normalize(name), previous = names.get(key);
      if (previous && previous !== tag.id) errors.push(`ambiguous tag name ${name}`);
      names.set(key, tag.id);
    }
  }
  return result(errors);
}

/** Validates an editorial draft; does not imply approval, provenance or catalog inclusion. */
export function validateClassificationDraft(input: unknown, ford: unknown, tags: unknown): ValidationResult {
  const errors = [...validateFordDictionary(ford).errors, ...validateResearchTagDictionary(tags).errors];
  if (errors.length) return result(errors);
  if (!checkDraft(input)) return result([ajv.errorsText(checkDraft.errors)]);
  const draft = input as ClassificationDraft;
  const fields = new Set((ford as FordDictionary).fields.filter(f => f.level === 2).map(f => f.code));
  const tagIds = new Set((tags as ResearchTagDictionary).tags.map(t => t.id));
  if (draft.classification) {
    const { codes, unclassified_reason } = draft.classification;
    for (const code of codes) if (!fields.has(code)) errors.push(`unknown or non-leaf discipline ${code}`);
    if (!codes.length && !unclassified_reason) errors.push('empty classification needs unclassified_reason');
    if (codes.length && unclassified_reason !== undefined) errors.push('classified record cannot have unclassified_reason');
  }
  for (const id of draft.research_tags?.ids ?? []) if (!tagIds.has(id)) errors.push(`unknown research tag ${id}`);
  return result(errors);
}
