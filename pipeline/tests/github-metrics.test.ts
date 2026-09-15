import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitHubReader, type AccountSnapshot, type SourceSnapshot } from '../github.js';
import { failedMetric, metricObservation } from '../github-observations.js';
import { readRefreshState, refreshRegistry, refreshState, validateBatch } from '../refresh.js';
import { applySuppressions } from '../suppressions.js';
import type { Registry } from '../registry.js';
import { normalize, type SnapshotBatch } from '../normalize.js';
import type { Actor } from '../../spec/types.js';

const NOW = '2026-09-15T12:00:00.000Z';
const OLD = '2026-09-14T12:00:00.000Z';
const SHA = 'a'.repeat(40);
const owner = { id: 7, login: 'research', type: 'Organization' as const, html_url: 'https://github.com/research' };
const user = { id: 8, login: 'researcher', type: 'User' as const, html_url: 'https://github.com/researcher' };
const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), init);
const raw = (name = 'one', id = 1) => ({ id, name, full_name: `research/${name}`, html_url: `https://github.com/research/${name}`, private: false,
  default_branch: 'main', owner, updated_at: OLD, archived: false, fork: false, topics: [], has_issues: true, has_discussions: false });
const snapshot = (name = 'one', id = 1): SourceSnapshot => ({ requested_url: `https://github.com/research/${name}`, checked_at: OLD, observed_at: OLD,
  suppressed: false, availability: 'accessible', repository: raw(name, id) });
const reader = (handler: (url: URL, headers: Headers) => Response | Promise<Response>, options: ConstructorParameters<typeof GitHubReader>[0] = {}) => new GitHubReader({
  now: () => new Date(NOW), maxRetries: 0, enrichContent: false, ...options,
  fetch: async (input, init) => handler(new URL(String(input)), new Headers(init?.headers)),
});
const registry: Registry = { version: 1, sources: ['one', 'two'].map(name => ({ url: `https://github.com/research/${name}`, reviewed_at: OLD, review_note: 'Synthetic public source.' })), resources: [], projects: [], collections: [], withdrawals: [] };

test('repository metrics distinguish zero, missing, malformed and unsafe values without rejecting a public source', async () => {
  for (const value of [0, 123, undefined, null, -1, 2.5, Number.MAX_SAFE_INTEGER + 1, '12']) {
    const result = await reader(url => url.pathname.endsWith('/commits') ? json([{ sha: SHA }]) : json({ ...raw(), stargazers_count: value, forks_count: 0 })).refresh('research', 'one');
    assert.equal(result.availability, 'accessible');
    assert.equal(result.github_metrics?.forks?.value, 0);
    assert.equal(result.github_metrics?.forks?.result, 'ok');
    const expected = value === 0 || value === 123 ? 'ok' : value == null ? 'unsupported' : 'invalid_response';
    assert.equal(result.github_metrics?.stars?.result, expected);
    assert.equal(result.github_metrics?.stars?.value, expected === 'ok' ? value : undefined);
  }
});

test('304 metadata revalidates only counters covered by its prior response, while commit failure stays independently stale', async () => {
  const prior = snapshot();
  prior.etag = '"metadata"';
  prior.github_metrics = { stars: metricObservation(11, OLD), forks: { last_attempt_at: OLD, result: 'unsupported', visibility: 'public_api' } };
  prior.source_activity = { default_branch_head: { sha: SHA, committed_at: OLD, observed_at: OLD, date_status: 'valid' }, observation: { last_attempt_at: OLD, last_success_at: OLD, result: 'ok' } };
  const result = await reader(url => new Response(null, { status: url.pathname.endsWith('/commits') ? 503 : 304 })).refresh('research', 'one', prior);
  assert.equal(result.github_metrics?.stars?.observed_at, NOW);
  assert.equal(result.github_metrics?.stars?.value, 11);
  assert.equal(result.github_metrics?.forks?.observed_at, undefined);
  assert.equal(result.source_activity?.default_branch_head?.observed_at, OLD);
  assert.equal(result.source_activity?.observation?.result, 'unavailable');
  assert.equal(result.source_activity?.observation?.last_attempt_at, NOW);
  assert.equal(result.observation?.last_success_at, NOW);
  assert.equal(prior.github_metrics.stars?.observed_at, OLD);
});

