# 私有维护交接与子路径候选验收

日期：2026-09-12。当前保持私有、Pages 关闭。本文补充[先前集成验收](private-integration.md)，记录后续改动及真实失败修复，不把私有技术验收写成公开交付。机器记录见 [private-handoff.json](private-handoff.json)，完整公开文件候选清单见 [private-subpath-files.json](private-subpath-files.json)。

## 改动与对应提交

- [PR #2](https://github.com/imjszhang/aipoch-network/pull/2)：运行尝试级状态恢复、精确事件提交、私有子路径候选、浏览器依赖完整声明、新增来源维护交接，以及位于 `docs/deployment/` 的未启用发布材料。实现 `61f7067b31edb7a2226b701bf4b673dccf67c502`，集成 main `f636d57e9bd78f9f9d4ef12f268e9a2a0c96a99b`。
- [PR #3](https://github.com/imjszhang/aipoch-network/pull/3)：现有旧站点保留测试显式覆盖根路径和子路径，避免继承环境后样本与验证路径不一致。测试修复 `1c16840ea158e3edfa77f2692c7917a0247decb8`，最终被核验 main `6e13ce09ddab7152454cfc77ffc58161609cf51e`。生产构建逻辑未因该测试修复变化。

两个 PR 的 push/PR CI 及两个合入 main CI 共六条均成功；逐条运行 ID、确切 SHA 和日志摘要在机器记录中。最新 [main CI](https://github.com/imjszhang/aipoch-network/actions/runs/34692675521) 完成类型检查、201 项离线测试及根路径 40 项、子路径 40 项浏览器测试，日志无失败、跳过、flaky 或重试标记。离线 CI 的 `SITE_BASE=/`；本地另以 `SITE_BASE=/aipoch-network/` 跑完全部 201 项，最终真实刷新也在该子路径环境跑完同一套测试。

## 真实刷新与失败保留

第一次[子路径刷新](https://github.com/imjszhang/aipoch-network/actions/runs/34692410749)成功恢复状态、检查 20 来源并构建 93 页，但后续测试为 200 通过、1 失败。缺失文件测试创建根路径样本，却继承子路径环境，因而提前触发路径不一致。该运行只上传 `trusted-source-suppressions-34692410749-1`，没有网站候选或新的正向观察 artifact。

修复后重新触发的[完整刷新](https://github.com/imjszhang/aipoch-network/actions/runs/34692686489)于 12:05:37 UTC 成功结束。日志确认 checkout 使用上述确切 main SHA，并分别恢复：

| 数据 | 实际恢复来源 |
| --- | --- |
| 负面状态台账 | 失败 run `34692410749`，attempt 1 |
| 已接受公开观察 | 成功 run `34690368996`，attempt 1 |
| 已校验目录历史 | 成功 run `34690368996`，attempt 1 |

随后 20 checked、0 retained、0 withheld，201 项测试全部通过。候选观察时间为 `2026-09-12T12:05:07.870Z`，snapshot 为 `bc96aa6bab0aa21b899841b3`。含 20 sources、19 actors、18 organizations、20 projects、21 resources、2 collections、1 relation；没有虚构 claim 或 tombstone。

此次没有人为制造真实来源私有化或撤回；带非空撤回证据的失败持久化，以及旧 run 新 attempt 的边界仍由合成回归覆盖。这次真实运行证明失败任务的独立负面 artifact 可被后继成功任务读取，不能扩大称为真实撤回演练。

## 下载与内容验证

| 项目 | 实测结果 |
| --- | --- |
| 网站 artifact | `10298021154` / `catalog-candidate-34692686489-1` |
| GitHub 元数据及独立下载 ZIP SHA256 | 均为 `c68e5272ebc6f9215fb95a1ec46cf331e8361e5d75b147d1fdfec95fd45b69a9` |
| ZIP / 解压大小 | 519,129 / 2,637,535 字节 |
| 完整规范文件树 SHA256 | `b9407c1b3f7c4b3aa158ed13692e6eb284a393c0891c9b1d6d84867bd24fe2db` |
| 静态包 | 93 页、133 文件，基路径 `/aipoch-network/` |
| 固定历史 | 当前及此前两个快照均可读；此前 20 文件、277,044 字节与已提交审阅清单逐字节一致 |
| 第三方声明 | 124,859 字节，SHA256 `e4e52e4fa4db6008a321ff045c840bccb3326fd3a1d4c9fd29a1089cd2285576` |

先独立下载并审阅完整文件树，再由只读工具重新下载同一 artifact。工具通过确切 main、run/attempt、完整刷新运行清单、摘要、路径、页面、当前与固定 manifest、全部分片、浏览器目录、搜索、历史撤回及声明时效验证；完成后再次确认 main 未变化、仓库私有、Pages 关闭。两份下载的全部路径及内容一致。此过程没有执行候选代码、调用 Pages 配置或部署接口。

验证时间 `2026-09-12T12:08:17.872Z`，当次内容最早时效上限 `2026-09-12T13:05:07.870Z`。这是一份当时的验收记录；后续 main 改变或时效到期，都需重新生成和审阅候选，不能用本记录长期授权发布。

纯 Node 独立消费者通过本地 HTTP 读取当前及三个固定 manifest，校验声明分片，并定位 SciPy 教程的固定 commit `0b94e98b820b255de843dba3c411fc4dd2604206` 和 `doc/source/tutorial/index.rst`。首页、目录、资源分类、组织与声明文件返回 200，缺失地址返回真实 404。预览仅在本机提供下载的静态包，不依赖 Open-Science。

## 保留的边界

37 个实施任务、23 个验收场景继续完整保留。registry、pilot、锁文件和 v6 原件摘要与先前验收相同。前端设计基线仍为最初 v6 HTML；新版 HTML 的归档及范围替代流程保持不变。

公开布局、原创内容许可、原始设计分发范围、公开状态持久保存和外部投稿尚待选择与实际验收。原始 HTML 未执行，同视口原件对照未完成；GitHub 表单实际页面检查仍需用户解锁 Mac。A23 在真正收到新版 HTML 时执行，不虚构升级案例。Pages 模板只作为审阅材料存在；仓库可见性、Pages、环境规则和定时刷新均未改变。上述条件不因技术验收通过而消失。
