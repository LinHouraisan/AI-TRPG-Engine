import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialStore } from "../main/credentials";
import { withKeeperConfig } from "../main/model-config";
import { openBun } from "../main/persist/bun-driver";
import { applyInit } from "../main/persist/migrate";
import { setTaskRoute, upsertProfile, upsertProvider } from "../main/persist/providers";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = join(import.meta.dir, "..");
const scratch = mkdtempSync(join(tmpdir(), "ai-trpg-cloud-"));
const credentialsFile = join(scratch, "credentials.json");
const db = openBun(":memory:");
const clock = { nowIso: () => "2026-08-23T00:00:00.000Z" };

try {
  applyInit(db, clock, readFileSync(join(root, "sql/settings.sql"), "utf8"), "0001_init");
  const credentials = new CredentialStore(credentialsFile, clock, {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`cipher:${plain}`),
    decryptString: (cipher) => cipher.toString().replace(/^cipher:/, ""),
  });
  const saved = credentials.set({ value: "deepseek-test-secret" });
  assert(saved.ok, "test credential should save");

  const provider = upsertProvider(
    db,
    {
      providerType: "deepseek",
      displayName: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      credentialId: saved.value.credentialId,
      enabled: true,
    },
    clock.nowIso(),
  );
  const profile = upsertProfile(
    db,
    {
      providerInstanceId: provider.providerInstanceId,
      modelId: "deepseek-v4-flash",
      displayName: "DeepSeek V4 Flash",
      enabled: true,
    },
    clock.nowIso(),
  );
  setTaskRoute(db, { taskType: "gm.narrate_result", primaryModelProfileId: profile.modelProfileId }, clock.nowIso());

  const resolved = withKeeperConfig(db, credentials, (config) => ({
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
  }));
  assert(resolved.ok, "DeepSeek config should resolve");
  assert(resolved.value.protocol === "openai_compatible", "DeepSeek should use OpenAI-compatible protocol");
  assert(resolved.value.baseUrl === "https://api.deepseek.com", "DeepSeek base URL should resolve");
  assert(resolved.value.model === "deepseek-v4-flash", "DeepSeek model should resolve");
  assert(resolved.value.apiKey === "deepseek-test-secret", "credential should be available only to callback");
  assert(!readFileSync(credentialsFile, "utf8").includes("deepseek-test-secret"), "credential file must not contain plaintext");
  console.log("✓ DeepSeek provider route resolves with encrypted credential");
} finally {
  db.close();
  rmSync(scratch, { recursive: true, force: true });
}
