CREATE TABLE memory_entries (
  memory_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(branch_id),
  memory_type TEXT NOT NULL,
  subject_entity_id TEXT,
  summary TEXT NOT NULL,
  structured_json TEXT NOT NULL CHECK(json_valid(structured_json)),
  source_event_ids_json TEXT NOT NULL CHECK(json_valid(source_event_ids_json)),
  audience_json TEXT NOT NULL CHECK(json_valid(audience_json)),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  based_on_state_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','superseded','conflicted')),
  extracted_through_turn INTEGER NOT NULL DEFAULT 0,
  scene_id TEXT,
  importance INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX memory_subject ON memory_entries(branch_id, subject_entity_id, status, updated_at DESC);
CREATE INDEX memory_type ON memory_entries(branch_id, memory_type, status, updated_at DESC);

CREATE TABLE memory_cursors (
  branch_id TEXT PRIMARY KEY REFERENCES branches(branch_id),
  raw_recorded_through_turn INTEGER NOT NULL DEFAULT 0,
  memory_processed_through_turn INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE director_frontier (
  branch_id TEXT PRIMARY KEY REFERENCES branches(branch_id),
  based_on_state_version INTEGER NOT NULL,
  last_assessed_event_id TEXT,
  frontier_json TEXT NOT NULL CHECK(json_valid(frontier_json)),
  updated_at TEXT NOT NULL
) STRICT;
