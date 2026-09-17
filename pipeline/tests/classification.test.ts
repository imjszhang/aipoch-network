import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, sha256 } from '../build.js';
import { validateRegistry, type Registry } from '../registry.js';
import { normalize, type SnapshotBatch } from '../normalize.js';
import { readHistoricalSnapshot } from '../history.js';
import { contentFingerprint, applyCatalogDates, buildPublicationIndex, type PublicationLedger } from '../catalog-dates.js';
import { validateManifest, validateCatalog } from '../../spec/validate.js';
import { validateTaxonomyBindings } from '../../spec/taxonomy-binding.js';
import { ford, researchTags } from '../../spec/classification.js';
async function fixture() { return { registry: JSON.parse(await readFile('registry/catalog.json','utf8')) as Registry, batch: JSON.parse(await readFile('fixtures/pilot/snapshots.json','utf8')) as SnapshotBatch }; }

test('reviewed mappings retain legacy labels, independent field evidence and existing resource types', async () => {
  const {registry,batch} = await fixture(); const data = normalize(registry,batch).catalog;
  assert.equal(data.projects.length,registry.projects.length); assert.equal(data.resources.length,registry.resources.length);
  for (const row of [...data.projects,...data.resources]) {
    const input = (row.kind === 'project' ? registry.projects : registry.resources).find(item => `${row.kind}:${item.key}` === row.id)!;
    assert.deepEqual(row.classification,input.classification); assert.deepEqual(row.research_tags,input.research_tags);
    assert.deepEqual(row.domains,input.domains); assert.deepEqual(row.provenance.classification,input.classification_provenance); assert.deepEqual(row.provenance.research_tags,input.research_tags_provenance);
    if (row.kind === 'resource') assert.equal(row.resource_type,registry.resources.find(item => `resource:${item.key}` === row.id)!.type);
  }
  assert.equal([...data.projects,...data.resources].filter(row => !row.classification?.codes.length).length,10);
  assert.equal(validateCatalog(data).ok,true);
  delete data.projects[0].provenance.classification; assert.equal(validateCatalog(data).ok,false);
});

test('registry rejects unsupported codes, schemes, duplicate tags and missing or unrelated evidence while old records remain valid', async () => {
  const {registry} = await fixture();
  for (const mutate of [
    (r:Registry) => { r.projects[0].classification!.codes=['2.99']; },
    (r:Registry) => { r.projects[0].classification!.version='future'; },
    (r:Registry) => { r.projects[0].research_tags!.ids=['statistics','statistics']; },
    (r:Registry) => { delete r.projects[0].classification_provenance; },
    (r:Registry) => { r.projects[0].classification_provenance![0].url='https://github.com/other/repo/blob/'+'a'.repeat(40)+'/README.md'; },
  ]) { const changed=structuredClone(registry); mutate(changed); assert.ok(validateRegistry(changed).length); }
  for (const row of [...registry.projects,...registry.resources]) { delete row.classification; delete row.research_tags; delete row.classification_provenance; delete row.research_tags_provenance; }
  assert.deepEqual(validateRegistry(registry),[]);
});

test('manifest taxonomy descriptors have unique bounded content-addressed identities', () => {
  const base = {contract_version:'1.2.0',snapshot_id:'test',generated_at:'2026-09-16T00:00:00Z',collections:Object.fromEntries(['sources','actors','organizations','projects','resources','collections','relations','claims','tombstones'].map(key=>[key,[]]))};
  const descriptor={scheme:'future',version:'1',href:`taxonomies/${'a'.repeat(64)}.json`,sha256:'a'.repeat(64),bytes:100};
  assert.equal(validateManifest(base).ok,true);
  assert.equal(validateManifest({...base,taxonomies:[descriptor]}).ok,true);
  for(const taxonomies of [[descriptor,descriptor],[{...descriptor,bytes:1048577}],[{...descriptor,href:'../taxonomy.json'}],[{...descriptor,href:'taxonomies/wrong.json'}]]) assert.equal(validateManifest({...base,taxonomies}).ok,false);
});

