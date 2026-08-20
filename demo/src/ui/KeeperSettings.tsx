import { useEffect, useRef, useState } from "react";
import { pingKeeper } from "@/keeper/client";
import type { KeeperConfig } from "@/keeper/config";

/** 主持人接在哪、用哪个模型，在界面上就能改；关掉它，Demo 退回确定性模板照样能玩。 */
export function KeeperSettings({
  config,
  onChange,
}: {
  config: KeeperConfig;
  onChange: (config: KeeperConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [probe, setProbe] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function test() {
    setProbe("正在连接…");
    try {
      const names = await pingKeeper(config);
      setModels(names);
      setProbe(
        names.includes(config.model)
          ? `连上了，共 ${names.length} 个模型，${config.model} 在其中。`
          : `连上了，但这台机器上没有 ${config.model}。`,
      );
    } catch (error) {
      setProbe(`连不上：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`min-h-11 rounded border px-3 text-[13px] transition md:min-h-0 md:px-2.5 md:py-1 ${
          config.enabled
            ? "border-moss/50 text-moss hover:border-moss"
            : "border-line/70 text-muted hover:border-brass/60"
        }`}
      >
        <span className="md:hidden">主持</span>
        <span className="hidden md:inline">
          主持人：{config.enabled ? config.model : "已关闭"}
        </span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="关闭主持人设置"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-20 bg-ink/50 md:hidden"
          />
          <div className="absolute right-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-line/70 bg-ink-2 p-3 text-[13px] shadow-xl">
            <label className="flex min-h-11 items-center justify-between">
              <span>接上模型</span>
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(event) => onChange({ ...config, enabled: event.target.checked })}
              />
            </label>
            <p className="mt-1 text-[11px] text-muted">
              关掉之后叙述走确定性模板，回合、掷骰与事件记录完全不受影响。
            </p>

            <label className="mt-3 flex min-h-11 items-center justify-between">
              <span>边写边出字</span>
              <input
                type="checkbox"
                checked={config.stream}
                disabled={!config.enabled}
                onChange={(event) => onChange({ ...config, stream: event.target.checked })}
              />
            </label>
            <p className="mt-1 text-[11px] text-muted">
              打开后字会先以未定稿出现。没过体检就整段收回，换成模板。
            </p>

            <label className="mt-3 flex min-h-11 items-center justify-between">
              <span>调试后台任务</span>
              <input
                type="checkbox"
                checked={config.debugTrace}
                onChange={(event) => onChange({ ...config, debugTrace: event.target.checked })}
              />
            </label>
            <p className="mt-1 text-[11px] text-muted">
              记录栏画出 Information / Director / Memory 冷路径。关掉不影响提交。
            </p>

            <label className="mt-3 block">
              <span className="text-[11px] text-muted">服务地址</span>
              <input
                value={config.baseUrl}
                onChange={(event) => onChange({ ...config, baseUrl: event.target.value })}
                className="mt-1 w-full rounded border border-line/70 bg-ink-3/50 px-2 py-1 outline-none focus:border-brass/60"
              />
            </label>

            <label className="mt-2 block">
              <span className="text-[11px] text-muted">模型</span>
              <input
                value={config.model}
                list="keeper-models"
                onChange={(event) => onChange({ ...config, model: event.target.value })}
                className="mt-1 w-full rounded border border-line/70 bg-ink-3/50 px-2 py-1 outline-none focus:border-brass/60"
              />
              <datalist id="keeper-models">
                {models.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={test}
                className="min-h-11 rounded border border-line/70 px-3 transition hover:border-brass/60 hover:text-brass md:min-h-0 md:px-2 md:py-1"
              >
                测试连接
              </button>
              <span className="text-[11px] text-muted">超时 {config.timeoutMs / 1000} 秒</span>
            </div>
            {probe ? <p className="mt-2 text-[11px] text-muted">{probe}</p> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
