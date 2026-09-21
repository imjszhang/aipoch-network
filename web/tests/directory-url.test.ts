import test from 'node:test';
import assert from 'node:assert/strict';
import { directoryHref, legacyDirectoryRedirect, normalizeDirectoryParams, parseDirectoryPath } from '../src/directory-url.js';

test('browse and canonical route families are disjoint from entity and malformed paths', () => {
  assert.deepEqual(parseDirectoryPath('/browse/projects/'), { section: 'projects', kind: 'project', page: null, browse: true });
  assert.deepEqual(parseDirectoryPath('/projects/page/2/'), { section: 'projects', kind: 'project', page: 2 });
  for (const path of ['/browse/projects/page/2/', '/browse/unknown/', '/browse/projects/project~one/', '/projects/project~a%2Fb/', '/projects//', '//projects/', '/projects/page/1/', '/projects/page/0/', '/projects/page/-1/', '/projects/page/2.5/', '/projects/page/99999999/']) {
    assert.equal(parseDirectoryPath(path), undefined, path);
  }
});

test('filter links use stable browse URLs while equivalent defaults use canonical pagination', () => {
  assert.equal(directoryHref('capabilities', 2, new URLSearchParams('sort=stars&field=3.2&utm_source=readme')), '/browse/capabilities/?field=3.2&page=2&sort=stars');
  assert.equal(directoryHref('projects', 3, new URLSearchParams('q=&type=all&sort=title&utm_campaign=test')), '/projects/page/3/');
  assert.equal(directoryHref('projects', 1, new URLSearchParams('q=scanpy&sort=title')), '/browse/projects/?q=scanpy&sort=title');
  assert.equal(directoryHref('projects', 1, new URLSearchParams('organization=organization:one/two')), '/browse/projects/?organization=organization%3Aone%2Ftwo');
  assert.equal(directoryHref('projects', 1, new URLSearchParams('sort=title&sort=stars')), '/browse/projects/?sort=title&sort=stars');
  assert.equal(directoryHref('projects', NaN, new URLSearchParams()), '/projects/');
});

test('legacy migration runs without catalog data and preserves all nondefault conditions and fragments', () => {
  assert.equal(legacyDirectoryRedirect('/capabilities/?field=3.2#results'), '/browse/capabilities/?field=3.2#results');
  assert.equal(legacyDirectoryRedirect('/explore/?q=单细胞&collection=collection%3Aa%2Fb'), '/browse/explore/?collection=collection%3Aa%2Fb&q=%E5%8D%95%E7%BB%86%E8%83%9E');
  assert.equal(legacyDirectoryRedirect('/projects/page/3/?sort=stars'), '/browse/projects/?page=3&sort=stars');
  assert.equal(legacyDirectoryRedirect('/projects/?field=bad&field=3.2&other=value'), '/browse/projects/?field=bad&field=3.2&other=value');
  assert.equal(legacyDirectoryRedirect('/projects/?page=2&page=3'), '/browse/projects/?page=2&page=3');
  assert.equal(legacyDirectoryRedirect('/projects/?sort=title&sort=title'), '/browse/projects/?sort=title&sort=title');
});

test('legacy page adaptation clamps to embedded total and repairs invalid page values', () => {
  assert.equal(legacyDirectoryRedirect('/projects/?page=2'), '/projects/page/2/');
  assert.equal(legacyDirectoryRedirect('/projects/?page=999', '/', 4), '/projects/page/4/');
  assert.equal(legacyDirectoryRedirect('/projects/?page=999&field=3.2', '/', 4), '/browse/projects/?field=3.2&page=4');
  for (const page of ['1', '0', '-1', 'nope', '10000000000000000']) {
    assert.equal(legacyDirectoryRedirect(`/projects/?page=${page}`), '/projects/');
  }
  assert.equal(legacyDirectoryRedirect('/projects/?page=2.7'), '/projects/page/2/');
  assert.equal(legacyDirectoryRedirect('/projects/?utm_source=readme&sort=title'), '/projects/');
  assert.equal(legacyDirectoryRedirect('/projects/?q=+&type=all'), '/projects/');
});

test('migration is bounded to the deployment base and leaves browse and entity URLs alone', () => {
  assert.equal(legacyDirectoryRedirect('/aipoch-network/projects/?page=2', '/aipoch-network/'), '/aipoch-network/projects/page/2/');
  assert.equal(legacyDirectoryRedirect('/aipoch-network/explore/?field=5.3#results', '/aipoch-network/'), '/aipoch-network/browse/explore/?field=5.3#results');
  for (const path of ['/browse/projects/', '/browse/projects/?field=3.2', '/projects/project~one/?field=3.2', '/submit/?entry=project%3Aone', '/projects/', '//evil.example/projects/?q=x', 'https://evil.example/projects/?q=x']) {
    assert.equal(legacyDirectoryRedirect(path), undefined, path);
  }
  assert.equal(legacyDirectoryRedirect('/other/projects/?q=x', '/aipoch-network/'), undefined);
  assert.equal(legacyDirectoryRedirect('/projects/?q=x', '//'), undefined);
});

test('normalization is idempotent and does not mutate input or erase repairable values', () => {
  const params = new URLSearchParams('sort=invalid&field=&q=abc&field=5.3&page=2&utm_source=x');
  const before = params.toString();
  const first = normalizeDirectoryParams(params);
  assert.equal(first.toString(), 'field=&field=5.3&page=2&q=abc&sort=invalid');
  assert.equal(normalizeDirectoryParams(first).toString(), first.toString());
  assert.equal(params.toString(), before);
});
