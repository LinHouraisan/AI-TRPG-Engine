/**
 * LangChain 模型工厂。
 *
 * 引擎里已有的 keeper client 负责"一次调用换一个契约对象"；
 * 这一层只把同一份 KeeperConfig 变成 LangChain 的 ChatModel，
 * 让叙述 / NPC / 规则三条链路复用同一套模型配置、超时与回退约定。
 *
 * 基座与 LoRA 微调模型在这里切换，链路代码不需要知道用的是哪个。
 */
import { ChatOpenAI } from "@langchain/openai";
import type { KeeperConfig } from "@core/keeper/config";

export type LcModelOptions = {
  /** 给出则走微调模型端点，否则走配置里的基座模型 */
  loraModel?: string;
  loraBaseUrl?: string;
  temperature?: number;
  maxTokens?: number;
};

/** Ollama 自 0.6 起提供 /v1 的 OpenAI 兼容入口，本地模型也能进同一条链路。 */
export function openAiCompatibleBaseUrl(config: KeeperConfig): string {
  const base = config.baseUrl.replace(/\/$/, "");
  return config.protocol === "openai_compatible" ? base : `${base}/v1`;
}

export function chatModelFrom(config: KeeperConfig, options: LcModelOptions = {}): ChatOpenAI {
  const useLora = Boolean(options.loraModel);
  const baseURL = useLora
    ? (options.loraBaseUrl ?? "").replace(/\/$/, "")
    : openAiCompatibleBaseUrl(config);
  if (!baseURL) throw new Error("LangChain 链路缺少模型地址");

  return new ChatOpenAI({
    model: useLora ? (options.loraModel as string) : config.model,
    apiKey: config.protocol === "openai_compatible" ? (config.apiKey ?? "") : "ollama",
    temperature: options.temperature ?? config.temperature,
    maxTokens: options.maxTokens ?? 512,
    timeout: config.timeoutMs,
    configuration: { baseURL },
  });
}
