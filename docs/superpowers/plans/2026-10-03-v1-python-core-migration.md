# V1.0 Python 核心迁移与现有功能保留 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（原会话连续实施，建议）或在用户选择后使用 superpowers:subagent-driven-development。按任务逐项执行，使用 `- [ ]` 记录进展。

**Goal:** 把当前可用的游戏、内容、恢复、模型、审计和评测能力迁移到 Python 业务核心；桌面与浏览器预览使用同一后端，保留已有功能和受支持存档。

**Architecture:** 沿用一个 Python 应用进程、确定性领域内核、应用用例、I/O 适配和薄 Electron 外壳。每条能力先建立旧行为证据，再迁移并验证，最后切换消费者；迁移中的旧内核只用于隔离对照，不与 Python 双写同一战役。

**Tech Stack:** 现有 Python 3.11+、FastAPI、Pydantic、LangChain、SQLite；Electron 37、React 19、TypeScript、Bun 1.3.13。游戏持久化优先使用 Python `sqlite3`；原网关 SQLAlchemy / PostgreSQL 能力继续兼容。

**Spec:** [V1.0 架构手册](../../ARCHITECTURE-V1.md)，以用户 2026-10-03 确认的“按现有 V1.0 手册迁移，并保留当前所有已实现功能”为依据。本文是实施计划，不取代该手册。

**Status:** 待用户审阅实施计划及选择执行方式；尚未修改业务代码。代码基线 `44f5027`。2026-10-03 实测旧 `architecture:check` 22 项通过，状态指纹 `b6506aeb`；未据此宣称完整游戏或新架构已验收。

## Global Constraints

- “Python 是唯一业务后端。Electron 保留窗口、文件选择、凭据保管与本地后端生命周期，React 负责展示和交互。”
- “事件只追加。快照、上下文和记忆是派生数据；恢复与纠错通过独立分支或明确事件表达，不改写原历史。”
- “模型调用期间不保持数据库写事务。”
- “叙事失败发生在提交之后时，返回‘结果已保存，叙事待恢复’，重试只继续叙事。”
- “请求与返回都经过运行时 Schema 校验。后端提供 OpenAPI，前端使用生成的合同类型。”
- “浏览器开发预览也连接同一后端；没有后端时显示不可用状态，不悄悄退回旧浏览器游戏引擎。”
- “不修改用户真实存档；兼容验证先在生成数据或明确副本上完成。”
- “新能力通过对应验收并切换调用方后，才删除旧实现和不再使用的依赖。”
- “日常改动按模块运行最小相关测试”；本次涉及公共合同，最终需要一次覆盖迁移范围的集成验收。
- 保留已有界面布局与中文文案、内部内容工具、训练文件及模型权重；不以重构增加作者平台、多人平台、自动训练或微服务。
- 真实模型评测需用户明确发起。实现与回归默认用固定模型响应，不读取或输出明文密钥。

## 本次交付边界

本次是架构迁移及既有功能保留，主要完成 M0/M1，并提前迁移保留现有内容、审计、模型设置、评测和 Windows 解包版所必需的部分。结束时所有正式游戏业务由 Python 执行，现有流程能够从新架构运行。

手册中尚未实现的完整标注工作台（优质/中性采样、独立修订与复核、冻结数据集、偏好数据）属于 M2 新功能；认证模型效果与长期运行证据属于 M3；签名安装器、升级渠道及外部验收属于 M4。本文列明其接口边界和后续验收，但不把这些未实施事项计作本次重构完成。若要求交付完整 V1.0，须继续完成这些里程碑。

采用“按完整能力逐项迁移”，避免一次替换全部代码造成无法定位的行为差异。仅整理 TypeScript 目录不能达到已确认的 Python 核心目标；推倒重写则更难保留现有行为。

## 已核实的问题与功能保留表

| 当前证据 | 实施处理 | 完成任务 |
| --- | --- | --- |
| `renderer/session.ts` 1527 行，同时调用桌面服务、浏览器存储、规则及模型 | 后端提供公开视图；前端只维护交互状态 | 5、9 |
| `main/services/turns.ts` 1013 行，承担路由、规则、模型、事务、任务和审计 | 拆为领域计算、回合应用用例、模型及存储适配 | 2、4、5、6 |
| `core/engine/pack.ts` 709 行，混合校验、文件读取、浏览器记忆和全局单例 | 只读内容实体显式绑定战役；文件读取与校验分离 | 3 |
| `shared/api.ts` 与 `renderer/desktop.ts` 重复定义合同并依赖领域类型 | Python 合同生成前端类型，删除重复 DTO | 5、9 |
| 浏览器 SQLite/WASM 与桌面战役库使用不同表结构 | 两类明确的旧格式导入适配；统一新写入方 | 1、7、9 |
| Python `rules.skill_check` 是属性加骰点；正式游戏 `resolveCheck` 是百分骰 | 原网关接口兼容；正式游戏迁移百分骰，不相互替换 | 2、4 |

