import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { COLLECTIONS, loadCatalog, resolveShardUrl } from '../index.mjs';

const time = '2026-09-12T00:00:00Z';
const sourceUrl = 'https://github.com/example/research';
const commit = 'a'.repeat(40);
const note = { role: 'github', url: sourceUrl, observed_at: time, review: 'reviewed' };
const entity = (kind, id, title) => ({ kind, id, title, status: 'listed', updated_at: time, provenance: { title: [note] } });
function fixture() {
  const data = Object.fromEntries(COLLECTIONS.map(name => [name, []]));
  data.actors.push({ ...entity('actor', 'actor:github:1', 'Example'), provider: 'github', provider_id: 1, account_type: 'organization', login: 'example', canonical_url: 'https://github.com/example', aliases: [] });
  data.sources.push({ ...entity('source_repository', 'source:github:2', 'Research'), provider: 'github', provider_id: 2, canonical_url: sourceUrl, owner_id: 'actor:github:1', availability: 'accessible', archived: false, observed_at: time, stale: false, license: { status: 'unknown' }, aliases: [], latest_commit: 'b'.repeat(40) });
  data.organizations.push({ ...entity('organization', 'actor:github:1', 'Example'), actor_id: 'actor:github:1', source_ids: ['source:github:2'], resource_ids: ['resource:alpha', 'resource:beta'], participation: 'community_indexed' });
  data.projects.push({ ...entity('project', 'project:study', 'Multilingual study'), domains: ['genomics'], source_refs: [{ source_id: 'source:github:2', role: 'primary' }], resource_ids: ['resource:alpha', 'resource:beta'] });
  for (const [key, title] of [['alpha', '基因分析 Genomics'], ['beta', 'Data workflow']]) data.resources.push({ ...entity('resource', `resource:${key}`, title), resource_type: 'tool', domains: ['genomics'], source_refs: [{ source_id: 'source:github:2', role: 'implementation', ...(key === 'alpha' ? { commit, path: 'src/run.py', ref: 'v1' } : { ref: 'main' }) }], project_ids: ['project:study'], license: { status: 'unknown' }, runtime: { status: 'not_described' } });
  data.collections.push({ ...entity('collection', 'collection:selected', 'Selected resources'), actor_ids: ['actor:github:1'], item_ids: ['project:study', 'resource:alpha'], selection_basis: 'Community selection' });
  data.relations.push({ kind: 'relation', id: 'relation:produces', from_id: 'project:study', to_id: 'resource:alpha', type: 'produces', evidence: [note], recorded_at: time });
  return data;
}
function site({ data = fixture(), base = 'https://catalog.example/aipoch-network/catalog/v1/manifest.json', shardSize = 1, version = '1.0.0', pinned = false, mutateShard } = {}) {
  const manifest = { contract_version: version, snapshot_id: 'test-snapshot', generated_at: time, collections: {} };
  const files = new Map();
  for (const name of COLLECTIONS) {
    manifest.collections[name] = [];
    for (let offset = 0; offset < Math.max(1, data[name].length); offset += shardSize) {
      const shard = { contract_version: version, snapshot_id: manifest.snapshot_id, collection: name, records: data[name].slice(offset, offset + shardSize) };
      mutateShard?.(shard);
      const body = Buffer.from(JSON.stringify(shard));
      const href = `${pinned ? '' : `snapshots/${manifest.snapshot_id}/`}${name}-${offset / shardSize}.json`;
      manifest.collections[name].push({ href, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), count: shard.records.length });
      files.set(new URL(href, base).href, body);
    }
  }
  const calls = [];
  const publishManifest = () => files.set(base, Buffer.from(JSON.stringify(manifest)));
  publishManifest();
  const fetch = async (url, init) => {
    calls.push({ url, init }); const body = files.get(url);
    return body ? new Response(body, { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(body.length) } }) : new Response('Missing', { status: 404 });
  };
  return { base, files, manifest, calls, fetch, publishManifest };
}

