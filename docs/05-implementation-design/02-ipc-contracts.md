# IPC Contracts

Status: Draft
Implements: V1.0 技术设计第 5、6、12 节
Depends On: [公共约定](00-common-conventions.md)、[Desktop Shell](01-desktop-shell.md)
Consumed By: Renderer、Application Runtime、Content、Model Settings

## 1. 目标

IPC 是不可信 Renderer 与可信 Main 之间唯一业务边界。所有 channel 固定、命名、版本化，并同时验证请求和响应。Preload 不暴露 `ipcRenderer` 或通用 invoke。

## 2. 调用模型

```ts
interface DesktopApi {
  app: AppApi;
  campaign: CampaignApi;
  turn: TurnApi;
  timeline: TimelineApi;
  content: ContentApi;
  model: ModelApi;
  settings: SettingsApi;
  backup: BackupApi;
  operation: OperationApi;
}
```

每个方法返回 `Promise<Result<T>>`。channel 格式固定为 `<namespace>:<verb>`。请求 schema 默认 `.strict()`；1 MiB 以上请求在 IPC 层拒绝。文件通过 Main 文件选择器和路径令牌处理，不从 Renderer 接收任意绝对路径。

## 3. 核心 API

```ts
interface CampaignSummary {
  campaignId: CampaignId;
  name: string;
  health: "unknown" | "healthy" | "recovery_required" | "read_only";
  headBranchId: BranchId;
  headStateVersion: StateVersion;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

interface CampaignView extends CampaignSummary {
  activeScene: { sceneId: EntityId; name: string } | null;
  playerCharacters: Array<{ entityId: EntityId; name: string }>;
  contentBindings: Array<{ contentId: ContentId; type: string; version: string; hash: string }>;
}

interface SubmitActionInput {
  campaignId: CampaignId;
  branchId: BranchId;
  actorId: EntityId;
  controllerId: string;
  expectedStateVersion: StateVersion;
  commandId: string;
  text: string; // trim 后 1..20,000 字符
}

interface SubmitClarificationInput extends SubmitActionInput {
  parentTurnId: TurnId;
  clarificationId: string;
}

interface OperationAccepted { operationId: OperationId; turnId?: TurnId }
interface CancelResult { accepted: boolean; factsAlreadyCommitted: boolean }

interface OperationView {
  operationId: OperationId;
  type: string;
  status: "queued" | "running" | "waiting_for_user" | "succeeded" | "failed" | "cancelled";
  progress: { phase: string; completed?: number; total?: number };
  error?: PublicError;
  createdAt: string;
  updatedAt: string;
}

interface BranchSummary {
  branchId: BranchId;
  label: string;
  parentBranchId: BranchId | null;
  headStateVersion: StateVersion;
}

interface CheckpointSummary {
  checkpointId: string;
  branchId: BranchId;
  label: string;
  kind: "automatic" | "manual" | "pre_migration" | "ending";
  stateVersion: StateVersion;
  createdAt: string;
}

type TimelineItem =
  | { kind: "player_action"; turnId: TurnId; text: string; occurredAt: string }
  | { kind: "narration"; turnId: TurnId; text: string; occurredAt: string }
  | { kind: "rule_decision"; turnId: TurnId; decisionId: DecisionId; summary: string; occurredAt: string }
  | { kind: "state_change"; turnId: TurnId; eventId: EventId; summary: string; occurredAt: string };
```

