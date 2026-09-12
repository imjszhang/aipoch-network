import test from 'node:test';
import assert from 'node:assert/strict';
import MiniSearch from 'minisearch';
import { makeSearchIndex, searchOptions, type SearchDocument } from '../../web/src/search.js';

const documents: SearchDocument[] = [
  { id: 'project:clinical', title: '临床队列风险分析', text: '研究术后并发症与敏感性分析。', kind: 'project', domains: ['Clinical research'] },
  { id: 'resource:survival', title: 'Survival analysis workflow', text: 'Clinical cohort sensitivity checks and statistical reports.', kind: 'resource', domains: ['Biostatistics'] },
  { id: 'project:dna', title: 'DNA treatment response', text: '基因表达与治疗反应研究', kind: 'project', domains: ['Bioinformatics'] },
  { id: 'resource:materials', title: 'Materials stability map', text: 'Perovskite energy studies', kind: 'resource', domains: ['Materials science'] },
];

test('search finds English words and prefixes case-insensitively and preserves stable result metadata', () => {
  const index = makeSearchIndex(documents);
  const results = index.search('SURVIVAL analy');
  assert.equal(results[0]?.id, 'resource:survival');
  assert.equal(results[0]?.kind, 'resource');
  assert.deepEqual(results[0]?.domains, ['Biostatistics']);
  assert.equal(index.search('unfindablequasar').length, 0);
  assert.equal(index.search('').length, 0);
});

test('Chinese search finds interior research terms and phrases without spaces', () => {
  const index = makeSearchIndex(documents);
  for (const term of ['队列', '队列风险', '敏感性分析', '析', '队', '基因表达']) {
    const expected = term === '基因表达' ? 'project:dna' : 'project:clinical';
    assert.ok(index.search(term).some(row => row.id === expected), `missing Chinese search result for ${term}`);
  }
});

test('Unicode normalization supports full-width Latin input and a mixed-language query', () => {
  const index = makeSearchIndex(documents);
  assert.equal(index.search('ＤＮＡ')[0]?.id, 'project:dna');
  assert.equal(index.search('DNA 治疗')[0]?.id, 'project:dna');
});

test('a generated search index can be loaded by the browser with equivalent Chinese and English results', () => {
  const built = makeSearchIndex(documents);
  const loaded = MiniSearch.loadJSON<SearchDocument>(JSON.stringify(built), searchOptions);
  for (const query of ['Survival', '队列', 'ＤＮＡ', 'materials stability']) {
    assert.deepEqual(loaded.search(query).map(row => row.id), built.search(query).map(row => row.id));
  }
});
