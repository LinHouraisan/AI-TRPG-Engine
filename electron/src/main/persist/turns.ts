import type { CheckResult, GameEvent } from "@core/engine/types";
import type { DialogueTurn } from "@core/keeper/dialogue-context";
import { buildCheckpointRecap } from "./checkpoints";
import type { Driver } from "./driver";

export type StoredTurn = {
  turnId: string;
  commandId: string;
  status: string;
  operationId: string;
  baseStateVersion: number;
  committedStateVersion: number | null;
};

export function findTurnByCommand(
  db: Driver,
  branchId: string,
  commandId: string,
): StoredTurn | undefined {
  const row = db.get<{
    turn_id: string;
    command_id: string;
    status: string;
    operation_id: string;
    base_state_version: number;
    committed_state_version: number | null;
  }>(
    `SELECT turn_id, command_id, status, operation_id, base_state_version, committed_state_version
     FROM turns WHERE branch_id = ? AND command_id = ?`,
    [branchId, commandId],
  );
  if (!row) return undefined;
  return {
    turnId: row.turn_id,
    commandId: row.command_id,
    status: row.status,
    operationId: row.operation_id,
    baseStateVersion: row.base_state_version,
    committedStateVersion: row.committed_state_version,
  };
}

export function loadGameEvents(db: Driver, branchId: string, eventSequence?: number): GameEvent[] {
  const rows = db.all<{ payload_json: string; sequence: number }>(
    `SELECT payload_json, sequence FROM events
     WHERE branch_id = ? AND (? IS NULL OR sequence <= ?)
     ORDER BY sequence`,
    [branchId, eventSequence ?? null, eventSequence ?? null],
  );
  return rows.map((row) => JSON.parse(row.payload_json) as GameEvent);
}