| 必须保留的能力 | 当前实现入口 / 证据 | 迁移验收 |
| --- | --- | --- |
| 首次启动、战役新建/切换/回收站/恢复、重置 | `App.tsx`、`CampaignDock.tsx`、`FirstRunFlow.tsx`、`services/campaigns.ts` | 新目录和临时战役走完上述流程 |
| 调查员点数分配、确认后不可变、创建前检查点重建 | `core/character/`、`persist/investigator.ts`、`campaigns.ts` | 同分配生成等价角色；不覆盖旧角色和分支 |
| 建议行动、自由输入、查询、澄清、百分骰、自由探索、调查 | `play-turn.ts`、`resolve.ts`、`investigation.ts`、`keeper/free-turn.ts` | 相同输入/seed/内容下，规则与事件等价；查询不消耗行动 |
| 叙事、检定预览、等待状态、安全降级、浏览器已有重述 | `session.ts`、`desktop-play.ts`、`keeper/` | 先提交后叙事；重述生成新叙事记录，不重新掷骰 |
| 场景地图、角色、物品、线索、剧情进度、结局、时间线 | `renderer/ui/`、`engine/events.ts`、`story-monitor.ts` | 公开 DTO 足够展示；隐藏信息不能随内部状态泄漏 |
| 对话、摘要、Information/Director/Memory、上下文用量、调试任务 | `core/ai/`、`context-store.ts`、`persist/derived.ts` | 来源与处理游标保留；失败和旧版本任务不能覆盖新状态 |
| 模组选择；文字卡 JSON V1/V2/V3、PNG、自动车及确认 | `PackSelector.tsx`、`CardImport.tsx`、`core/cards/`、内容 fixtures | 已支持样例逐项对照；选择/导入后可进入其支持的体验 |
| 保存/重启、回滚新分支、切换分支、检查点测试、前情提要 | 两套 store、`persist/checkpoints.ts`、`CheckpointTests.tsx` | 恢复完整状态及对话；父历史不变 |
| 桌面备份、浏览器导出/导入、角色与内容绑定校验 | `persist/backup.ts`、`renderer/store/repo.ts`、`session.ts` | 旧格式读入新副本；原文件不变；损坏导入不登记半成品 |
| 模型配置、云端/Ollama、凭据、任务路由、调用与 Token 预测 | `ModelSettings.tsx`、`model-config.ts`、`model-usage.ts`、`persist/providers.ts` | 设置和凭据引用保留；沿用已实现的统计口径 |
| 不满意反馈、诊断、人工修订、入选/丢弃、audit-case-v1 导出 | `core/audit/`、`services/audit-service.ts`、`AuditReviewPanel.tsx` | 去重、脱敏、资格约束及历史导出不退化 |
| 网关健康、聊天、检索、规则 Agent、数据库切换、LoRA 路由 | `services/ai-api/app/`、`tests/test_api.py`、`test_agent.py` | 原接口保留；独立网关运行仍受原测试保护 |
| base/RAG/LoRA 评测、内部内容校验、LoRA/Embedding 工具 | `electron/scripts/`、`tools/lora/`、`tools/embedding/` | 评测调用正式能力；训练和内部维护入口保留 |
| Windows 启动/关闭、安全存储与 win-unpacked | `main/index.ts`、`credentials.ts`、`scripts/package-win.ts` | 随包后端启动，不要求玩家安装开发运行时 |

表内“当前实现入口”不是当前环境完整试玩证明；任务 1 必须标记已有能力实际在哪个入口可达，未接通的预留 API 不能冒充已有功能。开发时发现功能差异即补入本表对应行，不顺带扩展产品范围。

## Review Focus

