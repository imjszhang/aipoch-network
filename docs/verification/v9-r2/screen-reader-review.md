# v9-r2 实际屏幕阅读器补充记录

2026-09-13。用户最新决定停止旁白专项，不再将其作为本轮交付的强制门槛。本专项已停止，未把未完成项目写成通过；以下只保存实际取得的证据与清理结果。

## 环境与方法

- macOS 26.6.2（25G83），内置 VoiceOver 10，Firefox 155.0.1。
- 使用新建的独立 Firefox 私密窗口访问最终 Demo `http://127.0.0.1:4185/`。既有用户窗口未修改。
- 用户先确认系统辅助功能和录屏权限已开启，随后明确允许 VoiceOver 官方脚本接口。本次临时开启旁白，并将旁白实用工具“允许使用 AppleScript 来控制旁白”从原始 0 改为 1。
- 实际输出来自系统 VoiceOver 的只读 `last phrase.content`。操作使用原生 CUA 及 VoiceOver `vo cursor` / `commander`，命令名依据已安装的系统字典与 `SCRStringsToCommandsMap.scrconfig`。未调用任意文本 `output` / `say`，未把 AX 文本注入朗读。
- [voiceover-transcript.json](voiceover-transcript.json) 保留全部 35 个原始步骤、动作脚本、时间与实际朗读采样。cursor 文本只作为次级定位证据，不能替代真正朗读。短窗口以约 0.12 秒间隔读取实际最后词组；CUA 的长观察步骤另用连续监视记录。

## 实际取得的结果

| 项目 | 直接证据与范围 |
| --- | --- |
| 页首品牌与主导航 | 01–04：实际读出“链接 AIPOCH Network home”“Main navigation 导航”“链接 Explore”，以及含 Not connected、Demo、对话框弹出及折叠状态的 Open-Science 按钮。 |
| 主区与首页标题 | 07–09：实际读出“主要”、公开研究引导文字和“标题级别1 Science … Open to All”。 |
| 具名浮窗进入 | 31：由真实 VoiceOver 激活 Open-Science 控件后，立即读出“对话框 包含7个项目 标题级别2 Open-Science”。13 的原生点击也记录标题获得键盘焦点；14–16、32–33 可以在实际读屏中进入对话框并找到关闭和连接控件。 |
| Escape 返回 | 17：执行原生 Tab、Shift+Tab、Escape 后，实际读出“Open-Science — Not connected · Demo 对话框弹出 已折叠 按钮 横幅”；同次 Firefox 原生 AX 确认键盘焦点返回该按钮。快速 Tab 序列未逐项捕获全部中间焦点，因此该记录不单独证明完整焦点循环。 |
| 自动连接反馈 | 34：真实激活 Connect 后，没有移动光标或手动查找状态；实际朗读在采样开始约 342ms 时为“Open-Science: Connecting. Waiting for Open-Science to confirm this connection.”，约 783ms 时自动变为“Open-Science: Connected.”。这是独立 Demo 的连接反馈，不代表真实客户端通信。 |
| 连接后的可达入口 | 35：随后用 VoiceOver 查找下一个链接，实际读出“Your research home 链接”。未继续打开或测试引用发送。 |

步骤 10/11 的初始标签期望打开浮窗，实际误入 Explore；12 的 System Events 按键被系统以错误 1002 拒绝；18–28 包含工具窗口叠层定位和恢复。这些原记录完整保留并标记为定位或未成功尝试，不计产品验收。步骤 34 标签中的“confirmation”也是操作前期望，实际动作直接开始连接；没有发生引用发送确认。Codex 通知和 macOS WindowSharingSessionButton 叠层进入了真实最后词组记录，已单独标为无关输出并排除。

## 停止时尚未验证的范围

未继续验证真实读屏下的完整逐项焦点循环、个人首页使用、准确引用勾选/发送/回执，以及正式构建的 unavailable 状态。没有宣称这些屏幕阅读器专项通过，也没有把现有 352 项浏览器检查冒充真实读屏结果。用户决定停止该专项后，未再执行新产品测试。

最初纯 CUA 尝试无法获取 VoiceOver 字幕表面，返回 `timeoutReached`；VO-Shift-Z 未产生可用朗读归档。获授权后官方只读接口已解决实际朗读取证问题，故不再把“未授予系统权限”作为当前阻塞原因。

## 清理与最终状态

- 所有本次采样及监视脚本均已结束，没有遗留监视任务。
- “允许使用 AppleScript 来控制旁白”已恢复原始未勾选。恢复点击后的 AX 读取超时，随后直接查看该实用工具截图，明确确认该复选框为空；没有覆盖整份偏好或猜测写入偏好键。
- 系统设置最终明确显示旁白开关 `off`；进程检查确认没有运行中的 VoiceOver。此次打开的旁白实用工具及教程均已关闭。
- 独立 Demo 私密测试窗口保留；没有关闭或修改用户原窗口，没有提交或发送任何研究引用。
