# 独立静态目录消费者

`consumer/` 是可单独复制运行的 Node.js v1 消费样例，只有 Node 内置模块，没有网站、采集器、schema 实现、GitHub SDK 或科研客户端依赖。它只用 HTTP GET 读取入口指定的静态 JSON，不查询上游仓库、不运行科研代码，也不读取环境中的 GitHub 令牌或浏览器身份。

实现包含 `index.mjs` 和 `cli.mjs`，测试使用 Node 自带的测试框架。使用仓库指定的 Node 版本即可；消费者自身不需要安装 npm 包。这里描述的是实际本地消费者接口，不表示已经部署公共站点。

## 命令行

先用项目本地静态预览或已有经授权的静态站点提供目录文件。以下示例假设本地服务的实际端口为 `4173`，项目根路径为 `/aipoch-network/`；替换为实际输出地址，不把示例地址视为已经启动的服务。

```bash
node consumer/cli.mjs http://127.0.0.1:4173/aipoch-network/catalog/v1/manifest.json
node consumer/cli.mjs http://127.0.0.1:4173/aipoch-network/catalog/v1/manifest.json --query genomics
node consumer/cli.mjs http://127.0.0.1:4173/aipoch-network/catalog/v1/manifest.json --resource resource:example
node --test consumer/tests/*.test.mjs
```

`resource:example` 仅为参数格式示例，先使用第一个命令读取实际 ID。默认输出契约版本、快照 ID、生成时间、对象数量和已收录资源摘要；`--query` 对标题、描述和领域作本地 Unicode 规范化后的文本包含查询；`--resource` 输出来源与固定/未固定版本信息。消费者不承诺与网站搜索的分词或排序相同。

错误输出到 stderr 并返回非零退出码。只在完整快照通过校验后输出成功结果，不会边读边输出一半成功数据，也不自动用上次目录掩盖下载或校验失败。

## 程序调用

```javascript
import { loadCatalog } from './consumer/index.mjs';

const catalog = await loadCatalog('http://127.0.0.1:4173/aipoch-network/catalog/v1/manifest.json');
const resources = catalog.listResources('genomics');
const record = catalog.get('resource:example');
const location = catalog.locateResource('resource:example');
console.log(catalog.manifest.snapshot_id, resources, record, location);
```

`collections` 保存已验证的九类对象；组织扩展与对应 Actor 共用 ID，`get()` 返回基础 Actor，组织展示扩展从 `collections.organizations` 获取。`listResources()` 仅返回 `listed` 资源；读取候选、关系、认领和撤回记录时直接使用对应集合。返回字符串仍属于来源数据，调用方展示时需使用安全文本渲染，不能执行嵌入内容。

`locateResource()` 对不存在的 ID 返回 `not_found`；撤回条目返回最小 `withdrawn` 状态；被替代条目返回 `superseded` 和替代 ID，不静默跳转到另一个对象。来源已撤回时不返回旧来源 URL 或固定版本。存在完整 commit，或外部内容 URL 加 SHA-256 的位置为 `fixed`，`basis` 分别标记 `commit` 和 `content_checksum`；只有分支/tag 或当前仓库 URL 时为 `unfixed`。上游当前最新 commit 不会覆盖资源明确引用的历史 commit。

`fixed` 仅表示记录了不可变版本定位，不表示文件仍可下载、依赖已安装、内容可以再分发、运行成功或研究结论有效。本文样例不自动下载源文件；`sha256` 和外部附件链接如存在则原样作为定位资料返回，实际复用时仍需核对内容摘要。

## 下载与一致性校验

入口可以是当前 `catalog/v1/manifest.json`，也可以是仍获准公开的固定快照入口。消费者先读取一次入口，然后只依据该清单加载分片，不依赖目录遍历、文件名排序、固定分片数量或网站内部索引。

相对分片 URL 以包含该引用的 manifest 文件 URL 为基准解析，必须留在该入口目录范围内。支持域名根路径、GitHub Pages 项目子路径和快照目录内入口。拒绝绝对/跨域分片、`..`、双重编码穿越、反斜杠、空路径段、查询参数、URL 凭据以及 HTTP 重定向。入口接受 HTTP(S) 以支持本地静态测试，不从请求自动附带 cookie 或凭据。

消费者在接受目录前核验：

- 九类必需集合存在，分片 URL 不重复，所有已知分片可完整读取。
- 每片字节数、SHA-256、可选记录数与清单一致；版本、快照 ID、集合类型与入口一致。
- 契约主版本为 v1；ID 唯一且稳定身份与来源数字 ID 一致，组织扩展与 Actor 相符。
- 对象、关系、来源、版本、溯源、认领、集合和撤回引用完整且类型匹配。
- 已知安全状态不能含无法理解的新值；活动条目与撤回 ID 不冲突，撤回记录不夹带旧描述或 URL，替代链不成环。
- 来源私有内容不进入活动目录；许可证和运行描述不被未知值升级为有效；组织主动策展必须有独立的组织授权认领记录。

字节摘要校验证明清单与分片一致，不能单独证明发布者身份、证据真实性或科学有效性。客户端仍需选择可信的目录入口；消费者对认领校验的是结构与声明范围，不代表重新核验组织 owner 的现实权限。

默认每个 manifest 最大 1 MiB、单分片 8 MiB、总下载 64 MiB、4,096 个分片、100,000 条记录，每个 HTTP 请求超时 15 秒。所有响应流在读取中受上限约束，不能靠伪造 Content-Length 绕过。程序调用可通过 `limits` 提供经自己评估的正整数限制，也可用 `fetch` 注入 HTTP 测试替身；命令行不接受令牌或认证参数。

```javascript
const catalog = await loadCatalog(manifestUrl, {
  limits: { totalBytes: 32 * 1024 * 1024, records: 10000 },
});
```

## 兼容、缓存和撤回

v1 新增可选字段和新资源分类可以继续读取，未知可选集合不会自动下载；消费者仅对已理解的字段采取行动。撤回记录遵守契约的最小字段白名单，不能借新增字段继续携带被清理资料。改变状态含义或使用未知安全状态时失败，不能将新状态按“已收录”“已授权”或“可运行”猜测。新主版本需要相应消费者更新；同一次加载中分片必须与入口精确匹配契约版本。

消费者不使用浏览器搜索索引，不跟随网站技术栈或 Open-Science 版本升级。其测试夹具独立编写，通过 HTTP mock 证明根路径、子路径、重分片、损坏、不完整、混快照、新增字段和撤回行为。真正的静态服务连通性由项目集成验收另行记录，不能把 mock 测试冒充已部署验证。

本样例不实现持久缓存或失败时回退。调用方可以保留自己上一份已验证快照，但不能因新入口失败就推断旧数据仍获准展示；刷新成功时必须应用新撤回记录，不能把已撤回条目从旧缓存补回。固定快照也可能因撤回不再提供，HTTP 404 不意味着可以绕过当前目录规则重新公开旧内容。

目录快照版本、来源内容版本和契约版本是三件不同的事。使用者应保存所需的来源 ID、commit、路径和可选内容摘要；目录更新不表示研究资源刚发布新版本。完整语义见[目录契约](catalog-contract.md)，处理撤回与恢复见[治理规则](governance.md)。
