# 自动检查与来源刷新

更新日期：2026-09-12。本文描述仓库内的工作流配置；写入配置不等于工作流已经在 GitHub 成功运行。实际运行结果以对应 commit 的 Actions 记录为准。

当前仓库保持私有。两条工作流均没有 Pages、部署、推送、创建 PR、修改仓库可见性或自动合并步骤。

手动刷新可选择根路径 `/` 或 Pages 项目路径 `/aipoch-network/`，默认仍为根路径。选择基路径只改变私有候选的静态链接；不会打开 Pages 或改变访问权限。运行检出事件记录的确切 `github.sha`，避免 main 在排队期间前移后让产物与运行显示的提交不一致。

2026-09-12 的最终实现和 main CI、连续两次受信来源刷新均已在 GitHub 成功运行；第二次实际恢复第一次的观察、负面台账及目录历史。完整提交、运行链接、候选文件清单及验证边界见 [私有集成验收](verification/private-integration.md)。

后续运行尝试级恢复、子路径及依赖声明收尾已另完成真实验收，见[私有交接记录](verification/private-handoff.md)。它保留了一次测试环境失败、对应修复，以及后继成功刷新分别恢复失败任务负面台账和成功任务正向状态/历史的证据。最新确切 main CI 为 201 项离线回归及两组各 40 项浏览器检查通过。

## 1. 两个独立入口

| 工作流 | 触发方式 | 运行内容 | 数据与输出 |
| --- | --- | --- | --- |
| [Offline checks](../.github/workflows/ci.yml) | `pull_request`、`push` | 安装锁定依赖，类型检查，契约/流水线/独立消费者测试，静态构建，桌面和移动端 Chromium 验证 | 固定使用 `fixtures/pilot/snapshots.json`；不发起 live 来源刷新，不上传产物 |
| [Review a source refresh](../.github/workflows/refresh.yml) | 维护者手动 `workflow_dispatch` | 检查受信任 `main`，读取已登记的公开 GitHub 来源，生成并验证候选网站 | 上传 `dist/` 候选及独立的白名单刷新状态 artifact，供有本仓库权限的人审查和下次恢复，均保留 7 天 |

CI 中“离线”指来源数据、契约和测试不依赖实时 GitHub 采集。安装 Node.js、npm 依赖和 Playwright Chromium 仍需访问对应软件分发服务。浏览器验证通过本机静态预览服务器进行，不连接任何研究工作台。

