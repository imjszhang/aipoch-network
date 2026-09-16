# 目录编辑数据

`catalog.json` 是经过维护者审查的目录输入；`npm run catalog:check` 验证其严格格式、来源、引用和撤回规则。只提交一个链接时，先使用 `npm run intake -- <GitHub URL>` 形成候选；正式目录的 `sources` 另外记录审核时间和理由。

- `sources`：选择公开仓库。组织链接先列为候选并选择具体仓库，不自动全量加入。
- `projects` / `resources`：各自保留稳定 key，可以关联多个来源。描述缺省时展示 GitHub 原描述并标明出处；人工补充不覆盖来源身份。
- `source_refs`（项目/资源可选字段）：明确声明来源身份、角色、仓库内路径和固定 commit；不随默认分支刷新改写已声明版本，详见下文。
- `collections`：显式选择稳定 ID，允许无循环的嵌套集合。
- `withdrawals`：最小撤回记录；支持同类型替代。撤回账号时，其来源与依赖内容一并移除，不保留私人撤回理由。
- `actors`（可选）：独立贡献者或审核者的公开 GitHub 身份。`provider_id` 必须具有公开 GitHub API 观察的来源记录，不保存私人权限审计。
- `claims`（可选）：维护者经过独立核验后记录的声明；字段定义来自 [spec](../spec/README.md)。普通投稿者填写 `verified` 或 `organization_owner` 并不形成真实授权；审核必须遵守 [治理规则](../docs/governance.md)。
- `relations`（可选）：经过审核且有公开依据的对象关系，真实进入静态目录；关系不等于维护权或科学认证。

资源还可提供 `download_url`、`conditions` 和 `runtime: {status, documentation_url?}`。下载/文档 URL 必须是无凭据 HTTPS；条件列表每项最多 2,000 字符。未提供运行信息时输出 `not_described`；maintainer_described/community_described 必须有公开说明 URL。字段进入公共资源并分别保留出处，不能把提供说明解释为已安装、运行成功或许可证授权。

组织策展 claim 的 `scope` 使用 `catalog-curation:` 加逗号分隔的明确来源/资源 ID，例如 `catalog-curation:source:github:101,resource:workflow`。不能写“所有现有及未来仓库”来自动扩大范围。有效、未过期的 owner 或 owner 明确委派声明只影响这个范围。

`verified` 的治理声明需要审核人、审核时间、到期时间、对应范围的已审查公开证据，以及改名、转移、权限变化、证据失效和争议的复核触发。来源变化会使相关声明重新待核验；撤回主体、声明人、审核人、证据来源或范围条目时，对应声明退出公开目录。

凭据、私人组织成员列表、内部讨论、删除请求联系人和非公开证据原件不能写进这些文件。格式校验用于保持结构与语义一致，真实权限与公开性由可信审核流程确认。

## 固定路径与内容版本

旧的 `sources: ["https://github.com/owner/repository"]` 格式继续工作。它描述发现入口；生成时采用当次公开观察的默认分支 commit，后续刷新可以变化。希望固定某份材料时，在项目或资源上另加 `source_refs`：

```json
{
  "source_url": "https://github.com/example-lab/methods",
  "source_id": "source:github:101",
  "role": "implementation",
  "path": "workflows/analysis.yaml",
  "commit": "cccccccccccccccccccccccccccccccccccccccc",
  "ref": "v1.0",
  "resolved_at": "2026-09-12T08:00:00Z"
}
```

这是字段说明用的合成示例，数字身份与 commit 必须替换为实际核对结果。`source_refs` 是上述对象的数组，须覆盖该条目的全部 `sources`；同一仓库可以声明多个路径与角色。只有 `source_url`、`role` 为基本必需字段；声明 `commit` 时还必须有稳定 `source_id`。支持的 role 为 primary/documentation/implementation/data/evidence/related。

- `commit` 使用完整 40 位小写 Git SHA。`ref` 可记 tag/branch 原名，但它自己不算固定内容。
- `path` 是 Git 相对路径，可含中文和普通空格，不允许上级遍历或 URL 歧义字符。构建时按路径片段编码生成原站链接。
- `resolved_at` 仅保存确实完成版本解析的时间；未提供时保留缺失，刷新不补写“现在”。可选 `sha256` 是声明的内容摘要，也必须绑定完整 commit。
- 当前 URL 对应的 GitHub 数字 ID 如果变化，该条目会暂停展示并留下最小失效记录，不把固定引用接到同名新仓库。
- 管线保存声明，不拉取或执行该 commit 的文件来假装验证存在性、摘要、运行结果或科学结论。公共 `provenance.source_refs` 明确说明这个范围。
- 固定历史版本不自动继承当前默认分支的描述、文档主页或许可证。可在目录条目中提供经过审核的描述和明确文档 URL；未独立整理的历史许可保持未知。原仓库的最新信息仍在来源对象中独立展示。

