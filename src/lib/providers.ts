import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { loadApiKey, loadSettings } from "@/lib/settings";
import { PROVIDER_DEFAULTS, type AppSettings, type ProviderId } from "@/lib/types";

const llmFetch = tauriFetch as unknown as typeof globalThis.fetch;

export async function createLanguageModel(settings?: AppSettings) {
  const resolved = settings ?? (await loadSettings());
  const apiKey = await loadApiKey();
  const model = resolved.model.trim();
  if (!model) {
    throw new Error("请先在设置里选好一个模型。");
  }

  switch (resolved.provider) {
    case "anthropic":
      if (!apiKey) throw new Error("请先在设置里填入 Anthropic 的 API 密钥。");
      return createAnthropic({ apiKey, fetch: llmFetch })(model);
    case "openai":
      if (!apiKey) throw new Error("请先在设置里填入 OpenAI 的 API 密钥。");
      return createOpenAI({ apiKey, fetch: llmFetch })(model);
    case "openrouter":
      if (!apiKey) throw new Error("请先在设置里填入 OpenRouter 的 API 密钥。");
      return createOpenAICompatible({
        name: "openrouter",
        baseURL: resolved.baseUrl || PROVIDER_DEFAULTS.openrouter.baseUrl,
        apiKey,
        fetch: llmFetch,
      })(model);
    case "ollama":
    case "lmstudio":
    case "custom":
      return createOpenAICompatible({
        name: resolved.provider,
        baseURL: resolved.baseUrl || PROVIDER_DEFAULTS[resolved.provider].baseUrl,
        apiKey: apiKey || "local",
        fetch: llmFetch,
      })(model);
  }
}

export async function listRemoteModels(
  provider: ProviderId,
  baseUrl: string,
  apiKey: string,
): Promise<string[]> {
  try {
    if (provider === "ollama") {
      const root = baseUrl.replace(/\/v1\/?$/, "");
      const response = await tauriFetch(`${root}/api/tags`);
      if (!response.ok) return [];
      const data = (await response.json()) as {
        models?: { name?: string }[];
      };
      return (data.models ?? [])
        .map((item) => item.name)
        .filter((name): name is string => Boolean(name));
    }

    const response = await tauriFetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { data?: { id?: string }[] };
    return (data.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}
