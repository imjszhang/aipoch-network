# 项目当前状态

核验日期：2026-09-19。AIPOCH Network 是连接科研项目、可复用能力及其原始来源的开放科研网络；当前资源分布不改变跨学科定位。本页汇总已发布事实，实施计划和历史验收记录保留各自的日期与范围。

## 当前 registry 与发布入口

本次审核后的 registry 包含226来源、226项目、227资源，覆盖28/42子学科，另有5项目及5资源待分类。新增50项的核心用途和组件许可已经审阅；源码合入、候选构建与上线分开记录。最新线上数量和 snapshot 以 [正式目录 manifest](https://aipoch.network/catalog/v1/manifest.json) 及其声明的分片为准，部署结果见 [发布运行](https://github.com/imjszhang/aipoch-network/actions/workflows/deploy-pages.yml)。下节保留本次入库前已核验的不可变发布基线，不作为后续线上总数。

## 入库前已核验发布（2026-09-19 10:05 UTC）

正式网站：[aipoch.network](https://aipoch.network/)。本次入库前核验的发布源码为 `22b96184eb899fab617685ae68be30d2a1f6b85e`，目录 snapshot 为 `be6b86f3343c2abb7a3c425e`，生成于 2026-09-19 09:53:38 UTC。

| 指标 | 入库前观察 |
| --- | --- |
| 原始来源 | 176 |
| 科研项目 | 176 |
| 可复用资源 | 177 |
| 有分类条目的 FORD 子学科 | 21 / 42 |
| 待分类 | 5 个项目及 5 个资源 |

跨学科条目可能出现在多个分类中，分类数量不可相加为全站项目数。空分类表示本站尚未收录，不表示该领域没有科研资源。全部六大领域均在项目范围内。

## 入库前发布与验证证据

本次新增 100 个来源及对应项目、资源，经 [PR #21](https://github.com/imjszhang/aipoch-network/pull/21) 合入后完成受信刷新及精确产物部署。

- [主分支 CI](https://github.com/imjszhang/aipoch-network/actions/runs/35435798501)：通过；该版本本地校验包含 461 项单元/契约测试。
- [受信来源刷新](https://github.com/imjszhang/aipoch-network/actions/runs/35435800267)：通过，生成上述 snapshot。
- [正式部署](https://github.com/imjszhang/aipoch-network/actions/runs/35436400204)：通过，2026-09-19 10:05:23 UTC 完成；verify、deploy 和线上 smoke 结果见运行记录。
- 发布产物共 1,152 个文件、869 个页面；独立下载的文件树 SHA256：`7be0bf1e259edb4904f63a1093dbda34ae9c4f48202489d8d7cb9862da53ca57`。
- 本次独立线上核对覆盖新增 300 个来源/项目/资源记录和 200 个详情页面；另检查正式网站桌面及移动端搜索、详情页。未执行上游科研代码，也不据此声称科学有效性。

文档后续提交不自动代表网站重新部署；源码提交、构建候选与线上 snapshot 需分别核对。

## 产品能力与边界

网站提供跨学科浏览、搜索、项目与资源详情、原始来源链接及 URL 投稿入口。目录可在未登录、未安装客户端时浏览。社区收录不等于维护者认可、机构背书或科学验证。

上述正式产物显式使用 `real` Connector 模式、协议 1.0。本次发布未重新执行真实客户端配对或科研执行验收。网页 Connected、引用 received、项目关联、文件获取和研究执行是不同结果；历史跨产品证据仅证明其记录的版本与环境。适配边界见 [Connector 文档](connector-adapter.md)，长期授权发布见 [2026-09-15 记录](deployment/persistent-authorization-release.md)。

仍需持续处理分类空缺、待分类条目与候选维护。没有当前外部用户使用量或科研任务成功率证据，不把未知记作零值或通过。旧实施账本中的待办须按具体版本复核，不能直接视作当前产品缺陷。

## 历史入口

- [实施账本](implementation-status.md)：早期实施与分阶段验收。
- [v9-r2 验收](verification/v9-r2/implementation-status.md)：设计版本的实际验证范围。
- [公开部署与恢复政策](deployment/public-pages.md)：发布配置、历史版本和故障恢复边界。
