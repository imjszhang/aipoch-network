# Connector 真实模式 alpha 发布记录

日期：2026-09-13。状态：真实模式静态产物已初步上线，完整生产浏览器端到端验收仍待完成。本记录区分产物发布、HTTPS 可读取、本地联调与正式浏览器连接四类证据。

## 发布身份与结果

| 项目 | 本次记录 |
| --- | --- |
| 正式地址 | `https://aipoch.network/` |
| 实际源码 | `e3eb65895b1bebe64f3cefcf18996213bf525313` |
| CI | [34757788508](https://github.com/imjszhang/aipoch-network/actions/runs/34757788508)，成功 |
| 受信刷新 | [34757888181](https://github.com/imjszhang/aipoch-network/actions/runs/34757888181)，成功 |
| 正式部署 | [34758098215](https://github.com/imjszhang/aipoch-network/actions/runs/34758098215)，verify、deploy、smoke 全部成功 |
| 构建基路径 | `/` |
| 显式模式 | `real` |
| 当前 snapshot | `26ba825d9cdfbeeabbdb7b98` |
| GitHub artifact SHA-256 | `d45fde203fb911639ea87fba3ff5841edad90d09c7705dae256bff697480dd5c` |
| 完整文件树 SHA-256 | `2fbed774e9936d5f4ce6ea89c2fc0ddbf09c7240b1acb405bb5f1d9eb57a6aeb` |
| 产物规模 | 96 页、189 文件、3,797,586 字节 |

刷新与发布将 `workbench_mode: real` 绑定到本次审阅产物。工作流默认值和默认本地构建仍为 `unavailable`，此次部署没有修改默认选择，也没有加入自动真实模式发布。

## 已取得的正式站证据

独立 Node/curl HTTPS GET 返回 200。正式 [build-info.json](https://aipoch.network/build-info.json) 声明真实模式、协议 `1.0` 与端点 `http://127.0.0.1:47821`；[当前目录 manifest](https://aipoch.network/catalog/v1/manifest.json) 的 snapshot 为 `26ba825d9cdfbeeabbdb7b98`。部署 smoke 通过，确认其检查范围内的正式静态内容、模式、当前／固定快照与 404 行为。

这些证据说明正式站正在提供本次真实传输产物及目录；`real` 声明只表示包含真实传输代码，不表示某位用户当前已经连接。Node/curl 不经历网页访问本机服务的浏览器权限和兼容性约束，不能替代正式网页连接验收。

## 生产浏览器验收尚未完成

Codex 内置浏览器导航正式外部 URL 时，两次 30 秒尝试和一次 60 秒尝试均超时，标签仍为本地页面或空白页。随后通过 Codex 打开正式页面的请求返回 `queued`，当前任务尚未显示该页面；已请用户切回任务，使正式站页面能够加载。

截至本记录，未取得正式 HTTPS 页面中的配对、有效会话、审阅发送和匹配持久回执证据。导航超时本身不能确定是网站、浏览器界面或 Connector 的问题，也不能认定浏览器已通过认证。后续验收需在实际加载的正式页面进行，并记录浏览器与宿主环境、连接后的首页、原对象保持、明确审阅、匹配回执以及断开后状态。

## 已有测试的适用范围

- 本地真实 HTTP 链路：`http://127.0.0.1:4193` → `127.0.0.1:47821` Connector → Open-Science `0.28.0` 独立测试 profile，已验证配对、连接后首页、保留 AnnData 选择、审阅及持久接收。该结果属于本地开发环境，不替代正式 HTTPS 验收。
- 网页协议夹具：独立根路径及 `/aipoch-network/` 子路径 real 构建的浏览器用例各 6 项通过，覆盖桌面与移动视口 Chromium。夹具验证适配器行为，不证明真实宿主可达，也不是实体手机或其他浏览器兼容证明。
- 接收端完整来源校验、MCP、后续项目关联／创建及文件获取由独立 Connector 实现和验证。Network 构建、测试、发布不依赖其仓库、服务或宿主安装。

详细请求摘要、测试命令与证据范围见 [网页适配记录](../connector-adapter.md)。合成实施测试中的批准不代表真实研究用户授权；本次也没有新增 GitHub OAuth、正式安装包或普遍浏览器兼容的验收结论。

## unavailable 回退方法

本次未实际回退。如果需要撤下真实连接入口，使用现有工作流发布一个明确审阅的 `unavailable` 完整产物：

1. 以届时受信任的当前 main 和当前来源恢复状态运行 `refresh.yml`，显式选择 `workbench_mode: unavailable`、`site_base: /`。保留现有撤回记录和目录历史，不把连接回退等同于恢复过期来源。
2. 独立下载、检查该次成功刷新候选，记录其源码 SHA、刷新 run ID、snapshot、GitHub artifact digest 和完整文件树 digest，确认 `build-info.json` 声明 `unavailable`、`real_connector: false`。
3. 使用这些新候选的准确值运行 `deploy-pages.yml`，显式选择 `workbench_mode: unavailable`。GitHub artifact digest 输入带 `sha256:` 前缀；当前 main 必须与候选及审阅源码一致。不得仅把本次 real 产物的模式输入改成 unavailable，也不得直接重用本记录中 real 产物的摘要。
4. 要求 verify、deploy、smoke 全部成功，再核对正式 `build-info.json`、当前 manifest 和公开浏览。记录实际回退结果；本节步骤本身不是已完成回退或回滚演练的证据。

回退仅改变网站连接能力，不删除 Connector 已接收的引用或宿主研究项目。
