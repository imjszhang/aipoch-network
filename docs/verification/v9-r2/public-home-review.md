# v9-r2 公共首页视觉与浏览器复核

复核时间：2026-09-13 09:07–09:15 UTC。范围：公共首页、其公开入口和响应式布局；另补充真实浏览器 200% 缩放下的 Join、个人首页与引用审阅主流程。本文不是全站 R/V 验收结论，也不证明真实 Connector 已接入或版本已发布。

## 输入与可复现身份

- 基础提交：`bb15fd15398e32ca6ed912070f8f182c17c08f03`；分支 `codex/v9-r2-design`，本次证据对应其尚未提交的实施工作区。
- 原设计：`design/references/aipoch-network-concept-v9-r2.html`，SHA-256 `804616ce98eb02add16f2e14ec9d72f473df679882951568def97c24e4f406e7`。读取实际原件及配套 MD；原型通过独立的 `http://127.0.0.1:53139/` 运行，不以当前实现截图充当参考。
- 实施生产候选：`http://127.0.0.1:4290/`，`workbench_mode=unavailable`、`real_connector=false`。
- 实施演示候选：`http://127.0.0.1:4185/`，`workbench_mode=demo`、`real_connector=false`。
- 目录快照：`26b7d31efa5dd84150f48a9c`。
- 当次生产 `dist/index.html` SHA-256：`d148afab184da285d590d49fd372edab61485d28bfb1232847f482edd029b836`。
- 当次演示 `dist-demo/index.html` SHA-256：`8d28357dbbca2f04440cd8b5248f6f3a277ae0b3be5fb37501a84bc6fb63c5e8`。
- `PublicHome.tsx` SHA-256：`059342ce46d4267b61ffd2c7f80683ef23a1c1647eddcb4fb862c050e3c1c899`。
- `public-home.css` SHA-256：`654c2ea6b08adbcb95cbab0032dca7bfc91a401120208b8e2374e726b5b8f269`。

后续重建或修改这些输入时，须依据新产物判断是否补跑，不能把本页摘要当作后续版本证据。结构化结果见 [public-home-browser-results.json](public-home-browser-results.json) 和 [browser-zoom-200-results.json](browser-zoom-200-results.json)。

## 同状态视觉对照

实际查看了以下原件与最终候选截图，核对标题、产品截图、搜索/数字五格、项目行、能力卡、组织卡、关系分区及 GitHub 邀请区；同时检查了最终移动首屏和放大截图。

| 视口 | 原设计 | 最终候选 | 结果 |
| --- | --- | --- | --- |
| 1440 × 1000 | [原稿](screenshots/reference-home-1440.png) | [候选](screenshots/public-home-1440.png) | 双栏 hero、行/卡层级、黄色强调与公共分区一致；无水平溢出 |
| 1024 × 1000 | 实际原 HTML 同视口读取 | [候选](screenshots/public-home-1024.png) | hero 双栏、能力两列、统计换行与参考一致；无水平溢出 |
| 390 × 1000 | [原稿](screenshots/reference-home-390.png) | [全页](screenshots/public-home-390.png)、[首屏](screenshots/public-home-390-first-screen.png) | hero 单栏、产品卡、两列统计且末格通栏、下方单列卡；无水平溢出 |
| 360 × 1000 | 实际原 HTML 同视口读取 | [候选](screenshots/public-home-360.png) | 按钮与卡片可达，标题和描述自然换行；无水平溢出 |

抽查的实际尺寸（CSS px）均来自浏览器，不由源码推算：

| 视口宽 | hero 内容高度 | 产品卡高度 | 五格高度 | 页面 scrollWidth |
| --- | ---: | ---: | ---: | ---: |
| 1440 | 619.453 | 491.453 | 69.844 | 1440 |
| 1024 | 628.484 | 468.953 | 100.844 | 1024 |
| 390 | 1018.109 | 451.969 | 183.531 | 390 |
| 360 | 1023.625 | 457.484 | 183.531 | 360 |

1440 的 hero、产品卡、搜索框（64 px）、五格，以及 1024 的 hero/五格与原参考读数相同。390 产品卡初检曾因额外的窄屏 padding 缩小 10 px，已删除该覆盖并在重建后重拍；最终与原稿一致。全局负责人同时恢复了 84 px 桌面页头、71 px 移动页头和浅色页脚。

### 按产品规则保留的差异

- 数量来自当前实际目录：Projects **20**、Capabilities **21**、Organizations **18**、Researchers **1**、Collections **2**。原稿的 20/20/18/19/2 是冻结设计数据，其中 19 包含组织主体；Researchers 当前仅统计 `account_type=user`。
- 项目、能力及组织按当前目录选取，未把原稿的固定条目顺序、故事或观察日期写死。当前条目描述长度造成的卡片高度和换行差异属于数据差异。
- 关系展示解析当前实际存在、带证据且两端可解析的关系；没有相应关系时使用来源浏览介绍。没有把原稿特定 Scanpy/AnnData 故事当作每个快照必有的事实。
- 项目时间标注为 `Updated`，使用条目的 `updated_at`；目录侧栏显示当前快照生成日期。没有为对齐截图伪造日期。
- 产品卡继续使用原 HTML 中的真实 JPEG：159,268 字节，SHA-256 `4686db0b56aace68af5cfdf0fbab372580f883b2469e6717a8cf6d2df3b7fdae`。实际网络响应摘要亦一致；外置资产未重新生成、裁剪或压缩，展示比例与原稿相同。归属说明随资产保留。
- 视频明确延期：使用静态视频图标和 `Walkthrough · coming later`，不保留看似可播放的按钮。
- 生产首页不显示原型版本横条；工作台未连接时没有 Save/Unsave。项目与能力的轻量动作分别明确为 `Connect to open` / `Connect to use`，不堆叠黑色主按钮。
- 页脚的素材声明入口用于保留原素材归属；不改变目录的授权与来源语义。

