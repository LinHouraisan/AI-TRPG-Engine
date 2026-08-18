# Context Broker、Active Context 与 Memory

Status: Draft  
Implements: 上下文、检索和长期记忆  
Depends On: 公共约定、Event/State、AI Orchestrator、Persistence  
Consumed By: Runtime、GM、Director、Content AI

## 1. ContextPackage

```ts
interface ContextPackage {
  taskType: AiTaskType;
  campaignId: CampaignId;
  branchId: BranchId;
  stateVersion: StateVersion;
  entries: ContextEntry[];
  tokenEstimate: number;
  omitted: Array<{ category: string; count: number; reason: string }>;
}

interface ContextEntry {
  entryId: string;
  category: "state" | "event" | "rule" | "scenario" | "memory" | "content";
  content: JsonValue | string;
  sourceReferences: SourceReference[];
  audience: AudienceRule;
  relevance: number;
  tokenEstimate: number;
}
```

## 2. Broker 流程

接收 `ContextRequest` → 解析明确实体 → 查询权威状态/最近事件 → 加入规则和场景必需项 → 可见性过滤 → 检索记忆 → 可选 AI relevance 排序 → 去重 → 按预算裁剪 → 生成 manifest。

必需项不因 relevance 删除。裁剪顺序：重复正文、低相关旧事件、低置信记忆、可由摘要替代的事件；当前角色/目标、适用规则、提交结果和安全契约不可删除。

## 3. Active Context

按 `(branchId, stateVersion, sceneId)` 缓存。包含活跃实体 ID、最近 20 个相关事件、当前目标/威胁和未解决短期项。缓存最多 500 条 entry 或估算 64k tokens；超过按策略淘汰。任何引用 revision 变化即局部失效。

Active Context 可完全删除重建，不进入快照和导出权威部分。

## 4. Memory DDL

```sql
CREATE TABLE memory_entries (
  memory_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  subject_entity_id TEXT,
  summary TEXT NOT NULL,
  structured_json TEXT NOT NULL CHECK(json_valid(structured_json)),
  source_event_ids_json TEXT NOT NULL CHECK(json_valid(source_event_ids_json)),
  audience_json TEXT NOT NULL CHECK(json_valid(audience_json)),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  based_on_state_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','superseded','conflicted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX memory_subject ON memory_entries(branch_id, subject_entity_id, status, updated_at DESC);
CREATE INDEX memory_type ON memory_entries(branch_id, memory_type, status, updated_at DESC);
```

FTS5 索引只保存允许检索的 summary，并能从 memory/event 重建。

## 5. Memory 生成

触发：场景结束、每 10 个已提交回合、手动存档、后台积压达到 50 个事件。extract 输出事实、因果、承诺、关系、未解决项及来源。程序验证每个 source event 存在且可见。无来源候选拒绝。

合并只能把旧 memory 标为 superseded，新 memory 保留全部来源。与当前状态冲突标为 conflicted，不覆盖状态。原始事件永不删除。

## 6. 关系索引

关系索引记录 from/to/type/sourceEvent/status，仅用于发现。返回结果后仍从当前实体/事件生成 ContextEntry。索引落后时明确返回版本，不声称最新。

## 7. 错误、性能与测试

错误码：`CONTEXT_REQUIRED_SOURCE_MISSING`、`CONTEXT_BUDGET_EXCEEDED`、`CONTEXT_VISIBILITY_DENIED`、`CONTEXT_STALE`、`MEMORY_SOURCE_INVALID`、`MEMORY_CONFLICTED`、`MEMORY_JOB_FAILED`。

测试覆盖可见性矩阵、必需项不可裁剪、token 边界、缓存失效、无来源拒绝、冲突优先级、FTS/关系索引删除后重建。Context 构建本地部分 P95 < 200 ms（不含 AI 排序），Memory 失败不阻塞回合。

