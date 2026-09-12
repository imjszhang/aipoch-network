# 自动检查与来源刷新

更新日期：2026-09-12。本文描述仓库内的工作流配置；写入配置不等于工作流已经在 GitHub 成功运行。实际运行结果以对应 commit 的 Actions 记录为准。

当前仓库保持私有。两条工作流均没有 Pages、部署、推送、创建 PR、修改仓库可见性或自动合并步骤。

## 1. 两个独立入口

| 工作流 | 触发方式 | 运行内容 | 数据与输出 |
| --- | --- | --- | --- |
| [Offline checks](../.github/workflows/ci.yml) | `pull_request`、`push` | 安装锁定依赖，类型检查，契约/流水线/独立消费者测试，静态构建，桌面和移动端 Chromium 验证 | 固定使用 `fixtures/pilot/snapshots.json`；不发起 live 来源刷新，不上传产物 |
| [Review a source refresh](../.github/workflows/refresh.yml) | 维护者手动 `workflow_dispatch` | 检查受信任 `main`，读取已登记的公开 GitHub 来源，生成并验证候选网站 | 只上传 `dist/` 候选 artifact，供有本仓库权限的人审查，保留 7 天 |

CI 中“离线”指来源数据、契约和测试不依赖实时 GitHub 采集。安装 Node.js、npm 依赖和 Playwright Chromium 仍需访问对应软件分发服务。浏览器验证通过本机静态预览服务器进行，不连接任何研究工作台。

