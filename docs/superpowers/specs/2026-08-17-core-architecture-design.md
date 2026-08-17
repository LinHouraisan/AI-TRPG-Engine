# 核心架构设计

## 目标

整理 AI TRPG Engine 的核心组件与职责边界，使架构能够同时表达多 AI 协作、确定性裁决、临时上下文管理和本地单一事实源。

## 已确认的设计决策

1. Player 是外部参与者，系统组件命名为 Player Client。
2. 核心智能层使用 Active Context Manager，数据层使用 Active Context Store。
3. Active Context Manager 负责语义相关性、补充、排序和淘汰建议；程序负责实际查询、权限过滤、版本检查和缓存写入。
4. 删除独立 Story AI。剧情建议归 Director AI，世界影响归 World AI，历史因果整理归 Memory AI，正式剧情进度归 Scenario Runtime。
5. 领域 AI 不是状态所有者，只能输出带来源的候选。
6. 本地状态和不可变事件是唯一权威事实源。
7. 临时上下文、关系索引、领域视图和长期摘要均可由权威数据重建。

## 组件分层

- 交互层：Player Client、GM AI。
- 核心智能层：Director AI、Active Context Manager、Context Broker、Memory AI。
- 领域层：NPC、Item、Scene、World、Scenario Domain，以及可选的领域 AI Analyzer。
- 运行时与确定性系统：Coordinator、Turn Router、Rule Engine、RNG Service、Scenario Runtime、Validator、Visibility Policy、Event System、State Store、Save / Replay / Branch。
- 模型接入层：Model Gateway、能力登记、结构化输出适配、重试与回退、BYOK 凭据适配。
- 数据层：权威数据、派生索引、临时上下文数据和恢复数据。

完整的组件说明和标准回合数据流写入 `docs/01-architecture/overview.md`，并以该文件作为架构总览入口。

## 关键不变量

- AI 输出在验证和提交前不是事实。
- GM AI 只能根据已经提交且允许公开的结果生成正式叙事。
- Director AI 不能直接改变 StoryProgress。
- Active Context Store 不得成为权威状态的副本或竞争事实源。
- 所有进入上下文的持久信息必须具有来源、版本和可见范围。
- 相同状态、输入、规则和随机种子必须产生相同的程序裁定。
- 叙事重试不得重复规则裁定、随机判定或状态提交。

## 范围约束

本次只定义逻辑组件及其边界，不决定部署拓扑、数据库产品、模型供应商或领域 AI 的具体调用频率。早期版本不要求独立微服务、独立数据库或专用图数据库。

## 验收标准

- 架构总览中不再出现未区分的两个 Active Context。
- 架构总览中不存在独立 Story AI。
- Active Context Manager 与 Active Context Store 的职责、控制方和权威性边界明确。
- Director、World、Memory 和 Scenario Runtime 对原 Story AI 职责的承接关系明确。
- 标准回合明确遵守“先裁定并提交，后叙事”。
- 文档不暗示每个逻辑组件都是独立模型、进程或数据库。
