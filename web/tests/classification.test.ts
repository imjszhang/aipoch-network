import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureCatalog } from '../../spec/fixtures/catalog.js';
import { fieldMatches, disciplineLabels, ford } from '../../spec/classification.js';
import { parseDiscovery, matchesDiscovery, changeDiscovery } from '../src/discovery.js';
import { searchDocuments, makeSearchIndex } from '../src/search.js';
const time='2026-09-17T00:00:00Z';
test('full standard includes empty clinical medicine, parent aggregation and distinct string codes',()=>{
 assert.equal(ford.fields.filter(f=>f.level===1).length,6);assert.equal(ford.fields.filter(f=>f.level===2).length,42);assert.equal(ford.fields.find(f=>f.code==='3.2')?.label_en,'Clinical medicine');
 const row={classification:{scheme:'oecd-ford',version:'2015',codes:['2.10','2.11']}};
 assert.equal(fieldMatches(row,'2'),true);assert.equal(fieldMatches(row,'2.1'),false);assert.equal(fieldMatches(row,'2.10'),true);
 assert.equal(fieldMatches({classification:{scheme:'future',version:'2015',codes:['2.10']}},'2.10'),false);
 assert.equal(fieldMatches({},'unrecorded'),true);assert.equal(fieldMatches({},'unclassified'),false);
 assert.deepEqual(disciplineLabels({domains:['Old']}),['Legacy: Old']);
});
test('discipline/tag OR groups combine with resource type AND; unknown links are repairable and account switches clear scope',()=>{
 const data=createFixtureCatalog(),row=data.resources[0];row.classification={scheme:'oecd-ford',version:'2015',codes:['1.2','3.2']};row.research_tags={scheme:'aipoch-research-tags',version:'1',ids:['machine-learning']};
 const matches=(q:string)=>matchesDiscovery(row,data,parseDiscovery(new URLSearchParams(q),'all',time));
 assert.equal(matches(`field=3,2.10&tag=statistics,machine-learning&resource_type=${row.resource_type}`),true);
 assert.equal(matches('field=2.1&tag=machine-learning'),false);assert.equal(matches('field=3.2&tag=statistics'),false);assert.equal(matches('field=9'),false);
 assert.ok(parseDiscovery(new URLSearchParams('field=1,1'),'all',time).errors.length);
 assert.ok(parseDiscovery(new URLSearchParams('resource_type=tool'),'project',time).errors.length);
 const next=changeDiscovery(new URLSearchParams('field=3.2&tag=statistics&resource_type=tool&domain=old'),{type:'actor'},'all');assert.equal(next.params.toString(),'type=actor');
 assert.equal(changeDiscovery(new URLSearchParams('field=1.2'),{min_followers:'10'},'all').params.has('field'),false);
});
test('search uses standard bilingual names, parent disciplines and method aliases without rewriting legacy labels',()=>{
 const data=createFixtureCatalog();data.resources[0].classification={scheme:'oecd-ford',version:'2015',codes:['3.2']};data.resources[0].research_tags={scheme:'aipoch-research-tags',version:'1',ids:['machine-learning']};
 const index=makeSearchIndex(searchDocuments(data));for(const query of ['Clinical medicine','临床医学','Medical','machine learning']) assert.ok(index.search(query).some(row=>row.id===data.resources[0].id),query);
 assert.equal(data.resources[0].domains.includes('Clinical medicine'),false);
});
