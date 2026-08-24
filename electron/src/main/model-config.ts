import { DEFAULT_CONTEXT_BUDGET_CHARS, type KeeperConfig } from "@core/keeper/config";
import type { Result } from "../shared/result";
import { fail, ok } from "../shared/result";
import type { CredentialStore } from "./credentials";
import { getSetting } from "./persist/catalog";
import type { Driver } from "./persist/driver";
import { listProfiles, listProviders, listTaskRoutes } from "./persist/providers";

function legacyConfig(settings: Driver): KeeperConfig {
  const enabled = getSetting(settings, "keeper.enabled");
  const model = getSetting(settings, "keeper.model");
  const baseUrl = getSetting(settings, "keeper.baseUrl");
  return {
    enabled: enabled === true,
    protocol: "ollama",
    baseUrl:
      typeof baseUrl === "string" && baseUrl.length > 0
        ? baseUrl
        : (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434"),
    model:
      typeof model === "string" && model.length > 0
        ? model
        : (process.env.KEEPER_MODEL ?? "qwen3.8:latest"),
    timeoutMs: 60_000,
    temperature: 0.7,
    contextBudgetChars: DEFAULT_CONTEXT_BUDGET_CHARS,
    stream: true,
    debugTrace: false,
  };
}

function providerConfig(settings: Driver): {
  config: KeeperConfig;
  credentialId: string | null;
} | null {
  const route = listTaskRoutes(settings).find((item) => item.taskType === "gm.narrate_result");
  const profile = listProfiles(settings).find(
    (item) => item.modelProfileId === route?.primaryModelProfileId && item.enabled,
  );
  const provider = listProviders(settings).find(
    (item) => item.providerInstanceId === profile?.providerInstanceId && item.enabled,
  );
  if (!profile || !provider) return null;
  const cloud = provider.providerType === "deepseek" || provider.providerType === "openai_compatible";
  return {
    credentialId: provider.credentialId,
    config: {
      enabled: true,
      protocol: cloud ? "openai_compatible" : "ollama",
      baseUrl:
        provider.baseUrl ??
        (provider.providerType === "deepseek"
          ? "https://api.deepseek.com"
          : "http://127.0.0.1:11434"),
      model: profile.modelId,
      disableThinking: provider.providerType === "deepseek",
      timeoutMs: 60_000,
      temperature: 0.7,
      contextBudgetChars: DEFAULT_CONTEXT_BUDGET_CHARS,
      stream: !cloud,
      debugTrace: false,
    },
  };
}

export function withKeeperConfig<T>(
  settings: Driver,
  credentials: CredentialStore,
  use: (config: KeeperConfig) => T,
): Result<T> {
  const selected = providerConfig(settings);
  if (!selected) return ok(use(legacyConfig(settings)));
  if (selected.config.protocol !== "openai_compatible") return ok(use(selected.config));
  if (!selected.credentialId) {
    return fail({
      code: "CREDENTIAL_NOT_FOUND",
      messageKey: "credential.not_found",
      retryable: false,
    });
  }
  return credentials.use(selected.credentialId, (apiKey) => use({ ...selected.config, apiKey }));
}
