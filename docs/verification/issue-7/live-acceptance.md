# Issue #7：实际浏览器与本机服务验收记录

记录日期：2026-09-14。状态：**本轮功能实测已完成记录；200% 缩放未覆盖，新提交远端验证另记**。此记录保存主任务已直接观察的界面与正式本机操作结果；没有可靠原始时间戳的步骤只保留先后顺序，不补造精确时间。

用户先前明确授权代理在其 Firefox 中操作本轮连接批准，随后指示“剩下的测试，直接在你的浏览器里测试”。因此保留 Firefox 已测范围，后续所有界面步骤转至任务内浏览器。Chrome 不再属于本轮剩余实测范围，也没有获得兼容性结论。批准属于用户明确授权下的代理操作，不是用户本人点击；没有扩大为发送引用或执行研究的授权。

## 记录来源与候选身份

主任务先后直接操作原生 Firefox 和任务内浏览器，观察截图／可访问性界面，并通过正式 Connector 与 Open-Science 命令核对运行状态；本记录由文档子任务依据主任务逐次回报整理。会话随后重启，先前临时观察日志及临时预览文件不再存在，本页不把它们当作可访问的附件。已进入 [validation.json](validation.json) 的历史自动化与重启摘要、[remote-ci.json](remote-ci.json) 的远端核验记录保持原样。

| 对象 | 已观察时的身份与范围 |
| --- | --- |
| Network 已实测 JDA 候选 | 实现 `b29fee4b3b843702b8666c2814500d8b72ae39ce`；已推送证据 HEAD `16b5d1ed493e4d01eb8fce121cc4313371116ba4`；根 bundle `index-JDA7-IfB.js`，SHA-256 `909229e2a8e4f5717e6b65060a41b80148790f3f2d8d966e53d79f738263c01a`；适用下列 Firefox 与任务内浏览器 JDA 观察 |
| 目录快照 | `2c239307f62698d0f5496274` |
| 来源 | `http://127.0.0.1:4186`；该轮实际检查已核对 JDA bundle；Firefox 强制刷新，恢复预览后任务内浏览器另行验收 |
| Firefox | 已安装版本 155.0.1；完整浏览器重启通过 `about:profiles` 的正常重启入口，实际核验进程替换 |
| Connector | 本地 tarball 安装的 `0.1.0-alpha.4` 候选；实现 `97f090b6a9822deb82f7380dc48a47ea15345eb1`；code SHA-256 `0ac1ed8682293b427ba6bb2b9acf892164120f951f9b6d88f9fc512eee1fe907` |
| Open-Science | 正式状态报告 0.29.0；本轮实际 Connector 对接的是独立 CLI 本机无界面服务，桌面窗口运行不等于该服务就绪 |

不公开真实配对码、私有确认／管理 URL、票据、授权标识、安装／工作台标识、公钥指纹值、bearer 或私钥。下列“绑定保持”指正式结果比较相等，未把其实际值写入证据。

## Firefox 已直接观察的步骤

