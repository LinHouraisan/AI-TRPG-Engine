# Turn Audit Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为桌面版 TRPG 的每个正式游玩回合保存完整语义审计链路，并在玩家点击“不满意”后生成可解释的规则诊断和待人工复核的数据候选，最终以稳定的 `audit-case-v1` JSONL 导出。

**Architecture:** 每个 `TurnService.submit` 在模型路由前创建一个 `audit_run`，通过同步、失败隔离的 `AuditRecorder` 将程序、模型、检索、Guard、持久化与最终选择写入同一战役的 `campaign.sqlite`。差评服务在单一事务中幂等写入反馈与候选，再对最终叙述之前的因果 Span 执行 `turn-diagnosis-v1`；渲染进程只通过类型化 IPC 查看和复核候选。内部表结构不直接暴露给整理脚本，导出器负责可见性过滤、资格校验、稳定序列化和 SHA-256 批次记录。

**Tech Stack:** TypeScript 5.8、Bun Test、Electron 37、React 19、Zod 4、SQLite/`better-sqlite3`、Node `crypto`。

**Spec:** `docs/superpowers/specs/2026-09-17-turn-audit-diagnostics-design.md`

## Global Constraints

- 第一版仅覆盖使用主进程 `campaign.sqlite` 的桌面正式游玩回合；浏览器内存模式保持现状，不伪装成已经具备持久审计。
- 不回滚、不自动重试玩家回合、不替换已展示叙述；现有 `keeperNarrate` 自身的两次质量重写仍各自记录为独立 Span。
- 审计写入失败不得阻断游戏主链路；记录器收集缺口码，并在能够写库时把 Run 标为 `partial`。
- 模型请求 Span 必须在 `fetch` 前进入 `started`；成功、契约失败、网络失败和进程恢复分别进入明确终态，绝不覆盖上一次 Attempt。
- `causal=true` 只用于影响最终 Narration 输入或选择的 Span；Information、Director、Memory、诊断与导出均为 `causal=false`。
- 审计载荷不得包含 API Key、Authorization Header、凭据对象、无关本机绝对路径或供应商未返回的隐藏推理。
- 差评只表示“需要复核”，不能单独推出 `GENERATION_DRIFT`；没有机器证据时输出 `UNKNOWN`。
- 不满意的原始输出不得成为 SFT 目标；`sft` 和 `preference` 必须具有非空的人工修订回复。
- `partial`、`aborted` 和 `not_applicable` Run 默认不得进入正式评测、SFT 或偏好数据导出。
- 第一版只实现确定性规则诊断；可选本地 Judge 留作独立增量，不进入当前任务清单。
- 仅修改每个任务列出的文件；发现无关问题只记录，不顺手重构。
- 所有 `bun` 测试、类型检查和构建命令从 `electron/` 目录执行；所有 `git add/commit` 命令从仓库根目录执行。

## Target File Map

```text
electron/
├─ sql/campaign-0008-turn-audit.sql
├─ scripts/export-audit-cases.ts
├─ src/core/audit/
│  ├─ types.ts
│  ├─ diagnosis.ts
│  ├─ diagnosis.test.ts
│  ├─ export.ts
│  └─ export.test.ts
├─ src/core/keeper/
│  ├─ client.ts
│  ├─ client.test.ts
│  ├─ context.ts
│  ├─ context-audit.test.ts
│  ├─ keeper.ts
│  └─ free-turn.ts
├─ src/main/persist/
│  ├─ audit.ts
│  ├─ audit.test.ts
│  └─ backup.ts
├─ src/main/services/
│  ├─ turn-audit.ts
│  ├─ audit-service.ts
│  ├─ audit-service.test.ts
│  ├─ turn-audit.test.ts
│  └─ turns.ts
├─ src/main/ipc/register.ts
├─ src/preload/index.ts
├─ src/shared/api.ts
└─ src/renderer/
   ├─ desktop.ts
   ├─ desktop-play.ts
   ├─ session.ts
   ├─ App.tsx
   └─ ui/
      ├─ NarrationColumn.tsx
      ├─ AuditReviewPanel.tsx
      ├─ audit-feedback-state.ts
      └─ audit-feedback-state.test.ts
```

---

### Task 1: 建立审计契约、SQLite 迁移与持久化仓储

**Files:**
- Create: `electron/src/core/audit/types.ts`
- Create: `electron/sql/campaign-0008-turn-audit.sql`
- Create: `electron/src/main/persist/audit.ts`
- Create: `electron/src/main/persist/audit.test.ts`

**Interfaces:**
- Consumes: `traceId`、回合/操作标识、状态版本、业务输入输出和时间戳。
- Produces: `AuditRun`、`AuditSpan`、`startAuditRun()`、`bindAuditRun()`、`startAuditSpan()`、`finishAuditSpan()`、`finalizeAuditRun()`、`recoverInterruptedAudits()`、`loadAuditCase()`。

- [ ] **Step 1: 定义不可含糊的领域联合类型**

在 `types.ts` 中建立以下公共边界，禁止把数据库字符串直接散落到业务层：

```ts
export type AuditCompleteness = "open" | "complete" | "partial" | "aborted" | "not_applicable";
export type AuditSpanKind = "program" | "model" | "retrieval" | "tool" | "guard" | "persistence";
export type AuditSpanStatus = "started" | "succeeded" | "rejected" | "failed" | "aborted" | "skipped";
export type CandidateStatus =
  | "captured"
  | "auto_diagnosed"
  | "pending_review"
  | "reviewed"
  | "curated"
  | "exported"
  | "discarded";
export type DatasetUsage = "evaluation_only" | "sft" | "preference" | "discard";
export type DiagnosisCode =
  | "PROVIDER_FAILURE"
  | "CONTRACT_FAILURE"
  | "GUARD_REJECTION"
  | "STALE_STATE"
  | "ROUTE_INVALID"
  | "ROUTE_UNCERTAIN"
  | "CONTEXT_TRUNCATED"
  | "CONTEXT_MISSING"
  | "RETRIEVAL_MISS"
  | "RETRIEVAL_NOISE"
  | "EVENT_NARRATION_MISMATCH"
  | "GENERATION_DRIFT"
  | "STYLE_OR_PREFERENCE"
  | "UNKNOWN";

export interface AuditSpanSink {
  start(input: AuditSpanStart): string | undefined;
  finish(spanId: string, input: AuditSpanFinish): void;
  append(input: AuditSpanAppend): string | undefined;
  gap(code: string): void;
}
```

