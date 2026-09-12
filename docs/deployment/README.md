# 待审阅的 GitHub Pages 发布材料

状态：**未启用、未部署**。`deploy-reviewed-pages.yml.example` 位于 `docs/`，GitHub 不会把它当作工作流运行。它把 P6-02 的权限、输入、校验和停止行为做成可审阅材料；不能据此勾选公开部署验收。

这里没有修改仓库可见性、Pages 设置、环境保护规则、变量、许可证或任何凭据。当前仓库仍沿用私有刷新策略。项目及目录的公开布局、公开来源状态及撤回证据的持续保存策略、处理时效、许可证和原始 HTML 的再分发范围，仍须按 [发布决策](../publication-decision.md) 确定。

## 发布的数据流

```mermaid
flowchart LR
  A[审阅过的 main 手动刷新] --> B[私有完整网站 artifact]
  B --> C[只读任务：核对 run、commit、digest]
  C --> D[校验 ZIP、页面、目录、历史撤回、时效]
  D --> E[固定版本 action 打包 Pages artifact]
  E --> F[github-pages 环境审批]
  F --> G[再次核对主分支、刷新证据、审批时效]
  G --> H[固定版本 deploy-pages]
  H --> I[独立无权限 HTTP 冒烟]
```

输入必须是一个**已成功结束的、同仓库、main、workflow_dispatch、`.github/workflows/refresh.yml`** 刷新。开发 CI 的离线构建不能充当发布来源。选择运行时填写以下六项：

| 输入 | 必须对应的实际证据 |
| --- | --- |
| `refresh_run_id` | 被审阅的刷新 run ID；artifact 名中还绑定 run attempt |
| `snapshot_id` | `build-report.json` 及当前、固定目录 manifest 的相同 24 位 ID |
| `artifact_sha256` | GitHub artifact 元数据中的完整 `sha256:…`，绑定被选择的 artifact 元数据身份 |
| `file_tree_sha256` | 审阅者独立核验后的**完整待公开文件清单**的规范摘要；所有路径、长度、内容 hash 都参与计算，下载后的每个字节必须与它一致 |
| `source_sha` | 被审阅的 40 位提交，必须同时等于当前 main、工作流自身 `github.sha`、刷新 head 及 artifact head |
| `site_base` | `/` 或 `/aipoch-network/`，必须同时匹配 artifact 的 `routes.json`、每个本地链接和已配置 Pages URL 的 pathname |

不重新构建已经审阅的 artifact；来源、HTML、JS、CSS、目录分片和版权说明一起经过字节核验。部署任务不 checkout、不安装依赖、不运行仓库脚本或 artifact 中的代码。其唯一脚本是工作流中可见的固定元数据及时效复核，随后调用固定版本 `deploy-pages`。

本例提议的 **`reviewed-file-tree-v1` 合约须包含在发布审阅中**：硬性信任锚是审阅者事先提供的全部公开文件的规范摘要。ZIP 容器的实际摘要和 GitHub 元数据摘要分别记录，明确显示是否相同；不假定压缩参数、时间戳或 ZIP 注释属于站点公开内容。这个合约不是遇到摘要错误后自动放宽的 fallback：缺少独立审阅的文件树摘要、任一额外文件、内容变动或路径变动都必须失败。模板不会从刚下载的未审阅内容中自动算一个摘要并把它当成审阅输入。

规范文件树为 `{version:1,files:[{path,bytes,sha256},…]}`。路径使用 `/`，按 UTF-8 字节排序；对象键排序后用无缩进 UTF-8 JSON 序列化，末尾恰好一个换行，再计算 SHA256，完整值带 `sha256:`。目录不作为公开文件项，全部普通文件（含 `.nojekyll`、HTML、静态资源、完整固定历史和版权通知）都必须包括。TypeScript 与 Python 分别计算该摘要并由测试验证一致。审阅清单保存在站点目录之外，不把清单自身的 hash 递归纳入内容。

## 已落实的拒绝条件

- main 变动、分支/仓库/事件/工作流不符、失败/未结束 run、artifact attempt 不符、摘要缺失或不同、artifact 过期。
- 必须完整读取最多 1,000 次符合条件的刷新运行；不足页、重复 ID、读取期间总数变化或超过预算都停止。比较 **`updated_at` 和运行状态**，所以较老 run ID 的新 rerun、较新的失败刷新、任何尚未结束的刷新，都会阻止使用旧候选绕过新的撤回证据。不把 GitHub 默认按创建时间排列的第一页当作“最新证据”。
- 生成时间或 run 完成时间超过一小时；来源正向观察超过七天；未知/私有/删除来源仍出现在完整公开记录；过期的 verified claim。最终部署前还检查 `valid_until`，且只读验证完成超过五分钟即中止，以覆盖长时间环境审批。
- 下载 ZIP 超过 250 MB、解压总量超过 250 MB、超过 250,000 项、路径穿越、重复路径、软链接、设备、加密文件或任一已审阅文件树字节摘要错误。
- 缺页、链接越过 base、404/静态路由/当前与固定 manifest/分片 hash 或数量不一致、浏览器目录与公开目录不一致、搜索保留不同数据。
- 使用现有 `retainHistory` 重新计算当前撤回策略，并再次按当前时间计算权限和声明失效；不是只核对旧历史文件自己的 hash。撤回的 snapshot 目录仍能下载、多余历史文件、消失的 available snapshot 或缺失 retirement ledger 都停止。
- 仅允许路由清单页面、已列举的目录/搜索/报告/历史文件、静态 assets 和 `third-party-notices.txt`；额外 `.env`、缓存、源码或原始设计材料不能进入站点。版权说明必须存在且非空；该检查本身不等于 AIPOCH 代码或目录已选定许可证。

