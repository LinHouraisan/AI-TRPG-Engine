/**
 * 长期记忆的语义检索（RAG）。
 *
 * 与 `ai/memory.ts` 的关系：记忆条目仍然是结构化的、带来源的事实；
 * 这里只负责"按语义把相关条目找出来"，命中的文本进 prompt，**不写回记忆**。
 * 模型因此拿得到跨场景的旧信息，但事实权威仍然在内核手里。
 *
 * 向量化默认走本地（Ollama 的 bge-m3），远端 OpenAI 兼容接口同签名可用。
 * 索引是纯 JSON，能随存档一起走，也可以离线重建。
 */
import type { KeeperConfig } from "@core/keeper/config";
import type { MemoryEntry } from "@core/ai/memory";

export type EmbeddedDoc = { id: string; text: string; source: string; vector: number[] };
export type VectorIndex = { dim: number; docs: EmbeddedDoc[] };
export type RetrievedDoc = { id: string; text: string; source: string; score: number };
export type Embedder = (texts: string[]) => Promise<number[][]>;

export function emptyIndex(): VectorIndex {
  return { dim: 0, docs: [] };
}

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function buildIndex(
  embed: Embedder,
  docs: { id: string; text: string; source?: string }[],
): Promise<VectorIndex> {
  if (docs.length === 0) return emptyIndex();
  const vectors = await embed(docs.map((doc) => doc.text));
  return {
    dim: vectors[0]?.length ?? 0,
    docs: docs.map((doc, i) => ({
      id: doc.id,
      text: doc.text,
      source: doc.source ?? "unknown",
      vector: vectors[i] ?? [],
    })),
  };
}

export async function search(
  index: VectorIndex,
  embed: Embedder,
  query: string,
  k = 3,
): Promise<RetrievedDoc[]> {
  if (index.docs.length === 0) return [];
  const [queryVector] = await embed([query]);
  if (!queryVector) return [];
  return index.docs
    .map((doc) => ({
      id: doc.id,
      text: doc.text,
      source: doc.source,
      score: cosine(queryVector, doc.vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** 只索引 active 条目：被取代 / 冲突的记忆不该被检索出来当事实用。 */
export function memoryDocs(entries: MemoryEntry[]): { id: string; text: string; source: string }[] {
  return entries
    .filter((entry) => entry.status === "active")
    .map((entry) => ({
      id: entry.id,
      text: entry.summary,
      source: entry.memoryType,
    }));
}

export async function indexFromMemory(
  embed: Embedder,
  entries: MemoryEntry[],
): Promise<VectorIndex> {
  return buildIndex(embed, memoryDocs(entries));
}

export function indexToJson(index: VectorIndex): string {
  return JSON.stringify(index);
}

export function indexFromJson(raw: string): VectorIndex {
  try {
    const parsed = JSON.parse(raw) as VectorIndex;
    if (!parsed || !Array.isArray(parsed.docs)) return emptyIndex();
    return parsed;
  } catch {
    return emptyIndex();
  }
}

export function ollamaEmbedder(baseUrl: string, model = "bge-m3", timeoutMs = 30_000): Embedder {
  return async (texts) => {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model, input: texts }),
    });
    if (!response.ok) throw new Error(`本地向量化失败：${response.status}`);
    const body = (await response.json()) as { embeddings?: number[][] };
    return body.embeddings ?? [];
  };
}

export function openAiEmbedder(params: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): Embedder {
  return async (texts) => {
    const response = await fetch(`${params.baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.apiKey ?? ""}`,
      },
      signal: AbortSignal.timeout(params.timeoutMs ?? 30_000),
      body: JSON.stringify({ model: params.model ?? "text-embedding-3-small", input: texts }),
    });
    if (!response.ok) throw new Error(`远端向量化失败：${response.status}`);
    const body = (await response.json()) as { data?: { embedding?: number[] }[] };
    return (body.data ?? []).map((item) => item.embedding ?? []);
  };
}

/** 按 KeeperConfig 选本地还是远端向量化；本地优先，符合"RAG 本地"的部署要求。 */
export function embedderFrom(config: KeeperConfig, model?: string): Embedder {
  return config.protocol === "openai_compatible"
    ? openAiEmbedder({ baseUrl: config.baseUrl, apiKey: config.apiKey, model })
    : ollamaEmbedder(config.baseUrl, model);
}
