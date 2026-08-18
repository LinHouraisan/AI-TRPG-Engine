# AI TRPG Engine V1.0 技术设计

## 1. 文档目的

本文定义 AI TRPG Engine V1.0 的工程实现基线。它把现有产品、逻辑架构、数据和游戏系统文档落实为可开发的桌面产品架构，并明确进程边界、模块职责、数据权威性、模型接入、内容格式、恢复策略、测试方法和交付顺序。

本文不替代具体功能的实现计划、数据库迁移脚本或内容格式参考手册。后续实现计划必须遵守本文的依赖方向与权威数据边界。

## 2. 背景与设计目标

此前 Demo 使用 Tauri 2、Rust 和内置 SQLite，已经验证以下产品能力可行：

- GM 主持界面；
- 短剧本导入；
- SQLite 本地数据；
- 基础骰子与玩家属性；
- 由本地代跑模型驱动的游戏流程。

放弃该实现的主要原因不是产品路线失败，而是 Rust 技术栈提高了单人维护压力和开源贡献门槛。V1.0 改用 Electron、TypeScript 和 SQLite，使绝大多数产品业务代码使用 TypeScript，并优先保证开源协作、可理解性和长期维护成本。

V1.0 的目标是交付完整的 AI 主导单人 TRPG 桌面产品：普通用户能够安装、配置模型、导入内容、创建战役、持续游玩、保存、恢复、回滚和分支；规则结果、随机过程和关键状态变化可追溯；模型或应用失败不会静默破坏战役。

## 3. 范围

### 3.1 V1.0 包含

- Windows x64 桌面客户端；
- React GM 主持桌与战役管理；
- SQLite 权威状态、事件日志、快照、备份和迁移；
- 自由行动理解、确定性规则裁定、原子提交和提交后叙事；
- 多供应商原生模型适配与 OpenAI-compatible 自定义接口；
- 玩家自行部署的本地模型接口接入；
- 普通文字卡、轻量冒险、Scenario Pack 和 Rule Pack；
- 内容导入、校验、安装和诊断；
- Active Context、长期记忆、Director 和成本控制；
- Windows 安装、签名、自动更新、日志和故障恢复；
- 内容校验与打包 CLI。

### 3.2 V1.0 不包含

- 多人网络功能、房间、服务器或同步协议；
- 真人 GM 工作台；
- 可视化作者工具；
- 插件市场或任意代码插件；
- Electron 内置的模型下载、CUDA、Python 或推理环境管理；
- macOS 正式构建、签名、测试或发布；
- 云同步和官方内容商店；
- 对所有规则、模型和文字卡格式的完全兼容。

多人只保留低成本、不可逆的数据语义：`actorId`、`controllerId`、`audience`、稳定事件顺序和乐观版本控制。当前只有一个本地玩家控制者，不为低概率的多人需求预建基础设施。

### 3.3 平台策略

V1.0 仅正式支持 Windows x64。TypeScript 业务逻辑、存档和内容格式不得依赖 Windows 专属路径或文件语义。Windows 密钥、路径、更新和系统集成集中在 `platform` 适配层。未来只有在稳定的 macOS 维护者加入后，才增加 macOS 构建、签名、公证、arm64 测试和正式发行。

## 4. 总体架构

采用 Electron 模块化单体。Electron 主进程承载可信后端、游戏运行时、模型协调和 SQLite 访问；Renderer 只负责 UI。首版不引入本地 HTTP 后台服务、独立 Runtime 进程或微服务。

```text
React Renderer
      │ 白名单、类型化 IPC
      ▼
Preload + IPC Handlers
      │ schema、版本和权限检查
      ▼
Application Services
├─ Game Runtime
├─ AI Orchestrator
├─ Content Services
├─ SQLite Repositories
└─ Platform Adapters
```

模块保持可迁移接口。如果未来某项 CPU 密集任务需要隔离，可以迁移到 Worker 或 Electron Utility Process，而不改变 Renderer 用例接口。当前不为这种可能性增加跨进程 RPC。

### 4.1 核心原则

