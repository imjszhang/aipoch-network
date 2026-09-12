# 前端最终浏览器验证

测量时间：2026-09-12T10:52:36.246Z / 2026-09-12T10:52:36.251Z。运行于本机Chrome 152.0.7977.84（Playwright 1.63.0 channel=chrome），桌面1440×1000及Pixel 7仿真。完整测试与源码SHA：[browser-verification.json](browser-verification.json)。

冻结的真实试点快照：`1e5c724017c15008ee05708b`；20个公开来源、20项目、21资源、18组织和1个人研究者。每个base实际生成93个静态HTML。测量时源码尚未提交，以JSON内逐文件SHA识别；其后11个摘要均与实现提交 `214b7aadf2226be53c2c17c519708916d3095ba7` 核对一致。实现已合入私有main `12bea89004d8a68ea96858d9abc4f1999084f021`，两种基路径的CI也重新通过，见[集成记录](private-integration.md)。原始测量时间和快照不改写为后续构建结果。

| 发布基路径 | 通过 | 失败 / 跳过 / 重试 | 实际运行秒 |
| --- | ---: | --- | ---: |
| / | 40/40 | 0 / 0 / 0 | 14.27 |
| /aipoch-network/ | 40/40 | 0 / 0 / 0 | 14.38 |

每套包含11项试点场景及9项独立合成状态场景，分别在桌面和移动仿真运行。静态服务按实际文件处理，未知路径返回真正404。合成来源地址只用于数据关系，浏览器阻止所有非loopback请求。

验证覆盖：

- 首页、真实搜索、类型/学科筛选、排序、分页、URL状态、空结果、搜索失败及重试。
- 个人研究者、scverse两个来源、SciPy固定文档路径、Scanpy→AnnData正反向关系与对应证据。
- 精确组织认领scope、未验证能力声明、访问条件、上游下载、只按已知字段出现的Issues/Discussions及仓库贡献入口。
- 组织/专题只预览20条并保持完整数量；View all进入正确scope，刷新、分页与清除scope保持一致。
- 共享catalog断网、错snapshot、超过32 MB后保留SSR；匹配快照可重试恢复控制。未加载的控件保持disabled，避免吞掉早期输入。
- 撤回/合并及个人和组织历史链接，关闭JavaScript时的目录、详情和撤回页面阅读。
- 三步投稿内容审核、个人/项目纠错、编辑使审核失效、超长Unicode草稿；没有自动提交或伪成功。
- 键盘跳转、移动导航、200%根字体；检查整页和版本卡片内部溢出，Evidence锚点可达。

## 截图与视觉边界

以下都是当前实现截图，原参考HTML未运行。静态设计意图映射仍见[design/README](../../design/README.md)。不能把这些截图称为A22精确对照通过。

- [root-text-200-capabilities-desktop.png](screenshots/root-text-200-capabilities-desktop.png)
- [root-text-200-organizations-desktop.png](screenshots/root-text-200-organizations-desktop.png)
- [root-text-200-capabilities-mobile.png](screenshots/root-text-200-capabilities-mobile.png)
- [root-text-200-organizations-mobile.png](screenshots/root-text-200-organizations-mobile.png)
- [root-home-desktop.png](screenshots/root-home-desktop.png)
- [root-home-mobile.png](screenshots/root-home-mobile.png)
- [subpath-home-desktop.png](screenshots/subpath-home-desktop.png)
- [subpath-home-mobile.png](screenshots/subpath-home-mobile.png)

所有截图与报告仅留在私有开发仓库；没有发布、改变可见性或向外部账号提交内容。
