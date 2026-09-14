# Issue #7：长期浏览器授权实施与验收账本

更新：2026-09-14。关联 [Network #7](https://github.com/imjszhang/aipoch-network/issues/7) 与 [Connector #5](https://github.com/imjszhang/aipoch-connector/issues/5)。用户已授权完成两项 issue 并验收；本轮连接批准测试另获授权在用户 Firefox 中辅助操作。修复旧心跳迟到竞争后的最新候选已通过 371 项离线和 470 项浏览器检查。实际 Firefox 155.0.1 的默认记住批准与刷新恢复只验证了此前 B7_fD4JJ bundle，尚未重验最新产物；其余真实浏览器／工作台生命周期验收仍未完成。不能标记两个 issue 完整验收或发布完成。

设计依据为 [v9-r2 原件](../../../design/README.md) 与 [Issue #7 局部设计修订](../../../design/changes/issue-7-persistent-authorization.md)，架构决定为 [ADR-025](../../architecture.md)。Issue #5 引导与明确对象接续保留，历史 [Issue #5 验收账本](../issue-5/README.md) 不改写或重复计数。本页不会把旧版本“刷新必须重配对”的测试当作新恢复功能证据。

## 候选身份与边界

| 项目 | 当前记录 |
| --- | --- |
| Network 起点与实现 | 起点 `c9a45a5`；持久授权和末次心跳修复已本地提交 `70584286ceef14e30e12d2e82d1c2a052351514d`，尚未推送；本次验收证据单独提交 |
| Connector 起点与实现 | 起点 `28c25b9`；持久授权实现已本地提交 `97f090b6a9822deb82f7380dc48a47ea15345eb1`，尚未推送；本次验收证据单独提交 |
| Connector 版本化契约 | Connector 实现提交 `97f090b6a9822deb82f7380dc48a47ea15345eb1` 的 `docs/persistent-authorization.md`；新增可选 persistent authorization 1.0，原浏览器／引用信封 1.0 和 catalog/v1 不变；待推送后公开固定提交链接才可访问 |
| 真实构建 | 三模式 × 根／子路径六份产物已核验，目录快照 `2c239307f62698d0f5496274`；最新 real 根 bundle `index-CEmWR4P3.js`，子路径 `index-Dtwqf4Nw.js`；100 项源码摘要与 794 个产物文件摘要见 validation.json |
| 本机候选运行时 | 已从本地 tarball 安装并通过正式 setup 启用；Connector `0.1.0-alpha.4` 候选 code SHA-256 `0ac1ed8682293b427ba6bb2b9acf892164120f951f9b6d88f9fc512eee1fe907`，Open-Science `0.29.0` 已就绪；未记录机器／安装实例标识 |
| 浏览器持久内容 | IndexedDB 中非导出 P-256 CryptoKey、公钥、授权标识和版本；控制记录为暂停／忘记／修订等非 bearer 数据 |
| 内存内容 | 配对查询凭据、短期会话 token、短暂撤销证明使用资格；不进入 URL、日志、引用和公开证据 |
| 原始设计 | 五份 v9-r2 参考已按 reference-intake.json 逐份核对字节数和 SHA-256，全部未变；最终冻结后仍按同一基准审计 |
| 独立性 | Network 不导入 Connector/Open-Science 源码、类型、数据库或凭据；普通检查使用本仓独立夹具，不要求真实运行客户端 |

## 产品规则与逐项证据

| ID | 要求与判定依据 | 当前证据／状态 |
| --- | --- | --- |
| P01 | 首次本机确认默认记住，取消后只连接本次访问；确认捕获的公钥和准确来源不可替换 | Connector 独立核心／HTTP 确认测试通过；实际 Firefox 默认记住已批准且 Connected，取消记住的真实分支仍待验收 |
| P02 | 刷新、重开、新标签、浏览器正常重启使用相同持久身份，验证新会话后才能 Connected，不再次配对 | 独立身份／适配器和浏览器夹具通过；实际 Firefox 刷新此前 B7_fD4JJ 后自动 Connected 已观察；最新 CEmWR4P3 尚待重验，关闭重开／新标签／浏览器进程重启及其他实际浏览器仍待验收 |
| P03 | Connector 正常重启保持安装身份和授权，旧 bearer 无效，重新证明取得新 bearer | Connector 隔离子进程重启／恢复通过；实际本机 stop→setup 已证明运行时替换及同一授权／公钥绑定保留，网页取得新会话并恢复 UI 仍待验收 |
| P04 | 工作台关闭保留授权；只有有效证明之后的明确未就绪响应才显示已记住等待，恢复就绪可新建会话 | Connector 核心及 Network 适配器／状态用例覆盖；真实 Open-Science 生命周期待验收 |
| P05 | 90 天不活跃精确失效；失败请求、取挑战不续期；错误来源、安装身份、稳定工作台不能继承 | Connector 精确边界、时钟回退、身份变化及失败引用／回执用例通过；Network 对错误码的区分由独立适配器用例检查 |
| P06 | 挑战绑定版本、目的、origin、Connector、授权与截止时间，单次消费；错签名／重放／并发／撤销竞争拒绝 | Connector 独立验证与 Web Crypto P1363 HTTP 互操作通过；Network 在签名前检查所有绑定，不签任意服务端文本 |
| P07 | Disconnect 共同暂停该 origin 的浏览器各标签及重启恢复；明确 Connect 才解除，每页独立验证 | 身份控制、BroadcastChannel／storage 通知、恢复状态和迟到回调用例覆盖；真实多标签 UI 待验收 |
| P08 | Forget 清除本地身份、撤销所有使用同一授权的会话；离线不虚称远端撤销 | Network 先移除持久身份，再以临时内存证明尝试撤销；失败提供 Connector 管理指引；Connector 核心撤销／竞争通过，真实离线与多标签表现待验收 |
| P09 | Connector 有可使用的授权列表、最近使用时间、状态和逐个撤销入口 | 本机页面和 CLI/MCP 实现及独立检查通过；实际页面初始空列表已观察，有记录列表／最近使用／逐个撤销仍待验收 |
| P10 | 旧协议、加密／存储不可用、禁用或损坏持久身份时仍可原配对，不假装记住成功 | Network 独立身份／适配器／状态和最终浏览器回退夹具通过；不从夹具推断私密浏览超出实际生命周期的持久性 |
| P11 | 恢复不改变所选对象或浏览位置，不自动打开审阅、不恢复确认、不发送引用／执行研究 | 状态及浏览器夹具通过；实际 Firefox 批准与刷新均保留 AnnData，须显式 Review，刷新未弹审阅，观察到回执数为 0；最新 bundle 重验及其余真实生命周期仍需保持同一约束 |
| P12 | 保持唯一入口、黑白黄既有面板层级，新增等待／暂停／忘记可达；不同屏幕和焦点正常 | 最终 real 候选 CEmWR4P3 的合成协议画面已核对桌面／360×740 窄屏共 12 组状态，主操作可达且无横向溢出；5 张交接截图及摘要已归档。实际 200% 缩放未做，完整焦点／键盘专项不从这些截图推断 |
| P13 | 默认 unavailable、隔离 Demo、显式 real；根／子路径独立构建、公共目录和原设计不受扩展影响 | 六份 mode/base 构建及浏览器矩阵完成，100 项最新源码摘要匹配、794 个当前产物文件已归档摘要，已更新心跳修复后的候选身份；五份原件摘要未变。新的实际视觉状态不由本条自动通过 |

## 已观察的本地检查

已核验的该轮自动化候选记录见 [validation.json](validation.json)：Network `npm test` **371 项通过，0 失败**；六份 mode/base 浏览器检查合计 **470 项通过、282 项明确跳过、0 失败、0 flaky**。背景浏览器为 **Chromium 153.0.8010.12**，不等同于实际安装的 Chrome。全部构建使用 `fixtures/pilot/snapshots.json` 和目录快照 `2c239307f62698d0f5496274`。已逐项重新核对 100 个源码输入摘要，与记录一致。

| 模式 | base | 通过 | 明确跳过 | 失败／flaky |
| --- | --- | ---: | ---: | --- |
| unavailable | `/` | 80 | 80 | 0／0 |
| unavailable | `/aipoch-network/` | 80 | 80 | 0／0 |
| demo | `/` | 100 | 60 | 0／0 |
| demo | `/aipoch-network/` | 100 | 60 | 0／0 |
| real | `/` | 55 | 1 | 0／0 |
| real | `/aipoch-network/` | 55 | 1 | 0／0 |

跳过项按构建模式或该测试的明确适用范围排除，逐项注释保留在 validation.json，不能当作通过。real 两组覆盖真实传输适配器与持久连接专项；不同模式的测试选择不完全相同，因此此表不能写成每个模式跑过所有检查。浏览器的 IndexedDB/Web Crypto 实际运行，Connector 与批准仍由本仓独立 HTTP 路由夹具模拟，不证明真实工作台已完成同样操作。

该文件同时归档六组逐项结果、报告摘要、100 项源码输入及 794 个产物文件摘要。原运行记录为 `aipoch-persistent-final-nonreal-matrix.json`、`aipoch-persistent-heartbeat-root-report/results.json` 与 `aipoch-persistent-heartbeat-sub-report/results.json`，末次非 real 重建记录为 `aipoch-persistent-final-rebuild-after-heartbeat.json`。非 real 四份产物在最后心跳修复后顺序重建，文件逐字节与其浏览器已测产物一致；最新 real 根／子路径分别加载 `index-CEmWR4P3.js` 与 `index-Dtwqf4Nw.js`。

该轮开发已发现并修复两个竞争条件：只使用 storage 通知时，另一标签明确恢复后当前页仍停在暂停（早期报告桌面和移动各失败一次）；以及恢复新会话的宿主验证期间另一标签暂停后，重复取消导致已知新会话未完成清理（后一轮根路径桌面失败一次）。该轮矩阵已通过对应回归，历史失败的测试名称、统计和报告摘要保留在 validation.json，不计入最终通过数量，也不改写成从未失败。最初并行构建触发输出锁的拒绝属于构建调度，随后顺序构建通过，未被当作源码验证成功。

随后主任务复核又复现了第三个竞争：暂停后恢复了新会话，旧会话的迟到失败心跳仍可能覆盖“已记住”的界面状态。安全子任务已修复；新的离线测试 **371 项全部通过**，新 real 根／子路径各通过 55 项、明确跳过 1 项，0 失败／flaky；非 real 四份再次重建仍逐字节相同。旧 370 项结果及 B7_fD4JJ / DegsCvS0 两份已测产物保留在 validation.json 的 previousVerifiedCandidate 中，未与新结果累加。Firefox 已观察的 B7_fD4JJ 不能证明最新 CEmWR4P3，需要解锁后重验。

Connector 候选完成 **133 项独立测试、类型检查、构建和最终独立打包安装检查**，覆盖实际临时 Connector 子进程跨正常重启、旧 bearer 拒绝、新会话恢复和 CLI 撤销。其独立记录位于 Connector 仓库 `docs/verification/persistent-authorization.md`，不是 Network CI 前置条件。之后本机候选安装和 Firefox 的有限真实观察见下一节；两类证据不混为完整兼容认证。

本次仍核对五份原始设计文件的字节数和 SHA-256，与 intake 记录一致。最新源码、构建和自动化证据的核验不代表剩余真实场景或视觉验收通过。此前 355 项开发过程结果及旧 Issue #5／v9-r2 数量不与本次累加。

最新候选的 [视觉交接](../../../design/changes/issue-7-persistent-authorization.md#最终候选的视觉交接)已归档 5 张代表截图及[图片摘要清单](../../../design/changes/issue-7-evidence/manifest.json)。主任务核对桌面与 360×740 窄屏共 12 组状态：主操作可达、无横向溢出／文本截断／主操作遮挡，并目视复核已记住、暂停和忘记代表图。这些画面使用最终 CEmWR4P3 real 界面和合成协议响应，不能视作真实 Connector 连接或本人批准。未做实际 200% 浏览器缩放，不能用 360px 布局替代；仍保留 P12 对未测部分的边界。

## 真实浏览器与宿主验收

| ID | 场景 | 当前状态 |
| --- | --- | --- |
| H01 | Firefox 首次批准（默认记住）→Connected；刷新、页面关闭重开与新标签免配对 | **部分通过**：Firefox 155.0.1 默认记住批准、刷新此前 B7_fD4JJ 自动 Connected 已观察；最新 CEmWR4P3、页面关闭重开和新标签仍待验收 |
| H02 | Firefox 正常浏览器重启，持久身份保留但短期会话重新核验 | 待验收 |
| H03 | 本机确认取消记住；本访问能连接，刷新后不恢复未批准的长期授权 | 待验收 |
| H04 | 多标签共同暂停；刷新继续暂停；显式 Connect 才允许恢复，审阅确认不复活 | 待验收 |
| H05 | Forget 后各标签失去资格、Connector 列表撤销，后续新连接需配对 | 待验收 |
| H06 | Connector 不可达时 Forget 明确仅本地清除，并可从本机管理撤销原记录 | 待验收 |
| H07 | Connector 正常重启、Open-Science 停止和恢复分别验证；不混淆网络不可达和宿主未就绪 | **部分通过**：本机正式 stop→setup 后运行时已替换、同一条授权及公钥绑定保留、宿主就绪；网页新会话恢复及真实工作台停止／恢复仍待验收 |
| H08 | Connector Remembered browsers 页准确来源／名称／最近使用／状态及逐个撤销 | **部分观察**：初始空列表页面可打开；有授权记录的展示与逐个撤销待验收 |
| H09 | Chrome 与任务内浏览器的实际功能及限制分别记录，不从 Firefox 或 Chromium 夹具推断 | 待验收 |
| H10 | 连续流程保留 AnnData 选择、显式进入引用审阅、Send 不自动启用，全程未发引用 | **部分通过**：已批准与刷新观察保留 AnnData，必须显式 Review，刷新后审阅未弹，回执数为 0；最新 bundle 与余下生命周期的守卫待实际检查 |

实际安装由本地主任务使用本地 tarball 安装及 Connector 正式 `setup` 完成；运行时显示 alpha.4 候选且代码摘要与上表一致，Open-Science 0.29.0 就绪。Firefox 155.0.1 的版本由已安装应用元数据读取。普通用户聊天入口未作为本轮已通过项目：本次通过**正式 local-owner pair review** 打开 Firefox 本机确认页，代理按用户明确授权核对当前本地来源 `http://127.0.0.1:4186`，保留默认 Remember 勾选并批准。网页随后 Connected，AnnData 保持且需显式 Review。刷新后确认加载最终根 bundle，再观察到自动 Connected、AnnData 保持、未自动弹审阅，回执数为 0。此有限真实证据由主任务直接 UI 操作与运行时核验提供，不能称为用户亲自操作或普通工作台聊天路径验收。

另已在实际本机通过 Connector 正式 `stop` → `setup` 完成一次正常重启复验，最终清理后的报告 `aipoch-persistent-real-restart.json` 显示运行时已替换、数据目录保持、工作台就绪、前后各 1 条授权，授权与公钥绑定一致。报告对 fingerprint 字段存在和有效长度作过断言后才比较，未保存其实际值或任何安装／机器标识。该结果仅证明真实服务端持久记录；锁屏状态下尚未观察网页用新会话恢复，不能据此勾选 H07 全项。第一次测量使用了错误 fingerprint 字段，已废弃，没有被计为通过；本条只使用重新断言并再次真实重启得到的最终 JSON，其摘要归档于 validation.json。

后续 UI 验收被 macOS 锁屏中断，已请用户解锁后继续。未尝试绕过锁屏；尚未执行的多标签、浏览器进程重启、真实 Connector 重启后的网页恢复／工作台生命周期、忘记／撤销、实际 Chrome 和任务内浏览器场景保持待验收。已读取安装的 Chrome 152.0.7977.84 版本，但本轮未完成其持久连接真实流程，版本读取本身不是兼容证明。

本轮用户明确授权代理在其 Firefox 中完成连接批准操作。记录应写明“代理按用户明确授权操作批准”或实际本人操作，不能声称每次由用户亲自点击，也不能从被授权测试推广为产品默认允许任何代理自行批准。真实批准只对应当前明确核对的来源／请求／记住选择，不扩大研究发送或执行权限。私有确认 URL、票据、真实 session/poll token、完整私钥和私人研究内容不得进入公开记录。

## 设计与发布交接

- 设计差异材料已建；设计团队正式签认仍待实际评审记录。
- 本地 implementation、真实验收、代码提交、远端 PR、Issue 关闭、公开发布分别记录。
- 当前没有本次候选的公开部署证明。旧版本 real 已发布的事实，不代表此持久授权扩展已启用。
- 最终完成审计必须逐项覆盖 P01–P13 与 H01–H10 的实际适用范围；缺失、间接或仅有规划的证据保持未通过。
