# AIPOCH Network

一个尽可能复用 GitHub 的独立科研项目与资源目录。

当前试点含 20 个真实公开来源、20 个项目和 21 个资源。现有 GitHub 仓库、个人和组织可以从一个公开链接开始被收录，无需迁移内容或修改原项目。AIPOCH 提供科研分类、来源明确的补充描述、项目与资源关联，以及可供独立客户端消费的公开目录。

## 当前状态

- 阶段：**实施中**。已建立可运行的目录、静态网站与独立消费者；按完整计划继续验收与交付。
- GitHub：[imjszhang/aipoch-network](https://github.com/imjszhang/aipoch-network)，默认分支 `main`。
- 仓库策略：**公开项目**；GitHub Pages 自定义域名为 [aipoch.network](https://aipoch.network/)，部署记录见 [公开部署](docs/deployment/public-pages.md)。
- 前端设计：第一版以 [aipoch-network-concept-v6.html](design/references/aipoch-network-concept-v6.html) 为基线；后续通过新版 HTML 迭代设计意图，规则见 [设计交接](design/README.md)。
- 验收：阶段进度与剩余工作见 [实施记录](docs/implementation-status.md)，计划中的公开发布尚未完成。
- 私有集成：实现已合入 `main`；201 项离线测试、根/子路径各 40 项浏览器检查及连续两次真实刷新通过，见 [集成验收](docs/verification/private-integration.md)。
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

## 私有开发与未来公开

当前私有状态不自动改变。网站公开范围、主仓库是否公开、公开投稿位置和许可证，需要在公开试点前形成明确决定。私有源仓库不等于私有 Pages，私有主仓库也不能直接接受所有外部用户的公开投稿。

当前不提供开源许可证授权。公开前将分别决定本站代码与原创目录资料的许可方式，并保留上游项目各自的许可证。

规划与实施基线：2026-09-12。用户指定的 HTML 已原样归档为前端设计依据；参考文件与 Open-Science 源码均不是本仓库的运行或构建依赖。

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

[投稿指南](CONTRIBUTING.md) · [字段规范](spec/README.md) · [消费者指南](docs/consumer-guide.md) · [自动检查与刷新](docs/automation.md)
