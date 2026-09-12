import React from 'react';
import { renderToString } from 'react-dom/server';
import MiniSearch from 'minisearch';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem, platform, arch, release } from 'node:os';
import { gzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSearchIndex, searchOptions, type SearchDocument } from '../web/src/search.js';
import { App } from '../web/src/App.js';
import { pageDataForRoute, type SiteData } from '../web/src/model.js';
import { emptyCatalog, type FieldProvenance, type SourceRepository } from '../spec/types.js';
import { assertValidCatalog } from '../spec/validate.js';
import { stableJson } from '../pipeline/build.js';

const SIZES = [100, 1000, 10_000];
const DOWNLOAD_BUDGET_BYTES = 2_000_000;
const QUERY_ROUNDS = 15;
const WARMUP_ROUNDS = 2;
const FIXTURE_DATE = '2026-09-12T00:00:00.000Z';
const QUERIES = [
  'cohort', 'SURVIVAL analy', '队列风险', '敏感性分析', 'model validation',
  'clinical reproduc', 'DNA 治疗', '材料稳定性', 'genomics benchmark',
  'workflow 00500', 'method report', 'absent-token-xqz',
];
const round = (value: number): number => Number(value.toFixed(3));
function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) => round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!);
  return { samples: values.length, p50_ms: percentile(0.5), p95_ms: percentile(0.95), min_ms: round(sorted[0]!), max_ms: round(sorted.at(-1)!) };
}
function memory() {
  const { rss, heapUsed, heapTotal, external, arrayBuffers } = process.memoryUsage();
  return { rss_bytes: rss, heap_used_bytes: heapUsed, heap_total_bytes: heapTotal, external_bytes: external, array_buffers_bytes: arrayBuffers };
}
function elapsed<T>(operation: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = operation();
  return { value, ms: round(performance.now() - started) };
}

/** Deterministic synthetic corpus: no real repository reads or scientific claims. */
function documents(count: number): SearchDocument[] {
  const areas = [
    ['cohort risk analysis', '临床队列风险分析', 'Clinical research', 'cohort sensitivity reproducibility'],
    ['survival analysis workflow', '生存分析研究流程', 'Biostatistics', 'survival analysis method report'],
    ['DNA treatment response', '基因治疗反应研究', 'Bioinformatics', 'DNA genomics benchmark'],
    ['materials stability map', '材料稳定性证据图谱', 'Materials science', 'materials model validation'],
    ['evidence synthesis method', '证据整合研究方法', 'Evidence synthesis', 'evidence screening citation'],
    ['clinical reproducibility toolkit', '临床研究复现工具', 'Research infrastructure', 'clinical reproducibility workflow'],
  ];
  return Array.from({ length: count }, (_, i) => {
    const area = areas[i % areas.length]!;
    const number = String(i).padStart(5, '0');
    const language = i % 3;
    const title = language === 0 ? `Synthetic ${area[0]} ${number}` : language === 1 ? `合成${area[1]} ${number}` : `Synthetic ${area[0]} / 合成${area[1]} ${number}`;
    const english = `Synthetic benchmark document ${number}. ${area[3]}. Inputs, methods, outputs and source attribution for simulated research series ${i % 31}. Group ${i % 17}, version ${i % 13}. This text is not a research finding.`;
    const chinese = `合成测试记录${number}。研究方法、敏感性分析、数据来源与复现条件。临床队列风险、材料稳定性与治疗反应仅为搜索词样例，编号组${i % 31}，不代表科研结论。`;
    return { id: `${i % 2 ? 'resource' : 'project'}:synthetic-${number}`, title,
      text: language === 0 ? english : language === 1 ? chinese : `${english} ${chinese}`,
      kind: i % 2 ? 'resource' : 'project', domains: [area[2]!] };
  });
}