CI 使用 Node.js **24.18.1** 和 `npm ci`，由 `package-lock.json` 固定依赖。当前浏览器矩阵是 `playwright.config.ts` 中的桌面和移动端 Chromium；工作流安装方式遵循 [Playwright 浏览器安装说明](https://playwright.dev/docs/browsers)。工作流分别构建和检查根路径 `/` 与项目子路径 `/aipoch-network/`；两次构建的 `SITE_BASE` 与浏览器的 `TEST_BASE` 分别保持一致。

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

工作流只接受 `main` 分支上的手动触发，且仅在仓库仍为私有时运行。即使从其他分支点击运行，候选任务也会被跳过；checkout 固定为该次 main 事件的 `github.sha`。输入仅允许选择预设静态基路径，不接受外部仓库、PR 编号、脚本路径或来源 URL，来源范围来自该 main 提交中的注册目录。

配置已推送到默认分支后，可以在 GitHub Actions 中选择 **Review a source refresh → Run workflow → main**，或使用：

```sh
gh workflow run refresh.yml --repo imjszhang/aipoch-network --ref main
gh run list --repo imjszhang/aipoch-network --workflow refresh.yml --limit 5
```

这两个命令分别触发和查看运行，不是部署命令。实际执行记录见 [实施记录](implementation-status.md)。

生成供审阅的 Pages 子路径候选时，在触发命令追加 `-f site_base=/aipoch-network/`。它仍是私有 Actions artifact，不是公开站点。

本地同等采集路径：

```sh
npm run catalog:check
npm run catalog:refresh
SOURCE_BATCH=.cache/batch.json SITE_BASE=/ npm run build
```

公开 GitHub API 可以匿名读取，受匿名限额约束。`GITHUB_TOKEN` 在本地是可选的；不要在命令行字面文本、仓库文件、日志或文档中写令牌。GitHub 工作流在来源刷新步骤提供 `GITHUB_TOKEN`，并在可信状态恢复步骤提供 `GH_TOKEN`，均为仓库作用域只读 `github.token`；依赖安装、测试、构建没有这个环境变量中的凭据。来源状态只输出受控 URL 和状态，不启用请求头、原始 API 响应或环境变量转储。

采集结果先写入 runner 的 `.cache/`，构建再从这次 `.cache/batch.json` 生成候选。站点候选上传范围为 `dist/`，保留必要的 `.nojekyll` 等站点文件；另外只上传 `.cache/refresh-state.json` 这一份经白名单筛选的状态，便于新的私有 runner 恢复。原始响应、README、HTTP 头、其他 `.cache/` 文件、Git 数据或 HTML 设计原件均不上传。候选包含预定可展示的目录内容，因此仍须按来源撤回、来源时间、描述来源和许可证检查，不得把“构建通过”理解为科学验证或发布许可。

候选 artifact 名为 `catalog-candidate-<run-id>-<attempt>`。下载后检查 `catalog/v1/manifest.json`、静态页面和 `build-report.json`；详情和公共分片应指向同一 snapshot。是否接纳数据修订、如何更新已经审查的输入以及何时发布，仍是独立决策。工作流不会把候选写回 Git，也不会自动创建 PR。

**跨运行恢复边界：** `scripts/restore-refresh.ts` 完整枚举同一私有仓库的 artifact（最多 1,000 项），分页遗漏、重复、总数变化或超限会停止恢复。按 artifact 实际 `created_at` 选择证据，并通过具体 run attempt 接口核验同仓库、main、`.github/workflows/refresh.yml`、手动事件及完成状态；不依赖 run ID 或列表第一页的顺序。旧 run 的新尝试可提供更新证据；同一 run 正在重跑时，已完成的先前尝试仍可使用。普通观察和历史只接受成功尝试，失败尝试只可提供负面台账。

下载精确名 `trusted-refresh-state-<run>-<attempt>`，只允许单个 `refresh-state.json` 文件，检查尺寸、日期、身份与整个生成契约。不会恢复 PR、其他分支或未完成尝试的产物。状态已筛掉 README、HTTP 头和额外响应字段，保留七天；公共布局启用前仍须重新审查该位置。成功候选中的公共历史也会恢复，只读取通过 manifest/hash/字节/语义校验的分片和最小历史台账，不恢复旧 HTML 或缓存。`HISTORY_DIRECTORY=.cache/restored-history` 将其交给新构建，在当前来源及撤回规则下重新过滤。

缺少恢复状态时，现有已审核 fixture 只能充当历史观察值，采集仍重新读取每个来源。`pipeline/refresh.ts` 验证完整批次：全部暂时失败不覆盖旧接受批次；缺少历史或历史超过七天的失败阻止正常候选。明确私有/不可公开来源先逐条原子保存到独立 `source-suppressions.json`，在之后其他来源失败、验证失败或构建失败时仍保留。工作流用always条件尝试上传对应 `trusted-source-suppressions-<run>-<attempt>`；恢复器只接受已完成的可信main运行，其中失败运行只能提供负面证据，不能提供普通公开快照。含撤下的非完整批次可以生成标为 `withdrawal_only` 的清理候选。普通失败中断不会用半份采集结果覆盖 `.cache/batch.json`，报告保存在 `.cache/refresh-report.json`。构建和恢复即使显式提供旧SOURCE_BATCH也会应用当前负面台账；缺少登记来源的批次直接拒绝，不能解释为大面积撤回。自动抑制仅由时间不早于负面证据、同一稳定ID的新鲜公开观察解除；人工撤回另外保留。本地批次保留有界 ETag/Last-Modified；跨运行状态不保留这些请求头，安全重取元数据。元数据 304 也会重新读取 branch commit、README 与 Release，避免将辅助内容误当成已重新核实。辅助请求不携带凭据；这会使用公开匿名配额，失败时该可选字段保持未知，不能借本地高权限令牌读取后来转私有的内容。完整README只供本地有界观察，不进入网站/公共分片。

## 4. 权限与不可信改动隔离

- 两条工作流均限制 `contents: read`；受信刷新另外使用 `actions: read` 读取历史产物，CI 不需要它；没有 `contents: write`、`pull-requests: write`、`pages: write` 或 `id-token: write`。
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

P6-02 的具体发布输入、权限、完整文件核验、审批后复核和停止流程已整理为 [未启用的 Pages 发布材料](deployment/README.md)。模板位于 `docs/deployment/`，不会由 GitHub 执行；公开布局中的来源状态持久保存及撤回时效仍是激活前置条件。
