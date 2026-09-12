import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const notFound = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function validBase(base: string): void { assert(/^\/(?:[a-zA-Z0-9._-]+\/)*$/.test(base) && !base.split('/').some(segment => segment === '.' || segment === '..'), 'SITE_BASE must be / or a slash-terminated static path without traversal'); }
function inside(root: string, file: string): boolean { return file === root || file.startsWith(root + sep); }

/** Replace only a fully validated sibling output. A failed second rename restores the old directory. */
export async function commitOutput(stagingPath: string, destinationPath: string, operations: { rename?: typeof rename } = {}): Promise<{ cleanupWarning?: string }> {
  const staging = resolve(stagingPath), destination = resolve(destinationPath);
  assert(staging !== destination && dirname(staging) === dirname(destination), 'Staging and destination must be different sibling directories');
  const stageInfo = await lstat(staging);
  assert(stageInfo.isDirectory() && !stageInfo.isSymbolicLink(), 'Staging output must be a real directory');
  let exists = false;
  try { const info = await lstat(destination); assert(info.isDirectory() && !info.isSymbolicLink(), 'Previous output must be a real directory'); exists = true; }
  catch (error) { if (!notFound(error)) throw error; }
  const move = operations.rename ?? rename;
  const previous = join(dirname(destination), `.${basename(destination)}-previous-${randomUUID()}`);
  if (exists) await move(destination, previous);
  try { await move(staging, destination); }
  catch (error) {
    if (exists) {
      try { await move(previous, destination); }
      catch (restoreError) { throw new AggregateError([error, restoreError], `Output switch failed and automatic restore failed; the prior output remains at ${previous}`); }
    }
    throw error;
  }
  if (exists) {
    try { await rm(previous, { recursive: true, force: true }); }
    catch { return { cleanupWarning: `New output is ready; remove the previous output at ${previous} after checking its retention requirements.` }; }
  }
  return {};
}