function syntheticDetailData(unrelatedCount: number): SiteData {
  const catalog = emptyCatalog();
  const evidence = (source: SourceRepository): FieldProvenance => ({ title: [{ role: 'editor', source_id: source.id, url: source.canonical_url, observed_at: FIXTURE_DATE, review: 'reviewed' }],
    description: [{ role: 'editor', source_id: source.id, url: source.canonical_url, observed_at: FIXTURE_DATE, review: 'reviewed' }] });
  function source(id: number, suffix: string, ownerId: number): SourceRepository {
    const url = `https://github.com/benchmark-${suffix}/synthetic-source`;
    return { kind: 'source_repository', id: `source:github:${id}`, provider: 'github', provider_id: id,
      title: `Synthetic source ${suffix}`, description: `Source fixture ${suffix}; no remote repository was contacted.`, status: 'listed', updated_at: FIXTURE_DATE,
      canonical_url: url, owner_id: `actor:github:${ownerId}`, default_branch: 'main', availability: 'accessible', archived: false,
      observed_at: FIXTURE_DATE, stale: false, license: { status: 'unknown' }, aliases: [], latest_commit: 'a'.repeat(40),
      provenance: { title: [{ role: 'github', url, observed_at: FIXTURE_DATE, review: 'reviewed' }], description: [{ role: 'github', url, observed_at: FIXTURE_DATE, review: 'reviewed' }] } };
  }
  const targetSource = source(1, 'target', 10);
  const unrelatedSource = source(2, 'unrelated', 20);
  catalog.sources.push(targetSource, unrelatedSource);
  for (const [id, suffix] of [[10, 'target'], [20, 'unrelated']] as const) {
    catalog.actors.push({ kind: 'actor', id: `actor:github:${id}`, provider: 'github', provider_id: id, account_type: 'user', login: `benchmark-${suffix}`,
      title: `Synthetic researcher ${suffix}`, status: 'listed', updated_at: FIXTURE_DATE, canonical_url: `https://github.com/benchmark-${suffix}`, aliases: [],
      provenance: { title: [{ role: 'github', url: `https://github.com/benchmark-${suffix}`, observed_at: FIXTURE_DATE, review: 'reviewed' }] } });
  }
  catalog.projects.push({ kind: 'project', id: 'project:target', title: 'Synthetic fixed-size research detail', description: 'A synthetic target project with one source and one related resource.',
    status: 'listed', updated_at: FIXTURE_DATE, domains: ['Clinical research'], source_refs: [{ source_id: targetSource.id, role: 'primary', commit: 'a'.repeat(40), url: targetSource.canonical_url }],
    resource_ids: ['resource:target'], provenance: evidence(targetSource) });
  catalog.resources.push({ kind: 'resource', id: 'resource:target', title: 'Synthetic related workflow', description: 'Fixed related context retained on the target detail page.', status: 'listed', updated_at: FIXTURE_DATE,
    resource_type: 'workflow', domains: ['Clinical research'], source_refs: [{ source_id: targetSource.id, role: 'primary', url: targetSource.canonical_url }], project_ids: ['project:target'],
    license: { status: 'unknown' }, runtime: { status: 'not_described' }, provenance: evidence(targetSource) });
  for (let i = 0; i < unrelatedCount; i++) {
    catalog.resources.push({ kind: 'resource', id: `resource:unrelated-${i}`, title: `Synthetic unrelated resource ${i}`, description: `Unrelated synthetic English / 中文研究条目 ${i}.`,
      status: 'listed', updated_at: FIXTURE_DATE, resource_type: 'method', domains: ['Synthetic benchmark'], source_refs: [{ source_id: unrelatedSource.id, role: 'primary', url: unrelatedSource.canonical_url }],
      project_ids: [], license: { status: 'unknown' }, runtime: { status: 'not_described' }, provenance: evidence(unrelatedSource) });
  }
  return { snapshot_id: 'synthetic-benchmark-snapshot', generated_at: FIXTURE_DATE, catalog };
}

