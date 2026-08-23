# 《雾港末班车》公开演示版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Electron Demo 上交付可独立完成、可恢复、可检查测试过程的三小时 DeepSeek 单人跑团公开演示版。

**Architecture:** 保留确定性事实内核和 SQLite 单写者边界，把 DeepSeek 接在受约束的 GM 自由行动与叙述任务上。剧本继续使用版本化 Scenario Pack；检查点从不可变事件和状态快照创建新分支，测试元数据只描述测试过程，不成为权威事实。

**Tech Stack:** TypeScript、React 19、Electron、Bun、Zod、SQLite/better-sqlite3、DeepSeek OpenAI-compatible API。

**Spec:** `docs/superpowers/specs/2026-08-23-mist-harbor-public-demo-design.md`

## Global Constraints

- Windows x64 是本阶段唯一发布目标。
- DeepSeek Flash 是唯一云模型；Ollama 只保留兼容代码，不进入公开演示默认流程。
- API Key 不得进入 Renderer、SQLite、日志、Fixture、导出或 Git。
- 模型不能提交规则结果、随机数或权威状态。
- 开发真实调用预算约 4 元，最终验收预留约 1 元。
- 恢复必须复制到新分支，不覆盖或删除来源历史。
- 每个任务按 Red → Green → Refactor 执行并形成独立 Git 里程碑。

---

### Task 1: DeepSeek 诊断、默认路由与费用台账

**Files:**
- Modify: `demo/src/keeper/client.ts`
- Modify: `demo/src/keeper/config.ts`
- Modify: `demo/src/keeper/client.test.ts`
- Create: `electron/main/model-diagnostics.ts`
- Create: `electron/main/model-usage.ts`
- Modify: `electron/main/ipc/register.ts`
- Modify: `electron/main/model-config.ts`
- Modify: `electron/shared/api.ts`
- Modify: `electron/preload/index.ts`
- Modify: `demo/src/desktop.ts`
- Modify: `demo/src/ui/ModelSettings.tsx`
- Test: `electron/scripts/cloud-provider-check.ts`

**Interfaces:**
- Produces: `probeKeeper(config): Promise<ProviderProbe>`，依次返回认证、模型存在、最小生成、JSON 契约和 thinking 参数结果。
- Produces: `classifyProviderError(error): ProviderFailure`，类别限定为 `auth | balance | rate_limit | model_not_found | timeout | server | contract | network`。
- Produces: `recordModelUsage(settings, entry)` 与 `summarizeModelUsage(settings)`；只保存 Token、耗时、类别和微元整数费用。

- [ ] **Step 1: 写失败测试**：扩展 `client.test.ts`，用真实 `Response` 假对象分别覆盖 401、402、404、429、500、AbortError 和错误 JSON；扩展 `cloud-provider-check.ts`，断言所有 AI task route 默认指向 DeepSeek profile，usage JSON 不含测试密钥。
- [ ] **Step 2: 验证失败**：运行 `bun test demo/src/keeper/client.test.ts` 与 `bun run --cwd electron cloud:check`；预期因 `probeKeeper`、错误分类和 usage API 不存在而失败。
- [ ] **Step 3: 最小实现**：在主进程中执行五阶段 probe；解析 Provider JSON 错误但只向 Renderer 返回安全错误码；为成功响应读取 `usage.prompt_tokens`、`completion_tokens`、缓存 Token 和模型 ID。
- [ ] **Step 4: 接入 UI**：DeepSeek 成为首次启动默认 profile；设置页显示连接阶段、明确错误、本次/累计 Token 与估算费用，以及暂停云调用开关。
- [ ] **Step 5: 验证**：运行针对性测试、Demo typecheck、Electron `cloud:check` 和 `persist:check`。
- [ ] **Step 6: 真实预算门测试**：仅执行一次模型列表、一次最小生成、一次 JSON probe；记录台账但不打印 Prompt 或密钥。
- [ ] **Step 7: 提交**：`git commit -m "feat: add DeepSeek diagnostics and usage ledger"`。

### Task 2: 桌面复杂自由行动的单一 GM 工具闭环

**Files:**
- Modify: `demo/src/keeper/free-turn.ts`
- Modify: `demo/src/keeper/contract.ts`
- Modify: `demo/src/engine/routes.ts`
- Modify: `demo/src/engine/play-turn.ts`
- Modify: `electron/main/services/turns.ts`
- Modify: `electron/main/persist/turns.ts`
- Modify: `electron/shared/api.ts`
- Create: `demo/src/keeper/free-turn.test.ts`
- Extend: `electron/scripts/gold-path.ts`

**Interfaces:**
- Produces: `interpretFreeTurn({ config, state, log, text, taskId }): Promise<FreeTurnDecision>`。
- `FreeTurnDecision` 只能是 `{kind:"clarification", text}` 或 `{kind:"intent", intent, modelTaskId}`。
- `TurnService.submit` 对 `free_action` 使用同一 `modelTaskId` 完成解释、程序裁定、提交和结果叙述。

