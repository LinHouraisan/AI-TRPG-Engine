# Item Domain

Status: Draft
Implements: 道具系统
Depends On: [公共约定](00-common-conventions.md)、[事件与状态](04-event-state.md)
Consumed By: Runtime、Rules、Scenario、Context、UI

## 1. 定义与实例

```ts
interface ItemInstanceState {
  schemaVersion: 1;
  entityId: EntityId;
  definitionId: string;
  quantity: number;
  location: ItemLocation;
  durability?: { current: number; max: number };
  charges?: { current: number; max: number };
  conditions: ConditionInstance[];
  customState: Record<string, JsonValue>;
  revision: number;
}

type ItemLocation =
  | { kind: "character"; characterId: EntityId }
  | { kind: "scene"; sceneId: EntityId }
  | { kind: "container"; itemId: EntityId }
  | { kind: "consumed" }
  | { kind: "destroyed" };
```

ItemDefinition 来自内容快照，描述 stackable、maxStack、container capacity、重量、标签和允许操作；Instance 只保存战役变化。

## 2. 命令与不变量

命令：create、transfer、split、merge、consume、damage、repair、charge、discharge、apply/remove condition、destroy。

- quantity 为正整数；consumed/destroyed 实例数量保留最终审计值但不可再转移；
- 非 stackable 数量必须为 1；
- merge 要求 definition、状态、耐久、充能和可见性完全兼容；
- split 后两实例数量之和不变；
- container 不能包含自身或形成环；
- transfer 检查来源、目标访问性、容量、角色状态和规则限制；
- 跨角色转移可能需要 Rule Decision，不能由 Item Domain 自行判断偷窃成功；
- 消耗和效果应用在同一 CommitBundle 中；
- 道具不存在时不从叙事推断创建。

## 3. 转移接口

```ts
interface TransferItemPayload {
  itemId: EntityId;
  expectedLocation: ItemLocation;
  destination: ItemLocation;
  quantity: number;
  decisionId?: DecisionId;
}
```

转移产生 `item.transferred`；部分转移先产生 `item.split` 再转移新实例，二者原子提交。

## 4. 事件与视图

事件：`item.created`、`item.transferred`、`item.split`、`item.merged`、`item.quantity_changed`、`item.durability_changed`、`item.charges_changed`、`item.condition_changed`、`item.consumed`、`item.destroyed`。

InventoryView 按 location 查询并分页。容器展开深度默认 5，超过时返回折叠节点；内部检测始终遍历完整祖先链防止循环。

## 5. 错误与测试

错误码：`ITEM_NOT_FOUND`、`ITEM_LOCATION_CONFLICT`、`ITEM_QUANTITY_INVALID`、`ITEM_STACK_INCOMPATIBLE`、`ITEM_CONTAINER_CYCLE`、`ITEM_CAPACITY_EXCEEDED`、`ITEM_NOT_ACCESSIBLE`、`ITEM_TERMINAL_STATE`。

性质测试验证 split/merge 数量守恒、任意转移序列不形成容器环、失败事务不丢失物品。集成测试覆盖角色与场景跨领域引用、消耗与效果原子性、并发转移仅一方成功。
