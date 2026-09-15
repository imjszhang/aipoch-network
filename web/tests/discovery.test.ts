import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { createFixtureCatalog } from '../../spec/fixtures/catalog.js';
import type { CatalogData, MetricObservation, Project } from '../../spec/types.js';
import { DAY, changeDiscovery, compareDiscovery, eligibleSources, freshness, matchesDiscovery, metricValue, parseDiscovery, presetDates, representativeSource, sourceCommit } from '../src/discovery.js';
import { CatalogDateFacts, EntryFacts, ObservationClock } from '../src/catalog-observations.js';
import type { Entry } from '../src/model.js';
const NOW = '2026-09-15T12:00:00Z', time = Date.parse(NOW);
const metric = (value: number, age = 0): MetricObservation => ({ value, observed_at:new Date(time-age).toISOString(), last_attempt_at:NOW, result:'ok',visibility:'public_api' });
function fixture(): CatalogData {
  const catalog = createFixtureCatalog();
  catalog.sources.forEach((source,index) => {
    source.github_metrics = { stars:metric(index ? 500 : 100), forks:metric(index ? 5 : 50) };
    source.observation = { last_attempt_at:NOW,last_success_at:NOW,result:'ok' };
    source.source_activity = { default_branch_head:{ sha:'a'.repeat(40), committed_at:index ? '2026-09-14T01:00:00Z' : '2026-01-01T00:00:00Z', observed_at:NOW,date_status:'valid' } };
  });
  return catalog;
}
const filters = (query: string, kind = 'all') => parseDiscovery(new URLSearchParams(query),kind,NOW);
const selected = (catalog: CatalogData, query: string, rows: Entry[]) => rows.filter(entry => matchesDiscovery(entry,catalog,filters(query))).sort((a,b) => compareDiscovery(a,b,catalog,filters(query)));

test('repository criteria need one eligible source witness, not a union of independent successes', () => {
  const catalog = fixture();
  const project: Project = { ...catalog.projects[0],source_refs:[{source_id:catalog.sources[0].id,role:'primary'},{source_id:catalog.sources[1].id,role:'implementation'},{source_id:catalog.sources[1].id,role:'implementation'}] };
  assert.equal(eligibleSources(project,catalog).length,2);
  assert.equal(matchesDiscovery(project,catalog,filters('min_stars=400&min_forks=40')),false);
  assert.equal(matchesDiscovery(project,catalog,filters('min_stars=400&source_after=2026-09-01')),true);
  assert.equal(representativeSource(project,catalog,filters('min_forks=40&sort=stars'))?.id,catalog.sources[0].id);
  catalog.sources[0].stale=false; catalog.sources[1].stale=true;
  assert.equal(matchesDiscovery(project,catalog,filters('min_forks=40&access=stale')),false);
  catalog.organizations[0].source_ids=[catalog.sources[1].id];
  assert.equal(matchesDiscovery(project,catalog,filters(`min_forks=40&organization=${catalog.organizations[0].id}`)),false);
  project.source_refs[0].commit='a'.repeat(40);
  assert.equal(matchesDiscovery(project,catalog,filters('min_stars=400&access=pinned')),false);
  project.source_refs[1].role = 'documentation'; project.source_refs.pop();
  project.source_refs[1].commit='b'.repeat(40);
  assert.equal(matchesDiscovery(project,catalog,filters(`access=pinned&organization=${catalog.organizations[0].id}`)),true);
  assert.equal(matchesDiscovery(project,catalog,filters(`access=pinned&organization=${catalog.organizations[0].id}&min_stars=0`)),false);
  assert.equal(matchesDiscovery(project,catalog,filters('min_stars=400')),false);
});