部署与来源刷新共用 `trusted-source-refresh` 并发组。最终复核仍会重新读取最新 main 和完整刷新运行清单。GitHub 元数据请求、部署接口之间没有跨服务事务：批准后的极短间隔仍可能发生外部变更；运行发布时应冻结 main 写入及手动刷新，异常时按下面的停止流程处理。此限制不能被“CI 绿色”消除。

## 激活前仍缺少的前置条件

1. 用户选择公开布局、GitHub 账户/组织资格和目标 URL。私有仓库不自动产生私有 Pages 站点；读取当前计划不可得时不能推定免费或付费。
2. 代码、目录内容及原始 HTML 的授权范围经过选择和审阅；第三方依赖通知随实际产物保留。
3. **完整实现并验证所选公开布局中的正向状态、负向撤回证据和固定 snapshot 历史的保存/恢复、刷新失败处理、撤回处理时效。** 当前 `restore-refresh.ts` 的私有 guard 保留，本例没有解决公开后如何持久保存这些状态。不能只设置变量就声称这一步完成。
4. 审阅并决定采用本例的 `reviewed-file-tree-v1` 发布合约，在新生成的真实 artifact 上独立审阅完整内容清单后，验证“下载文件树 = 已审阅文件树”。GitHub 元数据和实际 ZIP 摘要也需分别保留；最终完成下载后的历史样本两者相同，见下节。若选择要求 ZIP 容器摘要也完全相同的更严格策略，工具省略第四个摘要参数时即按该策略硬性拒绝任何差异。
5. 真正需要发布时，再审阅并把模板移至 `.github/workflows/`。Pages 必须已明确设置为 GitHub Actions；设置操作需要发布授权，本模板只读取设置，不会自动创建或改变它。
6. 仓库变量 `AIPOCH_PAGES_RELEASE_APPROVED=true`、`AIPOCH_PUBLIC_STATE_POLICY_REVIEWED=true` 和 `AIPOCH_PAGES_URL=<批准的精确 HTTPS URL，结尾带 />` 只能在对应决定落实后设定。缺少任一项时本例跳过或拒绝。
7. 配置 `github-pages` 环境，仅准 main 部署并要求发布审阅；确认此账户套餐实际支持所需环境规则。保护 main 和工作流修改。模板不会自动创建环境保护规则，也不把缺失的审批规则视为通过。
8. 依据最终 base 运行一次新的私有刷新、审阅产物，并在一小时内发起发布。若五分钟的最终审阅窗口超时，重跑验证；若候选已过期，先做新刷新并重新审阅。首次真实公开部署后，还必须完成 [原计划](../implementation-plan.md) 的外部匿名访问、外部候选提交及回退/撤回演练。

若选择“私有开发仓库 + 另一个公开目录仓库”，不能直接使用本例跨仓库发布：本例只接受同仓库 artifact。需要另行实现并审阅精确提交与 artifact 交接和唯一权威 registry 的协议。若选择把本仓库公开，需要先完成新的状态保存策略；现有私有 refresh guard 不能为了让它运行而直接删除。

## 本地核验与目前证据

工具本身可独立验证，不会部署：

```bash
npx tsx --test pipeline/tests/pages-candidate.test.ts
npm run typecheck
npx --no-install tsx scripts/prepare-pages-candidate.ts metadata.json
npx --no-install tsx scripts/prepare-pages-candidate.ts --inventory independently-reviewed-site > reviewed-content.json
python3 docs/deployment/verify-artifact.py candidate.zip sha256:<GitHub元数据摘要> extracted-site sha256:<事先审阅的规范文件树摘要>
npx --no-install tsx scripts/prepare-pages-candidate.ts metadata.json extracted-site
```

`metadata.json` 的结构见 `PagesMetadata`。元数据校验与本地文件校验分开，是为了下载前就拒绝错误来源；两步都必须通过。CLI 使用真实当前时间，不能用测试中的固定时间作为实际发布授权。