- AI 提出带来源的候选，确定性程序提交事实；
- 当前状态和不可变事件共同构成权威数据；
- 正式叙事发生在裁定和提交之后；
- 所有权威写入经过 Application Service 和单个 SQLite 事务；
- Renderer、缓存、摘要、关系索引和 Active Context 都不是事实源；
- 内容包是数据，不是可执行插件；
- 慢操作不得持有 SQLite 写事务；
- 先实现可运行纵向切片，不横向铺开全部模块后再集成。

## 5. 进程与安全边界

### 5.1 Renderer

Renderer 负责页面、输入、流式展示和纯 UI 状态。它不得直接：

- 加载 Node.js 模块；
- 打开 SQLite；
- 读取任意文件；
- 获取或解密 API Key；
- 调用云端或本地模型；
- 修改战役权威状态。

窗口必须启用 `contextIsolation`，禁用 `nodeIntegration`，使用 Electron 沙箱和严格 CSP。主界面不加载远程网页。

### 5.2 Preload 与 IPC

Preload 只暴露按业务用例命名的白名单 API，例如：

```ts
campaign.create(input)
campaign.open(input)
turn.submitPlayerAction(input)
turn.cancelOperation(input)
content.importPackage(input)
model.testConnection(input)
settings.updateProvider(input)
```

禁止暴露通用 `invoke(channel, payload)`、任意 SQL、任意文件读取或任意 Provider 请求。IPC 请求和响应使用共享 Zod schema 做运行时校验。TypeScript 类型不代替边界校验。

长任务返回 `operationId`。进度事件分批发送，不按每个 token 发送一次 IPC。取消仅作用于尚未提交的工作；已经提交的事实不得因 UI 取消而撤销。

### 5.3 Application Service

Application Service 是写操作唯一入口。每个用例负责校验命令、加载指定版本、协调领域或 AI、校验候选、原子提交，并返回新 `stateVersion`。Renderer 不得通过组合多个低层调用模拟事务。

## 6. 仓库结构与依赖方向

```text
apps/
  desktop/
    src/main/
    src/preload/
    src/renderer/
  content-cli/

packages/
  application/
  game-core/
  rule-engine/
  scenario/
  content/
  ai-core/
  ai-providers/
  persistence/
  contracts/
  platform/
  test-support/

docs/
  architecture/
  content-format/
  provider-support/
  development/

tests/
  fixtures/
  replay/
  e2e/
```

只有拥有清晰接口和独立测试价值的边界才建立 workspace package，不为每个实体创建包。

依赖方向如下：

```text
apps/desktop
  ↓
application
  ↓
game-core ← rule-engine / scenario
  ↑
persistence / ai-providers / platform
        实现核心定义的接口
```

约束：

- `game-core` 不依赖 Electron、React、SQLite 或供应商 SDK；
- `application` 协调核心接口，不依赖具体适配实现；
- `persistence` 实现 Repository 和事务接口；
- `ai-providers` 实现模型网关接口；
- `platform` 实现 Windows 系统接口；
- `desktop/main` 是组合根；
- `desktop/preload` 只依赖公开 IPC contracts；
- `desktop/renderer` 只依赖 UI 库和公开 contracts；
- import boundary 由 ESLint 规则检查。

`contracts` 只保存跨边界 DTO、IPC schema、进度事件、稳定错误代码、内容 manifest 和 Provider 能力，不复制所有内部领域对象。

## 7. 领域模型与回合运行时

### 7.1 领域模块

V1.0 包含 Character/NPC、Item、Scene、World、Scenario 和 Rules 六个核心领域。每个领域拥有自己的状态 schema、命令、不变量和事件生成逻辑。

领域模块不调用模型、SQLite、Electron 或 UI。Validator 组织 schema、权限、版本、引用和各领域不变量检查，但不重复拥有领域规则。

### 7.2 数据语义

系统明确区分：

- Command：玩家或系统希望执行的动作；
- Candidate：AI 对意图、目标或变化的结构化建议；
- Decision：规则引擎产生的确定性裁定；
- Event：经过校验且已经发生的事实；
- State：当前分支所有已提交事实的结果。

AI 输出即使符合 JSON schema，也只能进入 Candidate 层。Candidate 必须通过规则、来源、权限、版本和领域语义检查后才能转为 Event。

### 7.3 回合状态机