test('real zero passes a zero threshold while missing, stale-by-default and expired metrics do not', () => {
  assert.equal(metricValue(metric(0),time),0);
  assert.equal(metricValue(undefined,time),undefined);
  assert.equal(metricValue(metric(10,2*DAY),time),10);
  assert.equal(metricValue(metric(10,2*DAY+1),time),undefined);
  assert.equal(metricValue(metric(10,2*DAY+1),time,true),10);
  assert.equal(metricValue(metric(10,7*DAY),time,true),10);
  assert.equal(metricValue(metric(10,7*DAY+1),time,true),undefined);
  assert.equal(metricValue(metric(10,-1),time,true),undefined);
  assert.equal(freshness('not-a-date',time),'missing');
  const catalog=fixture(), source=catalog.sources[0];
  source.github_metrics={ stars:metric(0) };
  assert.equal(matchesDiscovery(source,catalog,filters('min_stars=0')),true);
  assert.equal(matchesDiscovery(source,catalog,filters('min_forks=0')),false);
  source.github_metrics.stars=metric(5,3*DAY);
  assert.equal(matchesDiscovery(source,catalog,filters('min_stars=0')),false);
  assert.equal(matchesDiscovery(source,catalog,filters('min_stars=0&include_stale_metrics=1')),true);
});

test('shared filters reject duplicates, unsafe numbers, invalid dates, reversed ranges and enum errors', () => {
  for (const query of ['min_stars=-1','min_stars=1.1','min_stars=Infinity','min_stars=9007199254740992','min_stars=','min_stars=1&min_stars=2','q=a&q=b','added_after=2026-02-30','added_after=2026-09-16&added_before=2026-09-15','added_date=unknown&added_after=2026-09-01','observation=live','include_stale_metrics=true','sort=popularity','sort=toString','sort=__proto__','type=toString','access=garbage']) assert.ok(filters(query).errors.length,query);
  assert.equal(filters('min_stars=9007199254740991&added_after=2024-02-29').errors.length,0);
});

test('interactive scope changes clear conflicts with feedback while direct links require repair', () => {
  assert.ok(filters('min_stars=10&min_followers=20').errors.length);
  assert.ok(filters('domain=Biology&min_followers=20').errors.length);
  assert.equal(changeDiscovery(new URLSearchParams('domain=Biology&access=pinned&organization=actor:101'),{min_followers:'1'},'all').params.toString(),'min_followers=1');
  assert.ok(filters('min_stars=10','organization').errors.length);
  assert.ok(filters('min_followers=1','resource').errors.length);
  const account = changeDiscovery(new URLSearchParams('min_stars=10&sort=stars&page=3&added_after=2026-09-01'),{min_followers:'20'},'all');
  assert.equal(account.params.has('min_stars'),false); assert.equal(account.params.has('sort'),false); assert.equal(account.params.has('page'),false); assert.equal(account.params.get('added_after'),'2026-09-01'); assert.ok(account.notice);
  const category = changeDiscovery(new URLSearchParams('min_followers=10&sort=followers&added_date=unknown'),{type:'project'},'all');
  assert.equal(category.params.has('min_followers'),false); assert.equal(category.params.get('added_date'),'unknown'); assert.ok(category.notice);
  for (const type of ['organization','actor','collection','source_repository']) {
    const next=changeDiscovery(new URLSearchParams('domain=Bioinformatics&organization=actor:101&access=pinned'),{type},'all');
    assert.equal(next.params.has('domain'),false); assert.equal(next.params.has('organization'),false); assert.equal(next.params.has('access'),false);
    assert.ok(filters(`type=${type}&organization=actor:101`).errors.length); assert.ok(filters(`type=${type}&domain=Biology`).errors.length);
  }
  const catalog=fixture();
  assert.equal(matchesDiscovery(catalog.collections[0],catalog,filters('sort=stars')),false);
  assert.equal(matchesDiscovery({...catalog.projects[0],source_refs:[]},catalog,filters('sort=stars')),true);
});

test('inclusive UTC days exclude historical bounds and remain reproducible across date boundaries', () => {
  assert.deepEqual(presetDates('added',7,Date.parse('2026-09-15T23:59:59Z')),{added_after:'2026-09-09',added_before:'2026-09-15',added_date:''});
  const catalog=fixture(), entry=catalog.projects[0];
  const match=() => matchesDiscovery(entry,catalog,filters('added_after=2026-09-15&added_before=2026-09-15'));
  entry.catalog_dates={first_published:{basis:'exact',value:'2026-09-15T23:59:59Z'},content_updated:{basis:'unknown'}};
  assert.equal(match(),true);
  entry.catalog_dates.first_published.value='2026-09-16T00:00:00Z'; assert.equal(match(),false);
  entry.catalog_dates.first_published={basis:'observed_bound',value:'2026-09-15T00:00:00Z'}; assert.equal(match(),false);
  assert.equal(matchesDiscovery(entry,catalog,filters('added_date=unknown')),true);
  delete entry.catalog_dates; assert.equal(match(),false);
});