2026-09-12，7 项定向回归全部通过，类型检查通过。覆盖历史保留的只读成功路径，以及主分支/摘要/来源错误、老 ID 的新 rerun、缺页清单、过期、错误 base、离线构建、重算 hash 后恢复已撤回历史、浏览器数据偏差、多余公开文件、缺版权说明和 ZIP 路径/软链接拒绝。分别验证严格 ZIP 摘要模式拒绝差异，以及事先提供正确规范文件树摘要时只接收完全相同内容；错误或遗漏的内容摘要无法绕过。

一次实际、只读的历史 artifact 下载及完整文件树核验结果：

| 项目 | 观测值 |
| --- | --- |
| Run / artifact | `34690368996` / `10296848093` |
| GitHub 元数据 digest | `sha256:40a9e21e82518ceae28ddd32589a2433e64eb4a47f8ae95e485040d47258fcc5` |
| 最终下载 ZIP 实际 SHA256 | `40a9e21e82518ceae28ddd32589a2433e64eb4a47f8ae95e485040d47258fcc5` |
| 元数据 / 最终下载 ZIP 字节 | 497,216 / 497,216 |
| ZIP 内容 | ZIP CRC 正常；122 文件、解压后 2,467,214 字节，逐文件与此前私有审阅目录相同 |
| 规范完整文件树摘要 | `sha256:9342848a18c2d47417d27ebcdee27b2edda6168e3563239b7e2c4bba7dbbd298` |

该 ZIP 还逐项匹配已提交的 [完整 122 文件审阅清单](../verification/private-candidate-files.json)，该原清单文件自身 SHA256 为 `6ad3062367cec1e14857b369ff4aa8174697ccff7b194e6aea22f3ad005715b2`。它的文件排版摘要与新合约的规范清单摘要是不同对象，不能互换。

完成后的实际 ZIP 摘要与 GitHub 元数据相同，规范文件树也匹配。一次未取得下载完成证据的早期读取曾得到不同字节数和摘要；不把那个读数作为稳定的远端异常或 GitHub 重打包证据。官方 [toolkit 下载实现](https://github.com/actions/toolkit/blob/main/packages/artifact/src/internal/download/download-artifact.ts) 同样通过 REST `/zip` 下载并计算响应流摘要。`reviewed-file-tree-v1` 额外绑定每个公开文件的路径及字节，不依赖本例曾发生 transport 差异这一假设。

旧产物不含后来新增的第三方版权通知，代码也不再等于当前 main，因此该只读核验不等于它是当前可发布版本。这里没有实际 deploy、没有 Pages URL 的成功证明。

固定 action 在 2026-09-12 用官方仓库 API 验证：

| Action | 固定提交 |
| --- | --- |
| [checkout v7.0.1](https://github.com/actions/checkout/tree/3d3c42e5aac5ba805825da76410c181273ba90b1) | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| [setup-node v7.0.0](https://github.com/actions/setup-node/tree/820762786026740c76f36085b0efc47a31fe5020) | `820762786026740c76f36085b0efc47a31fe5020` |
| [upload-pages-artifact v5.0.0](https://github.com/actions/upload-pages-artifact/tree/fc324d3547104276b827a68afc52ff2a11cc49c9) | `fc324d3547104276b827a68afc52ff2a11cc49c9` |
| [deploy-pages v5.0.1](https://github.com/actions/deploy-pages/tree/368f82528645a54fb793d4d04e342629a3f51346) | `368f82528645a54fb793d4d04e342629a3f51346` |

上传 Pages action 的内部 `upload-artifact` 也是固定提交。artifact 元数据与 ZIP 的接口语义参考 [GitHub REST 文档](https://docs.github.com/en/rest/actions/artifacts)，部署与环境所需权限参考 [deploy-pages 官方说明](https://github.com/actions/deploy-pages)。更新 action 时要重新验证整个交接，不能只替换版本号。

## 停止和恢复

发布前任何校验失败：任务直接失败，现有站点保持原样；保留失败元数据和候选审阅记录，不跳过 gate、不直接重传 ZIP 来更改它的身份。

发布后 HTTP 冒烟验证预期 HTTPS URL、首页和目录路由、版权通知、当前/固定 snapshot 和真正的 HTTP 404。HTTP 冒烟不覆盖完整浏览器交互，也不自动证明所有历史 snapshot 已撤回。失败时停止后续发布，读取部署状态及目录；涉及不应公开的数据时，在已明确授予的撤回权限内立即取消或下线 Pages，再处理证据和缓存。尚未获得该操作权限时必须交给维护者执行。

恢复必须从历史编辑内容结合**当前** registry、当前公开观察、负向状态和 retirement ledger 重新生成候选，沿用 [恢复流程](../delivery-operations.md)。候选仍需新的 snapshot、精确摘要及同一套校验；不能重新部署旧 ZIP 来恢复已撤回内容。模板不会自动反复重试、自动回滚或自动启用周期发布。GitHub artifact 的 7 天保留和本次 Pages 包的 1 天保留不是长期备份；所选公开布局的长期恢复保证仍属于前置条件。
