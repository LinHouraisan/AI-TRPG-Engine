# 剩余设计文档补全方案

## 目标

以仓库现有 Markdown 文档为唯一设计基线，补全目前为空的架构、数据、AI、游戏系统和文档入口文件，使整套文档能够一致地指导后续实现，同时不绑定具体语言、框架、数据库、模型供应商或部署方式。

## 补全范围

本次补全以下 19 个空文件：

- `docs/Readme.md`；
- `docs/01-architecture/runtime.md`；
- `docs/01-architecture/context-broker.md`；
- `docs/01-architecture/memory.md`；
- `docs/01-architecture/domain-ai.md`；
- `docs/02-data/entity-model.md`；
- `docs/02-data/event-model.md`；
- `docs/02-data/relationships.md`；
- `docs/02-data/state.md`；
- `docs/02-data/save-branch.md`；
- `docs/03-ai/model-strategy.md`；
- `docs/03-ai/context-strategy.md`；
- `docs/03-ai/prompt-contracts.md`；
- `docs/03-ai/token-budget.md`；
- `docs/04-game-system/npc.md`；
- `docs/04-game-system/items.md`；
- `docs/04-game-system/rules.md`；
- `docs/04-game-system/scenario.md`；
- `docs/04-game-system/world.md`。

不修改已有产品愿景、原则、路线图和已完成架构文档的设计结论。若交叉检查发现矛盾，只在本次新增内容中调整表达；已有文档中的问题另行报告，不顺手重写。

## 文档深度

每篇文档保持现有仓库的概念设计深度，按主题选择下列内容：

- 定位与目标；
- 职责和禁止职责；
- 关键概念或逻辑对象；
- 输入、输出和标准数据流；
- 权威性、来源、版本与可见性边界；
- 生命周期、一致性要求和失败处理；
- 与其他模块的关系。

文档可以使用少量字段名说明概念边界，但不定义可直接生成代码的完整 schema，不规定 API 路径、数据库表、类签名或消息中间件。

## 补全顺序

### 1. 架构职责

先补 Runtime、Context Broker、Memory 和 Domain AI，明确回合协调、信息查询、长期记忆整理与领域分析的责任边界。后续数据与 AI 文档以这些职责为约束。

### 2. 权威数据

再补实体、事件、关系、状态、存档与分支，明确当前状态与不可变事件的分工，以及派生数据、快照和分支如何避免形成竞争事实源。

### 3. AI 策略

补模型选择、任务上下文、Prompt 契约和 Token 预算，说明逻辑 AI 与具体模型解耦、按任务构建最小上下文、结构化输出校验及预算降级顺序。

### 4. 游戏领域

补 NPC、物品、规则、剧本和世界，统一使用“不可变定义、权威运行状态、来源事件、受限视图”的表达方式，并说明各领域之间只通过已提交状态与事件协作。

### 5. 文档入口与全局检查

最后补 `docs/Readme.md`，给出按产品、架构、数据、AI 和游戏系统组织的阅读顺序。完成后检查空文件、相对链接、术语、职责归属和关键不变量。

## 全局设计约束

- GM 是玩家唯一直接接触的游戏前台。
- AI 只提出带来源的候选；候选通过验证和提交前不是事实。
- 已提交结构化状态与不可变事件是唯一权威事实源。
- 规则、随机结果、权限和原子提交由确定性程序负责。
- 正式叙事只能发生在裁定与提交之后；叙事重试不能重复裁定或提交。
- Director 不直接修改 `StoryProgress`，系统不设置独立 Story AI。
- Active Context、关系索引、领域视图和长期摘要均为可重建派生数据。
- 所有进入模型任务的信息必须满足来源、版本、分支和可见范围要求。
- 逻辑组件不等于独立模型、进程、服务或数据库。
- 当前阶段只服务 AI 主导的单人跑团，不提前设计多人同步或真人 GM 工作台。

## 各目录的内容边界

### 架构文档

描述组件为何存在、负责什么、如何协作以及在失败时由谁恢复。避免重复总体架构全文，只展开对应组件。

### 数据文档

描述权威数据、事件、派生关系、版本和时间线语义。关系索引、摘要和快照不得被描述成可以覆盖权威历史的独立事实。

### AI 文档

描述按任务选择模型与上下文的原则，以及输入输出契约和预算降级。模型能力和预算数值由实验与配置决定，不写死供应商或统一数值。

### 游戏系统文档

描述领域定义、运行状态、约束、事件和可见视图。领域模块拥有约束，不拥有脱离统一 State Store 与 Event Log 的私有事实。

## 验证标准

- 19 个目标文件均包含实质正文。
- `docs/Readme.md` 能链接到全部正式设计文档。
- 文档中不出现未解释的 Story AI、两个含义混杂的 Active Context，或 AI 直接提交状态的描述。
- Runtime、Validator、State Store、Event System、Scenario Runtime 和各领域模块的职责没有互相覆盖。
- Entity State、Event Log、Snapshot、Projection、Relationship Index、Memory 和 Active Context 的权威性边界一致。
- GM、Director、Memory 与领域 AI 的输入、输出和秘密边界一致。
- 不包含待补占位符、虚构的既定技术选型或未经现有基线支持的产品承诺。
- 相对 Markdown 链接均指向仓库中存在的文件。

## 非目标

- 不编写可执行代码、完整 schema、数据库迁移或 API 规范。
- 不选择客户端、服务端、数据库、向量检索、消息系统或模型供应商。
- 不制定性能指标、Token 固定上限、模型调用频率或发布日期。
- 不补写多人玩家、真人 GM、作者编辑器或完整内容导入实现。
- 不恢复或模仿已不存在的原产品手册措辞。
