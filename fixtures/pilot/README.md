# 公开来源试点输入

`snapshots.json` 是从 2026-09-12 实际 GitHub 公开请求中筛选出的、用于离线构建的固定试点数据。仅保留目录使用的公开字段，不含令牌、请求头、私人信息或完整 README。该文件不是实时状态证明，也不表示相关组织参与或背书 AIPOCH。

实时采集写入被 Git 忽略的 `.cache/`。默认构建在有本地批次时读取它，否则使用这份固定试点；可设置 `SOURCE_BATCH` 指定输入批次。发布前需要重新核验公开状态，不能把历史夹具作为最新采集结果。

离线 CI 显式读取 `fixtures/pilot/snapshots.json`，因此新增正式来源时，维护者还需提供与 registry 匹配、经过审核的白名单观察。普通推荐者只需提供 URL，无需自行采集或制作 fixture。使用可信代码生成的 `.cache/refresh-state.json` 作为审查输入，不复制原始 `.cache/batch.json`；核对内容后与 registry 变更一并交接，步骤见[维护手册](../../docs/maintainer-guide.md#新增来源的离线输入交接)。局部补入新来源时保留原有观察时间，不将全部来源标为刚刚刷新；正式发布仍需当前公开状态检查。

来源和时间逐条记录在文件内。试点共 20 个来源：SciPy、scikit-learn、Jupyter Notebook、Biopython、Snakemake、NumPy、pandas、Matplotlib、seaborn、Xarray、Scanpy、AnnData、Astropy、Nilearn、NiBabel、MNE-Python、Statsmodels、SymPy、NetworkX 和 scikit-image。包含组织及个人账户，以及 scverse 下的两个仓库。SciPy 同仓库提供软件与固定路径文档资源；Scanpy 项目通过其 README 证据关联 AnnData，并提供一条可审查的 uses 关系。归档、删除、权限变化等不可人为制造的真实状态使用独立合成样例验证。GitHub 未提供可识别许可证或完整 commit 时保留缺失状态，未补造数据。描述与源码仍归上游各自所有，使用条件以原项目为准。
