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

接收 `ContextRequest` → 解析明确实体 → 查询权威状态/最近事件 → 加入当前任务必需的规则和场景项 → 可见性过滤 → 按需检索记忆 → 可选 AI relevance 排序 → 去重 → 按预算裁剪 → 生成 manifest。

首次 GM 调用只装配完成当前任务所需的最小上下文：当前场景公开状态、活跃实体引用、少量近期交互、未解决短期项和输出/权限契约。规则详情、特定 NPC 知识、较旧事件和剧本材料在明确命中快路径或 GM 发出受约束的 `context_request` 后增量补充。AI relevance 排序不得成为普通回合的同步默认步骤。

Information AI 在 GM 生成、玩家阅读或等待输入期间异步生成下一轮 `context_plan`。程序同时根据实体、场景、目标、事件和记忆检索键装载必需与显式相关信息。两路结果经 Broker 校验后合并；Information AI 提高隐含语义关联的召回率，但其未完成或失败不阻塞普通 GM Chat。

必需项不因 relevance 删除。裁剪顺序：重复正文、低相关旧事件、低置信记忆、可由摘要替代的事件；当前角色/目标、适用规则、提交结果和安全契约不可删除。

## 3. Active Context

按 `(branchId, stateVersion, sceneId)` 缓存。包含活跃实体 ID、最近 20 个相关事件、当前目标/威胁和未解决短期项。缓存最多 500 条 entry 或估算 64k tokens；超过按策略淘汰。任何引用 revision 变化即局部失效。

Active Context 可完全删除重建，不进入快照和导出权威部分。

场景工作集分为 current 与 preparing 两个逻辑版本。当前 GM 任务读取不可变 Turn Snapshot；Information AI 建议、Memory 新条目和事件预取写入 preparing。通过来源、权限、版本和预算检查后，在任务边界原子切换。preparing 未完成时继续使用 current 加确定性基础装载，不等待后台任务。

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

`structured_json` 至少包含相关实体、场景、时间范围、检索键、未解决话题和重要性。Memory 条目提交后同步更新结构化索引与 FTS；涉及当前场景、活跃实体、玩家目标或未解决话题的 active 条目进入 preparing 候选，superseded/conflicted 条目不得进入新快照。

## 5. Memory 生成

每轮立即写入完整玩家输入、GM 最终输出和权威结果。程序从事件、mutations 与规则结果生成无损紧凑 fact delta，删除重复完整状态和重复载荷，但不得筛选、概括或替代自然语言语义。GM 不为 Memory 强制生成 `memory_candidates`、承诺列表、关系标签或检索关键词。

`memory.extract` 的输入为固定回合范围内的完整语义原文、fact delta、少量已处理重叠原文，以及直接相关的 active 记忆。重叠原文只提供跨批次语义上下文，不能重复产生记忆。任务输出事实摘要、因果、承诺、关系、目标、未解决事项和来源；程序验证每个来源存在且可见，无来源候选拒绝。

触发条件为未整理语义文本达到 Token 预算、场景结束、手动存档、材料即将退出近期窗口、重复读取或后台空闲，不按固定回合数调用。每个分支持久化 `rawRecordedThroughTurn`、`memoryProcessedThroughTurn` 和活动 job 范围；成功后原子推进 processed 游标，失败不推进，新任务不得与已完成范围重复。

`memory.consolidate` 与 extract 分离，只在场景结束、同类记忆积累或低优先级空闲窗口增量更新场景、角色、关系和战役摘要。它读取旧摘要与新增记忆，不重新读取完整历史，也不因每次 extract 重写全部长期摘要。

合并只能把旧 memory 标为 superseded，新 memory 保留全部来源。与当前状态冲突标为 conflicted，不覆盖状态。原始事件永不删除。

## 6. 关系索引

关系索引记录 from/to/type/sourceEvent/status，仅用于发现。返回结果后仍从当前实体/事件生成 ContextEntry。索引落后时明确返回版本，不声称最新。

## 7. 错误、性能与测试

错误码：`CONTEXT_REQUIRED_SOURCE_MISSING`、`CONTEXT_BUDGET_EXCEEDED`、`CONTEXT_VISIBILITY_DENIED`、`CONTEXT_STALE`、`MEMORY_SOURCE_INVALID`、`MEMORY_CONFLICTED`、`MEMORY_JOB_FAILED`。

测试覆盖可见性矩阵、必需项不可裁剪、token 边界、缓存失效、双缓冲原子切换、Memory 提交后自动上浮、语义原文完整性、fact delta 可追源性、处理游标幂等、批次重叠不重复、extract/consolidate 分离、单并发前台优先、无来源拒绝、冲突优先级、FTS/关系索引删除后重建。Context 构建本地部分 P95 < 200 ms（不含后台 AI 排序），Memory 或 Information AI 失败不阻塞回合。普通 RP 和已预取场景默认使用一次 GM Chat；监控 GM 上下文补查率、预取命中率、未使用预取 Token 占比、Information AI 准备延迟、Memory 处理滞后、积压 Token 和前台被后台阻塞次数，后者必须为零。
