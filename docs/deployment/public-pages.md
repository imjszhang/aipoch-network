# GitHub Pages 与 aipoch.network

2026-09-13：用户明确授权公开仓库、启用 GitHub Pages，并通过 Cloudflare 配置 aipoch.network。本记录取代此前文档中“等待公开授权 / 仅私有开发”的当前状态描述；此前验收记录保留为历史事实。

## 部署配置

- 托管：GitHub Pages，Actions 构建模式，仓库 imjszhang/aipoch-network。
- 正式域名：https://aipoch.network/；构建基路径 `/`。
- Cloudflare 仅管理 DNS，根域四条 DNS-only A 记录指向 GitHub 官方 Pages 地址 185.199.108–111.153，TTL 300 秒。TLS 由 GitHub Pages 签发和终止。
- `.github/workflows/refresh.yml` 手动生成候选；`.github/workflows/deploy-pages.yml` 发布明确指定的候选。没有常驻后端。`schedule-refresh.yml` 每天 UTC 02:17（北京时间 10:17）触发同一 main 手动刷新流程，仅生成候选，不自动发布。GitHub 定时任务可能延迟；维护者应查看 Actions 失败通知。
- 部署输入固定 main SHA、刷新 run、snapshot、GitHub artifact digest 和独立下载后的完整文件树 digest；校验当前来源、历史撤回、静态文件及 Pages URL 后，独立最小权限任务发布。
- 仓库变量：AIPOCH_PAGES_URL=https://aipoch.network/；AIPOCH_PAGES_RELEASE_APPROVED=true；AIPOCH_PUBLIC_STATE_POLICY_REVIEWED=true。

## 公开恢复状态政策

Actions 保留 90 天的白名单来源观察、最小撤回记录、已校验静态候选；这些内容在公开仓库中可被读取。不保存凭据、原始响应头、原始 README 或私有仓库内容。首次公开沿用已通过身份校验的受信任 main 历史状态。

每次刷新都要求三类受信任状态完整存在：成功观察、撤回证据、目录历史。撤回证据允许来自失败的受信任刷新，并优先恢复。公开模式下任何类别缺失或过期都阻止构建，不会悄悄当作首次运行、重置撤回记录或重新发布旧来源。至少每 90 天需要完成一次受信任刷新；超过保留期需从维护者保存的已审查基线恢复后再发布。该方案是有期限、失败关闭的恢复机制，不承诺无限期存储。

网站只发布构建器生成的静态产物和第三方声明，不发布原始设计 HTML。项目所有者已于 2026-09-13 指定原创代码采用 MIT；根目录 LICENSE 与 package 元数据已同步。上游内容及第三方素材不因此重新授权。

## 发布验证

2026-09-13 首次部署完成。生产实现提交 `305f28b7a7499a82fbcf75d8cf2319ed5f08a7c8`。

- [离线 CI](https://github.com/imjszhang/aipoch-network/actions/runs/34734746836)：201 项单元/契约测试，根路径与子路径各 40 项浏览器测试通过。
- [正式来源刷新](https://github.com/imjszhang/aipoch-network/actions/runs/34734754321)：成功，保留受信任观察、撤回状态与历史。
- [正式部署与线上检查](https://github.com/imjszhang/aipoch-network/actions/runs/34734973805)：verify、deploy、smoke 全部成功；93 个页面、143 个文件。
- snapshot：`f3a057b882def28116fadf6d`；完整文件树 SHA256：`2a600c6f138893020df800854f888a6ed1ad948d6bf946e8745acd21f1c0e6e0`。
- GitHub artifact SHA256：`3257a00691b72e4cac756563f8f06262c37ae7de6c1478875da4f6242ad4a3d4`，独立下载 ZIP 与元数据一致。
- GitHub 证书 approved，域名 aipoch.network，强制 HTTPS 已开启。HTTP 和默认 github.io 地址均 301 到正式 HTTPS 地址。
- 首页与投稿页返回 200，主要栏目/第三方声明/当前与固定快照通过发布 smoke，未知路径真实返回 404。
- 独立 Node 消费者通过 HTTPS 读取并验证完整目录：20 来源、20 项目、21 资源。

正式入口仅配置根域 `aipoch.network`。曾测试添加 www 别名，但 GitHub 本次证书未覆盖 www，因此已撤销该新增记录；未留下证书错误的备用入口。

每日调度链路已实测：[调度运行](https://github.com/imjszhang/aipoch-network/actions/runs/34735287889)成功触发[受信刷新](https://github.com/imjszhang/aipoch-network/actions/runs/34735291672)，候选构建成功。该测试验证相同调度工作流的手动触发路径，不声称未来 cron 已按时触发。

## MIT 版本发布与历史兼容验证

2026-09-13，实现提交 `3a54ab0ad51e1ae9c4107422168cf5391a7c13c7` 经 [CI](https://github.com/imjszhang/aipoch-network/actions/runs/34735368235)、[真实刷新](https://github.com/imjszhang/aipoch-network/actions/runs/34735383243) 和 [部署](https://github.com/imjszhang/aipoch-network/actions/runs/34735500179) 全部通过。当前 snapshot 为 `053913d25bfa0e0b162ce7a9`，93 页、163 文件；独立下载完整文件树摘要为 `1993cc78004d670f9604d4d1a775f668a43944b192d9031cf87b6a45c1065bee`。

发布前后通过正式 HTTPS 逐一读取原有 40 个快照文件，SHA256 全部与原产物一致。线上当前 manifest 已切换到新 snapshot，MIT 全文与仓库 LICENSE 字节相符，第三方声明继续保留。该结果证明本次正常发布的历史兼容，不替代故障注入或生产回滚演练。GitHub License API 已识别仓库许可证为 MIT。

## v9-r2 设计更新

2026-09-13，v9-r2 已经用户授权同步 main 并正式发布。实际源码 `472403afed20aec5c3b0f89645688ecf81608009`，snapshot `a9fe477dc576ca357c5524cd`。完整 CI、受信刷新、发布、独立产物核验及线上检查见 [v9-r2 正式发布记录](v9-r2-release.md)。线上为非 Demo 模式，不模拟真实 Open-Science 连接。