`AuditSpanStart` 必须包含 `kind`、`stage`、`taskType`、`attempt`、`causal`、`input`；模型上下文额外允许 `modelTaskId`、`basedOnStateVersion`、`promptVersion`、`modelId`、`parentSpanId`。`AuditSpanFinish` 包含终态、输出、错误码、耗时和 Token 数。

- [ ] **Step 2: 先写仓储失败测试**

`audit.test.ts` 使用内存 Driver 应用 `campaign.sql` 和新迁移，覆盖以下断言：

```ts
test("audit spans preserve sequence and can enter a terminal state only once", () => {
  const fixture = auditFixture();
  startAuditRun(fixture.db, fixture.run);
  const spanId = startAuditSpan(fixture.db, {
    traceId: fixture.run.traceId,
    sequence: 1,
    kind: "model",
    stage: "gm.route",
    taskType: "gm.handle_free_turn",
    attempt: 1,
    causal: true,
    input: { messages: [{ role: "user", content: "查看门锁" }] },
    createdAt: fixture.now,
  });
  finishAuditSpan(fixture.db, spanId, {
    status: "succeeded",
    output: { rawContent: '{"verb":"observe","target":"lock.front"}' },
    durationMs: 12,
    completedAt: fixture.now,
  });
  expect(() => finishAuditSpan(fixture.db, spanId, {
    status: "failed",
    errorCode: "NETWORK",
    completedAt: fixture.now,
  })).toThrow("audit.span_already_finished");
  expect(loadAuditCase(fixture.db, fixture.run.traceId).spans.map((span) => span.sequence)).toEqual([1]);
});

test("startup recovery aborts unfinished spans and runs", () => {
  const fixture = auditFixture();
  startAuditRun(fixture.db, fixture.run);
  startAuditSpan(fixture.db, {
    traceId: fixture.run.traceId,
    sequence: 1,
    kind: "model",
    stage: "gm.narrate",
    taskType: "gm.narrate_result",
    attempt: 1,
    causal: true,
    input: {},
    createdAt: fixture.now,
  });
  recoverInterruptedAudits(fixture.db, "2026-09-17T10:01:00.000Z");
  const loaded = loadAuditCase(fixture.db, fixture.run.traceId);
  expect(loaded.run.completeness).toBe("aborted");
  expect(loaded.spans[0]?.status).toBe("aborted");
});
```

- [ ] **Step 3: 运行测试并确认 RED**

Run: `bun test --isolate src/main/persist/audit.test.ts`

Expected: FAIL，原因是迁移、审计类型和仓储函数尚不存在。

- [ ] **Step 4: 编写迁移**

`campaign-0008-turn-audit.sql` 创建并约束以下表：

- `audit_runs`：以 `trace_id` 为主键；`turn_id` 和 `final_narration_id` 允许在链路完成前为空；`operation_id` 在对应 operation 落库前即可写入，因此不设外键；`completeness` 只接受设计中的五个值。
- `audit_spans`：`UNIQUE(trace_id, sequence)`；`parent_span_id` 自引用；每个 JSON 列分别使用 `CHECK(json_valid(列名))`；`causal` 只接受 `0/1`。
- `user_feedback`：`UNIQUE(narration_id, rating)`，第一版 `rating` 只接受 `dissatisfied`。
- `diagnosis_results`：保存规则来源、代码、可信度、严重度、解释、证据 Span 和规则版本。
- `dataset_candidates`：`feedback_id` 唯一，保存状态、人工标签、修订回复、用途和导出批次。
- `dataset_export_batches`：保存批次 ID、过滤条件、Schema 版本、条数、SHA-256 和创建时间。

迁移不创建删除级联。原始审计证据随战役备份保留，不能因为候选状态变化被删除。

- [ ] **Step 5: 实现持久化函数与稳定载荷哈希**

`audit.ts` 使用现有 `Driver` 同步接口。`startAuditSpan` 对 `input` 做规范 JSON 序列化并计算 SHA-256；`finishAuditSpan` 必须使用 `WHERE status = 'started'`，随后读取行确认状态已经转换，第二次完成时抛出 `audit.span_already_finished`。`recoverInterruptedAudits` 按以下规则执行：

```ts
export function recoverInterruptedAudits(db: Driver, now: string): void {
  db.transaction(() => {
    db.run(
      `UPDATE audit_spans
       SET status = 'aborted', error_code = 'PROCESS_INTERRUPTED', completed_at = ?
       WHERE status = 'started'`,
      [now],
    );
    db.run(
      `UPDATE audit_runs
       SET completeness = CASE WHEN final_narration_id IS NULL THEN 'aborted' ELSE 'partial' END,
           finalized_at = COALESCE(finalized_at, ?)
       WHERE completeness = 'open'`,
      [now],
    );
  });
}
```

`loadAuditCase()` 必须按 `sequence ASC` 返回 Span，并把 JSON 列解析成类型化对象。

- [ ] **Step 6: 运行仓储测试并确认 GREEN**

Run: `bun test --isolate src/main/persist/audit.test.ts`

Expected: PASS，且覆盖重复 sequence、非法状态值和二次完成被拒绝。

- [ ] **Step 7: 提交本任务**

```powershell
git add -- electron/src/core/audit/types.ts electron/sql/campaign-0008-turn-audit.sql electron/src/main/persist/audit.ts electron/src/main/persist/audit.test.ts
git commit -m "feat(audit): add turn audit schema and repository"
```

