# 总体架构

## 设计原则

AI TRPG Engine 采用“AI 提出候选，确定性系统提交事实”的架构。

- 本地已提交状态和不可变事件是唯一权威事实源。
- AI 组件只能读取经过授权的视图并输出带来源的结构化候选。
- 规则裁定、随机结果、权限检查和状态提交由程序负责。
- 临时上下文、关系索引、摘要和领域视图均为可重建数据。
- 下列组件表示逻辑职责，不一定对应独立模型、进程或数据库。

## 核心组件

### 交互层

- **Player Client / 玩家前台**：接收玩家输入，显示 GM 叙事、建议行动、检定结果和异常提示。
- **GM AI / 前台主持人 AI**：理解玩家表达，根据已经提交的公开结果生成叙事和下一步建议行动。

GM AI 不能直接修改权威状态，也不能把未经验证的候选变化描述为既成事实。

### 核心智能层

- **Director AI / 幕后剧本 AI**：分析剧本节点、线索覆盖、剧情停滞和替代路径，向运行时提出剧情候选。它不能直接推进剧情节点。
- **Active Context Manager / 临时信息管理器**：判断当前局面需要哪些人物、道具、场景、事件和记忆，提出上下文补充、排序和淘汰建议。
- **Context Broker / 信息协调器**：接收信息请求，解析实体和查询范围，执行权限过滤，查询领域视图、事件、记忆及关系索引，并返回带来源和版本的信息包。
- **Memory AI / 记忆整理 AI**：按场景结束、累计回合、存档操作或后台任务整理关键事件、因果、承诺、关系变化和未解决事项。

Active Context Manager 可以使用模型判断语义相关性，但不能直接操作权威数据库。数据读取、缓存写入、权限过滤和版本检查由程序执行。Context Broker 优先采用确定性查询，只在实体消歧、语义检索或相关性判断无法可靠完成时调用模型。

Memory AI 不删除原始事件，也不能使用摘要替代权威状态。

### 领域层

- **NPC Domain / NPC 领域模块**
- **Item Domain / 道具领域模块**
- **Scene Domain / 场景领域模块**
- **World Domain / 世界领域模块**
- **Scenario Domain / 剧本领域模块**
- **其他后续领域模块**

每个领域模块可以包含结构化状态、领域约束、查询视图、确定性处理逻辑和可选的 AI Analyzer。领域 AI 只能提出带来源的候选，不能直接增删改权威数据。

各领域的主要边界如下：

- NPC Domain 维护正式 NPC 的位置、生死、伤势、知识、关系、目标、承诺、计划和来源。
- Item Domain 维护道具的位置、持有者、容器、数量、耐久、充能、状态效果和来源。
- Scene Domain 区分不可随意修改的 `SceneDefinition` 与由事件产生的 `SceneState`。
- World Domain 维护世界时间、地点状态、全局事件和跨场景影响。
- Scenario Domain 维护 `ScenarioNode`、触发条件、替代路线和 `StoryProgress`。

系统不设置独立的 Story AI。未来剧情建议归 Director AI，世界层面的影响归 World AI，已发生事件的因果整理归 Memory AI，剧情节点的正式状态归确定性的 Scenario Runtime。

### 运行时与确定性系统

- **Coordinator / Game Runtime**：协调一次回合的完整生命周期。
- **Turn Router / 回合路由器**：在纯角色扮演、结构化建议行动、简单自由行动快路径、复杂机械行动和澄清路径之间进行选择。
- **Rule Engine / 规则引擎**：依据结构化 Rule Pack 执行规则。
- **RNG Service / 随机服务**：生成并记录随机种子、骰式和随机结果。
- **Scenario Runtime / 剧本运行时**：确定性地检查剧情节点的前置、解锁、完成、失败、替代路径和不可逆结果。
- **Validator / 校验系统**：组织 schema、领域不变量、前后值、事件来源、状态版本、权限边界和提交完整性校验。
- **Visibility Policy / 信息权限系统**：控制玩家、NPC、GM 和幕后信息的可见范围。
- **Event System / 事件系统**：定义、发布和处理领域事件。
- **State Store / 状态存储服务**：读取和原子提交当前权威状态。
- **Save / Replay / Branch**：负责检查点、事件重放、分支、纠正事件和状态哈希校验。

Turn Router 只选择处理路径，不决定行动结果。具体领域约束归对应的领域模块所有，Validator 负责在提交边界组织和执行这些约束。

### 模型接入层

- **Model Gateway / 模型网关**
- **Model Capability Registry / 模型能力登记**
- **Structured Output Adapter / 结构化输出适配**
- **Retry / Timeout / Fallback**
- **BYOK Credential Adapter**

模型接入层将逻辑 AI 角色与具体供应商解耦。多个逻辑 AI 可以共享同一模型，同一个逻辑 AI 也可以按任务切换模型；业务层不直接依赖特定供应商。

### 数据层

#### 权威数据

- Entity State / 实体当前状态
- Event Log / 不可变事件日志
- Rule Decision Records / 规则裁定记录
- Branch Metadata / 分支元数据

#### 关系与派生数据

- Domain Projections / 领域视图
- Relationship / Link Index / 关系索引
- Search Index / 检索索引

关系索引用于发现相关实体和事件，但不是独立事实源。早期版本不要求引入专用图数据库。

#### 临时上下文数据

- Active Context Store / 临时上下文存储
- Pending Context Requests / 待补充信息请求
- Context Source References / 上下文来源引用

Active Context Store 保存当前回合或场景已经装载的信息。它受 Active Context Manager 的语义判断影响，但具体装载和淘汰由程序执行，并且必须满足：

- 信息来自权威状态、事件或可追源记忆；
- 信息经过可见性过滤；
- 信息带有来源和状态版本；
- 临时存储可以随时重建；
- 临时存储不构成新的事实源。

#### 恢复数据

- Snapshot / 状态快照
- Checkpoint / 检查点
- State Hash / 状态哈希

## 标准回合数据流

```text
Player Client
    ↓ 玩家输入
Turn Router
    ↓ 选择处理路径
Coordinator / Game Runtime
    ├─→ Context Broker → 权威数据、领域视图、记忆和关系索引
    │                         ↓
    │                 Active Context Manager
    │                         ↓ 选择、排序和淘汰建议
    │                 Active Context Store
    ├─→ Rule Engine + RNG Service
    ├─→ 相关领域模块与可选 AI Analyzer
    ├─→ Scenario Runtime
    └─→ Validator + Visibility Policy
              ↓
        原子提交状态和事件
              ↓
          刷新派生视图
              ↓
            GM AI
              ↓
        叙述结果并交出行动权
```

回合的硬边界是先裁定并提交，后生成正式叙事。叙事失败可以根据同一已提交结果重试，但不得重复裁定、掷骰或提交事件。

## Active Context 的职责边界

Active Context Manager 决定“哪些信息可能需要进入上下文”；程序决定“这些信息是否允许进入、如何读取以及如何写入临时存储”。

因此，Active Context Manager 是核心智能层中的管理职责，Active Context Store 是数据层中的临时数据载体。两者协作，但都不能取代权威状态和事件日志。
