# 正式站回执恢复修复 — 2026-09-13

状态：修复已正式部署，Chrome 实际完成配对、原对象审阅、匹配成功回执、断开及收件记录保留验证。本结论限于下述实际环境；后续独立 Connector 的 GitHub App 授权也已通过另行验收，见文末链接。

## 问题与行为

在已获用户允许访问本机服务的 Chrome 152.0.7977.84（arm64，macOS 26.6.2/25G83）中，正式站配对、保留 AnnData、个人首页及断开均已通过真实观察。原始部署的收件请求却在网页端变为 Delivery is unconfirmed；Connector 实际已持久收到。独立公开目录冷加载为 32,353 毫秒，超过原有 8 秒单请求和 15 秒网页等待预算。初次请求证据保留在 [原始发布记录](connector-alpha-release.md)。

修复让真实模式的一次收件等待最多持续 60 秒，单个请求仍最多 8 秒。引用 POST 最多一次；结果不确定时，通过现有协议只读查询原 requestId 的回执，不生成新请求，不自动重发。404 可以继续有限等待；回执身份或内容不匹配、取消、断开、会话失效和等待期限届满，都不能产生成功状态。Demo、unavailable、连接和配对原有时限保持不变。Connector 生产代码及已发布安装包未改动。

## 修复验证