---

### Task 2: 注册迁移、恢复中断审计并纳入战役备份

**Files:**
- Modify: `electron/src/main/composition.ts`
- Modify: `electron/src/main/services/campaigns.ts`
- Modify: `electron/src/main/persist/backup.ts`
- Modify: `electron/src/main/services/campaign-backup.test.ts`
- Modify: `electron/src/main/persist/investigator.test.ts`
- Modify: `electron/src/main/services/turns-opening.test.ts`
- Modify: `electron/src/main/services/turns-race.test.ts`
- Modify: `electron/scripts/checkpoint-check.ts`
- Modify: `electron/scripts/mist-harbor-e2e.ts`
- Modify: `electron/scripts/persist-check.ts`

**Interfaces:**
- Consumes: 新迁移 SQL 和战役打开生命周期。
- Produces: 所有新建、导入、测试和脚本数据库都具有审计表；进程重启后未完成记录被恢复为终态；备份可往返审计证据。

- [ ] **Step 1: 扩展备份往返测试并确认 RED**

在现有 `campaign-backup.test.ts` 的 round-trip 场景中写入一个完整 Run、一个模型 Span、一个反馈和一个候选，然后导出并导入。断言新库中的 `trace_id`、原始响应、诊断证据列表和候选状态一致。

Run: `bun test --isolate src/main/services/campaign-backup.test.ts`

Expected: FAIL，原因是备份表清单和 Composition 尚未包含 `0008_turn_audit`。

- [ ] **Step 2: 注册迁移**

在 `composition.ts` 读取 `campaign-0008-turn-audit.sql`，并在 `0007_investigator_recreation` 后追加：

```ts
{ id: "0008_turn_audit", sql: turnAuditSql }
```

对列出的测试 fixture 和脚本做同样的单行追加，保持现有迁移顺序，不抽象新的迁移框架。

- [ ] **Step 3: 只在首次打开 Driver 时恢复中断记录**

在 `CampaignService.open()` 的 `if (!this.openCampaigns.has(campaignId))` 分支内、全部迁移完成后调用 `recoverInterruptedAudits(driver, this.clock.nowIso())`。不得在每次 `ensureOpen()` 时调用，否则读取运行中 Operation 会错误中止活动 Span。

- [ ] **Step 4: 扩展备份表清单**

在 `CAMPAIGN_BACKUP_TABLES` 中按外键依赖顺序加入：

```ts
"audit_runs",
"audit_spans",
"user_feedback",
"diagnosis_results",
"dataset_export_batches",
"dataset_candidates",
```

`audit_runs` 放在 `narrations` 后，反馈和候选放在 Run/Span 后；导入继续使用现有事务和完整性校验。

- [ ] **Step 5: 运行迁移与备份局部测试**

Run:

```powershell
bun test --isolate src/main/persist/audit.test.ts src/main/services/campaign-backup.test.ts src/main/persist/investigator.test.ts src/main/services/turns-opening.test.ts src/main/services/turns-race.test.ts
```

Expected: PASS；现有数据库 fixture 不再报告缺表或 migration mismatch。

- [ ] **Step 6: 提交本任务**

```powershell
git add -- electron/src/main/composition.ts electron/src/main/services/campaigns.ts electron/src/main/persist/backup.ts electron/src/main/services/campaign-backup.test.ts electron/src/main/persist/investigator.test.ts electron/src/main/services/turns-opening.test.ts electron/src/main/services/turns-race.test.ts electron/scripts/checkpoint-check.ts electron/scripts/mist-harbor-e2e.ts electron/scripts/persist-check.ts
git commit -m "feat(audit): migrate and back up audit records"
```

---

### Task 3: 在供应商边界记录真实模型请求、响应与失败

**Files:**
- Modify: `electron/src/core/audit/types.ts`
- Modify: `electron/src/core/keeper/client.ts`
- Modify: `electron/src/core/keeper/client.test.ts`

**Interfaces:**
- Consumes: `askKeeper()` 的实际 system/user 消息、模型配置、Schema、原始供应商响应和解析结果。
- Produces: 每次 HTTP Attempt 一个 `model` Span；`askKeeper()` 返回 `auditSpanId` 供 Guard 和最终选择引用。

- [ ] **Step 1: 为模型审计上下文写 RED 测试**

增加记录型 fake sink，并把现有测试中的 `KeeperConfig` 字面量提取为 `testConfig(overrides?: Partial<KeeperConfig>)`，再扩展 OpenAI-compatible 测试：

```ts
test("askKeeper records the exact request and response without credentials", async () => {
  const audit = recordingAuditSink();
  const result = await askKeeper({
    config: testConfig({ apiKey: "sk-test-never-store" }),
    system: "system text",
    user: "user text",
    schema: z.object({ ok: z.boolean() }),
    jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } },
    audit: {
      sink: audit,
      stage: "gm.route",
      taskType: "gm.handle_free_turn",
      modelTaskId: "task-1",
      attempt: 1,
      basedOnStateVersion: 4,
      promptVersion: "route-w0",
      causal: true,
    },
  });
  expect(result.auditSpanId).toBe(audit.started[0]?.spanId);
  expect(audit.started[0]?.input).toMatchObject({
    messages: [
      { role: "system", content: "system text" },
      { role: "user", content: "user text" },
    ],
    model: testConfig().model,
  });
  expect(JSON.stringify(audit)).not.toContain("sk-test-never-store");
  expect(audit.finished[0]?.output).toMatchObject({ rawContent: '{"ok":true}', parsed: { ok: true } });
});
```

再增加 timeout、非 2xx、malformed JSON、Schema contract failure 四个用例，分别断言终态与 `errorCode`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `bun test --isolate src/core/keeper/client.test.ts`

Expected: FAIL，原因是 `askKeeper` 尚不接受 `audit`，也不返回 `auditSpanId`。

- [ ] **Step 3: 在 fetch 前开始 Span**

给 `askKeeper` 增加可选参数：