function measureCase(count: number) {
  const beforeDocuments = memory();
  const corpus = documents(count);
  const beforeIndex = memory();
  const construction = elapsed(() => makeSearchIndex(corpus));
  const index = construction.value;
  const afterBuild = memory();
  const serialization = elapsed(() => stableJson(index.toJSON()));
  const serialized = serialization.value;
  const afterSerialization = memory();
  // Match the network envelope consumed by Directory, not just the bare index.
  const networkJson = stableJson({ snapshot_id: 'synthetic-benchmark-snapshot', index: JSON.parse(serialized) });
  const compressed = elapsed(() => gzipSync(networkJson, { level: 6 }));
  const loading = elapsed(() => MiniSearch.loadJSON<SearchDocument>(serialized, searchOptions));
  const loaded = loading.value;
  const afterLoad = memory();
  for (let pass = 0; pass < WARMUP_ROUNDS; pass++) for (const query of QUERIES) loaded.search(query);
  const allQueryTimes: number[] = [];
  const byQuery = QUERIES.map(query => ({ query, times: [] as number[], result_count: 0 }));
  for (let pass = 0; pass < QUERY_ROUNDS; pass++) {
    // Rotate the start so each query does not always receive the same position.
    for (let offset = 0; offset < QUERIES.length; offset++) {
      const entry = byQuery[(offset + pass) % QUERIES.length]!;
      const measurement = elapsed(() => loaded.search(entry.query));
      entry.times.push(measurement.ms);
      entry.result_count = measurement.value.length;
      allQueryTimes.push(measurement.ms);
    }
  }
  const afterQueries = memory();

  const detailData = syntheticDetailData(count);
  assertValidCatalog(detailData.catalog);
  const path = '/projects/project~target/';
  // One warm-up plus five measured selections/renders, without writing a site.
  renderToString(React.createElement(App, { data: pageDataForRoute(detailData, path), path, base: '/' }));
  const selectionTimes: number[] = [], renderTimes: number[] = [];
  let pageData = pageDataForRoute(detailData, path), markup = '';
  for (let i = 0; i < 5; i++) {
    const selection = elapsed(() => pageDataForRoute(detailData, path));
    pageData = selection.value;
    selectionTimes.push(selection.ms);
    const rendered = elapsed(() => renderToString(React.createElement(App, { data: pageData, path, base: '/' })));
    markup = rendered.value;
    renderTimes.push(rendered.ms);
  }
  const pageJson = JSON.stringify(pageData).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const sampleBody = `${markup}<script>window.__AIPOCH__=${pageJson}</script>`;
  return {
    documents: count, corpus_json_bytes: Buffer.byteLength(JSON.stringify(corpus)),
    languages: { english_only: Math.ceil(count / 3), chinese_only: Math.floor((count + 1) / 3), mixed: Math.floor(count / 3) },
    index: { build_ms: construction.ms, serialize_ms: serialization.ms, load_ms: loading.ms,
      json_bytes: Buffer.byteLength(serialized), network_envelope_bytes: Buffer.byteLength(networkJson),
      network_gzip_bytes: compressed.value.byteLength, gzip_level: 6, gzip_ms: compressed.ms,
      download_budget_bytes: DOWNLOAD_BUDGET_BYTES, within_download_budget: compressed.value.byteLength <= DOWNLOAD_BUDGET_BYTES },
    queries: { ...percentiles(allQueryTimes), warmup_rounds: WARMUP_ROUNDS, measured_rounds: QUERY_ROUNDS,
      by_query: byQuery.map(entry => ({ query: entry.query, result_count: entry.result_count, ...percentiles(entry.times) })) },
    node_memory_samples: { before_documents: beforeDocuments, before_index: beforeIndex, after_build: afterBuild,
      after_serialization: afterSerialization, after_load: afterLoad, after_queries: afterQueries },
    detail_sample: { unrelated_resources_added: count, total_catalog_records: Object.values(detailData.catalog).reduce((sum, rows) => sum + rows.length, 0),
      full_catalog_payload_bytes: Buffer.byteLength(JSON.stringify(detailData)), page_payload_bytes: Buffer.byteLength(pageJson),
      selected_records: Object.fromEntries(Object.entries(pageData.catalog).map(([key, rows]) => [key, rows.length])),
      ssr_markup_bytes: Buffer.byteLength(markup), body_plus_data_gzip_bytes: gzipSync(sampleBody, { level: 6 }).byteLength,
      selection: percentiles(selectionTimes), ssr_render: percentiles(renderTimes) },
  };
}
type CaseResult = ReturnType<typeof measureCase>;