```text
received
  → needs_clarification
  → preparing_context
  → interpreting
  → adjudicating
  → awaiting_commit
  → committed
  → narrating
  → completed
```

失败状态按阶段区分：`context_failed`、`interpretation_failed`、`validation_failed`、`commit_failed`、`narration_failed` 和 `cancelled`。

- 提交前失败可以重新构建 Candidate，不产生事实；
- 提交失败使用相同 `turnId` 重试事务；
- 提交后叙事失败只重试叙事；
- 应用崩溃后从持久化回合状态恢复；
- 用户取消不能撤销已经提交的事实。

标准回合：

```text
玩家输入
 → IPC 校验并创建 turnId
 → 读取 branchId + stateVersion 快照
 → 构建可见上下文
 → 解释行动并生成 Candidate
 → Rule Engine 与 RNG 裁定
 → 领域和 Scenario 校验
 → SQLite 原子提交
 → 产生新 stateVersion
 → GM 读取提交结果并生成正式叙事
 → Renderer 流式展示
```

UI 明确动作、明确掷骰和无状态角色扮演可以走快路径。无法确定目标、风险或重要意图时进入澄清路径。Turn Router 只选择路径，不决定结果。

### 7.4 Rule Pack 与 RNG

Rule Pack 使用声明式 JSON 描述属性、派生值、资源、骰式、检定、条件、效果和回合阶段。包内禁止 JavaScript、WASM、PowerShell 和外部程序。复杂能力通过项目审核的内置操作符表达；无法表达的规则应明确标为不完全兼容，不能让 AI 任意裁定机械结果。

骰式由项目 AST 解析，不使用 `eval`。RNG 记录算法版本、种子、骰式、原始结果、修正项、最终结果、`turnId` 和 Decision ID。同一 Decision 重试不得重新生成随机数。

### 7.5 Scenario Runtime

Scenario Pack 声明剧情节点、条件、线索和替代路线。Director 可以提出推进建议，Scenario Runtime 必须确定性检查前置、事件、冲突、完成或失败状态、回退约束和内容版本。剧情进度只由正式事件改变。

### 7.6 后台任务

Memory、摘要、索引和关系投影在回合提交后执行。任务读取固定的 `branchId + stateVersion`，产物保存来源和生成版本，可以重试，失败不阻止下一回合，也不能修改已发生事实。过期结果丢弃或重建。

任务初期存放在 SQLite `background_jobs` 表中，由应用启动时恢复。不引入 Redis、外部队列或独立服务。

## 8. SQLite 与权威数据

### 8.1 持久化策略

采用“当前状态 + 不可变事件日志”的混合模型，不采用纯事件溯源。当前状态支持快速查询，事件用于审计、恢复、重放和解释来源；两者在同一个 SQLite 事务内提交。快照缩短恢复时间，派生索引可以重建。

使用 `better-sqlite3`，并将驱动限制在 `persistence` 包内。同步 API 只执行短查询和短事务；模型调用、文件解析、摘要、压缩和大型索引不得在写事务中进行。

### 8.2 文件组织

每个战役一个数据库文件：

```text
userData/
  settings.sqlite
  campaigns/
    <campaign-id>/
      campaign.sqlite
      imports/
      attachments/
      backups/
```

部署时的实际用户可见目录由第 14 节的平台布局决定。逻辑上，全局设置与战役运行数据必须分离。API Key 不写入任何战役数据库。

### 8.3 核心表

```text
campaign_metadata
branches
turns
events
state_entities
rule_decisions
snapshots
checkpoints
content_bindings
schema_migrations

memory_entries          派生
relationship_index      派生
search_documents        派生
background_jobs         可恢复任务
```

稳定标识、排序、关联和版本使用普通列；可演进领域数据存放在经 schema 校验的 JSON 中。高频过滤字段可以投影为列或索引表，但不为内容包动态修改数据库结构。

关键约束包括：

- `events(branch_id, sequence)` 唯一；
- 同一 `turn_id` 的提交只能成功一次；
- `state_entities` 更新带预期 revision；
- `branches.head_state_version` 是提交比较点；
- 每个已提交状态变化必须关联事件或初始化来源。

### 8.4 原子提交

一次事务按顺序：

