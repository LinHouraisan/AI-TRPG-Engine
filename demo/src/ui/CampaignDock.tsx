import { useEffect, useState } from "react";
import { desktopApi, type DesktopCampaign } from "@/desktop";

export function CampaignDock() {
  const api = desktopApi();
  const [campaigns, setCampaigns] = useState<DesktopCampaign[]>([]);
  const [note, setNote] = useState("主进程战役目录");

  useEffect(() => {
    if (!api) return;
    void api.campaign.list({ limit: 20 }).then((result) => {
      if (result.ok) setCampaigns(result.value.items);
      else setNote(result.error.messageKey);
    });
  }, [api]);

  if (!api) return null;

  async function create(): Promise<void> {
    if (!api) return;
    const result = await api.campaign.create({ name: "未命名战役" });
    if (!result.ok) {
      setNote(result.error.messageKey);
      return;
    }
    setCampaigns((current) => [result.value, ...current]);
    setNote(`已在主进程建档：${result.value.name}`);
  }

  return (
    <div className="flex min-w-0 items-center gap-2 text-[12px] text-ink/80">
      <span className="shrink-0 rounded border border-brass/50 px-1.5 py-0.5 text-brass">
        Electron
      </span>
      <span className="min-w-0 truncate">{note}</span>
      <span className="shrink-0 tabular-nums">{campaigns.length} 场</span>
      <button
        type="button"
        onClick={() => void create()}
        className="shrink-0 rounded border border-line/70 px-1.5 py-0.5 hover:border-brass/60 hover:text-brass"
      >
        新建
      </button>
    </div>
  );
}
