# v9-r2 正式发布记录

2026-09-13。用户授权“可以同步到github线上先了”。本版源码、设计原件与配套文档已同步 main，正式网站已发布至 https://aipoch.network/。

- 实际发布源码：`472403afed20aec5c3b0f89645688ecf81608009`。
- [GitHub CI](https://github.com/imjszhang/aipoch-network/actions/runs/34753200094)：232 项离线测试、正式/Demo × 根/子路径共 352 项浏览器检查通过；56 项按模式跳过，无失败或 flaky。
- [真实来源刷新](https://github.com/imjszhang/aipoch-network/actions/runs/34753204328)：成功；20 来源、20 项目、21 资源，保留 7 个可用历史快照。
- [正式部署](https://github.com/imjszhang/aipoch-network/actions/runs/34753464918)：verify、deploy、smoke 全部成功。
- snapshot：`a9fe477dc576ca357c5524cd`；96 个 HTML 页面，179 个文件，3,647,114 字节。
- GitHub ZIP 摘要与独立下载逐字节一致：`sha256:8dae0a93ddc4c6ae893741ea3bd8618ad027d0620659f2d6b63a18fd7b5dea30`。
- 全文件清单摘要：`sha256:bc509578977fee1c643b2df4380b887ec5aa31adf071aad566b89c7200bbc408`。

正式产物 `build-info.json` 为 `design: v9-r2`、`workbench_mode: unavailable`、`real_connector: false`。没有发布 Demo 模拟连接；GitHub 授权和真实客户端通信仍归未来 Connector。

发布后通过真实 HTTPS 和 Chromium 检查 1440/390 两种宽度：首页、五格入口、未连接时隐藏个人操作、连接不可确认提示、Get Open-Science 链接、目录搜索、Scanpy 详情直达/刷新均正常，无页面脚本错误或首页横向溢出。主要栏目与素材声明返回 200，未知路径返回 404。独立 Node 消费者读取并校验了线上新快照。

证据：[发布身份与产物核验](../verification/v9-r2/production-release.json)、[线上浏览器检查](../verification/v9-r2/production-smoke.json)、[桌面截图](../verification/v9-r2/screenshots/production-home-1440.png)、[手机截图](../verification/v9-r2/screenshots/production-home-390.png)。

首次同步遗漏 Vite 配置，导致 CI 和候选构建拒绝缺少素材声明的产物；补齐后完成上述全套 CI 和发布，该失败产物没有上线。发布后的文档记录提交不改变这里绑定的实际部署源码与产物。

`candidate-manifest.json` 及本地 browser-matrix 保留为提交前离线候选的历史记录；它们的 snapshot 与 committed/deployed 字段不代表本次正式产物。旁白专项按用户决定停止，未测范围仍未标为通过。