1. 检查分支头等于预期 `stateVersion`；
2. 插入 Rule Decision；
3. 插入不可变事件；
4. 更新受影响的当前实体状态；
5. 更新 Story Progress 和分支头；
6. 把 Turn 标记为 `committed`；
7. 提交。

任何一步失败全部回滚。模型调用和正式叙事发生在事务外。

### 8.5 存档、检查点与分支

保存操作创建命名检查点，指向 `branchId`、`stateVersion`、事件序号、可选快照及内容和规则版本，不复制整个数据库。

从旧检查点继续时创建新分支，不删除之后的历史。删除分支是显式用户操作并经过可恢复回收流程。旧分支事件通过父分支和 fork 序号继承，具体查询实现必须避免复制全部历史。

### 8.6 快照与恢复

快照保存规范化状态、对应版本和哈希。恢复时：

1. 载入最近可信快照；
2. 校验快照哈希；
3. 重放后续事件；
4. 比较最终状态哈希；
5. 失败时回退到更早快照；
6. 仍失败时只读打开并提供诊断和备份恢复。

修复历史使用更正事件、迁移或新分支，普通运行不得原地编辑历史事件。

### 8.7 版本与迁移

区分：

- `databaseSchemaVersion`：SQLite 表结构；
- `domainSchemaVersion`：事件与实体 JSON；
- `contentFormatVersion`：Scenario Pack、Rule Pack 等格式。

迁移按版本单向执行，执行前创建备份，在事务中完成，并记录迁移 ID、应用版本和时间。失败时保留原文件。仓库必须用真实旧版本 fixture 测试升级。

新版应用可以升级旧存档；旧版应用遇到新版存档时拒绝写入，并尽可能提供只读检查。不承诺数据库降级。

### 8.8 SQLite 运行参数

- `journal_mode = WAL`；
- `foreign_keys = ON`；
- 设置有限的 `busy_timeout`；
- 启动时做轻量完整性检查；
- 正常关闭和重要检查点执行 WAL checkpoint；
- 使用 SQLite 在线备份，不复制正在写入的数据库文件。

## 9. AI 任务与模型网关

### 9.1 任务目录

V1.0 使用有限且版本化的逻辑任务：

```text
gm.interpret_action
gm.narrate_result
director.analyze_progress
context.rank_relevance
memory.extract
memory.summarize
content.import
content.validate
```

每个任务定义输入和输出 schema、Prompt 版本、最低模型能力、超时、重试、上下文和输出预算、降级策略、是否阻塞回合以及日志脱敏策略。业务代码调用任务，不直接拼接供应商请求。

### 9.2 配置与路由

用户可以建立多个供应商实例和模型配置。任务路由支持全局默认、GM 解释、GM 叙事、Director、Memory 和内容导入的独立模型映射，并提供质量、速度和成本预设。

战役记录任务实际使用的供应商类型、模型 ID 和 Prompt 版本用于诊断，但不保存 API Key。切换模型只影响未来调用，不修改历史事实。

### 9.3 Provider Adapter

Provider Adapter 统一输出：

```text
response.started
text.delta
tool.call
usage.updated
response.completed
response.failed
```

统一请求包含消息、结构化上下文、JSON Schema、工具声明、通用生成参数、取消信号和任务 ID。供应商特有参数仅存在于适配器配置，不渗入领域代码。

能力模型至少描述：`streaming`、`structuredOutput`、`toolCalling`、`vision`、`reasoning`、`contextWindow` 和 `maxOutput`。运行前做能力匹配，不满足任务下限时立即提示。

### 9.4 支持等级

V1.0 计划认证支持 OpenAI、Anthropic、Gemini、DeepSeek、通义千问、火山方舟和 Ollama，并提供 OpenAI-compatible 自定义适配器。

“认证支持”表示拥有契约测试和发布前人工冒烟测试；“可配置”不表示所有模型都能可靠完成 TRPG 任务。认证列表可以在实现阶段按测试资源分批启用，但 V1.0 发布清单必须准确反映实际通过测试的范围，不得显示未验证的认证标志。

本地模型由玩家部署并开放 HTTP 接口。应用负责连接、模型发现、能力检测和失败处理，不负责安装运行时、下载权重或管理驱动。默认推荐环回地址；局域网或公网地址必须明确提示风险，公网使用 HTTPS 和认证。

