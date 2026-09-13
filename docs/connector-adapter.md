# 真实 Connector 网页适配

状态（2026-09-13）：真实模式产物已正式发布至 `https://aipoch.network/`，部署的 verify、deploy、smoke 及独立 HTTPS GET 检查通过；生产浏览器端到端验收仍待完成。网页适配器、三种显式构建模式、协议夹具及真实本地 HTTP 浏览器连接链路已通过对应验证。默认构建及工作流选择仍为 `unavailable`，本次发布显式选择了 `real`。详见 [Connector alpha 发布记录](deployment/connector-alpha-release.md)。

最新本地记录（2026-09-13）：回执恢复修复通过类型检查、283 项离线测试；根路径、GitHub Pages 子路径各 96 页真实模式构建及各 12 项浏览器协议夹具检查通过。新增用例覆盖 POST 响应丢失后查询原请求、暂时 404、停止等待后拒绝迟到回执，以及持续 16 秒才出现回执、跨过原有 15 秒页面等待期限的流程。两组构建使用独立临时产物及测试端口，不覆盖既有联调服务。此前的 255 项测试及 Pages 定向 9 项记录属于早期实施证据，不与本次结果累加。真实 `4193 → Connector → Open-Science` 联调及正式 Chrome 观察另见下文，不能与夹具结果混为一项证明。

## 边界

Network 保持独立静态目录。适配器不导入 Open-Science 或 aipoch-connector 的源码、SDK、数据库、IPC、凭据或测试服务；默认检查可完全离线执行。公开目录仍使用 `catalog/v1/manifest.json`，没有为连接修改目录 schema。

真实通道位于 `web/src/workbench/real-adapter.ts`。它将当前审阅文本封装为独立版本 `1.0` 的接收请求。`aipoch-network-internal-review-1` 是被传递的审阅文本格式，不是通用目录契约，也不表示将网站内部类型变成完整的 Connector 公共领域模型。

## 连接流程

1. 用户明确点击 Connect Open-Science 后，向 `http://127.0.0.1:47821/v1/pairings` 发起配对。该端点仅指本机，不扫描网络或推断安装状态。
2. 网页显示短校验码及在本地 Connector 核对、批准的说明。网页不能自行批准。授权主体、允许来源及本地批准由 Connector 实现并验证，CORS 不替代认证。
3. 网页使用只可查询配对的 poll token 等待批准；首次网络请求限时 8 秒，人工配对最多 180 秒，可随时停止等待。
4. 批准响应提供协议版本和限时会话。适配器再请求 `/v1/session`，确认同一 session、有效期及 `hostReady: true` 后，才向现有状态机报告 Connected。
5. 会话 token 只保存在适配器私有内存，不进入 React 状态、本机偏好、URL、引用、日志或公开产物。每 5 秒重新确认；失败或超过 15 秒未核验，当前会话失效。完整刷新/新标签重新确认；普通站内导航保持有效会话。
6. Disconnect 立即撤销本页使用资格，并尽力发送会话删除请求。网络失败不会被描述为远端一定撤销；研究项目和已经收到的引用不受网页断开影响。

生产 Connector 仅接受明确允许的 `https://aipoch.network` 来源；开发站来源必须在本地 Connector 显式配置。HTTPS 网页访问回环 HTTP 的浏览器权限、私有网络访问与兼容性应在受支持的实际浏览器验证，不能用路由模拟测试代替这一证据。失败时保留公开浏览、Get Open-Science 和完整手工引用，不新增 Open Open-Science 按钮。

## 接收协议映射

配对请求包含 `protocolVersion: '1.0'` 与独立 `attemptId`。批准返回 `{id, token, expiresAt, protocolVersion}`；所有 `expiresAt`、`receivedAt` 是 Unix 毫秒整数。

发送 `/v1/references` 时使用当前会话 Bearer token；载荷包含 `protocolVersion`、`requestId`、`sessionId`、`objectId`、`action: 'receive_reference'`，以及 `review: {format, content, sha256}`。摘要严格针对用户审阅的 `content` 原始 UTF-8 字节，不解析重排 JSON、不裁剪空白、不缩短 SHA。单次引用原文上限为 256 KiB，完整 JSON 请求编码后上限 260 KiB，响应上限 1 MiB；原文及请求分别按实际 UTF-8 字节计算，JSON 转义膨胀也会触发拒绝。

回执必须匹配协议版本、请求、会话、对象和 `contentSha256`，并且 outcome 为 `received`、时间有效。适配器核验后将原文交回既有状态机，再由状态机核对当前实际审阅内容及会话。Received 表示 Connector 持久接收了引用，不表示已导入 Open-Science 项目、下载、安装、运行或验证研究。需要后续处理时在工作台继续；网页不展示 GitHub 登录、token、scope 或权限修复。

