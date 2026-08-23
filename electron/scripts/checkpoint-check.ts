import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixedClock } from "../main/clock";
import { createCheckpoint, listCheckpoints, restoreCheckpointCopy } from "../main/persist/checkpoints";
import { openBun } from "../main/persist/bun-driver";
import { applyInit, applyMigration } from "../main/persist/migrate";

function assert(ok: unknown, label: string): asserts ok { if (!ok) throw new Error(label); console.log(`✓ ${label}`); }
const db = openBun(":memory:");
const clock = fixedClock("2026-08-23T00:00:00.000Z");
const sqlDir = join(import.meta.dir, "../sql");
applyInit(db, clock, readFileSync(join(sqlDir,"campaign.sql"),"utf8"), "0001_init");
applyMigration(db, clock, readFileSync(join(sqlDir,"campaign-0003-checkpoint-tests.sql"),"utf8"), "0003_checkpoint_tests");
db.run("INSERT INTO campaign_metadata VALUES ('camp','test',?,?,1,1)",[clock.nowIso(),clock.nowIso()]);
db.run("INSERT INTO branches VALUES ('main',NULL,NULL,'主线',0,0,?,NULL)",[clock.nowIso()]);
const cp=createCheckpoint(db,{branchId:"main",label:"开场测试",now:clock.nowIso(),purpose:"验证开场恢复",steps:["创建战役"],expected:{version:0},actual:{version:0},passed:true});
assert(listCheckpoints(db)[0]?.purpose==="验证开场恢复","测试检查点可查看");
const restored=restoreCheckpointCopy(db,cp.checkpointId,"开场测试副本",clock.nowIso());
assert(restored.branchId!=="main","恢复创建新分支");
assert(db.get<{parent_branch_id:string}>("SELECT parent_branch_id FROM branches WHERE branch_id=?",[restored.branchId])?.parent_branch_id==="main","新分支保留来源");
assert(db.get<{head_state_version:number}>("SELECT head_state_version FROM branches WHERE branch_id='main'")?.head_state_version===0,"来源分支不变");
db.close();
console.log("检查点复制恢复全部通过。");