### 9.5 结构化输出

Candidate 任务依次优先使用原生 Structured Output、JSON mode、Prompt 约束 JSON。无论供应商声称何种能力，结果都必须再次通过本地 schema 和领域语义校验。修复重试仍失败时停止，不从残缺文本猜测状态变化。

GM 正式叙事绑定 `turnId`、已提交 `stateVersion`、公开事件和当前可见状态。

### 9.6 失败与重试

限流、短暂网络错误和可恢复流中断允许有限自动重试。认证失败、余额不足、模型不存在和持续 schema 失败不无限重试。模型调用使用幂等本地任务 ID，但 UI 必须说明远端重试可能重复计费。

## 10. 上下文与长期记忆

### 10.1 Context Broker

AI 任务不得直接查询整个数据库。任务声明当前场景、行动者、目标、相关事件、适用规则、公开剧情和未解决承诺等信息需求。Context Broker 解析实体、读取权威状态和事件、应用可见性、加入可追源记忆、按预算裁剪，并返回 Context Package。

上下文条目至少包含内容、来源类型和 ID、来源版本、可见范围、相关性理由及 Token 估算。AI 可以建议相关性排序，不能绕过可见性或读取隐藏事实。

### 10.2 Active Context

Active Context 保存当前场景的可重建工作集，包括活跃角色、地点、道具、最近行动、目标、威胁和短期状态。条目过期或版本落后时刷新。删除 Active Context 不影响战役正确性。

### 10.3 长期记忆

长期记忆是事件派生索引，可以表达重要事实、因果、承诺、关系变化、未解决问题、场景摘要和阶段摘要。每条记忆必须引用来源事件。

Memory AI 可以合并、降权或标记冲突，不能删除原事件或覆盖当前状态。冲突优先级为：

```text
当前状态 > 原始事件 > 结构化记忆 > 摘要 > 叙事文本
```

### 10.4 Token 与成本

每次调用记录任务、Provider、模型、Prompt 版本、输入输出 Token、延迟、重试、缓存和估算费用，不记录普通日志不需要的完整敏感正文。

预算包含单任务、单回合和用户提醒阈值。超出预算时依次裁剪低相关上下文、使用摘要、降低后台任务频率、延迟非关键任务并提示用户；不得静默换用未经授权的模型。

## 11. 内容体系

### 11.1 内容等级

- 普通文字卡：角色描述、开场白、示例对话和可选世界书，只保证角色互动；
- 轻量冒险：增加场景、目标、NPC、道具和少量结构化状态；
- Scenario Pack：包含正式实体、剧情节点、线索、场景、资源、兼容声明和 Rule Pack 绑定。

等级根据实际能力判定。AI 补充内容必须标明 `generated`，不能伪装成原作者事实。

### 11.2 包格式

Scenario Pack 和 Rule Pack 使用 ZIP 容器及独立扩展名：`.scenario-pack`、`.rule-pack`。权威结构化内容使用 JSON，不同时支持多种等价权威语法。

`manifest.json` 至少声明包 ID、版本、格式版本、名称、作者、许可证、内容等级、语言、入口、依赖、引擎能力、资源清单和哈希。包 ID 发布后保持稳定。

### 11.3 导入流水线

```text
选择文件
 → 解压到隔离临时目录
 → 路径、数量、大小和解压倍率检查
 → manifest 与哈希校验
 → 格式迁移
 → schema 校验
 → 引用、依赖和语义校验
 → 导入报告
 → 用户确认
 → 写入内容库
```

禁止绝对路径、路径穿越、可执行文件和脚本。校验实体 ID、引用、节点可达性、循环依赖和 Rule Pack 兼容性。报告区分阻断错误、可运行警告、改进建议和 AI 补充。

文字卡、世界书和纯文本使用独立 importer，输出统一中间模型并记录原字段、映射、未知字段、冲突、AI 补充和原文件哈希。内容中的 Prompt 和示例对话不可信，不能覆盖应用安全规则。

### 11.4 内容绑定与更新

全局内容库存放已安装包。创建战役时绑定包 ID、精确版本、哈希和必要快照，不跟随全局最新版静默变化。升级进行中的战役需要显式迁移和用户确认；没有迁移则继续使用旧版本。

