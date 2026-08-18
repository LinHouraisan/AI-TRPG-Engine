# 公共约定与跨模块类型

Status: Draft  
Implements: V1.0 技术设计第 4、6、7、15 节  
Depends On: 产品与总体架构文档  
Consumed By: 所有实现模块

## 1. 目标与非职责

本文定义所有模块共同遵守的标识、时间、版本、结果、错误、来源、可见性和序列化约定。它不定义具体领域状态，也不提供工具函数实现。

## 2. TypeScript 基线

使用 TypeScript strict，并启用：

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true,
  "useUnknownInCatchVariables": true
}
```

禁止在跨模块接口使用 `any`、未界定的 `object` 或 TypeScript `enum`。有限集合使用字符串联合，运行时边界由 Zod 验证。

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface ConditionInstance {
  instanceId: string;
  definitionId: string;
  source: SourceReference;
  stacks: number;
  appliedAtWorldTick: number;
  expiresAtWorldTick?: number;
}

interface LocalizedText {
  default: string;
  translations?: Record<string, string>;
}
```

JSON 数字必须是有限安全数；需要超过安全整数或精确小数时使用带格式约束的字符串。

## 3. 标识

```ts
declare const brand: unique symbol;
type Brand<T, TName extends string> = T & { readonly [brand]: TName };

type CampaignId = Brand<string, "CampaignId">;
type BranchId = Brand<string, "BranchId">;
type TurnId = Brand<string, "TurnId">;
type EventId = Brand<string, "EventId">;
type EntityId = Brand<string, "EntityId">;
type DecisionId = Brand<string, "DecisionId">;
type OperationId = Brand<string, "OperationId">;
type ModelTaskId = Brand<string, "ModelTaskId">;
type ContentId = Brand<string, "ContentId">;
type StateVersion = Brand<number, "StateVersion">;
```

字符串 ID 使用小写 UUID v7；需要幂等重试时由调用者在首次操作前生成并复用。`StateVersion`、事件 `sequence` 和实体 `revision` 是从零开始的非负安全整数，不使用浮点语义。

数据库保存无品牌的 TEXT/INTEGER；Repository 边界恢复品牌类型。外部内容自有 ID 不直接充当运行时 EntityId，导入时建立映射。

## 4. 时间

- 所有持久化时间使用 UTC ISO 8601：`YYYY-MM-DDTHH:mm:ss.sssZ`；
- UI 根据系统时区格式化；
- 排序和超时使用单调时钟，持久化审计使用 UTC 墙钟；
- 世界内时间是独立的 `WorldTime`，不得与现实时间混用；
- 测试通过 `Clock` 注入固定时间。

```ts
interface Clock {
  now(): Date;
  monotonicMilliseconds(): number;
}
```

## 5. 命令、事件与来源

```ts
interface CommandEnvelope<TType extends string, TPayload> {
  commandId: string;
  commandType: TType;
  campaignId: CampaignId;
  branchId: BranchId;
  actorId: EntityId;
  controllerId: string;
  expectedStateVersion: StateVersion;
  issuedAt: string;
  payload: TPayload;
}

type EventSource =
  | { kind: "command"; commandId: string }
  | { kind: "rule_decision"; decisionId: DecisionId }
  | { kind: "scenario"; nodeId: string }
  | { kind: "initialization"; contentId: ContentId; contentVersion: string }
  | { kind: "correction"; correctedEventIds: EventId[] };

interface DomainEvent<TType extends string, TPayload> {
  eventId: EventId;
  eventType: TType;
  campaignId: CampaignId;
  branchId: BranchId;
  turnId: TurnId;
  sequence: number;
  stateVersion: StateVersion;
  actorId: EntityId | null;
  source: EventSource;
  audience: AudienceRule;
  occurredAt: string;
  schemaVersion: number;
  payload: TPayload;
}
```

一个事务可产生多个事件，所有事件共享提交后的 `stateVersion`，以 `sequence` 确定顺序。`occurredAt` 只用于展示和审计，不用于事件排序。

## 6. 可见性

```ts
type AudienceRule =
  | { kind: "public" }
  | { kind: "controller"; controllerIds: string[] }
  | { kind: "entity"; entityIds: EntityId[] }
  | { kind: "gm_only" }
  | { kind: "system_only" };
```

