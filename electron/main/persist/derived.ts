import type { DirectorFrontier } from "@/ai/director";
import { emptyMemory, type MemoryEntry, type MemoryState } from "@/ai/memory";
import type { Driver } from "./driver";

export function loadMemory(db: Driver, branchId: string): MemoryState {
  const cursor = db.get<{
    raw_recorded_through_turn: number;
    memory_processed_through_turn: number;
  }>(
    `SELECT raw_recorded_through_turn, memory_processed_through_turn
     FROM memory_cursors WHERE branch_id = ?`,
    [branchId],
  );
  const rows = db.all<{
    memory_id: string;
    memory_type: string;
    summary: string;
    structured_json: string;
    source_event_ids_json: string;
    status: string;
    extracted_through_turn: number;
    scene_id: string | null;
    importance: number;
  }>(
    `SELECT memory_id, memory_type, summary, structured_json, source_event_ids_json,
            status, extracted_through_turn, scene_id, importance
     FROM memory_entries WHERE branch_id = ? ORDER BY updated_at ASC, memory_id`,
    [branchId],
  );
  if (!cursor && rows.length === 0) return emptyMemory();
  return {
    cursor: {
      rawRecordedThroughTurn: cursor?.raw_recorded_through_turn ?? 0,
      memoryProcessedThroughTurn: cursor?.memory_processed_through_turn ?? 0,
    },
    entries: rows.map(toEntry),
  };
}

export function saveMemory(db: Driver, branchId: string, memory: MemoryState, now: string): void {
  db.transaction(() => {
    db.run("DELETE FROM memory_entries WHERE branch_id = ?", [branchId]);
    for (const entry of memory.entries) {
      db.run(
        `INSERT INTO memory_entries (
          memory_id, branch_id, memory_type, subject_entity_id, summary, structured_json,
          source_event_ids_json, audience_json, confidence, based_on_state_version,
          status, extracted_through_turn, scene_id, importance, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          branchId,
          entry.memoryType,
          entry.entityIds[0] ?? null,
          entry.summary,
          JSON.stringify({ ...entry.structured, entityIds: entry.entityIds }),
          JSON.stringify(entry.sources),
          JSON.stringify(["gm"]),
          1,
          entry.extractedThroughTurn,
          entry.status,
          entry.extractedThroughTurn,
          entry.sceneId,
          entry.importance,
          now,
          now,
        ],
      );
    }
    db.run(
      `INSERT INTO memory_cursors (
        branch_id, raw_recorded_through_turn, memory_processed_through_turn, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(branch_id) DO UPDATE SET
        raw_recorded_through_turn = excluded.raw_recorded_through_turn,
        memory_processed_through_turn = excluded.memory_processed_through_turn,
        updated_at = excluded.updated_at`,
      [branchId, memory.cursor.rawRecordedThroughTurn, memory.cursor.memoryProcessedThroughTurn, now],
    );
  });
}

export function loadFrontier(db: Driver, branchId: string): DirectorFrontier | undefined {
  const row = db.get<{ frontier_json: string }>(
    "SELECT frontier_json FROM director_frontier WHERE branch_id = ?",
    [branchId],
  );
  if (!row) return undefined;
  return JSON.parse(row.frontier_json) as DirectorFrontier;
}

export function saveFrontier(db: Driver, branchId: string, frontier: DirectorFrontier, now: string): void {
  db.run(
    `INSERT INTO director_frontier (
      branch_id, based_on_state_version, last_assessed_event_id, frontier_json, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(branch_id) DO UPDATE SET
      based_on_state_version = excluded.based_on_state_version,
      last_assessed_event_id = excluded.last_assessed_event_id,
      frontier_json = excluded.frontier_json,
      updated_at = excluded.updated_at`,
    [
      branchId,
      frontier.basedOnStateVersion,
      frontier.lastAssessedEventId,
      JSON.stringify(frontier),
      now,
    ],
  );
}

function toEntry(row: {
  memory_id: string;
  memory_type: string;
  summary: string;
  structured_json: string;
  source_event_ids_json: string;
  status: string;
  extracted_through_turn: number;
  scene_id: string | null;
  importance: number;
}): MemoryEntry {
  const structured = JSON.parse(row.structured_json) as MemoryEntry["structured"];
  const entityIds = structured.entityIds;
  return {
    id: row.memory_id,
    memoryType: row.memory_type as MemoryEntry["memoryType"],
    summary: row.summary,
    sources: JSON.parse(row.source_event_ids_json) as string[],
    entityIds: Array.isArray(entityIds) ? entityIds.filter((id): id is string => typeof id === "string") : [],
    sceneId: row.scene_id,
    importance: row.importance,
    status: row.status as MemoryEntry["status"],
    structured,
    extractedThroughTurn: row.extracted_through_turn,
  };
}