```ts
audit?: {
  sink: AuditSpanSink;
  stage: string;
  taskType: string;
  modelTaskId: string;
  attempt: number;
  basedOnStateVersion: number;
  promptVersion: string;
  causal: boolean;
  parentSpanId?: string;
};
```

先构造不含 headers、base URL 凭据和 `KeeperConfig.apiKey` 的 `auditInput`，调用 `sink.start()` 后才执行 `fetch`。记录内容仅包括协议、模型 ID、实际 messages、响应格式、温度、Token 上限、stream/think 设置和状态版本。

- [ ] **Step 4: 在每条退出路径完成 Span**

- 成功：保存 `rawContent`、`parsed`、Token 和耗时，状态 `succeeded`。
- HTTP/网络/超时：保存状态码或标准化错误文本，状态 `failed`，错误码使用现有 `classifyProviderFailure()` 的大写形式。
- JSON/Schema 错误：保存应用实际收到的 `rawContent`，状态 `failed`，错误码 `CONTRACT`。
- sink 自身抛错：捕获并调用 `gap("AUDIT_MODEL_SPAN_WRITE_FAILED")`，原模型调用继续执行。

- [ ] **Step 5: 运行 Client 测试并确认 GREEN**

Run: `bun test --isolate src/core/keeper/client.test.ts`

Expected: PASS；测试序列化内容中不存在测试 API Key、`authorization` 或 headers。

- [ ] **Step 6: 提交本任务**

```powershell
git add -- electron/src/core/audit/types.ts electron/src/core/keeper/client.ts electron/src/core/keeper/client.test.ts
git commit -m "feat(audit): trace provider calls safely"
```

---

### Task 4: 记录 Context Manifest、路由、Guard、检索与模型重试

**Files:**
- Modify: `electron/src/core/keeper/context.ts`
- Create: `electron/src/core/keeper/context-audit.test.ts`
- Modify: `electron/src/core/keeper/keeper.ts`
- Modify: `electron/src/core/keeper/free-turn.ts`
- Modify: `electron/src/core/keeper/free-turn.test.ts`
- Modify: `electron/src/core/keeper/guard.test.ts`
- Modify: `electron/src/core/ai/lc/chains.ts`
- Modify: `electron/src/core/ai/lc/lc.test.ts`
- Modify: `electron/src/core/ai/live.ts`

**Interfaces:**
- Consumes: 上下文装配的每个来源、路由候选、检索命中、质量检查和事实 Guard。
- Produces: `ContextManifest`、父子 Span、重试 Attempt、最终模型来源 Span；RAG/Live 路径接受同一可选 `AuditSpanSink`。

- [ ] **Step 1: 写 Context Manifest RED 测试**

`context-audit.test.ts` 构造超过预算的历史和线索，断言：

```ts
const context = buildContext(fixture);
expect(context.manifest.finalText).toBe(context.text);
expect(context.manifest.entries).toContainEqual(expect.objectContaining({
  sourceKind: "current_event",
  sourceId: fixture.events.at(-1)?.id,
  included: true,
}));
expect(context.manifest.entries.some((entry) => entry.included === false && entry.dropReason === "budget")).toBe(true);
expect(context.manifest.columns.reduce((sum, column) => sum + column.usedChars, 0)).toBeGreaterThan(0);
```

Manifest entry 固定字段为 `column`、`sourceKind`、`sourceId`、`visibility`、`text`、`included`、`dropReason`；不得只保存汇总计数。

- [ ] **Step 2: 写两次重试与 Guard 证据 RED 测试**

扩展 `free-turn.test.ts`：让 Attempt 1 因质量检查失败、Attempt 2 通过。断言两个模型 Span 的 `attempt` 分别为 1、2，各有子 Guard Span，返回结果的 `sourceSpanId` 指向 Attempt 2。再用两次都拒绝的场景断言模板回退和两个被拒 Guard 均保留。

Run:

```powershell
bun test --isolate src/core/keeper/context-audit.test.ts src/core/keeper/free-turn.test.ts src/core/keeper/guard.test.ts
```

Expected: FAIL，原因是 Manifest、审计参数和 `sourceSpanId` 尚不存在。

- [ ] **Step 3: 扩展上下文装配而不建立第二条取数路径**

在现有 `weigh()` 和裁剪循环中同步建立 Manifest；每个 entry 的 `text` 必须就是进入候选分栏的文本，最终 `manifest.finalText` 直接引用 `assembled.text`。保留现有 `ContextUsage`，避免破坏 UI。

- [ ] **Step 4: 串联 Keeper Span**

给 `keeperRoute`、`keeperNarrate`、`handleFreeTurn` 和 `narrateFreeTurn` 增加可选 `audit` 参数。具体阶段固定为：

```text
route.deterministic
gm.route
route.validate
context.build
gm.narrate
guard.quality
guard.facts
narration.select
```

`keeperNarrate` 的循环把 `attempt + 1` 传给 `askKeeper`。每次质量或事实检查都以对应模型 Span 为 `parentSpanId`；拒绝使用 `status="rejected"` 和机器可读 `errorCode`。模型成功输出使用 `sourceSpanId` 返回，模板回退则由 `narration.select` 指向产生回退的失败/Guard Span。

- [ ] **Step 5: 给检索和 Live After-Commit 增加可选审计钩子**

`narrateTurn()` 记录查询、Top-K、`RetrievedDoc.id/source/score`、索引版本和 `usedRag`，阶段为 `retrieval.context`。`runAfterCommitLive()` 向 Information、Director、Memory 的 `askKeeper` 传递同一 sink，但所有 Span 固定 `causal=false`。无 sink 时行为与当前完全一致。

- [ ] **Step 6: 运行 Keeper 与 RAG 局部测试**

Run:

```powershell
bun test --isolate src/core/keeper/context-audit.test.ts src/core/keeper/free-turn.test.ts src/core/keeper/guard.test.ts src/core/ai/lc/lc.test.ts
```