async function outputFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    assert(!item.isSymbolicLink(), `Published output cannot contain symlinks: ${relative(root, file)}`);
    if (item.isDirectory()) files.push(...await outputFiles(root, file));
    else { assert(item.isFile(), `Unexpected output node: ${relative(root, file)}`); files.push(file); }
  }
  return files;
}
function decodeAttribute(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, match => {
    if (match.startsWith('&#')) return String.fromCodePoint(match[2].toLowerCase() === 'x' ? parseInt(match.slice(3, -1), 16) : parseInt(match.slice(2, -1), 10));
    return ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' } as Record<string, string>)[match.toLowerCase()]!;
  });
}
function attributes(tag: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const match of tag.matchAll(/\s([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) values.set(match[1].toLowerCase(), decodeAttribute(match[2] ?? match[3] ?? match[4]));
  return values;
}

/** Verify actual files and generated references, not a Vite development-server fallback. */
export async function validateOutput(directory: string, base = '/'): Promise<{ pages: number; files: number; snapshot_id: string }> {
  validBase(base);
  const root = resolve(directory), files = await outputFiles(root), fileSet = new Set(files);
  const readJson = async (path: string) => JSON.parse(await readFile(join(root, path), 'utf8')) as Record<string, unknown>;
  for (const expected of ['index.html', '404.html', '.nojekyll', 'routes.json', 'catalog/v1/manifest.json', 'internal/catalog.json', 'internal/search.json']) assert(fileSet.has(join(root, expected)), `Missing required output: ${expected}`);
  const routes = await readJson('routes.json');
  assert(routes.base === base && Array.isArray(routes.paths) && routes.paths.length > 0, 'Invalid route manifest or mismatched SITE_BASE');
  assert(new Set(routes.paths).size === routes.paths.length, 'Duplicate prerendered routes');
  for (const route of routes.paths) {
    assert(typeof route === 'string' && /^\/(?:[^/?#\\\u0000-\u0020]+\/)*$/.test(route) && !route.split('/').some(part => part === '.' || part === '..'), 'Invalid prerendered route');
    assert(fileSet.has(join(root, route.slice(1), 'index.html')), `Missing prerendered page: ${route}`);
  }
  const manifest = await readJson('catalog/v1/manifest.json');
  assert(typeof manifest.snapshot_id === 'string' && manifest.snapshot_id === routes.snapshot_id, 'Routes and catalog snapshots differ');
  for (const path of ['internal/catalog.json', 'internal/search.json']) assert((await readJson(path)).snapshot_id === manifest.snapshot_id, `${path} snapshot differs from public catalog`);
  const origin = 'https://aipoch-build.invalid';
  const htmlFiles = files.filter(file => extname(file) === '.html');
  const markup = new Map<string, string>(), anchors = new Map<string, Set<string>>();
  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    assert(!html.includes('<!--app-html-->') && !html.includes('<!--app-data-->'), `Unrendered template: ${relative(root, file)}`);
    assert(html.includes('window.__AIPOCH__') && html.includes('Skip to content'), `Missing prerendered app: ${relative(root, file)}`);
    const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, tag => tag.slice(0, tag.indexOf('>') + 1) + '</script>').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
    markup.set(file, visible);
    anchors.set(file, new Set([...visible.matchAll(/<[^>]+>/g)].map(match => attributes(match[0]).get('id')).filter((value): value is string => value !== undefined)));
  }
  function pageUrl(file: string): URL {
    const path = relative(root, file).split(sep).join('/');
    return new URL(`${base}${path.endsWith('index.html') ? path.slice(0, -10) : path}`, origin);
  }
  function checkReference(raw: string, file: string, kind: 'link' | 'asset', cssFragment = false): void {
    assert(raw.length > 0 && !/[\u0000-\u0020\u007f\\]/.test(raw), `Invalid ${kind} reference in ${relative(root, file)}`);
    if (raw.startsWith('data:')) { assert(kind === 'asset', 'Data URLs cannot be navigation links'); return; }
    if (cssFragment && raw.startsWith('#')) return;
    assert(!raw.startsWith('//'), `Protocol-relative reference in ${relative(root, file)}`);
    const url = new URL(raw, pageUrl(file));
    assert(!url.username && !url.password, `Credential URL in ${relative(root, file)}`);
    if (url.origin !== origin) { assert(url.protocol === 'https:' || (kind === 'link' && url.protocol === 'mailto:'), `Unsupported external reference in ${relative(root, file)}`); return; }
    assert(url.pathname.startsWith(base), `Local ${kind} escapes SITE_BASE: ${raw}`);
    let decoded: string;
    try { decoded = decodeURIComponent(url.pathname.slice(base.length)); } catch { throw new Error(`Invalid encoded output link: ${raw}`); }
    assert(!decoded.includes('\0') && !decoded.includes('\\'), `Unsafe output path: ${raw}`);
    let target = resolve(root, decoded);
    assert(inside(root, target), `Local ${kind} escapes output: ${raw}`);
    if (url.pathname.endsWith('/')) target = join(target, 'index.html');
    assert(fileSet.has(target), `Missing local ${kind} in ${relative(root, file)}: ${raw}`);
    if (url.hash && anchors.has(target)) {
      let anchor: string;
      try { anchor = decodeURIComponent(url.hash.slice(1)); } catch { throw new Error(`Invalid anchor: ${raw}`); }
      assert(anchors.get(target)!.has(anchor), `Missing anchor in ${relative(root, file)}: ${raw}`);
    }
  }
  for (const [file, html] of markup) for (const match of html.matchAll(/<[^>]+>/g)) {
    const tag = match[0], attr = attributes(tag);
    if (attr.has('href')) checkReference(attr.get('href')!, file, /^<a\b/i.test(tag) ? 'link' : 'asset');
    if (attr.has('src')) checkReference(attr.get('src')!, file, 'asset');
    if (attr.has('srcset')) for (const candidate of attr.get('srcset')!.split(',')) checkReference(candidate.trim().split(/\s+/)[0], file, 'asset');
  }
  for (const file of files) {
    if (extname(file) === '.css') {
      const css = await readFile(file, 'utf8');
      for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/g)) checkReference(match[1] ?? match[2] ?? match[3], file, 'asset', true);
      for (const match of css.matchAll(/@import\s+(?:"([^"]+)"|'([^']+)')/g)) checkReference(match[1] ?? match[2], file, 'asset');
    }
    if (extname(file) === '.js') {
      const code = await readFile(file, 'utf8');
      for (const match of code.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)(?:"([./][^"]+)"|'([./][^']+)')/g)) checkReference(match[1] ?? match[2], file, 'asset');
    }
  }
  return { pages: htmlFiles.length, files: files.length, snapshot_id: manifest.snapshot_id };
}

function execute(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveCommand() : reject(new Error(`Build step failed (${signal ?? code ?? 'unknown'}): ${args.at(-1)}`)));
  });
}
export async function runBuildSteps(staging: string, base = process.env.SITE_BASE ?? '/'): Promise<void> {
  const env = { ...process.env, BUILD_OUTPUT: staging, SITE_BASE: base };
  await execute(['--import', 'tsx', 'pipeline/cli.ts', 'build'], env);
  await execute(['node_modules/vite/bin/vite.js', 'build'], env);
  await execute(['--import', 'tsx', 'scripts/prerender.ts'], env);
}
export async function buildRelease(options: { destination?: string; base?: string; steps?: (staging: string) => Promise<void> } = {}): Promise<{ pages: number; files: number; snapshot_id: string }> {
  const destination = resolve(options.destination ?? 'dist'), base = options.base ?? process.env.SITE_BASE ?? '/';
  validBase(base);
  assert(destination !== resolve('.') && dirname(destination) !== destination, 'Refusing to replace the project or filesystem root');
  await mkdir(dirname(destination), { recursive: true });
  const lock = join(dirname(destination), `.${basename(destination)}-build-lock`);
  try { await mkdir(lock); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Another build or interrupted build owns ${lock}; inspect its process before removing the lock`); throw error; }
  let staging: string | undefined;
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, started_at: new Date().toISOString(), destination }));
    staging = await mkdtemp(join(dirname(destination), `.${basename(destination)}-staging-`));
    await (options.steps ?? (output => runBuildSteps(output, base)))(staging);
    const result = await validateOutput(staging, base);
    const committed = await commitOutput(staging, destination);
    staging = undefined;
    if (committed.cleanupWarning) console.warn(committed.cleanupWarning);
    return result;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  buildRelease().then(result => console.log(`Validated ${result.pages} pages and ${result.files} files; dist now contains snapshot ${result.snapshot_id}.`))
    .catch(error => { console.error(error instanceof Error ? error.message : 'Release build failed'); process.exitCode = 1; });
}
