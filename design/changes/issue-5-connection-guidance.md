# Issue #5：连接引导与原对象接续的局部设计修订

记录日期：2026-09-14。关联 [Issue #5](https://github.com/imjszhang/aipoch-network/issues/5)。原设计基线为 [v9-r2 HTML](../references/aipoch-network-concept-v9-r2.html) 与 [MD 修订 1](../references/aipoch-network-concept-v9-r2.md)。用户已明确要求“实现这个计划并验收”；本记录把该计划固定为可审查的实施范围，不表示设计团队已经正式签认，也不把实现、验收和发布合并为一个状态。

| 状态轴 | 当前记录 |
| --- | --- |
| 用户实施授权 | 已取得：实施本次局部修订及验收 |
| 设计团队正式对齐 | 待记录；本提案和后续对照材料供其审阅，没有代替设计团队签认 |
| 代码 | 本地提交 `e1d530ac4fcacabacbb714f936b49a5ac9ffaf90`；起点 `72419cdf51d56edd9d182b812218ef5aad7af2aa`，保留 main 新增的 MuData／中文指南后以 `f52a50c` 为最终基线 |
| 自动化、视觉验收 | 类型检查、295 项离线、334 项相关浏览器检查通过；56 项模式跳过，0 失败／flaky；50 张合成截图与 35 个状态测量已取得，关键原稿／实现截图已阅读 |
| 真实验收与角色 | 本轮授权范围内完成：H01 为用户按网页提示亲自完成的明确反馈；H02–H04 经授权的产品 UI 辅助、用户亲自批准后通过，不冒称独立用户或原生 Chrome 验收。环境、恢复过程与观察边界见验收记录 |
| PR、生产发布 | 本地 PR 文案已准备，未提交远端；未部署，未关闭 Issue |

实际执行证据与状态更新统一进入 [Issue #5 验收记录](../../docs/verification/issue-5/README.md)。设计团队维护正式对齐结论；实施方维护本页与源码映射；验收方记录实际观察；发布方单独记录产物和线上结果。

## 1. 原意、现状与问题分别记录

v9-r2 MD 第 3.1 节要求唯一 Open-Science 入口和精简连接浮窗：简短状态与 Connect/Get 或 Your research home/Disconnect，保留对象时加一行名称和 Continue。R06 要求连接后恢复同一对象审阅、显式确认及发送；R07 区分 Connected、Received 和执行。原型只演示连接，未规定真实本机确认入口。

Issue 的 2026-09-14 实测发生在生产网站、macOS Chrome、Connector `0.1.0-alpha.3`、正式 Open-Science `0.29.0`。网站有连接码和等待说明，但没有普通用户能够照做的打开步骤；测试人员通过 owner CLI 补上确认页后，用户亲自批准，网页显示 Connected 并自动跳入 AnnData 审阅。这次没有发送新引用。该证据证明原配对可工作，也暴露引导和阶段混淆；它不证明所有浏览器都会遇到同样问题。

起点源码中的连接成功回调自动切换到所选对象审阅，连接面板的 Continue 在断开时也可打开审阅。本次有意改变这些行为；不把它们误记成原稿要求用户无条件接受的细节。

## 2. 已核实的 Connector 能力与选定路径

只读核实使用公开 Connector 文档，固定于提交 `74c066904326d2d5a21e5c9d949d31e20238c20c`（2026-09-14），并核对本机已安装 CLI 的公开 `--help`。未读取私有配置、ticket、token，没有替用户批准。

| 能力 | 证据与采用决定 |
| --- | --- |
| 普通用户可以在 Open-Science 中请求查看待确认连接 | [README 的连接步骤](https://github.com/imjszhang/aipoch-connector/blob/74c066904326d2d5a21e5c9d949d31e20238c20c/README.md#connect-a-running-workbench)明确使用 `list_connection_requests` 与 `review_connection`，为准确请求打开本机确认页；用户亲自比对并批准。采用这一路径作为页面主引导 |
| 网页没有公开的直接确认 URL 能力 | [协议 1.0](https://github.com/imjszhang/aipoch-connector/blob/74c066904326d2d5a21e5c9d949d31e20238c20c/docs/protocol.md#pairing-and-sessions)的配对响应只有 pairingId、到期时间、比对码与 pollToken；private confirmation ticket 由 owner-only 接口生成。不新增猜测的深链，不向网页暴露 ticket |
| 工具未出现可先建立新会话 | [操作说明](https://github.com/imjszhang/aipoch-connector/blob/74c066904326d2d5a21e5c9d949d31e20238c20c/docs/operations.md#install-configure-and-start)区分注册与工具发现；把新会话与设置帮助写入展开帮助 |
| 命令行存在备用路径 | [配对操作](https://github.com/imjszhang/aipoch-connector/blob/74c066904326d2d5a21e5c9d949d31e20238c20c/docs/operations.md#pairing-without-exposing-credentials)及本机 help 均列出 `pair list`、`pair review ID`。这是命令行用户备用入口；验收人员临时替普通用户运行这些命令不能使验收通过 |
| 平台能力有边界 | [排障与支持证据](https://github.com/imjszhang/aipoch-connector/blob/74c066904326d2d5a21e5c9d949d31e20238c20c/docs/operations.md#troubleshooting-and-support-evidence)：macOS 已实现打开，Linux 使用 xdg-open，Windows 自动打开未实现。当前真实验收先限定 Issue 的 macOS Chrome 环境 |

[alpha.3 安装包](https://github.com/imjszhang/aipoch-connector/releases/tag/v0.1.0-alpha.3)于 2026-09-14 发布。公开文档和安装包存在只能支持方案可行性，不能替代修订页面的真实用户验收。这里已确认普通用户入口，因而不需新增 Connector API；后续若实测该路径不可用，应记录外部依赖并保留 #5 未完成状态，不能降低验收标准。

## 3. 状态、文案与视觉差异

| 场景 | 原实现／原设计表达 | 本次采用的行为与文案方向 |
| --- | --- | --- |
| 未连接 | 状态、Connect/Get、名称和 Continue | 保留 Connect/Get。选择单独置于 “After connecting” 区，说明连接不会发送；未等待时提供明确的 “Read or copy reference” 手工入口 |
| 正在发起 | Connecting | 保留等待和取消。还未取得有效配对时不显示比对码或打开成功 |
| 等待本机确认 | 连接码和一句“在 Connector 核对并批准” | “Confirm on this computer”、比对码、按真实截止时间计算的倒计时、三步操作、可复制请求和展开帮助 |
| 有保留对象且正在等待 | Continue 与连接按钮同时出现 | 下方只显示对象名称及保留说明，等待期间不出现资源推进按钮 |
| 连接成功 | 自动进入保留对象审阅 | 显示 Connected 与 “Your workbench is connected. Connecting does not send a research reference.”；停留当前连接面板，由 “Review reference for AnnData” 明确继续；无对象时可关闭或回研究首页 |
| 过期、取消、失败 | Not confirmed、重试但原因不够可操作 | 按实际原因提示；明确重试／继续浏览，保留同一对象，不自动重试；real 模式在初始请求失败／到期／中断后仍显示设置帮助；旧码和旧请求不得恢复资格 |
| 面板关闭 | 等待和成功后的打开行为不明确 | 明确“Closing this panel keeps waiting. Cancel connection stops waiting on this website.”；成功不重新打开已关闭面板，不抢回焦点 |
| 用户主动继续 | 恢复完整审阅 | 核验当前准确对象和引用；未勾选时 Send reference 不可用；变化或会话失效后重新审阅 |

页面正文继续英文。待确认区域的说明为 “Do not enter this code on this website. Compare it with the code on the local confirmation page.”，三步分别说明切换 Open-Science、发送下方查看请求、在打开的本机页比对当前站点来源和代码后由用户批准。AIPOCH Connector 在首次出现时解释为打开连接确认页的工具，减少名称切换带来的困惑。

可复制请求的结构如下，`[origin]` 取当前网页的准确 origin，`[code]` 取当前有效配对的比对码；不是手写生产凭据：

> In AIPOCH Connector, find the pending Network connection from [origin] with code [code] and open its local confirmation page. I will compare the website and code and approve it myself. Do not approve it for me.

复制按钮为 “Copy request”，成功后 “Request copied”；剪贴板失败时选择可读文本并提示手工复制。请求只包含来源和比对码，不包含私有确认地址、请求凭据或研究引用。展开帮助 “Can’t find the confirmation page?” 说明新会话、Connector 设置入口和过期后的明确重试。

最终实现将该帮助提取为共用内容，等待中及 real 的未确认／中断状态都可打开。初始配对请求被来源策略拒绝时没有连接码，不虚构代码或继续轮询；仍提供设置帮助和公共浏览。unavailable／Demo 不显示需要真实 Connector 的失败帮助，以免误导构建能力。相关失败与到期场景已在最终真实适配器夹具检查。

保留居中紧凑浮窗、既有 520px 最大宽度、黑白黄和细分隔线。等待区域增加必要高度与滚动；比对码使用浅灰背景和黄色细竖线，仍不引入黄色连接成功横条。待接续对象用水平分隔线与独立标题分区，不引入个人库标签页或复杂嵌套卡。窄屏沿用单列布局、内部滚动和可触达关闭按钮。以上是本次明确视觉目标，实际渲染、溢出和对照截图以验收记录为准，源码样式不构成视觉通过证据。

倒计时直接使用实际截止时间；页面恢复可见或返回焦点时重新计算，不通过倒计时完成推断连接成功。计时文本 `aria-live="off"`，避免每秒打断辅助技术；状态变化仍有独立可读提示。原有旁白专项已按用户指示停止，本轮不把没有真实朗读证据的部分写成已验收。

## 4. 对原要求的有意修订与保留

本次只在 v9-r2 的连接快捷面板、等待确认步骤及原对象接续时机补充行为，不升级整套设计为 v10。R06 的“连接后恢复同一对象审阅”解释为**连接后保持同一对象可明确继续审阅**，增加用户可停在成功状态的步骤；不改变对象、不导航离开当前目录、不自动确认或发送。即使用户从已打开的手工审阅发起连接，也先进入连接面板；成功后仍须明确继续，保持所有入口一致。用户在等待时关闭面板则保留关闭状态，成功不重开。

| 原要求 | 本次应证明的结果 | 相关验证 |
| --- | --- | --- |
| R04 | 桌面／手机仍只有一个顶栏 Open-Science；无新全局打开按钮 | V01、V16 |
| R05 | 普通浏览路径可连接，已连接后个人首页切换，断开恢复公共内容 | V01、V02、V10 |
| R06 | 原对象及上下文保留，连接后显式继续、完整准确审阅和显式发送 | V03、V04、V05、V06、V07 |
| R07 | 连接成功、打开确认页、批准、收到引用和执行分开表述 | V02、V07、V09、V18 |
| R08 | 取消／到期／新尝试／会话／对象／目录变化使旧资格失效，迟到响应不推进 | V05–V09、V11、V12 |
| R09 | 未连接隐藏并守卫个人操作，断开保留本机记录、选择和浏览上下文 | V01、V03、V10、V11 |
| R02、R03 | 静态独立、无网页 GitHub 授权、无新增凭据或客户端运行依赖 | V17、V18 |
| R11、R12 | 视觉层级保留；未知、未安装推断、连接和回执不造假 | V14、V15、V16、V18 |
| R01、R10 | URL-only 收录、多对多与目录声明边界不变 | 既有目录检查；本修订不改 registry/spec/pipeline |

## 5. 完整实施顺序和文件职责

| 阶段 | 交付物与工作 | 完成门槛 |
| --- | --- | --- |
| I5-1 能力核实 | 本页第 2 节公开能力和兼容边界 | 有可执行的普通用户路径；若仅 owner CLI 可用则记外部依赖，不宣称完整修复 |
| I5-2 设计记录 | 本页状态对照、英语文案、局部视觉目标和设计索引 | 与用户授权一致，所有重要差异可供设计团队审阅；原件校验不变 |
| I5-3 状态实现 | `web/src/workbench/engine.ts`：连接成功不自动切换审阅／重开面板；原对象与上下文保持；到期、取消、重试及迟到守卫 | 状态测试覆盖主路径、竞争与显式接续；实际截止时间一致 |
| I5-4 页面实现 | `web/src/workbench/index.tsx`、`styles.css`：状态分区、三步引导、复制／失败回退、帮助、倒计时、明确资源动作；检查 Join 和手工引用入口 | 同一规则应用所有连接入口；unavailable 和持续标注 Demo 保持真实 |
| I5-5 适配与边界 | 必要时修改 `adapter.ts`／`real-adapter.ts`，本次能力核实结论是不需增加浏览器接口 | 协议 1.0、端点、token 私有内存和完整引用边界不变；若改变则另补公开兼容说明 |
| I5-6 离线与浏览器验收 | 状态／协议回归，三种模式 × 根与 Pages 子路径，桌面／窄屏、键盘／焦点／200%／减少动效 | [验收账本](../../docs/verification/issue-5/README.md)记录实际命令、结果和范围；不把模拟结果称为真实连接 |
| I5-7 人工与设计交接 | 四个真实场景、修改前后截图、最终源码身份和差异清单 | 本轮完成。原计划以用户按页面独立完成为可用性证据；后续用户明确授权 H02–H04 产品 UI 辅助，已按角色分别完成记录，批准始终由用户亲自完成；设计团队正式结论另记 |
| I5-8 可审查交付 | 整理 PR 材料和风险；发布时另记明确授权、候选和线上复核 | 本地 PR 材料已完成；远端 PR、发布和 Issue 关闭尚未执行，分别记账，不作为本地剩余任务 |

使用锁定 Node `24.18.1` 与现有 lockfile，不引入新的客户端包或生产后端。执行 `npm run typecheck`、`npm test`、三种模式构建，以及对应静态产物的浏览器检查；覆盖根路径与 `/aipoch-network/`。命令与环境的实际执行记录集中在验收页，计划中的命令不等于已运行。

## 6. 设计团队交接与发布边界

设计团队对照本页第 3 节，查看验收页的同视口状态截图与实现链接；正式确认时补充人员／角色、日期、意见及待改项。若后续调整文案或布局，修改本页的当前方案并保留变更摘要，不让 PR 讨论成为唯一设计依据。

原始 HTML、MD、两份 manifest 及第三方声明均保持原样；2026-09-14 再次计算五份 SHA-256，与 [原件登记](../README.md#当前目标与已核验原件)及 [接收记录](../../docs/verification/v9-r2/reference-intake.json)全部一致。实施、截图和发布分别关联各自提交／产物，不改写原件摘要或历史 R/V 测试结果。

本轮不扩展公开目录、本机个人库、引用接收协议、身份授权、项目关联、文件获取或研究执行。真实验收不需要发送引用；发送守卫由隔离测试核验，真实发送须另有明确操作授权。没有用户独立完成确认路径的证据时，#5 只能部分完成。

公开仓库只归档使用公开目录和合成连接码／会话的截图；真实验收记录只保留必要的版本、时间、场景和结果。真实码、确认私有 URL／ticket、poll/session/owner token、私人研究内容不进入截图、日志、PR 或公开文件。原始敏感采样不得先提交再删除。

若后续发布需要回退，恢复已核验的上一完整产物，或选择经审查的 unavailable 产物；保留适用公共目录和本机数据，不以停用连接倒退目录事实。生产部署、回退和 Issue 关闭分别记账。