export function appendCommitted(params: {
  db: Driver;
  campaignId: string;
  branchId: string;
  turnId: string;
  operationId: string;
  commandId: string;
  actorId: string;
  controllerId: string;
  text: string;
  now: string;
  status: string;
  baseVersion: number;
  committedVersion: number | null;
  events: GameEvent[];
  check?: CheckResult;
  result: unknown;
}): void {
  params.db.transaction(() => {
    params.db.run(
      `INSERT INTO turns (
        turn_id, branch_id, command_id, actor_id, controller_id, input_text, status,
        base_state_version, committed_state_version, operation_id, failure_code,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        params.turnId,
        params.branchId,
        params.commandId,
        params.actorId,
        params.controllerId,
        params.text,
        params.status,
        params.baseVersion,
        params.committedVersion,
        params.operationId,
        params.now,
        params.now,
      ],
    );
    params.db.run(
      `INSERT INTO operations (
        operation_id, operation_type, campaign_id, branch_id, turn_id, status,
        progress_json, result_json, error_code, created_at, updated_at, completed_at
      ) VALUES (?, 'turn.submitAction', ?, ?, ?, 'succeeded', ?, ?, NULL, ?, ?, ?)`,
      [
        params.operationId,
        params.campaignId,
        params.branchId,
        params.turnId,
        JSON.stringify({ phase: params.status }),
        JSON.stringify(params.result),
        params.now,
        params.now,
        params.now,
      ],
    );
    for (const event of params.events) {
      params.db.run(
        `INSERT INTO events (
          event_id, branch_id, sequence, turn_id, event_type, entity_type, entity_id,
          state_version, schema_version, source_json, audience_json, payload_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 1, ?, ?, ?, ?)`,
        [
          event.id,
          params.branchId,
          event.seq + 1,
          params.turnId,
          event.payload.type,
          event.versionAfter,
          JSON.stringify({ kind: "command", commandId: params.commandId }),
          JSON.stringify({ kind: event.visibility === "secret" ? "gm_only" : "public" }),
          JSON.stringify(event),
          params.now,
        ],
      );
    }
    if (params.check) {
      params.db.run(
        `INSERT INTO rule_decisions (
          decision_id, branch_id, turn_id, algorithm_version, rule_reference_json,
          input_json, rng_json, result_json, created_at
        ) VALUES (?, ?, ?, 'coc7-percentile-v1', ?, ?, NULL, ?, ?)`,
        [
          `${params.turnId}-check`,
          params.branchId,
          params.turnId,
          JSON.stringify({ skill: params.check.skill }),
          JSON.stringify({
            skillValue: params.check.skillValue,
            difficulty: params.check.difficulty,
            threshold: params.check.threshold,
          }),
          JSON.stringify(params.check),
          params.now,
        ],
      );
    }
    if (params.events.length > 0) {
      params.db.run(
        `UPDATE branches SET head_sequence = ?, head_state_version = ? WHERE branch_id = ?`,
        [
          (params.events[params.events.length - 1]?.seq ?? 0) + 1,
          params.committedVersion ?? params.baseVersion,
          params.branchId,
        ],
      );
    }
  });
}

export function getOperation(db: Driver, operationId: string) {
  return db.get<{
    operation_id: string;
    operation_type: string;
    status: string;
    progress_json: string;
    result_json: string | null;
    error_code: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT operation_id, operation_type, status, progress_json, result_json,
            error_code, created_at, updated_at
     FROM operations WHERE operation_id = ?`,
    [operationId],
  );
}

export function listTimeline(db: Driver, branchId: string, limit: number, eventSequence?: number) {
  return db.all<{
    event_id: string;
    turn_id: string;
    event_type: string;
    payload_json: string;
    occurred_at: string;
  }>(
    `SELECT event_id, turn_id, event_type, payload_json, occurred_at
     FROM events
     WHERE branch_id = ? AND (? IS NULL OR sequence <= ?)
     ORDER BY sequence LIMIT ?`,
    [branchId, eventSequence ?? null, eventSequence ?? null, limit],
  );
}

export function loadRecentDialogueTurns(db: Driver, branchId: string): DialogueTurn[] {
  return db.all<{ input_text: string; text: string }>(
    `SELECT t.input_text, n.text
     FROM turns t JOIN narrations n ON n.turn_id = t.turn_id AND n.status = 'final'
     WHERE t.branch_id = ?
     ORDER BY t.created_at DESC, t.turn_id DESC LIMIT 3`,
    [branchId],
  ).reverse().map((row) => ({ player: row.input_text, gm: row.text }));
}

export type BranchHistoryView = {
  recap: string;
  recentTurns: Array<{ turnId: string; stateVersion: number; player: string; gm: string }>;
  restoredFrom: string | null;
};

export type BranchHistoryUpperBound = { stateVersion: number; eventSequence: number };

type HistoryCheckpoint = {
  checkpoint_id: string;
  label: string;
  state_version: number;
  event_sequence: number;
  created_at: string;
  recap: string;
};

export function loadBranchHistory(
  db: Driver,
  branchId: string,
  upperBound?: BranchHistoryUpperBound,
): BranchHistoryView {
  const branch = db.get<{
    parent_branch_id: string | null;
    fork_sequence: number | null;
    head_state_version: number;
    head_sequence: number;
    created_at: string;
  }>(
    `SELECT parent_branch_id, fork_sequence, head_state_version, head_sequence, created_at
     FROM branches WHERE branch_id = ?`,
    [branchId],
  );
  const mappedSource = db.get<HistoryCheckpoint>(
    `SELECT c.checkpoint_id, c.label, c.state_version, c.event_sequence, c.created_at, r.recap
     FROM checkpoint_restore_sources s
     JOIN checkpoints c ON c.checkpoint_id = s.checkpoint_id
     JOIN checkpoint_recaps r ON r.checkpoint_id = c.checkpoint_id
     WHERE s.branch_id = ?`,
    [branchId],
  );
  const hasRecreationTable = Boolean(db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'investigator_recreation_branches'",
  ));
  const isInvestigatorRecreation = hasRecreationTable && Boolean(db.get<{ branch_id: string }>(
    "SELECT branch_id FROM investigator_recreation_branches WHERE branch_id = ?",
    [branchId],
  ));
  const fallbackSource = !mappedSource && !isInvestigatorRecreation && branch?.parent_branch_id != null
    ? db.get<HistoryCheckpoint>(
        `SELECT c.checkpoint_id, c.label, c.state_version, c.event_sequence, c.created_at, r.recap
         FROM checkpoints c JOIN checkpoint_recaps r ON r.checkpoint_id = c.checkpoint_id
         WHERE c.branch_id = ? AND c.event_sequence = ? AND c.created_at <= ?
         ORDER BY c.created_at DESC LIMIT 1`,
        [branch.parent_branch_id, branch.fork_sequence, branch.created_at],
      )
    : undefined;
  const source = mappedSource ?? fallbackSource;
  const boundedCheckpoint = !source && upperBound
    ? db.get<HistoryCheckpoint>(
        `SELECT c.checkpoint_id, c.label, c.state_version, c.event_sequence, c.created_at, r.recap
         FROM checkpoints c JOIN checkpoint_recaps r ON r.checkpoint_id = c.checkpoint_id
         WHERE c.branch_id = ? AND c.state_version = ? AND c.event_sequence = ?
         ORDER BY c.created_at DESC LIMIT 1`,
        [branchId, upperBound.stateVersion, upperBound.eventSequence],
      )
    : undefined;
  const bound = upperBound ?? (source
    ? { stateVersion: source.state_version, eventSequence: source.event_sequence }
    : { stateVersion: branch?.head_state_version ?? 0, eventSequence: branch?.head_sequence ?? 0 });
  const checkpoint = source ?? boundedCheckpoint;
  const recentRows = checkpoint
    ? db.all<{ turn_id: string; state_version: number; input_text: string; text: string }>(
        `SELECT t.turn_id,
                COALESCE(t.committed_state_version, t.base_state_version) AS state_version,
                t.input_text, n.text
         FROM checkpoint_dialogue_members m
         JOIN turns t ON t.turn_id = m.turn_id
         JOIN narrations n ON n.narration_id = m.narration_id
         WHERE m.checkpoint_id = ?
         ORDER BY m.ordinal DESC LIMIT 3`,
        [checkpoint.checkpoint_id],
      )
    : db.all<{ turn_id: string; state_version: number; input_text: string; text: string }>(
        `SELECT t.turn_id,
                COALESCE(t.committed_state_version, t.base_state_version) AS state_version,
                t.input_text, n.text
         FROM turns t JOIN narrations n ON n.turn_id = t.turn_id AND n.status = 'final'
         WHERE t.branch_id = ?
           AND COALESCE(t.committed_state_version, t.base_state_version) <= ?
         ORDER BY t.created_at DESC, t.turn_id DESC LIMIT 3`,
        [branchId, bound.stateVersion],
      );
  const recentTurns = recentRows.reverse().map((row) => ({
    turnId: row.turn_id,
    stateVersion: row.state_version,
    player: row.input_text,
    gm: row.text,
  }));
  return {
    recap: source?.recap ?? boundedCheckpoint?.recap ?? buildCheckpointRecap(db, branchId, bound.eventSequence),
    recentTurns,
    restoredFrom: source?.label ?? null,
  };
}