test('source activity uses only the current HEAD committer date, permits backward movement and flags invalid or future dates', async () => {
  const prior = snapshot();
  prior.source_activity = { default_branch_head: { sha: 'b'.repeat(40), committed_at: OLD, observed_at: OLD, date_status: 'valid' } };
  for (const [date, status] of [['2025-01-01T00:00:00Z', 'valid'], [undefined, 'unknown'], ['not-a-date', 'invalid'], ['2026-02-30T00:00:00Z', 'invalid'], ['2026-09-15T12:00:01Z', 'future']] as const) {
    const result = await reader(url => url.pathname.endsWith('/commits')
      ? json([{ sha: SHA, commit: { author: { date: NOW }, committer: { date } } }])
      : json({ ...raw(), updated_at: NOW, pushed_at: NOW })).refresh('research', 'one', prior);
    assert.equal(result.source_activity?.default_branch_head?.date_status, status);
    assert.equal(result.source_activity?.default_branch_head?.committed_at, status === 'valid' ? '2025-01-01T00:00:00.000Z' : undefined);
    assert.equal(result.repository?.commit, SHA);
  }
});

test('failed counters keep their actual observation for at most seven days and suppression clears them immediately', async () => {
  const prior = metricObservation(0, OLD);
  assert.equal(failedMetric(prior, NOW, 'unavailable').observed_at, OLD);
  assert.equal(failedMetric(prior, '2026-09-21T12:00:00.000Z', 'unavailable').value, 0);
  assert.equal(failedMetric(prior, '2026-09-21T12:00:00.001Z', 'unavailable').value, undefined);
  const before = snapshot(); before.github_metrics = { stars: prior };
  const result = await reader(() => new Response(null, { status: 404 })).refresh('research', 'one', before);
  assert.equal(result.github_metrics?.stars?.value, undefined);
  assert.equal(result.github_metrics?.stars?.observed_at, undefined);
});

test('public profile metrics are anonymous, allowlisted and independently observed; organization following is unsupported', async () => {
  for (const identity of [owner, user]) {
    let count = 0;
    const result = await reader((url, headers) => {
      count++;
      assert.equal(headers.get('authorization'), null);
      assert.equal(url.pathname, `/${identity.type === 'Organization' ? 'orgs' : 'users'}/${identity.login}`);
      return json({ ...identity, followers: 0, following: 12, public_repos: -1, email: 'PRIVATE_EMAIL', private_gists: 18, user_view_type: 'public' });
    }, { token: 'DO_NOT_SEND' }).refreshAccount(identity);
    assert.equal(count, 1);
    assert.equal(result.github_metrics.followers?.value, 0);
    assert.equal(result.github_metrics.followers?.visibility, 'public_api');
    assert.equal(result.github_metrics.following?.result, identity.type === 'User' ? 'ok' : 'unsupported');
    assert.equal(result.github_metrics.public_repositories?.result, 'invalid_response');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_EMAIL|private_gists|DO_NOT_SEND/);
  }
});

test('profile identity mismatch or detectable privacy cannot inherit cached follower counts', async () => {
  const prior: AccountSnapshot = { provider_id: user.id, login: user.login, account_type: 'user', canonical_url: user.html_url,
    observation: { last_attempt_at: OLD, last_success_at: OLD, result: 'ok' }, github_metrics: { followers: metricObservation(55, OLD) } };
  for (const change of [{ id: 999 }, { user_view_type: 'private' }, { private: true }, { html_url: 'https://attacker.example/profile' }]) {
    const result = await reader(() => json({ ...user, followers: 0, following: 0, ...change })).refreshAccount(user, prior);
    assert.equal(result.github_metrics.followers?.value, undefined);
    assert.equal(result.github_metrics.followers?.observed_at, undefined);
    assert.notEqual(result.observation.result, 'ok');
    assert.equal(result.provider_id, user.id);
  }
  const limited = await reader(() => new Response(null, { status: 403, headers: { 'x-ratelimit-remaining': '0' } })).refreshAccount(user, prior);
  assert.equal(limited.github_metrics.followers?.value, 55);
  assert.equal(limited.github_metrics.followers?.observed_at, OLD);
  assert.equal(limited.github_metrics.followers?.last_attempt_at, NOW);
});

test('a profile 304 never fills a missing counter and can revalidate a retained value after temporary failure', async () => {
  const prior: AccountSnapshot = { provider_id: user.id, login: user.login, account_type: 'user', canonical_url: user.html_url, etag: '"profile"',
    observation: { last_attempt_at: OLD, last_success_at: OLD, result: 'ok' }, github_metrics: { followers: failedMetric(metricObservation(9, OLD), OLD, 'unavailable') } };
  const result = await reader((_url, headers) => { assert.equal(headers.get('if-none-match'), prior.etag); return new Response(null, { status: 304 }); }).refreshAccount(user, prior);
  assert.equal(result.github_metrics.followers?.value, 9);
  assert.equal(result.github_metrics.followers?.observed_at, NOW);
  assert.equal(result.github_metrics.following?.value, undefined);
  assert.equal(result.github_metrics.following?.result, 'unsupported');
});

