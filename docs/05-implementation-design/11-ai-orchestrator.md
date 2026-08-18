# AI Orchestrator

Status: Draft  
Implements: AI 任务、Prompt 契约、路由、预算和失败策略  
Depends On: 公共约定、Model Providers、Context/Memory  
Consumed By: Application Runtime、Content System

## 1. 任务注册表

```ts
interface AiTaskDefinition<TInput, TOutput> {
  taskType: AiTaskType;
  promptVersion: string;
  inputSchema: ZodType<TInput>;
  outputSchema: ZodType<TOutput>;
  minimumCapabilities: CapabilityRequirement;
  timeoutMs: number;
  maxAttempts: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  blocksTurn: boolean;
  fallbackPolicy: "none" | "same_model" | "configured_model" | "deterministic";
}
```

正式任务：`gm.interpret_action`、`gm.narrate_result`、`director.analyze_progress`、`context.rank_relevance`、`memory.extract`、`memory.summarize`、`content.import`、`content.validate`。

## 2. 默认限制

| 任务 | timeout | attempts | output tokens | 阻塞回合 |
|---|---:|---:|---:|---:|
| interpret_action | 45 s | 2 | 1500 | 是 |
| narrate_result | 90 s | 2 | 3000 | 是（事实已提交） |
| director | 60 s | 2 | 2000 | 否 |
| rank_relevance | 20 s | 1 | 1000 | 可降级 |
| memory.extract | 60 s | 2 | 2000 | 否 |
| memory.summarize | 90 s | 2 | 3000 | 否 |
| content.import | 120 s | 2 | 4000 | 导入流程 |
| content.validate | 120 s | 1 | 4000 | 否 |

用户可降低预算，但不能超过 Provider 和模型硬限制。温度默认：结构化任务 0–0.2，叙事 0.7；具体供应商映射由 adapter 处理。

## 3. Prompt 组成

顺序固定：系统安全与角色契约 → 任务指令 → 输出 schema → ContextPackage → 用户输入 → 已提交结果。内容包 Prompt 只能进入标记的数据区，不能覆盖系统契约。

每次任务保存 promptVersion、context manifest、模型 ID、参数、usage 和结果状态；默认不保存完整 Prompt/响应正文到普通日志。必要的 Candidate 和正式 Narration 进入战役记录。

## 4. 执行接口

```ts
interface AiOrchestrator {
  execute<TInput, TOutput>(request: AiTaskRequest<TInput>): AsyncIterable<AiTaskEvent<TOutput>>;
}

type AiTaskEvent<T> =
  | { type: "started"; modelTaskId: ModelTaskId }
  | { type: "text_delta"; text: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "completed"; output: T; usage: TokenUsage }
  | { type: "failed"; error: PublicError };
```

结构化任务只在完整响应后解析；delta 仅用于叙事展示，不能增量执行工具或状态变化。

## 5. 结构化输出

策略顺序：native schema → JSON mode → Prompt JSON。解析后执行 Zod、语义验证和 SourceReference 验证。第一次 schema 失败可发送精简错误进行一次 repair；repair 不加入新的上下文事实。再次失败返回 `AI_OUTPUT_INVALID`。

## 6. 重试与 fallback

仅网络断开、429、明确 5xx 和无正文的可恢复响应重试，指数退避 1 s/3 s 加 0–250 ms jitter。认证、余额、模型不存在、内容政策拒绝和持续 schema 错误不重试。

fallback 必须由用户预先配置，不能静默把内容发给另一供应商。任务记录实际模型。叙事 fallback 仍读取同一 committed state。

## 7. 预算

预算检查顺序：模型 contextWindow → 任务 maxInput → 用户单回合警戒 → 用户月度提醒。超限时要求 Context Broker 裁剪；仍超限返回 `AI_CONTEXT_TOO_LARGE`。后台任务可延迟，不挤占前台并发槽。

## 8. 错误与测试

错误码：`AI_ROUTE_NOT_CONFIGURED`、`AI_CAPABILITY_MISSING`、`AI_CONTEXT_TOO_LARGE`、`AI_TIMEOUT`、`AI_RATE_LIMITED`、`AI_AUTH_FAILED`、`AI_QUOTA_EXHAUSTED`、`AI_MODEL_NOT_FOUND`、`AI_OUTPUT_INVALID`、`AI_CONTENT_REFUSED`、`AI_CANCELLED`。

契约测试覆盖每任务 schema、Prompt 区域隔离、repair、fallback 授权、取消、usage、流中断和脱敏。评测集检查行动目标、隐藏信息、无来源变化、提交结果服从和中文叙事质量。