CI 使用 Node.js **24.18.1** 和 `npm ci`，由 `package-lock.json` 固定依赖。当前浏览器矩阵是 `playwright.config.ts` 中的桌面和移动端 Chromium；工作流安装方式遵循 [Playwright 浏览器安装说明](https://playwright.dev/docs/browsers)。当前工作流验证根路径 `/`；未来添加 Pages 子路径检查时，构建的 `SITE_BASE` 和测试的 `TEST_BASE` 必须一致，不能把根路径检查视为子路径已通过。

## 2. 本地复现 CI

在仓库根目录，使用已固定的 Node.js 版本：

```sh
npm ci
npm run typecheck
npm test
SOURCE_BATCH=fixtures/pilot/snapshots.json SITE_BASE=/ npm run build
npx --no-install playwright install --with-deps chromium
TEST_BASE=/ npm run test:e2e
```

`SOURCE_BATCH` 显式指定已记录的输入，避免本机 `.cache/batch.json` 改变默认 CI 结果。`npm run build` 自身会运行 `catalog:build`；工作流不重复生成同一个目录。默认测试不需要 `GITHUB_TOKEN`，也不需要 Open-Science 仓库、安装目录或运行实例。

查看静态构建：

```sh
npm run preview -- --port 4173 --base /
```

## 3. 手动刷新与审查

工作流只接受 `main` 分支上的手动触发，且仅在仓库仍为私有时运行。即使从其他分支点击运行，候选任务也会被跳过；checkout 另外显式指定 `ref: main`。该工作流不接受外部仓库、PR 编号、脚本路径或来源 URL 输入，来源范围来自已经合并到 `main` 的注册目录。

配置已推送到默认分支后，可以在 GitHub Actions 中选择 **Review a source refresh → Run workflow → main**，或使用：

```sh
gh workflow run refresh.yml --repo imjszhang/aipoch-network --ref main
gh run list --repo imjszhang/aipoch-network --workflow refresh.yml --limit 5
```

这两个命令分别触发和查看运行，不是部署命令。本文没有自动执行它们。

本地同等采集路径：

```sh
npm run catalog:check
npm run catalog:refresh
SOURCE_BATCH=.cache/batch.json SITE_BASE=/ npm run build
```

公开 GitHub API 可以匿名读取，受匿名限额约束。`GITHUB_TOKEN` 在本地是可选的；不要在命令行字面文本、仓库文件、日志或文档中写令牌。GitHub 工作流仅向 `catalog:refresh` 一个步骤提供仓库作用域的只读 `github.token`；依赖安装、测试、构建没有这个环境变量中的凭据。来源状态只输出受控 URL 和状态，不启用请求头、原始 API 响应或环境变量转储。

采集结果先写入 runner 的 `.cache/`，构建再从这次 `.cache/batch.json` 生成候选。上传范围仅为 `dist/`，保留必要的 `.nojekyll` 等站点文件；不上传原始 `.cache/`、Git 数据或 HTML 设计原件。候选包含预定可展示的目录内容，因此仍须按来源撤回、来源时间、描述来源和许可证检查，不得把“构建通过”理解为科学验证或发布许可。

候选 artifact 名为 `catalog-candidate-<run-id>-<attempt>`。下载后检查 `catalog/v1/manifest.json`、静态页面和 `build-report.json`；详情和公共分片应指向同一 snapshot。是否接纳数据修订、如何更新已经审查的输入以及何时发布，仍是独立决策。工作流不会把候选写回 Git，也不会自动创建 PR。

**跨运行缓存边界：** 当前 hosted runner 每次从干净工作区开始，不保存或恢复原始来源缓存；本地连续刷新可复用 `.cache/sources` 中的上次观察，GitHub 手动任务不能保证拥有上次有效观察。首次请求失败可能使来源继续作为候选而不进入本次产物。审查者必须与上次已接受目录对照，不能自动晋级缺失来源的候选；该工作流没有自动发布步骤。未来无人值守刷新若需要跨运行保留，须先决定受控快照的保存、撤回、权限与完整性校验方式，不能直接上传原始缓存绕过此边界。

## 4. 权限与不可信改动隔离

- 两条工作流都显式设定 `permissions: contents: read`；没有 `contents: write`、`pull-requests: write`、`pages: write` 或 `id-token: write`。
- PR 使用 `pull_request`，不使用 `pull_request_target` 或把不可信 PR artifact 接到受信任 `workflow_run`。PR 的代码和测试可以运行，但没有本工作流提供的写入或发布凭据。GitHub 对这类边界的风险说明见 [安全使用 pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)。
- Checkout 使用 `persist-credentials: false`。Setup Node 关闭自动包管理器缓存；受信刷新不从 PR 恢复缓存或输入产物。
- 刷新步骤只执行 `main` 中的流水线代码，不执行被收录仓库的 README 指令、package hooks、研究代码或工作流。上游文本仍然是数据。
- 使用 GitHub hosted `ubuntu-24.04` runner；当前不接入带机构数据或长期凭据的自托管机器。
- 仓库可见性、Pages站点可见性与Actions产物访问是不同边界。当前artifact属于私有仓库工作流，保留期只有7天；它不是公开预览链接或永久备份。

GitHub 的权限配置和工作流事件语义以 [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) 为准。任何未来发布任务应与这两条检查/采集工作流分开，不能靠扩大现有 PR job 权限来实现。

## 5. Action版本与核验记录

2026-09-12通过官方 GitHub REST API 的 `releases/latest` 和 `git/ref/tags/<version>` 核验以下版本；tag解析结果都是直接指向commit。工作流固定完整SHA，版本名称只作为注释，不能用可移动tag替换SHA。该选择遵循 [GitHub Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)。

| Action | 当次核验的版本 | 固定commit |
| --- | --- | --- |
| [actions/checkout](https://github.com/actions/checkout/releases/tag/v7.0.1) | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| [actions/setup-node](https://github.com/actions/setup-node/releases/tag/v7.0.0) | v7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` |
| [actions/upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) | v7.0.1 | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |

升级时重新读取对应发行说明、`action.yml` 输入和tag实际指向的commit，更新SHA和此表，然后在普通检查路径验证。第三方Action升级不构成开启部署或提高权限的理由。

## 6. 尚未启用的周期刷新和发布

`refresh.yml` 当前没有 `schedule`。公开前再决定刷新频率、来源数量和失败处理；届时可以通过显式repository variable控制周期任务是否运行，并保留手动重跑入口。增加cron触发需要单独修改工作流并记录生效时间，本文中的未来方案不会自行开始定时运行。

Pages发布、公开社区投稿、仓库转公开以及长期私有源仓库方案继续遵循[交付与运营](delivery-operations.md)。当前候选工作流既不替代这些决策，也不证明公开访问或公开投稿已经可用。