| ID | 操作与直接结果 | 判定边界 |
| --- | --- | --- |
| L01 | **历史 B7 候选**：正式 local-owner `pair review` 打开本机确认页；代理核对来源，保留默认 Remember 并批准。网页 Connected、AnnData 保留；刷新加载 `index-B7_fD4JJ.js` 后免配对恢复，未自动弹审阅，本次访问回执 0 | 保留首次默认记住批准的历史记录；不是最新 JDA 全新批准分支，也不是普通 Open-Science 聊天入口验收 |
| L02 | **当轮 JDA 候选**：强制刷新、关闭当前 Network 标签后重开已关闭标签、同源新标签导航，三项分别观察到免配对 Connected、AnnData 保留、未自动弹审阅、本次访问回执 0 | 不把单次标签恢复推断成完整浏览器重启 |
| L03 | 明确 Continue with this capability 后打开 `AnnData/resource:anndata-library` 审阅；确认框初始未勾选，Send reference 禁用 | 随后虽点击过确认框，但点击后的启用状态未单独观察，不能记作“Send 已启用” |
| L04 | 一页 Disconnect 后本页显示 Connection paused；另一页仍显示准确 AnnData 审阅，但确认框和 Send 均消失，仅剩 Connect；另一页刷新仍暂停。第一次正常重启 Firefox 后进程替换、原有标签保留，Network 仍暂停且 AnnData 选择保留 | 直接覆盖跨页暂停、刷新保持、暂停跨完整浏览器重启；不从旧确认控件消失推断其此前启用状态 |
| L05 | 明确点击 Connect 一次后，本页截图显示 Connected、remembered、AnnData 及显式 Review 入口；另一 Network 标签也显示 Connected | 明确恢复已观察；没有自动进入审阅或发送引用 |
| L06 | 从 Connected 状态第二次正常重启 Firefox，进程再次替换。激活 Network 后自动 Connected，AnnData 保留、无自动审阅、本次访问回执 0；显式打开 Review 后确认框未勾选、Send 禁用 | 完整浏览器进程重启后的实际恢复与初始审阅守卫已观察；没有导出／记录短期会话凭据 |
| L07 | 正式 Connector `stop` 后刷新网页，显示 Waiting for connection，并明确提示保存的连接暂不能验证、并未忘记。正式 `setup` 重启后运行时标识变化，数据目录、代码摘要、稳定工作台及同一条授权绑定保持；指纹字段存在且长度 64，比较结果相等。未点击 Connect，随后可访问性界面直接显示 Connected、remembered、AnnData 及显式 Review 入口 | 直接覆盖 Connector 不可达、正常重启保留授权及网页自动恢复；旧 bearer 拒绝与新证明的协议细节仍引用独立测试，不把 UI 观察写成抓取过真实 token |
| L08 | 正式 owner 授权列表读回恰好一条有效 Firefox 授权，来源匹配、最近使用时间推进；上述恢复没有新增第二条持久授权 | 这是正式列表查询，不替代有记录管理页的可视展示与逐个撤销验收 |
| L09 | 正式 inbox 查询基线为两条历史持久回执；本轮各已观察页面显示本次访问回执 0，全程未发送引用或执行研究 | “本次访问 0 条”不等于 Connector 收件箱为空，也不删除或否认历史记录 |
| L10 | 尝试退出桌面 Open-Science 时出现 Save not complete；Retry 未解除，选择 Stay 取消退出，未强制退出 | 桌面没有停止，因此这次尝试不能作为实际工作台停止／恢复通过的证据 |
| L11 | 环境续行后发现 Connector 实际使用独立 CLI 本机服务，该服务状态为未就绪；正式 `open-science start --no-open` 后恢复，Connector 报告 ready true、Open-Science 0.29.0，桌面始终在运行 | 已确认真实宿主对象并恢复其就绪状态；尚未完成受控停止期间的浏览器状态与恢复全程验收。桌面保存对话框不再阻断该服务生命周期检查 |

更早一次实际 Connector 重启的脱敏比较摘要已保留在 validation.json；当时因锁屏未观察网页恢复，仅证明服务端记录。第一次错误选取指纹字段的测量已废弃，不计为通过。L07 是之后直接观察到网页停止／恢复的补充，不能改写早期记录的范围。

## 任务内浏览器直接观察：JDA 候选

用户改用任务内浏览器后，主任务恢复了预览并核对 `index-JDA7-IfB.js` 及上表 SHA-256。下列观察全部来自这一已实测候选，不能用于证明后续“仅本次连接”补修产物。首次及重试确认页通过**与正式 CLI 相同的 owner review 端点生成私有 URL，再在任务内浏览器界面核对来源／连接码并批准**；这不是普通 Open-Science 聊天发现／确认路径验收，也不公开生成的 URL 或代码。

