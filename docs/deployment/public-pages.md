# GitHub Pages 与 aipoch.network

2026-09-13：用户明确授权公开仓库、启用 GitHub Pages，并通过 Cloudflare 配置 aipoch.network。本记录取代此前文档中“等待公开授权 / 仅私有开发”的当前状态描述；此前验收记录保留为历史事实。

## 部署配置

- 托管：GitHub Pages，Actions 构建模式，仓库 imjszhang/aipoch-network。
- 正式域名：https://aipoch.network/；构建基路径 `/`。
- Cloudflare 仅管理 DNS，根域四条 DNS-only A 记录指向 GitHub 官方 Pages 地址 185.199.108–111.153，TTL 300 秒。TLS 由 GitHub Pages 签发和终止。
- `.github/workflows/refresh.yml` 手动生成候选；`.github/workflows/deploy-pages.yml` 发布明确指定的候选。没有常驻后端，也未新增定时任务。
- 部署输入固定 main SHA、刷新 run、snapshot、GitHub artifact digest 和独立下载后的完整文件树 digest；校验当前来源、历史撤回、静态文件及 Pages URL 后，独立最小权限任务发布。
- 仓库变量：AIPOCH_PAGES_URL=https://aipoch.network/；AIPOCH_PAGES_RELEASE_APPROVED=true；AIPOCH_PUBLIC_STATE_POLICY_REVIEWED=true。

## 公开恢复状态政策

Actions 保留 90 天的白名单来源观察、最小撤回记录、已校验静态候选；这些内容在公开仓库中可被读取。不保存凭据、原始响应头、原始 README 或私有仓库内容。首次公开沿用已通过身份校验的受信任 main 历史状态。

每次刷新都要求三类受信任状态完整存在：成功观察、撤回证据、目录历史。撤回证据允许来自失败的受信任刷新，并优先恢复。公开模式下任何类别缺失或过期都阻止构建，不会悄悄当作首次运行、重置撤回记录或重新发布旧来源。至少每 90 天需要完成一次受信任刷新；超过保留期需从维护者保存的已审查基线恢复后再发布。该方案是有期限、失败关闭的恢复机制，不承诺无限期存储。

网站只发布构建器生成的静态产物和第三方声明，不发布原始设计 HTML。公开仓库与网站不额外授予尚未选定的自有代码许可证。

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