test('activity uses only a verified current default-branch committer date', () => {
  const catalog=fixture(), source=catalog.sources[1], head=source.source_activity!.default_branch_head!;
  assert.equal(sourceCommit(source,time),'2026-09-14T01:00:00Z');
  head.date_status='future'; assert.equal(sourceCommit(source,time),undefined);
  head.date_status='valid'; head.committed_at='2026-09-16T00:00:00Z'; assert.equal(sourceCommit(source,time),undefined);
  head.committed_at='2026-09-14T01:00:00Z'; head.observed_at='2026-09-01T00:00:00Z'; assert.equal(sourceCommit(source,time),undefined);
  assert.equal(matchesDiscovery(source,catalog,filters('source_date=unknown')),true);
});

test('date and metric sorts place exact ahead of bounds and stale values in an unranked stable-ID tail', () => {
  const catalog=fixture(), original=catalog.projects[0];
  const rows: Project[] = [
    {...original,id:'project:z',catalog_dates:{first_published:{basis:'observed_bound',value:'2026-09-15T00:00:00Z'},content_updated:{basis:'unknown'}}},
    {...original,id:'project:a',catalog_dates:{first_published:{basis:'exact',value:'2026-01-01T00:00:00Z'},content_updated:{basis:'unknown'}}},
    {...original,id:'project:m'},
  ];
  assert.deepEqual(selected(catalog,'sort=added',rows).map(row=>row.id),['project:a','project:z','project:m']);
  catalog.sources[0].github_metrics!.stars=metric(1000,3*DAY);
  const ranked=selected(catalog,'sort=stars',catalog.sources);
  assert.equal(ranked.at(-1)?.id,catalog.sources[0].id);
  assert.equal(selected(catalog,'sort=stars&include_stale_metrics=1',catalog.sources)[0].id,catalog.sources[0].id);
  assert.equal(filters('sort=updated').sort,'updated');
});

test('organizations share canonical actor metrics and account filters never substitute catalog membership', () => {
  const catalog=fixture(), organization=catalog.organizations[0], actor=catalog.actors.find(row=>row.id===organization.actor_id)!;
  actor.github_metrics={followers:metric(0),public_repositories:metric(500)};
  assert.equal(matchesDiscovery(organization,catalog,filters('min_followers=0')),true);
  assert.equal(matchesDiscovery(organization,catalog,filters('min_followers=1')),false);
  actor.observation={last_attempt_at:NOW,last_success_at:new Date(time-3*DAY).toISOString(),result:'unavailable'};
  assert.equal(matchesDiscovery(organization,catalog,filters('observation=stale')),true);
});

test('public cards qualify historical bounds, identify source metrics and never render missing counts as zero', () => {
  const catalog=fixture(), entry=catalog.projects[0];
  entry.catalog_dates={first_published:{basis:'observed_bound',value:'2026-09-13T00:00:00Z'},content_updated:{basis:'unknown'}};
  const dates=renderToStaticMarkup(React.createElement(CatalogDateFacts,{entry}));
  assert.match(dates,/Listed by/); assert.match(dates,/Catalog updated unknown/);
  const facts=renderToStaticMarkup(React.createElement(ObservationClock,{generatedAt:NOW,children:React.createElement(EntryFacts,{entry,catalog})}));
  assert.match(facts,/GitHub/); assert.match(facts,/publicly reported/); assert.match(facts,/100 stars/);
  entry.source_refs=[];
  assert.match(renderToStaticMarkup(React.createElement(ObservationClock,{generatedAt:NOW,children:React.createElement(EntryFacts,{entry,catalog})})),/source metrics unknown/);
});
