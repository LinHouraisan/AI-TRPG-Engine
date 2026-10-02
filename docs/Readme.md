# AI TRPG Engine 设计文档

当前 V1.0 总体设计入口是 [架构手册](ARCHITECTURE-V1.md)：Python 业务核心、薄 Electron 桌面端、单人跑团与数据标注工作台。作者制作和发布需求已退出当前版本。手册描述目标，不代表代码已实现；已实现证据见 [当前状态](CURRENT-STATUS.md)。

本目录保留既有产品、领域和模块设计用于追溯，不要求每个逻辑组件对应独立模型、进程、服务或数据库。旧文档与新手册冲突时，以当前产品范围和新手册为准。

当前核心原则是：AI 理解语义并提出带来源的候选，程序负责规则、随机、权限、校验和原子提交；已提交结构化状态与不可变事件是唯一权威事实源；正式叙事发生在裁定和提交之后。

## 推荐阅读顺序

1. 阅读 [V1.0 架构手册](ARCHITECTURE-V1.md)和 [产品路线图](00-product/roadmap.md)，理解游戏与标注的交付范围。
2. 阅读产品原则和玩家体验，理解事实权威、可见性与恢复边界。
3. 按需要查阅既有游戏、数据和 AI 逻辑设计；实际模块归属遵循新手册。
4. [旧模块实现设计](05-implementation-design/README.md)保留为历史参考，不再锁定 Electron 主进程拥有业务，也不要求交付作者工具。
5. 编写实施计划时从当前代码与手册的差距出发，分别标明迁移、新增和验证。

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
- [信息 AI 与确定性事实内核](01-architecture/domain-ai.md)

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

## 旧 V1.0 模块实现设计

以下历史草案保留可复用的约束、接口与验收素材。其部署归属、作者范围和标注设计被 [新手册](ARCHITECTURE-V1.md)替代；具体映射见 [索引](05-implementation-design/README.md)。

- [公共约定与跨模块类型](05-implementation-design/00-common-conventions.md)
- [Desktop Shell](05-implementation-design/01-desktop-shell.md)
- [IPC Contracts](05-implementation-design/02-ipc-contracts.md)
- [Persistence](05-implementation-design/03-persistence.md)
- [事件与权威状态](05-implementation-design/04-event-state.md)
- [Character 与 NPC](05-implementation-design/05-character-npc-domain.md)
- [Item](05-implementation-design/06-item-domain.md)
- [Scene 与 World](05-implementation-design/07-scene-world-domain.md)
- [Rule Engine](05-implementation-design/08-rule-engine.md)
- [Scenario Runtime](05-implementation-design/09-scenario-runtime.md)
- [Application Runtime](05-implementation-design/10-application-runtime.md)
- [AI Orchestrator](05-implementation-design/11-ai-orchestrator.md)
- [Model Providers](05-implementation-design/12-model-providers.md)
- [Context 与 Memory](05-implementation-design/13-context-memory.md)
- [Content System](05-implementation-design/14-content-system.md)
- [Player UI](05-implementation-design/15-player-ui.md)
- [Platform Security](05-implementation-design/16-platform-security.md)
- [Observability 与 Testing](05-implementation-design/17-observability-testing.md)
- [Release 与 Compatibility](05-implementation-design/18-release-compatibility.md)

此前缺失的技术基线引用不再作为实施依据；当前架构以本目录的 ARCHITECTURE-V1.md 为统一入口。

拉入本目录 05 之后到代码跟上的这一段，记在 [PRD/07-从文档对齐到现在.md](../PRD/07-从文档对齐到现在.md)。

## 文档约束

- `docs/00-product/` 到 `docs/04-game-system/` 描述逻辑职责与边界，不把每个组件拆成独立进程。
- `ARCHITECTURE-V1.md` 定义当前目标物理归属：Python 业务核心与 Electron 桌面能力。旧 `05-implementation-design/` 不再构成竞争的物理基线。
- 用户最新要求、当前产品路线图与新架构手册优先于历史草案；事实权威与非破坏性恢复原则继续有效。
- 具体字段、容量、模型调用频率和性能目标应由原型实验或后续实现规格决定。
- 若设计发生变化，应同步更新受影响文档并明确记录新的权威边界，避免让叙事、缓存、摘要或派生索引成为竞争事实源。