Expected: PASS；两次 Attempt、Guard 父子关系、Manifest 裁剪和检索命中均可断言。

- [ ] **Step 7: 提交本任务**

```powershell
git add -- electron/src/core/keeper/context.ts electron/src/core/keeper/context-audit.test.ts electron/src/core/keeper/keeper.ts electron/src/core/keeper/free-turn.ts electron/src/core/keeper/free-turn.test.ts electron/src/core/keeper/guard.test.ts electron/src/core/ai/lc/chains.ts electron/src/core/ai/lc/lc.test.ts electron/src/core/ai/live.ts
git commit -m "feat(audit): trace context routing and narration guards"
```

---

### Task 5: 在 TurnService 中编排完整因果链并持久化最终选择

**Files:**
- Create: `electron/src/main/services/turn-audit.ts`
- Create: `electron/src/main/services/turn-audit.test.ts`
- Modify: `electron/src/main/services/turns.ts`
- Modify: `electron/src/main/persist/turns.ts`

**Interfaces:**
- Consumes: `TurnService.submit()` 的玩家输入、路由、规则结果、提交事件、Keeper 审计回调和最终 Narration。
- Produces: 同一 `traceId` 下有序的因果/非因果 Span；`TurnService.submit()` 接受结果和 Operation 最终结果均带 `traceId`，后者另带 `turnId/narrationId`。

- [ ] **Step 1: 写正式回合审计 RED 集成测试**

`turn-audit.test.ts` 使用现有内存 Campaign fixture 覆盖两个场景：

1. 确定性行动产生 `turn.received → route.deterministic → rule.resolve → state.commit → context.build → gm.narrate → narration.select`。
2. 自由文本产生 `gm.route` 和 `gm.narrate`，两者共享 `traceId` 与 `modelTaskId`，最终 `audit_runs.final_narration_id` 等于实际落库 Narration。

核心断言：

```ts
const audit = loadAuditCase(fixture.db, submitted.value.traceId);
expect(audit.run.turnId).toBe(submitted.value.turnId);
expect(audit.run.completeness).toBe("complete");
expect(audit.spans.filter((span) => span.causal).map((span) => span.sequence))
  .toEqual([...audit.spans.filter((span) => span.causal).map((span) => span.sequence)].sort((a, b) => a - b));
expect(audit.spans.find((span) => span.stage === "state.commit")?.output)
  .toMatchObject({ beforeVersion: 1, afterVersion: 2 });
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `bun test --isolate src/main/services/turn-audit.test.ts`

Expected: FAIL，原因是 `TurnService` 尚未创建或返回 Trace。

- [ ] **Step 3: 实现失败隔离的 TurnAuditRecorder**

`turn-audit.ts` 负责 sequence、ID、载荷清洗和仓储调用。公共方法固定为：

```ts
export function beginTurnAudit(input: BeginTurnAuditInput): TurnAuditRecorder;

export interface TurnAuditRecorder extends AuditSpanSink {
  readonly traceId: string;
  readonly operationId: string;
  bindTurn(input: { turnId: string; committedStateVersion: number | null }): void;
  linkFinalNarration(input: { narrationId: string; sourceSpanId?: string }): void;
  finalize(completeness?: "complete" | "not_applicable"): void;
}
```

每个方法内部捕获审计专属异常、累积 gap code，并在 finalize 时优先写 `partial`。不得吞掉游戏主链路自身的异常。

- [ ] **Step 4: 在模型路由前创建 Run**

在完成输入、Campaign、人物绑定、幂等和初始版本校验后生成 `operationId` 与 `traceId`，开始 Run 并写 `turn.received`。把 `TurnService.submit()` 返回类型扩展为 `Result<{ operationId: string; turnId: string; traceId: string }>`；幂等命中时从已有 `audit_runs` 读取相同 `traceId` 返回。`turn_id` 暂为空；得到 committed/query/clarification outcome 后再 `bindTurn()`。竞争提交导致版本冲突时，将 Run 终止为 `aborted` 并记录 `STALE_STATE` 证据。

- [ ] **Step 5: 记录程序路由、规则与提交**

- 确定性 `route(text, state)` 记录输入、候选 Intent 和是否需要模型路由。
- `playTurn` 记录选定 Intent、Check/RNG 证据、规则输出和已提交事件。
- `appendCommitted` 成功后记录 `state.commit`，包含前后版本、事件 ID 和 operation/turn 绑定。
- `persistDerived` 的 Information、Director、Memory、Context 结果拆成语义 Span，全部 `causal=false`；复用现有 `JobTrace` 数据，不重复执行任务。

- [ ] **Step 6: 在 Narration 落库后绑定最终来源**

`persistFinalNarration()` 把 `traceId`、`turnId`、`narrationId` 写入最终 `TurnView`。随后记录 `narration.select`，其 output 至少包含 `narrationId`、`source`、`sourceSpanId` 和最终文本哈希；最后把 Run 设为 `complete` 或 `partial`。程序生成的 query/clarification 也必须具有最终 Narration 和完整 Run。

- [ ] **Step 7: 补充历史消息的 Narration 身份**

`loadBranchHistory()` 查询并返回 `n.narration_id`，把 `BranchHistoryView.recentTurns` 扩展为 `{ turnId, narrationId, stateVersion, player, gm }`，为重启后的差评按钮提供稳定关联。

- [ ] **Step 8: 运行 TurnService 局部回归**

Run:

```powershell
bun test --isolate src/main/services/turn-audit.test.ts src/main/services/turns-opening.test.ts src/main/services/turns-race.test.ts src/main/persist/turns-dialogue.test.ts
```

Expected: PASS；现有版本冲突、隐藏信息流式拦截和历史恢复语义保持不变。

- [ ] **Step 9: 提交本任务**

```powershell
git add -- electron/src/main/services/turn-audit.ts electron/src/main/services/turn-audit.test.ts electron/src/main/services/turns.ts electron/src/main/persist/turns.ts
git commit -m "feat(audit): persist complete turn traces"
```

---

### Task 6: 实现规则诊断、幂等差评和候选状态机

**Files:**
- Create: `electron/src/core/audit/diagnosis.ts`
- Create: `electron/src/core/audit/diagnosis.test.ts`
- Modify: `electron/src/main/persist/audit.ts`
- Create: `electron/src/main/services/audit-service.ts`
- Create: `electron/src/main/services/audit-service.test.ts`
- Modify: `electron/src/main/composition.ts`

**Interfaces:**
- Consumes: 最终 Narration 对应的因果 Span、用户差评和人工复核输入。
- Produces: `turn-diagnosis-v1` 诊断、幂等反馈/候选、合法的候选状态转换。

- [ ] **Step 1: 写规则顺序和证据约束 RED 测试**

`diagnosis.test.ts` 使用最小 `AuditCase` fixture，逐项覆盖设计中的 14 个代码。关键约束：

```ts
test("dissatisfaction alone produces UNKNOWN instead of generation drift", () => {
  const result = diagnoseTurn(cleanCausalCase());
  expect(result).toEqual([
    expect.objectContaining({
      code: "UNKNOWN",
      confidence: "low",
      ruleVersion: "turn-diagnosis-v1",
    }),
  ]);
});

