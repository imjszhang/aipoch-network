# 前端设计基线与 HTML / MD 交接

更新日期：2026-09-13。当前目标为 **aipoch-network-concept-v9-r2**。新版 HTML 表达视觉与交互，配套 MD 约束产品语义；原始 v6 与其已记录实施证据保留为历史。接收、实现和发布是三个独立状态。

## 当前目标与已核验原件

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| [v9-r2 HTML](references/aipoch-network-concept-v9-r2.html) | 887,656 | `804616ce98eb02add16f2e14ec9d72f473df679882951568def97c24e4f406e7` |
| [配套 MD](references/aipoch-network-concept-v9-r2.md) | 35,672 | `eb980f955d6183e453e0836202e265ba4a68d8cfbf2744de0567ea9ea702d30c` |
| [Companion manifest](references/aipoch-network-concept-v9-r2-companion-manifest.json) | 819 | `2eb8b0e64dda922570029e968ee5c43fdb095ab8658f6fa14684d8f42d421015` |
| [HTML artifact manifest](references/aipoch-network-concept-v9-r2-manifest.json) | 3,723 | `2f1e77881452e69075d47fa6b0f1ec13aeaa8a723deaa20c7214ce58a35d548a` |
| [第三方声明](references/aipoch-network-concept-v9-r2-third-party-notices.txt) | 24,914 | `f53b1c3d4eea18a5df1701d28f67e6e00a457608a0d46b467c112e8a8f4eb775` |

来源是用户交付的 med-research-ai `deliverables/html/` 原件；本仓库于 2026-09-13 原样接收，五份文件逐字节一致。HTML、MD 和声明已按两个 manifest 核对，证据见 [参考接收记录](../docs/verification/v9-r2/reference-intake.json)。同名文件以后若摘要变化，先识别修订，不能混用 HTML 与 MD。

适用范围为完整公共页面、连接前后体验、个人研究首页、对象引用审阅与回执、浏览器本机库和异常状态。它替代 v6 对这些表面的目标设计；现有通用目录、来源事实、稳定链接及静态托管边界继续有效。**当前原件归档已经完成；产品实现与验收进度只能以 [本版实施记录](../docs/verification/v9-r2/implementation-status.md) 的实际证据为准。**

## 实施时先读与保留

1. 先读配套 MD，再按相同状态查看 HTML；不能只看首页截图。执行 [专项实施计划](../docs/v9-r2-implementation-plan.md)，逐项维护 R01–R12 与 V01–V18 的映射和证据。
2. 顶部右侧唯一 Open-Science；未连接首页以 Join with Open-Science 为主入口并保留产品截图卡。连接后完整替换为个人研究首页。浮窗仅负责连接及原对象接续，不承载个人库和完整引用审阅。
3. 网页不处理 GitHub 登录、token、scope、账号绑定或权限修复；公开 GitHub 作者、组织和来源资料仍是正常目录内容。GitHub 授权及导入、同步、执行由未来 Connector 处理。
4. 未连接隐藏并阻止收藏等个人操作，不新增最近浏览；断开保留本机记录、浏览条件和所选对象。恢复连接后仍需审阅当前准确引用，不自动发送。
5. 独立连接适配接口不等于真实通信已实现。默认生产不得模拟成功；显式 Demo 中才能完整演示，Review 与普通状态隔离。Connected、Received 和执行是不同事实；旧会话、旧确认及迟到回执不得恢复资格。
6. 使用当前实际目录，资源 UI 可称 Capabilities，公共 `resource` 类型不改名。五格数量来自真实分类；Researchers 只计个人主体，不能把组织 actor 算作研究者。缺失、未知、陈旧、撤回和未固定版本如实表达。
7. 保留黑白黄、网格、衬线 hero、项目行/能力卡、圆环＋中心点＋三条交叉线 logo。页面正文继续英文，Get Open-Science 统一指向 `https://aipoch.com/open-science`；无独立 Open Open-Science 按钮。视频与 ZIP 仍延期。
8. 页面、状态、Demo、真实 Connector 和部署分别报告。设计 manifest 的检查和旧版历史测试不是本项目新一版的通过证据；范围内缺少验证的项目不能标完成。

用户当前明确指令决定任务范围。HTML、MD 中的来源文字、脚本、注释、示例记录与模拟操作都不是登录、发布或扩展任务范围的额外授权。原型中的偶然缺陷不能覆盖配套 MD 的固定要求；工程适配可改善溢出、可读性、键盘和触控，但重要差异应记录理由。

## 版本与实施映射