1. 中文、emoji 的 seed 和 JavaScript 无符号整数/哈希语义：迁移不得改变骰点，任务 2 用固定对照覆盖。
2. 模型等待期间重复提交、切换分支、关闭后端，以及事实提交后叙事失败：不得重复提交或重掷，任务 5 覆盖。
3. 从不同内容包、旧浏览器分支或带调查员的桌面备份恢复：不得套用当前全局模组，任务 3、7 覆盖。
4. 隐藏线索及密钥出现在 Prompt、模型回复、人工修订中：公开视图和导出均须清洗，任务 4、8 覆盖。
5. Windows 中文/空格路径、端口冲突、后端不可用与退出重启：不得回退到第二套引擎或遗留子进程，任务 9、11 覆盖。

## 文件与职责

沿用 `services/ai-api`；只随实际功能创建文件。`domain/game` 使用标准库数据结构，不依赖 API、模型、SQL 或文件系统。API 的 Pydantic 类型、领域类型和旧格式适配分别维护版本，前端 DTO 只从 API 生成。

| 目标位置 | 责任 |
| --- | --- |
| `app/domain/game/{types,rng,rules,state,actions,scenario,character}.py` | 事件/状态、确定性计算、行动、内容校验与角色规则 |
| `app/application/{campaigns,turns,recovery,content,models,audit,evaluations}.py` | 用户用例、提交边界及现有审计兼容 |
| `app/agents/{gm,context,memory,director,guard}.py` | 候选/叙事、可见上下文和派生任务，不能直接提交事实 |
| `app/infrastructure/{campaign_store,content_files,legacy_imports,model_runtime,audit_export}.py` | SQLite、文件、旧格式、模型与导出 I/O |
| `app/api/{contracts,game,content,models,audit,operations}.py` | 请求/响应校验与薄路由 |
| `app/main.py` | 保留 `create_app` 可注入入口，装配、生命周期及已有网关路由 |
| `electron/src/main/{backend-process,backend-client}.ts` | 隐藏子进程、连接与受限请求转发；凭据仍归主进程 |
| `electron/src/renderer/api/{generated,client}.ts` | 生成合同类型与同后端访问 |
| `electron/src/renderer/game/use-session.ts` | 原会话的界面状态，保留现有 UI 组件 |

上述文件是职责映射；不要求先创建全部目录，也不增加通用 Manager、Registry 或仓储基类。已有 `gateway.py`、`retrieval.py`、`storage.py` 保留相容入口，只在对应任务实际整合。

## Task 1: 建立最小功能与兼容基线

**Files:** Create `electron/scripts/export-migration-baseline.ts`、`services/ai-api/tests/fixtures/migration-v1/`；沿用现有测试与内容，不复制整个项目。

**Interfaces:** 对照文件格式 `migration-baseline-v1`，每例包含 `name/contentId/contentVersion/seed/initialState/commands/steps`；每步保存完整 `intent/check/events/state`。旧存档分别标明 `desktop-backup-v1`、`browser-export`，保留原字节及 SHA-256。

- [ ] 按保留表核实可达入口：游戏桌、浏览器已有功能、维护脚本分别记录；测试数据只从临时库和仓库 fixtures 生成。
- [ ] 在临时隔离工作区建立 Python 测试环境，按现有 `pyproject.toml` 安装测试依赖；不改变全局 Python。当前机器仅发现 Python 3.14，未发现该服务的 `.venv` 或 FastAPI/pytest 等依赖。
- [ ] 实现 `exportBaseline(outputDir: string): Promise<void>`，导出内置两套场景、百分骰边界、自由行动固定模型响应、角色创建、恢复及旧审计样例；记录生成命令。
- [ ] 对照样例必须比较完整嵌套状态和事件，不只比较旧 `stateHash`。旧哈希仅用于旧文件兼容；不得在迁移时静默换算法。
- [ ] 从 `electron` 执行 `bun run architecture:check`，预期 22 项通过、`b6506aeb`；再执行本任务所使用的既有局部测试，各执行一次。基线变化要先解释，不能更新期望掩盖差异。

## Task 2: 迁移确定性领域内核

**Files:** Create `app/domain/game/{types,rng,rules,state,actions}.py`、`tests/test_game_parity.py`；Source `core/engine/{rng,rules,events,runtime,kernel,routes,router,resolve,play-turn,investigation}.ts`；Modify `app/rules.py` 仅复用骰子实现。

**Interfaces:** `roll_for(seed: str, turn_id: str, sides: int) -> int`；`resolve_check(skill: str, skill_value: int, difficulty: str, roll: int) -> CheckResult`；`replay(initial: GameState, events: list[GameEvent]) -> GameState`；`play_turn(text: str, state: GameState, log: list[GameEvent], content: ContentPack, *, intent: Intent | None = None, profile: InvestigatorProfile | None = None, turn_id: str | None = None) -> TurnOutcome`。领域类型定义于 `types.py`，字段及可选性以任务 1 的 TS 类型和对照数据为准。