test('reads complete root and project-subpath catalogs using only manifest-declared HTTP JSON', async () => {
  for (const base of ['https://catalog.example/catalog/v1/manifest.json', 'https://catalog.example/aipoch-network/catalog/v1/manifest.json', 'http://127.0.0.1:4321/aipoch-network/catalog/v1/manifest.json']) {
    const origin = site({ base }); const result = await loadCatalog(base, { fetch: origin.fetch });
    assert.equal(result.listResources().length, 2);
    assert.deepEqual(result.listResources('基因').map(item => item.id), ['resource:alpha']);
    assert.deepEqual(result.listResources('ＧＥＮＯＭＩＣＳ').map(item => item.id), ['resource:alpha', 'resource:beta']);
    assert.equal(result.get('actor:github:1').kind, 'actor');
    for (const request of origin.calls) {
      assert.ok(request.url.startsWith(new URL('.', base).href));
      assert.equal(request.init.method, 'GET'); assert.equal(request.init.credentials, 'omit'); assert.equal(request.init.redirect, 'error');
      assert.deepEqual(request.init.headers, { Accept: 'application/json' });
    }
  }
});

test('supports a pinned snapshot manifest and re-sharding without changing identities', async () => {
  const one = site({ shardSize: 1 }); const many = site({ shardSize: 100 });
  const pinned = site({ base: 'https://catalog.example/aipoch-network/catalog/v1/snapshots/test-snapshot/manifest.json', pinned: true });
  const results = await Promise.all([one, many, pinned].map(origin => loadCatalog(origin.base, { fetch: origin.fetch })));
  assert.deepEqual(results[0].collections, results[1].collections);
  assert.deepEqual(results[1].collections, results[2].collections);
  assert.notEqual(one.manifest.collections.resources.length, many.manifest.collections.resources.length);
});

test('ignores added optional fields and handles new resource categories in later v1 minors', async () => {
  const data = fixture(); data.resources[0].resource_type = 'future_instrument'; data.resources[0].future_optional = { note: 'ignored' };
  const origin = site({ data, version: '1.8.3', mutateShard: shard => { shard.future_optional = 'ignored'; } });
  origin.manifest.future_optional = true; origin.manifest.collections.future_collection = [{ href: 'not-fetched.json' }]; origin.publishManifest();
  const result = await loadCatalog(origin.base, { fetch: origin.fetch });
  assert.equal(result.listResources()[0].resource_type, 'future_instrument');
  assert.ok(!origin.calls.some(call => call.url.endsWith('not-fetched.json')));
});

test('optional descriptor count and empty collections remain consumable', async () => {
  const origin = site(); delete origin.manifest.collections.resources[0].count; origin.manifest.collections.claims = []; origin.publishManifest();
  assert.equal((await loadCatalog(origin.base, { fetch: origin.fetch })).collections.claims.length, 0);
});

test('the independent v1 consumer reads v1.1 discovery fields without needing them', async () => {
  const data = fixture();
  data.sources[0].github_metrics = { stars: { value: 0, observed_at: time, last_attempt_at: time, result: 'ok', visibility: 'public_api' } };
  data.sources[0].catalog_dates = { first_published: { basis: 'exact', value: time, evidence: 'https://github.com/example/catalog/actions/runs/1' }, content_updated: { basis: 'unknown' } };
  const origin = site({ data, version: '1.1.0' });
  const catalog = await loadCatalog(origin.base, { fetch: origin.fetch });
  assert.equal(catalog.get('source:github:2').github_metrics.stars.value, 0);
  assert.equal(catalog.locateResource('resource:alpha').sources[0].version.commit, commit);
  assert.equal(catalog.listResources().length, 2);
});

test('fixed source versions never use the latest commit or moving ref as a substitute', async () => {
  const origin = site(); const result = await loadCatalog(origin.base, { fetch: origin.fetch });
  assert.equal(result.locateResource('resource:alpha').sources[0].version.commit, commit);
  assert.equal(result.locateResource('resource:alpha').sources[0].version.status, 'fixed');
  assert.equal(result.locateResource('resource:beta').sources[0].version.status, 'unfixed');
  assert.equal(result.locateResource('resource:beta').sources[0].version.commit, undefined);
  assert.equal(result.locateResource('resource:beta').sources[0].version.ref, 'main');
});

test('withdrawn resources are not listed and latest refresh never revives stale content', async () => {
  const before = site(); const previous = await loadCatalog(before.base, { fetch: before.fetch });
  assert.equal(previous.listResources().length, 2);
  const data = fixture(); data.resources = data.resources.filter(item => item.id !== 'resource:alpha');
  data.tombstones.push({ kind: 'tombstone', id: 'resource:alpha', status: 'withdrawn', withdrawn_at: time, reason: 'withdrawn' });
  const after = site({ data }); const current = await loadCatalog(after.base, { fetch: after.fetch });
  assert.equal(current.listResources().length, 1);
  assert.deepEqual(current.locateResource('resource:alpha'), { id: 'resource:alpha', status: 'withdrawn' });
  assert.equal(current.get('resource:alpha').title, undefined);
  after.files.delete(after.base);
  await assert.rejects(loadCatalog(after.base, { fetch: after.fetch }), /HTTP 200/);
});

