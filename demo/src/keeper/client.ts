import type { z } from "zod";
import type { KeeperConfig } from "./config";

export class KeeperError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "timeout" | "malformed" | "contract",
  ) {
    super(message);
    this.name = "KeeperError";
  }
}

/**
 * 一次主持人调用。
 *
 * 出去的是提示词，回来的必须是一个通过契约校验的对象；
 * 任何一步不对——连不上、超时、不是 JSON、字段不合法——都抛错，
 * 由调用方退回确定性模板。模型出错不该让一场团停下来。
 *
 * 流式时 onContent 收到的是模型 JSON 的累积碎片。调用方必须自己从里面
 * 抽出可读的叙述；半截 JSON 不能直接给人看。
 */
export async function askKeeper<T>(params: {
  config: KeeperConfig;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  jsonSchema: unknown;
  maxTokens?: number;
  signal?: AbortSignal;
  stream?: boolean;
  onContent?: (accumulatedJson: string) => void;
}): Promise<{ value: T; ms: number }> {
  const { config, schema, jsonSchema } = params;
  const started = Date.now();
  const protocol = config.protocol ?? "ollama";
  const streaming = protocol === "ollama" && params.stream === true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  params.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  let response: Response;
  try {
    response =
      protocol === "openai_compatible"
        ? await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${config.apiKey ?? ""}`,
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: config.model,
              stream: false,
              response_format: { type: "json_object" },
              ...(config.disableThinking ? { thinking: { type: "disabled" } } : {}),
              temperature: config.temperature,
              max_tokens: params.maxTokens ?? 320,
              messages: [
                { role: "system", content: params.system },
                { role: "user", content: params.user },
              ],
            }),
          })
        : await fetch(`${config.baseUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              model: config.model,
              stream: streaming,
              // 思考链对叙述没有帮助，只会把首字延迟拖到几十秒。
              think: false,
              format: jsonSchema,
              options: {
                temperature: config.temperature,
                num_predict: params.maxTokens ?? 320,
              },
              messages: [
                { role: "system", content: params.system },
                { role: "user", content: params.user },
              ],
            }),
          });
  } catch (error) {
    clearTimeout(timer);
    throw toConnectError(error, config.timeoutMs);
  }

  if (!response.ok) {
    clearTimeout(timer);
    throw new KeeperError(`主持人返回 ${response.status}`, "network");
  }

  let content: string;
  try {
    content =
      protocol === "openai_compatible"
        ? await readOpenAiChatOnce(response)
        : streaming
          ? await readOllamaChatStream(response, params.onContent)
          : await readOllamaChatOnce(response);
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof KeeperError) throw error;
    throw toConnectError(error, config.timeoutMs, streaming);
  }
  clearTimeout(timer);

  return { value: parseKeeperReply(content, schema), ms: Date.now() - started };
}

async function readOpenAiChatOnce(response: Response): Promise<string> {
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return body.choices?.[0]?.message?.content ?? "";
}

function toConnectError(error: unknown, timeoutMs: number, streaming = false): KeeperError {
  const aborted = error instanceof Error && error.name === "AbortError";
  if (aborted) return new KeeperError(`主持人超时（${timeoutMs} 毫秒）`, "timeout");
  if (streaming) {
    return new KeeperError(`主持人说到一半断开了：${String(error)}`, "network");
  }
  return new KeeperError(`连不上主持人：${String(error)}`, "network");
}

async function readOllamaChatOnce(response: Response): Promise<string> {
  const body = (await response.json()) as { message?: { content?: string } };
  return body.message?.content ?? "";
}

/**
 * Ollama stream:true 时逐行返回信封 JSON，message.content 是增量碎片。
 * 拼起来才是模型的那份 {"text":"..."}；没拼完就当连接断了。
 */
async function readOllamaChatStream(
  response: Response,
  onContent?: (accumulatedJson: string) => void,
): Promise<string> {
  if (!response.body) {
    throw new KeeperError("主持人没有给出响应正文", "network");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  const consume = (line: string) => {
    accumulated = applyChatLine(line, accumulated, onContent);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);

  return accumulated;
}

function applyChatLine(
  line: string,
  accumulated: string,
  onContent?: (accumulatedJson: string) => void,
): string {
  const trimmed = line.trim();
  if (!trimmed) return accumulated;

  let chunk: { message?: { content?: string }; error?: string };
  try {
    chunk = JSON.parse(trimmed) as typeof chunk;
  } catch {
    throw new KeeperError(`主持人流式输出不是 JSON：${trimmed.slice(0, 120)}`, "malformed");
  }
  if (chunk.error) {
    throw new KeeperError(`主持人返回错误：${chunk.error}`, "network");
  }
  const piece = chunk.message?.content ?? "";
  if (!piece) return accumulated;
  const next = accumulated + piece;
  onContent?.(next);
  return next;
}

function parseKeeperReply<T>(content: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new KeeperError(`主持人没有给出 JSON：${content.slice(0, 120)}`, "malformed");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new KeeperError(`主持人的回复不合契约：${result.error.issues[0]?.message}`, "contract");
  }
  return result.data;
}

/**
 * 从尚未收全的 `{"text":"..."}` 里抽出已经写出来的叙述。
 * 还没读到 text 字符串时返回 undefined——宁可暂时不显示，也不把半截 JSON 甩给玩家。
 */
export function extractNarrationDraft(jsonFragment: string): string | undefined {
  const key = '"text"';
  let searchFrom = 0;
  while (searchFrom < jsonFragment.length) {
    const at = jsonFragment.indexOf(key, searchFrom);
    if (at < 0) return undefined;
    let i = at + key.length;
    i = skipJsonSpace(jsonFragment, i);
    if (i >= jsonFragment.length) return undefined;
    if (jsonFragment[i] !== ":") {
      searchFrom = at + 1;
      continue;
    }
    i = skipJsonSpace(jsonFragment, i + 1);
    if (i >= jsonFragment.length) return undefined;
    if (jsonFragment[i] !== '"') return undefined;
    return decodeJsonStringPrefix(jsonFragment, i + 1);
  }
  return undefined;
}

function skipJsonSpace(source: string, from: number): number {
  let i = from;
  while (i < source.length) {
    const ch = source[i];
    if (ch !== " " && ch !== "\n" && ch !== "\r" && ch !== "\t") break;
    i += 1;
  }
  return i;
}

/** 解码 JSON 字符串的已经到达的前缀；碰到不完整的转义就停在转义之前。 */
function decodeJsonStringPrefix(source: string, start: number): string {
  let out = "";
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === '"') return out;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = source[i + 1];
    if (next === undefined) return out;
    i += 1;
    switch (next) {
      case '"':
      case "\\":
      case "/":
        out += next;
        break;
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case "u": {
        const hex = source.slice(i + 1, i + 5);
        if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return out;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 4;
        break;
      }
      default:
        out += next;
    }
  }
  return out;
}

/** 连通性自检：顺带确认配置里那个模型真的在这台机器上。 */
export async function pingKeeper(config: KeeperConfig): Promise<string[]> {
  if (config.protocol === "openai_compatible") {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/models`, {
      headers: { authorization: `Bearer ${config.apiKey ?? ""}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new KeeperError(`主持人返回 ${response.status}`, "network");
    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    return (body.data ?? []).flatMap((item) => (item.id ? [item.id] : []));
  }
  const response = await fetch(`${config.baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new KeeperError(`主持人返回 ${response.status}`, "network");
  const body = (await response.json()) as { models?: { name: string }[] };
  return (body.models ?? []).map((m) => m.name);
}
