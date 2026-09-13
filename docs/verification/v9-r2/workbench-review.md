# v9-r2 工作台表面：浏览器与视觉复核

日期：2026-09-13。复核对象为本地独立 Demo 候选，不是线上网站或真实 Open-Science 通信。本文由工作台实施代理记录直接操作结果；它不替代全站 R/V 验收报告。

## 输入与边界

- 实施候选：`http://127.0.0.1:4185/`，`dist-demo` 静态服务；`build-info.json` 标示 `design: v9-r2`、`workbench_mode: demo`、`real_connector: false`。
- 目录快照：`26b7d31efa5dd84150f48a9c`，离线候选时间 `2026-09-12T10:31:05.008Z`；实施页使用真实项目目录，未换成原型示例。
- 参考：本仓库归档的 `design/references/aipoch-network-concept-v9-r2.html`，SHA-256 `804616ce98eb02add16f2e14ec9d72f473df679882951568def97c24e4f406e7`。临时本机 HTTP 服务逐字节返回该文件，复核后关闭。
- 浏览器：仓库已安装 Playwright 的 Chromium，无凭据、无客户端服务；每组使用独立 browser context。视口为 1440×1000 与 390×1000 CSS 像素，100% 缩放。
- 原型与实施均通过页面实际按钮进入连接状态；没有直接修改连接标志或用 URL 授予会话。截图后用图像查看工具阅读布局，而非只读 DOM 推断视觉。

## 实际行为检查

以下在 1440 和 390 宽度各执行一次，初次检查全部通过，除移动菜单缺陷单独记录：

| 检查 | 直接结果 |
| --- | --- |
| 普通首页连接 | 顶部控件 → Connect Open-Science → 连接确认 → Welcome back，未进入 Review，也未自动发送引用 |
| 键盘焦点 | 连接对话框内连续 12 次 Tab、5 次 Shift+Tab，焦点均留在对话框；Esc 关闭并返回原顶部控件 |
| 个人栏目 | Your projects、Following、Contributions 分别显示真实缺失数据空状态；Saved 空状态可读 |
| 收藏与站内导航 | 连接后保存实际项目，站内返回首页 Saved 可见同一记录，会话连续 |
| 能力引用 | 从实际 Capabilities 目录选择 Use；出现所选对象完整审阅，未确认时发送禁用 |
| 确认与回执 | 明确勾选后发送；仅等待后出现匹配 Demo 引用回执；文案未宣称导入、执行或验证 |
| 返回对象 | Return to research 关闭审阅，焦点返回原能力动作按钮 |
| 回执历史 | 返回个人首页 View receipts 后显示本次唯一回执 |
| 断开 | 恢复公共首页，Save/Unsave 操作消失，未显示个人首页栏目 |
| 页面范围 | 两种宽度 Join 的文档横向尺寸等于视口宽度；连接/收藏/引用旅程无 pageerror |

初次移动实测发现主导航选中 Projects/Capabilities 后未自动收起，已通知主代理修复；修复后的直接复核记录如下。

**新候选复核（2026-09-13，09:30–09:40 UTC）：** 已在重新构建的 4185 Demo 候选上重复上述主要旅程。1440 宽度 11 项断言通过；390 宽度同样通过，另两次 Projects/Capabilities 导航均确认菜单自动收起。两种宽度均无 pageerror，文档宽度分别等于 1440 和 390。

390 复核使用 `hasTouch: true`、`isMobile: true` 及 `locator.tap()` 进行控件激活；浏览器实际记录 21 次 `touchstart`，覆盖连接、个人栏目、导航、收藏、引用确认/发送、回执返回与断开。这是 Chromium 触控模拟输入证据，不是物理手机使用声明。两种宽度同时设置 `reducedMotion: 'reduce'`，运行时媒体查询确认为真，上述操作全部可用。

另以隔离 Chrome 配置和本地测试扩展调用 `chrome.tabs.setZoom(tabId, 2)`，并读取 `getZoom` 为 `2`；实施和原型均测得 `outerWidth: 1440`、`innerWidth: 720`、`devicePixelRatio: 2`、`scrollWidth: 720`。这是浏览器实际 200% 缩放，不是 CSS 字号、transform 或设备像素比替代。通过 CDP `Page.captureScreenshot` 获取原生截图，避免 Playwright 在浏览器缩放后的截图裁切问题。实际操作通过连接浮窗、个人首页、能力完整审阅、确认发送和收到回执；临时扩展和配置在复核后删除。

## 视觉差异与修正

对照截图发现以下需要修正的实际差异，已由主代理同意并在工作台源码中修正；以下修正均已在重新构建的候选上截图复核：

1. 精简连接浮窗原先位于右上角；参考为居中浮窗。已改为居中并对齐轻量模糊背景，保留 520px 紧凑宽度与 24px 内距。
2. 个人首页 Welcome back 和内容标题原先偏粗；已恢复参考的较轻字重，保留五栏目、两列内容和移动堆叠。
3. 初版 Join 没有忠实使用参考结构。已改为网格 hero“Discover here. Research locally.”、左侧工作台介绍卡与衬线子标题、01–03 步骤，右侧连接状态和黄色“已有 GitHub 项目”卡。
4. 列表工作台按钮已缩为 Connect / Open / Use，完整对象与动作仍保留在可访问名称中。引用审阅移除了只对实施者有意义的协议说明。

