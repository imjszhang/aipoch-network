import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFordDictionary, validateResearchTagDictionary, validateClassificationDraft } from '../taxonomy.js';
const read = (name: string) => JSON.parse(readFileSync(new URL(`../../registry/taxonomies/${name}`, import.meta.url), 'utf8'));
const ford = read('oecd-ford-2015.json'), tags = read('research-tags-v1.json');
const assignment = (codes: unknown[] = ['3.2']) => ({ classification: { scheme: 'oecd-ford', version: '2015', codes } });

test('complete standard is independent of catalog occupancy and preserves string codes', () => {
  assert.deepEqual(validateFordDictionary(ford), { ok: true, errors: [] });
  assert.equal(ford.fields.filter((f: any) => f.level === 1).length, 6);
  assert.equal(ford.fields.filter((f: any) => f.level === 2).length, 42);
  assert.equal(ford.fields.find((f: any) => f.code === '3.2').label_en, 'Clinical medicine');
  assert.equal(validateClassificationDraft(assignment(['2.1', '2.10']), ford, tags).ok, true);
  assert.equal(validateClassificationDraft(assignment([2.10]), ford, tags).ok, false);
});

test('missing, duplicate, unknown codes and malformed parentage cannot masquerade as the standard', () => {
  for (const mutate of [
    (d: any) => d.fields.splice(d.fields.findIndex((f: any) => f.code === '3.2'), 1),
    (d: any) => d.fields.push({ ...d.fields[0], label_en: 'Different label' }),
    (d: any) => { d.fields[1].code = '1.8'; },
    (d: any) => { d.fields[1].parent_code = '2'; },
    (d: any) => { d.fields[1].level = 1; },
    (d: any) => { d.fields[1].label_en = '  '; },
    (d: any) => { d.source.verified_on = '2026-02-30'; },
  ]) {
    const changed = structuredClone(ford); mutate(changed);
    assert.equal(validateFordDictionary(changed).ok, false);
  }
  for (const value of [null, [], {}, { ...ford, fields: null }]) assert.equal(validateFordDictionary(value).ok, false);
});

test('tag namespace does not silently merge aliases or confuse topics with disciplines', () => {
  assert.equal(validateResearchTagDictionary(tags).ok, true);
  const collision = structuredClone(tags);
  collision.tags[1].aliases.push(' ＡＳＴＲＯＮＯＭＹ ');
  assert.equal(validateResearchTagDictionary(collision).ok, false);
  const duplicate = structuredClone(tags); duplicate.tags[1].id = duplicate.tags[0].id;
  assert.equal(validateResearchTagDictionary(duplicate).ok, false);
  assert.equal(validateClassificationDraft(assignment(['machine-learning']), ford, tags).ok, false);
  assert.equal(validateClassificationDraft({ research_tags: { scheme: 'aipoch-research-tags', version: '1', ids: ['image-analysis'] } }, ford, tags).ok, true);
});

test('missing legacy classification differs from an explicitly unclassified draft', () => {
  assert.equal(validateClassificationDraft({}, ford, tags).ok, true);
  assert.equal(validateClassificationDraft(assignment([]), ford, tags).ok, false);
  const unclassified = { classification: { ...assignment([]).classification, unclassified_reason: 'Insufficient domain evidence' } };
  assert.equal(validateClassificationDraft(unclassified, ford, tags).ok, true);
  assert.equal(validateClassificationDraft({ classification: { ...unclassified.classification, codes: ['3.2'] } }, ford, tags).ok, false);
});

test('assignment rejects unknown versions, parent-only codes, duplicates and unknown tags', () => {
  for (const value of [
    assignment(['3']), assignment(['3.99']), assignment(['3.2', '3.2']),
    { classification: { ...assignment().classification, version: 'future' } },
    { research_tags: { scheme: 'aipoch-research-tags', version: '2', ids: [] } },
    { research_tags: { scheme: 'aipoch-research-tags', version: '1', ids: ['not-in-dictionary'] } },
    { research_tags: { scheme: 'aipoch-research-tags', version: '1', ids: ['image-analysis', 'image-analysis'] } },
  ]) assert.equal(validateClassificationDraft(value, ford, tags).ok, false);
  assert.equal(validateClassificationDraft(assignment(['1.6', '3.2']), ford, tags).ok, true);
  assert.equal(validateClassificationDraft(assignment(), { ...ford, version: 'future' }, tags).ok, false);
});
