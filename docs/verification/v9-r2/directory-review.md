# v9-r2 目录实施核验

核验日期：2026-09-13。对象为本次未提交工作树构建的默认生产模式，预览地址 `http://127.0.0.1:4290/`。`build-info.json` 为 `workbench_mode: unavailable`、`real_connector: false`。设计依据是原样归档的 v9-r2 HTML；本文不表示已发布或完成真实 Connector。

精确设计 SHA、源码基线及文件 SHA、构建 JS/CSS SHA、目录快照、截图 SHA 和实际视口测量记录在 [directory-viewport-metrics.json](directory-viewport-metrics.json)。截图均由实际构建页面生成，未注入布局 CSS 或应用状态。

## 视觉核验

人工对照了 Projects、Capabilities 的 1440px、390px 原稿与本次实现；另检查 1024px、360px 实现及 360px 手机筛选浮窗。

| 视口 | Projects / Capabilities 首屏 | 桌面侧栏 | 页面水平溢出 | 页面错误 |
| --- | --- | --- | --- | --- |
| 1440 × 1000 | 各 8 条 | 236px；搜索宽 1176px | 无 | 无 |
| 1024 × 1000 | 各 8 条 | 236px；搜索宽 960px | 无 | 无 |
| 390 × 844 | 各 8 条 | 收入 Filters 浮窗 | 无 | 无 |
| 360 × 844 | 各 8 条 | 收入 Filters 浮窗 | 无 | 无 |

目录现已统一保留标题区、顶部黑色细边搜索框、类型导航、左侧四项筛选、真实数量、排序、项目行/能力卡及每页 8 条分页。手机显示单列结果，通过 Filters 打开筛选浮窗。共享卡片本轮修正后，Connect 为右侧有边框按钮，能力卡操作回到卡片底部右侧；项目显示 Research area 与 Reusable outputs。

| 页面 | 原稿 | 实现 |
| --- | --- | --- |
| Projects 1440 | [参考](screenshots/reference-projects-1440.png) | [实现](screenshots/implementation-projects-1440.png) |
| Projects 390 | [参考](screenshots/reference-projects-390.png) | [实现](screenshots/implementation-projects-390.png) |
| Capabilities 1440 | [参考](screenshots/reference-capabilities-1440.png) | [实现](screenshots/implementation-capabilities-1440.png) |
| Capabilities 390 | [参考](screenshots/reference-capabilities-390.png) | [实现](screenshots/implementation-capabilities-390.png) |

补充截图：[Projects 1024](screenshots/implementation-projects-1024.png)、[Capabilities 1024](screenshots/implementation-capabilities-1024.png)、[Projects 360](screenshots/implementation-projects-360.png)、[Capabilities 360](screenshots/implementation-capabilities-360.png)、[手机筛选浮窗](screenshots/implementation-directory-filters-360.png)。

## 行为核验

新增 `tests/e2e/directory-navigation.test.ts` 的 8 个场景，在最终默认构建的桌面和手机项目中共 **16/16 通过，无重试、无错误**。结果从父任务完整回归报告 `playwright-report-v9-release-root/results.json` 提取并保存在 [directory-navigation-results.json](directory-navigation-results.json)；未重复执行完整回归。

覆盖内容：

- 六类目录均可搜索、有真实总数且首屏最多 8 条；响应式筛选可见。
- 翻页保持排序；进详情后返回、继续后退/前进及刷新恢复相同结果。
- `page=999/0/-2/NaN/2.7` 修正为实际有效页，保留其他参数，不出现无结果且无分页的滞留状态。
- 等待真实搜索索引期间保持可浏览；索引到达后收敛页码，搜索框持续保有焦点及输入内容。
- 研究领域、固定版本筛选和排序刷新后保留；未知组织/集合/条件明确为空并能重置。
- scipy 组织范围为 3 条；与 Foundations 集合相交后为 SciPy 项目 1 条；移除组织限制恢复集合 5 条。
- 搜索索引失败仍显示真实目录页，重试成功后应用原查询并修正页码。
- 手机筛选的 Tab 首尾循环、Esc 关闭、原查询保留、重置和关闭后焦点返回。

直接操作 Version & conditions 另确认：未固定版本筛选为 Snakemake 项目/能力 2 条；未知许可筛选为 22 条；陈旧来源筛选为 0 条，与当前快照没有 `stale` 来源一致。当前真实快照不能提供陈旧来源正例，本报告不声称已覆盖该正例。

## 数据及适配差异

- 默认生产模式没有原稿的黄色原型模拟条；连接仍为未连接，不能据本报告推断真实工作台成功。
- 本次真实目录含 20 个项目、21 个能力；原稿能力示例为 20 个。数量及观察日期来自实际快照，未改为原稿示例值。
- `access` 保留原稿 `pinned` / `unknown`，并补充 `unpinned` / `stale`。固定版本只认项目/能力的明确 `source_refs.commit`，不以仓库观测 HEAD 代替固定引用；项目未知许可来自其引用来源。组织和集合沿用实施项目 `relatedEntriesFor`，与详情 View all 使用同一关系范围。
- 实现保留明确的 Community indexed 标记；局部图标、日期格式、卡片字号/行距仍与原稿有细节差异。此次确认目录结构、信息顺序和主要操作布局，不作逐像素一致声明。

本报告支持公开发现、目录状态保持、真实条件展示及手机键盘操作的相应验收范围；其他 R01–R12/V01–V18 状态以整体实施记录和各自证据为准。