test('source tombstones explicitly prevent version or old source URL resolution', async () => {
  const data = fixture(); data.sources = [];
  data.tombstones.push({ kind: 'tombstone', id: 'source:github:2', status: 'withdrawn', withdrawn_at: time, reason: 'unavailable' });
  const origin = site({ data }); const current = await loadCatalog(origin.base, { fetch: origin.fetch });
  assert.deepEqual(current.locateResource('resource:alpha').sources, [{ source_id: 'source:github:2', availability: 'withdrawn', version: { status: 'unavailable' } }]);
});

test('rejects missing collections, duplicate descriptors and unsupported contract majors before shard reads', async () => {
  for (const change of [manifest => { delete manifest.collections.tombstones; }, manifest => { manifest.collections.sources.push(manifest.collections.sources[0]); }, manifest => { manifest.contract_version = '2.0.0'; }]) {
    const origin = site(); change(origin.manifest); origin.publishManifest();
    await assert.rejects(loadCatalog(origin.base, { fetch: origin.fetch })); assert.equal(origin.calls.length, 1);
  }
});

test('rejects path traversal, encoded separators, cross-origin, credentials and ambiguous URLs', async () => {
  const unsafe = ['../secret.json', '%2e%2e/secret.json', 'nested/%2E%2e/secret.json', '%252e%252e/file.json', '/root.json', '//evil.example/file.json', 'https://evil.example/file.json', 'https://user:secret@catalog.example/file.json', 'nested\\file.json', 'nested/%5cfile.json', 'nested/%2ffile.json', 'nested/file.json?token=x', 'nested/file.json#fragment', 'nested//file.json'];
  for (const href of unsafe) {
    const origin = site(); origin.manifest.collections.sources[0].href = href; origin.publishManifest();
    await assert.rejects(loadCatalog(origin.base, { fetch: origin.fetch }), undefined, href); assert.equal(origin.calls.length, 1);
  }
  for (const url of ['https://user:secret@catalog.example/manifest.json', 'file:///tmp/manifest.json', 'https://catalog.example/a/../manifest.json', 'https://catalog.example/manifest.json?token=x']) {
    await assert.rejects(loadCatalog(url, { fetch: () => { throw new Error('must not fetch'); } }));
  }
  assert.equal(resolveShardUrl('https://catalog.example/a/catalog/v1/manifest.json', 'snapshots/a/resources.json'), 'https://catalog.example/a/catalog/v1/snapshots/a/resources.json');
});

test('rejects redirect responses and never follows a location header', async () => {
  let requests = 0;
  await assert.rejects(loadCatalog('https://catalog.example/manifest.json', { fetch: async () => { requests++; return new Response('', { status: 302, headers: { location: 'https://evil.example/manifest.json' } }); } }), /HTTP 200/);
  assert.equal(requests, 1);
});

test('rejects corrupted bytes, truncated shards, count errors and incomplete snapshots', async () => {
  for (const kind of ['hash', 'truncated', 'count', 'missing']) {
    const origin = site(); const part = origin.manifest.collections.resources[0]; const url = new URL(part.href, origin.base).href;
    if (kind === 'hash') { const bytes = Buffer.from(origin.files.get(url)); bytes[bytes.length - 2] ^= 1; origin.files.set(url, bytes); }
    if (kind === 'truncated') origin.files.set(url, origin.files.get(url).subarray(0, 10));
    if (kind === 'count') { part.count += 1; origin.publishManifest(); }
    if (kind === 'missing') origin.files.delete(url);
    await assert.rejects(loadCatalog(origin.base, { fetch: origin.fetch }));
  }
});

test('rejects mixed snapshot, version and collection even when checksum is valid', async () => {
  for (const key of ['snapshot_id', 'contract_version', 'collection']) {
    const origin = site({ mutateShard: shard => { if (shard.collection === 'resources') shard[key] = key === 'contract_version' ? '1.0.1' : 'other'; } });
    await assert.rejects(loadCatalog(origin.base, { fetch: origin.fetch }), /mismatch/);
  }
});

