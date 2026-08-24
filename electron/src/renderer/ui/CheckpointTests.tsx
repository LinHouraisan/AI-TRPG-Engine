import { useState } from "react";
import { desktopApi } from "@renderer/desktop";
import { checkpointLabel, partitionCheckpoints, restoreNeedsConfirmation } from "./checkpoint-tests-state";

type Row={checkpointId:string;branchId:string;label:string;stateVersion:number;purpose:string|null;passed:boolean|null;stateHash:string;recap:string};
export function CheckpointTests({campaignId,branchId,currentVersion,busy,onRestore,onRecreate}:{campaignId:string|null;branchId:string|null;currentVersion:number;busy:boolean;onRestore:(checkpointId:string)=>Promise<boolean>;onRecreate:(checkpointId:string)=>Promise<boolean>}){
 const api=desktopApi(); const [open,setOpen]=useState(false); const [rows,setRows]=useState<Row[]>([]); const [note,setNote]=useState("");
 if(!api||!campaignId||!branchId)return null;
 const visibleRows=partitionCheckpoints(rows,branchId);
 async function load(){const r=await api!.checkpoint.list({campaignId:campaignId!});if(r.ok)setRows(r.value);else setNote(r.error.messageKey);}
 async function create(){const r=await api!.checkpoint.create({campaignId:campaignId!,branchId:branchId!,label:checkpointLabel(currentVersion)});setNote(r.ok?`检查点已创建：v${currentVersion}`:r.error.messageKey);await load();}
 async function restore(row:Row){
  if(restoreNeedsConfirmation(currentVersion,row.stateVersion)&&!window.confirm(`当前进度为 v${currentVersion}，这个存档是 v${row.stateVersion}。恢复后会回到较早进度，是否继续？`))return;
  if(await onRestore(row.checkpointId)){await load();setOpen(true);}
 }
 async function recreate(row:Row){
  if(!window.confirm("将从正式开局前检查点创建一条空白子分支，用于确认一位新的不可变调查员。来源分支不会改变。是否继续？"))return;
  if(await onRecreate(row.checkpointId)){setOpen(false);setNote("已创建重建分支，请重新确认调查员。");}
 }
 const renderRow=(r:Row)=><li key={r.checkpointId} className="rounded border border-line/50 p-2"><p>{r.label}</p><p className="text-xs text-muted">存档版本 v{r.stateVersion}</p><p className="mt-1 line-clamp-2 text-xs text-muted">{r.recap}</p>{r.purpose?<p className="text-xs text-muted">{r.purpose} · {r.passed?"通过":"失败"}</p>:null}<p className="truncate text-[10px] text-muted">{r.stateHash}</p><div className="mt-1 flex gap-1"><button type="button" disabled={busy} onClick={()=>void restore(r)} className="rounded border border-line/70 px-2 py-0.5 disabled:opacity-40">复制并恢复</button>{r.label==="正式开局前"?<button type="button" disabled={busy} onClick={()=>void recreate(r)} className="rounded border border-brass/60 px-2 py-0.5 text-brass disabled:opacity-40">重新创建调查员</button>:null}</div></li>;
 return <div className="relative"><button type="button" disabled={busy} onClick={()=>{setOpen(!open);if(!open)void load();}} className="rounded border border-line/70 px-2.5 py-1 disabled:opacity-40">测试与恢复</button>{open?<div className="absolute right-0 z-40 mt-1 w-80 rounded border border-line/70 bg-ink-2 p-3 shadow-xl"><button type="button" disabled={busy} onClick={()=>void create()} className="rounded border border-brass/60 px-2 py-1 text-brass disabled:opacity-40">创建检查点</button><p className="mt-2 text-xs text-muted">当前分支 · v{currentVersion}</p><ul className="mt-2 space-y-2">{visibleRows.current.map(renderRow)}</ul>{visibleRows.current.length===0?<p className="mt-2 text-xs text-muted">当前分支还没有检查点。</p>:null}{visibleRows.history.length?<details open className="mt-3"><summary className="cursor-pointer text-xs text-muted">历史分支存档（{visibleRows.history.length}）</summary><ul className="mt-2 space-y-2">{visibleRows.history.map(renderRow)}</ul></details>:null}{note?<p className="mt-2 text-xs text-muted">{note}</p>:null}</div>:null}</div>;
}
