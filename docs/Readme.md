# AI TRPG Engine 设计文档

本目录记录 AI TRPG Engine 的产品目标、逻辑架构、权威数据、AI 协作策略和游戏领域边界。文档用于形成后续原型与实现的共同设计基线，不表示每个逻辑组件都必须部署为独立模型、进程、服务或数据库。

当前核心原则是：AI 理解语义并提出带来源的候选，程序负责规则、随机、权限、校验和原子提交；已提交结构化状态与不可变事件是唯一权威事实源；正式叙事发生在裁定和提交之后。

## 推荐阅读顺序

1. 先阅读产品愿景、原则和玩家体验，理解产品承诺与非目标。
2. 阅读总体架构和游戏循环，建立组件与标准回合的全局认识。
3. 按需要深入 GM、Director、上下文、Runtime 与 Memory 等组件。
4. 阅读数据文档，理解状态、事件、关系、存档与分支的权威性边界。
5. 阅读 AI 策略和具体游戏领域文档，为原型或实现设计提供约束。

## 产品

- [产品愿景](00-product/vision.md)
- [核心设计原则](00-product/principles.md)
- [玩家体验](00-product/player-experience.md)
- [产品路线图](00-product/roadmap.md)

## 架构

- [总体架构](01-architecture/overview.md)
- [游戏循环与回合路由](01-architecture/game-loop.md)
- [Runtime 与回合协调](01-architecture/runtime.md)
- [GM AI](01-architecture/gm.md)
- [Director](01-architecture/director.md)
- [Active Context](01-architecture/active-context.md)
- [Context Broker](01-architecture/context-broker.md)
- [Memory AI](01-architecture/memory.md)
- [领域 AI 与确定性领域模块](01-architecture/domain-ai.md)

## 数据

- [实体模型](02-data/entity-model.md)
- [事件模型](02-data/event-model.md)
- [关系与链接](02-data/relationships.md)
- [权威状态](02-data/state.md)
- [保存、重放、回滚与分支](02-data/save-branch.md)

## AI 策略

- [模型策略](03-ai/model-strategy.md)
- [任务上下文策略](03-ai/context-strategy.md)
- [Prompt 与输出契约](03-ai/prompt-contracts.md)
- [Token 预算](03-ai/token-budget.md)

## 游戏系统

- [NPC 系统](04-game-system/npc.md)
- [道具系统](04-game-system/items.md)
- [规则系统](04-game-system/rules.md)
- [剧本系统](04-game-system/scenario.md)
- [世界系统](04-game-system/world.md)

## V1.0 模块实现设计

以下文档把已确认的产品、逻辑架构和技术基线细化到模块接口、SQLite DDL、状态机、错误码、测试与验收要求：

- [模块实现设计索引](05-implementation-design/README.md)
- [公共约定与跨模块类型](05-implementation-design/00-common-conventions.md)
- [Desktop Shell](05-implementation-design/01-desktop-shell.md)
- [IPC Contracts](05-implementation-design/02-ipc-contracts.md)
- [Persistence](05-implementation-design/03-persistence.md)
- [事件与权威状态](05-implementation-design/04-event-state.md)
- [Application Runtime](05-implementation-design/10-application-runtime.md)
- [AI Orchestrator](05-implementation-design/11-ai-orchestrator.md)
- [Content System](05-implementation-design/14-content-system.md)
- [Player UI](05-implementation-design/15-player-ui.md)
- [测试与发布](05-implementation-design/17-observability-testing.md)

## 文档约束

- 文档描述逻辑职责与边界，不提前锁定技术栈和部署拓扑。
- 已确认的产品原则与总体架构优先于局部候选方案。
- 具体字段、容量、模型调用频率和性能目标应由原型实验或后续实现规格决定。
- 若设计发生变化，应同步更新受影响文档并明确记录新的权威边界，避免让叙事、缓存、摘要或派生索引成为竞争事实源。
