# 第一次从 AIPOCH Network 找到单细胞分析资料

资料入门 · 2026-09-14

先写下你手上的数据与问题，例如：“我有单细胞表达矩阵，想理解细胞和基因注释如何与矩阵对应。”

1. 打开 [AIPOCH Network](https://aipoch.network/)，浏览或搜索 `AnnData`、`Scanpy`。基础浏览无需登录或安装工作台；这是产品的公开浏览范围。[产品说明](https://github.com/imjszhang/aipoch-network/blob/cd2e003542dc873e473f694d200ca9e0449323dd/README.md)
2. 阅读条目的来源、用途和信息日期，确认对象是什么。AnnData 与 Scanpy 是不同资源，不要只看名称相近就认为可以互相替换。
3. 从来源链接回到上游：可以先读 [AnnData 官方入门](https://anndata.readthedocs.io/en/stable/tutorials/notebooks/getting-started.html)，认识矩阵、细胞注释和基因注释的关系。具体安装与运行按上游文档及自己的环境核验；本稿未提供已测试的安装环境。
4. 在研究记录中写下资源 URL、实际选用版本和用途。若还缺关键输入或解释，把未知事项列出来，再决定是否需要额外模型。

本次核对已确认 AnnData、Scanpy 和 [MuData](https://aipoch.network/capabilities/resource~mudata-library/) 在正式目录中；主稿另外九项工具仍为调研候选。找不到某个名字时，可以先访问主稿给出的上游入口，不把不存在的目录结果当作已收录。想推荐新资源可从 [Network 投稿指南](https://github.com/imjszhang/aipoch-network/blob/cd2e003542dc873e473f694d200ca9e0449323dd/CONTRIBUTING.md) 开始，只提供公开 GitHub URL 即可进入候选流程，最终收录需审核。在 GitHub 确认提交需要 GitHub 账号；网站生成草稿不代表 Issue 已提交。

以上动作到“找到并理解资料”为止；没有进行连接、安装或研究执行，也不产生完成分析的回执。

完整阅读：[从单细胞表达矩阵出发，建立可复查的 Python 分析记录](python-single-cell.zh-CN.md)。
