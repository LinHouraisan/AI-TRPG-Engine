import { invoke } from "@tauri-apps/api/core";
import { getSetting, setSetting } from "@/lib/db";
import {
  DEFAULT_SETTINGS,
  PROVIDER_DEFAULTS,
  type AppSettings,
  type ProviderId,
} from "@/lib/types";

const KEYRING_KEY = "llm-api-key";

function isProviderId(value: string): value is ProviderId {
  return value in PROVIDER_DEFAULTS;
}

export async function loadSettings(): Promise<AppSettings> {
  const [provider, model, baseUrl, lastCampaignId, lastSessionId] =
    await Promise.all([
      getSetting("provider"),
      getSetting("model"),
      getSetting("baseUrl"),
      getSetting("lastCampaignId"),
      getSetting("lastSessionId"),
    ]);

  const resolvedProvider = provider && isProviderId(provider)
    ? provider
    : DEFAULT_SETTINGS.provider;

  return {
    provider: resolvedProvider,
    model: model || PROVIDER_DEFAULTS[resolvedProvider].model,
    baseUrl: baseUrl || PROVIDER_DEFAULTS[resolvedProvider].baseUrl,
    lastCampaignId: lastCampaignId ?? "",
    lastSessionId: lastSessionId ?? "",
  };
}

export async function saveSettings(
  settings: Partial<AppSettings>,
): Promise<void> {
  const entries = Object.entries(settings) as [keyof AppSettings, string][];
  await Promise.all(
    entries
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => setSetting(key, value)),
  );
}

export async function loadApiKey(): Promise<string> {
  const value = await invoke<string | null>("get_secret", { key: KEYRING_KEY });
  return value ?? "";
}

export async function saveApiKey(value: string): Promise<void> {
  await invoke("set_secret", { key: KEYRING_KEY, value });
}