`public` 表示当前战役玩家可见，不表示可上传或公开发布。`gm_only` 可进入 GM 任务但不能进入玩家 UI；`system_only` 只允许确定性程序和明确授权的后台任务读取。

任何读取接口必须接收 `VisibilityContext`：

```ts
interface VisibilityContext {
  controllerId: string;
  controlledEntityIds: EntityId[];
  role: "player" | "gm_task" | "system_task";
}
```

## 7. Candidate 与来源引用

```ts
type SourceReference =
  | { kind: "entity"; entityId: EntityId; revision: number }
  | { kind: "event"; eventId: EventId; sequence: number }
  | { kind: "rule"; rulePackId: ContentId; ruleId: string; version: string }
  | { kind: "scenario"; scenarioId: ContentId; nodeId: string; version: string }
  | { kind: "memory"; memoryId: string; sourceEventIds: EventId[] };

interface Candidate<TPayload> {
  candidateId: string;
  modelTaskId: ModelTaskId;
  basedOnStateVersion: StateVersion;
  sourceReferences: SourceReference[];
  confidence?: number;
  payload: TPayload;
}
```

`confidence` 只用于排序或要求澄清，不能绕过验证。Candidate 超过当前分支版本即过期。

## 8. Result 与错误

```ts
type Result<T, E extends PublicError = PublicError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

interface PublicError {
  code: ErrorCode;
  messageKey: string;
  retryable: boolean;
  operationId: OperationId;
  details?: Record<string, string | number | boolean>;
}
```

错误码采用 `SUBSYSTEM_REASON`，例如 `TURN_VERSION_CONFLICT`。`messageKey` 由 Renderer 本地化；`details` 只放可公开的结构化值。跨 IPC 不传递 stack、SQL、路径、密钥、Prompt 或供应商原始正文。

错误分类：

| 类别 | retryable | 处理 |
|---|---:|---|
| 输入/schema 错误 | false | 保留输入并指出字段 |
| 乐观版本冲突 | true | 刷新后重新评估 |
| 暂时网络/限流 | true | 有界退避 |
| 认证/余额/模型不存在 | false | 修改配置 |
| 数据库事务失败 | true | 同一幂等 ID 重试 |
| 数据完整性失败 | false | 停止写入并进入恢复 |
| 内部未知错误 | false | 安全提示并导出诊断 |

## 9. JSON 与 schema

- UTF-8，无 BOM；
- 字段使用 `camelCase`，数据库列使用 `snake_case`；
- 对象字段顺序不具语义；
- 金额不用浮点数，费用使用最小货币单位整数或十进制定点字符串；
- 持久化 JSON 必须有 `schemaVersion`；
- 跨边界 schema 默认拒绝未知字段；内容导入中未知字段进入诊断，不能静默丢弃；
- 规范化哈希使用确定字段顺序、UTF-8 和 SHA-256。

## 10. 分页与排序

时间线、事件和内容列表使用游标分页：

```ts
interface PageRequest {
  limit: number; // 1..200，默认 50
  after?: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
```

游标编码稳定排序键和 ID，不包含 SQL。事件默认按 `(sequence ASC)`，倒序 UI 查询按 `(sequence DESC)`，名称列表使用规范化名称加 ID 作为稳定次排序。

## 11. 配置默认值

- IPC 请求体上限：1 MiB；
- 单页默认 50，最大 200；
- 普通 SQLite `busy_timeout`：5000 ms；
- 普通操作 ID 日志保留 30 天；
- 用户正文默认不进入普通日志；
- 所有超时、重试和容量上限在所属模块文档中定义，不共享隐式魔法数字。

## 12. 测试要求

- 品牌 ID 构造器测试合法/非法 UUID；
- 所有公开 schema 进行合法、缺失、未知、边界值测试；
- 错误信封测试不泄漏 stack、路径和 secret；
- 时间测试注入 Clock，不依赖真实等待；
- JSON 规范化哈希具有固定 golden fixture；
- AudienceRule 对每种 VisibilityContext 建立矩阵测试。

## 13. 禁止方式

- 用类型断言代替外部数据验证；
- 用时间戳排序替代事件 sequence；
- 用字符串拼接生成品牌 ID；
- 把未知异常的 `message` 原样发给 Renderer；
- 在 DTO 中使用数据库行结构；
- 用 `undefined` 和 `null` 表达同一业务语义。