- [ ] **Step 1: 写失败测试**：覆盖普通 NPC 对话、复合机械行动、重大风险缺失时澄清、模型伪造骰点、隐藏实体引用、过期 stateVersion、同 commandId 重试。
- [ ] **Step 2: 验证失败**：运行 `bun test demo/src/keeper/free-turn.test.ts`，预期桌面自由行动仍退回确定性模板或缺少契约字段。
- [ ] **Step 3: 实现受约束解释**：GM 输出只允许 verb、actorId、targetId、approach、acceptedRisk 和 clarification；Zod 使用 `.strict()`；目标必须来自当前可见上下文。
- [ ] **Step 4: 接入 TurnService**：只在确定性路由返回 `free_action` 时调用解释；澄清写 `needs_clarification` 但不增加 stateVersion；机械意图复用现有 resolve/commit；提交后叙述复用相同 task ID。
- [ ] **Step 5: 故障语义**：提交前模型失败不写事件；提交后叙述失败保留提交并允许模板/同结果重试；任何重试不重新 RNG。
- [ ] **Step 6: 验证**：运行 free-turn、keeper、gold、persist 和固定哈希检查。
- [ ] **Step 7: 真实 DeepSeek 样例**：执行一条复杂行动、一条 NPC 对话和一条需要澄清的输入，写入费用台账。
- [ ] **Step 8: 提交**：`git commit -m "feat: connect desktop free-turn GM loop"`。

### Task 3: 《雾港末班车》Scenario Pack

**Files:**
- Create: `demo/src/data/packs/mist-harbor/pack.json`
- Create: `demo/src/data/packs/mist-harbor/rooms.json`
- Create: `demo/src/data/packs/mist-harbor/items.json`
- Create: `demo/src/data/packs/mist-harbor/locks.json`
- Create: `demo/src/data/packs/mist-harbor/facts.json`
- Create: `demo/src/data/packs/mist-harbor/npcs.json`
- Create: `demo/src/data/packs/mist-harbor/story.json`
- Create: `demo/src/data/packs/mist-harbor/conditions.json`
- Modify: `demo/src/engine/schema.ts`
- Modify: `demo/scripts/pack-lint.ts`
- Create: `demo/scripts/mist-harbor-check.ts`

**Interfaces:**
- Scenario ID：`mist-harbor`；版本：`0.1.0`；规则：`percentile`。
- 新增结局节点必须带 `endingId`、公开标题和结构化 `doneWhen`；隐藏路线必须由可验证 flag/事实组合触发。

- [ ] **Step 1: 写失败内容检查**：`mist-harbor-check.ts` 断言 7–9 场景、5 NPC、12–16 道具、15–20 线索、至少 3 结局、1 隐藏路线，以及每个关键结论至少两条独立来源。
- [ ] **Step 2: 验证失败**：运行检查脚本，预期因资料包不存在而失败。
- [ ] **Step 3: 扩展最小 schema**：只添加正式结局元数据、对话所需 NPC 公开描述和剧情可达性声明；不建立通用作者工具。
- [ ] **Step 4: 编写四幕内容**：场站、行李房、售票室、普通车厢、餐车、行李车、驾驶室、旧终点；所有秘密只放 keeper 字段或 secret fact。
- [ ] **Step 5: 编写冗余路径**：档案员、车票、照片、时刻表、记忆缺口和旧线路的关键结论各有至少两条来源；破坏单一路径后仍可达至少一个结局。
- [ ] **Step 6: 编写三结局和隐藏路线**：救回失踪者、维持循环、破坏线路；幕后交易作为隐藏路线或第四结局。
- [ ] **Step 7: 验证**：运行 pack lint、内容检查、kernel、keeper guard 和所有结局可达性搜索。
- [ ] **Step 8: 提交**：`git commit -m "feat: add Mist Harbor one-shot scenario"`。

### Task 4: 首次使用与完整游玩流程

**Files:**
- Modify: `demo/src/App.tsx`
- Modify: `demo/src/ui/CampaignDock.tsx`
- Modify: `demo/src/ui/CardImport.tsx`
- Modify: `demo/src/ui/PackSelector.tsx`
- Modify: `demo/src/ui/NarrationColumn.tsx`
- Create: `demo/src/ui/FirstRunFlow.tsx`
- Create: `demo/src/ui/EndingSummary.tsx`
- Modify: `electron/main/services/campaigns.ts`
- Modify: `electron/main/ipc/register.ts`
- Modify: `electron/shared/api.ts`
- Test: `electron/scripts/persist-check.ts`

**Interfaces:**
- `campaign.create` 接收 `scenarioId` 和已确认角色草案，创建时固定内容版本。
- `campaign.open` 返回当前 Scenario、幕、结局状态、连接状态和继续游玩所需视图。

