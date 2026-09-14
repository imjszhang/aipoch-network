# Issue #7：长期浏览器授权实施与验收账本

更新：2026-09-14。关联 [Network #7](https://github.com/imjszhang/aipoch-network/issues/7) 与 [Connector #5](https://github.com/imjszhang/aipoch-connector/issues/5)。用户已授权完成两项 issue 并验收，剩余界面改用任务内浏览器；Chrome 本轮不再实测。JDA 候选取得 Firefox 与 IAB 的恢复、暂停、宿主生命周期、管理撤销及在线／离线忘记证据，并暴露“仅本次连接”刷新／重开仍尝试旧失效授权的缺陷。补修候选 DBnSjEyO 已通过 **384 项单测、六组浏览器 470 通过／282 明确跳过／0 失败或 flaky**，且 H03 实际 IAB 回归通过：刷新／重开干净 Not connected，不新增长期授权。原 JDA 失败和新回归分别保留在 [live-acceptance.md](live-acceptance.md)；最终记住／跨标签收尾、已连接键盘与真实 360px 页面也已通过直接检查，交付页保持 Connected／remembered 和 AnnData 显式 Review。200% 缩放保留未覆盖限制，不阻塞本轮功能交付；补修提交与证据推送后的新 HEAD CI 另记，尚未合并或发布。

设计依据为 [v9-r2 原件](../../../design/README.md) 与 [Issue #7 局部设计修订](../../../design/changes/issue-7-persistent-authorization.md)，架构决定为 [ADR-025](../../architecture.md)。Issue #5 引导与明确对象接续保留，历史 [Issue #5 验收账本](../issue-5/README.md) 不改写或重复计数。本页不会把旧版本“刷新必须重配对”的测试当作新恢复功能证据。

## 候选身份与边界

| 项目 | 当前记录 |
| --- | --- |
| Network 起点与实现 | 起点 `c9a45a5`；原持久授权提交 `70584286ceef14e30e12d2e82d1c2a052351514d` 已推送；此前只读存储补修及 CI 接入为 `b29fee4b3b843702b8666c2814500d8b72ae39ce`，连同证据已推送至 `16b5d1ed493e4d01eb8fce121cc4313371116ba4`；随后实际 IAB 暴露仅本次连接缺陷；DBnSjEyO 补修源码／测试已提交 `160cad0b77cd5f18b4a5432b7f9c7ebaf4b5ca80`，独立测试及实际回归通过；推送与证据增量另行记录 |
| Connector 起点与实现 | 起点 `28c25b9`；持久授权实现 `97f090b6a9822deb82f7380dc48a47ea15345eb1` 未变，连同证据已推送至 `46e22ed49b4bfc37cda89150190d8b1fd7ad0327`；后续验收增量单独提交 |
| Connector 版本化契约 | Connector 实现提交 `97f090b6a9822deb82f7380dc48a47ea15345eb1` 的 `docs/persistent-authorization.md`；新增可选 persistent authorization 1.0，原浏览器／引用信封 1.0 和 catalog/v1 不变；[公开固定提交契约](https://github.com/imjszhang/aipoch-connector/blob/97f090b6a9822deb82f7380dc48a47ea15345eb1/docs/persistent-authorization.md)已通过 GitHub API 核对可访问 |
| 已核验的 JDA 构建 | 此前六份 mode/base 产物已核验，目录快照 `2c239307f62698d0f5496274`；根 `index-JDA7-IfB.js`，子路径 `index-DxhIDIDI.js`；当轮 101 项输入与 794 个产物摘要已归档。IAB 缺陷补修后的新六组产物另行核验，当前不沿用 JDA 身份 |
| 最新补修构建 | 根 `index-DBnSjEyO.js`，子路径 `index-zNqdQ2lJ.js`；完整 SHA-256 见 live-acceptance.md。共享启动文案使六组 bundle 均改变，六组浏览器全部重建重跑并通过；IAB 已确认根产物并完成 H03 实际回归 |
| 本机候选运行时 | 已从本地 tarball 安装并通过正式 setup 启用；Connector `0.1.0-alpha.4` 候选 code SHA-256 `0ac1ed8682293b427ba6bb2b9acf892164120f951f9b6d88f9fc512eee1fe907`，Open-Science `0.29.0` 已就绪；未记录机器／安装实例标识 |
| 浏览器持久内容 | IndexedDB 中非导出 P-256 CryptoKey、公钥、授权标识和版本；控制记录为暂停／忘记／修订等非 bearer 数据 |
| 内存内容 | 配对查询凭据、短期会话 token、短暂撤销证明使用资格；不进入 URL、日志、引用和公开证据 |
| 原始设计 | 五份 v9-r2 参考已按 reference-intake.json 逐份核对字节数和 SHA-256，全部未变；最终冻结后仍按同一基准审计 |
| 独立性 | Network 不导入 Connector/Open-Science 源码、类型、数据库或凭据；普通检查使用本仓独立夹具，不要求真实运行客户端 |

## 产品规则与逐项证据

| ID | 要求与判定依据 | 当前证据／状态 |
| --- | --- | --- |
| P01 | 首次本机确认默认记住，取消后只连接本次访问；确认捕获的公钥和准确来源不可替换 | Connector 核心／确认测试通过；Firefox 历史默认批准及 IAB JDA 默认 Remember、来源／码匹配后 UI 批准已观察。IAB 取消 Remember 当前访问成功且授权数不增，但刷新／重开仍尝试旧失效授权，DBnSjEyO 已重验当前访问 only、刷新／重开干净 Not connected 且不增长期授权，H03 回归通过 |
| P02 | 刷新、重开、新标签、浏览器正常重启使用相同持久身份，验证新会话后才能 Connected，不再次配对 | 独立身份／适配器／浏览器夹具通过；Firefox JDA 刷新／重开／新标签及暂停、Connected 下完整进程重启已观察；IAB JDA 默认记住后的刷新／新标签／关闭重开 Connected 已观察。DBnSjEyO 的仅本次连接及默认记住刷新／重开、跨标签暂停／恢复均直接复验；Firefox 完整进程重启仍仅属 JDA 记录，不推断 Chrome 兼容 |
| P03 | Connector 正常重启保持安装身份和授权，旧 bearer 无效，重新证明取得新 bearer | Connector 隔离子进程重启／恢复通过；实际本机 stop→setup 已观察运行时替换、同一授权／公钥等绑定保留，停止后网页明确等待且未忘记，重启后未点击 Connect 即自动恢复 UI。未抓取真实 token，协议层旧 bearer 拒绝／新证明仍引用独立测试 |
| P04 | 工作台关闭保留授权；只有有效证明之后的明确未就绪响应才显示已记住等待，恢复就绪可新建会话 | 核心及独立用例覆盖；IAB JDA 正式停止实际 CLI Open-Science 宿主，Connector 继续运行，页面明确授权已记住、等待宿主就绪；启动后稳定宿主相同、instance 改变、Connector runtime 不变，两页自动恢复，审阅确认未复活 |
| P05 | 90 天不活跃精确失效；失败请求、取挑战不续期；错误来源、安装身份、稳定工作台不能继承 | Connector 精确边界、时钟回退、身份变化及失败引用／回执用例通过；Network 对错误码的区分由独立适配器用例检查 |
| P06 | 挑战绑定版本、目的、origin、Connector、授权与截止时间，单次消费；错签名／重放／并发／撤销竞争拒绝 | Connector 独立验证与 Web Crypto P1363 HTTP 互操作通过；Network 在签名前检查所有绑定，不签任意服务端文本 |
| P07 | Disconnect 共同暂停该 origin 的浏览器各标签及重启恢复；明确 Connect 才解除，每页独立验证 | Firefox JDA 跨页暂停、刷新／正常重启保持及显式恢复已观察；IAB JDA 先实际勾选审阅并看到 Send enabled（未发送），另一页 Disconnect 后旧审阅清除；刷新仍暂停，一次 Connect 两页恢复，显式审阅重新未勾选且 Send 禁用 |
| P08 | Forget 清除本地身份、撤销所有使用同一授权的会话；离线不虚称远端撤销 | IAB JDA 在线 Forget 后两页身份移除、刷新不恢复，目标授权 revoked；离线 Forget 明确仅本地清除与管理指引，Connector 恢复后旧授权确仍 active，随后可视管理撤销，刷新不复活。Firefox 授权保持 active；补修新候选不自动继承本项实际证据 |
| P09 | Connector 有可使用的授权列表、最近使用时间、状态和逐个撤销入口 | IAB JDA 管理页显示 Firefox/Web browser 两行来源、状态、创建／最近使用／到期时间，lastUsed 前进；仅撤销 Web browser 后两页资格失效、旧审阅清除、刷新明确授权失效，Firefox 保持 active，待处理配对数 0 |
| P10 | 旧协议、加密／存储不可用、禁用或损坏持久身份时仍可原配对，不假装记住成功 | Network 身份／适配器／状态与最终浏览器夹具通过；补充只读身份库／只读控制存储回归：明确 Connect 仍能仅本次配对，旧持久暂停和授权不被改写，竞争中的新暂停继续生效；不推断私密浏览超出实际生命周期的持久性 |
| P11 | 恢复不改变所选对象或浏览位置，不自动打开审阅、不恢复确认、不发送引用／执行研究 | Firefox 与 IAB JDA 恢复均保留 AnnData、不自动弹审阅；IAB 明确确认后曾直接观察 Send enabled，未点击发送，跨页暂停及宿主恢复后确认失效、Send 禁用。最终 inbox 2 与历史基线一致；DBnSjEyO 的 H03 与最终 R03–R06 回归均无发送，跨页恢复后的审阅仍未勾选、Send 禁用 |
| P12 | 保持唯一入口、黑白黄既有面板层级，新增等待／暂停／忘记可达；不同屏幕和焦点正常 | DBnSjEyO 最新合成协议画面已重采并核对桌面／360×740 窄屏 12 组状态，5 张交接截图已归档，JDA 保留为历史；DBnSjEyO 未连接／已连接面板焦点循环、Escape 返回入口、键盘连接／审阅／暂停恢复已实际通过；360×740 实页无横向溢出，Tab 使 Review 自动滚到可见且焦点明显。200% 无可取证缩放能力，记未覆盖但不阻塞 issue 主体功能；不冒充完整缩放认证 |
| P13 | 默认 unavailable、隔离 Demo、显式 real；根／子路径独立构建、公共目录和原设计不受扩展影响 | JDA 当轮六组构建／浏览器矩阵及 101 输入／794 产物摘要已核验，五份原件未变；DBnSjEyO 补修后的六组产物均改变且全部重建重跑通过；当前 384 单测／470 浏览器由新日志和输入核对支持，不沿用旧候选字节相同结论 |

## 已观察的本地检查

最新补修候选 DBnSjEyO / zNqdQ2lJ 已通过 **384 项单测及类型检查**；六个 mode/base bundle 都改变，六组全部重建并重跑，共 **470 通过／282 明确跳过／0 失败／0 flaky**，各模式计数与下表相同。该轮自动化子任务已核对固定输入和最终日志，并已把独立新记录归档到 validation.json；旧 JDA 保留在 supersededReadOnlyCandidate。此结果与下述 JDA 历史及旧远端 CI 分开，不重复累加。

以下为已核验的 JDA 自动化候选历史；仅本次连接补修后的结果另行追加。该轮记录见 [validation.json](validation.json)：Network `npm test` **373 项通过，0 失败**；六份 mode/base 浏览器检查合计 **470 项通过、282 项明确跳过、0 失败、0 flaky**。背景浏览器为 **Chromium 153.0.8010.12**，不等同于实际安装的 Chrome。全部构建使用 `fixtures/pilot/snapshots.json` 和目录快照 `2c239307f62698d0f5496274`。已逐项重新核对 101 个源码／CI 配置输入摘要，与记录一致。

| 模式 | base | 通过 | 明确跳过 | 失败／flaky |
| --- | --- | ---: | ---: | --- |
| unavailable | `/` | 80 | 80 | 0／0 |
| unavailable | `/aipoch-network/` | 80 | 80 | 0／0 |
| demo | `/` | 100 | 60 | 0／0 |
| demo | `/aipoch-network/` | 100 | 60 | 0／0 |
| real | `/` | 55 | 1 | 0／0 |
| real | `/aipoch-network/` | 55 | 1 | 0／0 |

跳过项按构建模式或该测试的明确适用范围排除，逐项注释保留在 validation.json，不能当作通过。real 两组覆盖真实传输适配器与持久连接专项；不同模式的测试选择不完全相同，因此此表不能写成每个模式跑过所有检查。浏览器的 IndexedDB/Web Crypto 实际运行，Connector 与批准仍由本仓独立 HTTP 路由夹具模拟，不证明真实工作台已完成同样操作。

该文件同时归档六组逐项结果、报告摘要、101 项源码／CI 配置输入及 794 个产物文件摘要。原运行记录为 `aipoch-persistent-final-nonreal-matrix.json`、`aipoch-persistent-readonly-final-root-report/results.json` 与 `aipoch-persistent-readonly-final-sub-report/results.json`，末次非 real 重建记录为 `aipoch-persistent-final-rebuild-after-readonly.json`。非 real 四份产物在最后只读存储补修后顺序重建，文件逐字节与其浏览器已测产物一致；最新 real 根／子路径分别加载 `index-JDA7-IfB.js` 与 `index-DxhIDIDI.js`。

该轮开发已发现并修复两个竞争条件：只使用 storage 通知时，另一标签明确恢复后当前页仍停在暂停（早期报告桌面和移动各失败一次）；以及恢复新会话的宿主验证期间另一标签暂停后，重复取消导致已知新会话未完成清理（后一轮根路径桌面失败一次）。该轮矩阵已通过对应回归，历史失败的测试名称、统计和报告摘要保留在 validation.json，不计入最终通过数量，也不改写成从未失败。最初并行构建触发输出锁的拒绝属于构建调度，随后顺序构建通过，未被当作源码验证成功。

随后主任务复核又复现了第三个竞争：暂停后恢复了新会话，旧会话的迟到失败心跳仍可能覆盖“已记住”的界面状态。安全子任务已修复；当时的中间候选离线测试 **371 项全部通过**，该轮 real 根／子路径各通过 55 项、明确跳过 1 项，0 失败／flaky；非 real 四份再次重建仍逐字节相同。旧 370 项结果及 B7_fD4JJ / DegsCvS0 两份已测产物保留在 validation.json 的 previousVerifiedCandidate 中，未与新结果累加。该轮 B7_fD4JJ 的真实观察保留为历史；最新 JDA7-IfB 的有限直接复验另记于下节，不由旧观察推断。

最终补查又复现了只读存储回退缺口：已记住且暂停的浏览器在身份库或控制存储变为只读后，明确 Connect 可能因为解除暂停写入失败而直接结束，未能回退本次配对；其后的成功读取还会清除原写入警告。补修捕获解除暂停的写入失败，明确回退仅本次配对，保留原持久暂停和授权，并保证并发暂停使迟到回调失效。两种写入失败各有独立回归，最新 **373 项离线测试及类型检查通过**；六份产物顺序构建成功，四份非 real 与原浏览器已测文件逐字节一致，新 real 两组均 **55 通过／1 明确跳过／0 失败或 flaky**。最新 JDA7-IfB / DxhIDIDI 身份及 101 个输入（新增 CI 配置）已记录在 validation.json；中间 371 项候选没有真实 UI 证据，不另复制整份历史产物。

同一提交将 `package.json` 的 `test:e2e:real` 和 CI 的两个 real 步骤补为同时运行 `real-connector.test.ts` 与 `persistent-connection.test.ts`。`package.json`、`.github/workflows/ci.yml` 的 SHA-256 已列入证据。此前 [Network CI 34833313045](https://github.com/imjszhang/aipoch-network/actions/runs/34833313045) 在 `00d50f73018fd30212a684cbb514c21633b4a019` 成功，但其中 real 每个 base 只执行旧 26 项，不能作为新增 55 项远端 CI 的证明；最新配置已在准确推送 HEAD `16b5d1ed493e4d01eb8fce121cc4313371116ba4` 的 [PR 运行 34848713787](https://github.com/imjszhang/aipoch-network/actions/runs/34848713787) 与 [push 运行 34848710983](https://github.com/imjszhang/aipoch-network/actions/runs/34848710983) 中核验成功。两次运行各为 **373 项单测通过、470 项浏览器通过／282 项明确跳过／0 失败／0 flaky**；real 根／子路径的日志均实际调用两个测试文件，各 **55 通过／1 跳过**。这些是同一候选的重复验证，不累计为双倍覆盖。脱敏 [remote-ci.json](remote-ci.json) 保存准确 HEAD、事件、URL、时间、日志摘要和逐组计数；validation.json 的源码／产物快照保持原记录。

Connector 候选完成 **133 项独立测试、类型检查、构建和最终独立打包安装检查**，覆盖实际临时 Connector 子进程跨正常重启、旧 bearer 拒绝、新会话恢复和 CLI 撤销。其独立记录位于 Connector 仓库 `docs/verification/persistent-authorization.md`，不是 Network CI 前置条件。Connector 草稿 PR #6 当前 `46e22ed49b4bfc37cda89150190d8b1fd7ad0327` 的两次远端独立包检查 [34848721968](https://github.com/imjszhang/aipoch-connector/actions/runs/34848721968) 和 [34848716712](https://github.com/imjszhang/aipoch-connector/actions/runs/34848716712) 均已实际核验 SUCCESS，日志各为 **133 测试／133 通过／0 失败**，独立打包安装 smoke 通过；其实现提交 `97f090b6a9822deb82f7380dc48a47ea15345eb1` 未变。之后本机候选安装和 Firefox 的有限真实观察见下一节；两类证据不混为完整兼容认证。

本次仍核对五份原始设计文件的字节数和 SHA-256，与 intake 记录一致。最新源码、构建和自动化证据的核验不代表剩余真实场景或视觉验收通过。此前 355 项开发过程结果及旧 Issue #5／v9-r2 数量不与本次累加。

当前候选的 [视觉交接](../../../design/changes/issue-7-persistent-authorization.md#最终候选的视觉交接)中，5 张代表图已使用 DBnSjEyO 的真实 real 界面与合成协议重新采集，[图片清单](../../../design/changes/issue-7-evidence/manifest.json)保存其准确摘要；其中仅需重新批准画面的字节改变。此前 JDA 的 24 张／12 组状态检查保留历史，不改成新候选全量截图。新 DBn 实际 IAB 的 360×740 页面无横向溢出，面板可滚动且 Tab 将 Review 自动带入视野；键盘动作与焦点返回已直接检查，见 live-acceptance R02/R04/R05。合成截图不证明真实批准，360px 实页也不替代未覆盖的实际 200% 缩放。

## 真实浏览器与宿主验收

| ID | 场景 | 当前状态 |
| --- | --- | --- |
| H01 | Firefox 首次批准（默认记住）→Connected；刷新、页面关闭重开与新标签免配对 | **已列实际范围通过**：保留 Firefox B7/JDA 历史；IAB JDA 默认批准与标签恢复已观察，新 DBn R03/R05 默认 Remember UI 批准、两页刷新和关闭重开免配对 Connected 也已复验 |
| H02 | Firefox 正常浏览器重启，持久身份保留但短期会话重新核验 | **JDA 的 Firefox 实际行为通过**：暂停与 Connected 状态分别正常重启并核实进程替换；前者仍暂停，后者免配对 Connected、AnnData 保留、无自动审阅；显式审阅初始确认未勾选且 Send 禁用。未记录真实 token，协议细节由独立检查支持 |
| H03 | 本机确认取消记住；本访问能连接，刷新后不恢复未批准的长期授权 | **补修实际回归通过**：保留 IAB JDA 原失败。DBnSjEyO 已确认实际加载，旧授权撤销后重新仅本次批准，当前访问 only；刷新／重开最终干净 Not connected，面板无旧授权错误／Forget，仅 Connect 与 AnnData；未增长期授权，待处理配对 0、inbox 2 |
| H04 | 多标签共同暂停；刷新继续暂停；显式 Connect 才允许恢复，审阅确认不复活 | **已列实际范围通过**：保留 JDA Firefox/IAB 历史；新 DBn R04/R05 显式确认后 Send enabled（未发送），另一页键盘 Disconnect 清除旧审阅，两页暂停、刷新保持；键盘 Connect 无配对恢复两页，显式审阅未勾选且 Send 禁用 |
| H05 | Forget 后各标签失去资格、Connector 列表撤销，后续新连接需配对 | **JDA 实际行为通过**：在线 Forget 后两页 Not connected、身份移除、刷新不恢复；管理页目标 Web browser revoked、Firefox active；随后重新配对的默认记住访问另外验证于 H06 |
| H06 | Connector 不可达时 Forget 明确仅本地清除，并可从本机管理撤销原记录 | **JDA 实际行为通过**：实际停 Connector 后 Forget 明确仅本地清除、远端未确认及管理文档链接；恢复后目标授权仍 active，随后管理页只撤销该行，另一页刷新不恢复且无残留错误。最终待处理配对 0、inbox 2 与历史基线一致 |
| H07 | Connector 正常重启、Open-Science 停止和恢复分别验证；不混淆网络不可达和宿主未就绪 | **JDA 已列范围通过**：Firefox 已实测 Connector 停止／正常重启及自动恢复；IAB 正式停实际 CLI Open-Science 宿主时 Connector 保持运行，网页明确已记住等待；启动后两页自动恢复，稳定宿主相同而 instance 变化，旧审阅确认不复活 |
| H08 | Connector Remembered browsers 页准确来源／名称／最近使用／状态及逐个撤销 | **JDA 实际行为通过**：IAB 管理页两条浏览器记录的来源、状态、创建／最近使用／到期可见，lastUsed 推进；只撤销目标 Web browser，Firefox 保持 active，两页失去资格、旧审阅清除，刷新不自动配对 |
| H09 | 按用户最新指示，剩余界面使用任务内浏览器验收，分别记录实际功能及限制 | 任务内浏览器 JDA 已直接验证 I01–I07 所列范围；H03 实际失败及最终默认记住／跨页守卫已在新 DBn R01–R06 回归通过。Chrome 本轮不再实测，未声称兼容；不从 Firefox 或合成测试推断额外范围 |
| H10 | 连续流程保留 AnnData 选择、显式进入引用审阅、Send 不自动启用，全程未发引用 | **已列守卫通过**：JDA 恢复／暂停／宿主流程保留原对象且不发送；新 DBn R04/R05 实际确认后才启用 Send，未发送，暂停清空旧控件、恢复不自动打开审阅、显式审阅未勾选且 Send 禁用。最终交付面板 Connected／remembered、AnnData 显式 Review；最终再次正式查询 pending 0／inbox 2，active 为 Web browser 与 Firefox；只保留原始交付标签 |

实际过程集中归档到 [live-acceptance.md](live-acceptance.md)：L01–L11 保留 Firefox 历史和真实服务对象的确认；I01–I07 记录 JDA 的实际 IAB 流程与缺陷；R01–R06 记录新 DBn 的修复回归、最终默认记住／跨页守卫、键盘和真实窄屏，最终保留 Connected／remembered 的 AnnData 连接面板。确认页通过与正式 CLI 相同的 owner review 端点生成私有 URL 后在 IAB 界面核对并批准；这不是普通 Open-Science 聊天路径，也不是用户本人点击。

IAB 授权出现后管理页可见两条浏览器记录；实际撤销只针对 Web browser，Firefox 保持 active。I07 及 DBn 最终收尾后的正式查询均为待处理配对 0、inbox 2，与历史基线一致；最后 activeBrowsers 为 Web browser 与 Firefox，不推断授权总数。当前页面回执 0 不等于空收件箱。本轮未发送引用或执行研究，第二测试页／确认页／管理页已关闭，只保留原始 Connected／remembered 交付页。

此前锁屏及预览丢失中断已解除，JDA IAB 流程已经直接完成记录；旧临时文件不作为可访问附件。桌面 Open-Science 的保存提示曾阻止退出，但实际 Connector 宿主是独立 CLI 本机服务，其受控停止／恢复已在 IAB 单独验证，不把桌面窗口状态当作服务状态。

I05 缺陷已在 DBnSjEyO 通过实际 R01 回归，最终记住／跨标签、键盘及 360px 实页也已完成 R02–R06 检查；新候选 384 项单测／类型检查与六组 470 浏览器结果已核验。源码提交为 `160cad0b77cd5f18b4a5432b7f9c7ebaf4b5ca80`；推送后的新 HEAD CI 由主任务另行记录。200% 缩放保持未覆盖的兼容限制，不阻塞 issue 主体功能交付。373／470 与已记录远端 runs 仍只对应此前准确 HEAD。原先通过的 JDA 场景保持原候选身份，不自动扩展到新补修。私有确认／管理地址、票据、真实配对码、session/poll token 和私人研究内容不进入公开记录。

## 设计与发布交接

- 设计差异材料已建；设计团队正式签认仍待实际评审记录。
- 本地 implementation、真实验收、代码提交、远端 PR、Issue 关闭、公开发布分别记录。
- 当前没有本次候选的公开部署证明。旧版本 real 已发布的事实，不代表此持久授权扩展已启用。
- 最终完成审计必须逐项覆盖 P01–P13 与 H01–H10 的实际适用范围；缺失、间接或仅有规划的证据保持未通过。

## 远端交接

先前代码和证据已推送至 [Network PR #8](https://github.com/imjszhang/aipoch-network/pull/8) 与 [Connector PR #6](https://github.com/imjszhang/aipoch-connector/pull/6)。两份 PR 已由主任务实际标为 ready for review，保持关联两个 OPEN issue；最新功能实测与推送后检查分别记录，尚未合并或发布。此前 b29fee4 补修及证据已随 Network HEAD `16b5d1ed493e4d01eb8fce121cc4313371116ba4` 推送；Connector 证据 HEAD 为 `46e22ed49b4bfc37cda89150190d8b1fd7ad0327`。这两个准确 HEAD 的四次远端运行均已核验成功，包含新增 real 各 55 项范围，见 [remote-ci.json](remote-ci.json)。两个 issue 仍为 OPEN、两个 PR 已为 OPEN 且 ready for review；这些旧远端结果不证明新 `160cad0b77cd5f18b4a5432b7f9c7ebaf4b5ca80`；补修与本页新增真实观察由主任务统一推送后核验，不填入未来证据提交的 HEAD。

推送后的准确 HEAD 检查与最终交接以 [Network PR checks](https://github.com/imjszhang/aipoch-network/pull/8/checks)、[Connector PR checks](https://github.com/imjszhang/aipoch-connector/pull/6/checks) 及 [Network 验收评论](https://github.com/imjszhang/aipoch-network/issues/7#issuecomment-5662559424) 为准；remote-ci.json 保留其明确列出的历史 HEAD，不冒充后续提交的结果。

## 远端滚动测试准备时序修正

推送 `a928af29e2830a86f76bea84b90874908543a333` 后，[PR 检查 34861517237](https://github.com/imjszhang/aipoch-network/actions/runs/34861517237) 的 unavailable 子路径桌面滚动用例在 Back/Forward 前失败：初始 scrollY 为 0，预期大于 500。该组是 79 通过／80 跳过／1 失败，后续四组没有执行；失败保留，不计为完整矩阵通过。

受控时序检查证实：内容已显示时，导航的既有双帧定位尚未结束，测试设置的滚动会被正常的页面定位覆盖。测试现在等待既有 `#content` 焦点交接，再开始滚动；没有删除原断言、加入等待时长、重试或跳过。根／子路径 × 桌面／移动各重复 5 次，共 20/20 通过，264 个固定产物文件摘要未变。记录见 [navigation-test-stability.json](navigation-test-stability.json)。这项测试准备修正未改变产品源码或 DBnSjEyO 构建，先前真实批准与界面验收仍属于同一产品候选；384／470 本地矩阵保持原快照归属，不与本项重复运行相加。后续提交的完整远端检查分别记录于上述 PR checks 和验收评论。

同一 `a928af2` 的 push 检查 [34861502420](https://github.com/imjszhang/aipoch-network/actions/runs/34861502420) 完整通过（384 单测、470 浏览器通过／282 跳过／0 失败或 flaky），并未覆盖或抹去 PR 的失败。Connector `f2c69b2` 两次检查各 133 通过且独立打包安装通过。四次准确 HEAD／事件和各自结果归档在 [delivery-ci-a928af2.json](delivery-ci-a928af2.json)；测试准备修正后的新提交另看最新 PR checks。