用户修改不覆盖原包，而创建本地派生版本。删除全局包不得破坏已有战役。

### 11.5 资源安全

允许经过检查的 PNG、JPEG、WebP、受限音频、Markdown 和 JSON。SVG、HTML 或其他可能嵌入脚本的格式不直接作为可信 UI 内容加载。资源通过受控内部协议读取，并校验真实 MIME、大小、分辨率和时长。

### 11.6 作者能力边界

V1.0 玩家本体只提供内容导入、安装、查看和诊断，不包含 NPC 编辑器、节点图、规则设计器或作者草稿数据库。

`content-cli` 提供校验和打包能力。未来若开发可视化作者工具，必须作为独立 `apps/author-studio` 构建，复用内容和规则包，但不进入玩家安装包。

## 12. 玩家端信息架构

### 12.1 首页与战役管理

首页支持新建、继续、导入、恢复、分支和回收站。新建流程为：

```text
选择内容
 → 查看能力与兼容性
 → 选择或创建角色
 → 选择规则
 → 检查模型配置
 → 创建战役
```

缺失必需内容、规则或模型时不进入游戏。

### 12.2 GM 主持桌

主持桌采用中心叙事、两侧辅助信息的三栏布局：

```text
┌──────────────┬────────────────────────┬──────────────┐
│ 场景与角色   │ GM 叙事与玩家输入      │ 当前状态     │
│ 当前场景     │ 叙事历史               │ 角色属性     │
│ 在场 NPC     │ 检定与事件卡片         │ 状态效果     │
│ 地点与线索   │ 建议行动与自由输入     │ 道具与任务   │
└──────────────┴────────────────────────┴──────────────┘
```

左右栏可折叠，中心区保持主交互地位。叙事流明确区分 GM 正式叙事、玩家输入、规则裁定、状态变化、澄清请求和系统错误。模型生成中的临时文本不得提前进入正式记录。

### 12.3 时间线

时间线展示回合、骰子、状态变化、物品、场景、剧情检查点和分支。普通模式使用玩家语言；高级诊断模式显示事件 ID、来源和版本。从旧点继续使用“从这里继续”等产品语言创建新分支。

### 12.4 内容库

内容库支持导入、能力等级、依赖、版本、作者、许可证、错误警告、更新和安全卸载，不包含内容编辑功能。

### 12.5 设置中心

设置包含供应商实例、模型与任务映射、本地接口、外观、辅助功能、存储、备份、日志、网络、代理、隐私、更新和高级诊断。

供应商实例允许同一供应商存在多个账号或 Base URL。支持连接测试、模型列表、能力探测、测试请求、延迟和错误展示。API Key 默认不回显完整值。

### 12.6 UI 状态

- React 本地状态：输入、折叠和临时选择；
- Zustand：主题、布局和未提交 UI 会话；
- TanStack Query：主进程数据查询缓存。

权威战役状态始终来自主进程和 SQLite。Renderer 不对生命值、物品或剧情做乐观写入；提交成功后根据新 `stateVersion` 刷新视图。

### 12.7 长任务和错误

长任务统一状态为 `queued`、`running`、`waiting_for_user`、`succeeded`、`failed` 和 `cancelled`。切换页面后任务状态不丢失。

错误提示必须说明发生了什么、战役是否安全、可以重试什么、是否可能重复计费、需要修改何种配置以及如何导出诊断。内部堆栈和供应商原始响应不得作为主要用户文案。

## 13. 技术选型

- pnpm workspace；
- TypeScript strict；
- Electron + Electron Forge；
- React + Vite；
- CSS Modules；
- Zustand；
- TanStack Query；
- React Router；
- better-sqlite3；
- Zod；
- Vitest；
- Playwright；
- ESLint + Prettier；
- Pino。

样式系统使用 CSS Modules，不同时引入 Tailwind 或第二套全局工具类体系。全局样式只保存设计 token、重置和应用壳规则，组件样式默认局部化。

不引入大型依赖注入框架。Main 入口显式创建数据库、Repository、Provider 和 Application Service。数据库使用显式 SQL migration 和小型 Repository，不使用隐藏事务和索引行为的重型 ORM。

## 14. Windows 生命周期与数据保护