- [ ] **Step 1: 写失败测试**：覆盖预设角色与导入角色两条创建路径、固定 `mist-harbor@0.1.0`、关闭后继续、结局总结和缺少 DeepSeek 配置时阻止开始。
- [ ] **Step 2: 验证失败**：运行 persist check 与 UI 状态测试，预期创建 API 尚不接受 Scenario/角色绑定。
- [ ] **Step 3: 实现 FirstRunFlow**：四步为模型检查、角色确认、剧本确认、创建；每一步可返回修改，不能跳过未满足的必需条件。
- [ ] **Step 4: 实现继续与结局**：战役列表显示 Scenario、幕和最近时间；结局后输入关闭并展示关键选择、线索、状态与恢复入口。
- [ ] **Step 5: 验证**：类型检查、生产构建、角色卡检查、创建/关闭/继续集成测试。
- [ ] **Step 6: 提交**：`git commit -m "feat: add first-run and complete play flow"`。

### Task 5: 检查点、测试查看器与复制恢复

**Files:**
- Create: `electron/sql/campaign-0003-checkpoint-tests.sql`
- Create: `electron/main/persist/checkpoints.ts`
- Create: `electron/main/services/checkpoints.ts`
- Modify: `electron/main/composition.ts`
- Modify: `electron/main/ipc/register.ts`
- Modify: `electron/shared/api.ts`
- Modify: `electron/preload/index.ts`
- Modify: `demo/src/desktop.ts`
- Create: `demo/src/ui/CheckpointTests.tsx`
- Create: `electron/scripts/checkpoint-check.ts`

**Interfaces:**
- `checkpoint.create({campaignId, branchId, label, kind})`。
- `checkpoint.list({campaignId})` 返回幕、场景、版本、hash 和可选测试元数据。
- `checkpoint.restoreCopy({campaignId, checkpointId, label})` 返回新 `branchId`，来源分支不变。
- 新 migration 将 checkpoint kind 扩展为 `automatic | test | manual | pre_migration | ending`，测试详情存入独立 `checkpoint_test_cases` 表。

- [ ] **Step 1: 写失败集成测试**：创建测试检查点、列出步骤与预期、复制恢复、断言父分支/分叉 sequence、来源历史不变、新分支哈希一致、在新分支继续后隔离。
- [ ] **Step 2: 验证失败**：运行 `checkpoint-check`，预期 migration/API 不存在。
- [ ] **Step 3: 实现 migration 与 Repository**：快照采用规范 JSON 和 SHA-256；检查点与测试元数据同事务写入；恢复先验 hash 再复制状态和分支头。
- [ ] **Step 4: 自动检查点**：幕开始、关键节点和结局前触发；相同 branch/stateVersion/kind 幂等。
- [ ] **Step 5: UI 查看器**：展示测试名称、步骤、预期、实际、hash 和“复制并恢复”；恢复完成后自动打开新分支。
- [ ] **Step 6: 生成开发测试存档**：保存开场、每幕开始、复杂自由行动前和结局前检查点；不包含 API Key。
- [ ] **Step 7: 验证**：migration、checkpoint、persist、gold、导出 secret 扫描和重放 hash 全部通过。
- [ ] **Step 8: 提交**：`git commit -m "feat: add checkpoint test viewer and copy restore"`。

### Task 6: 完整 E2E、真实预算验收与 Windows 交付

**Files:**
- Create: `electron/scripts/mist-harbor-e2e.ts`
- Create: `docs/demo/mist-harbor-test-cases.md`
- Create: `docs/demo/mist-harbor-known-issues.md`
- Modify: `electron/package.json`
- Modify: `electron/scripts/package-win.ts`

**Interfaces:**
- `bun run --cwd electron demo:e2e` 使用固定模型验证所有路径；`DEEPSEEK_LIVE=1` 时只运行预算允许的真实 smoke。

- [ ] **Step 1: 写失败 E2E**：全新战役完成一个结局、从结局前检查点恢复完成另一个结局、自由行动改变过程、关闭重开继续、模型失败后 hash 不变。
- [ ] **Step 2: 修复所有阻断**：只处理 E2E 暴露且能追溯到 spec 的问题，每个问题先补最小回归测试。
- [ ] **Step 3: 真实 DeepSeek 验收**：运行连接/JSON、复杂行动、NPC 对话、叙述和短路径结局；接近 4 元开发预算立即停止额外 live 测试。
- [ ] **Step 4: 全量验证**：Demo tests/typecheck/build/smoke/store/card/mist-harbor，Electron cloud/persist/checkpoint/gold/content/build/package。
- [ ] **Step 5: Windows 覆盖安装**：保留现有用户数据和加密密钥；验证首次启动、旧战役打开和新战役创建。
- [ ] **Step 6: 交付文档**：列出所有测试用例、检查点恢复方法、真实调用费用、已知问题和最终新开局验收步骤。
- [ ] **Step 7: 提交**：`git commit -m "test: certify Mist Harbor public demo"`。

