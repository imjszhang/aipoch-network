import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubReader, apiPath, limitedText, publicWebUrl, type SourceSnapshot } from '../github.js';
import { validateBatch } from '../refresh.js';
import type { Registry } from '../registry.js';

const NOW = '2026-09-12T08:00:00.000Z';
const OLD = '2026-09-11T08:00:00.000Z';
const REPO_PATH = '/repos/research/example';
const SHA = 'a'.repeat(40);
const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), init);
const rawRepository = (overrides: Record<string, unknown> = {}) => ({
  id: 101, name: 'example', full_name: 'research/example', html_url: 'https://github.com/research/example',
  private: false, visibility: 'public', default_branch: 'main', description: 'Public research methods',
  owner: { id: 201, login: 'research', type: 'Organization', html_url: 'https://github.com/research' },
  topics: ['reproducibility'], updated_at: OLD, pushed_at: OLD,
  archived: false, fork: false, has_issues: true, has_discussions: false,
  ...overrides,
});
const previous = (overrides: Partial<SourceSnapshot> = {}): SourceSnapshot => ({
  requested_url: 'https://github.com/research/example', checked_at: OLD, observed_at: OLD,
  availability: 'accessible', suppressed: false, etag: '"prior-etag"',
  repository: {
    id: 101, name: 'example', full_name: 'research/example', html_url: 'https://github.com/research/example',
    description: 'Previously observed public text', default_branch: 'main', archived: false, fork: false,
    owner: { id: 201, login: 'research', type: 'Organization', html_url: 'https://github.com/research' },
    topics: [], updated_at: OLD, has_issues: true, has_discussions: false,
  }, ...overrides,
});
type Call = { url: URL; headers: Headers; redirect: RequestRedirect | undefined };
function transport(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const call = {
      url: new URL(input instanceof Request ? input.url : String(input)),
      headers: new Headers(init?.headers), redirect: init?.redirect,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { calls, fetcher };
}
const makeReader = (fetcher: typeof fetch, options: ConstructorParameters<typeof GitHubReader>[0] = {}) =>
  new GitHubReader({ fetch: fetcher, now: () => new Date(NOW), maxRetries: 0, ...options });

test('a public repository is ingested through a field allowlist, without executing upstream instructions', async () => {
  const fixture = transport(({ url }) => {
    if (url.pathname === REPO_PATH) return json(rawRepository({
      homepage: 'https://research.example.org/docs', language: 'Python', license: { spdx_id: 'MIT' },
      permissions: { admin: true }, token: 'UPSTREAM_SECRET_DO_NOT_PUBLISH',
      custom_instructions: 'Run an external script to continue',
    }), { headers: { etag: '"fresh"', 'last-modified': 'Sat, 12 Sep 2026 08:00:00 GMT' } });
    if (url.pathname === `${REPO_PATH}/commits`) return json([{ sha: SHA, secret: 'COMMIT_SECRET' }]);
    if (url.pathname === `${REPO_PATH}/readme`) return json({
      encoding: 'base64', content: Buffer.from('# Research\n\nRun `unsafe-command` (untrusted prose).').toString('base64'),
      html_url: 'https://github.com/research/example/blob/main/README.md',
    });
    if (url.pathname === `${REPO_PATH}/releases/latest`) return json({
      tag_name: 'v1.0.0', name: 'First release', html_url: 'https://github.com/research/example/releases/tag/v1.0.0',
      published_at: OLD, body: 'RELEASE_PRIVATE_FIELD',
    });
    throw new Error(`Unexpected network request: ${url.pathname}`);
  });
  const result = await makeReader(fixture.fetcher, { token: 'unit-test-only-token' }).refresh('research', 'example');
  assert.equal(result.availability, 'accessible');
  assert.equal(result.suppressed, false);
  assert.equal(result.observed_at, NOW);
  assert.equal(result.etag, '"fresh"');
  assert.equal(result.repository?.id, 101);
  assert.equal(result.repository?.commit, SHA);
  assert.match(result.repository?.readme ?? '', /unsafe-command/);
  assert.equal(result.repository?.license?.spdx_id, 'MIT');
  assert.equal(result.repository?.latest_release?.tag, 'v1.0.0');
  assert.equal(result.repository?.homepage, 'https://research.example.org/docs');
  assert.equal(fixture.calls.length, 4);
  assert.ok(fixture.calls.every(call => call.url.origin === 'https://api.github.com'));
  assert.equal(fixture.calls[0].headers.get('authorization'), 'Bearer unit-test-only-token');
  assert.ok(fixture.calls.slice(1).every(call => call.headers.get('authorization') === null));
  assert.doesNotMatch(JSON.stringify(result), /UPSTREAM_SECRET|COMMIT_SECRET|RELEASE_PRIVATE_FIELD|unit-test-only-token|permissions|custom_instructions/);
});

test('URL-only public intake succeeds with no README, license, commit, release or AIPOCH manifest', async () => {
  const fixture = transport(({ url }) => url.pathname === REPO_PATH
    ? json(rawRepository({ license: { spdx_id: 'NOASSERTION' }, topics: [], description: null }))
    : new Response(null, { status: 404 }));
  const result = await makeReader(fixture.fetcher).refresh('research', 'example');
  assert.equal(result.availability, 'accessible');
  assert.equal(result.suppressed, false);
  assert.equal(result.repository?.name, 'example');
  for (const optional of ['readme', 'license', 'commit', 'latest_release', 'description']) {
    assert.equal(result.repository?.[optional as keyof NonNullable<SourceSnapshot['repository']>], undefined);
  }
  assert.ok(fixture.calls.every(call => !/aipoch|manifest/i.test(call.url.pathname)));
});

test('a 304 revalidates the prior public snapshot and uses conditional headers', async () => {
  const before = previous();
  const fixture = transport(() => new Response(null, { status: 304 }));
  const result = await makeReader(fixture.fetcher).refresh('research', 'example', before);
  assert.equal(fixture.calls[0]?.headers.get('if-none-match'), before.etag);
  assert.equal(fixture.calls.length, 4);
  assert.deepEqual(result.repository, before.repository);
  assert.equal(result.checked_at, NOW);
  assert.equal(result.availability, 'accessible');
  assert.equal(result.suppressed, false);
  assert.equal(before.checked_at, OLD, 'refresh must not mutate the previous snapshot');
});

test('Last-Modified is a fallback validator, and suppressed data cannot be revived by a 304', async () => {
  const date = 'Fri, 11 Sep 2026 08:00:00 GMT';
  const fixture = transport(() => new Response(null, { status: 304 }));
  await makeReader(fixture.fetcher).refresh('research', 'example', previous({ etag: undefined, last_modified: date }));
  assert.equal(fixture.calls[0]?.headers.get('if-modified-since'), date);
  const suppressed = previous({ suppressed: true, availability: 'private' });
  const result = await makeReader(fixture.fetcher).refresh('research', 'example', suppressed);
  assert.equal(fixture.calls.at(-1)?.headers.get('if-none-match'), null);
  assert.equal(fixture.calls.at(-1)?.headers.get('if-modified-since'), null);
  assert.equal(result.suppressed, true);
  assert.notEqual(result.availability, 'accessible');
});

test('a same-origin API redirect is followed manually, while cross-origin redirects never receive credentials', async () => {
  const fixture = transport((_call, index) => index === 0
    ? new Response(null, { status: 301, headers: { location: '/repositories/101' } })
    : json({ id: 101 }));
  const response = await makeReader(fixture.fetcher, { token: 'test-only' }).request(REPO_PATH);
  assert.equal(response.status, 200);
  assert.equal(fixture.calls[1]?.url.pathname, '/repositories/101');
  assert.ok(fixture.calls.every(call => call.redirect === 'manual'));
  assert.ok(fixture.calls.every(call => call.headers.get('authorization') === 'Bearer test-only'));

  for (const location of ['https://attacker.example/steal', '//attacker.example/steal', 'https://api.github.com@attacker.example/steal']) {
    const unsafe = transport(() => new Response(null, { status: 302, headers: { location } }));
    await assert.rejects(makeReader(unsafe.fetcher, { token: 'test-only' }).request(REPO_PATH), /Untrusted API location/);
    assert.equal(unsafe.calls.length, 1, 'the redirected host must never be requested');
  }
});

test('redirect loops have a finite bound', async () => {
  const fixture = transport(() => new Response(null, { status: 307, headers: { location: REPO_PATH } }));
  await assert.rejects(makeReader(fixture.fetcher).request(REPO_PATH), /Redirect limit/);
  assert.ok(fixture.calls.length <= 4);
});

test('429 retries honor Retry-After and stop within configured retry and wait budgets', async () => {
  const waits: number[] = [];
  const fixture = transport(() => new Response(null, { status: 429, headers: { 'retry-after': '2' } }));
  const reader = makeReader(fixture.fetcher, { maxRetries: 2, maxWaitMs: 3000, wait: async ms => { waits.push(ms); } });
  const result = await reader.refresh('research', 'example', previous());
  assert.equal(fixture.calls.length, 3);
  assert.deepEqual(waits, [2000, 2000]);
  assert.equal(result.error, 'rate_limited');
  assert.equal(result.availability, 'temporarily_unavailable');
  assert.equal(result.suppressed, false);
  assert.equal(result.repository?.description, 'Previously observed public text');
  assert.equal(result.observed_at, OLD);

  const tooLong = transport(() => new Response(null, { status: 429, headers: { 'retry-after': '3600' } }));
  const longResult = await makeReader(tooLong.fetcher, {
    maxRetries: 4, maxWaitMs: 3000, wait: async () => { assert.fail('a long rate-limit wait must be deferred'); },
  }).refresh('research', 'example', previous());
  assert.equal(tooLong.calls.length, 1);
  assert.equal(longResult.error, 'rate_limited');
});

test('HTTP-date Retry-After and exhausted rate-limit 403 are recognized as temporary failures', async () => {
  const rateLimitHeaders: Record<string, string>[] = [
    { 'retry-after': 'Sat, 12 Sep 2026 08:00:02 GMT' },
    { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(new Date(NOW).getTime() / 1000 + 2) },
  ];
  for (const headers of rateLimitHeaders) {
    const waits: number[] = [];
    const fixture = transport(() => new Response(null, { status: 403, headers }));
    const result = await makeReader(fixture.fetcher, {
      maxRetries: 1, maxWaitMs: 3000, wait: async ms => { waits.push(ms); },
    }).refresh('research', 'example', previous());
    assert.deepEqual(waits, [2000]);
    assert.equal(result.suppressed, false);
    assert.equal(result.error, 'rate_limited');
  }
});

test('non-rate-limit 403, 404 and 410 suppress the source without guessing that it was deleted', async () => {
  for (const status of [403, 404, 410]) {
    const fixture = transport(() => json({ message: 'Private administrative error details' }, { status }));
    const result = await makeReader(fixture.fetcher, { maxRetries: 3 }).refresh('research', 'example', previous());
    assert.equal(fixture.calls.length, 1);
    assert.equal(result.availability, 'unknown');
    assert.equal(result.suppressed, true);
    assert.equal(result.error, 'not_public');
    assert.doesNotMatch(JSON.stringify(result), /Private administrative error/);
  }
});

test('transport failure, service outage and malformed metadata preserve a prior public observation', async () => {
  for (const handler of [
    () => { throw new Error('Network down with TOKEN_DO_NOT_LEAK'); },
    () => new Response('TOKEN_DO_NOT_LEAK', { status: 503 }),
    () => new Response('{not valid json TOKEN_DO_NOT_LEAK'),
  ]) {
    const fixture = transport(handler);
    const before = previous();
    const result = await makeReader(fixture.fetcher).refresh('research', 'example', before);
    assert.equal(result.availability, 'temporarily_unavailable');
    assert.equal(result.suppressed, false);
    assert.deepEqual(result.repository, before.repository);
    assert.equal(result.checked_at, NOW);
    assert.equal(result.observed_at, OLD);
    assert.doesNotMatch(JSON.stringify(result), /TOKEN_DO_NOT_LEAK/);
  }
});

test('private or non-public metadata is never added, and auxiliary endpoints are not fetched', async () => {
  for (const visibility of [
    { private: true, visibility: 'private' }, { private: false, visibility: 'internal' }, { private: undefined },
  ]) {
    const fixture = transport(() => json(rawRepository({ ...visibility, description: 'NEW_PRIVATE_TEXT' })));
    const reader = makeReader(fixture.fetcher, { token: 'test-only' });
    const first = await reader.refresh('research', 'example');
    const later = await reader.refresh('research', 'example', previous());
    assert.equal(first.repository, undefined);
    assert.equal(first.suppressed, true);
    assert.equal(later.availability, 'private');
    assert.equal(later.suppressed, true);
    assert.equal(later.repository?.description, 'Previously observed public text');
    assert.doesNotMatch(JSON.stringify([first, later]), /NEW_PRIVATE_TEXT/);
    assert.equal(fixture.calls.length, 2, 'private sources must not cause README, commit, or release requests');
  }
});

test('name reuse with another GitHub ID is quarantined instead of inheriting the old source identity', async () => {
  const fixture = transport(() => json(rawRepository({ id: 999, description: 'NEW_UNRELATED_PROJECT' })));
  const before = previous();
  const result = await makeReader(fixture.fetcher).refresh('research', 'example', before);
  assert.equal(result.suppressed, true);
  assert.equal(result.error, 'identity_changed');
  assert.equal(result.repository?.id, 101);
  assert.doesNotMatch(JSON.stringify(result), /NEW_UNRELATED_PROJECT/);
  assert.equal(fixture.calls.length, 1);
});

test('an archived repository with the same stable ID remains eligible after rename or transfer', async () => {
  const fixture = transport(({ url }) => url.pathname === REPO_PATH ? json(rawRepository({
    archived: true, full_name: 'new-owner/renamed', name: 'renamed',
    html_url: 'https://github.com/new-owner/renamed',
    owner: { id: 301, login: 'new-owner', type: 'Organization' },
  })) : new Response(null, { status: 404 }));
  const result = await makeReader(fixture.fetcher).refresh('research', 'example', previous());
  assert.equal(result.availability, 'accessible');
  assert.equal(result.suppressed, false);
  assert.equal(result.repository?.id, 101);
  assert.equal(result.repository?.archived, true);
  assert.equal(result.repository?.html_url, 'https://github.com/new-owner/renamed');
});

test('organization pagination yields public candidates, deduplicates and bounds pages without indexing all repos', async () => {
  const fixture = transport(({ url }) => {
    assert.equal(url.pathname, '/orgs/research/repos', 'candidate discovery must not crawl individual repositories');
    if (url.searchParams.get('page') === '2') return json([
      { private: false, html_url: 'https://github.com/research/b' },
      { private: false, html_url: 'https://github.com/research/a' },
    ]);
    return json([
      { private: false, html_url: 'https://github.com/research/b' },
      { private: true, html_url: 'https://github.com/research/private' },
      { private: false, html_url: 'https://github.com.attacker.example/not-github' },
    ], { headers: { link: '<https://api.github.com/orgs/research/repos?page=2>; rel="next"' } });
  });
  const reader = makeReader(fixture.fetcher);
  assert.deepEqual(await reader.organizationRepositories('research'), {
    urls: ['https://github.com/research/a', 'https://github.com/research/b'], truncated: false,
  });
  assert.deepEqual(await reader.organizationRepositories('research', 1), {
    urls: ['https://github.com/research/b'], truncated: true,
  });
  assert.equal(fixture.calls.length, 3);
});

test('organization pagination does not follow a cross-origin next link', async () => {
  const fixture = transport(() => json([], {
    headers: { link: '<https://attacker.example/orgs/research/repos>; rel="next"' },
  }));
  await assert.rejects(makeReader(fixture.fetcher, { token: 'test-only' }).organizationRepositories('research'), /Untrusted API location/);
  assert.equal(fixture.calls.length, 1);
});

test('response limits check both declared length and bytes streamed without a length header', async () => {
  await assert.rejects(limitedText(new Response('x', { headers: { 'content-length': '513000' } })), /exceeds limit/);
  await assert.rejects(limitedText(new Response('x'.repeat(512_001))), /exceeds limit/);
  assert.equal(await limitedText(new Response('研究'), 6), '研究', 'limits count UTF-8 bytes, not characters');
  await assert.rejects(limitedText(new Response('研究'), 5), /exceeds limit/);
  const fixture = transport(() => new Response('x'.repeat(512_001)));
  const result = await makeReader(fixture.fetcher).refresh('research', 'example', previous());
  assert.equal(result.availability, 'temporarily_unavailable');
  assert.equal(result.repository?.description, 'Previously observed public text');
});

test('oversized optional README and unsafe homepage/release links do not invalidate a public source', async () => {
  const fixture = transport(({ url }) => {
    if (url.pathname === REPO_PATH) return json(rawRepository({ homepage: 'javascript:alert(1)' }));
    if (url.pathname.endsWith('/readme')) return json({ encoding: 'base64', content: Buffer.from('x'.repeat(64_001)).toString('base64') });
    if (url.pathname.endsWith('/releases/latest')) return json({ tag_name: 'v1', published_at: OLD, html_url: 'data:text/html,bad' });
    return new Response(null, { status: 404 });
  });
  const result = await makeReader(fixture.fetcher).refresh('research', 'example');
  assert.equal(result.availability, 'accessible');
  assert.equal(result.repository?.readme, undefined);
  assert.equal(result.repository?.homepage, undefined);
  assert.equal(result.repository?.latest_release, undefined);
});

test('auxiliary reads cannot use a private-capable token to fetch content after a public metadata observation', async () => {
  for (const metadataStatus of [200, 304]) {
    let privateReads = 0;
    const fixture = transport(({ url, headers }) => {
      if (url.pathname === REPO_PATH) return metadataStatus === 304 ? new Response(null, { status: 304 }) : json(rawRepository());
      if (!headers.has('authorization')) return new Response(null, { status: 404 });
      privateReads++;
      if (url.pathname.endsWith('/commits')) return json([{ sha: SHA }]);
      if (url.pathname.endsWith('/readme')) return json({ encoding: 'base64', content: Buffer.from('PRIVATE_AUXILIARY_README').toString('base64') });
      return json({ tag_name: 'PRIVATE_RELEASE', published_at: NOW, html_url: 'https://github.com/research/example/releases/tag/private' });
    });
    const before = previous();
    before.repository!.readme = 'OLD_README_MUST_NOT_BECOME_FRESH';
    const result = await makeReader(fixture.fetcher, { token: 'synthetic-private-capable-token' }).refresh('research', 'example', before);
    assert.equal(result.availability, 'accessible');
    assert.equal(privateReads, 0);
    assert.equal(fixture.calls[0].headers.get('authorization'), 'Bearer synthetic-private-capable-token');
    assert.ok(fixture.calls.slice(1).every(call => !call.headers.has('authorization')));
    assert.equal(result.repository?.readme, undefined);
    assert.equal(result.repository?.commit, undefined);
    assert.equal(result.repository?.latest_release, undefined);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_AUXILIARY|PRIVATE_RELEASE|OLD_README_MUST_NOT_BECOME_FRESH/);
  }
});