新候选截图已确认上述主要修正。最后检查 Join 时另发现原段落样式对新介绍卡遗留 `max-width: 650px` 和灰色正文继承，造成左卡未铺满所在列；已移除该过期规则，并在最终重新构建的 4185 候选上重拍 Join 未连接与已连接两态。1440px 下介绍卡与所在列均为 830px，390px 下均为 358px；标题颜色均为 `rgb(17, 17, 17)`，文档横向尺寸分别为 1440px、390px。已连接两态均显示 Connected，按实际截图确认卡片铺满所在列、两列及移动堆叠正常。原型与实施的 Join 两态还各补拍真正浏览器 200% 截图，均测得 `getZoom: 2`、`innerWidth: 720`、`outerWidth: 1440`、`devicePixelRatio: 2`、`scrollWidth: 720`，没有横向溢出。

完整引用表单有意把真实来源、完整版本和许可明确展开，较原型折叠 JSON 审阅占用更多空间；200% 和 390px 的滚动审阅、确认与返回均已实测可用。

允许且已识别的差异：实施首页的目录数量/条目来自当前目录；个人库增加清楚的本浏览器保存说明；顶部 Demo 文本持续可见，但不复制原型全站黄色版本横幅；真实 Connector 缺失、许可未知和引用字段说明按实际能力呈现。

## 状态边界复查

视觉复核后追加两项实际边界修正，并执行工作台单测：22 项通过，`npm run typecheck` 通过。它们是源码状态测试，不冒充最终静态浏览器场景：

- 在途第二对象现在保留它自己的返回 URL。原请求在替换确认过程中先收到回执时，旧回执保留，替换文案不再错误声称其仍等待或交付未确认；新对象仍必须重新审阅。
- 本机库取消 5000 条 ID 的不一致读取限制。6000 条记录可以写入后重新读取；JSON 解析和写入均限制为 2,000,000 UTF-8 字节，包含多字节文本检查。超过限制退回内存，保留此前有效存储原文。

V11 中旧偏好的准确适用范围：历史生产基线 `bb15fd1` 的 `web/` 没有本机个人库或 localStorage/sessionStorage 调用，因而不存在已发布的前代个人偏好格式可迁移。设计原型的 `aipoch-network-v9.local.v1` / `aipoch-network-v9-r2.local.v1` 使用 `lang: 'zh-CN' | 'en'`，属于原型自己的存储域。实施使用独立 public/demo 域，不自动导入这些原型 Demo 偏好。当前测试证明未知/损坏格式保留原文并降级，不表示已经实现格式迁移。

## 截图索引

全部路径相对于本文目录的 `screenshots/`。相同宽度的 `implementation` 和 `reference` 文件为配对参考，截图内容包含其连接状态。

| 状态 | 文件模式 |
| --- | --- |
| 未连接精简浮窗 | `workbench-{implementation,reference}-{1440,390}-disconnected-popover.png` |
| 已连接精简浮窗 | `workbench-{implementation,reference}-{1440,390}-connected-popover.png` |
| 已连接个人首页 | `workbench-{implementation,reference}-{1440,390}-personal-home.png` |
| Saved 空状态 | `workbench-{implementation,reference}-{1440,390}-saved-empty.png` |
| 已保存实际项目 | `workbench-implementation-{1440,390}-saved-populated.png` |
| Join | `workbench-{implementation,reference}-{1440,390}-join.png` |
| 实际能力完整引用 | `workbench-implementation-{1440,390}-capability-review-top.png`、`-capability-review-confirm.png` |
| 引用收到与历史 | `workbench-implementation-{1440,390}-reference-received.png`、`-receipt-history.png` |
| 原型对应能力审阅及收到 | `workbench-reference-{1440,390}-capability-review-top.png`、`-capability-review-confirm.png`、`-reference-received.png` |
| Join 已连接 | `workbench-{implementation,reference}-{1440,390}-join-connected.png` |
| 真正浏览器 200% | `workbench-{implementation,reference}-zoom200-disconnected-popover.png`、`-connected-popover.png`、`-personal-home.png`、`-join.png`、`-join-connected.png`；实施另有 `-capability-review.png`、`-reference-received.png` |

## 未覆盖与真实读屏边界

- CUA 没有提供浏览器控制 surface（`browsers: []`）。尝试获取原生 Firefox 时，工具等待后报告 Accessibility / Screen Recording 权限尚未授予，未得到可操作的原生窗口。
- 因此本代理**没有完成 VoiceOver 实际朗读检查**。键盘、焦点、HTML/live-region 语义与 Playwright 可访问定位不能替代真实屏幕阅读器使用证据；V15 的此部分仍需补证。
- 390px 除首轮窄视口外，已新增触控模拟 context 和实际 tap 输入验证，不冒充物理手机。1024/360、生产 unavailable、子路径完整回归仍由全站验收单独记录。
- Review 异常隔离、取消/迟到/错配回执由工作台单测与独立浏览器场景报告证明；未在本报告中把单测写成手动浏览器操作。

当前报告状态：主要视觉与行为、触控模拟、键盘、减少动效及真正 200% 缩放复核完成；Join 遗留样式的最终构建截图更新已完成。本报告的原始复核没有读屏证据；之后取得的部分实际朗读另见 [读屏补充记录](screen-reader-review.md)。用户随后指示本轮无需旁白测试，专项已停止，未测内容不记为通过；本报告也不作为已发布的证明。
