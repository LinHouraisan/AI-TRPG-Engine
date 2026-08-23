import { useState } from "react";
import { desktopApi } from "@/desktop";

type Row={checkpointId:string;label:string;stateVersion:number;purpose:string|null;passed:boolean|null;stateHash:string};
export function CheckpointTests({campaignId,branchId}:{campaignId:string|null;branchId:string|null}){
 const api=desktopApi(); const [open,setOpen]=useState(false); const [rows,setRows]=useState<Row[]>([]); const [note,setNote]=useState("");
 if(!api||!campaignId||!branchId)return null;
 async function load(){const r=await api!.checkpoint.list({campaignId:campaignId!});if(r.ok)setRows(r.value);else setNote(r.error.messageKey);}
 async function create(){const r=await api!.checkpoint.create({campaignId:campaignId!,branchId:branchId!,label:`手动检查点 v${Date.now()}`});setNote(r.ok?"检查点已创建":r.error.messageKey);await load();}
 async function restore(id:string){const r=await api!.checkpoint.restoreCopy({campaignId:campaignId!,checkpointId:id,label:"测试恢复副本"});setNote(r.ok?"已创建恢复分支，重新打开战役后可进入":r.error.messageKey);}
 return <div className="relative"><button type="button" onClick={()=>{setOpen(!open);if(!open)void load();}} className="rounded border border-line/70 px-2.5 py-1">测试与恢复</button>{open?<div className="absolute right-0 z-40 mt-1 w-80 rounded border border-line/70 bg-ink-2 p-3 shadow-xl"><button type="button" onClick={()=>void create()} className="rounded border border-brass/60 px-2 py-1 text-brass">创建检查点</button><ul className="mt-2 space-y-2">{rows.map(r=><li key={r.checkpointId} className="rounded border border-line/50 p-2"><p>{r.label} · v{r.stateVersion}</p>{r.purpose?<p className="text-xs text-muted">{r.purpose} · {r.passed?"通过":"失败"}</p>:null}<p className="truncate text-[10px] text-muted">{r.stateHash}</p><button type="button" onClick={()=>void restore(r.checkpointId)} className="mt-1 rounded border border-line/70 px-2 py-0.5">复制并恢复</button></li>)}</ul>{note?<p className="mt-2 text-xs text-muted">{note}</p>:null}</div>:null}</div>;
}