| ID | 操作与直接结果 | 判定边界 |
| --- | --- | --- |
| I01 | 确认页默认 Remember 已勾选，来源和连接码匹配，界面批准后 Connected。刷新、新标签、关闭后重开分别保持 Connected、AnnData；不自动打开审阅、不发送 | JDA 的任务内浏览器默认记住及页面生命周期通过；不推断其他浏览器兼容或普通聊天流程 |
| I02 | 第一标签显式 Review，勾选确认后**直接观察 Send enabled**，未点击发送。第二标签 Disconnect 后两页暂停、旧审阅清除；刷新仍暂停。第二页 Connect 后两页恢复，第一标签不自动弹审阅；再次显式 Review 时确认未勾选、Send 禁用 | 直接覆盖任务内浏览器跨页暂停／恢复和旧确认失效；此 Send enabled 是本次 IAB 独立观察，不能补写 Firefox L03 缺少的观察 |
| I03 | 正式 `open-science stop` 返回宿主未运行，Connector 仍运行；刷新显示授权已记住、等待 Open-Science 就绪。正式 `start --no-open` 后稳定工作台相同、host instance 改变、Connector runtime 未变；两页自动 Connected，旧审阅确认未勾选且 Send 禁用 | 真实 CLI 宿主受控停止／恢复通过，并与 L07 的 Connector 不可达分开；未发送引用 |
| I04 | 管理页可见 Firefox 和 Web browser 两行，各有来源、状态、创建、最近使用和到期信息，最近使用时间推进。仅撤销 Web browser 行，Firefox 保持 active；两页 Not confirmed、旧审阅清除，刷新明确保存的授权已失效，待处理配对数 0 | JDA 可视管理列表、最近使用和定向撤销通过；没有撤销 Firefox 授权 |
| I05 | 旧授权撤销后，取消 Remember 并从确认页批准，仅当前访问 Connected for this visit only，远端授权总数未增加。但刷新／重开仍尝试旧授权，随后 Not confirmed | **发现实际缺陷，当轮 JDA 的 H03 未通过**：当前访问分支与无新增长期授权已观察，后续生命周期未符合预期。补修后的候选必须独立重验，不能因已有单测而改写本条失败 |
| I06 | 在线 Forget 后两页 Not connected、身份已移除；刷新不恢复。管理页 Web browser 授权 revoked，Firefox 保持 active | JDA 在线忘记与关联标签失效通过；后续重新配对另外发生，不合并为同一授权 |
| I07 | 新默认 Remember 授权 Connected 后，正式停止 Connector 并核验 running false。网页 Forget 明确仅本地已忘记、远端撤销未确认，提供授权管理文档链接；另一页身份也移除。Connector setup 恢复后正式列表显示同一条 Web browser 授权仍 active，证明没有假称远端撤销；随后通过管理页只撤销该 Web browser 行。第一标签仍 Not connected 并保留该次仅本地提示，第二标签刷新后 Not connected、无残留错误／自动恢复。最终待处理配对数 0，inbox 总数 2 等于历史基线 | JDA 离线忘记、真实远端未撤销、补充本机管理撤销和刷新不复活已通过；本轮没有新增回执 |

本轮任务内浏览器未发送引用或执行研究。管理／恢复操作只针对该 Web browser 测试授权，实际观察 Firefox 行保留 active。I07 的最终 inbox 仍为历史基线 2，区别于各页面显示的本次访问回执 0。

## 补修候选 DBnSjEyO 的实际回归

I05 在 JDA 候选复现后，主任务进行了最小补修，源码／测试已单独提交为 `160cad0b77cd5f18b4a5432b7f9c7ebaf4b5ca80`（本条更新时尚未推送）。新的根 bundle 是 `index-DBnSjEyO.js`（SHA-256 `38f6b5adda79e180efd047ef9327d1e5465e76e6f1e387377a851895c4024d4c`），子路径是 `index-zNqdQ2lJ.js`（SHA-256 `2ad1e7f4ee8393966f268ccde5bce8e2a112592ca85ee1a3e245479ea560f8b4`）。根页面已从 DOM 脚本信息确认实际加载该新产物；下列 R01–R06 属于新候选，不修改 I05 的历史失败，也不将旧 JDA 的 Firefox 完整重启升级为新 bundle 的实测。

| ID | 操作与直接结果 | 判定边界 |
| --- | --- | --- |
| R01 | 新候选默认 Remember 确认页批准后 Connected/remembered；管理页撤销该 Web browser 行，网页明确旧授权失效。显式 Connect 新请求，核对来源／码，取消 Remember 后从界面批准，当前访问 Connected for this visit only，明确下次访问需再批准。刷新即时为中性检查保存连接提示，最终干净 Not connected；打开面板无旧授权错误／Forget，仅 Connect 与 AnnData 对象说明。关闭另一标签后重新打开 URL 也为 Not connected。R01 当时的正式列表共 5 条授权（1 条 Firefox active、4 条 Web browser revoked），本次短会话未增加长期授权；待处理配对 0、inbox 2 | **新候选 H03 实际回归通过**：刷新／重开不复活旧失效授权，不留下不适当的授权错误；保留 JDA 原失败以便追溯。未发送引用或执行研究 |

新候选任务内浏览器的**未连接面板键盘检查 R02**已直接观察：close 上 Shift+Tab 到末项 Read or copy reference，末项 Tab 回 close，焦点保持在 dialog；Escape 关闭后焦点返回 Open-Science 入口；入口 Enter 打开，close 后 Tab 到 Connect，再 Enter 实际发起配对。已连接状态的核心键盘动作和 360px 实页检查另见已完成的 R04。