- 源码：`bf4b365f1fff865e60bd76a6d0de20ccf5ec64db`。
- 本地类型检查与 283 项离线测试通过。
- 独立根路径及项目子路径构建各 96 页；对应真实传输浏览器夹具各 12 项通过。新增用例实际等待 16 秒取得原请求回执，覆盖旧页面超时窗口；同时核对 POST 响应丢失、404 过渡、停止等待后拒绝迟到结果和只发一次 POST。
- [GitHub 完整检查](https://github.com/imjszhang/aipoch-network/actions/runs/34761126783)：成功。

夹具不代替实际 Chrome、本机 Connector 和 Open-Science 的正式 HTTPS 复测。

## 独立审阅候选

| 字段 | 实际记录 |
| --- | --- |
| 受信刷新 | [34761136095](https://github.com/imjszhang/aipoch-network/actions/runs/34761136095)，成功 |
| 源码 SHA | `bf4b365f1fff865e60bd76a6d0de20ccf5ec64db` |
| 模式与基路径 | `real` / `/` |
| snapshot | `32da27d09e6f0bff68dcf6d4` |
| 生成时间 | `2026-09-13T13:55:02.266Z` |
| GitHub artifact ID | `10318344936` |
| GitHub 与独立下载 ZIP 的 SHA-256 | `eade13a9c85e4b582e3c59d671d5ebc0fecc359be5bdae29deeeffb363e3c950` |
| 独立完整文件树 SHA-256 | `bc681a791644962d56438532e5591088f5fb14e8fb88b73f6808e80eb7441ffd` |
| 规模 | 96 页、199 文件、3,930,901 字节 |
| 独立验证时间 | `2026-09-13T13:56:59.076Z` |

独立验证检查成功刷新身份、当时的当前 main、完整刷新清单、Pages 地址、ZIP 摘要与安全解包，以及全部静态文件、当前／历史目录、来源撤回策略和模式一致性。随后使用这些准确身份和摘要执行既有验证与发布工作流。

## 正式部署与公开产物

[Pages 部署 34761579849](https://github.com/imjszhang/aipoch-network/actions/runs/34761579849) 的 verify、deploy、smoke 全部成功。独立 HTTPS 读取核对首页、`build-info.json` 的真实模式、当前 manifest、`internal/catalog.json` 及实际脚本，均与所审阅产物相符。

首页与脚本逐字节匹配所审阅文件。实际脚本为 `/assets/index-DCctdyxM.js`，SHA-256 为 `ebfcb607fbcfbb788ca0070a0e278c1cd4ca5361c6a6e4fdcd3e578bc3a99cc5`。首次并行 HTTPS 读取出现连接超时，随后有界顺序读取成功；Chrome 首次普通刷新曾显示完整目录未载入，强制刷新后实际载入完整目录。此记录不推断具体缓存或网络故障原因，也没有绕过浏览器权限。

## 正式复测

环境仍为 Chrome `152.0.7977.84`（arm64）、macOS `26.6.2`（25G83）、真实本机 Connector `0.1.0-alpha.1`／协议 `1.0`，以及隔离重建的 Open-Science `0.28.0` 开发宿主。用户已允许 Chrome 的正式站访问本机服务。新的网页配对通过实际本机确认页核对、批准；本机确认页由默认 Firefox 打开，这不构成 Firefox 对正式站的兼容验收。

本次另外选择并完整审阅 **AnnData research software**（`resource:anndata-library`，Use），不是重发原始不确定的 AnnData 项目请求。审阅保留正式快照、来源 `source:github:100038377`、仓库 `https://github.com/scverse/anndata`、完整 commit `4ded337f96f2b3331c9cfaede4e32cbc3078fcc2`，以及资源与来源的 `BSD-3-Clause` 许可证；未提供的路径、命名 ref 和内容摘要仍显式未知，使用条件为空。来源观察／解析时间为 `2026-09-13T13:54:56.990Z`。

实际 Chrome 中勾选审阅确认并只点击一次 Send 后，页面由等待转为 **Reference received**。返回个人首页显示本次 1 条回执并保留所选资源；打开回执列表可见资源名称、接收时间及与持久记录一致的请求和会话编号。

| 字段 | 实际记录 |
| --- | --- |
| 请求 | `reference-fcbbc1cd-1fe3-4d3a-953c-e6a468c56a23` |
| 接收时会话 | `8ac9efe7-5341-482e-8718-7a20184074df` |
| 对象 | `resource:anndata-library` |
| 原始审阅内容 SHA-256 | `82594b943b854174e57ccc0fd2cc28f36e7066e4b1cc630c0d8920ba0ecd305c` |
| outcome | `received` |
| receivedAt | `1789309284771`，即 `2026-09-13T14:21:24.771Z` |

通过 Connector 的本机所有者接口读取已保存的完整原文，独立重新计算 SHA-256，与持久回执一致，并核对对象、动作、公开地址、快照及完整来源信息。操作触发前的独立时钟读数为 `14:20:54 UTC`，持久接收约在 30 秒后；这不是原始 HTTP 请求的精确计时。本次未保存逐包网络轨迹，不声称抓取了实际 GET 次数；一次发送的 UI 操作、延迟后的匹配成功、已部署实现和对应回归检查分别作为证据。

在同一个成功会话点击 Disconnect，网页显示 **Not connected**；关闭浮窗后恢复 **Science Open to All** 公开首页、Join with Open-Science、搜索及五项计数，个人视图和 Save 操作隐藏。即使地址仍含个人视图查询参数，也不能继续显示连接态。断开后于 `2026-09-13T14:37:52.435Z` 再次读取同一持久回执并独立复算原文摘要，结果仍一致。

至此上述实际环境中的正式 HTTPS 引用接收链路通过。Received 仅表示 Connector 持久接收，不表示研究已导入、安装或执行。原始失败请求继续作为历史保留，没有被自动重发，也没有被改写为已成功恢复。本次不修改 Connector 生产代码或已发布安装包，不新增其他浏览器、正式宿主安装包或 GitHub App 授权的兼容结论。独立 Connector 的完整记录见 [production-browser.md](https://github.com/imjszhang/aipoch-connector/blob/main/docs/verification/production-browser.md)。

## 后续独立 GitHub 授权验收

2026-09-13，用户注册并亲自授权 [AIPOCH Connector GitHub App](https://github.com/apps/aipoch-connector)，权限为仓库 Contents 与 Metadata 只读。Connector 的真实 Device Flow、macOS 钥匙串保存、认证身份及指定公开仓库文件读取随后验证通过，记录于 [github-authorization.md](https://github.com/imjszhang/aipoch-connector/blob/main/docs/verification/github-authorization.md)。这项验证与上述 Chrome 接收引用的部署和证据分别记录，没有改变 Network 的网页或目录协议，也没有替换已发布 Connector 安装包。
