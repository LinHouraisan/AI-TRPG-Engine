# Character 与 NPC Domain

Status: Draft
Implements: 玩家角色与 NPC 游戏系统
Depends On: [公共约定](00-common-conventions.md)、[事件与状态](04-event-state.md)、[Rule Engine](08-rule-engine.md)
Consumed By: Runtime、Scenario、Context、UI

## 1. 状态模型

```ts
interface CharacterState {
  schemaVersion: 1;
  entityId: EntityId;
  kind: "player_character" | "npc";
  name: string;
  aliases: string[];
  status: "active" | "incapacitated" | "dead" | "absent";
  locationId: EntityId | null;
  attributes: Record<string, number>;
  resources: Record<string, { current: number; max: number }>;
  conditions: ConditionInstance[];
  traits: TraitReference[];
  knowledge: KnowledgeFact[];
  relationships: RelationshipFact[];
  goals: GoalState[];
  commitments: CommitmentState[];
  revision: number;
}
```

NPC 与玩家共享机械状态，但 NPC 额外事实通过 `kind` 和可见性控制，不复制两套模型。角色描述和说话风格属于内容定义；战役状态只保存发生变化的实例事实和绑定版本。

## 2. 命令

`character.create`、`character.move`、`character.adjust_resource`、`character.apply_condition`、`character.remove_condition`、`character.learn_fact`、`character.change_relationship`、`character.update_goal`、`character.record_commitment`、`character.resolve_commitment`。

所有数值变化使用 delta 与预期当前值，避免 AI 直接提交任意最终值：

```ts
interface AdjustResourcePayload {
  characterId: EntityId;
  resourceId: string;
  expectedCurrent: number;
  delta: number;
  decisionId?: DecisionId;
}
```

## 3. 不变量

- 名称 1–120 字符；alias 去重；
- resource max 非负，current 默认限制在 0..max，是否可越界由 Rule Pack 明确声明；
- `dead` 不能自动转回 active；复活需要专用规则事件；
- location 必须是存在且可进入的 Scene/Location；
- condition ID 在同一角色上按 stackPolicy 处理；
- knowledge 必须有 SourceReference 和 audience；
- relationship 的 subject 固定为当前角色，target 必须存在且不能是自身，除非关系类型明确允许；
- commitment 状态只能 pending → fulfilled/broken/released；
- 玩家不可通过自由文本直接声明 NPC 已知隐藏事实。

## 4. 事件

`character.created`、`character.moved`、`character.resource_changed`、`character.condition_applied`、`character.condition_removed`、`character.status_changed`、`character.fact_learned`、`character.relationship_changed`、`character.goal_changed`、`character.commitment_recorded`、`character.commitment_resolved`。

关系变化事件保存 before、delta、after 和理由来源。公开视图只返回玩家可见的关系描述；幕后精确值默认 `gm_only`。

## 5. 查询视图

```ts
interface CharacterPublicView {
  entityId: EntityId;
  name: string;
  status: string;
  locationId: EntityId | null;
  visibleAttributes: Record<string, number>;
  visibleResources: Record<string, { current: number; max: number }>;
  visibleConditions: ConditionView[];
}
```

上下文视图与 UI 视图分开：GM task 可读取授权的隐藏目标，玩家 UI 不读取。

## 6. 错误码与测试

错误码：`CHARACTER_NOT_FOUND`、`CHARACTER_INVALID_STATUS_TRANSITION`、`CHARACTER_RESOURCE_CONFLICT`、`CHARACTER_RESOURCE_OUT_OF_RANGE`、`CHARACTER_LOCATION_INVALID`、`CHARACTER_CONDITION_CONFLICT`、`CHARACTER_FACT_SOURCE_REQUIRED`、`CHARACTER_RELATIONSHIP_INVALID`。

测试覆盖资源边界、死亡不可逆、condition stackPolicy、知识可见性、关系 before/after、承诺状态机、并发 revision 冲突和事件重放。验收要求所有角色状态变化都对应领域事件，AI 不能直接写 `CharacterState`。
