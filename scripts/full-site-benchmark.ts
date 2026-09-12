import { chromium, devices, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { buildVerificationSite, startVerificationServer, treeMeasurements, verificationData } from './verification-site.js';
import { makeSearchIndex, searchDocuments } from '../web/src/search.js';

const SIZES = [100, 1000, 10000];
const QUERIES = ['00000', 'cohort risk', '合成队列风险', 'genomics', '合成基因分析', 'zzzz-absent'];
const round = (value: number) => Number(value.toFixed(3));
const percentiles = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values.length, p50_ms: round(sorted[Math.ceil(sorted.length * .5) - 1] ?? 0), p95_ms: round(sorted[Math.ceil(sorted.length * .95) - 1] ?? 0) };
};
function nodeMemory() { const value = process.memoryUsage(); return { rss_bytes: value.rss, heap_used_bytes: value.heapUsed, heap_total_bytes: value.heapTotal }; }
async function sourceHashes() {
  const paths = ['web/src/App.tsx', 'web/src/model.ts', 'web/src/main.tsx', 'web/src/search.ts', 'web/src/styles.css', 'web/src/SourceRecords.tsx', 'web/src/SourceCollaboration.tsx', 'scripts/render-page.ts', 'scripts/build.ts', 'scripts/verification-site.ts', 'scripts/full-site-benchmark.ts'];
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
}
async function frames(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }

