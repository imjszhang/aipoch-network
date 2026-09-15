import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureCatalog, FIXTURE_TIME } from '../../spec/fixtures/catalog.js';
import { verificationData } from '../../scripts/verification-site.js';
import { routeFor, type SiteData } from '../src/model.js';
import { directoryHref, directoryPageCount, parseDirectoryPath, prerenderPaths } from '../src/directory-routes.js';
import { HOME_DESCRIPTION, HOME_TITLE, robotsText, seoForPath, sitemapEntries, sitemapXml } from '../src/seo.js';
import { OFFICIAL_ORIGIN, parseSiteOrigin, siteConfigFromEnv } from '../src/site-url.js';

const fixture = (): SiteData => ({ snapshot_id: 'seo-fixture', generated_at: FIXTURE_TIME, catalog: createFixtureCatalog() });
const official = { origin: OFFICIAL_ORIGIN, base: '/', indexing: true } as const;

test('SITE_ORIGIN rejects host-like and non-https values', () => {
  assert.equal(parseSiteOrigin('https://aipoch.network'), OFFICIAL_ORIGIN);
  for (const value of ['http://aipoch.network', 'https://aipoch.network/path/', 'https://user:pass@aipoch.network', 'https://evil.example', 'aipoch.network']) {
    assert.throws(() => parseSiteOrigin(value));
  }
  assert.equal(siteConfigFromEnv({ SITE_ORIGIN: OFFICIAL_ORIGIN, SITE_BASE: '/', HOST: 'evil.example', HTTP_HOST: 'evil.example' }).origin, OFFICIAL_ORIGIN);
  assert.equal(siteConfigFromEnv({ SITE_ORIGIN: OFFICIAL_ORIGIN, SITE_BASE: '/aipoch-network/' }).indexing, false);
});

test('URL matrix matches index, canonical and sitemap policy', () => {
  const data = verificationData(80);
  const home = seoForPath('/', data, official);
  assert.equal(home.title, HOME_TITLE);
  assert.equal(home.description, HOME_DESCRIPTION);
  assert.equal(home.canonicalUrl, 'https://aipoch.network/');
  assert.equal(home.robots, 'index, follow');
  assert.equal(home.sitemap, true);
  assert.equal(home.jsonLd[0]?.['@type'], 'WebSite');

  const projects = seoForPath('/projects/', data, official);
  assert.equal(projects.canonicalUrl, 'https://aipoch.network/projects/');
  assert.equal(projects.sitemap, true);
  assert.equal(projects.jsonLd[0]?.['@type'], 'CollectionPage');

  const page2 = seoForPath('/capabilities/?page=2', data, official);
  assert.equal(page2.canonicalUrl, 'https://aipoch.network/capabilities/page/2/');
  assert.equal(page2.sitemap, false);
  assert.equal(page2.robots, 'index, follow');

  const path2 = seoForPath('/capabilities/page/2/', data, official);
  assert.equal(path2.canonicalUrl, 'https://aipoch.network/capabilities/page/2/');
  assert.equal(path2.sitemap, false);
  assert.equal(path2.title, 'Reusable capabilities, page 2 | AIPOCH Network');

  const clamped = seoForPath('/projects/?page=2', data, official);
  assert.equal(clamped.canonicalUrl, 'https://aipoch.network/projects/');
  assert.equal(clamped.robots, 'index, follow');

  const search = seoForPath('/explore/?q=scanpy', data, official);
  assert.equal(search.robots, 'noindex, follow');
  assert.equal(search.canonicalUrl, 'https://aipoch.network/explore/?q=scanpy');
  assert.equal(search.sitemap, false);

  const sortTitle = seoForPath('/projects/?sort=title', data, official);
  assert.equal(sortTitle.canonicalUrl, 'https://aipoch.network/projects/');
  assert.equal(sortTitle.robots, 'index, follow');
  assert.equal(sortTitle.sitemap, false);

  const stars = seoForPath('/projects/?sort=stars', data, official);
  assert.equal(stars.robots, 'noindex, follow');
  assert.equal(stars.canonicalUrl, 'https://aipoch.network/projects/?sort=stars');
  assert.equal(stars.sitemap, false);

  const tracking = seoForPath('/capabilities/?utm_source=newsletter&page=2', data, official);
  assert.equal(tracking.canonicalUrl, 'https://aipoch.network/capabilities/page/2/');
  assert.equal(tracking.sitemap, false);

  const submit = seoForPath('/submit/', data, official);
  assert.equal(submit.robots, 'noindex, follow');
  assert.equal(submit.sitemap, false);
  assert.equal(submit.title, 'Share research | AIPOCH Network');

  const contribute = seoForPath('/contribute/', data, official);
  assert.equal(contribute.robots, 'index, follow');
  assert.equal(contribute.sitemap, true);

  const capability = data.catalog.resources[0]!;
  const capabilitySeo = seoForPath(routeFor(capability), data, official);
  assert.equal(capabilitySeo.canonicalUrl, `https://aipoch.network${routeFor(capability)}`);
  assert.equal(capabilitySeo.sitemap, true);
  assert.equal(capabilitySeo.jsonLd[0]?.['@type'], 'CreativeWork');
  assert.notEqual(capabilitySeo.jsonLd[0]?.['@type'], 'SoftwareApplication');

  const organization = data.catalog.organizations[0]!;
  organization.description = undefined;
  const orgSeo = seoForPath(routeFor(organization), data, official);
  assert.equal(orgSeo.description, 'Selected public research from this GitHub organization.');
  assert.equal(orgSeo.sitemap, true);

  const preview = seoForPath('/projects/', data, { origin: OFFICIAL_ORIGIN, base: '/aipoch-network/', indexing: false });
  assert.equal(preview.robots, 'noindex, follow');
  assert.equal(preview.canonicalUrl, 'https://aipoch.network/aipoch-network/projects/');
  assert.equal(preview.sitemap, false);
});

