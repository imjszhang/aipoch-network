# AIPOCH Network

一个尽可能复用 GitHub 的独立科研项目与资源目录。

当前试点含 21 个真实公开来源、21 个项目和 22 个资源。现有 GitHub 仓库、个人和组织可以从一个公开链接开始被收录，无需迁移内容或修改原项目。AIPOCH 提供科研分类、来源明确的补充描述、项目与资源关联，以及可供独立客户端消费的公开目录。

## 当前状态

- 阶段：**实施中**。已建立可运行的目录、静态网站与独立消费者；按完整计划继续验收与交付。
- GitHub：[imjszhang/aipoch-network](https://github.com/imjszhang/aipoch-network)，默认分支 `main`。
- 仓库策略：**公开项目**；GitHub Pages 自定义域名为 [aipoch.network](https://aipoch.network/)，部署记录见 [公开部署](docs/deployment/public-pages.md)。
- 前端设计：当前目标为已原样归档的 [v9-r2 HTML](design/references/aipoch-network-concept-v9-r2.html) 与 [配套实施说明](design/references/aipoch-network-concept-v9-r2.md)；v6 保留为历史基线。目标登记不等于实现完成，规则见 [设计交接](design/README.md)。
- 验收：阶段进度与剩余工作见 [实施记录](docs/implementation-status.md)，首次公开部署已完成，其余验收项继续见实施记录。
- 历史集成证据：既有实现已合入 `main`；此前 201 项离线测试、根/子路径各 40 项浏览器检查及连续两次真实刷新通过，见 [集成验收](docs/verification/private-integration.md)。这些结果不替代 v9-r2 的重新验收。
- v9-r2 本地交付：公共页面、连接与个人首页已实现，232 项离线测试和 352 项浏览器检查通过；按用户指示停止旁白专项，实际覆盖见 [本版实施记录](docs/verification/v9-r2/implementation-status.md)。本版已同步 main 并[正式发布](docs/deployment/v9-r2-release.md)；真实 Connector 适配与回执恢复随后完成并以 real 模式发布，具体环境与范围见 [Connector 状态](docs/connector-adapter.md)。
- 托管：GitHub Pages 静态网站，依托 GitHub 仓库、API 和 Actions；不维护自建常驻后端。
- 独立性：Open-Science 及其他客户端的升级、重构或不可用，不应要求本项目修改、重新发布或停止服务。

## 产品原则

1. **链接即可开始收录。** 上游专用清单、特定 Topics、工作台配置和账号接入均不是基础收录条件。
2. **延续 GitHub 的内容和协作。** 作者、组织、仓库、文档、代码、版本、Issue、PR 和 Discussion 尽量保留原位。
3. **来源与补充可追踪。** 原始资料、人工补充、自动整理和生成结果分别维护，明确出处和责任方。
4. **收录不代表背书。** 社区收录、维护者确认、组织官方确认、科研验证是不同概念。
5. **网站独立可用。** 无需登录或安装工作台，就能浏览、检索、阅读、访问来源与下载入口，并了解如何投稿和参与协作。
6. **公开契约独立。** 客户端读取有版本的通用目录，客户端专用适配由各自项目维护。
7. **先做好目录。** 第一版不建设独立账号、实时社交、私有研究数据托管、远程执行或商业结算系统。

## 文档导航

| 文档 | 用途 |
| --- | --- |
| [架构与决策](docs/architecture.md) | 模块边界、实际技术方案、目录布局、独立性和非目标 |
| [目录与公共契约](docs/catalog-contract.md) | 对象模型、来源分层、最小收录、身份、版本和客户端读取规范 |
| [完整实施计划](docs/implementation-plan.md) | P0–P6 任务、依赖、交付物、验收、工作量与风险 |
| [v9-r2 专项实施计划](docs/v9-r2-implementation-plan.md) | 最新设计接纳、独立适配边界与分阶段任务 |
| [v9-r2 实施与验收记录](docs/verification/v9-r2/implementation-status.md) | N/R/V 状态、接收摘要、实际证据与待验收项 |
| [工作台预览与适配边界](docs/workbench-preview.md) | 默认与 Demo 构建、试用步骤和本机数据；真实模式见 [Connector 适配](docs/connector-adapter.md) |
| [交付与运营](docs/delivery-operations.md) | 私有到公开的选择、GitHub 约束、采集、部署、回滚和运营 |
| [前端设计与 HTML 交接](design/README.md) | 当前设计原件、版本记录、意图映射及后续升级流程 |
| [公开交付决策材料](docs/publication-decision.md) | 可审查的公开范围、许可与仓库布局选项 |
| [代理协作约定](AGENTS.md) | 后续实现时必须保持的项目边界 |

## 项目结构

网站、采集器、数据契约和消费者均在本仓库内独立构建。目录编辑、来源观察、搜索产物和公开数据分别维护。

| 路径 | 责任 |
| --- | --- |
| `web/` | 独立网站与站内搜索 |
| `design/` | 用户提供的 HTML 原件、设计版本与实施映射 |
| `registry/` | 收录引用、人工补充、组织选集和专题集合 |
| `spec/` | 通用模型、公开静态契约与样例 |
| `pipeline/` | GitHub 采集、归一化、校验、快照和索引生成 |
| `generated/` | 可重建产物，不作为人工维护的数据源 |
| `docs/` | 设计、投稿、实施、客户端消费和维护说明 |
| `.github/` | 投稿模板、离线检查与受信手动刷新 |

首个端到端验收目标：一个未为 AIPOCH 做适配的公开 GitHub 项目，仅凭链接即可进入候选目录，准确展示来源、用途和信息缺失状态，并允许普通访客访问上游；任意独立消费者能够从通用目录定位同一资源。

## 公开状态与设计接纳

主仓库已公开，原创代码及相应文档采用 MIT，正式网站使用 GitHub Pages 与 aipoch.network。此前私有阶段的方案与验收记录保留为历史，现行发布配置和证据见 [公开部署](docs/deployment/public-pages.md)。

设计接纳、实现验收和生产发布分别记录。v9-r2 的连接与引用流程通过独立适配接口组织。默认构建仍为 unavailable；正式站已显式选择 real 模式，真实配对和引用接收的验证范围见 [Connector 适配](docs/connector-adapter.md)。完整模拟演示仅在独立 Demo 产物中提供。Network 网页不处理 GitHub 授权；仓库访问、导入、同步和需要权限的动作由独立 Connector 与工作台处理。

原始规划基线：2026-09-12；最新配对设计接收：2026-09-13。参考 HTML、配套 MD 与 Open-Science 源码均不是本仓库的运行或构建依赖；设计素材和上游内容保持各自的权利归属。

## 本地开发

使用 `.node-version` 指定的 Node 24.18.1。

```sh
npm ci
npm run catalog:build
npm run dev
```

首次离线构建使用 `fixtures/pilot/snapshots.json` 中筛选过的公开来源试点数据；它不是实时状态。`npm run catalog:refresh` 只读 GitHub 公开数据并把新批次保存到本地 `.cache/`；之后重新构建即可预览更新。

```sh
npm run check
npx playwright install chromium
npm run test:e2e
npm run intake -- https://github.com/scipy/scipy
node consumer/cli.mjs http://127.0.0.1:4173/catalog/v1/manifest.json --query scipy
```

浏览器测试针对构建后的静态站点；`npm run preview` 单独启动静态预览。子路径测试使用 `SITE_BASE=/aipoch-network/ npm run build` 和 `TEST_BASE=/aipoch-network/ TEST_PORT=4174 npm run test:e2e`。

正常构建的连接适配器为 unavailable。要试用连接后的个人首页、保存和引用回执，使用单独产物 `npm run build:demo`，再运行 `npm run preview:demo`，访问本地 4185 端口。演示状态持续标注 Demo。真实通信已实现，显式构建使用 `npm run build:real`；配对需要实际 Connector、本机确认及支持的浏览器环境，不会因构建成功而自动连接。具体协议、环境证据与使用边界见 [Connector 适配](docs/connector-adapter.md)，默认与 Demo 操作见[工作台预览](docs/workbench-preview.md)。

[投稿指南](CONTRIBUTING.md) · [字段规范](spec/README.md) · [消费者指南](docs/consumer-guide.md) · [自动检查与刷新](docs/automation.md)

## 许可证

原创代码及相应文档采用 [MIT](LICENSE)，由项目所有者于 2026-09-13 指定。原始设计参考、上游项目内容和第三方依赖不因此变更许可证；其权利与声明保持原有归属。目录中的来源许可证描述的是对应上游内容，不是本项目 MIT 许可的替代。