async function measureNavigation(context: BrowserContext, url: string, name: string) {
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send('Performance.enable');
  const errors: string[] = [], failedLocalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failedLocalRequests.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  let observing = true;
  const heap: number[] = [];
  const sampler = (async () => {
    while (observing) {
      const { metrics } = await session.send('Performance.getMetrics');
      const used = metrics.find(row => row.name === 'JSHeapUsedSize')?.value;
      if (used !== undefined) heap.push(used);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  })();
  const started = performance.now();
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.locator('h1').waitFor();
  if (name === 'explore') {
    await page.getByRole('searchbox', { name: 'Search directory' }).fill('zzzz-absent');
    await page.getByRole('heading', { name: 'No matching entries', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  }
  await frames(page);
  const readiness = performance.now() - started;
  observing = false; await sampler;
  const metrics = await session.send('Performance.getMetrics');
  const browserMetrics = await page.evaluate(() => {
    const navigation = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const resources = window.performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const times = [navigation, ...resources];
    return {
      dom_content_loaded_ms: navigation.domContentLoadedEventEnd,
      load_event_ms: navigation.loadEventEnd,
      first_contentful_paint_ms: window.performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      document_encoded_body_bytes: navigation.encodedBodySize,
      resource_encoded_body_bytes: resources.reduce((sum, row) => sum + row.encodedBodySize, 0),
      measured_transfer_bytes: times.reduce((sum, row) => sum + row.transferSize, 0),
      resources: resources.map(row => ({ path: new URL(row.name).pathname, encoded_body_bytes: row.encodedBodySize, duration_ms: row.duration })),
      page_payload_bytes: new TextEncoder().encode(JSON.stringify((window as Window & { __AIPOCH__?: unknown }).__AIPOCH__)).byteLength,
      document_elements: document.querySelectorAll('*').length,
      horizontal_overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  const result = { name, status: response?.status(), ...browserMetrics, gzip_equivalent_all_request_bytes: null as number | null,
    observed_ready_ms: round(readiness),
    // Includes an explicit 500 ms network-idle wait; this is not a hydration or load metric.
    js_heap_samples: { interval_target_ms: 25, count: heap.length, max_observed_bytes: Math.max(...heap),
      final_bytes: metrics.metrics.find(row => row.name === 'JSHeapUsedSize')?.value ?? null },
    errors, failed_local_requests: failedLocalRequests };
  if (response?.status() !== 200 || errors.length || failedLocalRequests.length) throw new Error(`Browser failed ${name}: ${JSON.stringify(result)}`);
  return { page, result };
}

async function measureQueries(page: Page, expected: Map<string, number>) {
  const samples: { query: string; results: number; ms: number }[] = [];
  for (let repetition = 0; repetition < 4; repetition++) {
    for (let step = 0; step < QUERIES.length; step++) {
      const query = QUERIES[(step + repetition) % QUERIES.length]!;
      const count = expected.get(query)!;
      const start = performance.now();
      await page.getByRole('searchbox', { name: 'Search directory' }).fill(query);
      await page.locator('.results-heading h2').filter({ hasText: `Search results (${count})` }).waitFor();
      await frames(page);
      if (repetition) samples.push({ query, results: count, ms: round(performance.now() - start) });
    }
  }
  return { ...percentiles(samples.map(row => row.ms)), warmup_queries: QUERIES.length,
    by_query: QUERIES.map(query => ({ query, result_count: expected.get(query), ...percentiles(samples.filter(row => row.query === query).map(row => row.ms)) })) };
}

async function browserMeasurements(browser: Browser, url: string, expected: Map<string, number>) {
  const measurements = [];
  for (const device of ['desktop', 'mobile'] as const) {
    const context = await browser.newContext(device === 'desktop' ? { viewport: { width: 1440, height: 1000 } } : devices['Pixel 7']);
    // No remote resource or scientific repository is needed for this measurement.
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    try {
      const routes = [ ['home', ''], ['explore', 'explore/'], ['resource', 'capabilities/resource~method-0/'], ['organization', 'organizations/actor~github~42/'] ];
      const pages = [];
      let queryMeasurement;
      for (const [name, path] of routes) {
        const measurement = await measureNavigation(context, new URL(path, url).href, name);
        if (name === 'explore') queryMeasurement = await measureQueries(measurement.page, expected);
        pages.push(measurement.result); await measurement.page.close();
      }
      measurements.push({ device, emulated: device === 'mobile', viewport: device === 'desktop' ? { width: 1440, height: 1000 } : devices['Pixel 7'].viewport, pages, queries: queryMeasurement });
    } finally { await context.close(); }
  }
  return measurements;
}

async function measureCase(size: number) {
  const directory = await mkdtemp(join(tmpdir(), `aipoch-full-${size}-`));
  let server: Awaited<ReturnType<typeof startVerificationServer>> | undefined;
  let browser: Browser | undefined;
  try {
    const sourceAtStart = await sourceHashes();
    const memoryBefore = nodeMemory();
    const data = verificationData(size);
    const actual = await buildVerificationSite(directory, data, '/', message => process.stderr.write(`${size}: ${message}\n`));
    const memoryAfterBuild = nodeMemory();
    const output = await treeMeasurements(actual.directory);
    const searchBody = await readFile(join(actual.directory, 'internal/search.json'));
    const search = { raw_bytes: searchBody.byteLength, gzip_bytes: gzipSync(searchBody, { level: 6 }).byteLength };
    const index = makeSearchIndex(searchDocuments(data.catalog));
    const expected = new Map(QUERIES.map(query => [query, index.search(query).length]));
    server = await startVerificationServer(actual.directory);
    let channel = process.env.PW_CHANNEL ?? 'chromium';
    try { browser = await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, args: ['--enable-precise-memory-info'] }); }
    catch (error) {
      if (process.env.PW_CHANNEL) throw error;
      channel = 'chrome'; browser = await chromium.launch({ channel, args: ['--enable-precise-memory-info'] });
    }
    const browserResult = await browserMeasurements(browser, server.url, expected);
    const htmlFor = { home: 'index.html', explore: 'explore/index.html', resource: 'capabilities/resource~method-0/index.html', organization: 'organizations/actor~github~42/index.html' } as const;
    for (const device of browserResult) for (const page of device.pages) {
      const requests = [{ path: htmlFor[page.name as keyof typeof htmlFor], bytes: page.document_encoded_body_bytes }, ...page.resources.map(resource => ({ path: resource.path.replace(/^\//, ''), bytes: resource.encoded_body_bytes }))];
      page.gzip_equivalent_all_request_bytes = (await Promise.all(requests.map(async request => request.bytes === 0 ? 0 : gzipSync(await readFile(join(actual.directory, request.path)), { level: 6 }).byteLength))).reduce((sum, bytes) => sum + bytes, 0);
    }
    const sourceAtEnd = await sourceHashes();
    if (JSON.stringify(sourceAtStart) !== JSON.stringify(sourceAtEnd)) throw new Error('Measured source files changed during this case; rerun after concurrent edits finish');
    return { routable_entries: size, source_sha256: sourceAtStart, catalog_records: Object.fromEntries(Object.entries(data.catalog).map(([key, rows]) => [key, rows.length])),
      static_build: { ...actual, directory: '(temporary output removed after measurement)' }, output, search,
      browser: { version: browser.version(), channel, devices: browserResult },
      node_memory_samples: { before_fixture: memoryBefore, after_build: memoryAfterBuild, after_browser: nodeMemory() },
      budgets: { raw_static_package_bytes: 100_000_000, raw_static_package_pass: output.bytes <= 100_000_000,
        compressed_search_bytes: 2_000_000, compressed_search_pass: search.gzip_bytes <= 2_000_000,
        complete_first_search_gzip_pass: browserResult.every(device => device.pages.filter(page => page.name === 'explore').every(page => page.gzip_equivalent_all_request_bytes! <= 2_000_000)) } };
  } finally { await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
}
type CaseResult = Awaited<ReturnType<typeof measureCase>>;

async function isolatedCase(size: number): Promise<CaseResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--case', String(size)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let output = ''; child.stdout.on('data', data => { output += String(data); });
    child.on('error', reject);
    child.on('exit', code => { if (code !== 0) reject(new Error(`Full-site size ${size} failed (${code})`)); else { try { resolve(JSON.parse(output) as CaseResult); } catch (error) { reject(error); } } });
  });
}

async function main() {
  const caseIndex = process.argv.indexOf('--case');
  if (caseIndex >= 0) { const size = Number(process.argv[caseIndex + 1]); if (!SIZES.includes(size)) throw new Error('Invalid benchmark size'); process.stdout.write(JSON.stringify(await measureCase(size))); return; }
  const started = new Date().toISOString();
  const cases: CaseResult[] = [];
  for (const size of SIZES) {
    console.log(`Building and browsing the complete ${size}-entry synthetic website in a temporary directory.`);
    const result = await isolatedCase(size); cases.push(result);
    console.log(`${size}: ${result.static_build.pages} actual HTML pages, ${result.output.bytes} bytes, ${round(result.static_build.timings_ms.total / 1000)} s build+validation, ${result.search.gzip_bytes} gzip search bytes.`);
    await mkdir('docs/verification', { recursive: true });
    await writeFile('docs/verification/full-site-benchmark.partial.json', JSON.stringify({ started_at: started, cases }, null, 2) + '\n');
  }
  if (cases.some(row => JSON.stringify(row.source_sha256) !== JSON.stringify(cases[0]!.source_sha256))) throw new Error('Source files differ between sizes; rerun with one implementation');
  const report = { benchmark_version: 1, started_at: started, finished_at: new Date().toISOString(),
    machine: { platform: platform(), architecture: arch(), os_release: release(), cpu_model: cpus()[0]?.model, logical_cpus: cpus().length, installed_memory_bytes: totalmem(), node: process.version },
    methodology: {
      fixture: '100/1000/10000 routable entries. All names and GitHub addresses are synthetic. Each corpus has 3 projects, 3 sources, 1 organization, 1 user, 1 collection, and N-9 resources. Roughly two thirds of resources belong to the single organization, deliberately testing a highly connected detail. Claims and tombstones add non-indexed records. All records pass the public contract validator.',
      build: 'Each case is a fresh Node process: contract-valid synthetic shards/index -> production Vite assets -> production renderPage for EVERY entry and static/tombstone route -> production validateOutput for all files/links/anchors. One current snapshot, no historical snapshots. No scale extrapolation. Synthetic emission replaces GitHub ingestion; no GitHub fetching or source normalizer throughput is measured.',
      browser: 'Installed Chromium or explicit PW_CHANNEL; fixed-browser unavailable falls back to system Chrome. Each case launches a fresh browser. Each device uses a fresh context and each page a fresh tab; routing disables browser HTTP cache. Desktop 1440x1000 and Playwright Pixel 7 emulation run on the same desktop CPU, without CPU/network throttling; these are not physical mobile measurements.',
      timing: 'Single cold navigation per page/device/scale; Navigation Timing reports load and FCP. observed_ready_ms additionally includes the standard 500 ms networkidle wait, two animation frames, and one interactive directory check, so it is NOT an isolated hydration measurement. Query times include Playwright transport, real input/React result rendering, a checked result count, and two animation frames; six warmups + eighteen measured samples per device.',
      memory: 'Chrome CDP JSHeapUsedSize sampled at a target 25 ms during navigation until observed ready; reports maximum observed JS heap and final sample. Sampling can miss short peaks; this is NOT total renderer RSS, a guaranteed peak, GPU memory, or physical mobile peak. Node samples are separate instantaneous readings without forced GC.',
      size: 'All output files read and measured. Original 100 MB target interpreted as raw uncompressed static package bytes, not a tarball or HTTP transfer. Individual-file gzip level 6 sums measured separately. Local production preview sends uncompressed HTTP; browser transfer counts are observed local transfer, not deployed network performance. Both index gzip and ALL browser-observed first-search request bodies (HTML, JS, CSS, shared catalog and search index) recompressed individually at gzip level 6 are compared to 2 MB; these are compression equivalents, not observed compressed HTTP.',
    }, cases, estimates: [],
    remaining_limits: ['Production metadata diversity and larger descriptions are not represented by repetitive synthetic text.', 'Actual mobile hardware, slow networks, total browser process peak memory and isolated hydration CPU timing remain unmeasured.', 'No reference-HTML rendering or exact A22 visual comparison was performed.', 'No GitHub Pages deployment or upstream GitHub ingestion load test was performed.'],
  };
  await writeFile('docs/verification/full-site-benchmark.json', JSON.stringify(report, null, 2) + '\n');
  const mb = (bytes: number) => (bytes / 1_000_000).toFixed(2);
  const markdown = ['# 完整静态站点与实际浏览器规模测量', '',
    `实际测量时间：${report.started_at} 至 ${report.finished_at}。完整数据：[full-site-benchmark.json](full-site-benchmark.json)。`, '',
    `机器：${report.machine.cpu_model}，${report.machine.architecture}，${report.machine.platform} ${report.machine.os_release}，Node ${report.machine.node}。每个规模是独立 Node 进程及浏览器，构建产物位于隔离临时目录，测量后删除。`, '',
    '## 完整构建', '',
    '每个规模实际生成所有静态页面并通过生产输出检查器逐一检查本地链接、锚点、资源与快照一致性。没有把单页大小乘以数量当作整站测量。合成 fixture 经过公开契约校验；本次计时从合成契约产物开始，不包含 GitHub 抓取、归一化或限流成本。', '',
    '| 目录条目 | HTML页数 | 完整产物 MB | 逐文件gzip合计 MB | 构建及验证 s | 搜索gzip MB | 100 MB产物目标 | 2 MB搜索目标 |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
    ...cases.map(row => `| ${row.routable_entries} | ${row.static_build.pages} | ${mb(row.output.bytes)} | ${mb(row.output.sum_individual_file_gzip_bytes)} | ${round(row.static_build.timings_ms.total / 1000)} | ${mb(row.search.gzip_bytes)} | ${row.budgets.raw_static_package_pass ? '通过' : '未通过'} | ${row.budgets.compressed_search_pass ? '通过' : '未通过'} |`), '',
    '只包含当前快照，历史快照的保留空间需要另计。表中100 MB是原软目标，未达仍保留为未达；后续分层容量门槛见交付与运营文档，不把本表改记为通过。', '',
    '100 MB按未压缩发布目录的实际文件总大小判断，gzip合计只是压缩测量，不能替换发布包大小。fixture有3个项目、3个来源、1个组织、1个研究者、1个专题及N−9个资源；全部英文/中文混合文本都是虚构并有意重复。约三分之二资源关联同一组织，可揭示组织详情的真实关联规模成本，不能外推为所有生产内容的压缩保证。', '',
    '## 产物组成', '',
    '以下直接扫描完整10,000条产物。内嵌数据包含完整script标签；SVG与内嵌数据互不重叠；其余HTML包含SSR标签、正文、页面壳和metadata。采样详情中的字段级JSON大小另存于JSON报告，不能相加当作压缩节省保证。', '',
    '| 文件组 | 文件数 | 总 MB | 内嵌数据 MB | SVG MB | 其余HTML MB |', '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(cases.at(-1)!.output.composition.groups).map(([name, row]) => `| ${name} | ${row.files} | ${mb(row.bytes)} | ${mb(row.embedded_data_script_bytes)} | ${mb(row.inline_svg_bytes)} | ${mb(row.other_html_bytes)} |`), '',
    '## 浏览器实际结果', '',
    '| 目录条目 | 首次搜索全部请求gzip等价 bytes | 2 MB完整首次搜索门槛 |', '| ---: | ---: | --- |',
    ...cases.map(row => `| ${row.routable_entries} | ${Math.max(...row.browser.devices.flatMap(device => device.pages.filter(page => page.name === 'explore').map(page => page.gzip_equivalent_all_request_bytes!)))} | ${row.budgets.complete_first_search_gzip_pass ? '通过' : '未通过'} |`), '',
    '完整首次搜索按照浏览器实际观察到的请求集合，逐个读取HTML、JS、CSS、共享catalog和搜索index再gzip level 6相加。不会把外置catalog当成零下载；本地服务器实际没有HTTP压缩，因此这是可核对的压缩等价值，不是部署传输实测。', '',
    '| 目录条目 | 环境 | 页面 | FCP ms | load ms | 文档 MB | 观察到的最高JS heap MB | DOM元素 | 横向溢出 |',
    '| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...cases.flatMap(row => row.browser.devices.flatMap(device => device.pages.map(page => `| ${row.routable_entries} | ${device.device} | ${page.name} | ${page.first_contentful_paint_ms === null ? '不可用' : round(page.first_contentful_paint_ms)} | ${round(page.load_event_ms)} | ${mb(page.document_encoded_body_bytes)} | ${mb(page.js_heap_samples.max_observed_bytes)} | ${page.document_elements} | ${page.horizontal_overflow ? '有' : '无'} |`))), '',
    '每页只测一次冷导航，不能据此声称稳定p95。FCP与load来自浏览器Navigation/Paint Timing；JSON中observed_ready包含500 ms的networkidle观察窗口以及交互检查，不能称为hydration耗时。25 ms目标间隔CDP采样得到的是**观察到的最高JS heap**，可能漏掉短峰值，也不是浏览器总进程RSS或GPU内存。mobile是同一桌面CPU上的Pixel 7视口/触控仿真，不是实体手机。', '',
    '| 目录条目 | 环境 | UI查询样本 | p50 ms | p95 ms |', '| ---: | --- | ---: | ---: | ---: |',
    ...cases.flatMap(row => row.browser.devices.map(device => `| ${row.routable_entries} | ${device.device} | ${device.queries?.samples} | ${device.queries?.p50_ms} | ${device.queries?.p95_ms} |`)), '',
    '每个环境先预热6次，再测18次真实输入查询，包含中英文、精确编号、无结果；逐次核对结果数并等两个动画帧。计时包含Playwright传输、输入和React渲染，不是纯MiniSearch算法时间。本站本地预览HTTP没有gzip；JSON的transfer字段是实际本地传输，部署压缩和真实网络延迟仍需发布环境验证。', '',
    '## 复现与限制', '',
    '```sh', 'PW_CHANNEL=chrome npx --no-install tsx scripts/full-site-benchmark.ts', '```', '',
    '未测真实手机、慢网络、浏览器总内存峰值、独立hydration CPU、真实生产内容多样性和GitHub抓取规模。原始设计HTML未运行，未声称完成A22精确视觉对照。所有结论来自完整实际构建或浏览器观察，没有容量外推。', '',
  ].join('\n');
  await writeFile('docs/verification/full-site-benchmark.md', markdown);
  await rm('docs/verification/full-site-benchmark.partial.json', { force: true });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
