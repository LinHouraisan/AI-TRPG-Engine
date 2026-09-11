/**
 * 三条 LangChain 链路。
 *
 * narrateTurn   —— GM 自由叙述，可选注入 RAG 检索结果；
 * npcTurn       —— NPC 对话，带人格与立场；
 * resolveWithRules —— 规则 Agent，点数只能来自工具（内核种子 RNG）。
 *
 * 这三条都不写状态。事实仍然只由内核的事件与事实增量产生。
 */
import { createAgent } from "langchain";
import type { BaseMessage } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import type { KeeperConfig } from "@core/keeper/config";
import { type LcModelOptions, chatModelFrom } from "./provider";
import { gmNarrationPrompt, npcPrompt, RULES_AGENT_SYSTEM } from "./prompts";
import { createRuleTools, type DiceSeed } from "./tools";
import { search, type Embedder, type RetrievedDoc, type VectorIndex } from "./retrieval";

export type NarrationResult = {
  text: string;
  usedRag: boolean;
  hits: RetrievedDoc[];
};

const NO_HIT = "（没有检索到相关记忆）";

async function recall(params: {
  input: string;
  index?: VectorIndex;
  embed?: Embedder;
  topK?: number;
}): Promise<RetrievedDoc[]> {
  if (!params.index || !params.embed) return [];
  return search(params.index, params.embed, params.input, params.topK ?? 3);
}

function modelOptions(config: KeeperConfig, lora?: LcModelOptions): LcModelOptions {
  return {
    loraModel: lora?.loraModel,
    loraBaseUrl: lora?.loraBaseUrl,
    temperature: lora?.temperature ?? config.temperature,
    maxTokens: lora?.maxTokens ?? 512,
  };
}

export async function narrateTurn(params: {
  config: KeeperConfig;
  input: string;
  history?: BaseMessage[];
  index?: VectorIndex;
  embed?: Embedder;
  topK?: number;
  lora?: LcModelOptions;
}): Promise<NarrationResult> {
  const hits = await recall(params);
  const context = hits.length > 0 ? hits.map((hit) => hit.text).join("\n---\n") : NO_HIT;
  const model = chatModelFrom(params.config, modelOptions(params.config, params.lora));
  const chain = gmNarrationPrompt.pipe(model).pipe(new StringOutputParser());
  const text = await chain.invoke({
    context,
    history: params.history ?? [],
    input: params.input,
  });
  return { text, usedRag: hits.length > 0, hits };
}

export async function npcTurn(params: {
  config: KeeperConfig;
  npcName: string;
  persona: string;
  stance: string;
  input: string;
  history?: BaseMessage[];
  index?: VectorIndex;
  embed?: Embedder;
  topK?: number;
}): Promise<NarrationResult> {
  const hits = await recall(params);
  const context = hits.length > 0 ? hits.map((hit) => hit.text).join("\n---\n") : NO_HIT;
  const model = chatModelFrom(params.config, { temperature: 0.9, maxTokens: 256 });
  const chain = npcPrompt.pipe(model).pipe(new StringOutputParser());
  const text = await chain.invoke({
    npc_name: params.npcName,
    persona: params.persona,
    stance: params.stance,
    context,
    history: params.history ?? [],
    input: params.input,
  });
  return { text, usedRag: hits.length > 0, hits };
}

/**
 * 规则判定 Agent。模型只决定"要不要掷、掷什么"，点数由工具给。
 * LangChain 1.x 的 createAgent；低版本请改用 langchain-classic 的等价实现。
 */
export async function resolveWithRules(params: {
  config: KeeperConfig;
  action: string;
  seed: DiceSeed;
}): Promise<string> {
  const model = chatModelFrom(params.config, { temperature: 0.1, maxTokens: 256 });
  const agent = createAgent({
    model,
    tools: createRuleTools(params.seed),
    systemPrompt: RULES_AGENT_SYSTEM,
  });
  const result = (await agent.invoke({
    messages: [{ role: "user", content: params.action }],
  })) as { messages?: { content?: unknown }[] };

  const last = result.messages?.at(-1);
  return typeof last?.content === "string" ? last.content : "";
}