- [ ] 写 `test_rng_matches_utf16_vectors`、`test_percentile_boundaries`、`test_turns_match_legacy`；先运行并确认缺失实现导致失败。
- [ ] 移动 Python 已有 UTF-16/FNV/Mulberry32 基础实现到纯领域位置，保留 `app.rules.roll_for` 的兼容导入和原网关参数校验。迁移游戏百分骰，不改 `app.rules.skill_check` 的旧接口含义。
- [ ] 逐项迁移事件应用、条件/剧情触发、可见目标、检定和提交语义；必须显式传入内容。保留确定性查询、澄清、自由探索和检定行为。
- [ ] 核心断言：`actual.roll == legacy.roll`；技能 49 时 96 为大失败、技能 50 时 96 为失败；查询/澄清 `after.version == before.version`；固定回合的完整 `state/events/check` 与基线相等。
- [ ] 在服务目录执行 `.venv\Scripts\python.exe -m pytest tests/test_game_parity.py tests/test_rules.py -q`，全部通过。到此可独立运行无 UI、无模型、无磁盘领域逻辑。

## Task 3: 内容绑定、文字卡与角色

**Files:** Create `app/domain/game/{scenario,character}.py`、`app/infrastructure/content_files.py`、`app/application/content.py`、`tests/test_content_parity.py`；Source `core/engine/pack.ts`、`core/cards/`、`core/character/`、`electron/content/`。

**Interfaces:** `load_content(content_id: str, version: str, content_root: Path) -> ContentPack`；`import_card(data: bytes, filename: str) -> CardImportDraft`；`validate_allocation(allocation: InvestigatorAllocation, content: ContentPack) -> InvestigatorProfile`。绑定记录包含 `contentId/version/contentHash/formatVersion/ruleRef`；候选只在确认用例中提交。

- [ ] 写 `test_supported_cards_match_legacy`、`test_content_bindings_are_independent`、`test_investigator_allocation_matches_legacy`，确认缺失行为失败。
- [ ] 复用现有内容 JSON 及其事实，不重新生成素材；迁移字段、引用、路径与能力检查，PNG 文本块使用标准库解析现有受支持格式。
- [ ] 将两个不同内容包同时作为参数加载，对照 `a.contentId != b.contentId` 且对 A 的选择/导入不改变 B。恢复内容必须按绑定版本/哈希；缺失或不匹配明确拒绝，不能用当前默认包代替。
- [ ] 对照 JSON V1/V2/V3、PNG、自动车候选与字段来源；畸形内容、路径越界和不支持的变体保留明确诊断。内置调查员分配规则与姓名规范化不变。
- [ ] 执行 `.venv\Scripts\python.exe -m pytest tests/test_content_parity.py -q`；所有已声明支持的 fixtures 通过，拒绝样例不落库。

## Task 4: 统一模型配置、调用与现有网关

**Files:** Create `app/application/models.py`、`app/infrastructure/model_runtime.py`、`app/agents/{gm,context,guard}.py`、`tests/test_model_runtime.py`；Modify `app/gateway.py`、`app/main.py` 按需接入；Source `keeper/`、`main/model-config.ts`、`main/model-usage.ts`、`persist/providers.ts`、`core/ai/lc/`。

**Interfaces:** `ModelTask` 包含 `taskType/modelProfileId/messages/promptVersion/schemaVersion/attempt/budget`；`ModelResult` 包含候选输出、实际模型、usage 与状态。`complete_task(task: ModelTask) -> ModelResult` 为唯一模型执行入口；`interpret_action(...) -> Intent` 与 `narrate_result(...) -> NarrationCandidate` 只返回候选。测试注入固定异步模型函数。

- [ ] 写 `test_model_routes_preserve_settings`、`test_narration_guard_and_budget`、`test_usage_forecast_preserves_window`；保留原网关测试作为兼容约束。
- [ ] 复用已有 Python 模型/检索实现，接入桌面模型设置、云端与 Ollama 协议、LoRA 路由、实际 token 记录及最近 7 个自然日预测未来 7 天的已有口径。
- [ ] 迁移当前 Prompt、可见性、结构校验、重试上限和上下文预算，不借迁移调优文风。原始流片段先守卫，再公开；隐藏目标或越权工具候选被拒绝。
- [ ] 原 `/health`、`/v1/chat/completions`、`/v1/retrieve`、`/v1/agent/rules` 及 SQLite/PostgreSQL 元数据存储保持可用；其旧骰子工具与正式游戏规则明确区分。
- [ ] 执行 `.venv\Scripts\python.exe -m pytest tests/test_model_runtime.py tests/test_api.py tests/test_agent.py -q`。固定响应验证全部通过，无真实模型调用。

