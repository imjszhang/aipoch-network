import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { NOTICES_FILE, thirdPartyNotices } from '../../scripts/third-party-notices.js';

async function temporary(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'aipoch-notices-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function packageFiles(root: string, path: string, name: string, license?: string): Promise<string> {
  const directory = join(root, 'node_modules', path);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT' }));
  if (license !== undefined) await writeFile(join(directory, 'LICENSE'), license);
  return join(directory, 'index.js');
}

test('the actual browser bundle ships deterministic notices for every included dependency and runtime helper', async () => {
  const root = resolve('.');
  async function actual(base: string) {
    const result = await build({ configFile: join(root, 'vite.config.ts'), root: join(root, 'web'), base, publicDir: false, logLevel: 'silent', build: { write: false } });
    assert.ok(!Array.isArray(result) && 'output' in result);
    const notice = result.output.find(file => file.fileName === NOTICES_FILE);
    assert.ok(notice?.type === 'asset');
    const text = String(notice.source);
    const chunks = result.output.filter(file => file.type === 'chunk');
    assert.ok(chunks.length > 0);
    for (const chunk of chunks) assert.ok(chunk.code.startsWith(`/*! Third-party notices: ${base}${NOTICES_FILE} */`));
    return { text, chunks: chunks.map(chunk => ({ file: chunk.fileName, code: chunk.code })) };
  }
  const first = await actual('/'), second = await actual('/');
  assert.deepEqual(first, second, 'same source and installed dependencies must produce identical bytes');
  const expected = ['lucide-react', 'minisearch', 'react', 'react-dom', 'rolldown', 'scheduler', 'vite'];
  const sections = first.text.match(/^\S+@\d[^\n]*$/gm) ?? [];
  const expectedIdentities: string[] = [];
  for (const name of expected) {
    const directory = join(root, 'node_modules', name);
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    expectedIdentities.push(`${name}@${manifest.version}`);
    const license = await readFile(join(directory, name === 'vite' ? 'LICENSE.md' : name === 'minisearch' ? 'LICENSE.txt' : 'LICENSE'), 'utf8');
    assert.ok(first.text.includes(license), `${name} complete license text is present`);
  }
  assert.deepEqual(sections, expectedIdentities.sort());
  assert.ok(first.text.includes(await readFile(join(root, 'node_modules/rolldown/THIRD-PARTY-LICENSE'), 'utf8')));
  assert.match(first.text, /Copyright \(c\) 2013-present Cole Bemis/);
  assert.match(first.text, /The MIT License \(MIT\) \(for the icons listed above\)/);
  assert.doesNotMatch(first.text, /^ajv@/m, 'pipeline-only dependency is not attributed as bundled browser code');
  assert.ok(!first.text.includes(root), 'no local filesystem paths are published');
  assert.ok(!first.text.includes('aipoch-network-concept-v6.html'), 'design HTML is not a bundle input');
  const subpath = await actual('/aipoch-network/');
  assert.equal(subpath.text, first.text, 'notices themselves are independent of deployment base');
  assert.notEqual(subpath.chunks[0].file, first.chunks[0].file, 'banner changes participate in the content hash');
});

test('nested and scoped packages retain exact versions, all supplied notices, and stable ordering', async t => {
  const root = await temporary(t);
  const primary = await packageFiles(root, '@example/first', '@example/first', 'First license\n');
  const nested = await packageFiles(root, 'parent/node_modules/child', 'child', 'Child license\r\n');
  await writeFile(join(root, 'node_modules/@example/first/NOTICE.md'), 'Additional copyright attribution\n');
  await writeFile(join(root, 'node_modules/@example/first/THIRD-PARTY-LICENSE'), 'Derived component terms\n');
  const own = join(root, 'web/app.tsx');
  const forward = await thirdPartyNotices([primary, `${primary}?commonjs-proxy`, nested, own], root);
  const reverse = await thirdPartyNotices([own, nested, primary], root);
  assert.equal(forward, reverse);
  assert.equal((forward.match(/^@example\/first@1.0.0$/gm) ?? []).length, 1);
  for (const contents of ['First license\n', 'Child license\r\n', 'Additional copyright attribution\n', 'Derived component terms\n']) assert.ok(forward.includes(contents));
  assert.ok(forward.indexOf('@example/first@1.0.0') < forward.indexOf('child@1.0.0'));
  assert.ok(!forward.includes(root));
});

test('package metadata alone cannot replace missing or empty license text', async t => {
  const root = await temporary(t);
  const missing = await packageFiles(root, 'missing', 'missing');
  await assert.rejects(thirdPartyNotices([missing], root), /Missing license text.*missing@1.0.0/);
  const empty = await packageFiles(root, 'empty', 'empty', '\n  \n');
  await assert.rejects(thirdPartyNotices([empty], root), /Empty license or notice.*empty@1.0.0/);
});

test('unclassified generated code or code outside this repository requires explicit attribution', async t => {
  const root = await temporary(t);
  await assert.rejects(thirdPartyNotices(['\0new-bundler/runtime.js'], root), /Unclassified bundled virtual module/);
  await assert.rejects(thirdPartyNotices([join(root, '../external-code.js')], root), /outside the project/);
});