### 14.1 安装和目录

V1.0 提供每用户安装程序，不默认要求管理员权限。程序文件只读，用户数据分离：

```text
%APPDATA%/<product>/
  settings.sqlite
  logs/
  cache/

%USERPROFILE%/Documents/<product>/
  campaigns/
  content/
  exports/
  backups/
```

目录必须通过 Electron/Node 平台 API 解析。用户可调整战役、内容和备份目录，但迁移需复制、校验并原子切换。V1.0 不提供 Portable 模式。

### 14.2 单实例与退出

默认单实例。第二次启动把导入路径交给已有实例。已提交回合无需额外保存；未提交输入保存草稿；模型请求可取消；短事务完成后关闭连接；可重建后台任务留待下次恢复。退出流程不得长时间阻塞等待全部后台任务。

### 14.3 凭据

API Key、代理认证和远程接口令牌使用 Electron `safeStorage` 和 Windows 系统加密能力，只在主进程解密。Renderer 只能获得“是否已配置”和遮罩信息。

凭据不得进入战役、内容包、导出、普通日志或崩溃报告。本地加密防止误导出和普通文件读取，不承诺抵御已经控制当前 Windows 用户会话的恶意软件。

### 14.4 备份与恢复

备份使用 SQLite 在线备份生成一致副本，并打包 manifest、数据库、附件、内容快照和校验和。类型包括自动滚动、用户命名、手动导出和升级前备份。

恢复默认导入为新战役；覆盖前必须备份旧数据。损坏处理依次尝试只读打开、WAL 恢复、快照与事件重建、自动备份恢复和只读诊断。所有恢复保留原始损坏文件。

### 14.5 打包与更新

Electron Forge 负责打包入口、原生依赖重建和发布产物。V1.0 生成 Windows x64 安装程序、更新元数据、校验和、软件物料清单和变更说明。

正式发行应代码签名。更新频道为 stable、beta 和 development；普通用户默认 stable。更新在后台检查和下载，用户确认后安装。新版本首次启动先备份再迁移数据库，迁移失败不得破坏旧文件。

### 14.6 Web 安全

- 禁止远程脚本和任意导航；
- 内容包不得执行 HTML 或 JavaScript；
- 外部链接经确认后交给系统浏览器；
- Markdown 使用允许列表并过滤 HTML；
- 资源通过受控内部协议；
- 所有 IPC 参数运行时校验；
- 模型请求只由可信主进程发起。

遥测默认关闭或明确选择加入。首次配置云模型时说明发送内容、费用和隐私影响。

## 15. 测试与可观测性

### 15.1 测试层级

- 单元测试：骰式、属性、领域不变量、节点条件、可见性、预算和错误归一化；
- SQLite 集成测试：事务、版本、幂等、WAL、备份、分支、快照和迁移；
- 确定性重放：固定初态、玩家输入、AI Candidate、种子、预期事件和最终哈希；
- Provider 契约测试：文本、流、结构化输出、工具、限流、鉴权、断流、取消和用量；
- Electron E2E：首次启动、配置、导入、回合、澄清、重试、分支、恢复和安全边界；
- 真实模型评测：行动理解、事实来源、可见性、状态服从和幻觉变化。

CI 使用假模型服务器，不调用付费 API。真实 Provider 测试由受保护密钥手动或定时运行，外部 PR 不得访问密钥。

### 15.2 故障注入

主动模拟 AI 超时、SQLite 失败、磁盘不足、各提交阶段崩溃、内容损坏、流中断、本地服务退出、备份不完整和数据库版本过高。验收重点是没有重复 RNG、部分提交、历史丢失或静默状态漂移。

### 15.3 日志与追踪

统一关联 `operationId`、`campaignId`、`branchId`、`turnId`、`modelTaskId` 和 `databaseTransactionId`。日志按 application、runtime、persistence、provider、content、security 和 update 分类。

普通日志不记录 API Key、完整 Prompt、完整玩家文本或完整模型原始响应。日志滚动并设空间上限。诊断包由用户主动生成，并在生成前展示所含内容。

### 15.4 性能基线

