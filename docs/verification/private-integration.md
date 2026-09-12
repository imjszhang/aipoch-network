# 私有集成验收记录

核验日期：2026-09-12。此次完成私有实现的集成与真实刷新恢复，没有部署公共站点。机器可读记录见 [private-integration.json](private-integration.json)，下载候选的全部文件、字节数与 SHA-256 见 [private-candidate-files.json](private-candidate-files.json)。

## 实现与干净环境检查

实现提交为 `214b7aadf2226be53c2c17c519708916d3095ba7`，通过 [PR #1](https://github.com/imjszhang/aipoch-network/pull/1) 合入私有 main，集成提交为 `12bea89004d8a68ea96858d9abc4f1999084f021`。此次后续文档提交只补充验收证据；以下运行身份始终指向这些实际 SHA。

| 检查 | 实际结果 |
| --- | --- |
| [实现提交 CI](https://github.com/imjszhang/aipoch-network/actions/runs/34689980610) | 成功 |
| [PR CI](https://github.com/imjszhang/aipoch-network/actions/runs/34690003192) | 成功 |
| [集成 main CI](https://github.com/imjszhang/aipoch-network/actions/runs/34690269444) | 成功 |
| Node / 安装 | 干净 Ubuntu 24.04 runner；Node 24.18.1、锁文件安装 |
| 类型与离线行为 | 类型通过，179 项测试通过 |
| 浏览器 | 根路径 40 项、`/aipoch-network/` 子路径 40 项，均通过 |
| 客户端独立性 | 上述 runner 没有 Open-Science 检出、运行服务或本机缓存 |

## 连续两次受信 main 刷新

| 运行 | 首次刷新 | 第二次刷新 |
| --- | --- | --- |
| GitHub 记录 | [34690282213](https://github.com/imjszhang/aipoch-network/actions/runs/34690282213) | [34690368996](https://github.com/imjszhang/aipoch-network/actions/runs/34690368996) |
| 结果 | 成功 | 成功 |
| 来源状态 | 20 checked、0 retained、0 withheld | 20 checked、0 retained、0 withheld |
| 输入恢复 | 无此前成功 artifact；重新读取全部登记来源 | 从首次运行恢复观察数据、负面台账及验证后的目录历史 |
| snapshot_id | `7fbd54bf12fbb0678367843b` | `35dd0c46df11b75e7963601f` |
| 观察批次时间 UTC | 2026-09-12 11:09:32.034 | 2026-09-12 11:11:34.463 |
| 静态 HTML | 93 | 93 |
| 文件 / 实际字节 | 112 / 2,328,546 | 122 / 2,467,214 |
| 历史快照 | 1 available、0 retired | 2 available、0 retired |
| 离线回归 | 179 passed | 179 passed |

第二次运行日志实际记录三条恢复成功信息，均指向第一次 run ID。下载两份候选后再次运行完整静态产物检查，并校验历史分片的 manifest、哈希、字节与语义。第二份候选中，第一份快照的 10 个文件、138,522 字节全部保持不变。

恢复的负面台账在本次真实来源试点中为空。失败运行保留负面状态、当前规则优先于旧恢复输入等行为由现有本地回归覆盖；此次没有故意制造真实来源私有化，也没有把两次成功刷新说成真实失败演练。

## 独立 HTTP 消费与模板

纯 Node 消费者实际读取本地根路径及 `/aipoch-network/` 静态 HTTP：当前入口、固定快照、Scanpy 查询与 SciPy 固定文档资源均通过。另将下载的第二次远端候选作为普通本地静态文件提供，读取当前及保留的历史入口；固定文档 commit 仍为 `0b94e98b820b255de843dba3c411fc4dd2604206`，路径仍为 `doc/source/tutorial/index.rst`。

第二次远端候选包含 20 来源、19 actors、18 organizations、20 项目、21 资源、2 collections、1 relation、0 claims、0 tombstones。公开观察与社区策展未被改写为组织认领或科学验证。

GitHub Contents API 只读核对 main 中 `source-proposal.yml`、`correction-or-withdrawal.yml`、`claim-or-curation.yml` 与 `config.yml`，Git blob 与本地完全一致。这个检查证明模板文件已进入 main；没有操作 GitHub 表单或提交 Issue，不替代普通外部账号的投稿验收。

## 候选审查与剩余范围

下载候选基路径为 `/`，122 个文件总计 2,467,214 字节。逐文件清单摘要为 `6ad3062367cec1e14857b369ff4aa8174697ccff7b194e6aea22f3ad005715b2`。Pages 子路径能力另有确切代码 CI 与本地 HTTP 证据；尚不存在已部署的 Pages 包或公共网址。

有限模式扫描覆盖实现提交的 5 个可达提交、167 个历史 blob，以及本地输出。GitHub 令牌、私钥和 AWS key ID 模式未命中；凭据 URL 模式来自负向测试，本机路径只在历史规划文档中。原始 v6 HTML 的大小与 SHA-256 未变，未进入网站包，但仍存在于 Git 历史。此扫描不覆盖所有协作记录，也不能证明全部内容许可或排除所有形式的秘密。

最新仓库查询仍为 `private=true`、`has_pages=false`；没有新公共仓库、定时刷新或公开预览。Actions 资料保留 7 天，不是永久备份。原始 HTML 的同视口运行对照（A22）、未来真实新版 HTML 升级（A23）与公共发布/外部投稿保持各自实际状态，见 [实施记录](../implementation-status.md) 和 [公开决策材料](../publication-decision.md)。