## 浏览器行为复核

最终生产候选的以下断言全部通过，详见结构化结果：

1. 页面恰有一个 `main` 和一个一级标题；未连接时没有 Save/Unsave 按钮，也没有播放或 walkthrough 按钮。
2. 首页首次加载不发出外部请求，产品图完整加载；产品图网络响应摘要与设计原图一致。
3. 搜索框可由键盘输入 `scanpy` 并按 Enter，站内进入 `/explore/?q=scanpy`，显示匹配的 Scanpy 内容；后退可回到公共首页。
4. 390 px 触控上下文可点击 `Projects 20` 并进入项目目录；Join 主入口进入 `/join/`。
5. 五格的可访问名称分别是 `Projects 20`、`Capabilities 21`、`Organizations 18`、`Researchers 1`、`Collections 2`。搜索区域、搜索框和提交按钮具有明确名称；键盘聚焦链接显示可见焦点轮廓。
6. 禁用 JavaScript 后仍能读取 hero、五格、项目/能力正文和产品图；原生 GET 提交保留正确查询 URL。该断言只证明静态可读回退和表单地址，未声称无脚本时动态筛选已生效。
7. 1440、1024、390、360 四个视口均无页面水平溢出，采样过程没有 pageerror。
8. 390 px 下把根字号设为 32 px（从 16 px 翻倍）后仍无水平溢出，[截图](screenshots/public-home-390-root-text-200.png)。这是根字号扩大检查；固定 px 文本没有被统一放大，不把此项冒充浏览器缩放。
9. `prefers-reduced-motion: reduce` 生效时首页动作过渡为 `0s`，无溢出，[截图](screenshots/public-home-390-reduced-motion.png)。

这些名称和焦点检查来自浏览器及可访问树，不等同真实屏幕阅读器朗读验收。VoiceOver 等全站读屏检查由总验收另外记录。

## 真实浏览器 200% 缩放补充

使用独立临时 Chromium 配置目录，在仓库外创建只具 `tabs` 权限的本地 Manifest V3 扩展，通过 `chrome.tabs.setZoom(tabId, 2)` 设置浏览器缩放，并用 `chrome.tabs.getZoom(tabId)` 独立读回 **2**。不是注入 CSS zoom、修改字体、设置 page scale 或缩小 Playwright viewport。

浏览器版本 `153.0.8010.12`，原生窗口 1440 × 1000；缩放后 `innerWidth=720`、`innerHeight=456`、`devicePixelRatio=2`，窗口外宽仍为 1440。全部采样页的 `scrollWidth=720`，无水平滚动。引用对话框宽 696、高 432.5 CSS px，内部 `scrollWidth=clientWidth=694`；长内容通过纵向滚动可读，确认与发送控件可操作。

此模式下 Playwright 的普通 screenshot 尝试曾错误裁剪原生缩放画面，未作为最终证据。最终截图全部改用不覆盖 viewport 的原生 CDP `Page.captureScreenshot({format:'png',fromSurface:true,captureBeyondViewport:false})`，每张为实际可见区域 1440 × 913；已经逐张检查引用顶部、确认区、回执和个人首页截图，内容可读、控件未被裁断。

| 页面/操作 | 证据 | 结果 |
| --- | --- | --- |
| 生产公共首页 | [截图](screenshots/public-home-browser-zoom-200.png) | 可读、无水平溢出；Join 链接可点击 |
| 生产 Join | [截图](screenshots/production-join-browser-zoom-200.png) | 无水平溢出，真实连接不可用边界保留 |
| 演示 Join | [截图](screenshots/demo-join-browser-zoom-200.png) | Connect 可操作，等待后明确进入演示连接 |
| 连接后的个人首页 | [截图](screenshots/connected-home-browser-zoom-200.png) | 完整替换宣传首页，五个栏目和轻量 Demo 状态可见 |
| 引用审阅顶部 | [截图](screenshots/reference-review-browser-zoom-200-top.png) | 标题、对象、来源/快照字段可读，对话框在视口内 |
| 明确同意与发送 | [截图](screenshots/reference-review-browser-zoom-200-consent.png) | 滚动到下方可勾选确切内容确认并点击 Send reference · Demo |
| 演示回执 | [截图](screenshots/reference-received-browser-zoom-200.png) | 回执可见，Return to research 可操作，明确未证明导入或执行 |

实际执行了 Join → 连接演示 → 个人首页 → Explore → 选择 AnnData → 引用审阅 → 明确勾选 → Send reference · Demo → 匹配回执 → Return to research。过程中始终保持真实 200% 缩放，无浏览器异常。这是该条主流程的缩放/操作证据，不代替所有引用竞态测试或真实客户端联调。
