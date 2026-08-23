# 《雾港末班车》测试与恢复

## 里程碑备份

- `c8405cc`：DeepSeek 诊断、默认路由与费用接口。
- `9698a8a`：桌面自由行动 GM 闭环。
- `b4ea909`：九场景、五 NPC、十五道具、十五线索和四结局资料包。
- `592fe6e`：首次使用与结局流程。
- `388a19d`：测试检查点与复制恢复。

## 游戏内测试用例

1. 开场检查点：确认 DeepSeek、调查员和剧本后开始。
2. 自由行动：复合动作只能引用可见实体，规则结果由程序提交。
3. 隐藏信息：开锁前点名合影、线路图或档案箱不得泄露。
4. 结局路径：救回沈鹭、完成循环、斩断旧线、以记忆换门。
5. 恢复：创建检查点后“复制并恢复”，来源分支保持不变。

最终人工验收必须新建战役，不使用开发测试分支。

## 2026-08-23 自动验收结果

- 单元测试：17/17；Demo 核心检查：224/224；存储检查：25/25。
- Electron：provider、persist、checkpoint、gold、content、mist-harbor E2E 全部通过。
- 真实 DeepSeek：`deepseek-v4-flash` 在模型列表中，生成与 JSON 契约均通过；打包目录与覆盖安装后各运行一次最小 smoke。
- 实际费用：客户端未返回可落账金额；共 2 次最小请求，远低于 4 元停止线，精确扣费以 DeepSeek 开放平台账单为准。
- 已安装位置：`%LOCALAPPDATA%\Programs\AI TRPG Engine\AI TRPG Engine.exe`。
- 可直接运行备份：`electron\release-manual\win-unpacked\AI TRPG Engine.exe`。
