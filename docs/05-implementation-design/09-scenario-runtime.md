# Scenario Runtime

Status: Draft
Implements: 剧本节点、线索和进度
Depends On: [公共约定](00-common-conventions.md)、[事件与状态](04-event-state.md)、[Rule Engine](08-rule-engine.md)、Content System
Consumed By: Application Runtime、Director、Context、UI

## 1. 状态

```ts
interface StoryProgressState {
  schemaVersion: 1;
  scenarioId: ContentId;
  nodeStates: Record<string, NodeRuntimeState>;
  clueStates: Record<string, ClueRuntimeState>;
  routeFlags: Record<string, boolean | number | string>;
  endingId: string | null;
  revision: number;
}

type NodeStatus = "locked" | "available" | "active" | "completed" | "failed" | "skipped";
```

合法转换：locked→available；available→active/completed/skipped；active→completed/failed；任何终态不可逆。更正和分支除外。

Director 使用的派生状态不写入 `StoryProgressState`：

```ts
interface StoryMonitorView {
  branchId: BranchId;
  stateVersion: StateVersion;
  changedNodeIds: string[];
  structurallyReachableNodeIds: string[];
  blockedArcIds: string[];
  clueCoverageGaps: Array<{ nodeId: string; missingClueIds: string[] }>;
  turnsSinceProgress: number;
  affectedEntityIds: EntityId[];
  dependencyKeys: string[];
  sourceEventIds: EventId[];
}

interface DirectorFrontier {
  branchId: BranchId;
  basedOnStateVersion: StateVersion;
  lastAssessedEventId: EventId | null;
  activeArcIds: string[];
  blockedArcIds: string[];
  dormantArcIds: string[];
  openOpportunityIds: string[];
  unresolvedThreats: JsonValue[];
  clueCoverageGaps: JsonValue[];
  playerGoalMemoryIds: string[];
}

interface StoryOpportunity {
  opportunityId: string;
  affectedNodeIds: string[];
  kind: string;
  premise: string;
  requiredConditions: JsonValue[];
  validSceneIds: EntityId[];
  validFromStateVersion: StateVersion;
  invalidationKeys: string[];
  expiresAt: JsonValue;
  gmGuidance: { opportunity: string; doNotReveal: string[] };
  preloadEntityIds: EntityId[];
  sourceReferences: SourceReference[];
  status: "pending" | "accepted" | "rejected" | "expired" | "superseded";
}
```

Story Monitor 与 Director Frontier 均为可重建派生视图。删除或重建不会改变正式节点、线索、结局或事件。

## 2. 节点定义

节点包含 prerequisites、activationTriggers、completionConditions、failureConditions、exclusions、effects、priority 和 visibility。条件使用 Rule Engine 的无 dice 表达式子集。条件只能读取声明的视图，不能查询任意事件文本。

## 3. 求值算法

每次 CommitBundle 形成后、最终写入前，以事件候选应用后的临时状态运行 Scenario evaluation：

1. 收集受本次事件影响的 condition dependency keys；
2. 只评估依赖这些 key 的节点；
3. 按 priority、nodeId 稳定排序；
4. 计算转换直到无新增转换；
5. 最多 100 次转换，超过视为循环；
6. 将节点事件和 effects 加入同一 bundle；
7. 再次运行领域验证。

## 4. 线索

线索区分 existence、discovered、interpreted、invalidated。发现必须引用来源事件或场景 feature。AI 可以建议 interpretation 文案，正式 clue 状态只由确定性触发改变。玩家 UI 不展示未发现线索。

## 5. Director 边界

每次 CommitBundle 求值后，Story Monitor 根据受影响 dependency keys 增量生成结构化变化。明确节点转换、可达性和线索覆盖由程序处理；只有结构结果仍存在语义或因果缺口时才调度 Director。相邻触发按 branch、stateVersion 和 affectedNodeIds 合并。

Director 读取 Story Monitor、旧 Frontier、新增重要事件、直接相关 Canon 片段和受限记忆，返回 Frontier 增量与 `StoryOpportunity`。Runtime 只把它们保存为派生建议；节点仍必须满足正式 trigger。Director 不直接 set node status、发放线索或选择结局。

构建 GM Context 前，Runtime 按状态版本、requiredConditions、validSceneIds、invalidationKeys、expiresAt 和 Visibility Policy 重新校验 accepted/pending Opportunity。失效项原子标记 expired；等价来源、目标和 kind 的建议去重；GM 只能收到通过过滤的 `gmGuidance`，不能读取 premise、隐藏条件或完整 Director 分析。

## 6. 错误与测试

错误码：`SCENARIO_NOT_BOUND`、`SCENARIO_NODE_UNKNOWN`、`SCENARIO_TRANSITION_INVALID`、`SCENARIO_CONDITION_INVALID`、`SCENARIO_TRANSITION_LOOP`、`SCENARIO_EFFECT_REJECTED`、`SCENARIO_ENDING_CONFLICT`。

测试覆盖每条转换、互斥节点、同一事件多节点稳定顺序、循环检测、隐藏节点可见性、时间触发、effect 被领域拒绝时整个提交回滚、Story Monitor 增量与重建、Director 触发合并、Frontier 重建、Opportunity 去重/过期/失效、GM guidance 秘密过滤，以及从开场到每个正式结局的 golden path。
