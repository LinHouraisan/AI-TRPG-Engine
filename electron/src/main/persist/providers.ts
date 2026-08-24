import { uuidv7 } from "../../shared/ids";
import type { Driver } from "./driver";

export type ProviderType =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "qwen"
  | "volcengine"
  | "ollama"
  | "openai_compatible";

export type ProviderInstance = {
  providerInstanceId: string;
  providerType: ProviderType;
  displayName: string;
  baseUrl: string | null;
  credentialId: string | null;
  enabled: boolean;
};

export type ModelProfile = {
  modelProfileId: string;
  providerInstanceId: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
};

export type TaskRoute = {
  taskType: string;
  primaryModelProfileId: string;
  fallbackModelProfileId: string | null;
};

const DEFAULT_CAPABILITIES = JSON.stringify({
  streaming: true,
  structuredOutput: "json_mode",
  toolCalling: "none",
  vision: false,
  reasoning: false,
  contextWindow: null,
  maxOutputTokens: null,
});

const DEFAULT_GENERATION = JSON.stringify({ temperature: 0.2, maxOutputTokens: 2000 });

const TASK_TYPES = [
  "gm.handle_free_turn",
  "gm.narrate_result",
  "director.analyze_progress",
  "context.rank_relevance",
  "memory.extract",
  "memory.consolidate",
  "information.plan",
  "information.propose",
] as const;

export function listProviders(db: Driver): ProviderInstance[] {
  return db.all<{
    provider_instance_id: string;
    provider_type: string;
    display_name: string;
    base_url: string | null;
    credential_id: string | null;
    enabled: number;
  }>(
    `SELECT provider_instance_id, provider_type, display_name, base_url, credential_id, enabled
     FROM provider_instances ORDER BY created_at, provider_instance_id`,
  ).map((row) => ({
    providerInstanceId: row.provider_instance_id,
    providerType: row.provider_type as ProviderType,
    displayName: row.display_name,
    baseUrl: row.base_url,
    credentialId: row.credential_id,
    enabled: row.enabled === 1,
  }));
}

export function listProfiles(db: Driver): ModelProfile[] {
  return db.all<{
    model_profile_id: string;
    provider_instance_id: string;
    model_id: string;
    display_name: string;
    enabled: number;
  }>(
    `SELECT model_profile_id, provider_instance_id, model_id, display_name, enabled
     FROM model_profiles ORDER BY display_name, model_profile_id`,
  ).map((row) => ({
    modelProfileId: row.model_profile_id,
    providerInstanceId: row.provider_instance_id,
    modelId: row.model_id,
    displayName: row.display_name,
    enabled: row.enabled === 1,
  }));
}

export function listTaskRoutes(db: Driver): TaskRoute[] {
  return db.all<{
    task_type: string;
    primary_model_profile_id: string;
    fallback_model_profile_id: string | null;
  }>(`SELECT task_type, primary_model_profile_id, fallback_model_profile_id FROM task_routes ORDER BY task_type`).map(
    (row) => ({
      taskType: row.task_type,
      primaryModelProfileId: row.primary_model_profile_id,
      fallbackModelProfileId: row.fallback_model_profile_id,
    }),
  );
}