- 普通 SSD 冷启动进入首页不超过 5 秒；
- 打开中型战役不超过 3 秒；
- 普通状态查询 P95 小于 100 ms；
- 本地回合事务提交 P95 小于 250 ms；
- 10,000 个事件的战役可正常打开、搜索和继续；
- 50,000 个事件可通过快照恢复，不要求一次渲染全部历史；
- 单战役数据库达到 1 GB 时给出空间和备份提示；
- 主持桌虚拟化历史列表；
- CPU 工作持续阻塞主进程约 50 ms 以上时迁移到 Worker。

模型远端生成耗时不计入本地提交指标，但必须记录连接、首包、吞吐、总耗时和超时阶段。

### 15.5 CI 和发布门槛

每个合并请求运行类型检查、lint、单元与集成测试、固定重放、内容 fixture 校验、Windows x64 打包冒烟及依赖许可证检查。

正式发布额外运行完整 E2E、全部旧数据库迁移、安装更新卸载、签名、恢复故障注入及认证 Provider 人工冒烟测试。

## 16. V1.0 验收标准

V1.0 必须满足：

- 普通用户能够安装、配置模型、导入内容并开始战役；
- 至少一个正式 Scenario Pack 从开场运行到结局；
- 普通文字卡进入明确标注能力范围的角色互动体验；
- 自由行动完成理解、裁定、提交和叙事闭环；
- 状态、骰子和剧情进展有可追溯来源；
- 固定 Candidate 和 RNG 种子重放出相同最终状态；
- 崩溃或模型失败不静默损坏已提交战役；
- 用户可以备份、恢复、读档和创建新时间线；
- 至少一个云 Provider 和 Ollama 完成真实端到端测试；
- 发布界面标为认证的其他 Provider 均通过契约和人工冒烟测试；
- 内容包不能执行代码或任意读取本地文件；
- API Key 不出现在存档、导出、普通日志和 Renderer；
- 外部用户能依据文档独立完成首次游玩；
- 所有发布阻断级缺陷清零。

## 17. 实施顺序

### 阶段 1：工程与安全骨架

建立 workspace、Electron 三层、类型化 IPC、React 外壳、SQLite 迁移、日志、配置、凭据和 Windows 开发构建。

验证：Renderer 无法访问 Node、数据库、任意文件和密钥；应用可以创建并重开空战役。

### 阶段 2：确定性游戏核心

实现实体、命令、事件、版本、回合状态机、原子提交、RNG、基础属性、骰子、快照和重放。

验证：固定命令和种子产生相同事件与状态哈希；故障不产生部分提交。

### 阶段 3：模型网关与完整回合

实现任务系统、Provider 接口、首个云 Provider、Ollama、Context Broker、行动解释、提交后叙事、重试和取消。

验证：自由输入完成完整闭环；叙事失败不重新裁定或提交。

### 阶段 4：内容与规则

实现 Scenario Pack、Rule Pack、内容库、导入安全、Scenario Runtime、首个文字卡 importer 和 `content-cli`。

验证：正式测试剧本从开始运行到结局；恶意包和非法规则被拒绝。

### 阶段 5：完整玩家体验

实现首页、新建战役、主持桌、状态栏、时间线、内容库、设置、任务映射和错误恢复。

验证：非开发者不使用数据库或命令行即可完成首次游玩。

### 阶段 6：长期战役能力

实现 Active Context、Memory、Director、搜索、关系投影、Token 成本、备份、恢复和分支。

验证：长战役 fixture 在受限上下文中保持关键事实一致，并可从备份和检查点恢复。

### 阶段 7：供应商、发布与加固

完成认证 Provider、签名安装包、自动更新、迁移验证、完整 E2E、故障注入和用户、内容作者及贡献者文档。

验证：满足第 16 节全部 V1.0 验收标准。

## 18. 开发纪律

每个阶段必须形成可运行的纵向结果：先写失败的验收或重放测试，实现最小功能，执行故障恢复验证，更新文档，再进入下一阶段。

所有修改遵循：

- 不添加阶段目标之外的功能；
- 不为一次性逻辑创建抽象；
- 不重构与当前目标无关的代码；
- 新增依赖必须证明其边界和维护价值；
- 每一项状态写入都能追溯到用例、Decision 和 Event；
- 每一个“完成”声明都有自动测试或明确人工验收证据。