test("every diagnosis cites an existing causal span", () => {
  const auditCase = providerFailureCase();
  const known = new Set(auditCase.spans.filter((span) => span.causal).map((span) => span.spanId));
  for (const diagnosis of diagnoseTurn(auditCase)) {
    expect(diagnosis.evidenceSpanIds.length).toBeGreaterThan(0);
    expect(diagnosis.evidenceSpanIds.every((id) => known.has(id))).toBe(true);
  }
});
```

`GENERATION_DRIFT` 只在 `narration.consistency` Span 明确给出 `semantic_drift` 机器证据时产生；`STYLE_OR_PREFERENCE` 只在已有结构化偏好证据时产生。自由文本 note 不做关键词猜测。

- [ ] **Step 2: 写服务幂等性和状态机 RED 测试**

`audit-service.test.ts` 断言：

- 同一 `narrationId` 连点两次返回相同 `feedbackId/caseId`，数据库只有一份候选。
- 反馈与 `captured` 候选在同一事务写入。
- 诊断成功后进入 `pending_review`；诊断失败时反馈仍存在，候选留在 `captured`。
- `sft`/`preference` 没有 `correctedOutput` 时被拒绝。
- 非 `complete` Run 不能进入 `curated`。

- [ ] **Step 3: 运行诊断与服务测试并确认 RED**

Run:

```powershell
bun test --isolate src/core/audit/diagnosis.test.ts src/main/services/audit-service.test.ts
```

Expected: FAIL，原因是纯规则引擎和服务尚不存在。

- [ ] **Step 4: 实现版本化纯规则引擎**

规则顺序固定为 Spec 表格顺序；同一证据可以产生多条诊断，但同一 code 只保留可信度最高的一条。可信度使用 `high | medium | low`，严重度使用 `error | warning | info`。如果没有规则命中，使用最终选择 Span 作为 `UNKNOWN` 的证据。

- [ ] **Step 5: 实现 AuditService 事务边界**

服务接口固定为：

```ts
submitDissatisfied(input: {
  campaignId: CampaignId;
  narrationId: string;
  note?: string;
}): Result<FeedbackReceipt>;

listCandidates(input: CandidateListInput): Result<Page<DatasetCandidateView>>;
getCandidate(input: { campaignId: CampaignId; caseId: string }): Result<AuditCaseView>;
reviewCandidate(input: ReviewCandidateInput): Result<DatasetCandidateView>;
```

`submitDissatisfied` 首先按 Narration 找 Run；在同一数据库事务内 `INSERT OR IGNORE user_feedback` 和 `INSERT OR IGNORE dataset_candidates`。事务提交后运行诊断，再在第二个事务插入 diagnosis 并把候选推进到 `pending_review`。重复请求返回现有记录，不重复诊断。

- [ ] **Step 6: 注册服务并运行 GREEN 测试**

Run:

```powershell
bun test --isolate src/core/audit/diagnosis.test.ts src/main/services/audit-service.test.ts
```

Expected: PASS；所有诊断 evidence ID 都能在该 Run 的因果 Span 中找到。

- [ ] **Step 7: 提交本任务**

```powershell
git add -- electron/src/core/audit/diagnosis.ts electron/src/core/audit/diagnosis.test.ts electron/src/main/persist/audit.ts electron/src/main/services/audit-service.ts electron/src/main/services/audit-service.test.ts electron/src/main/composition.ts
git commit -m "feat(audit): diagnose disliked turns and queue candidates"
```

---

### Task 7: 暴露类型化 IPC，并在 GM 回复上提供“不满意”入口与回看面板

**Files:**
- Modify: `electron/src/shared/api.ts`
- Modify: `electron/src/main/ipc/register.ts`
- Modify: `electron/src/preload/index.ts`
- Modify: `electron/src/renderer/desktop.ts`
- Modify: `electron/src/renderer/desktop-play.ts`
- Modify: `electron/src/renderer/session.ts`
- Modify: `electron/src/renderer/ui/NarrationColumn.tsx`
- Create: `electron/src/renderer/ui/AuditReviewPanel.tsx`
- Create: `electron/src/renderer/ui/audit-feedback-state.ts`
- Create: `electron/src/renderer/ui/audit-feedback-state.test.ts`
- Modify: `electron/src/renderer/App.tsx`

**Interfaces:**
- Consumes: Narration 身份、差评 note、候选筛选和人工复核字段。
- Produces: `DesktopApi.audit`、单次幂等反馈操作、候选列表/证据详情/人工处理 UI。

- [ ] **Step 1: 写纯状态 RED 测试**

`audit-feedback-state.test.ts` 覆盖 `idle → saving → saved/failed`，以及相同 Narration 在 saving/saved 时禁止重复提交。再为候选表单验证写断言：选择 `sft` 或 `preference` 且修订回复为空时返回中文校验错误。

Run: `bun test --isolate src/renderer/ui/audit-feedback-state.test.ts`

Expected: FAIL，原因是 reducer 和校验函数尚不存在。

- [ ] **Step 2: 扩展共享 API**

将 API minor 从 `1` 增至 `2`，增加以下 channel：

```ts
"audit:submitDissatisfied"
"audit:listCandidates"
"audit:getCandidate"
"audit:reviewCandidate"
```

`DesktopApi.audit` 必须复用 Task 6 的输入/视图类型。`OperationAccepted` 增加必填 `traceId`，`TurnView` 增加可选 `turnId`、`narrationId`、`traceId`；历史条目增加 `narrationId`。同步更新渲染进程镜像类型，避免 `unknown as` 绕过契约。

- [ ] **Step 3: 注册 Zod 验证与 Preload 映射**

- `note` 最长 2,000 字符。
- `caseId/narrationId/campaignId` 必须是非空字符串。
- 列表 `limit` 范围 1–100。
- `correctedOutput` 最长 20,000 字符。
- 所有 handler 只调用 `AuditService`，不在 IPC 层直接写 SQL。

- [ ] **Step 4: 让桌面回合返回稳定 Narration 身份**

`submitDesktopTurn()` 对 committed、query、clarification 都等待匹配 operation 的 `narration.completed`，保存事件中的 `turnId/narrationId`，再读取最终 Operation。把 `traceId` 从最终 `TurnView` 一并返回。超时维持现有 120 秒边界，不制造第二次提交。

`session.ts` 的 `Message` 增加可选 `turnId/narrationId/traceId/feedbackCaseId`；新消息和 `createRestoredMessages()` 都填入已有身份。

- [ ] **Step 5: 添加“不满意”按钮**

`NarrationColumn` 仅对满足以下条件的消息展示按钮：

```ts
message.role === "kp"
  && message.kind !== "notice"
  && Boolean(message.narrationId)
  && onDissatisfied !== undefined