## Task 5: 战役存储、回合唯一入口与公开合同

**Files:** Create `app/infrastructure/campaign_store.py`、`app/application/{campaigns,turns}.py`、`app/api/{contracts,game,operations}.py`、`tests/test_game_api.py`、`tests/test_turn_recovery.py`；Modify `app/main.py`；Source `main/persist/`、`main/services/{campaigns,turns}.ts`、`shared/api.ts`。

**Interfaces:** `create_campaign(name: str, content_binding: ContentBinding) -> CampaignSummary`；`submit_action(command: SubmitAction) -> OperationAccepted`；`get_operation(campaign_id: str, operation_id: str) -> OperationView`；`get_campaign_view(campaign_id: str, branch_id: str) -> PublicGameView`。`SubmitAction` 保留 `campaignId/branchId/actorId/controllerId/expectedStateVersion/commandId/text`；文本去首尾空白后为 1–20000 字符。

- [ ] 写 API 创建角色后合法行动、重复 command、旧版本冲突、无行动查询和提交后叙事失败恢复测试；先确认预期失败。
- [ ] 从现有 SQL 迁移文件建立新库，保留版本/迁移校验和；Python 独占新库写入。新增持久化操作阶段：accepted、running、committed、narration_pending、succeeded、failed；阶段与公开 status 分开，不改写旧结果含义。
- [ ] 用战役库唯一约束占用 `(branch_id, command_id)`；并发重复返回同一个 operation，提交事务内复核分支与 stateVersion，一次性写规则、事件、版本和操作提交状态。settings 中目录版本仅作可重建展示缓存，不能作为权威并发依据。
- [ ] 模型等待无写事务；提交前冲突返回 `409/TURN_VERSION_CONFLICT`；已提交后失败只恢复叙事。重复 command 即使活动分支已变化，也可定位原操作，不能产生新骰点。
- [ ] 增加 `GET /v1/health`、`GET/POST /v1/campaigns`、`POST /v1/campaigns/{id}/open`、`POST /v1/campaigns/{id}/close`、`GET/PUT /v1/campaigns/{id}/character`、`GET /v1/campaigns/{id}/view`、`POST /v1/campaigns/{id}/turns`、`GET /v1/operations/{id}` 及 `GET /v1/operations/{id}/events`。operation 请求必须带所属 campaignId 并检查归属。
- [ ] `PublicGameView` 提供角色、场景/地图、可见物品/线索、公开剧情状态、建议、检定和对话/时间线；不返回完整内部状态或隐藏事件。所有返回值通过 Pydantic 校验，业务错误稳定 code/message/retryable。
- [ ] 断言：同 command 的两个响应 `operationId` 相等、事件只增一次；叙事恢复前后骰点/事件相等；关闭重开可查询原结果；查询/澄清版本不变；隐藏事实不在序列化公开 DTO 中。
- [ ] 执行 `.venv\Scripts\python.exe -m pytest tests/test_game_api.py tests/test_turn_recovery.py -q`。SSE 可丢失/重连，最终结果查询仍足以恢复界面。

## Task 6: 派生任务、记忆、调试与重述

**Files:** Create `app/agents/{memory,director}.py`、`tests/test_derived_tasks.py`；Extend `agents/context.py`、`application/turns.py`、`infrastructure/campaign_store.py`；Source `core/ai/`、`context-store.ts`、`persist/derived.ts`、`keeper/persisted-dialogue.ts`、`session.ts` 的 say/retell。

**Interfaces:** `run_after_commit(campaign_id: str, branch_id: str, state_version: int, turn_id: str) -> DerivedTaskResult`；`retell(campaign_id: str, narration_id: str, command_id: str) -> OperationAccepted`。派生结果包含 `basedOnStateVersion` 与来源；叙事重述有独立身份并引用原已提交回合。

