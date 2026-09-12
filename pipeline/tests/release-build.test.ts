import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRelease, commitOutput, validateOutput } from '../../scripts/build.js';

async function temporary(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'aipoch-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function write(root: string, name: string, text: string): Promise<void> {
  const path = join(root, name); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text);
}
async function candidate(root: string, base = '/', snapshot = 'new-snapshot'): Promise<void> {
  const html = `<!doctype html><html><head><script type="module" src="${base}assets/app.js"></script><link rel="stylesheet" href="${base}assets/app.css"></head><body><a href="#content">Skip to content</a><main id="content"><a href="${base}docs/?query=one&amp;next=two#section">Docs</a><a href="https://github.com/example/research">Third-party source</a><section id="section">Content</section><a href="${base}catalog/v1/manifest.json">Catalog</a></main><script>window.__AIPOCH__={"example":"href=missing-but-not-an-attribute"}</script></body></html>`;
  for (const page of ['index.html', 'docs/index.html', '404.html']) await write(root, page, html);
  await write(root, '.nojekyll', '');
  await write(root, 'routes.json', JSON.stringify({ base, paths: ['/', '/docs/'], snapshot_id: snapshot }));
  for (const file of ['catalog/v1/manifest.json', 'internal/catalog.json', 'internal/search.json']) await write(root, file, JSON.stringify({ snapshot_id: snapshot }));
  await write(root, 'assets/app.js', 'import "./shared.js"; export const ready = true;');
  await write(root, 'assets/shared.js', 'export const shared = true;');
  await write(root, 'assets/app.css', '@import "./shared.css"; body{background:url("./background.svg")}');
  await write(root, 'assets/shared.css', 'body{margin:0}');
  await write(root, 'assets/background.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
}

test('commits complete sibling output and removes old output only after replacement', async t => {
  const root = await temporary(t), stage = join(root, 'staging'), dist = join(root, 'dist');
  await write(stage, 'index.html', 'new'); await write(dist, 'index.html', 'old'); await write(dist, 'obsolete.html', 'old');
  await commitOutput(stage, dist);
  assert.equal(await readFile(join(dist, 'index.html'), 'utf8'), 'new');
  assert.deepEqual(await readdir(root), ['dist']); assert.deepEqual(await readdir(dist), ['index.html']);
});

test('first output can be committed when no previous dist exists', async t => {
  const root = await temporary(t), stage = join(root, 'staging'), dist = join(root, 'dist');
  await write(stage, 'index.html', 'first'); await commitOutput(stage, dist);
  assert.equal(await readFile(join(dist, 'index.html'), 'utf8'), 'first');
});

test('a real failed second rename restores the previous output directory', async t => {
  const root = await temporary(t), stage = join(root, 'staging'), dist = join(root, 'dist');
  await write(stage, 'index.html', 'new'); await write(dist, 'index.html', 'old');
  const moves: string[] = [];
  await assert.rejects(commitOutput(stage, dist, { rename: async (from, to) => {
    moves.push(String(from));
    if (from === stage) throw Object.assign(new Error('Simulated filesystem rename refusal'), { code: 'EACCES' });
    await rename(from, to);
  } }), /rename refusal/);
  assert.equal(moves.length, 3); assert.equal(await readFile(join(dist, 'index.html'), 'utf8'), 'old');
  assert.equal(await readFile(join(stage, 'index.html'), 'utf8'), 'new');
  assert.deepEqual((await readdir(root)).sort(), ['dist', 'staging']);
});

test('rejects missing staging and output symlinks without altering existing output', async t => {
  const root = await temporary(t), stage = join(root, 'staging'), dist = join(root, 'dist');
  await write(dist, 'index.html', 'old');
  await assert.rejects(commitOutput(stage, dist)); assert.equal(await readFile(join(dist, 'index.html'), 'utf8'), 'old');
  await write(stage, 'index.html', 'new'); await symlink(dist, join(root, 'linked-dist'));
  await assert.rejects(commitOutput(stage, join(root, 'linked-dist')), /real directory/);
  assert.equal(await readFile(join(dist, 'index.html'), 'utf8'), 'old');
});

test('validates actual root and Pages-subpath pages, assets, imports, anchors and third-party HTTPS links', async t => {
  const root = await temporary(t);
  for (const [name, base] of [['root', '/'], ['project', '/aipoch-network/']]) {
    const output = join(root, name); await candidate(output, base);
    const checked = await validateOutput(output, base);
    assert.equal(checked.pages, 3); assert.equal(checked.snapshot_id, 'new-snapshot'); assert.ok(checked.files > checked.pages);
    assert.ok(checked.bytes > 0);
    await assert.rejects(validateOutput(output, base, 1), /byte budget/);
  }
});

test('rejects missing page, asset, CSS import, JS import and fragment target', async t => {
  const root = await temporary(t);
  for (const [name, mutate, error] of [
    ['page', async (output: string) => rm(join(output, 'docs/index.html')), /Missing prerendered page/],
    ['asset', async (output: string) => rm(join(output, 'assets/app.js')), /Missing local asset/],
    ['css', async (output: string) => rm(join(output, 'assets/shared.css')), /Missing local asset/],
    ['js', async (output: string) => rm(join(output, 'assets/shared.js')), /Missing local asset/],
    ['anchor', async (output: string) => write(output, 'index.html', (await readFile(join(output, 'index.html'), 'utf8')).replace('#section', '#missing')), /Missing anchor/],
  ] as const) {
    const output = join(root, name); await candidate(output); await mutate(output); await assert.rejects(validateOutput(output), error);
  }
});

test('rejects links outside the configured project subpath and unsafe external references', async t => {
  const root = await temporary(t);
  for (const [index, href] of ['/docs/', '//github.com/example/research', 'https://user:password@github.com/example/research', 'file:///tmp/index.html'].entries()) {
    const output = join(root, String(index)); await candidate(output, '/aipoch-network/');
    await write(output, 'index.html', (await readFile(join(output, 'index.html'), 'utf8')).replace('https://github.com/example/research', href));
    await assert.rejects(validateOutput(output, '/aipoch-network/'));
  }
});

test('rejects partial prerender templates, mixed catalog snapshots and symlinked artifacts', async t => {
  const root = await temporary(t);
  const unfinished = join(root, 'unfinished'); await candidate(unfinished); await write(unfinished, 'index.html', '<!--app-html-->');
  await assert.rejects(validateOutput(unfinished), /Unrendered/);
  const mixed = join(root, 'mixed'); await candidate(mixed); await write(mixed, 'internal/search.json', '{"snapshot_id":"old"}');
  await assert.rejects(validateOutput(mixed), /snapshot differs/);
  const linked = join(root, 'linked'); await candidate(linked); await symlink(join(linked, 'index.html'), join(linked, 'alias.html'));
  await assert.rejects(validateOutput(linked), /symlinks/);
});

test('failed build steps preserve the exact previous dist and clean partial staging', async t => {
  const root = await temporary(t), dist = join(root, 'dist'); await write(dist, 'index.html', 'previous output');
  await assert.rejects(buildRelease({ destination: dist, steps: async staging => {
    assert.equal(await readFile(join(dist, 'index.html'), 'utf8'), 'previous output');
    await write(staging, 'index.html', 'partial'); throw new Error('Prerender failed');
  } }), /Prerender failed/);
  assert.equal(await readFile(join(dist, 'index.html'), 'utf8'), 'previous output');
  assert.deepEqual(await readdir(root), ['dist']);
});

test('a validation failure cannot replace the previous successful site', async t => {
  const root = await temporary(t), dist = join(root, 'dist'); await write(dist, 'index.html', 'previous output');
  await assert.rejects(buildRelease({ destination: dist, steps: async staging => {
    await candidate(staging); await rm(join(staging, 'assets/shared.js'));
  } }), /Missing local asset/);
  assert.equal(await readFile(join(dist, 'index.html'), 'utf8'), 'previous output'); assert.deepEqual(await readdir(root), ['dist']);
});

test('successful release validates before switching and refuses a concurrent writer', async t => {
  const root = await temporary(t), dist = join(root, 'dist'); await write(dist, 'index.html', 'previous output');
  let entered!: () => void, release!: () => void;
  const enteredSteps = new Promise<void>(resolve => { entered = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const first = buildRelease({ destination: dist, base: '/aipoch-network/', steps: async staging => { entered(); await resume; await candidate(staging, '/aipoch-network/'); } });
  await enteredSteps;
  try {
    assert.equal(await readFile(join(dist, 'index.html'), 'utf8'), 'previous output');
    await assert.rejects(buildRelease({ destination: dist, steps: async () => { throw new Error('Should not run'); } }), /Another build/);
  } finally { release(); }
  const result = await first;
  assert.equal(result.pages, 3); assert.ok((await readFile(join(dist, 'index.html'), 'utf8')).includes('AIPOCH'));
  assert.deepEqual(await readdir(root), ['dist']);
});
