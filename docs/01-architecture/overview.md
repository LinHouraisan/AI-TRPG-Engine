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

- **Director AI / 幕后剧本 AI**：分析剧本节点、线索覆盖、剧情停滞、替代路径和世界走向，提出剧情候选、GM 引导及高概率信息预加载提示。它不能直接推进剧情节点。
- **Information AI / 信息 AI**：解释开放语义和记忆候选，提出结构化事实变化 Proposal，并判断当前任务需要哪些人物、道具、场景、事件和记忆，输出上下文补充、排序和淘汰计划。
- **Context Broker / 信息协调器**：接收信息请求，解析实体和查询范围，执行权限过滤，查询领域视图、事件、记忆及关系索引，并返回带来源和版本的信息包。
- **Memory AI / 记忆整理 AI**：异步整理玩家输入、GM 输出、已提交事件和状态，提取关键事实候选、因果、承诺、关系变化和未解决事项，降低长期检索成本。

Information AI 不能直接操作权威数据库或 Active Context Store。数据读取、缓存写入、权限过滤、版本检查和事实提交由程序执行。Context Broker 优先采用确定性查询，只在实体消歧、语义检索或相关性判断无法可靠完成时调用模型。

程序每轮立即记录原始交互与已提交结果。Information AI 不需要等待 Memory 完成整理即可按需读取近期材料；Memory AI 不删除原始交互或事件，也不能使用摘要替代权威状态。

### 结构化事实与约束

- **NPC Domain / NPC 领域模块**
- **Item Domain / 道具领域模块**
- **Scene Domain / 场景领域模块**
- **World Domain / 世界领域模块**
- **Scenario Domain / 剧本领域模块**
- **其他后续领域模块**

这些名称表示结构化数据和约束边界，不要求对应独立 AI、服务或厚重领域对象。通用事实内核可以通过实体、组件、命令、事件和声明式约束承载领域差异；开放语义统一由 Information AI 处理。

各领域的主要边界如下：

- NPC Domain 维护正式 NPC 的位置、生死、伤势、知识、关系、目标、承诺、计划和来源。
- Item Domain 维护道具的位置、持有者、容器、数量、耐久、充能、状态效果和来源。
- Scene Domain 区分不可随意修改的 `SceneDefinition` 与由事件产生的 `SceneState`。
- World Domain 维护世界时间、地点状态、全局事件和跨场景影响。
- Scenario Domain 维护 `ScenarioNode`、触发条件、替代路线和 `StoryProgress`。

系统不设置独立的 Story AI 或各领域 Analyzer。未来剧情和世界走向建议归 Director AI，事实候选解释和临时信息管理归 Information AI，已发生交互的长期整理归 Memory AI，剧情节点及其他正式状态归确定性系统提交。

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

Turn Router 只选择处理路径，不决定行动结果。确定性事实内核通过结构化 schema、规则和必要的不变量验证器表达领域约束，Validator 负责在提交边界组织和执行这些约束。

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
- Recent Interaction Buffer / 近期原始交互缓冲

Active Context Store 保存当前回合或场景已经装载的信息。它受 Information AI 的语义判断和 Director 的预加载提示影响，但具体装载和淘汰由程序执行，并且必须满足：

- 信息来自权威状态、事件或可追源记忆；
- 信息经过可见性过滤；
- 信息带有来源和状态版本；
- 临时存储可以随时重建；
- 临时存储不构成新的事实源。

#### 恢复数据

- Snapshot / 状态快照
- Checkpoint / 检查点
- State Hash / 状态哈希

## 总体数据流

```text
Player Client
      │
      │ 玩家输入
      ▼
Turn Router
      │
      │ 选择处理路径
      ▼
Runtime / Coordinator
      │
      ├── Context Subsystem
      │   ├── Context Broker
      │   ├── Information AI
      │   └── Active Context Store
      │
      ├── Rule Engine / RNG Service
      ├── Scenario Runtime
      │
      └── Domain Modules
          ├── NPC Domain
          ├── Item Domain
          ├── Scene Domain
          ├── World Domain
          └── Scenario Domain
      │
      │ 经过校验的状态变化
      ▼
Validator / Atomic Commit
      │
      ▼
Authoritative Data
├── Current State Store
└── Immutable Event Log
      │
      ├── 已提交的公开结果 ───→ GM AI ───→ Player Client
      ├── 剧情相关事件 ───────→ Director AI
      │                              │
      │                    带来源的剧情候选
      │                              └──→ Runtime / Coordinator
      │
      ├── 原始交互与事件 ─────→ Recent Interaction Buffer
      │                              │
      │                    按需读取 ─┴──→ Information AI
      │
      └── 固定范围后台任务 ───→ Memory AI
                                     │
                           可追源的长期派生记忆
                                     └──→ Context Subsystem
```

总体数据流包含三个闭环：

1. **回合闭环**：Player Client → Runtime → Atomic Commit → GM AI → Player Client。
2. **上下文闭环**：Runtime 通过 Context Broker 请求信息，Information AI 提出选择、排序、补充和淘汰建议，程序将通过权限、版本和预算检查的数据装载到 Active Context Store。
3. **后台智能闭环**：Director AI 推演未来走向并提供剧情候选、GM 引导和预加载提示；Memory AI 对固定范围的原始交互和事件做异步整理。它们不能直接写入权威数据。
4. **冷热信息闭环**：每轮原始交互和已提交结果立即落盘，供 Information AI 按需读取；Memory 后台将其压缩为长期派生记忆，整理进度不阻塞当前回合。

回合的硬边界是先裁定并提交，后生成正式叙事。叙事失败可以根据同一已提交结果重试，但不得重复裁定、掷骰或提交事件。

## Information AI 与 Active Context 的职责边界

Information AI 决定“候选信息意味着什么”以及“哪些可选信息可能需要进入上下文”；程序决定“候选能否成为正式事实”“信息是否允许进入、如何读取以及如何写入临时存储”。

因此，Information AI 是核心智能层中的解释与管理职责，Active Context Store 是数据层中的临时数据载体，Recent Interaction Buffer 是尚未整理信息的可靠热通道。三者协作，但都不能取代权威状态和事件日志。