test('path parser and hrefs keep query share links and reject unsafe page segments', () => {
  assert.deepEqual(parseDirectoryPath('/projects/page/2/'), { section: 'projects', kind: 'project', page: 2 });
  assert.equal(parseDirectoryPath('/projects/page/1/'), undefined);
  assert.equal(parseDirectoryPath('/projects/page/0/'), undefined);
  assert.equal(parseDirectoryPath('/projects/page/-2/'), undefined);
  assert.equal(parseDirectoryPath('/projects/page/NaN/'), undefined);
  assert.equal(parseDirectoryPath('/projects/project~scanpy/'), undefined);
  assert.equal(directoryHref('projects', 2, new URLSearchParams()), '/projects/page/2/');
  assert.equal(directoryHref('projects', 2, new URLSearchParams('sort=title')), '/projects/?sort=title&page=2');
  assert.equal(directoryHref('projects', 1, new URLSearchParams('page=1')), '/projects/');
  const data = verificationData(80);
  assert.ok(directoryPageCount(data, 'resource') > 2);
  assert.ok(prerenderPaths(data).includes('/capabilities/page/2/'));
  assert.ok(!prerenderPaths(data).includes('/capabilities/page/1/'));
  assert.ok(parseDirectoryPath('/capabilities/page/10/')?.page === 10);
});

test('sitemap contains only rendered indexable canonical URLs and escapes XML', () => {
  const data = fixture();
  data.catalog.resources[0]!.title = 'A & B <method>';
  const paths = prerenderPaths(data);
  const urls = sitemapEntries(data, official, paths);
  assert.ok(urls.includes('https://aipoch.network/'));
  assert.ok(urls.includes('https://aipoch.network/projects/'));
  assert.ok(!urls.some(url => url.includes('/page/')));
  assert.ok(!urls.includes('https://aipoch.network/submit/'));
  assert.ok(!urls.includes('https://aipoch.network/explore/?q=scanpy'));
  const xml = sitemapXml(['https://aipoch.network/x?a=1&b=<y>']);
  assert.ok(xml.includes('&amp;'));
  assert.ok(xml.includes('&lt;y&gt;'));
  assert.ok(!xml.includes('<lastmod>'));
  const preview = sitemapEntries(data, { origin: OFFICIAL_ORIGIN, base: '/aipoch-network/', indexing: false }, paths);
  assert.deepEqual(preview, []);
  assert.ok(!robotsText({ origin: OFFICIAL_ORIGIN, base: '/aipoch-network/', indexing: false }).includes('Sitemap:'));
  assert.ok(robotsText(official).includes('Sitemap: https://aipoch.network/sitemap.xml'));
});

test('unbuilt pagination paths do not become indexable after hydration', () => {
  const decision = seoForPath('/projects/page/999/', fixture(), official);
  assert.equal(decision.indexable, false);
  assert.deepEqual(decision.jsonLd, []);
});