test('bulk refresh dedicates public calls to commit observations and profiles instead of optional README/release content', async () => {
  const calls: string[] = [];
  const client = reader(url => {
    calls.push(url.pathname);
    if (url.pathname.endsWith('/commits')) {
      assert.equal(url.searchParams.get('sha'), 'main');
      assert.equal(url.searchParams.get('per_page'), '1');
      return json([{ sha: SHA }]);
    }
    return json(raw());
  });
  const result = await client.refresh('research', 'one');
  assert.equal(result.availability, 'accessible');
  assert.deepEqual(calls, ['/repos/research/one', '/repos/research/one/commits']);
});

test('branch HEAD listing rejects empty, ambiguous or malformed pages without falling back to another commit', async () => {
  for (const page of [[], [{ sha: SHA }, { sha: 'b'.repeat(40) }], { sha: SHA }, [null], [{ sha: 'not-a-sha' }]]) {
    const result = await reader(url => url.pathname.endsWith('/commits') ? json(page) : json(raw())).refresh('research', 'one');
    assert.equal(result.availability, 'accessible');
    assert.equal(result.repository?.commit, undefined);
    assert.equal(result.source_activity?.observation?.result, 'invalid_response');
  }
});

test('batch account refresh deduplicates stable owner IDs and an account failure does not reject catalog sources', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'aipoch-metrics-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let accounts = 0;
  const result = await refreshRegistry(registry, { directory, now: () => new Date(NOW), reader: {
    refresh: async (_owner, repo) => ({ ...snapshot(repo, repo === 'one' ? 1 : 2), checked_at: NOW, observed_at: NOW }),
    refreshAccount: async () => { accounts++; throw new Error('SYNTHETIC_PRIVATE_RESPONSE'); },
  } });
  assert.equal(accounts, 1);
  assert.equal(result.report.complete, true);
  assert.equal(result.batch.accounts?.length, 1);
  assert.equal(result.batch.accounts?.[0].observation.result, 'unavailable');
  assert.doesNotMatch(await readFile(join(directory, 'refresh-state.json'), 'utf8'), /SYNTHETIC_PRIVATE_RESPONSE/);
});

test('restored metric/account state is bounded, allowlisted, identity checked and removed with its last suppressed owner', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'aipoch-metric-state-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const batch: SnapshotBatch = { as_of: OLD, sources: [snapshot('one', 1), snapshot('two', 2)], accounts: [{ provider_id: owner.id, login: owner.login, account_type: 'organization', canonical_url: owner.html_url,
    observation: { last_attempt_at: OLD, last_success_at: OLD, result: 'ok' }, github_metrics: { followers: metricObservation(12, OLD) }, etag: '"profile"' }] };
  batch.sources[0].github_metrics = { stars: metricObservation(5, OLD) };
  Object.assign(batch.accounts![0].github_metrics.followers!, { extra: 'DO_NOT_RETAIN' });
  Object.assign(batch.accounts![0], { bio: 'DO_NOT_RETAIN', email: 'DO_NOT_RETAIN' });
  assert.doesNotMatch(JSON.stringify(refreshState(batch)), /DO_NOT_RETAIN|etag/);
  await writeFile(join(directory, 'state.json'), JSON.stringify(batch));
  const restored = await readRefreshState(join(directory, 'state.json'), registry, new Date(NOW));
  assert.equal(restored?.accounts?.[0].etag, '"profile"');
  assert.doesNotMatch(JSON.stringify(restored), /DO_NOT_RETAIN/);
  assert.throws(() => validateBatch(registry, { ...batch, accounts: [...batch.accounts!, ...batch.accounts!] }, new Date(NOW)), /duplicate account/);
  const bad = structuredClone(batch); bad.sources[0].github_metrics!.stars!.value = -1;
  assert.throws(() => validateBatch(registry, bad, new Date(NOW)), /metric observation/);
  const suppressed = applySuppressions(batch, { version: 1, sources: batch.sources.map(source => ({ requested_url: source.requested_url, checked_at: NOW, reason: 'not_public' })) });
  assert.deepEqual(suppressed.accounts, []);
});

function reviewedActor(id: number, login: string, accountType: 'user' | 'organization' = 'user'): Actor {
  const actorId = `actor:github:${id}`;
  const evidence = { role: 'github' as const, review: 'reviewed' as const, observed_at: OLD, actor_id: actorId, url: `https://api.github.com/users/${login}` };
  return { kind: 'actor', id: actorId, provider: 'github', provider_id: id, account_type: accountType, login, canonical_url: `https://github.com/${login}`, title: login, status: 'listed', updated_at: OLD, aliases: [], provenance: { title: [evidence], provider_id: [evidence] } };
}

