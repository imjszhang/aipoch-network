import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

export const NOTICES_FILE = 'third-party-notices.txt';
const licenseFile = /^(?:licen[cs]e|copying)(?:[.-].*)?$/i;
const noticeFile = /^(?:(?:licen[cs]e|copying|notice)(?:[.-].*)?|third[-_]party[-_](?:licen[cs]es?|notices?)(?:[.-].*)?)$/i;
const virtualOwners = new Map([
  ['\0vite/modulepreload-polyfill.js', 'vite'],
  ['\0vite/preload-helper.js', 'vite'],
  ['\0rolldown/runtime.js', 'rolldown'],
]);

function dependencyRoot(id: string): string | undefined {
  const path = id.split('?', 1)[0].replaceAll('\\', '/');
  const marker = '/node_modules/', index = path.lastIndexOf(marker);
  if (index < 0) return undefined;
  const start = path.slice(0, index + marker.length);
  const parts = path.slice(index + marker.length).split('/');
  const name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (!name || name.endsWith('/')) throw new Error('Cannot identify a bundled dependency package');
  return `${start}${name}`;
}

/** Rendered modules, not package.json dependencies, determine which packages ship. */
export async function thirdPartyNotices(moduleIds: Iterable<string>, projectRoot: string): Promise<string> {
  const root = resolve(projectRoot), require = createRequire(join(root, 'package.json'));
  const packages = new Set<string>();
  for (const id of moduleIds) {
    if (id.startsWith('\0')) {
      const owner = virtualOwners.get(id);
      if (!owner) throw new Error(`Unclassified bundled virtual module: ${id.slice(1)}`);
      packages.add(dirname(require.resolve(`${owner}/package.json`)));
      continue;
    }
    const dependency = dependencyRoot(id);
    if (dependency) { packages.add(dependency); continue; }
    const path = id.split('?', 1)[0], local = relative(root, path);
    if (!isAbsolute(path) || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
      throw new Error('Bundled module outside the project needs explicit license attribution');
    }
  }
  const sections = new Map<string, string>();
  for (const directory of packages) {
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown; license?: unknown };
    if (typeof manifest.name !== 'string' || !manifest.name || typeof manifest.version !== 'string' || !manifest.version) {
      throw new Error('Bundled dependency lacks package name or version');
    }
    const identity = `${manifest.name}@${manifest.version}`;
    const files = (await readdir(directory, { withFileTypes: true })).filter(file => file.isFile() && noticeFile.test(file.name)).map(file => file.name).sort();
    if (!files.some(file => licenseFile.test(file))) throw new Error(`Missing license text for bundled dependency ${identity}`);
    const notices: string[] = [];
    for (const file of files) {
      const contents = await readFile(join(directory, file), 'utf8');
      if (!contents.trim()) throw new Error(`Empty license or notice file for bundled dependency ${identity}`);
      notices.push(`--- ${file} ---\n${contents}${contents.endsWith('\n') ? '' : '\n'}`);
    }
    const label = typeof manifest.license === 'string' ? manifest.license : 'See included license files';
    const section = `${identity}\nPackage license metadata: ${label}\n\n${notices.join('\n')}`;
    const existing = sections.get(identity);
    if (existing && existing !== section) throw new Error(`Conflicting installed license texts for ${identity}`);
    sections.set(identity, section);
  }
  return [
    'Third-party notices for the AIPOCH Network browser bundle',
    '',
    'Generated from packages contributing rendered modules to this build.',
    'Versions and complete license/notice texts come from the installed packages.',
    'Package-supplied files may include notices for their own bundled components.',
    'These notices do not grant a license to AIPOCH Network code, catalog content,',
    'or the separate design reference HTML.',
    '',
    ...[...sections].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).flatMap(([, section]) => ['='.repeat(72), '', section]),
  ].join('\n');
}

export function thirdPartyNoticesPlugin(): Plugin {
  let projectRoot = '', noticeUrl = `/${NOTICES_FILE}`;
  return {
    name: 'aipoch-third-party-notices',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { projectRoot = dirname(config.root); noticeUrl = `${config.base}${NOTICES_FILE}`; },
    outputOptions(options) {
      const previous = options.postBanner;
      return { ...options, postBanner: async chunk => [
        typeof previous === 'function' ? await previous(chunk) : previous,
        `/*! Third-party notices: ${noticeUrl} */`,
      ].filter(Boolean).join('\n') };
    },
    async generateBundle(_options, bundle) {
      const ids = new Set(Object.values(bundle).flatMap(output => output.type === 'chunk'
        ? Object.entries(output.modules).filter(([, module]) => module.renderedLength > 0).map(([id]) => id)
        : []));
      this.emitFile({ type: 'asset', fileName: NOTICES_FILE, source: await thirdPartyNotices(ids, projectRoot) });
    },
  };
}
