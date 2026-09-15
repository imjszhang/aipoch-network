import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureCatalog, FIXTURE_COMMIT, FIXTURE_TIME } from '../fixtures/catalog.js';
import { validateCatalog, validateShard } from '../validate.js';
import { CONTRACT_VERSION, type MetricObservation } from '../types.js';

const metric = (value = 0): MetricObservation => ({ value, observed_at: FIXTURE_TIME, last_attempt_at: FIXTURE_TIME, result: 'ok', visibility: 'public_api' });
test('v1.1 optional discovery fields preserve absent legacy data and publicly reported zero', () => {
  const data = createFixtureCatalog();
  assert.equal(validateCatalog(data).ok, true);
  data.sources[0].github_metrics = { stars: metric(), forks: metric(2) };
  data.actors[0].github_metrics = { followers: metric() };
  data.projects[0].catalog_dates = { first_published: { basis: 'observed_bound', value: FIXTURE_TIME, evidence: 'https://github.com/example/catalog/actions/runs/1' }, content_updated: { basis: 'unknown' } };
  assert.deepEqual(validateCatalog(data), { ok: true, errors: [] });
  assert.equal(validateShard({ contract_version: CONTRACT_VERSION, snapshot_id: 'optional-fields', collection: 'sources', records: data.sources }).ok, true);
});
test('metric validation rejects invented zero, unsafe counts and contradictory observation times', () => {
  for (const bad of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    const data = createFixtureCatalog(); data.sources[0].github_metrics = { stars: metric(bad) };
    assert.equal(validateCatalog(data).ok, false);
  }
  const data = createFixtureCatalog(); data.sources[0].github_metrics = { stars: { last_attempt_at: FIXTURE_TIME, result: 'unavailable', visibility: 'public_api' } };
  assert.equal(validateCatalog(data).ok, true);
  data.sources[0].github_metrics.stars!.result = 'ok';
  assert.equal(validateCatalog(data).ok, false);
  data.sources[0].github_metrics.stars = { ...metric(), observed_at: '2030-01-01T00:00:00Z' };
  assert.match(validateCatalog(data).errors.join(' '), /observation cannot follow/);
});
test('date bounds require evidence, unknown dates omit values and source activity cannot claim a future commit', () => {
  const data = createFixtureCatalog();
  data.projects[0].catalog_dates = { first_published: { basis: 'exact', value: FIXTURE_TIME }, content_updated: { basis: 'unknown' } };
  assert.equal(validateCatalog(data).ok, false);
  data.projects[0].catalog_dates.first_published = { basis: 'unknown', value: FIXTURE_TIME };
  assert.equal(validateCatalog(data).ok, false);
  delete data.projects[0].catalog_dates;
  data.sources[0].source_activity = { default_branch_head: { sha: FIXTURE_COMMIT, observed_at: FIXTURE_TIME, committed_at: '2030-01-01T00:00:00Z', date_status: 'valid' } };
  assert.match(validateCatalog(data).errors.join(' '), /future source commit/);
  data.sources[0].source_activity.default_branch_head = { sha: FIXTURE_COMMIT, observed_at: FIXTURE_TIME, date_status: 'future' };
  assert.equal(validateCatalog(data).ok, true);
});