- [ ] 写 `test_memory_failure_does_not_advance_cursor`、`test_stale_task_cannot_replace_context`、`test_retell_preserves_committed_facts`。
- [ ] 迁移已实际接通的 Information/Director/Memory、当前/准备上下文及任务 trace；保留配置控制，未启用的后台模型任务不自动启用。
- [ ] 仅在成功且版本仍适用时推进处理游标/替换派生视图；失败保留源对话和事件，后台任务不阻塞前台。
- [ ] 接通 `POST /v1/campaigns/{id}/narrations/{narrationId}/retell`，保留旧叙事并增加新记录；`after.events == before.events` 且 `after.stateVersion == before.stateVersion`。保留自由对话与建议刷新现有语义。
- [ ] 执行 `.venv\Scripts\python.exe -m pytest tests/test_derived_tasks.py -q`，并在公开调试 DTO 中核对八阶段 trace、上下文用量与缺失值提示。

## Task 7: 旧存档兼容、恢复和分支

**Files:** Create `app/application/recovery.py`、`app/infrastructure/legacy_imports.py`、`tests/test_legacy_recovery.py`；Extend `application/campaigns.py`、`api/game.py`；Source `persist/{backup,checkpoints,investigator,turns}.ts`、`renderer/store/{schema,repo}.ts`。

**Interfaces:** `import_legacy(data: bytes, format_hint: str) -> CampaignSummary`；`create_checkpoint(campaign_id: str, branch_id: str, label: str, test_case: CheckpointTestCase | None) -> CheckpointView`；`restore_copy(campaign_id: str, checkpoint_id: str, label: str) -> BranchView`；`fork_at_turn(campaign_id: str, branch_id: str, turn_id: str) -> BranchView`。浏览器导出格式识别依据任务 1 的实际文件，不凭空定义。

- [ ] 写桌面备份往返、浏览器分支导入、角色哈希/重放不符拒绝、不同内容绑定、检查点对话成员及创建前角色重建的测试。
- [ ] 校验原桌面 `ai-trpg-campaign-backup` v1 的 checksum、迁移记录、表白名单、BLOB 编码与角色一致性；读旧库时使用明确副本，绝不原地升级真实数据。
- [ ] 导入在新目录/新库完成校验后才登记目录；失败回滚本次新建临时数据。保留来源 ID 映射、父分支、检查点、前情提要、对话和审计谱系；原文件哈希不变。
- [ ] 接通 `GET/POST /v1/campaigns/{id}/checkpoints`、`POST /v1/campaigns/{id}/checkpoints/{checkpointId}/restore`、`POST /v1/campaigns/{id}/checkpoints/{checkpointId}/recreate-character`、`GET/POST /v1/campaigns/{id}/branches`、`PUT /v1/campaigns/{id}/active-branch`、`GET /v1/campaigns/{id}/backups`、`POST /v1/backups/import`、`POST /v1/campaigns/{id}/trash`、`POST /v1/campaigns/{id}/restore`。创建前重建角色必须产生未绑定新分支，原分支的角色确认保持不变。
- [ ] 全部恢复操作产生新分支/副本；`original_events_after == original_events_before`，恢复状态/角色/对话与指定边界一致，不拼入未来记录。
- [ ] 执行 `.venv\Scripts\python.exe -m pytest tests/test_legacy_recovery.py -q`；沿用 `campaign-backup.test.ts`、`investigator.test.ts` 所保护的实际场景，不为旧实现新增另一套产品逻辑。

## Task 8: 保留反馈、审计、修订和旧导出

**Files:** Create `app/application/audit.py`、`app/infrastructure/audit_export.py`、`app/api/audit.py`、`tests/test_audit_compatibility.py`；Source `core/audit/`、`persist/audit.ts`、`services/{turn-audit,audit-service}.ts`。

**Interfaces:** `submit_dissatisfied(campaign_id: str, narration_id: str, note: str | None) -> FeedbackReceipt`；`review_candidate(input: ReviewCandidateInput) -> DatasetCandidateView`；`export_candidates(campaign_id: str, case_ids: list[str] | None) -> AuditExportResult`。先保留 `audit-case-v1` 合同及现有状态，不把旧 curated/exported 自动解释成未来独立标注规范的批准版本。

