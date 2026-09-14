# 长期授权网站版本发布

2026-09-15（北京时间），按用户发布网站新版本的请求，将已合并的 Network PR #8 发布到 https://aipoch.network/。部署完成于 2026-09-14T16:07:13Z。本记录区分网站发布、之前的本地连接验收和 Connector 安装包发布。

## 发布对象

- 源码：`aa9db4065a0f269de83bdb5cbd1c155bab0d11e6`。
- 模式：显式 `real`，基路径 `/`；默认构建的 `unavailable` 设置未改变。
- snapshot：`ba987efd824c392f3b89d3f1`，生成时间 `2026-09-14T15:58:43.465Z`。
- 99 页、232 文件、4,467,965 字节；21 来源、21 项目、22 资源。
- GitHub artifact：`10357001472`，名称 `catalog-candidate-34865602136-1`。
- ZIP SHA256：`ee10048d2d4af4d48e95122a56b999a3d56a075a17a10528d424b2325c055dd0`；独立下载与 GitHub digest 完全一致。
- 文件树 SHA256：`cd88e963faf520b33f3ba7b17a57438d06ec2353b8d07ee98625c89deb704255`。

完整发布输入见 [selection.json](persistent-authorization-release/selection.json)，独立 ZIP 和文件树结果见 [archive-verification.json](persistent-authorization-release/archive-verification.json)。原始 v9-r2 设计参考未修改；交互差异见 [设计变更记录](../../design/changes/issue-7-persistent-authorization.md)。

## 验证证据

- [主分支 CI](https://github.com/imjszhang/aipoch-network/actions/runs/34865358111) 在上述源码通过。
- [受信刷新](https://github.com/imjszhang/aipoch-network/actions/runs/34865602136) 成功，384 项单元测试通过，恢复并验证来源观察、撤回状态和历史快照。
- [部署](https://github.com/imjszhang/aipoch-network/actions/runs/34866495070) 的 verify、deploy、smoke 全部成功，摘要见 [deployment.json](persistent-authorization-release/deployment.json)。
- `2026-09-14T16:08:08.985Z` 独立 HTTPS 检查：首页、构建声明、当前目录 manifest、新旧固定快照 manifest、新版脚本、Explore、Capabilities、Organizations、第三方声明全部返回 200，且逐字节匹配已审查发布包；不存在路径返回真实 404。见 [public-after.json](persistent-authorization-release/public-after.json)。
- 前一线上 snapshot `783da3beb22610ad5d9e3e2b` 仍可读取；候选保留 12 个可用历史快照。
- 正式脚本 `index-DBnSjEyO.js` 的 SHA256 为 `38f6b5adda79e180efd047ef9327d1e5465e76e6f1e387377a851895c4024d4c`，与已通过本地验收的脚本相同。本地行为证据见 [验收记录](../verification/issue-7/live-acceptance.md)。

## 范围与限制

本次只发布静态网站，不发布或安装 Connector，不修改 DNS，不进行正式域名配对、批准、引用发送或研究执行。长期记住授权需要支持该能力的 Connector；旧客户端仍可使用会话连接。正式域名和本地验收地址是不同来源，本地授权不会迁移到正式域名。

发布包在本地浏览器预览显示正常；随后内置浏览器导航到正式域名超时，仍停留在本地预览，因此不将其记作生产浏览器验收。网站上线由成功的部署和独立 HTTPS 内容比对证明；这些检查不证明生产环境的连接端到端验收。临时预览已关闭，原本用户的本地验收页面和服务保留。

本记录在发布完成后以文档提交同步，线上源码仍以上述发布 SHA 为准；文档提交不触发另一次网站部署。