真实模式的一次收件等待总预算为 60 秒，单个网络请求仍最多 8 秒，并按剩余总预算缩短。`POST /v1/references` 最多发送一次；发生传输中断或结果不确定的错误后，适配器通过 `GET /v1/receipts/:requestId` 有期限地查询原会话、原请求的回执。暂时 404 只表示尚未查到；只有严格匹配的回执才能确认成功。已解析但字段不匹配的回执不会通过后续查询被忽略，会话失效也不能继续接收结果。此等待预算仅用于 real 模式，Demo 和 unavailable 原有 15 秒行为保持不变；首次连接 8 秒、人工配对 180 秒保持不变。

总预算耗尽、停止等待、断开或替换对象后，Connector 仍可能已经收到；停止等待不撤回远端操作。网页不自动重发，查询恢复不生成新请求 ID。重新发送需要重新审阅和明确操作；旧会话、取消后及迟到响应不得恢复网页成功状态。本次修复复用既有回执查询协议，不改变目录契约、原始审阅文本或 Connector 安装包。

接收端还负责重新读取并校验当前完整目录，核对审阅对象、来源全集及顺序、角色、版本、路径、摘要、许可证、使用条件与来源状态；不能只确认网页列出的几个来源 ID 存在。候选、撤回或变化的引用不能产生新的成功接收。此校验与 MCP 工具、工作台项目关联均在独立 Connector 实现；Network 的构建、普通测试与发布没有因此引入其模块或宿主进程依赖。当前固定审阅格式与公开目录 v1 的可选字段演进是不同边界。

## 构建、测试与发布

| 选择 | 命令 | 产物及用途 |
| --- | --- | --- |
| 默认 / 回退 | `npm run build` | `dist`，unavailable，不启动通信 |
| 显式真实 | `npm run build:real` | `dist-real`，real，仅用户点击连接后访问本机端点 |
| 独立演示 | `npm run build:demo` | `dist-demo`，demo，持续标明模拟，不访问 Connector |

模式仅由构建进程显式输入决定。`VITE_WORKBENCH_MODE=real` 用于真实模式，`unavailable` / `demo` 同样可显式选择；兼容既有 `VITE_WORKBENCH_DEMO=true`，冲突输入拒绝构建。Vite 环境文件、URL、本机存储不能切换已编译模式。浏览器、预生成页面和 `build-info.json` 必须一致。

`npm run typecheck` 和 `npm test` 包含配对/心跳/精确摘要/错配/取消/模式与发布选择校验；不需要真实客户端。`npm run test:e2e:real` 针对已构建的 `dist-real`，使用浏览器路由协议夹具检查实际网页适配器与原对象审阅、个人首页、断开及刷新。此测试不证明真实 Connector 可达或 Open-Science 已接入。

真实模式的产物声明 `real_connector: true`、`connector_protocol: '1.0'`、固定本机端点，表示包含真实传输代码，不是当前已连接。发布选择必须显式记录 `workbench_mode: 'real'`，否则候选校验仍按 unavailable 拒绝真实产物；Demo 无论如何不能进入 Pages。

`refresh.yml` 与 `deploy-pages.yml` 已加入显式 `workbench_mode` 选择，仅允许 `unavailable`、`real`，默认均保持 `unavailable`。刷新只在候选构建步骤传入 `VITE_WORKBENCH_MODE`，不污染普通离线回归测试。部署将该选择绑定到经过审阅的产物，线上 smoke 再核对 `build-info.json` 的模式与 `real_connector` 声明。本次正式发布已显式选择 `real` 并通过这些检查；这证明所选真实模式静态产物已上线，不能证明生产浏览器已成功访问本机 Connector。

回滚使用经过审阅的 unavailable 完整产物，公共目录及来源不随连接功能回滚而被替换成过期数据。生产启用、实际连接验证和设计视觉验收分别记录，不将 fixture 成功视为客户端或浏览器兼容证明。

## 当前验证证据与范围

此前根路径协议夹具 6 项已通过。本次在最新工作树上重新独立运行，未使用或覆盖实施任务正在使用的 `dist-real` 和 `4193` 服务：

| 检查 | 本次结果 | 范围 |
| --- | --- | --- |
| 根路径 real 构建 | 96 页、119 文件、2,849,535 字节 | `SITE_BASE=/`，独立临时输出 |
| 子路径 real 构建 | 96 页、119 文件、2,874,316 字节 | `SITE_BASE=/aipoch-network/`，独立临时输出 |
| 根路径 real 浏览器夹具 | 6 项通过，2.9 秒 | 4196 端口，桌面与移动视口 Chromium |
| 子路径 real 浏览器夹具 | 6 项通过，2.8 秒 | 4197 端口，同一组行为、真实静态子路径 |
| 工作流语法及模式传递 | 2 个 YAML、16 个 shell 块、3 个内嵌 JavaScript 块通过 | Ruby Psych 解析、`bash -n`、`node --check`，并核对默认模式和构建／部署／smoke 参数传递 |