```ts
interface CampaignApi {
  create(input: CreateCampaignInput): Promise<Result<CampaignSummary>>;
  list(input: PageRequest): Promise<Result<Page<CampaignSummary>>>;
  open(input: { campaignId: CampaignId }): Promise<Result<CampaignView>>;
  close(input: { campaignId: CampaignId }): Promise<Result<void>>;
  moveToTrash(input: { campaignId: CampaignId }): Promise<Result<void>>;
  restoreFromTrash(input: { campaignId: CampaignId }): Promise<Result<void>>;
}

interface TurnApi {
  submitAction(input: SubmitActionInput): Promise<Result<OperationAccepted>>;
  submitClarification(input: SubmitClarificationInput): Promise<Result<OperationAccepted>>;
  retryNarration(input: { turnId: TurnId }): Promise<Result<OperationAccepted>>;
  cancel(input: { operationId: OperationId }): Promise<Result<CancelResult>>;
}

interface TimelineApi {
  page(input: { campaignId: CampaignId; branchId: BranchId; page: PageRequest }): Promise<Result<Page<TimelineItem>>>;
  createCheckpoint(input: CreateCheckpointInput): Promise<Result<CheckpointSummary>>;
  continueFrom(input: { checkpointId: string; label: string }): Promise<Result<BranchSummary>>;
}

interface OperationApi {
  get(input: { operationId: OperationId }): Promise<Result<OperationView>>;
  subscribe(input: { operationId: OperationId }): Promise<Result<{ subscriptionId: string }>>;
  unsubscribe(input: { subscriptionId: string }): Promise<Result<void>>;
}
```

Content、Model、Settings 和 Backup 的具体 DTO 在所属文档定义，但 channel 与 Result 约定以本文为准。

## 4. 操作事件

Main → Renderer 事件只通过预注册类型发送：

```ts
type OperationEvent =
  | { type: "operation.status"; operation: OperationView }
  | { type: "narration.delta"; operationId: OperationId; turnId: TurnId; sequence: number; text: string }
  | { type: "narration.completed"; operationId: OperationId; turnId: TurnId; narrationId: string }
  | { type: "campaign.changed"; campaignId: CampaignId; branchId: BranchId; stateVersion: StateVersion }
  | { type: "app.recovery_required"; operationId: OperationId };
```

文本 delta 每 30–50 ms 或累计 256 字符批量发送，先满足者触发。`sequence` 从 0 递增；Renderer 发现缺口时放弃临时流并调用 `operation.get`，不能猜测缺失内容。

## 5. 文件选择令牌

```ts
interface FileSelectionToken {
  token: string;
  displayName: string;
  size: number;
  expiresAt: string;
  purpose: "content_import" | "campaign_restore" | "export_destination";
}
```

Main 打开系统对话框后返回短期令牌。令牌在内存中映射到规范绝对路径，10 分钟过期、单次使用并绑定 purpose。Renderer 不获得原始绝对路径，除非用户明确选择“打开所在位置”且仅用于展示。

## 6. 版本

Preload 暴露：

```ts
interface ApiVersion {
  major: 1;
  minor: number;
}
```

Main 与 Preload major 不同立即显示安装损坏错误；minor 不同只允许双方共同支持的方法。打包产物必须保证同版本，不把兼容逻辑当作正常更新机制。

## 7. 错误与安全

IPC handler 捕获所有异常并映射为 PublicError。Zod issue 转换为最多 20 个 `{ path, reason }`，不包含接收到的原值。未知异常只返回 `IPC_INTERNAL_ERROR`。

| 错误码 | retryable |
|---|---:|
| `IPC_INVALID_REQUEST` | false |
| `IPC_INVALID_RESPONSE` | false |
| `IPC_PAYLOAD_TOO_LARGE` | false |
| `IPC_METHOD_UNAVAILABLE` | false |
| `IPC_INTERNAL_ERROR` | false |
| `IPC_FILE_TOKEN_EXPIRED` | false |
| `IPC_FILE_TOKEN_PURPOSE_MISMATCH` | false |

## 8. 测试与验收

- 每个方法有请求和响应的合法、缺失、未知字段、边界值测试；
- 契约测试确保 Preload 方法与 channel registry 一一对应；
- E2E 枚举 `window.desktopApi`，不存在通用 `invoke`、`send`、`on`；
- 模糊测试随机对象不能使 handler 未捕获异常；
- 响应泄漏测试扫描 stack、Windows 用户目录、SQL 和 secret 模式；
- delta 乱序、重复、缺失测试验证 Renderer 放弃临时流；
- 文件令牌测试覆盖过期、复用、purpose 错配和路径替换；
- 所有 IPC handler 不包含领域判断或 SQL。