test('rejects identity collisions, missing references and wrong reference kinds', async () => {
  for (const change of [data => { data.resources.push(structuredClone(data.resources[0])); }, data => { data.resources[0].project_ids = ['project:missing']; }, data => { data.resources[0].project_ids = ['source:github:2']; }, data => { data.sources[0].provider_id = 99; }, data => { data.organizations[0].actor_id = 'actor:github:999'; }]) {
    const data = fixture(); change(data); const origin = site({ data }); await assert.rejects(loadCatalog(origin.base, { fetch: origin.fetch }));
  }
});

test('fails closed on unknown safety states instead of treating them as active or verified', async () => {
  for (const change of [data => { data.resources[0].status = 'future_status'; }, data => { data.sources[0].availability = 'future_status'; }, data => { data.resources[0].license.status = 'future_status'; }, data => { data.resources[0].runtime.status = 'future_status'; }, data => { data.resources[0].provenance.title[0] = { ...note, review: 'future_status' }; }, data => { data.organizations[0].participation = 'future_status'; }]) {
    const data = fixture(); change(data); const origin = site({ data }); await assert.rejects(loadCatalog(origin.base, { fetch: origin.fetch }), /unsupported/);
  }
});

test('rejects active private sources, credential URLs and private tombstone fields', async () => {
  for (const change of [data => { data.sources[0].availability = 'private'; }, data => { data.resources[0].download_url = 'https://user:secret@example.org/file'; }, data => { data.tombstones.push({ kind: 'tombstone', id: 'resource:old', status: 'withdrawn', withdrawn_at: time, description: 'withheld' }); }, data => { data.tombstones.push({ kind: 'tombstone', id: 'resource:alpha', status: 'withdrawn', withdrawn_at: time }); }]) {
    const data = fixture(); change(data); const origin = site({ data }); await assert.rejects(loadCatalog(origin.base, { fetch: origin.fetch }));
  }
});

test('rejects credential query keys throughout external links while preserving ordinary query parameters', async () => {
  for (const key of ['access_token', 'TOKEN', 'secret', 'password', 'Authorization', 'api_key', 'client_secret', '%74oken']) {
    for (const change of [
      data => { data.resources[0].documentation_url = `https://example.org/readme?${key}=SYNTHETIC`; },
      data => { data.resources[0].source_refs[0].url = `https://example.org/content?${key}=SYNTHETIC`; },
      data => { data.relations[0].evidence[0].url = `https://example.org/evidence?${key}=SYNTHETIC`; },
    ]) {
      const data = structuredClone(fixture()); change(data); const origin = site({ data });
      await assert.rejects(loadCatalog(origin.base, { fetch: origin.fetch }), /without credentials/);
    }
  }
  const data = structuredClone(fixture()); data.resources[0].documentation_url = 'https://example.org/readme?version=v1&language=zh';
  const origin = site({ data });
  assert.equal((await loadCatalog(origin.base, { fetch: origin.fetch })).get('resource:alpha').documentation_url, data.resources[0].documentation_url);
});

test('enforces relation endpoint meaning independently of valid IDs, hashes and evidence', async () => {
  for (const [type, from_id, to_id] of [
    ['produces', 'resource:alpha', 'project:study'],
    ['fork_of', 'project:study', 'source:github:2'],
    ['authored_by', 'project:study', 'resource:alpha'],
    ['maintained_by', 'source:github:2', 'resource:alpha'],
    ['curated_by', 'collection:selected', 'project:study'],
    ['uses', 'actor:github:1', 'resource:alpha'],
    ['uses', 'resource:alpha', 'actor:github:1'],
    ['supersedes', 'resource:alpha', 'project:study'],
  ]) {
    const data = fixture(); Object.assign(data.relations[0], { type, from_id, to_id }); const origin = site({ data });
    await assert.rejects(loadCatalog(origin.base, { fetch: origin.fetch }), /relation endpoint kinds/);
  }
  for (const [type, from_id, to_id] of [
    ['produces', 'project:study', 'resource:alpha'],
    ['authored_by', 'project:study', 'actor:github:1'],
    ['maintained_by', 'source:github:2', 'actor:github:1'],
    ['curated_by', 'collection:selected', 'actor:github:1'],
    ['uses', 'resource:alpha', 'source:github:2'],
    ['supersedes', 'resource:alpha', 'resource:beta'],
  ]) {
    const data = fixture(); Object.assign(data.relations[0], { type, from_id, to_id }); const origin = site({ data });
    assert.equal((await loadCatalog(origin.base, { fetch: origin.fetch })).collections.relations[0].type, type);
  }
});