| ID | 最终补修候选的直接观察 | 判定边界 |
| --- | --- | --- |
| R03 | 新请求默认 Remember，核对来源／连接码后 UI 批准；两个标签刷新后均 Connected | 新 DBn 候选的最终记住批准与刷新恢复通过，批准方式仍为正式 owner review 端点生成确认页后 UI 操作 |
| R04 | 第一标签键盘 Enter 打开连接面板，Tab 顺序为 close → Your research home → Disconnect → Forget → Review，焦点均留在 dialog；Enter 打开 Review，初始确认未勾选、Send 禁用，Space 勾选后 Send enabled，Tab 实际聚焦 Send，但未发送。第二标签实际 viewport 360×740，DOM width 360／scrollWidth 360，dialog x=12、width=336、height=716；主任务目视无横向溢出，内容可滚动。Tab 从 Forget 到 Review 时自动滚动使按钮可见（y=655..707），黄色焦点框明显 | 实际已连接键盘操作和 360px 实页可达性通过。第一标签仍为 1094×919，并未随第二页缩窄；不把它当窄屏样本。第二页 viewport override 已重置；此检查不是 200% 缩放 |
| R05 | 第二标签键盘 Enter 触发 Disconnect，两页 paused；第一标签旧确认框和 Send 数量均为 0，刷新后仍 paused。第二页 Enter Connect 无需重新配对，两页恢复 Connected；第一页不自动打开 dialog。关闭第二标签后重新打开 URL，Connected 且无自动 dialog。第一标签显式 Review 的 DOM 快照确认框仍未勾选、Send disabled；Escape 关闭后焦点回到 Open-Science 入口 | 新 DBn 候选的跨页暂停、确认失效、刷新保持、键盘显式恢复与关闭重开通过；未发送引用 |
| R06 | 最后保留原始第一标签连接面板为 Connected／remembered，AnnData 对象仍在，通过显式 Review 才能继续。第二测试页、确认页与管理页已关闭。最后再次正式查询 pendingPairings=0、inboxCount=2，activeBrowsers 为 Web browser 与 Firefox | 最终交付页面与最后计数均为直接观察；本次查询只报告 active 浏览器，不推断授权总数。这不是生产发布 |

**200% 缩放未覆盖**：任务内浏览器没有公开缩放能力，尝试浏览器 Command+plus 后 DOM viewport/body/dialog 尺寸均未变化；工具也明确不允许以原生 Codex app 控制绕过这一限制。因此没有可取证的实际 200% 浏览器缩放结果，不用 viewport 缩小或 CSS zoom 代替。200% 不是两个 issue 主体的明示硬条件；作为本账本追加的 P12 兼容范围，保留此限制，不声称完整缩放认证。

新候选的独立自动化已经完成 **384 项单测及类型检查**，六组浏览器合计 **470 通过／282 明确跳过／0 失败／0 flaky**。共享启动文案变化使六个 mode/base bundle 均改变，因此六组全部重建并重跑；没有沿用早前“非 real 字节未变”的结论。根／子路径各为 unavailable 80 通过／80 跳过、Demo 100／60、real 55／1。自动化维护子任务核对固定输入及最终日志后已归档到 validation.json；旧 JDA 保留在 supersededReadOnlyCandidate，它们不与原 373 项或重复 CI 运行累加。旧 373／470 远端运行仍只证明其记录的 HEAD，新补修的远端检查另行核验。

## 交付状态与已记录的限制

macOS 锁屏与此前预览丢失中断已结束。任务内浏览器 JDA 流程、新候选 H03 回归，以及 R02–R06 键盘／窄屏／最终恢复收尾均已完成直接观察；旧临时日志仍不作为可访问附件。JDA 通过范围、I05 原失败和 DBnSjEyO 修复回归分别保留，不能宣称所有旧场景都在新 bundle 全量重演。

最终交付页为 R06 的 Connected／remembered 面板，保留 AnnData 与显式 Review。R03–R06 收尾后再次正式查询待处理配对 0、inbox 2，active 浏览器为 Web browser 与 Firefox；只报告该次查询的 active 集合，不推断授权总数。本轮未发送引用或执行研究，第二测试页／确认页／管理页已关闭，只保留原始交付页。

实际 200% 缩放因上述工具能力限制未覆盖，不阻塞 issue 主体已授权功能的交付，但 P12 保留该兼容边界，不能声称完整缩放认证或全量辅助功能认证。Chrome 本轮不再实测；Firefox 完整浏览器重启只属于 JDA 历史证据，没有升级为新 DBn 实测。

最新补修代码提交为 `160cad0b77cd5f18b4a5432b7f9c7ebaf4b5ca80`；证据提交、推送后准确 HEAD 的远端 CI 由主任务后续统一记录，不填入尚不存在的未来文档提交。两项 issue 仍为 OPEN；主任务已将两份 PR 实际转为 ready for review，尚未合并或发布，生产启用仍是独立动作。
