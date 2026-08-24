# 《雾港末班车》测试与恢复

## 里程碑备份

- `c8405cc`：DeepSeek 诊断、默认路由与费用接口。
- `9698a8a`：桌面自由行动 GM 闭环。
- `b4ea909`：九场景、五 NPC、十五道具、十五线索和四结局资料包。
- `592fe6e`：首次使用与结局流程。
- `388a19d`：测试检查点与复制恢复。

## 游戏内测试用例

1. 新建战役，恰好分完 280 职业点和 140 兴趣点，选择一项人生经历并确认调查员。
2. 关闭并重开战役，确认档案、经历和技能值不变。
3. Figure 1：在七号站台输入“查看四周，重点注意是否有可以让列车员回答问题的办法”，确认人物卡高亮侦查 87／普通 87，随后显示已提交、可追溯的检定结果。
4. Figure 2：让女孩说出“你能替我记住一个名字吗？”，输入“可以”，确认回答承接上文且没有泄露当前不可知的名字、四十八名乘客誓约或记忆燃料。
5. Figure 3：完成至少三轮玩家／GM 对话后创建检查点，再推进一轮，使用“复制并恢复”。恢复视图必须先显示检查点前情，再显示恰好最近三轮真实对话，不显示开场白和检查点后的回合。
6. 恢复后关闭并重开，确认仍进入副本分支；来源分支版本、事件和叙述保持不变。
7. 结局路径：救回沈鹭、完成循环、斩断旧线、以记忆换门。

最终人工验收必须新建战役，不使用开发测试分支。

## 2026-08-23 自动验收结果

- 单元测试：17/17；Demo 核心检查：224/224；存储检查：25/25。
- Electron：provider、persist、checkpoint、gold、content、mist-harbor E2E 全部通过。
- 真实 DeepSeek：`deepseek-v4-flash` 在模型列表中，生成与 JSON 契约均通过；打包目录与覆盖安装后各运行一次最小 smoke。
- 实际费用：客户端未返回可落账金额；共 2 次最小请求，远低于 4 元停止线，精确扣费以 DeepSeek 开放平台账单为准。
- 已安装位置：`%LOCALAPPDATA%\Programs\AI TRPG Engine\AI TRPG Engine.exe`。
- 可直接运行版本：`electron\release\win-unpacked\AI TRPG Engine.exe`。

## 2026-08-24 Task 8 自动认证结果

- 集成脚本从新建战役开始，完成完整加点、潮汐合影摄影师经历、确认后重开、Figure 1 精确检定、Figure 2 “可以”、五轮完整对话、检查点后推进、复制恢复和再次重开；Figure 3 恰好返回检查点内最近三轮，并保留前情与调查员档案哈希。
- 指定目标测试：48/48；Demo 全量单元测试：85/85；Demo smoke：234 项；typecheck 与生产构建全部通过。
- Electron `persist:check`、`checkpoint:check`、`gold`、`content:check`、`demo:e2e`、`build:main` 全部通过；gold 固定哈希为 `b6506aeb`。
- `package:win` 本轮自然完成，没有沿用或复制旧 Windows 壳。`win-unpacked\AI TRPG Engine.exe` 为 205,635,584 bytes，SHA-256 `90805338F050B877814A9E717DEF26BB135E62EEB8B277D8B98126C4C62C4DE6`。
- `AI TRPG Engine-0.1.0-win-x64.exe` 为 81,719,471 bytes，SHA-256 `7635BFA662B3F28A94A0A27ADECC549924368DAE15C916DC61D9056CA1C234C3`；同时生成 blockmap。
- 打包 exe 启动烟测产生可响应的主窗口进程（非零窗口句柄），随后只关闭本次烟测启动的进程。

## 2026-08-24 人工截图回归状态

当前执行环境只有终端和进程级能力，没有可操作 Windows 桌面并留存截图的通道，因此以下项目未执行，不能据自动脚本推定为人工通过：

- 全新战役中的调查员创建向导和人物卡视觉检查：未执行。
- Figure 1 人物卡高亮及检定尺截图：未执行。
- Figure 2 使用真实 DeepSeek 的女孩回答与视觉泄密检查：未执行。
- Figure 3 前情、三轮对话、无开场白的恢复视图截图：未执行。
- GUI 内关闭重开、点击“复制并恢复”以及来源分支视觉核对：未执行。
- GUI 内“重新创建调查员”以及战役备份导出／导入往返：未执行。

在可交互 Windows 桌面上发布前，仍须按“游戏内测试用例”从全新战役完成这一轮人工验收。

## 2026-08-24 最终审查修复自动验证

- Demo 全量单元测试 93/93，Keeper／Demo smoke 228 项；typecheck 与生产构建通过。
- 调查员开局门禁、不可变绑定、正式开局前重建、严格 IPC、备份往返与篡改拒绝、对话保存竞态、披露权限和流式 UI 隔离回归均通过。
- Electron `persist:check`、`checkpoint:check`、`content:check`、`demo:e2e` 与 `build:main` 通过；`gold` 连续三次均为 `b6506aeb`。
- `package:win` 自然完成。`win-unpacked\AI TRPG Engine.exe` 为 205,635,584 bytes，SHA-256 `7F024682109CAF008581D5525DF98A69DCC1799C2B9FBBA48CC057A85FF3F7C1`。
- `AI TRPG Engine-0.1.0-win-x64.exe` 为 81,738,702 bytes，SHA-256 `70782E5CB1B3224F9DD67420A1923274AC907AD21431F21C68143594FBFB1902`；blockmap 为 87,513 bytes。
- 隐藏窗口启动烟测得到 4 个响应进程并在隔离用户目录创建战役数据库，随后只结束本次进程并清理目录。隐藏启动没有可用窗口句柄，因此这只是进程级烟测，不是 GUI 或截图认证。
- 本轮没有可交互 GUI 输入或真实 DeepSeek 凭据权限；人工截图与真实 DeepSeek 项仍保持“未执行”。