test('reviewed supplemental researchers are fetched once, restored and projected without a source repository', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'aipoch-supplemental-metrics-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const enhanced: Registry = { ...structuredClone(registry), actors: [reviewedActor(owner.id, owner.login, 'organization'), reviewedActor(user.id, user.login), reviewedActor(9, 'withdrawn')], withdrawals: [{ id: 'actor:github:9', withdrawn_at: OLD, reason: 'withdrawn' }] };
  const previous: SnapshotBatch = { as_of: OLD, sources: [snapshot('one', 1), snapshot('two', 2)], accounts: [{ provider_id: user.id, login: user.login, account_type: 'user', canonical_url: user.html_url,
    observation: { last_attempt_at: OLD, last_success_at: OLD, result: 'ok' }, github_metrics: { followers: metricObservation(12, OLD) }, etag: '"supplemental"' }] };
  const requested: number[] = [];
  const result = await refreshRegistry(enhanced, { directory, previous, now: () => new Date(NOW), reader: {
    refresh: async (_owner, repo) => ({ ...snapshot(repo, repo === 'one' ? 1 : 2), checked_at: NOW, observed_at: NOW }),
    refreshAccount: async (identity, prior) => {
      requested.push(identity.id);
      if (identity.id === user.id) assert.equal(prior?.github_metrics.followers?.value, 12, 'Standalone account retains its previous public observation');
      return { provider_id: identity.id, login: identity.login, account_type: identity.type === 'Organization' ? 'organization' : 'user', canonical_url: identity.html_url,
        observation: { last_attempt_at: NOW, last_success_at: NOW, result: 'ok' }, github_metrics: { followers: metricObservation(identity.id === user.id ? 13 : 20, NOW) } };
    },
  } });
  assert.deepEqual(requested, [owner.id, user.id], 'Owners and supplemental identities share one deduplicated fetch list; withdrawn identities are skipped');
  assert.equal(result.report.complete, true);
  const restored = await readRefreshState(join(directory, 'refresh-state.json'), enhanced, new Date(NOW));
  assert.equal(restored?.accounts?.find(account => account.provider_id === user.id)?.github_metrics.followers?.value, 13);
  assert.equal(normalize(enhanced, restored!).catalog.actors.find(actor => actor.id === `actor:github:${user.id}`)?.github_metrics?.followers?.value, 13);
  const wrongType = structuredClone(result.batch); wrongType.accounts!.find(account => account.provider_id === user.id)!.account_type = 'organization';
  assert.throws(() => validateBatch(enhanced, wrongType, new Date(NOW)), /account identity/);
  const unknownId = structuredClone(result.batch); unknownId.accounts!.find(account => account.provider_id === user.id)!.provider_id = 999;
  assert.throws(() => validateBatch(enhanced, unknownId, new Date(NOW)), /account identity/);
});

test('source suppression retains only independently reviewed profiles and actor withdrawal removes those too', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'aipoch-supplemental-retention-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const enhanced: Registry = { ...structuredClone(registry), actors: [reviewedActor(user.id, user.login)] };
  const accounts: AccountSnapshot[] = [owner, user].map(identity => ({ provider_id: identity.id, login: identity.login, account_type: identity.type === 'Organization' ? 'organization' : 'user', canonical_url: identity.html_url,
    observation: { last_attempt_at: OLD, last_success_at: OLD, result: 'ok' }, github_metrics: { followers: metricObservation(12, OLD) } }));
  const batch: SnapshotBatch = { as_of: OLD, sources: [snapshot('one', 1), snapshot('two', 2)], accounts };
  const state = { version: 1 as const, sources: batch.sources.map(source => ({ requested_url: source.requested_url, checked_at: NOW, reason: 'not_public' as const })) };
  assert.deepEqual(applySuppressions(batch, state, enhanced).accounts?.map(account => account.provider_id), [user.id]);
  const withdrawn: Registry = { ...enhanced, withdrawals: [{ id: `actor:github:${user.id}`, withdrawn_at: OLD, reason: 'withdrawn' }] };
  assert.deepEqual(applySuppressions(batch, state, withdrawn).accounts, []);
  await writeFile(join(directory, 'state.json'), JSON.stringify(batch));
  assert.equal((await readRefreshState(join(directory, 'state.json'), withdrawn, new Date(NOW)))?.accounts?.some(account => account.provider_id === user.id), false);
  assert.equal((await readRefreshState(join(directory, 'state.json'), { ...withdrawn, actors: [] }, new Date(NOW)))?.accounts?.some(account => account.provider_id === user.id), false, 'A withdrawn supplemental actor can be removed from the registry without blocking restoration of other valid sources');
});
