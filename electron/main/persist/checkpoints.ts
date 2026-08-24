import { createHash } from "node:crypto";
import { loadPackById } from "../../../demo/src/engine/pack";
import type { GameEvent } from "../../../demo/src/engine/types";
import { uuidv7 } from "../../shared/ids";
import type { Driver } from "./driver";
import { loadInvestigator } from "./investigator";

export type CheckpointView = { checkpointId: string; branchId: string; stateVersion: number; eventSequence: number; label: string; createdAt: string; purpose: string | null; passed: boolean | null; stateHash: string; recap: string };

const investigatorPack = loadPackById("mist-harbor");

export function buildCheckpointRecap(db: Driver, branchId: string, eventSequence: number): string {
  const record = loadInvestigator(db, branchId);
  const history = investigatorPack.manifest.creation?.lifeHistories.find(
    (candidate) => candidate.id === record?.profile.lifeHistoryId,
  );
  const premise = record
    ? `${record.profile.name}因沈鹭寄来的车票来到雾港站。`
    : investigatorPack.manifest.opening;
  const summaries = db.all<{ payload_json: string }>(
    `SELECT payload_json FROM events
     WHERE branch_id = ? AND sequence <= ?
       AND json_extract(audience_json, '$.kind') = 'public'
     ORDER BY sequence`,
    [branchId, eventSequence],
  ).map((row) => (JSON.parse(row.payload_json) as GameEvent).summary);
  return [premise, history?.background.replace(/^你/, record?.profile.name ?? "调查员"), ...summaries]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

export function createCheckpoint(db: Driver, input: { branchId: string; label: string; now: string; purpose?: string; steps?: string[]; expected?: unknown; actual?: unknown; passed?: boolean }): CheckpointView {
  const head = db.get<{ head_sequence: number; head_state_version: number }>("SELECT head_sequence, head_state_version FROM branches WHERE branch_id = ?", [input.branchId]);
  if (!head) throw new Error("checkpoint.branch_missing");
  const payload = JSON.stringify(db.all("SELECT payload_json FROM events WHERE branch_id = ? AND sequence <= ? ORDER BY sequence", [input.branchId, head.head_sequence]));
  const hash = createHash("sha256").update(payload).digest("hex");
  const id = uuidv7();
  const recap = buildCheckpointRecap(db, input.branchId, head.head_sequence);
  db.transaction(() => {
    db.run("INSERT INTO checkpoints (checkpoint_id, branch_id, state_version, event_sequence, snapshot_id, label, kind, created_at) VALUES (?, ?, ?, ?, NULL, ?, 'manual', ?)", [id, input.branchId, head.head_state_version, head.head_sequence, input.label, input.now]);
    db.run("INSERT INTO checkpoint_recaps (checkpoint_id, recap) VALUES (?, ?)", [id, recap]);
    db.run(
      `INSERT INTO checkpoint_dialogue_members (checkpoint_id, turn_id, narration_id, ordinal)
       SELECT ?, t.turn_id, n.narration_id,
              row_number() OVER (ORDER BY t.created_at, t.turn_id) - 1
       FROM turns t
       JOIN narrations n ON n.turn_id = t.turn_id AND n.status = 'final'
       WHERE t.branch_id = ?
       ORDER BY t.created_at, t.turn_id`,
      [id, input.branchId],
    );
    if (input.purpose) db.run("INSERT INTO checkpoint_test_cases VALUES (?, ?, ?, ?, ?, ?, ?)", [id, input.purpose, JSON.stringify(input.steps ?? []), JSON.stringify(input.expected ?? null), JSON.stringify(input.actual ?? null), input.passed ? 1 : 0, hash]);
  });
  return { checkpointId: id, branchId: input.branchId, stateVersion: head.head_state_version, eventSequence: head.head_sequence, label: input.label, createdAt: input.now, purpose: input.purpose ?? null, passed: input.purpose ? Boolean(input.passed) : null, stateHash: hash, recap };
}

export function listCheckpoints(db: Driver): CheckpointView[] {
  return db.all<any>(`SELECT c.checkpoint_id, c.branch_id, c.state_version, c.event_sequence, c.label, c.created_at, t.purpose, t.passed, t.state_hash, r.recap FROM checkpoints c LEFT JOIN checkpoint_test_cases t ON t.checkpoint_id=c.checkpoint_id JOIN checkpoint_recaps r ON r.checkpoint_id=c.checkpoint_id ORDER BY c.created_at DESC`).map((r) => ({ checkpointId:r.checkpoint_id, branchId:r.branch_id, stateVersion:r.state_version, eventSequence:r.event_sequence, label:r.label, createdAt:r.created_at, purpose:r.purpose ?? null, passed:r.passed == null ? null : r.passed===1, stateHash:r.state_hash ?? "", recap:r.recap }));
}

export function restoreCheckpointCopy(db: Driver, checkpointId: string, label: string, now: string): { branchId: string; stateVersion: number } {
  const cp = db.get<any>("SELECT * FROM checkpoints WHERE checkpoint_id = ?", [checkpointId]);
  if (!cp) throw new Error("checkpoint.not_found");
  const branchId = uuidv7();
  db.transaction(() => {
    db.run("INSERT INTO branches VALUES (?, ?, ?, ?, ?, ?, ?, NULL)", [branchId, cp.branch_id, cp.event_sequence, label, cp.event_sequence, cp.state_version, now]);
    db.run("INSERT INTO checkpoint_restore_sources (branch_id, checkpoint_id) VALUES (?, ?)", [branchId, checkpointId]);
    const turns = db.all<any>(
      `SELECT DISTINCT t.* FROM turns t
       WHERE t.branch_id = ? AND (
         EXISTS (
           SELECT 1 FROM events e
           WHERE e.turn_id = t.turn_id AND e.branch_id = ? AND e.sequence <= ?
         ) OR EXISTS (
           SELECT 1 FROM checkpoint_dialogue_members m
           WHERE m.checkpoint_id = ? AND m.turn_id = t.turn_id
         )
       )
       ORDER BY t.created_at, t.turn_id`,
      [cp.branch_id, cp.branch_id, cp.event_sequence, checkpointId],
    );
    const turnMap = new Map<string,string>();
    for (const t of turns) { const id=uuidv7(); turnMap.set(t.turn_id,id); db.run(`INSERT INTO turns (turn_id,branch_id,command_id,actor_id,controller_id,input_text,status,base_state_version,committed_state_version,operation_id,failure_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,branchId,`restore-${branchId}-${t.command_id}`,t.actor_id,t.controller_id,t.input_text,t.status,t.base_state_version,t.committed_state_version,uuidv7(),t.failure_code,t.created_at,t.updated_at]); }
    const events = db.all<any>("SELECT * FROM events WHERE branch_id=? AND sequence <= ? ORDER BY sequence", [cp.branch_id, cp.event_sequence]);
    for (const e of events) { const turnId=turnMap.get(e.turn_id)!; const payload=JSON.parse(e.payload_json); payload.id=uuidv7(); payload.turnId=turnId; db.run(`INSERT INTO events (event_id,branch_id,sequence,turn_id,event_type,entity_type,entity_id,state_version,schema_version,source_json,audience_json,payload_json,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [payload.id,branchId,e.sequence,turnId,e.event_type,e.entity_type,e.entity_id,e.state_version,e.schema_version,e.source_json,e.audience_json,JSON.stringify(payload),e.occurred_at]); }
    const narrations = db.all<any>(
      `SELECT n.* FROM checkpoint_dialogue_members m
       JOIN narrations n ON n.narration_id = m.narration_id
       WHERE m.checkpoint_id = ?
       ORDER BY m.ordinal`,
      [checkpointId],
    );
    for (const n of narrations) {
      const turnId = turnMap.get(n.turn_id);
      if (!turnId) continue;
      db.run(`INSERT INTO narrations (narration_id,branch_id,turn_id,based_on_state_version,model_task_id,prompt_version,text,status,created_at) VALUES (?,?,?,?,?,?,?,'final',?)`, [uuidv7(),branchId,turnId,n.based_on_state_version,n.model_task_id,n.prompt_version,n.text,n.created_at]);
    }
  });
  return { branchId, stateVersion: cp.state_version };
}

export function createInvestigatorRecreationBranch(
  db: Driver,
  checkpointId: string,
  label: string,
  now: string,
): { branchId: string; stateVersion: 0 } {
  const checkpoint = db.get<{
    branch_id: string;
    state_version: number;
    event_sequence: number;
    label: string;
  }>(
    "SELECT branch_id, state_version, event_sequence, label FROM checkpoints WHERE checkpoint_id = ?",
    [checkpointId],
  );
  if (!checkpoint) throw new Error("checkpoint.not_found");
  if (checkpoint.label !== "正式开局前" || checkpoint.state_version !== 1) {
    throw new Error("investigator.recreation_checkpoint_invalid");
  }
  if (!loadInvestigator(db, checkpoint.branch_id)) {
    throw new Error("investigator.recreation_source_unbound");
  }
  const confirmationTurns = db.get<{ count: number }>(
    `SELECT count(DISTINCT turn_id) AS count
     FROM events
     WHERE branch_id = ? AND sequence <= ?`,
    [checkpoint.branch_id, checkpoint.event_sequence],
  )?.count ?? 0;
  const sheets = db.get<{ count: number }>(
    `SELECT count(*) AS count
     FROM events
     WHERE branch_id = ? AND sequence <= ? AND event_type = 'sheet_applied'`,
    [checkpoint.branch_id, checkpoint.event_sequence],
  )?.count ?? 0;
  if (confirmationTurns !== 1 || sheets !== 1) {
    throw new Error("investigator.recreation_checkpoint_invalid");
  }

  const branchId = uuidv7();
  db.transaction(() => {
    db.run(
      `INSERT INTO investigator_recreation_branches (
        branch_id, source_branch_id, checkpoint_id, created_at
      ) VALUES (?, ?, ?, ?)`,
      [branchId, checkpoint.branch_id, checkpointId, now],
    );
    db.run(
      `INSERT INTO branches (
        branch_id, parent_branch_id, fork_sequence, label, head_sequence,
        head_state_version, created_at, archived_at
      ) VALUES (?, ?, ?, ?, 0, 0, ?, NULL)`,
      [branchId, checkpoint.branch_id, checkpoint.event_sequence, label, now],
    );
  });
  return { branchId, stateVersion: 0 };
}