export function upsertProvider(
  db: Driver,
  input: {
    providerInstanceId?: string;
    providerType: ProviderType;
    displayName: string;
    baseUrl?: string | null;
    credentialId?: string | null;
    enabled: boolean;
  },
  now: string,
): ProviderInstance {
  const id = input.providerInstanceId ?? uuidv7();
  const existing = db.get<{ provider_instance_id: string }>(
    "SELECT provider_instance_id FROM provider_instances WHERE provider_instance_id = ?",
    [id],
  );
  if (existing) {
    db.run(
      `UPDATE provider_instances
       SET provider_type = ?, display_name = ?, base_url = ?, credential_id = ?, enabled = ?, updated_at = ?
       WHERE provider_instance_id = ?`,
      [
        input.providerType,
        input.displayName,
        input.baseUrl ?? null,
        input.credentialId ?? null,
        input.enabled ? 1 : 0,
        now,
        id,
      ],
    );
  } else {
    db.run(
      `INSERT INTO provider_instances (
        provider_instance_id, provider_type, display_name, base_url, credential_id,
        config_json, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
      [
        id,
        input.providerType,
        input.displayName,
        input.baseUrl ?? null,
        input.credentialId ?? null,
        input.enabled ? 1 : 0,
        now,
        now,
      ],
    );
  }
  const row = listProviders(db).find((item) => item.providerInstanceId === id);
  if (!row) throw new Error("provider upsert failed");
  return row;
}

export function deleteProvider(db: Driver, providerInstanceId: string): void {
  db.transaction(() => {
    const profiles = db.all<{ model_profile_id: string }>(
      "SELECT model_profile_id FROM model_profiles WHERE provider_instance_id = ?",
      [providerInstanceId],
    );
    for (const profile of profiles) {
      db.run("DELETE FROM task_routes WHERE primary_model_profile_id = ? OR fallback_model_profile_id = ?", [
        profile.model_profile_id,
        profile.model_profile_id,
      ]);
    }
    db.run("DELETE FROM model_profiles WHERE provider_instance_id = ?", [providerInstanceId]);
    db.run("DELETE FROM provider_instances WHERE provider_instance_id = ?", [providerInstanceId]);
  });
}

export function upsertProfile(
  db: Driver,
  input: {
    modelProfileId?: string;
    providerInstanceId: string;
    modelId: string;
    displayName: string;
    enabled: boolean;
  },
  now: string,
): ModelProfile {
  const id = input.modelProfileId ?? uuidv7();
  const existing = db.get<{ model_profile_id: string }>(
    "SELECT model_profile_id FROM model_profiles WHERE model_profile_id = ?",
    [id],
  );
  if (existing) {
    db.run(
      `UPDATE model_profiles
       SET provider_instance_id = ?, model_id = ?, display_name = ?, enabled = ?
       WHERE model_profile_id = ?`,
      [input.providerInstanceId, input.modelId, input.displayName, input.enabled ? 1 : 0, id],
    );
  } else {
    db.run(
      `INSERT INTO model_profiles (
        model_profile_id, provider_instance_id, model_id, display_name,
        capabilities_json, generation_defaults_json, capability_source, probed_at, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, 'user', NULL, ?)`,
      [
        id,
        input.providerInstanceId,
        input.modelId,
        input.displayName,
        DEFAULT_CAPABILITIES,
        DEFAULT_GENERATION,
        input.enabled ? 1 : 0,
      ],
    );
  }
  const row = listProfiles(db).find((item) => item.modelProfileId === id);
  if (!row) throw new Error("profile upsert failed");
  return row;
}

export function setTaskRoute(
  db: Driver,
  input: { taskType: string; primaryModelProfileId: string; fallbackModelProfileId?: string | null },
  now: string,
): TaskRoute {
  db.run(
    `INSERT INTO task_routes (task_type, primary_model_profile_id, fallback_model_profile_id, budget_json, updated_at)
     VALUES (?, ?, ?, '{"maxOutputTokens":2000}', ?)
     ON CONFLICT(task_type) DO UPDATE SET
       primary_model_profile_id = excluded.primary_model_profile_id,
       fallback_model_profile_id = excluded.fallback_model_profile_id,
       updated_at = excluded.updated_at`,
    [input.taskType, input.primaryModelProfileId, input.fallbackModelProfileId ?? null, now],
  );
  return {
    taskType: input.taskType,
    primaryModelProfileId: input.primaryModelProfileId,
    fallbackModelProfileId: input.fallbackModelProfileId ?? null,
  };
}

/** First-run DeepSeek row. The credential is attached after the user saves it. */
export function ensureDefaultProvider(db: Driver, now: string, _model: string, _baseUrl: string): void {
  if (listProviders(db).length > 0) return;
  const provider = upsertProvider(
    db,
    {
      providerType: "deepseek",
      displayName: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      enabled: true,
    },
    now,
  );
  const profile = upsertProfile(
    db,
    {
      providerInstanceId: provider.providerInstanceId,
      modelId: "deepseek-v4-flash",
      displayName: "deepseek-v4-flash",
      enabled: true,
    },
    now,
  );
  for (const taskType of TASK_TYPES) {
    setTaskRoute(db, { taskType, primaryModelProfileId: profile.modelProfileId }, now);
  }
}

export { TASK_TYPES };