## 可选增强文件

基础收录不需要增强文件。已经完成来源审核后，可以另提供一个 JSON 文件来原子补充项目、资源或关系，正式写入前仍需审查公开性和科研相关性。此文件不接受 claims、actors、withdrawals、脚本、执行 hook 或未知字段。

```json
{
  "version": 1,
  "source_url": "https://github.com/example-lab/methods",
  "reviewed_at": "2026-09-12T08:00:00Z",
  "review_note": "已审阅社区提供的资源定位和说明。",
  "resources": [
    {
      "key": "reviewed-method",
      "title": "Reviewed method",
      "description": "社区补充的方法说明。",
      "type": "method",
      "domains": ["Research methods"],
      "sources": ["https://github.com/example-lab/methods"]
    }
  ]
}
```

`projects`、`resources`、`relations` 至少提供一个非空数组，条目使用本目录对应类型。`source_url` 必须已出现在经过审核的 `registry.sources` 中；新增项目/资源须包含该来源，所有其他来源也须已注册。增强只补充稳定 key，不覆盖现有人工条目；重复身份、缺失引用、格式错误或无效 URL 导致整份增强不应用，原始目录继续构建。

应用函数为 `applyRegistryEnhancement(registry, parsedJson)`，返回 `{registry, applied, errors}`。调用方读取 JSON 和处理读取/解析错误；函数不打开、下载或执行外部文件。CLI 通过可选 `ENHANCEMENT_FILE` 交给这条路径。文件中的审核时间和附言是提交的审查记录，不是外部系统签发的权限证明；可信维护者必须核对真实性。

应用后的新增项目/资源带 `attribution: {role: "community", url: source_url, observed_at: reviewed_at}`；标题、编辑描述、分类、输入输出和声明引用分别保留社区来源。新增关系的证据角色同样标为 community，不继承文件自行填写的维护者角色。常规目录条目可使用同一可选 attribution 标明 editor/community 补充出处，缺省时保持现有目录编辑来源。

增强文件提供的任何已描述 runtime 都归为 `community_described`，其文档 URL 继续保留；缺省/未描述仍为 `not_described`。即使文件自行写了 maintainer_described，也不能以此形成维护者承诺。下载地址和访问条件不会触发任何下载、安装或执行。

这里的增强文件是**目录编写格式**。`spec/schema/enhancement.schema.json` 描述已经归一化的公共 Project/Resource 补充包；其验证器只检查公共记录结构，不是 CLI 的编写文件入口。两者通过同一 registry → normalize → public catalog 路径产生事实，不单独维护第二套目录数据。

## 有依据的对象关系

`relations` 使用公共契约的 Relation 结构：`kind, id, from_id, to_id, type, evidence, recorded_at` 必填，可选固定 `commit`。例如研究项目产出资源使用 `type: "produces"`、project 作为 from、resource 作为 to；仓库 fork 只能连接两个 source_repository；作者/维护者/策展者关系的 to 必须是 Actor。普通 URL 链接不能自动变成这些关系。

关系必须有已审阅的公开证据，证据时间不得晚于该关系的记录时间。无效种类、重复 ID、自引用、缺失目录对象和不相容的关系端点会被拒绝。依赖 GitHub 数字身份的存在性在真实来源归一化后复核，不能只凭字符串认定有效。

对象或证据来源撤回时，关系退出公开目录并留下最小 tombstone；不会留下只剩一个端点的关系。静态目录的 `relations` 分片与网页数据共用这些实际结果。关系不自动创建任何 claim，也不把社区整理升级成组织主动策展。

## Standard classification foundation

See [versioned vocabularies](taxonomies/README.md) and the [contract design](../docs/research-classification.md). The reviewed F2 mapping is applied to 43 entries. Optional `classification` and `research_tags` require their own reviewed `classification_provenance` and `research_tags_provenance` arrays. Old records may omit all four fields. Do not infer disciplines automatically from legacy `domains`, GitHub Topics or related entries.
