import { createHash } from "node:crypto";
import { uuidv7 } from "../../shared/ids";
import type { Driver } from "./driver";

export type CheckpointView = { checkpointId: string; branchId: string; stateVersion: number; eventSequence: number; label: string; createdAt: string; purpose: string | null; passed: boolean | null; stateHash: string };

export function createCheckpoint(db: Driver, input: { branchId: string; label: string; now: string; purpose?: string; steps?: string[]; expected?: unknown; actual?: unknown; passed?: boolean }): CheckpointView {
  const head = db.get<{ head_sequence: number; head_state_version: number }>("SELECT head_sequence, head_state_version FROM branches WHERE branch_id = ?", [input.branchId]);
  if (!head) throw new Error("checkpoint.branch_missing");
  const payload = JSON.stringify(db.all("SELECT payload_json FROM events WHERE branch_id = ? AND sequence <= ? ORDER BY sequence", [input.branchId, head.head_sequence]));
  const hash = createHash("sha256").update(payload).digest("hex");
  const id = uuidv7();
  db.transaction(() => {
    db.run("INSERT INTO checkpoints (checkpoint_id, branch_id, state_version, event_sequence, snapshot_id, label, kind, created_at) VALUES (?, ?, ?, ?, NULL, ?, 'manual', ?)", [id, input.branchId, head.head_state_version, head.head_sequence, input.label, input.now]);
    if (input.purpose) db.run("INSERT INTO checkpoint_test_cases VALUES (?, ?, ?, ?, ?, ?, ?)", [id, input.purpose, JSON.stringify(input.steps ?? []), JSON.stringify(input.expected ?? null), JSON.stringify(input.actual ?? null), input.passed ? 1 : 0, hash]);
  });
  return { checkpointId: id, branchId: input.branchId, stateVersion: head.head_state_version, eventSequence: head.head_sequence, label: input.label, createdAt: input.now, purpose: input.purpose ?? null, passed: input.purpose ? Boolean(input.passed) : null, stateHash: hash };
}

export function listCheckpoints(db: Driver): CheckpointView[] {
  return db.all<any>(`SELECT c.checkpoint_id, c.branch_id, c.state_version, c.event_sequence, c.label, c.created_at, t.purpose, t.passed, t.state_hash FROM checkpoints c LEFT JOIN checkpoint_test_cases t ON t.checkpoint_id=c.checkpoint_id ORDER BY c.created_at DESC`).map((r) => ({ checkpointId:r.checkpoint_id, branchId:r.branch_id, stateVersion:r.state_version, eventSequence:r.event_sequence, label:r.label, createdAt:r.created_at, purpose:r.purpose ?? null, passed:r.passed == null ? null : r.passed===1, stateHash:r.state_hash ?? "" }));
}

export function restoreCheckpointCopy(db: Driver, checkpointId: string, label: string, now: string): { branchId: string; stateVersion: number } {
  const cp = db.get<any>("SELECT * FROM checkpoints WHERE checkpoint_id = ?", [checkpointId]);
  if (!cp) throw new Error("checkpoint.not_found");
  const branchId = uuidv7();
  db.transaction(() => {
    db.run("INSERT INTO branches VALUES (?, ?, ?, ?, ?, ?, ?, NULL)", [branchId, cp.branch_id, cp.event_sequence, label, cp.event_sequence, cp.state_version, now]);
    const turns = db.all<any>("SELECT * FROM turns WHERE branch_id=? AND committed_state_version <= ? ORDER BY created_at", [cp.branch_id, cp.state_version]);
    const turnMap = new Map<string,string>();
    for (const t of turns) { const id=uuidv7(); turnMap.set(t.turn_id,id); db.run(`INSERT INTO turns (turn_id,branch_id,command_id,actor_id,controller_id,input_text,status,base_state_version,committed_state_version,operation_id,failure_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,branchId,`restore-${branchId}-${t.command_id}`,t.actor_id,t.controller_id,t.input_text,t.status,t.base_state_version,t.committed_state_version,uuidv7(),t.failure_code,t.created_at,t.updated_at]); }
    const events = db.all<any>("SELECT * FROM events WHERE branch_id=? AND sequence <= ? ORDER BY sequence", [cp.branch_id, cp.event_sequence]);
    for (const e of events) { const turnId=turnMap.get(e.turn_id)!; const payload=JSON.parse(e.payload_json); payload.id=uuidv7(); payload.turnId=turnId; db.run(`INSERT INTO events (event_id,branch_id,sequence,turn_id,event_type,entity_type,entity_id,state_version,schema_version,source_json,audience_json,payload_json,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [payload.id,branchId,e.sequence,turnId,e.event_type,e.entity_type,e.entity_id,e.state_version,e.schema_version,e.source_json,e.audience_json,JSON.stringify(payload),e.occurred_at]); }
  });
  return { branchId, stateVersion: cp.state_version };
}
