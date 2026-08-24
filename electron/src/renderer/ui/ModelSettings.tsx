import { useEffect, useRef, useState } from "react";
import { desktopApi } from "@renderer/desktop";
import { deepSeekPreset, providerPatchForType, secretStateAfterSave } from "./model-settings-state";

type Provider = {
  providerInstanceId: string;
  providerType: string;
  displayName: string;
  baseUrl: string | null;
  credentialId: string | null;
  enabled: boolean;
};

type Profile = {
  modelProfileId: string;
  providerInstanceId: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
};

type Route = {
  taskType: string;
  primaryModelProfileId: string;
  fallbackModelProfileId: string | null;
};

const TASKS = ["gm.narrate_result"];

/** V1 settings tables: provider_instances / model_profiles / task_routes. Desktop only. */
export function ModelSettings() {
  const api = desktopApi();
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [secretPresent, setSecretPresent] = useState(false);
  const [usage, setUsage] = useState<{ calls: number; promptTokens: number; completionTokens: number; estimatedMicros: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function reload() {
    if (!api) return;
    const [p, m, r, u] = await Promise.all([
      api.settings.listProviders(),
      api.settings.listProfiles(),
      api.settings.listTaskRoutes(),
      api.settings.getModelUsage(),
    ]);
    if (p.ok) setProviders(p.value);
    if (m.ok) setProfiles(m.value);
    if (r.ok) setRoutes(r.value);
    if (u.ok) setUsage(u.value);
    const first = p.ok ? p.value[0] : undefined;
    if (first?.credentialId) {
      const present = await api.settings.hasSecret({ credentialId: first.credentialId });
      setSecretPresent(present.ok && present.value.present);
    } else {
      setSecretPresent(false);
    }
  }

  useEffect(() => {
    if (open) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!api) return null;

  const provider = providers[0];
  const profile = profiles.find((item) => item.providerInstanceId === provider?.providerInstanceId) ?? profiles[0];

  async function saveProvider(patch: Partial<Provider> & { modelId?: string }) {
    if (!api || !provider) return;
    const next = await api.settings.upsertProvider({
      providerInstanceId: provider.providerInstanceId,
      providerType: patch.providerType ?? provider.providerType,
      displayName: patch.displayName ?? provider.displayName,
      baseUrl: patch.baseUrl === undefined ? provider.baseUrl : patch.baseUrl,
      credentialId: patch.credentialId === undefined ? provider.credentialId : patch.credentialId,
      enabled: patch.enabled ?? provider.enabled,
    });
    if (!next.ok) {
      setNote(next.error.code);
      return;
    }
    if (profile && patch.modelId) {
      await api.settings.upsertProfile({
        modelProfileId: profile.modelProfileId,
        providerInstanceId: provider.providerInstanceId,
        modelId: patch.modelId,
        displayName: patch.modelId,
        enabled: true,
      });
      await api.settings.set({ key: "keeper.model", value: patch.modelId });
    }
    if (patch.baseUrl !== undefined) {
      await api.settings.set({ key: "keeper.baseUrl", value: patch.baseUrl });
    }
    if (patch.enabled !== undefined) {
      await api.settings.set({ key: "keeper.enabled", value: patch.enabled });
    }
    setNote("已写入 settings.sqlite");
    await reload();
  }

  async function useDeepSeek() {
    const preset = deepSeekPreset();
    await saveProvider({ ...preset, enabled: true });
    setNote("已选择 DeepSeek；请保存 API Key 后测试连接");
  }

  async function saveSecret() {
    if (!api || !provider || !secret) return;
    const saved = await api.settings.setSecret({
      credentialId: provider.credentialId ?? undefined,
      value: secret,
    });
    if (!saved.ok) {
      setNote(saved.error.code);
      return;
    }
    setSecret(secretStateAfterSave(secret));
    await saveProvider({ credentialId: saved.value.credentialId });
    setSecretPresent(true);
    setNote("API Key 已由系统加密保存");
  }

  async function deleteSecret() {
    if (!api || !provider?.credentialId) return;
    const deleted = await api.settings.deleteSecret({ credentialId: provider.credentialId });
    if (!deleted.ok) {
      setNote(deleted.error.code);
      return;
    }
    await saveProvider({ credentialId: null });
    setSecretPresent(false);
    setNote("API Key 已删除");
  }

  async function testProvider() {
    if (!api) return;
    setNote("正在测试连接…");
    const tested = await api.settings.testProvider();
    setNote(
      tested.ok
        ? `连接成功；模型${tested.value.modelFound ? "存在" : "不存在"}，生成${tested.value.generationOk ? "通过" : "失败"}，JSON ${tested.value.jsonOk ? "通过" : "失败"}`
        : `连接失败：${tested.error.messageKey}`,
    );
  }

  async function setRoute(taskType: string, primaryModelProfileId: string) {
    if (!api) return;
    await api.settings.setTaskRoute({ taskType, primaryModelProfileId });
    await reload();
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="min-h-11 rounded border border-line/70 px-2.5 text-[13px] transition hover:border-brass/60 hover:text-brass md:min-h-0 md:px-2.5 md:py-1"
      >
        设置
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-[min(22rem,calc(100vw-1.5rem))] space-y-2 rounded-lg border border-line/70 bg-ink-2 p-3 text-[13px] shadow-lg">
          <p className="text-[11px] text-muted">
            provider_instances / model_profiles / task_routes。密钥走 setSecret，这里不写明文。
          </p>
          {provider ? (
            <>
              <button
                type="button"
                onClick={() => void useDeepSeek()}
                className="min-h-11 w-full rounded border border-brass/60 px-3 text-brass md:min-h-0 md:py-1"
              >
                使用 DeepSeek 云端
              </button>
              <label className="flex min-h-11 items-center justify-between">
                <span>启用</span>
                <input
                  type="checkbox"
                  checked={provider.enabled}
                  onChange={(event) => void saveProvider({ enabled: event.target.checked })}
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted">供应商</span>
                <select
                  value={provider.providerType}
                  onChange={(event) => void saveProvider(providerPatchForType(event.target.value))}
                  className="mt-1 w-full rounded border border-line/70 bg-ink-3/50 px-2 py-1"
                >
                  <option value="ollama">ollama</option>
                  <option value="openai_compatible">openai_compatible</option>
                  <option value="openai">openai</option>
                  <option value="deepseek">deepseek</option>
                  <option value="qwen">qwen</option>
                </select>
              </label>
              {provider.providerType === "deepseek" || provider.providerType === "openai_compatible" ? (
                <div className="space-y-2 border-t border-line/40 pt-2">
                  <label className="block">
                    <span className="text-[11px] text-muted">
                      API Key（{secretPresent ? "已加密保存" : "尚未保存"}）
                    </span>
                    <input
                      type="password"
                      value={secret}
                      autoComplete="off"
                      placeholder={secretPresent ? "输入新密钥可替换" : "sk-…"}
                      onChange={(event) => setSecret(event.target.value)}
                      className="mt-1 w-full rounded border border-line/70 bg-ink-3/50 px-2 py-1"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!secret}
                      onClick={() => void saveSecret()}
                      className="min-h-11 rounded border border-line/70 px-3 disabled:opacity-40 md:min-h-0 md:py-1"
                    >
                      保存密钥
                    </button>
                    <button
                      type="button"
                      disabled={!secretPresent}
                      onClick={() => void testProvider()}
                      className="min-h-11 rounded border border-line/70 px-3 disabled:opacity-40 md:min-h-0 md:py-1"
                    >
                      测试连接
                    </button>
                    <button
                      type="button"
                      disabled={!secretPresent}
                      onClick={() => void deleteSecret()}
                      className="min-h-11 rounded border border-line/70 px-3 text-muted disabled:opacity-40 md:min-h-0 md:py-1"
                    >
                      删除密钥
                    </button>
                  </div>
                </div>
              ) : null}
              <label className="block">
                <span className="text-[11px] text-muted">Base URL</span>
                <input
                  value={provider.baseUrl ?? ""}
                  onChange={(event) => void saveProvider({ baseUrl: event.target.value })}
                  className="mt-1 w-full rounded border border-line/70 bg-ink-3/50 px-2 py-1"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted">模型</span>
                <input
                  value={profile?.modelId ?? ""}
                  onChange={(event) => void saveProvider({ modelId: event.target.value })}
                  className="mt-1 w-full rounded border border-line/70 bg-ink-3/50 px-2 py-1"
                />
              </label>
              <div className="border-t border-line/40 pt-2">
                {usage ? <p className="mb-1 text-[11px] text-muted">云调用 {usage.calls} 次，Token {usage.promptTokens + usage.completionTokens}</p> : null}
                <p className="text-[11px] text-muted">当前仅云端生成 GM 叙述；后台任务保持本地确定性。</p>
                {TASKS.map((task) => {
                  const route = routes.find((item) => item.taskType === task);
                  return (
                    <label key={task} className="mt-1 block text-[11px]">
                      <span className="text-muted">{task}</span>
                      <select
                        value={route?.primaryModelProfileId ?? profile?.modelProfileId ?? ""}
                        onChange={(event) => void setRoute(task, event.target.value)}
                        className="mt-0.5 w-full rounded border border-line/70 bg-ink-3/50 px-2 py-1"
                      >
                        {profiles.map((item) => (
                          <option key={item.modelProfileId} value={item.modelProfileId}>
                            {item.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-[12px] text-muted">还没有供应商行。</p>
          )}
          {note ? <p className="text-[11px] text-muted">{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