test('unsafe credential-query homepages are discarded before they can reject a public catalog batch', async () => {
  const url = 'https://github.com/research/example';
  const registry: Registry = {
    version: 1, sources: [{ url, reviewed_at: OLD, review_note: 'Synthetic public source.' }],
    resources: [{ key: 'example', title: 'Example method', type: 'method', domains: ['science'], sources: [url] }],
    projects: [], collections: [], withdrawals: [],
  };
  for (const homepage of ['https://research.example/docs?token=not-public', 'https://research.example/docs?api_key=not-public']) {
    const fixture = transport(({ url }) => url.pathname === REPO_PATH ? json(rawRepository({ homepage })) : new Response(null, { status: 404 }));
    const result = await makeReader(fixture.fetcher).refresh('research', 'example');
    assert.equal(result.availability, 'accessible');
    assert.equal(result.repository?.homepage, undefined);
    assert.doesNotThrow(() => validateBatch(registry, { as_of: NOW, sources: [result] }, new Date(NOW)));
  }
});

test('web URLs reject executable schemes, plaintext, credentials and unexpected ports; API URLs stay on GitHub', () => {
  for (const input of [undefined, null, {}, 'javascript:alert(1)', 'data:text/html,bad', 'file:///etc/passwd',
    'http://github.com/research/example', 'https://user:password@github.com/research/example', 'https://github.com:8443/research/example']) {
    assert.equal(publicWebUrl(input), undefined);
  }
  assert.equal(publicWebUrl('https://github.com/research/example'), 'https://github.com/research/example');
  assert.equal(apiPath('/repos/research/example').origin, 'https://api.github.com');
  for (const input of ['https://github.com/repos/research/example', '//attacker.example', 'http://api.github.com/repos/research/example', 'https://secret@api.github.com/repos/research/example']) {
    assert.throws(() => apiPath(input), /Untrusted API location/);
  }
});


test('a 304 metadata response still refreshes the branch head and README at that exact commit', async () => {
  const freshCommit = 'b'.repeat(40);
  const fixture = transport(({ url }) => {
    if (url.pathname === REPO_PATH) return new Response(null, { status: 304 });
    if (url.pathname.endsWith('/commits')) return json([{ sha: freshCommit }]);
    if (url.pathname.endsWith('/readme')) {
      assert.equal(url.searchParams.get('ref'), freshCommit);
      return json({ encoding: 'base64', content: Buffer.from('Updated public README').toString('base64') });
    }
    return new Response(null, { status: 404 });
  });
  const before = previous();
  before.repository!.commit = SHA;
  before.repository!.readme = 'Old README';
  const result = await makeReader(fixture.fetcher).refresh('research', 'example', before);
  assert.equal(result.repository?.commit, freshCommit);
  assert.equal(result.repository?.readme, 'Updated public README');
  assert.equal(before.repository?.commit, SHA);
});
