# 事件、权威状态、快照与分支

Status: Draft
Implements: 事件模型、权威状态、保存与分支设计
Depends On: [公共约定](00-common-conventions.md)、[Persistence](03-persistence.md)
Consumed By: 所有领域、Runtime、Context、UI 时间线

## 1. 权威模型

`state_entities` 是当前事实的读取优化，`events` 记录事实如何形成，`rule_decisions` 记录机械裁定。三者共同提交。事件不是任意审计日志；只有已经通过验证并改变正式历史的事实才能进入事件流。

## 2. 状态接口

```ts
interface StateSnapshot {
  campaignId: CampaignId;
  branchId: BranchId;
  stateVersion: StateVersion;
  headSequence: number;
  entities: ReadonlyMap<EntityId, EntityState>;
}

interface EntityMutation<TState> {
  entityType: string;
  entityId: EntityId;
  expectedRevision: number | null;
  nextState: TState;
  causedByEventId: EventId;
}

interface CommitBundle {
  turnId: TurnId;
  expectedStateVersion: StateVersion;
  decisions: RuleDecisionRecord[];
  events: DomainEvent<string, unknown>[];
  mutations: EntityMutation<unknown>[];
}
```

创建实体的 `expectedRevision = null`，已存在实体必须提供当前 revision。一次 bundle 内同一实体只出现一次最终 mutation；多个事件可共同解释该状态。

## 3. 提交算法

1. 读取并比较 branch head；
2. 检查 turn 尚未 committed；
3. 为事件分配连续 sequence；
4. 校验 EventSource 引用在本 bundle 或历史中存在；
5. 写 Rule Decisions；
6. 写 Events；
7. 按 entity ID 稳定顺序写 state mutations；
8. 更新 branch head sequence/version；
9. 将 turn 标为 committed；
10. 提交事务。

成功后 `newStateVersion = expectedStateVersion + 1`。无状态变化但需记录正式交互的回合仍可增加版本；纯临时澄清不增加版本。

## 4. 事件注册表

每种事件在注册表定义：eventType、当前 schemaVersion、payload schema、允许 source、默认 audience、投影处理器和升级函数。未知事件在新版本应用中拒绝写入；旧应用读取未知事件时只读打开，不跳过事件继续重放。

事件命名采用过去式：`character.health_changed`、`item.transferred`、`scene.entered`、`scenario.node_completed`。禁止 `update_entity` 一类无领域语义事件。

## 5. 分支读取

子分支继承父分支到 `fork_sequence` 的历史，之后读取自身事件。查询解析为线性 segment 列表，最多允许 32 层分支；超过时创建压平快照并以新根分支继续，避免递归查询无限增长。

分支创建必须绑定现有 checkpoint：

```ts
interface CreateBranchInput {
  checkpointId: string;
  label: string; // 1..80
}
```

不允许指向任意不存在的 stateVersion。原分支保持不变。

## 6. 快照

快照内容是按 entityType、entityId 排序的规范 JSON，包含 campaign、branch、stateVersion、sequence、内容绑定和实体集合。哈希计算压缩前字节。默认每 100 个提交版本或数据库增长 20 MiB 创建一次；场景结束、手动保存和升级前可强制创建。

快照生成读取固定版本，写入前再次确认来源版本仍存在；即使分支已前进，旧版本快照仍有效。快照失败不影响已经提交的回合。

## 7. 重放与校验

重放使用最近的已验证快照，按 sequence 应用事件投影。每 500 个事件计算中间哈希以定位损坏区间。最终哈希与已记录 checkpoint 不一致时停止，不以当前状态表覆盖重放结果。

投影函数必须纯函数：

```ts
type ProjectEvent<TState, TEvent> = (state: TState | null, event: TEvent) => TState | null;
```

不得读取当前时间、随机数、数据库其他行或模型。

## 8. 更正

不修改历史事件。可恢复的事实错误使用 `correction.applied`，列出被更正事件、原值、修正值、理由和授权来源；会改变重大剧情含义时优先创建新分支。更正仍通过领域不变量。

## 9. 错误码

`STATE_VERSION_CONFLICT`、`STATE_ENTITY_REVISION_CONFLICT`、`STATE_EVENT_SEQUENCE_GAP`、`STATE_UNKNOWN_EVENT_TYPE`、`STATE_REPLAY_HASH_MISMATCH`、`STATE_BRANCH_DEPTH_EXCEEDED`、`STATE_CHECKPOINT_NOT_FOUND`、`STATE_CORRECTION_INVALID`。

版本冲突可重试但必须重新评估 Candidate；哈希和未知事件错误不可自动重试。

## 10. 测试与验收

- 每个事件投影都有 before/event/after fixture；
- bundle 任一步故障后数据库完全不变；
- 重复 command/turn 返回原提交结果而非再写一次；
- 同一 seed 和 Candidate 得到相同事件与最终哈希；
- 父子分支在 fork 前一致、fork 后隔离；
- 快照损坏回退到更早快照；
- 未知事件和 sequence gap 必须停止恢复；
- 50,000 事件恢复满足性能目标并且内存峰值有记录。