test('root and pinned dictionaries preserve exact bytes, history retains them and corruption fails closed', async t => {
  const root=await mkdtemp(join(tmpdir(),'ford-snapshot-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const {registry,batch}=await fixture(); const manifest=await generate(registry,batch,join(root,'output'));
  const pinned=join(root,'output/catalog/v1/snapshots',manifest.snapshot_id);
  const verified=await readHistoricalSnapshot(pinned,manifest.snapshot_id);
  for(const part of manifest.taxonomies!) {
    const bytes=await readFile(join(root,'output/catalog/v1',part.href));assert.equal(sha256(bytes),part.sha256);assert.equal(bytes.length,part.bytes);assert.deepEqual(verified.files.get(part.href),bytes);
  }
  const later=structuredClone(batch);later.as_of=new Date(Date.parse(batch.as_of)+60000).toISOString();
  await generate(registry,later,join(root,'next'),200,{historyDirectory:join(root,'output')});
  await readHistoricalSnapshot(join(root,'next/catalog/v1/snapshots',manifest.snapshot_id),manifest.snapshot_id);
  const part=manifest.taxonomies![0];await writeFile(join(pinned,part.href),'{}');
  await assert.rejects(readHistoricalSnapshot(pinned,manifest.snapshot_id),/hash|size/);
});

test('dictionary bindings reject missing schemes and invalid leaf references but preserve future optional schemes',async()=>{
 const {registry,batch}=await fixture(), data=normalize(registry,batch).catalog;
 const descriptors=[ford,researchTags].map(d=>({scheme:d.scheme,version:d.version,href:'unused',sha256:'a'.repeat(64),bytes:1}));
 const manifest={contract_version:'1.2.0',snapshot_id:'test',generated_at:batch.as_of,collections:Object.fromEntries(['sources','actors','organizations','projects','resources','collections','relations','claims','tombstones'].map(k=>[k,[]])),taxonomies:descriptors} as unknown as import('../../spec/types.js').CatalogManifest;
 validateTaxonomyBindings(data,manifest,[ford,researchTags]);
 assert.throws(()=>validateTaxonomyBindings(data,{...manifest,taxonomies:[]},[]),/missing snapshot/);
 data.projects[0].classification!.codes=['2']; assert.throws(()=>validateTaxonomyBindings(data,manifest,[ford,researchTags]),/assignment/);
 data.projects[0].classification={scheme:'future',version:'9',codes:['x']};
 manifest.taxonomies!.push({scheme:'future',version:'9',href:'unused',sha256:'b'.repeat(64),bytes:1});
 validateTaxonomyBindings(data,manifest,[ford,researchTags,{scheme:'future',version:'9'}]);
});

test('classification changes are material, set ordering and evidence timestamps are not; first publication survives',async()=>{
 const {registry,batch}=await fixture(),data=normalize(registry,batch).catalog,row=data.projects.find(row=>row.classification!.codes.length>1)!;
 const before=contentFingerprint(row,data,registry), changed=structuredClone(row);changed.classification!.codes.reverse();changed.research_tags!.ids.reverse();changed.provenance.classification[0].observed_at='2026-09-17T00:00:00Z';
 assert.equal(contentFingerprint(changed,data,registry),before);changed.classification!.codes=['3.2'];assert.notEqual(contentFingerprint(changed,data,registry),before);
 const index=buildPublicationIndex(data,registry),time='2026-09-15T00:00:00Z';
 const ledger:PublicationLedger={version:1,fingerprint_version:1,repository:'example/network',coverage:'complete',releases:[{...index,repository:'example/network',deployment_run_id:1,deployment_run_attempt:1,refresh_run_id:1,source_sha:'a'.repeat(40),snapshot_id:'b'.repeat(24),artifact_sha256:`sha256:${'c'.repeat(64)}`,file_tree_sha256:`sha256:${'d'.repeat(64)}`,deployed_at:time,evidence:'https://github.com/example/network/actions/runs/1/attempts/1'}]};
 data.projects[data.projects.findIndex(item=>item.id===row.id)]=changed;
 const dated=applyCatalogDates(data,registry,ledger).projects.find(item=>item.id===row.id)!;
 assert.equal(dated.catalog_dates!.first_published.value,time);assert.equal(dated.catalog_dates!.content_updated.basis,'unknown');
});

test('retention keeps a previous dictionary revision at its root URL as well as its pinned snapshot URL',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ford-revision-'));t.after(()=>rm(root,{recursive:true,force:true}));const {registry,batch}=await fixture();
 const manifest=await generate(registry,batch,join(root,'old')),pinned=join(root,'old/catalog/v1/snapshots',manifest.snapshot_id);
 const historical=JSON.parse(await readFile(join(pinned,'manifest.json'),'utf8'));const dictionary={...ford,revision:'2'},bytes=Buffer.from(JSON.stringify(dictionary)),hash=sha256(bytes),part={scheme:ford.scheme,version:ford.version,revision:'2',href:`taxonomies/${hash}.json`,sha256:hash,bytes:bytes.length};
 historical.taxonomies[0]=part;await writeFile(join(pinned,part.href),bytes);await writeFile(join(pinned,'manifest.json'),JSON.stringify(historical));
 const later=structuredClone(batch);later.as_of=new Date(Date.parse(batch.as_of)+60000).toISOString();await generate(registry,later,join(root,'next'),200,{historyDirectory:join(root,'old')});
 assert.deepEqual(await readFile(join(root,'next/catalog/v1',part.href)),bytes);assert.deepEqual(await readFile(join(root,'next/catalog/v1/snapshots',manifest.snapshot_id,part.href)),bytes);
});

test('recovery restores classification values together with their evidence and can restore a legacy record',async()=>{
 const {prepareRecoveryInputs}=await import('../recovery.js');const {registry,batch}=await fixture();const historical=structuredClone(registry);
 for(const row of [...historical.projects,...historical.resources]){delete row.classification;delete row.research_tags;delete row.classification_provenance;delete row.research_tags_provenance;}
 const restored=prepareRecoveryInputs(historical,batch,registry,batch).registry;
 assert.equal(restored.projects[0].classification,undefined);assert.equal(restored.projects[0].classification_provenance,undefined);
 const changed=structuredClone(registry);changed.projects[0].classification!.codes=['3.2'];changed.projects[0].classification!.unclassified_reason=undefined;
 const restoredClassified=prepareRecoveryInputs(registry,batch,changed,batch).registry;
 assert.deepEqual(restoredClassified.projects[0].classification,registry.projects[0].classification);assert.deepEqual(restoredClassified.projects[0].classification_provenance,registry.projects[0].classification_provenance);
});