两次构建使用本仓库既有公开观察数据，目录快照均为 `26b7d31efa5dd84150f48a9c`；没有实时刷新来源。浏览器检查验证原对象保持、完整摘要与回执、连接后首页、断开后个人按钮和本地收藏边界、错误摘要不成功、不自动重发、取消及刷新不恢复会话。移动视口不是实体手机或 Safari 兼容证明。语法检查没有执行远程 GitHub Actions，也不替代正式候选产物验证。

可重复运行本次独立检查的参数为：

```sh
VITE_WORKBENCH_MODE=real SITE_BASE=/ npm run build -- --output /tmp/aipoch-network-review-root-20260913
CI=true TEST_MODE=real TEST_OUTPUT=/tmp/aipoch-network-review-root-20260913 TEST_PORT=4196 TEST_BASE=/ TEST_RESULTS_DIR=/tmp/aipoch-network-e2e-real-root-20260913 TEST_REPORT_DIR=/tmp/aipoch-network-report-real-root-20260913 npm run test:e2e -- real-connector.test.ts

VITE_WORKBENCH_MODE=real SITE_BASE=/aipoch-network/ npm run build -- --output /tmp/aipoch-network-review-subpath-20260913
CI=true TEST_MODE=real TEST_OUTPUT=/tmp/aipoch-network-review-subpath-20260913 TEST_PORT=4197 TEST_BASE=/aipoch-network/ TEST_RESULTS_DIR=/tmp/aipoch-network-e2e-real-subpath-20260913 TEST_REPORT_DIR=/tmp/aipoch-network-report-real-subpath-20260913 npm run test:e2e -- real-connector.test.ts
```

真实本地联调已由实施任务记录：Codex 内置浏览器访问 `http://127.0.0.1:4193`，经过实际 `127.0.0.1:47821` Connector 和重建的 Open-Science `0.28.0` 独立测试 profile 完成配对，首页切换，保持 AnnData 选择，并显示与持久收件箱一致的接收结果：

- 请求 ID：`reference-0421de3e-a411-4b51-9891-430f9561f503`。
- 原始审阅内容 SHA-256：`b9784cd3d9813c049410a34600247f471d33219a41a2f675bdad3ce0e2404eb5`。
- 目录快照：`26b7d31efa5dd84150f48a9c`。
- 后续 Connector 本地测试还核对了实际宿主项目关联、创建项目、指定公开文件获取和宿主重启后的结果；这些属于 Connector 的独立实施证据，不成为 Network 的 CI 前置条件。

上述真实链路是本地 HTTP、指定开发宿主与临时测试数据的验证。配对和动作批准用于合成实施测试，不代表真实研究用户已授权，也不代表 GitHub OAuth 已验证。生产浏览器、其他浏览器、正式安装包和新版本兼容性仍须在各自支持声明前单独记录；路由 fixture 与本地成功结果不证明这些范围。

## 正式发布与待完成验收

2026-09-13，源码 `e3eb65895b1bebe64f3cefcf18996213bf525313` 经 [CI](https://github.com/imjszhang/aipoch-network/actions/runs/34757788508)、[受信刷新](https://github.com/imjszhang/aipoch-network/actions/runs/34757888181) 和 [正式部署](https://github.com/imjszhang/aipoch-network/actions/runs/34758098215) 全部成功。线上当前目录快照为 `26ba825d9cdfbeeabbdb7b98`。独立 Node/curl HTTPS GET 返回 200，正式 `build-info.json` 声明 `real`、协议 `1.0` 和端点 `http://127.0.0.1:47821`，当前 manifest 与本次快照一致。

后续通过 Chrome 原生界面取得真实 HTTPS 证据：用户允许正式站访问本机服务后，网页与 Connector 的来源及配对码一致，本机确认成功，网页显示 Connected、切换个人首页并保留 AnnData；Disconnect 后恢复公开首页，个人区域隐藏。Chrome 的 `chrome://version` 实测版本为 152.0.7977.84（arm64），macOS 26.6.2（25G83）；宿主仍为隔离的 Open-Science 0.28.0 开发构建。

首次正式发送暴露回执等待缺陷：请求 `reference-6b3225a4-5929-4a36-8aa1-0be073f203cf` 已在 Connector 持久接收，原文 SHA-256 为 `8212fb765256cb6f526f2b130421a92dd7e307c23a4b734cdcb3f198053b2de2`，但网页显示 Delivery is unconfirmed，没有误报成功或自动重发。独立新 CatalogClient 冷加载同一生产目录总耗时 32,353 毫秒，9 个 shard、101 条记录且全部 HTTP 200；这是独立计时，不是原请求精确时长。它证实完整校验可能超过原有适配器 8 秒及页面 15 秒等待。上文的原请求只读回执恢复用于修复这一缺陷；修复发布后仍须重新完成真实收件验收。

当前发布状态为真实模式初步上线、完整验收待完成。后续需要在实际加载的正式 HTTPS 页面完成连接、原对象审阅、匹配持久回执及断开状态验证，单独记录浏览器与宿主环境。完整产物摘要、范围和无需改源码的 `unavailable` 回退方法见 [发布记录](deployment/connector-alpha-release.md)；本次未实际回退。