test('rejects circular replacement chains while resolving a valid superseded ID explicitly', async () => {
  const data = fixture(); data.tombstones = [{ kind: 'tombstone', id: 'resource:old', status: 'superseded', withdrawn_at: time, replacement_id: 'resource:alpha' }];
  let origin = site({ data }); let result = await loadCatalog(origin.base, { fetch: origin.fetch });
  assert.deepEqual(result.locateResource('resource:old'), { id: 'resource:old', status: 'superseded', replacement_id: 'resource:alpha' });
  data.tombstones.push({ kind: 'tombstone', id: 'resource:older', status: 'superseded', withdrawn_at: time, replacement_id: 'resource:old' });
  data.tombstones[0].replacement_id = 'resource:older'; origin = site({ data });
  await assert.rejects(loadCatalog(origin.base, { fetch: origin.fetch }), /cyclic/);
});

test('organization authorization and claim status are checked independently', async () => {
  const data = fixture(); data.organizations[0].participation = 'actively_curated';
  data.claims.push({ kind: 'claim', id: 'claim:curation', subject_id: 'actor:github:1', actor_id: 'actor:github:1', type: 'organization_curation', status: 'verified', scope: 'Selected resources only', evidence: [note], recorded_at: time, verified_at: time, verified_by: 'actor:github:1', authority: 'organization_owner', recheck_on: ['transfer'] });
  let origin = site({ data }); assert.equal((await loadCatalog(origin.base, { fetch: origin.fetch })).collections.claims.length, 1);
  data.claims[0].authority = 'repository_maintainer'; origin = site({ data }); await assert.rejects(loadCatalog(origin.base, { fetch: origin.fetch }), /unsupported/);
  data.organizations[0].participation = 'community_indexed';
  data.claims[0].status = 'future_status'; origin = site({ data }); await assert.rejects(loadCatalog(origin.base, { fetch: origin.fetch }), /unsupported/);
});

test('external content checksums and commit pinning remain distinct explicit locators', async () => {
  const data = fixture();
  data.resources[1].source_refs[0] = { source_id: 'source:github:2', role: 'data', url: 'https://example.org/archive/data.zip', sha256: 'c'.repeat(64) };
  const origin = site({ data }); const result = await loadCatalog(origin.base, { fetch: origin.fetch });
  assert.equal(result.locateResource('resource:alpha').sources[0].version.basis, 'commit');
  const external = result.locateResource('resource:beta').sources[0].version;
  assert.equal(external.status, 'fixed'); assert.equal(external.basis, 'content_checksum'); assert.equal(external.commit, undefined);
  assert.ok(origin.calls.every(call => !call.url.includes('example.org')));
});

test('immutable content URLs preserve source identity and encode Git-relative paths independently', async () => {
  const data = fixture(); data.resources[0].source_refs[0].path = '研究资料/my protocol.md';
  const origin = site({ data }); const result = await loadCatalog(origin.base, { fetch: origin.fetch });
  const pinned = result.locateResource('resource:alpha').sources[0];
  assert.equal(pinned.canonical_url, sourceUrl);
  assert.equal(pinned.version.path, '研究资料/my protocol.md');
  assert.equal(pinned.version.content_url, `${sourceUrl}/tree/${commit}/${encodeURIComponent('研究资料')}/my%20protocol.md`);
  assert.equal(result.locateResource('resource:beta').sources[0].version.content_url, undefined);
  assert.ok(origin.calls.every(call => !call.url.includes('github.com')));
  for (const path of ['../private', 'path/%2e%2e/private', '/absolute', 'path\\file', 'path?query']) {
    const invalid = fixture(); invalid.resources[0].source_refs[0].path = path;
    const bad = site({ data: invalid }); await assert.rejects(loadCatalog(bad.base, { fetch: bad.fetch }), /repository path/);
  }
});

test('bounded downloads reject excessive manifests, shard sizes, aggregate bytes and records', async () => {
  for (const limits of [{ manifestBytes: 10 }, { shardBytes: 10 }, { totalBytes: 5000 }, { shards: 1 }, { records: 1 }]) {
    const origin = site(); await assert.rejects(loadCatalog(origin.base, { fetch: origin.fetch, limits }), /budget/);
  }
  const origin = site();
  await assert.rejects(loadCatalog(origin.base, { fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); controller.close(); } })), limits: { manifestBytes: 10 } }), /budget/);
});

