# 浏览器依赖许可声明

生产构建在站点根目录生成 `third-party-notices.txt`，每个 JavaScript 输出文件保留指向它的注释。该文件随静态站点一起交付；站点根路径和 GitHub Pages 子路径构建均适用。

生成器读取最终 chunk 中 `renderedLength > 0` 的模块，按实际模块路径定位已安装包，然后写入精确版本和包根目录随附的完整 `LICENSE`、`LICENSE.md`、`COPYING`、`NOTICE`、`THIRD-PARTY-LICENSE` 等许可与声明文件。多个模块只保留一份相同包的声明，文本不截断；结果按包名及版本排序，不写入构建时间、本地路径或设计参考 HTML。

当前浏览器产物包含 React、React DOM、Scheduler、Lucide React、MiniSearch，以及 Vite modulepreload 和 Rolldown runtime 的生成代码。后两者通过明确的虚拟模块归属映射保留许可。Lucide 自带的完整许可还包含 Feather 图标的 MIT 声明；Rolldown 的 `THIRD-PARTY-LICENSE` 也随产物保留。Vite 自带许可文件包含它的其他组件声明，保留原文并不表示这些组件均进入了浏览器。

这份产物只保留第三方包随附的声明，不决定 AIPOCH 原创代码、原创目录内容或设计原件的许可。原项目 README、研究代码、数据集和设计 HTML 均不由此复制到网站。

实现使用 Vite 的构建插件接口与 Rolldown 的输出模块图；`postBanner` 在压缩之后插入注释，仍参与 chunk 文件名的内容哈希。[Vite 插件接口](https://vite.dev/guide/api-plugin.html)、[Rolldown 输出配置](https://rolldown.rs/reference/OutputOptions.postBanner)。实际接口以锁定依赖自带的 TypeScript 声明为校验依据。

`pipeline/tests/third-party-notices.test.ts` 执行实际前端构建，核验重复构建一致、根与子路径声明、完整包许可、Lucide 的 Feather 声明、Rolldown 附属声明及注释文件哈希。缺少或空白许可文件、未归属的虚拟运行时代码及仓库外未归属代码会使构建失败。升级构建工具或新增浏览器依赖时，应检查模块归属与随包许可文件是否仍完整；仅有 `package.json` 的许可名称不足以代替许可原文。