- [ ] 写反馈重复点击、证据缺失、人工修订训练资格、隐私字段、导出记录/哈希和失败恢复测试，覆盖现有 `audit-service.test.ts` 的用户行为。
- [ ] 在 Python 回合和模型执行入口记录相同来源身份与执行证据；审计/诊断失败不能破坏已提交游戏，缺口如实记录。
- [ ] 迁移旧候选、人工修订、用途和不可变导出批次；运行审计仍归战役库。将旧审计兼容用例与未来 `annotations.sqlite` 分开，后者不在本任务中预建空表。
- [ ] 提供 `POST /v1/campaigns/{id}/audit/feedback`、`GET /v1/campaigns/{id}/audit/candidates`、`GET/PATCH /v1/campaigns/{id}/audit/candidates/{caseId}`、`POST /v1/campaigns/{id}/audit/exports`，保持当前分页与筛选能力。
- [ ] 同时清洗输入、Prompt 副本、输出、修订及导出；断言密钥和隐藏正文不在公开 JSON/JSONL 中。人工修订前后 `game_events` 相等；重复反馈 caseId 相同；批次 SHA-256 等于最终 UTF-8 字节。
- [ ] 执行 `.venv\Scripts\python.exe -m pytest tests/test_audit_compatibility.py -q`；现有审计面板在任务 9 接通后可无模型完成复核与导出。

## Task 9: 薄桌面桥与单一前端会话

**Files:** Create `electron/src/main/{backend-process,backend-client}.ts`、`electron/src/renderer/api/{generated,client}.ts`、`electron/src/renderer/game/use-session.ts`、`services/ai-api/scripts/export_contracts.py`；Modify `main/{index,composition}.ts`、`main/ipc/register.ts`、`preload/index.ts`、`renderer/App.tsx`、`renderer/{session,desktop,desktop-play}.ts` 及受影响 UI；Test `electron/src/main/backend-process.test.ts`、`electron/src/renderer/api/client.test.ts`。

**Interfaces:** `startBackend(options: BackendOptions): Promise<BackendHandle>`，句柄提供 `request/subscribe/close`；Renderer 通过受限桌面桥访问生成的业务合同，浏览器预览同样调用这些 HTTP API。模型密钥和桌面启动访问凭据不作为 Renderer DTO 返回。

- [ ] 写假后端进程的就绪/失败/关闭检查，以及前端重复点击、事件错序、重连后查询最终结果的测试，确认旧前端未接入时失败。
- [ ] 后端仅监听回环地址，启动时生成访问凭据并用受控进程通道交付；启动健康检查成功后才允许写入。主进程传递模型密钥时不使用命令行或日志，Python 仅在内存使用。
- [ ] 请求转发限定方法与路径，原生文件和凭据操作保留主进程校验。浏览器预览使用单独开发连接配置，未连接显示不可用，不自动切回 WASM/本地内核。
- [ ] 用后端 OpenAPI/Schema 生成 DTO 与枚举联合类型，导出脚本只支持本项目实际用到的 Schema；若现有工具已能完整生成则复用，禁止手写第二份等价合同。构建检查生成结果是否过期。
- [ ] `use-session.ts` 只负责显示与提交状态，消费 `PublicGameView`；接通全部保留表 UI、模组/卡片导入、恢复、模型设置和审计；规则计算、事件重放与模型调用从 Renderer 移出。
- [ ] 本任务同时接通 `GET /v1/content`、`POST /v1/content/imports` 和设置/供应商/profile/task-route/usage API，对应任务 3、4 用例；不得为了维持界面而回传内部领域全对象。
- [ ] 执行本任务两份 Bun 局部测试、既有受影响 UI 状态测试，及一次 `bun run typecheck`。桌面与浏览器预览分别完成创建角色、行动、重开、恢复、审计导出；模型使用固定响应。

## Task 10: 共用评测入口与依赖边界

**Files:** Create `app/application/evaluations.py`、`services/ai-api/scripts/bench.py`、`tests/test_evaluation_isolation.py`、`tests/test_architecture_boundaries.py`、`electron/scripts/v1-boundaries.test.ts`；Modify `electron/scripts/{bench,bench-mode}.ts` 及旧入口调用者，按实际引用清理 `core/ai/lc/`。

**Interfaces:** `run_evaluation(cases: list[EvaluationCase], mode: str, output_dir: Path) -> EvaluationReport`，mode 保留 base/rag/lora；输入带固定内容、状态、seed、任务合同与模型配置，调用任务 4、5 的同一能力。

