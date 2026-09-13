# 工作台预览与适配边界

当前设计目标为 v9-r2，实施状态与验收证据见[本版记录](verification/v9-r2/implementation-status.md)。本项目在本仓库内构建静态网站，不需要 med-research-ai、Open-Science 源码、客户端服务、凭证或后端。

## 两种构建

| 模式 | 构建与预览 | 实际行为 |
| --- | --- | --- |
| 正式默认 | `npm run build`；`npm run preview` | `dist`；连接无法确认，保留公开浏览、获取工作台、完整手工引用 |
| 显式 Demo | `npm run build:demo`；`npm run preview:demo` | `dist-demo`；本地 4185 端口，页面持续标明 Demo，演示连接和匹配回执 |

`VITE_WORKBENCH_DEMO=true` 必须在构建进程显式设置。URL 参数、本机存储和 `.env.production` 不能把正式产物变成 Demo。相同开关决定浏览器编译常量、预生成页面和 `build-info.json`，测试检查三者一致。构建命令支持 `--output`，可保留多个候选；`SITE_BASE=/aipoch-network/` 用于项目子路径。两种模式均无实际客户端通信。

Pages 候选审阅器拒绝模式为 Demo 的新产物。演示构建不进入生产发布流程。没有实际生产发布记录之前，本地预览不能代表 aipoch.network 已更新。

## 正常试用路径

1. 打开 Demo 首页，观察宣传首页、五类真实目录数量和右上角唯一 Open-Science 控件。未连接时没有 Save 等个人操作。
2. 从 Join with Open-Science 或右上角浮窗点击 Connect Open-Science。连接后首页整体变为 Welcome back，使用五个个人栏目；没有真实项目、关注或贡献信息时显示空状态。
3. 在目录筛选项目，点击 Open；或者进入能力详情点击 Use。未连接时同一位置为 Connect，连接后继续原对象。对话框不会改变目录 URL 或自动发送。
4. 阅读完整来源、版本、许可、条件和准确引用文本，勾选确认，再发送。Demo 回执表示引用已接收，不表示项目已克隆、安装、运行或科学验证。
5. Save 后进入首页 Saved，断开、刷新、重连分别观察变化。断开保留本机记录，刷新不会恢复连接、确认或在途请求。

正式默认模式保留相同的公开页面和连接入口。连接无法确认时可以继续阅读来源、复制完整引用或前往 https://aipoch.com/open-science；页面不能推断客户端未安装。

Demo 的 `/review/` 提供显式进入的临时 Review 域，可控制无响应、失败、迟到、错配和重复回执等情况。离开或复位会销毁临时等待与会话；普通 Demo 的收藏和仍有效的连接保留，旧请求与旧确认不会复活。正式构建没有可开启模拟成功的 Review 控件。

## 代码职责和约束

| 位置 | 职责 |
| --- | --- |
| `web/src/navigation.tsx` | 原生链接兼容、站内会话连续性、URL/标题/焦点/滚动恢复 |
| `web/src/catalog-loader.ts`、`model.ts` | 首屏子图、完整目录读取、快照校验与真实对象解析 |
| `web/src/workbench/adapter.ts` | `WorkbenchAdapter`、默认不可用与本地 Demo 适配器 |
| `web/src/workbench/engine.ts` | 连接尝试、会话、内容确认、唯一请求、回执匹配及失效 |
| `web/src/workbench/reference.ts` | 基于目录事实生成完整的内部研究引用 |
| `web/src/workbench/index.tsx` | 精简浮窗、完整审阅、个人首页、Join 和 Review |
| `web/src/library/storage.ts` | 有版本的本机偏好、存储失败时内存回退、跨标签偏好更新 |
| `web/src/build-mode.ts`、`scripts/design-assets.ts` | 固定构建模式、产品素材归属和产物模式声明 |

本机偏好包含收藏、最近浏览、语言偏好和待续对象；从不持久化会话、发送确认或请求。未连接时界面隐藏个人操作，状态处理器也拒绝修改。读取损坏、未知版本或不可用存储时保留原始字节并降级为本次访问的内存，不把旧偏好解释为当前连接。

内部引用格式 `aipoch-network-internal-review-1` 只用于网站准确审阅；它不是已经发布的 Connector 线协议，也不改变 `spec/` 的通用静态目录契约。引用保留全部来源和完整适用 SHA/路径，未知、未固定和撤回分别呈现。发送资格绑定当前会话和准确内容；任意变化都必须重新审阅。

## 未来接入真实 Connector

在独立任务中实现适配器的 `connect`、`send`、`valid`、`disconnect`、`dispose`，并重新运行已有状态契约与浏览器测试。需要另外确定可信握手、兼容协商、传输、权限和真实接收的依据；当前接口不预设端口、启动协议、内部客户端类型或认证方法。

接收回调必须核对 session、request、object 和完整 content。停止等待表示本页不再承认后续响应，不表示远端操作被撤回。Received 只代表接收引用。仓库权限、GitHub 授权、导入、同步和执行由未来 AIPOCH Connector 在工作台侧处理，不能把这些界面加入 Network。

## 验证命令

`npm run check` 检查类型、通用契约、采集、消费者、本机状态、构建模式并构建正式产物；`npm run test:e2e` 验证正式模式，`npm run test:e2e:demo` 针对已构建的 `dist-demo` 验证完整演示。CI 分别构建正式和 Demo 的根路径、项目子路径，不需要运行 Open-Science。视觉、真实读屏与其他人工验收的实际覆盖范围以本版记录为准，不以自动测试推断通过。