test('rejects invalid JSON, invalid UTF-8 and interrupted body streams', async () => {
  const base = 'https://catalog.example/manifest.json';
  for (const bytes of [Buffer.from('{bad'), Buffer.from([0xff, 0xfe])]) await assert.rejects(loadCatalog(base, { fetch: async () => new Response(bytes) }), /UTF-8 JSON/);
  await assert.rejects(loadCatalog(base, { fetch: async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('Disconnected')); } })) }), /interrupted/);
});

function taxonomySite({future=false}={}) {
  const data=fixture();
  const fields=[];[7,11,5,5,9,5].forEach((n,i)=>{fields.push({code:String(i+1),parent_code:null,level:1,label_en:`Broad ${i+1}`,label_zh:`大类${i+1}`});for(let j=1;j<=n;j++) fields.push({code:`${i+1}.${j}`,parent_code:String(i+1),level:2,label_en:i===2&&j===2?'Clinical medicine':`Field ${i+1}.${j}`,label_zh:i===2&&j===2?'临床医学':`学科${i+1}.${j}`});});
  const dictionary=future?{scheme:'future',version:'9',notes:'An unknown vocabulary'}:{scheme:'oecd-ford',version:'2015',fields};
  data.resources[0].classification={scheme:dictionary.scheme,version:dictionary.version,codes:future?['x']:['3.2']};data.resources[0].provenance.classification=[note];
  const origin=site({data,version:'1.2.0'}),bytes=Buffer.from(JSON.stringify(dictionary)),hash=createHash('sha256').update(bytes).digest('hex');
  const descriptor={scheme:dictionary.scheme,version:dictionary.version,href:`taxonomies/${hash}.json`,sha256:hash,bytes:bytes.length};
  origin.manifest.taxonomies=[descriptor];origin.files.set(new URL(descriptor.href,origin.base).href,bytes);origin.publishManifest();
  return {...origin,descriptor};
}

test('v1.2 consumes snapshot-bound disciplines and bilingual names; future schemes remain uninterpreted',async()=>{
 const origin=taxonomySite(),result=await loadCatalog(origin.base,{fetch:origin.fetch});assert.equal(result.taxonomies.length,1);
 assert.deepEqual(result.listResources('临床医学').map(row=>row.id),['resource:alpha']);assert.deepEqual(result.listResources('Clinical medicine').map(row=>row.id),['resource:alpha']);
 const future=taxonomySite({future:true}),next=await loadCatalog(future.base,{fetch:future.fetch});assert.equal(next.get('resource:alpha').classification.scheme,'future');assert.equal(next.listResources('Clinical medicine').length,0);
});
test('taxonomy bytes, descriptors and binding failures reject the catalog instead of pretending zero coverage',async()=>{
 for(const mode of ['tamper','missing','duplicate','oversize','path','identity','leaf','provenance']) {
  const origin=taxonomySite(),url=new URL(origin.descriptor.href,origin.base).href;
  if(mode==='tamper') origin.files.set(url,Buffer.from('{}'));
  if(mode==='missing') delete origin.manifest.taxonomies;
  if(mode==='duplicate') origin.manifest.taxonomies.push({...origin.descriptor});
  if(mode==='oversize') origin.descriptor.bytes=1048577;
  if(mode==='path') origin.descriptor.href='../dictionary.json';
  if(mode==='identity') origin.descriptor.version='2014';
  if(mode==='leaf'||mode==='provenance') {
   const part=origin.manifest.collections.resources[0],shardUrl=new URL(part.href,origin.base).href,shard=JSON.parse(origin.files.get(shardUrl));
   if(mode==='leaf') shard.records[0].classification.codes=['3'];else delete shard.records[0].provenance.classification;
   const bytes=Buffer.from(JSON.stringify(shard));part.bytes=bytes.length;part.sha256=createHash('sha256').update(bytes).digest('hex');origin.files.set(shardUrl,bytes);
  }
  origin.publishManifest();await assert.rejects(loadCatalog(origin.base,{fetch:origin.fetch}),undefined,mode);
 }
 const origin=taxonomySite();await assert.rejects(loadCatalog(origin.base,{fetch:origin.fetch,limits:{totalBytes:origin.descriptor.bytes}}),/budget/);
});
