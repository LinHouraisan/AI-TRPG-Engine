# Model Providers 与能力协商

Status: Draft
Implements: 多供应商和本地接口
Depends On: 公共约定
Consumed By: AI Orchestrator、设置 UI

## 1. Adapter

```ts
type ProviderType =
  | "openai" | "anthropic" | "gemini" | "deepseek"
  | "qwen" | "volcengine" | "ollama" | "openai_compatible";

interface CapabilityRequirement {
  streaming?: boolean;
  structuredOutputAtLeast?: "prompt_only" | "json_mode" | "native";
  toolCallingAtLeast?: "none" | "single" | "parallel";
  minimumContextWindow?: number;
}

interface ProviderRuntimeConfig {
  providerInstanceId: string;
  providerType: ProviderType;
  baseUrl: string;
  credentialId?: string;
  headers?: Record<string, string>; // 禁止 Authorization，由 adapter 注入
  requestTimeoutMs: number;
}

interface ModelDescriptor {
  modelId: string;
  displayName: string;
  capabilities: ModelCapabilities;
}

interface ProviderRequest {
  requestId: string;
  modelId: string;
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>;
  responseSchema?: JsonValue;
  tools?: JsonValue[];
  temperature?: number;
  maxOutputTokens: number;
  stream: boolean;
}

type ProviderEvent =
  | { type: "started"; providerRequestId?: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; callId: string; name: string; arguments: JsonValue }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "completed"; finishReason: string }
  | { type: "failed"; kind: ProviderErrorKind; retryAfterMs?: number };
```

```ts
interface ModelProviderAdapter {
  readonly providerType: ProviderType;
  testConnection(config: ProviderRuntimeConfig, signal: AbortSignal): Promise<Result<ConnectionReport>>;
  listModels(config: ProviderRuntimeConfig, signal: AbortSignal): Promise<Result<ModelDescriptor[]>>;
  generate(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
```

ProviderRequest 已统一 messages、schema、tools 和通用参数。Adapter 只做协议、认证、流解析、错误归一和 usage 映射，不决定任务路由或业务重试。

## 2. 能力

```ts
interface ModelCapabilities {
  streaming: boolean;
  structuredOutput: "native" | "json_mode" | "prompt_only" | "none";
  toolCalling: "none" | "single" | "parallel";
  vision: boolean;
  reasoning: boolean;
  contextWindow: number | null;
  maxOutputTokens: number | null;
}
```

能力来源优先级：用户明确覆盖 > 成功的本机探测 > 项目认证目录 > Provider 元数据 > conservative default。未知能力不假定支持。

## 3. Provider 实例

一个 providerType 可有多个实例。配置分为非敏感 `ProviderConfig` 和 CredentialStore 引用。Base URL 规范化：只允许 http/https；云端默认要求 HTTPS；localhost/127.0.0.1 允许 HTTP；拒绝 URL userinfo 和 fragment。

V1.0 adapter：OpenAI、Anthropic、Gemini、DeepSeek、通义千问、火山方舟、Ollama、OpenAI-compatible。认证标志只有通过当前版本契约和人工测试才展示。

## 4. 流与错误

Adapter 将 SSE、NDJSON 或 SDK stream 转为 started/text_delta/tool_call/usage/completed。单个事件最大 1 MiB，总响应受任务 token 和 16 MiB 字节双重限制。非法 UTF-8、重复 completed、完成后 delta 和无限无数据流视为协议错误。

错误统一为 ProviderErrorKind：network、timeout、rate_limit、auth、quota、model_not_found、policy_refusal、invalid_request、invalid_response、server、cancelled。保存供应商 request ID，但不把原始响应发给 Renderer。

## 5. 本地接口

应用不启动或安装模型服务。连接测试包括 TCP/HTTP、版本、模型列表、最小生成和可选 schema probe。默认地址只建议 loopback。连接私网/公网时 UI 显示数据将离开本机的明确提示。

Ollama 原生 adapter 支持其 NDJSON；其他本地服务优先 OpenAI-compatible。探测结果带时间，24 小时后或 endpoint/model 变化时失效。

## 6. 并发与限流

每 Provider 实例默认前台并发 2、后台并发 1；可根据明确 429 动态降到 1。队列前台优先，后台不能饿死超过 10 分钟。取消必须关闭网络流并释放槽位。

## 7. 测试

每 adapter 使用录制 fixture 覆盖文本、流、结构化、usage、429、401、404、5xx、断流、空响应、巨大事件、取消。真实 API 测试只在受保护环境运行。OpenAI-compatible 使用差异 fixture 验证“兼容”服务的缺失字段和非标准结束标记。
