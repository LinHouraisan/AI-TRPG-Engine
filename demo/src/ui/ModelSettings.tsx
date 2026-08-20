import { useEffect, useRef, useState } from "react";
import { desktopApi } from "@/desktop";

type Provider = {
  providerInstanceId: string;
  providerType: string;
  displayName: string;
  baseUrl: string | null;
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

const TASKS = [
  "gm.handle_free_turn",
  "gm.narrate_result",
  "information.plan",
  "information.propose",
  "director.analyze_progress",
  "memory.extract",
  "memory.consolidate",
  "context.rank_relevance",
];

/** V1 settings tables: provider_instances / model_profiles / task_routes. Desktop only. */
export function ModelSettings() {
  const api = desktopApi();
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [note, setNote] = useState<string | null>(null);
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
    const [p, m, r] = await Promise.all([
      api.settings.listProviders(),
      api.settings.listProfiles(),
      api.settings.listTaskRoutes(),
    ]);
    if (p.ok) setProviders(p.value);
    if (m.ok) setProfiles(m.value);
    if (r.ok) setRoutes(r.value);
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
                  onChange={(event) => void saveProvider({ providerType: event.target.value })}
                  className="mt-1 w-full rounded border border-line/70 bg-ink-3/50 px-2 py-1"
                >
                  <option value="ollama">ollama</option>
                  <option value="openai_compatible">openai_compatible</option>
                  <option value="openai">openai</option>
                  <option value="deepseek">deepseek</option>
                  <option value="qwen">qwen</option>
                </select>
              </label>
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
                <p className="text-[11px] text-muted">任务路由</p>
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
