/**
 * 脚本侧的模型配置。
 *
 * 应用里（Electron Main）配置由用户在设置界面填、密钥由 safeStorage 加密；
 * 脚本没有界面，所以走 `electron/.env`（Bun 会自动加载 cwd 下的 .env）。
 * 两边产出的都是同一个 `KeeperConfig`，链路代码无感。
 *
 * 对话与向量化**分开配置**：DeepSeek 未提供 embeddings 接口，
 * 所以向量化必须另指一家支持 `/embeddings` 的服务（硅基流动、智谱、OpenAI 等）。
 */
import { DEFAULT_CONTEXT_BUDGET_CHARS, type KeeperConfig } from "@core/keeper/config";
import { ollamaEmbedder, openAiEmbedder, type Embedder } from "@core/ai/lc";

function need(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`缺少环境变量 ${name}。在 electron/.env 里按 .env.example 填好再跑。`);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** 对话模型配置：baseUrl / model / apiKey 必填。 */
export function scriptChatConfig(): KeeperConfig {
  const protocol = (process.env.LC_PROTOCOL as KeeperConfig["protocol"]) ?? "openai_compatible";
  return {
    enabled: true,
    protocol,
    baseUrl: need("LC_BASE_URL", process.env.LC_BASE_URL),
    apiKey: process.env.LC_API_KEY,
    model: need("LC_MODEL", process.env.LC_MODEL),
    // 合成数据与裁判都是长输出，超时给宽；比应用里的 60s 更长。
    timeoutMs: num("LC_TIMEOUT_MS", 120_000),
    temperature: num("LC_TEMPERATURE", 0.7),
    contextBudgetChars: DEFAULT_CONTEXT_BUDGET_CHARS,
    stream: false,
    debugTrace: false,
  };
}

/** 向量化配置：与对话独立，允许指向另一家服务。 */
export function scriptEmbedder(): Embedder {
  const protocol = process.env.LC_EMBED_PROTOCOL ?? "openai_compatible";
  if (protocol === "ollama") {
    return ollamaEmbedder(
      process.env.LC_EMBED_BASE_URL ?? "http://127.0.0.1:11434",
      process.env.LC_EMBED_MODEL ?? "bge-m3",
      num("LC_EMBED_TIMEOUT_MS", 60_000),
    );
  }
  return openAiEmbedder({
    baseUrl: need("LC_EMBED_BASE_URL", process.env.LC_EMBED_BASE_URL),
    apiKey: process.env.LC_EMBED_API_KEY,
    model: process.env.LC_EMBED_MODEL,
    timeoutMs: num("LC_EMBED_TIMEOUT_MS", 60_000),
  });
}
