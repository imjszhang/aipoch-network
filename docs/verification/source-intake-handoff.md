# 新增来源的维护交接验证

日期：2026-09-12。范围：P4-03 的新增来源检查与 P6-05 的维护操作交接。机器记录见 [source-intake-handoff.json](source-intake-handoff.json)。本次没有改变正式目录的 20 个来源，也没有公开发布或提交 Issue。

## 可信代码与实际输入

使用提交 `6b4359d3dde010b74ec0c589f5624582533be76e` 的独立临时归档，运行 Node `v24.18.1` 和 `npm ci`。锁文件 SHA-256 为 `795b33df9a91aec72888a93b583c92a4714cafdb0cff4863e538b5dcb024f02e`。演练没有运行外部投稿代码或被收录仓库的代码；GitHubReader 采集步骤显式清空 `GITHUB_TOKEN`、`GH_TOKEN` 和 `NODE_AUTH_TOKEN`。

先通过 GitHub API 核验 [scikit-hep/uproot5](https://github.com/scikit-hep/uproot5)：`private=false`、数字 ID `262422450`，公开说明为基于 Python 和 NumPy 的 ROOT I/O。该来源不在现有试点中。随后由当前 GitHubReader 实际读取，2026-09-12 11:30:51.822 UTC 观察为 `accessible`，未受抑制；默认分支观察 commit 为 `c979803dd87c7a99c01464ade1cdfbc80441f601`。这只支持公开来源和科研用途候选判断，不表示维护者主动接入或科学验证。

隔离目录包含两份输入：完整的 21 来源提议 registry，以及仅用于采集这一新来源的最小 registry。正式项目的 registry 和 pilot 文件均未修改。原有 20 条观察与其逐条时间保持不变；本次只对新来源进行了 live 刷新，不能称作 21 来源全量刷新。

## 实际结果

| 步骤 | 结果 |
| --- | --- |
| 从原 20 来源固定输入构建完整基线 | 成功；snapshot `26b7d31efa5dd84150f48a9c`，112 文件、2,328,546 字节 |
| 仅给 registry 新增来源，仍使用旧 fixture | registry 校验通过；完整构建退出 1，明确报告 `Refresh batch is incomplete; a missing source is not a withdrawal` |
| 失败后的旧产物 | 逐文件路径、大小和 SHA-256 全部相同，没有用半份新数据替换旧站点 |
| 白名单采集与合并 | 新来源真实刷新 1 checked、0 retained、0 withheld；通过 `refreshState` 合并后，完整提议 registry 的 `validateBatch` 通过 |
| 匹配的 registry + fixture 完整构建 | 成功；snapshot `3dc86c1bffd659f82b14470b`，95 个 HTML、124 文件、2,503,704 字节 |
| 新产物实际对象 | 21 sources、20 actors、19 organizations、20 projects、21 resources、2 collections、1 relation；没有新建 claim |
| 独立 HTTP 消费 | 纯 Node 消费者读取静态 manifest/shards，找到来源 ID `262422450` 和正确 GitHub URL |
| 静态详情 | `/sources/source~github~262422450/` 返回 200，包含正确来源链接 |
| 离线回归 | `npm test`：179 passed、0 failed、0 skipped |

124 文件包含重新检查后保留的历史快照；包大小与不带历史的首次构建不能直接等同。完整构建同时检查静态页面、资源、链接、快照一致性与产物大小。此次数据交接没有改变前端代码，因此没有重复整套浏览器视觉验收。

## 命令与白名单交接

在可信归档中先准备上述提议 registry 和单来源 registry，再执行：

```sh
npm ci
SOURCE_BATCH=fixtures/pilot/snapshots.json SITE_BASE=/ npm run build
REGISTRY_FILE=.cache/intake/new-sources.json GITHUB_TOKEN= GH_TOKEN= NODE_AUTH_TOKEN= npm run catalog:refresh
REGISTRY_FILE=.cache/intake/proposed-registry.json SOURCE_BATCH=fixtures/pilot/snapshots.json SITE_BASE=/ npm run build
```

最后一条在旧 fixture 下故意失败；该失败证明完整性门禁生效。然后从 `.cache/refresh-state.json` 读取白名单状态，用以下合并逻辑生成待审查输入：

```js
const proposed = JSON.parse(await readFile('.cache/intake/proposed-registry.json', 'utf8'));
const previous = JSON.parse(await readFile('fixtures/pilot/snapshots.json', 'utf8'));
const incoming = JSON.parse(await readFile('.cache/refresh-state.json', 'utf8'));
const batch = refreshState({
  as_of: [previous.as_of, incoming.as_of].sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1),
  sources: [...previous.sources, ...incoming.sources],
});
validateBatch(proposed, batch);
await writeFile('.cache/intake/proposed-snapshots.json', JSON.stringify(batch, null, 2) + '\n');
```

此段是演练中新来源集合不重叠时的逻辑；`readFile` / `writeFile` 来自 Node `fs/promises`，`refreshState` / `validateBatch` 来自同一可信提交的 `pipeline/refresh.ts`。不能用它无条件覆盖已有来源身份或处理撤回。重复 URL 会被完整批次校验拒绝；实际维护还须应用现行负面状态和人工撤回规则。旧观察超过时效或来源状态有变化时，按[维护手册](../maintainer-guide.md#新增来源的离线输入交接)重新核验完整范围。

在隔离副本中审查并替换对应 registry/fixture 后，运行：

```sh
SOURCE_BATCH=fixtures/pilot/snapshots.json SITE_BASE=/ npm run build
npm test
```

随后临时 HTTP 服务只提供 `dist/`，独立消费者实际读取 manifest 和全部声明分片，并请求新来源详情；服务随检查结束关闭。正式目录中的 registry 与 pilot 文件最后分别与可信提交的 Git blob 作逐字节比较，结果均未改变。

## 交接结论与边界

新增来源需要一同交接**已审核 registry 与匹配的离线观察输入**。推荐者仍只需提供 URL，采集和 fixture 准备由维护者完成。PR 无需获得采集凭据，也不应为了通过 CI 而忽略缺少观察的来源。

白名单合并结果没有 `readme`、`readme_url`、`etag`、`last_modified`、`authorization` 或 `headers` 键；有限凭据模式检查没有命中。该检查不等于完整许可或秘密审计。证据仅记录公开身份、时间、摘要、命令和检查结果；原始 README、请求头、令牌及缓存没有进入验证文档。

本次仅是私有阶段的实际维护演练，不替代普通外部账号投稿、组织认领、正式收录、公共托管和发布后的撤回验收。再次 live 采集时，观察时间、commit 和候选摘要可能变化，需记录当次实际结果。