```

点击后调用 `session.submitDissatisfied(message, note)`；saving 时禁用，saved 时显示候选编号和首条诊断摘要。不得删除、改写或重新生成该消息。

- [ ] **Step 6: 添加最小回看面板**

`AuditReviewPanel` 提供：

- 候选列表：状态、时间、任务类型、模型、Prompt 版本和诊断码筛选。
- 证据详情：按 sequence 展示 causal 标记、stage、输入/输出、错误和 Token；默认折叠非因果 Span。
- 人工处理：确认 tags、note、corrected output、dataset usage 和状态。

这是开发者/作品集用的轻量面板，不添加账号、任务分派、批量标注快捷键或统计大盘。

- [ ] **Step 7: 运行渲染状态测试和类型检查**

Run:

```powershell
bun test --isolate src/renderer/ui/audit-feedback-state.test.ts
bun run typecheck
```

Expected: PASS；共享 API、Preload、渲染镜像和组件 Props 没有类型漂移。

- [ ] **Step 8: 提交本任务**

```powershell
git add -- electron/src/shared/api.ts electron/src/main/ipc/register.ts electron/src/preload/index.ts electron/src/renderer/desktop.ts electron/src/renderer/desktop-play.ts electron/src/renderer/session.ts electron/src/renderer/ui/NarrationColumn.tsx electron/src/renderer/ui/AuditReviewPanel.tsx electron/src/renderer/ui/audit-feedback-state.ts electron/src/renderer/ui/audit-feedback-state.test.ts electron/src/renderer/App.tsx
git commit -m "feat(audit): add dislike and review workflow"
```

---

### Task 8: 实现 `audit-case-v1` 稳定导出、资格门槛与批次哈希

**Files:**
- Create: `electron/src/core/audit/export.ts`
- Create: `electron/src/core/audit/export.test.ts`
- Modify: `electron/src/main/persist/audit.ts`
- Modify: `electron/src/main/services/audit-service.ts`
- Create: `electron/scripts/export-audit-cases.ts`
- Modify: `electron/package.json`
- Modify: `electron/src/shared/api.ts`
- Modify: `electron/src/main/ipc/register.ts`
- Modify: `electron/src/preload/index.ts`
- Modify: `electron/src/renderer/desktop.ts`
- Modify: `electron/src/renderer/ui/AuditReviewPanel.tsx`

**Interfaces:**
- Consumes: 已复核候选、Trace、反馈、诊断和导出筛选条件。
- Produces: `audit-case-v1` JSONL、批次 manifest、SHA-256、CLI 和桌面下载入口。

- [ ] **Step 1: 写导出 RED 测试**

`export.test.ts` 构造两条 curated complete 候选和三条不可导出候选，断言：

```ts
const exported = exportAuditCases(input);
expect(exported.manifest.schemaVersion).toBe("audit-case-v1");
expect(exported.manifest.count).toBe(2);
expect(sha256(exported.jsonl)).toBe(exported.manifest.sha256);
expect(exported.jsonl.endsWith("\n")).toBe(true);
for (const line of exported.jsonl.trimEnd().split("\n")) {
  expect(parseAuditCaseLine(line).schema_version).toBe("audit-case-v1");
}
expect(exported.jsonl).not.toMatch(/authorization|api[_-]?key|credential/i);
```

另断言缺少 `corrected_output` 的 SFT/preference、非 complete Run、未 curated 候选被默认拒绝。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `bun test --isolate src/core/audit/export.test.ts`

Expected: FAIL，原因是稳定导出器尚不存在。

- [ ] **Step 3: 实现稳定映射和安全过滤**

`export.ts` 只接收类型化 `AuditExportSource`，输出字段顺序固定的 `AuditCaseV1`。模型调用只导出实际 messages、生成参数、原始响应、解析结果、状态、Token 和证据 ID；程序步骤导出 stage、输入输出、状态版本与因果标记。对 `gm_only` 业务对象只保留受控引用，不把隐藏正文作为训练输入。

序列化流程固定为：稳定对象键顺序 → 每条一行 JSON → UTF-8 → 文件末尾单换行 → SHA-256。

- [ ] **Step 4: 记录导出批次并推进候选状态**

`AuditService.exportCandidates()` 在生成成功后使用单一事务：插入 `dataset_export_batches`，把本批 case 的 `export_batch_id` 更新为批次 ID，并把状态从 `curated` 推进到 `exported`。相同筛选再次执行产生新批次，不改写旧批次记录。

- [ ] **Step 5: 提供 CLI 与桌面下载**

新增 package script：

```json
"audit:export": "bun scripts/export-audit-cases.ts"
```

CLI 参数固定为：

```text
--campaign <campaign.sqlite>
--out <cases.jsonl>
--manifest <cases.manifest.json>
```

缺少参数、数据库迁移不匹配或没有合格候选时以非零码退出且不创建空文件。IPC `audit:exportCandidates` 返回 `{ fileName, jsonl, manifest }`，渲染进程使用 Blob 下载 JSONL 和 manifest。

- [ ] **Step 6: 运行导出测试与脚本参数测试**

Run:

```powershell
bun test --isolate src/core/audit/export.test.ts src/main/services/audit-service.test.ts
bun run scripts/export-audit-cases.ts
```

Expected: 测试 PASS；无参数 CLI 明确失败并打印用法，不写任何文件。

- [ ] **Step 7: 提交本任务**

```powershell
git add -- electron/src/core/audit/export.ts electron/src/core/audit/export.test.ts electron/src/main/persist/audit.ts electron/src/main/services/audit-service.ts electron/scripts/export-audit-cases.ts electron/package.json electron/src/shared/api.ts electron/src/main/ipc/register.ts electron/src/preload/index.ts electron/src/renderer/desktop.ts electron/src/renderer/ui/AuditReviewPanel.tsx
git commit -m "feat(audit): export curated audit cases"
```

---

### Task 9: 验证端到端验收标准、安全边界与现有行为不回归

**Files:**
- Modify: `electron/src/main/services/turn-audit.test.ts`
- Modify: `electron/src/main/services/audit-service.test.ts`
- Modify: `electron/src/main/services/campaign-backup.test.ts`
- Modify: `electron/README.md`

**Interfaces:**
- Consumes: 完整桌面审计、差评、复核、备份和导出流程。
- Produces: 对 Spec 第 15 节的可执行证明和最小使用说明。

- [ ] **Step 1: 增加端到端 Bad Case 场景**

在现有 service 测试中完成如下链路：提交自由文本 → 第一次叙述 Guard 拒绝 → 第二次被选中 → 点击差评 → 生成诊断 → 人工修订 → 标记 preference/curated → 导出 → 解析 JSONL。断言 `traceId/turnId/narrationId/modelTaskId` 全程一致，chosen 为人工修订，rejected 为原始坏回复。

- [ ] **Step 2: 增加中断与敏感信息场景**

- 模拟模型 Span 停在 `started` 后重新打开 Campaign，断言 Span `aborted`、Run `aborted/partial` 且默认导出拒绝。
- 使用测试 API Key `sk-audit-sentinel-never-persist` 执行一回合，查询所有新增审计表的文本列，断言哨兵、`Authorization` 和凭据字段名均不存在。
- 让审计 sink 单次写入失败，断言回合仍完成，Run 在后续可写时为 `partial` 且有 gap code。

- [ ] **Step 3: 运行最小充分的局部验证**

Run:

```powershell
bun test --isolate src/core/audit src/core/keeper/client.test.ts src/core/keeper/context-audit.test.ts src/core/keeper/free-turn.test.ts src/core/ai/lc/lc.test.ts src/main/persist/audit.test.ts src/main/services/turn-audit.test.ts src/main/services/audit-service.test.ts src/main/services/campaign-backup.test.ts src/main/services/turns-opening.test.ts src/main/services/turns-race.test.ts src/renderer/ui/audit-feedback-state.test.ts
```

Expected: PASS；Spec 的 12 条最小验收标准均至少有一个直接断言。

- [ ] **Step 4: 运行跨模块类型与构建验证**

Run:

```powershell
bun run typecheck
bun run build
```

Expected: PASS；Electron main/preload/renderer 三侧 API 一致，React 构建成功。

- [ ] **Step 5: 仅在局部验证全部通过后运行一次完整测试**

Run: `bun test --isolate`

Expected: PASS。若失败，只处理与本功能相关的回归；无关既有失败记录到交付说明，不扩张修改范围。

- [ ] **Step 6: 更新 README**

只记录已实现内容：数据保存位置、如何点击差评、候选状态含义、为什么坏回复不能直接用于 SFT、CLI 导出命令和敏感字段边界。明确写出浏览器内存模式与本地 Judge 不在第一版范围内。

- [ ] **Step 7: 提交最终验收材料**

```powershell
git add -- electron/src/main/services/turn-audit.test.ts electron/src/main/services/audit-service.test.ts electron/src/main/services/campaign-backup.test.ts electron/README.md
git commit -m "test(audit): verify end-to-end candidate workflow"
```

---

## Completion Gate

实现者只有在以下条件全部成立时才可宣告完成：

- 任意桌面正式回合都能按 `traceId` 重建输入、路由、上下文、规则、模型 Attempt、Guard、提交和最终 Narration 选择。
- 差评操作幂等，不改变游戏状态，不触发新的生成调用。
- 自动诊断只引用既有因果 Span；证据不足时明确返回 `UNKNOWN`。
- 重启后的历史 GM 消息仍能找到 `narrationId` 并提交差评。
- 人工复核状态机阻止原始坏回复直接进入 SFT。
- `audit-case-v1` 能稳定重读，批次数量与 SHA-256 一致。
- 测试凭据和 Authorization 信息未进入数据库、备份或导出。
- 目标测试、类型检查、构建和一次完整测试均有本次执行的新鲜通过输出。