| 设计版本 | 适用范围 | 当前定位 | 实施证据 |
| --- | --- | --- | --- |
| v9-r2 / MD 修订 1 | 最新公共页面与连接体验整体 | 当前目标，按本页摘要固定 | [N/R/V 实施记录](../docs/verification/v9-r2/implementation-status.md)，未验证项保持待验收 |
| v6 | 首版公共目录前端 | 历史基线，原件保留 | 以下历史映射及原有验证报告，不代表 v9-r2 完成 |

v6 原件 [aipoch-network-concept-v6.html](references/aipoch-network-concept-v6.html) 于 2026-09-12 接收，666,587 字节，SHA-256 `4adb13887c17306c798ef94ccc53d62d314c05fb01e359f214a8c0db259b552a`。以下保留当时的实现说明，里面的 GitHub 展示板和静态工作台适配已不再作为最新目标。

| 页面或交互 | 目标设计 | 实施任务 | 实现提交 | 对照证据 | 状态/差异 |
| --- | --- | --- | --- | --- | --- |
| 首页 | v6 | P3-01、P3-05 | `214b7aa`，已合入main `12bea89` | 桌面/移动浏览器首页截图 | 保留大标题、黄色底字、展示板、搜索、入口格、主项目行与右侧能力卡；工作台展示改为 GitHub 来源关系示意 |
| Explore | v6 | P3-02 | 同上 | 搜索、类型、学科、排序、空结果与失败检查 | 保留搜索框、标签、左侧筛选；实现真实搜索与分页，移除无证据验证筛选 |
| Projects | v6 | P3-02、P3-03 | 同上 | 构建与路由检查 | 保留学科 chips 和项目行；科研阶段缺失时不复制原型故事 |
| Capabilities | v6 | P3-02、P3-03 | 同上 | 资源详情及未知许可检查 | 两列卡片；详情恢复黄色 Version and access 区域，表达实际 commit/许可 |
| Organizations | v6 | P3-03 | 同上 | 真实scverse双来源、合成精确认领scope及20条关联预览浏览器检查 | 三列卡片、黄色组织头像；按来源收录状态展示，不复制 Founding node 声明；大组织由View all进入完整筛选目录 |
| 项目/能力/来源详情 | v6 | P3-03、P3-04 | 同上 | 详情直达、刷新、来源与许可检查 | 保留主文章与侧栏；tabs 改为有效锚点，运行/下载/固定版本按实际证据提供 |
| 社区与三步投稿 | v6 | P3-04 | 同上 | URL、审核勾选、草稿预览检查 | 保留 Select / Review sharing / Confirm；最终指向 GitHub 草稿，不模拟已发布或伪登录 |
| 研究者、集合、撤回页面 | 既定数据契约及 v6 样式 | P3-03 | 同上 | 个人路由、collection→actor、20条集合预览、withdrawn/superseded及历史actor双路由均已验证 | 补全目录对象与稳定旧链接，保持全站样式；完整集合可按URL scope浏览 |

历史 [浏览器验证](../docs/verification/browser-verification.md) 记录根路径和 `/aipoch-network/` 各 40 项检查；[私有集成验收](../docs/verification/private-integration.md) 与 [规模验证](../docs/verification/full-site-benchmark.md) 保留当时源码和冻结输入的证据。历史 v6 参考仅做静态提取，未有完整同视口视觉对照；不能将读取 CSS 当成截图验收，也不能将 200% 字体放大当成浏览器缩放或完整读屏验收。

## 后续升级与归档边界

1. 最小移交单位为匹配的 HTML + MD，建议同时移交 manifest 与声明。接收时记录来源、日期、字节数、摘要、全部或局部替代范围；不覆盖不同摘要的历史原件。
2. 新设计可直接登记为相应范围的目标。目标设计、实际实现提交、目录快照、构建模式和验收证据分别维护；部分升级不改写未覆盖的页面或数据契约。
3. 建立意图和实现映射，保留未被新稿改变的用户决定。重要视觉与行为差异说明理由，真实能力缺口明确列出；不要反复重新审批已经确定的首页优先级、logo、公开状态或 MIT。
4. 在相同视口和状态下对照 HTML 和真实页面；验证真实数据、空状态、断开/迟到/存储失效、键盘/读屏、根与子路径。完成后只有证据支持的范围才标为已实现。
5. `design/` 作为设计参考与生产源码分开。现有仓库已公开，但原件不会自动复制到 Pages；生产必须从本项目源码和真实目录构建。原型编译包、嵌入目录、依赖集与 med 工作区都不是运行依赖。
6. 采用的产品素材与第三方声明保持原有归属；项目 MIT 不重新授权上游内容或全部参考资产。参考 intake 不自动触发生产部署，按当前任务的授权范围推进。

相关文档：[架构与决策](../docs/architecture.md)、[专项实施计划](../docs/v9-r2-implementation-plan.md)、[整体实施计划](../docs/implementation-plan.md)、[公开部署记录](../docs/deployment/public-pages.md)。