- [ ] 写 `test_bench_uses_game_runtime_and_temporary_store`，断言真实战役字节不变；base 不调用 embedder，rag/lora 使用声明的检索与模型配置；未知用量保持未知。
- [ ] 迁移现有报告字段及训练工具使用的命令入口；旧 Bun bench 如仍被脚本调用，仅保留转发命令，不保留第二套业务实现。逐项处理 `persist:check`、`cloud:check`、`checkpoint:check`、`demo:e2e`、`kernel:check`、`keeper:check` 和 `--provider-smoke` 的实际消费者，保留同名可用检查入口或明确的迁移说明；不批量删除维护脚本。
- [ ] 增加小型依赖检查：Renderer 不导入领域/模型/数据库；domain 不导入 FastAPI、LangChain、文件/数据库/网络实现；审计人工修订不调用事实提交入口。
- [ ] 逐项核实新能力验收和所有消费者后，删除被替代的 TypeScript 业务/浏览器存储实现、重复 DTO 及确实无消费者的依赖。内部内容校验脚本仍需的代码和工具保留；迁移对照 fixtures 保留。
- [ ] 执行 `.venv\Scripts\python.exe -m pytest tests/test_evaluation_isolation.py tests/test_architecture_boundaries.py -q`、`bun test scripts/v1-boundaries.test.ts`，再检查已删除符号的引用。只扩展运行受共享合同影响的测试。

## Task 11: 可运行分发与本次迁移验收

**Files:** Modify `electron/scripts/{build,dev,package-win}.ts`、实际 Windows 打包配置、`README.md`、`electron/README.md`、`services/ai-api/README.md`、`docs/CURRENT-STATUS.md`；Create `docs/testing/v1-migration-acceptance.md`。

**Interfaces:** 保持根目录 `desktop`、`package:win` 使用入口；`resources/backend/` 保存固定版本 Python 运行时、应用和依赖，内容/SQL 均通过明确资源路径加载；可写数据在用户数据目录，不写安装资源目录。

- [ ] 打包前使用仓库 Windows packaging 技能；复用已有 Electron 打包流程，把可离线运行的 Python 运行时/依赖随包分发。运行时版本、来源与校验和在执行阶段核实并固定，不复制不可移植的开发虚拟环境充当运行时。
- [ ] 只在隔离的发布目录生成新的 win-unpacked；不覆盖正在使用的旧目录。验证中文/空格路径、无 Python/Bun 的 PATH、后端就绪/崩溃提示、退出进程回收和再次启动恢复。
- [ ] 用固定模型走一次两套内置内容、角色、自由/建议行动、查询/检定、恢复/分支、导入/导出、配置与审计全流程，逐行勾选功能保留表。检查点和旧文件使用生成数据/副本。
- [ ] 运行一次迁移专用 Python 集成集合、相关前端类型检查和打包构建；已通过的局部检查不为提高置信度反复运行。失败只回到所属任务修复并复验。
- [ ] 在验收记录中区分：旧基线通过、新架构已验证、未运行的真实模型/干净系统/正式发布验收。当前不能取得的外部证据明确留空并说明条件，不写成成功。
- [ ] 更新 CURRENT-STATUS 及运行说明，使实现与手册目标一致；只宣称本次已经实际完成的迁移，不自动改成正式版本 `1.0.0` 或发布 stable。

## 后续完整 V1.0 的剩余工作

| 里程碑 | 继续实施的能力 | 手册验收 |
| --- | --- | --- |
| M2 | 独立 annotations.sqlite、四类采样、修订/复核、用途资格、冻结数据集、脱敏/分组/manifest、旧 audit-case-v1 适配及完整工作台 | D1–D6 |
| M3 | 100 已提交回合、至少 3 次关闭恢复、10k 事件；云端和 Ollama 真实多轮/延迟记忆；固定版本数据集对照 | G5–G7、R2 |
| M4 | 干净 Windows 安装、签名/完整性/SBOM、受支持升级与失败恢复、玩家/标注文档和外部反馈 | R1–R3 |

M1 迁移完成不意味着这些验收已经通过。旧完整基线、真实模型质量及正式发布证据分别保留。

## 自审与执行

- 当前所有已识别功能均在保留表中有所属任务；新 V1 能力单列，没有借重构默认增加范围。
- GameState/事件、公开 DTO 和旧导出有不同职责；新战役唯一写入方明确，旧对照运行与真实数据隔离。
- 风险对应到具体测试，验证以离线固定响应、局部测试、最终一次迁移集成为主。
- 执行建议：原会话连续实施。内容、角色、事件、存档和回合接口高度耦合，连续推进可减少交接偏差。若用户选择子代理，则按任务实施与审阅，不并行改共享合同。
- 审阅通过后创建/复用隔离工作区，按任务进行小提交。每次提交前只跑受影响的必要检查；每完成一条能力记录新入口、兼容证据和旧入口退出条件。

