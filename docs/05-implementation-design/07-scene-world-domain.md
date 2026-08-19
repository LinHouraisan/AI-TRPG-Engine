# Scene 与 World Domain

Status: Draft
Implements: 场景与世界系统
Depends On: [公共约定](00-common-conventions.md)、[事件与状态](04-event-state.md)
Consumed By: Character、Scenario、Rules、Context、UI

## 1. 模型

```ts
interface SceneState {
  schemaVersion: 1;
  entityId: EntityId;
  definitionId: string;
  status: "inactive" | "active" | "resolved" | "destroyed";
  presentEntityIds: EntityId[];
  discoveredFeatureIds: string[];
  environmentalConditions: ConditionInstance[];
  localFlags: Record<string, JsonValue>;
  revision: number;
}

interface WorldState {
  schemaVersion: 1;
  entityId: EntityId;
  worldTime: WorldTime;
  activeSceneId: EntityId | null;
  globalConditions: ConditionInstance[];
  globalFlags: Record<string, JsonValue>;
  revision: number;
}

interface WorldTime {
  calendarId: string;
  tick: number;
}
```

SceneDefinition 来自内容且不可在运行时任意改写；SceneState 只记录发生过的变化。一个单人战役同一时刻只有一个 activeScene，但后台场景可保持状态。

## 2. 命令

`scene.activate`、`scene.resolve`、`scene.discover_feature`、`scene.change_condition`、`world.advance_time`、`world.change_condition`、`world.set_flag`。

角色进入/离开由 Character move 与 Scene presence 在同一 bundle 中保持双向一致。禁止只更新一侧。

## 3. 时间

时间只通过明确命令推进，单位 tick 由 Rule Pack/Scenario 定义。时间推进流程：计算目标 tick → Rule Engine 解析到期 effect → Scenario 检查时间触发 → 生成所有事件 → 原子提交。

不能以现实等待、模型响应时长或 UI 动画推进世界时间。

## 4. 不变量

- activeSceneId 必须指向 status=active 的场景；
- active 场景最多一个；
- presentEntityIds 与 Character.locationId 一致；
- destroyed 场景不可再次激活，除非更正事件；
- discovered feature 必须属于绑定 SceneDefinition；
- world tick 单调递增，回滚通过分支而非负时间；
- global/local flag key 必须由 Scenario 或规则 schema 声明。

## 5. 事件、错误和测试

事件：`scene.activated`、`scene.resolved`、`scene.feature_discovered`、`scene.condition_changed`、`world.time_advanced`、`world.condition_changed`、`world.flag_changed`。

错误码：`SCENE_NOT_FOUND`、`SCENE_INVALID_TRANSITION`、`SCENE_PRESENCE_CONFLICT`、`SCENE_FEATURE_UNKNOWN`、`WORLD_TIME_REVERSED`、`WORLD_FLAG_UNDECLARED`。

测试覆盖场景切换的跨实体原子性、世界时间触发顺序、destroyed 不可恢复、同 tick 多触发器的稳定排序、隐藏 feature 可见性和重放哈希。
