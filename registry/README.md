# 目录编辑数据

`catalog.json` 是经过维护者审查的目录输入；`npm run catalog:check` 验证其严格格式、来源、引用和撤回规则。只提交一个链接时，先使用 `npm run intake -- <GitHub URL>` 形成候选；正式目录的 `sources` 另外记录审核时间和理由。

- `sources`：选择公开仓库。组织链接先列为候选并选择具体仓库，不自动全量加入。
- `projects` / `resources`：各自保留稳定 key，可以关联多个来源。描述缺省时展示 GitHub 原描述并标明出处；人工补充不覆盖来源身份。
- `collections`：显式选择稳定 ID，允许无循环的嵌套集合。
- `withdrawals`：最小撤回记录；支持同类型替代。撤回账号时，其来源与依赖内容一并移除，不保留私人撤回理由。
- `actors`（可选）：独立贡献者或审核者的公开 GitHub 身份。`provider_id` 必须具有公开 GitHub API 观察的来源记录，不保存私人权限审计。
- `claims`（可选）：维护者经过独立核验后记录的声明；字段定义来自 [spec](../spec/README.md)。普通投稿者填写 `verified` 或 `organization_owner` 并不形成真实授权；审核必须遵守 [治理规则](../docs/governance.md)。

组织策展 claim 的 `scope` 使用 `catalog-curation:` 加逗号分隔的明确来源/资源 ID，例如 `catalog-curation:source:github:101,resource:workflow`。不能写“所有现有及未来仓库”来自动扩大范围。有效、未过期的 owner 或 owner 明确委派声明只影响这个范围。

`verified` 的治理声明需要审核人、审核时间、到期时间、对应范围的已审查公开证据，以及改名、转移、权限变化、证据失效和争议的复核触发。来源变化会使相关声明重新待核验；撤回主体、声明人、审核人、证据来源或范围条目时，对应声明退出公开目录。

凭据、私人组织成员列表、内部讨论、删除请求联系人和非公开证据原件不能写进这些文件。格式校验用于保持结构与语义一致，真实权限与公开性由可信审核流程确认。
