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

实际运行、HTTPS 状态与在线检查结果在首次部署后补充。
