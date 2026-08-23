import { useEffect, useState } from "react";
import { desktopApi, type DesktopCampaign } from "@/desktop";

export function CampaignDock({currentCampaign,busy,onSwitch,onDelete}:{currentCampaign:string|null;busy:boolean;onSwitch:(campaignId:string)=>void;onDelete:(campaignId:string)=>void}) {
  const api = desktopApi();
  const [campaigns, setCampaigns] = useState<DesktopCampaign[]>([]);
  const [note, setNote] = useState("主进程战役目录");

  useEffect(() => {
    if (!api) return;
    void api.campaign.list({ limit: 50 }).then((result) => {
      if (result.ok) setCampaigns(result.value.items);
      else setNote(result.error.messageKey);
    });
  }, [api, currentCampaign]);

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
    onSwitch(result.value.campaignId);
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md bg-ink-2/80 px-2 py-1 text-[12px] text-paper/85">
      <span className="shrink-0 rounded border border-brass/50 px-1.5 py-0.5 text-brass">
        Electron
      </span>
      <span className="min-w-0 truncate text-paper/70">{note}</span>
      <select value={currentCampaign ?? ""} disabled={busy} onChange={(event)=>onSwitch(event.target.value)} className="min-w-0 max-w-40 rounded border border-brass/50 bg-ink-3 px-1.5 py-0.5 text-paper disabled:opacity-40">
        {campaigns.map((campaign)=><option key={campaign.campaignId} value={campaign.campaignId}>{campaign.name}</option>)}
      </select>
      <span className="shrink-0 tabular-nums text-brass">{campaigns.length} 场</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void create()}
        className="shrink-0 rounded border border-line/70 px-1.5 py-0.5 hover:border-brass/60 hover:text-brass disabled:opacity-40"
      >
        新建
      </button>
      {currentCampaign ? <button type="button" disabled={busy} onClick={()=>{if(window.confirm("删除这场战役？"))onDelete(currentCampaign);}} className="shrink-0 rounded border border-blood/50 px-1.5 py-0.5 text-blood disabled:opacity-40">删除</button>:null}
    </div>
  );
}