async function main() {
  const caseIndex = process.argv.indexOf('--case');
  if (caseIndex >= 0) {
    const size = Number(process.argv[caseIndex + 1]);
    if (!SIZES.includes(size)) throw new Error('Unsupported benchmark size');
    process.stdout.write(JSON.stringify(measureCase(size)));
    return;
  }
  const startedAt = new Date().toISOString();
  const script = fileURLToPath(import.meta.url);
  const cases: CaseResult[] = [];
  for (const size of SIZES) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', script, '--case', String(size)], { encoding: 'utf8', maxBuffer: 8_000_000, timeout: 180_000 });
    if (result.status !== 0) throw new Error(`Benchmark size ${size} failed: ${result.error?.message ?? result.stderr}`);
    cases.push(JSON.parse(result.stdout) as CaseResult);
    console.log(`Measured ${size} synthetic search documents; gzip ${cases.at(-1)!.index.network_gzip_bytes} bytes; query p95 ${cases.at(-1)!.queries.p95_ms} ms.`);
  }
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { dependencies: Record<string, string> };
  const first = cases[0]!.detail_sample, last = cases.at(-1)!.detail_sample;
  const payloadGrowth = last.page_payload_bytes - first.page_payload_bytes;
  const report = {
    benchmark_version: 1, started_at: startedAt, finished_at: new Date().toISOString(),
    machine: { platform: platform(), architecture: arch(), os_release: release(), cpu_model: cpus()[0]?.model ?? 'unknown', logical_cpus: cpus().length,
      installed_memory_bytes: totalmem(), node: process.version, minisearch: packageJson.dependencies.minisearch, react: packageJson.dependencies.react },
    method: { corpus: 'Deterministic synthetic research metadata; approximately one-third English, Chinese and mixed text. No remote repositories or real scientific findings.',
      process_isolation: 'Each size runs in a fresh Node child process. No forced GC and no exclusive CPU reservation.',
      construction_samples_per_size: 1, query_timing: 'Two warm-up rounds followed by 15 rounds over 12 rotated queries; nearest-rank percentiles include complete returned-result construction.',
      memory: 'Instantaneous process.memoryUsage samples in Node, not browser measurements or peak memory. The original and deserialized indexes coexist after load; GC timing is uncontrolled.',
      compression: 'The same stableJson serializer as pipeline/build.ts, measured with Node gzip level 6. The envelope includes snapshot_id and index. This is not an observed HTTP transfer or a Brotli result.',
      detail: 'One synthetic project and its fixed related resource/source/actor, with 100/1000/10000 unrelated resources added. Five in-memory pageDataForRoute and React SSR samples after one warm-up; no full website generation.' },
    cases,
    budgets: { compressed_search_download: { limit_bytes: DOWNLOAD_BUDGET_BYTES, interpretation: '2 MB decimal, gzip network envelope, synthetic corpus only', all_measured_sizes_pass: cases.every(row => row.index.within_download_budget) },
      detail_payload_growth: { added_unrelated_resources_from: first.unrelated_resources_added, added_unrelated_resources_to: last.unrelated_resources_added,
        payload_growth_bytes: payloadGrowth, ratio: Number((last.page_payload_bytes / first.page_payload_bytes).toFixed(6)),
        tolerance_bytes: 256, within_tolerance: Math.abs(payloadGrowth) <= 256,
        interpretation: 'A small allowance for totals digit growth; checks payload independence from unrelated records, not production capacity.' } },
    measured_scope: ['Synthetic index build/serialization/load/query timings and byte counts', 'Node memory samples', 'One bounded detail subgraph and React SSR per corpus size'],
    estimates: [] as string[],
    unverified_scope: ['Complete 10,000-entry website size and build duration', 'Browser peak memory, first contentful paint, hydration, and query latency', 'HTTP transfer compression and network latency', 'Production corpus with longer, less repetitive descriptions or more connected detail graphs', 'Listing pages, which may load or render larger portions of the catalog'],
  };
  await mkdir('docs/verification', { recursive: true });
  await writeFile('docs/verification/search-benchmark.json', JSON.stringify(report, null, 2) + '\n');
  const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);
  const markdown = [
    '# 搜索与单详情性能测量', '',
    `测量时间：${report.started_at} 至 ${report.finished_at}。由 \`scripts/benchmark.ts\` 实际运行生成；完整原始数据见 [search-benchmark.json](search-benchmark.json)。`, '',
    `机器：${report.machine.cpu_model}，${report.machine.architecture}，${report.machine.platform} ${report.machine.os_release}，${report.machine.logical_cpus} 个逻辑 CPU，内存 ${mib(report.machine.installed_memory_bytes)} MiB。Node ${report.machine.node}；MiniSearch ${report.machine.minisearch}；React ${report.machine.react}。`, '',
    '## 样本与方法', '',
    '100、1,000、10,000 条确定性合成资料，英文、中文和混合文本各约三分之一。所有名称、编号和来源地址都是测试数据，没有联系额外科研项目。句式和领域词有意重复，因此压缩率不能外推为真实生产目录的保证。', '',
    '每个规模在新的 Node 子进程测量。构建、序列化、加载各测一次；12 个查询预热两轮，随后轮换顺序测15轮，共180个查询样本，使用 nearest-rank p50/p95。计时包含生成完整搜索结果。未强制垃圾回收，也未独占机器。', '',
    '## 搜索实际结果', '',
    '| 条目 | 构建 ms | 序列化 ms | 加载 ms | 查询 p50 / p95 ms | 索引 JSON bytes | 下载封装 gzip bytes | 2 MB 预算 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...cases.map(row => `| ${row.documents.toLocaleString('en')} | ${row.index.build_ms} | ${row.index.serialize_ms} | ${row.index.load_ms} | ${row.queries.p50_ms} / ${row.queries.p95_ms} | ${row.index.json_bytes.toLocaleString('en')} | ${row.index.network_gzip_bytes.toLocaleString('en')} | ${row.index.within_download_budget ? '通过' : '未通过'} |`), '',
    `下载预算按 [交付与运营](../delivery-operations.md) 的2 MB解释为2,000,000 bytes，使用与流水线相同的 stableJson 序列化、gzip level 6，包含 snapshot_id + index 封装。全部已测规模：**${report.budgets.compressed_search_download.all_measured_sizes_pass ? '通过' : '未通过'}**。这不是实际 HTTP 传输测量；服务器压缩方式和真实网络另行验证。`, '',
    '## Node 内存采样', '',
    '| 条目 | 构建前 RSS MiB | 构建后 RSS MiB | 加载后 RSS MiB | 查询后 RSS MiB | 构建前 heapUsed MiB | 查询后 heapUsed MiB |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...cases.map(row => `| ${row.documents.toLocaleString('en')} | ${mib(row.node_memory_samples.before_index.rss_bytes)} | ${mib(row.node_memory_samples.after_build.rss_bytes)} | ${mib(row.node_memory_samples.after_load.rss_bytes)} | ${mib(row.node_memory_samples.after_queries.rss_bytes)} | ${mib(row.node_memory_samples.before_index.heap_used_bytes)} | ${mib(row.node_memory_samples.after_queries.heap_used_bytes)} |`), '',
    '**这些只是 Node 进程瞬时采样，不是浏览器峰值。** 加载后同时保留原索引、JSON和重新加载的索引；不能把差值理解为浏览器只加载一个索引的成本。GC时机也会影响结果。完整各阶段 external/arrayBuffers 等数据保存在 JSON。', '',
    '## 单详情隔离实际结果', '',
    '目标详情固定为一个合成项目、一个关联资源、一个来源和一个作者；额外增加的资料与该子图无关联。实际调用 pageDataForRoute，再用当前 React App 做内存中的SSR；没有写 generated/ 或 dist/。每个规模预热一次，再测五次。', '',
    '| 新增无关资源 | 全目录 JSON bytes | 单详情数据 bytes | SSR HTML bytes | 选择 p50 / p95 ms | SSR p50 / p95 ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...cases.map(row => `| ${row.documents.toLocaleString('en')} | ${row.detail_sample.full_catalog_payload_bytes.toLocaleString('en')} | ${row.detail_sample.page_payload_bytes.toLocaleString('en')} | ${row.detail_sample.ssr_markup_bytes.toLocaleString('en')} | ${row.detail_sample.selection.p50_ms} / ${row.detail_sample.selection.p95_ms} | ${row.detail_sample.ssr_render.p50_ms} / ${row.detail_sample.ssr_render.p95_ms} |`), '',
    `从100增加至10,000条无关资源，单详情数据增加 ${payloadGrowth} bytes，比值 ${report.budgets.detail_payload_growth.ratio}；允许 totals 数字变化的256 bytes检查：**${report.budgets.detail_payload_growth.within_tolerance ? '通过' : '未通过'}**。此结果只证明这个固定子图没有随着无关资料线性膨胀；本身关联上万条资料的组织或专题不在本样本内。`, '',
    '## 未测范围与复现', '',
    '本报告没有完整10,000条网站的产物大小、构建时长、列表页规模、浏览器峰值内存、首屏、hydration或真实网络指标。这些仍待测，不能用以上Node及单详情结果代替。没有提供容量估算或把样本结果乘以页面数冒充整站实测。', '',
    '```sh', 'npx --no-install tsx scripts/benchmark.ts', '```', '',
    '脚本只写本目录下的两个 benchmark 报告。进程成功表示测量与报告生成完成，预算通过情况以报告字段为准。', '',
  ].join('\n');
  await writeFile('docs/verification/search-benchmark.md', markdown);
  console.log(`Reports written. Synthetic gzip budget: ${report.budgets.compressed_search_download.all_measured_sizes_pass ? 'PASS' : 'FAIL'}; fixed-detail payload independence: ${report.budgets.detail_payload_growth.within_tolerance ? 'PASS' : 'FAIL'}.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Benchmark failed'); process.exitCode = 1; });
