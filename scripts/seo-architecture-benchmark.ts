import { chromium, devices } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep, extname, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { cpus, platform, release } from 'node:os';

// A controlled local gzip server, not a claim about GitHub Pages cache headers.
async function serve(directory: string) {
  const root = resolve(directory);
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname);
      let file = resolve(root, `.${pathname}`);
      if (!file.startsWith(root + sep) && file !== root) throw new Error('Outside fixture');
      if ((await stat(file)).isDirectory()) file += '/index.html';
      const body = await readFile(file), type = extname(file);
      const gzip = /\b gzip\b|^gzip\b|,gzip\b/.test(req.headers['accept-encoding'] ?? '');
      const compressed = gzip && ['.html', '.js', '.css', '.json', '.txt', '.xml', '.svg'].includes(type);
      const bytes = compressed ? gzipSync(body, { level: 6 }) : body;
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg' };
      res.writeHead(200, { 'Content-Type': types[type] ?? 'application/octet-stream', 'Content-Length': bytes.length,
        'Cache-Control': type === '.html' || pathname.endsWith('/history.json') ? 'no-store' : 'public, max-age=86400',
        ...(compressed ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
      res.end(bytes);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing server address');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(done => server.close(() => done())) };
}
const { values } = parseArgs({ options: {
  before: { type: 'string' }, after: { type: 'string' }, output: { type: 'string' }, repetitions: { type: 'string', default: '5' },
} });
if (!values.before || !values.after || !values.output) throw new Error('Use --before <site> --after <site> --output <json>');
const repetitions = Number(values.repetitions);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('Invalid repetitions');
const profiles = [{ name: 'normal', bits: 1_600_000, rtt: 150, targets: [3000, 5000, 6000] }, { name: 'slow', bits: 400_000, rtt: 400, targets: [6000, 12000, 15000] }];
type Marks = { menu_ms?: number; filter_ms?: number; search_ms?: number; lcp_ms: number; cls: number };
const rows: Array<{ version: string; profile: string; cache: string; repetition: number; marks: Marks; failures: string[]; resources: unknown[]; interaction_ms?: number }> = [];
const homes: Array<{ version: string; profile: string; cache: string; repetition: number; lcp_ms: number; cls: number; body_text: string }> = [];
const datasets: Record<string, unknown> = {};
const started = new Date().toISOString();
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL });
try {
  for (const [version, directory] of [['before', values.before], ['after', values.after]]) {
    const metadata = JSON.parse(await readFile(resolve(directory, 'internal/catalog.json'), 'utf8'));
    const homeHtml = await readFile(resolve(directory, 'index.html'), 'utf8');
    const scriptPaths = [...homeHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
    datasets[version] = { snapshot_id: metadata.snapshot_id, generated_at: metadata.generated_at, projects: metadata.catalog.projects.length, resources: metadata.catalog.resources.length,
      entry_scripts: await Promise.all(scriptPaths.map(async path => { const bytes = await readFile(resolve(directory, `.${path}`)); return { path, bytes: bytes.length, local_gzip_bytes: gzipSync(bytes, { level: 6 }).length }; })) };
    const server = await serve(directory);
    try { for (const profile of profiles) for (let repetition = 1; repetition <= repetitions; repetition++) {
      const context = await browser.newContext({ ...devices['Pixel 7'] });
      try {
        const page = await context.newPage(), session = await context.newCDPSession(page);
        await session.send('Network.enable');
        await session.send('Network.emulateNetworkConditions', { offline: false, latency: profile.rtt, downloadThroughput: profile.bits / 8, uploadThroughput: profile.bits / 8 });
        await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await page.addInitScript(() => {
          const state: Marks = { lcp_ms: 0, cls: 0 };
          Object.assign(window, { seoTiming: state });
          new PerformanceObserver(list => { for (const entry of list.getEntries()) state.lcp_ms = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
          new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!(entry as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput) state.cls += (entry as PerformanceEntry & { value: number }).value; }).observe({ type: 'layout-shift', buffered: true });
          new MutationObserver(() => {
            if (state.menu_ms === undefined && document.querySelector<HTMLButtonElement>('.mobile-menu:not([disabled])')) state.menu_ms = performance.now();
            if (state.filter_ms === undefined && document.querySelector<HTMLSelectElement>('select[aria-label="Sort results"]:not([disabled])')) state.filter_ms = performance.now();
            if (state.search_ms === undefined && state.filter_ms !== undefined && document.querySelector('.empty h3')?.textContent === 'No matching entries') state.search_ms = performance.now();
          }).observe(document, { subtree: true, childList: true, attributes: true });
        });
        for (const cache of ['cold', 'warm']) {
          const failures: string[] = [];
          const errors = (error: Error) => failures.push(error.message);
          page.on('pageerror', errors);
          const path = version === 'after' ? '/browse/projects/' : '/projects/';
          await page.goto(`${server.url}${path}?q=zzzz-seo-absent`, { waitUntil: 'commit' });
          try { await page.waitForFunction(() => (window as unknown as { seoTiming: Marks }).seoTiming.search_ms !== undefined, undefined, { timeout: 35_000 }); }
          catch { failures.push('Readiness did not complete within 35 seconds'); }
          const marks = await page.evaluate(() => (window as unknown as { seoTiming: Marks }).seoTiming);
          let interaction_ms: number | undefined;
          if (marks.search_ms !== undefined) {
            // Restore the complete result set before measuring sorting, so an
            // empty search cannot make the ready-state operation artificially cheap.
            await page.getByRole('searchbox', { name: 'Search directory' }).fill('');
            await page.waitForFunction(total => document.querySelector('.results-heading h2 b')?.textContent === String(total), metadata.catalog.projects.length);
            interaction_ms = await page.evaluate(async () => {
              const select = document.querySelector<HTMLSelectElement>('select[aria-label="Sort results"]')!;
              const start = performance.now(); select.value = 'added'; select.dispatchEvent(new Event('change', { bubbles: true }));
              await new Promise<void>(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())));
              if (new URL(location.href).searchParams.get('sort') !== 'added') throw new Error('Sort was not applied');
              return performance.now() - start;
            });
          }
          const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => {
            const row = entry as PerformanceResourceTiming;
            return { path: new URL(row.name).pathname, start_ms: row.startTime, response_start_ms: row.responseStart, end_ms: row.responseEnd, transfer_bytes: row.transferSize, encoded_bytes: row.encodedBodySize, decoded_bytes: row.decodedBodySize };
          }));
          rows.push({ version, profile: profile.name, cache, repetition, marks, failures, resources, interaction_ms });
          page.off('pageerror', errors);
          console.log(`${version} ${profile.name} ${cache} ${repetition}: ${JSON.stringify(marks)} ${failures.join('; ')}`);
        }
      } finally { await context.close(); }
      const homeContext = await browser.newContext({ ...devices['Pixel 7'] });
      try {
        const page = await homeContext.newPage(), session = await homeContext.newCDPSession(page);
        await session.send('Network.enable');
        await session.send('Network.emulateNetworkConditions', { offline: false, latency: profile.rtt, downloadThroughput: profile.bits / 8, uploadThroughput: profile.bits / 8 });
        await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await page.addInitScript(() => {
          Object.assign(window, { homeTiming: { lcp_ms: 0, cls: 0 } });
          new PerformanceObserver(list => { for (const entry of list.getEntries()) (window as unknown as { homeTiming: { lcp_ms: number } }).homeTiming.lcp_ms = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
          new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!(entry as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput) (window as unknown as { homeTiming: { cls: number } }).homeTiming.cls += (entry as PerformanceEntry & { value: number }).value; }).observe({ type: 'layout-shift', buffered: true });
        });
        for (const cache of ['cold', 'warm']) {
          await page.goto(server.url, { waitUntil: 'load' });
          await page.waitForFunction(() => Boolean(document.querySelector('.mobile-menu:not([disabled])')));
          await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
          const measurement = await page.evaluate(() => ({ ...(window as unknown as { homeTiming: { lcp_ms: number; cls: number } }).homeTiming, body_text: document.body.innerText }));
          homes.push({ version, profile: profile.name, cache, repetition, ...measurement });
          if (profile.name === 'normal' && repetition === 1 && cache === 'cold') {
            await mkdir(dirname(resolve(values.output!)), { recursive: true });
            await page.screenshot({ path: resolve(dirname(values.output!), `${version}-home-mobile.png`), fullPage: true });
          }
        }
      } finally { await homeContext.close(); }
    } } finally { await server.close(); }
    console.log(`${version}: snapshot ${metadata.snapshot_id}, projects ${metadata.catalog.projects.length}, resources ${metadata.catalog.resources.length}`);
  }
  const summary = [...new Set(rows.map(row => `${row.version}/${row.profile}/${row.cache}`))].map(key => {
    const group = rows.filter(row => `${row.version}/${row.profile}/${row.cache}` === key);
    return { key, samples: group.length, failed: group.filter(row => row.failures.length).length,
      measurements: Object.fromEntries(['menu_ms', 'filter_ms', 'search_ms', 'lcp_ms', 'cls', 'interaction_ms'].map(metric => {
        const samples = group.map(row => metric === 'interaction_ms' ? row.interaction_ms : row.marks[metric as keyof Marks]).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
        return [metric, { measured: samples.length, median: samples[Math.floor(samples.length / 2)] ?? null, maximum: samples.at(-1) ?? null }];
      })) };
  });
  const afterRows = rows.filter(row => row.version === 'after');
  const gates = {
    sample_count: repetitions >= 5,
    readiness: afterRows.every(row => row.failures.length === 0 && ['menu_ms', 'filter_ms', 'search_ms'].every((key, i) => {
      const value = row.marks[key as keyof Marks]; return value !== undefined && value <= profiles.find(profile => profile.name === row.profile)!.targets[i];
    })),
    ready_sort: afterRows.every(row => row.interaction_ms !== undefined && row.interaction_ms <= 200),
    no_full_catalog_request: afterRows.every(row => !row.resources.some(resource => (resource as { path: string }).path.endsWith('/internal/catalog.json'))),
    homepage_text_unchanged: homes.every(row => row.body_text === homes[0].body_text),
  };
  await mkdir(dirname(resolve(values.output)), { recursive: true });
  await writeFile(values.output, JSON.stringify({ started_at: started, finished_at: new Date().toISOString(), browser: browser.version(), node: process.version,
    machine: { platform: platform(), os: release(), cpu: cpus()[0]?.model }, profiles, repetitions,
    method: 'Pixel 7 viewport on desktop Chromium; CDP network and 4x CPU. Navigation start is time zero. Cold context then a warm navigation in same context. Local server actually serves gzip level 6 and fixed public asset caching; this is not observed Pages caching or field INP. Ready sort timing includes event dispatch, React update and two animation frames. Fixed absent query verifies search completion, not just HTTP completion. No physical mobile or isolated CPU reservation.',
    datasets, gates,
    summary, rows, homes: homes.map(({ body_text: _text, ...row }) => row) }, null, 2) + '\n');
} finally { await browser.close(); }
