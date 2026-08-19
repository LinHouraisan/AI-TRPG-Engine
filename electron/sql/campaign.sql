CREATE TABLE schema_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  app_version TEXT NOT NULL,
  checksum TEXT NOT NULL
) STRICT;

CREATE TABLE campaign_metadata (
  campaign_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  database_schema_version INTEGER NOT NULL,
  domain_schema_version INTEGER NOT NULL
) STRICT;

CREATE TABLE branches (
  branch_id TEXT PRIMARY KEY,
  parent_branch_id TEXT REFERENCES branches(branch_id),
  fork_sequence INTEGER,
  label TEXT NOT NULL,
  head_sequence INTEGER NOT NULL DEFAULT 0 CHECK(head_sequence >= 0),
  head_state_version INTEGER NOT NULL DEFAULT 0 CHECK(head_state_version >= 0),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK((parent_branch_id IS NULL AND fork_sequence IS NULL)
     OR (parent_branch_id IS NOT NULL AND fork_sequence IS NOT NULL))
) STRICT;

CREATE TABLE turns (
  turn_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(branch_id),
  command_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  controller_id TEXT NOT NULL,
  input_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'received','needs_clarification','preparing_context','interpreting',
    'adjudicating','awaiting_commit','committed','narrating','completed',
    'context_failed','interpretation_failed','validation_failed',
    'commit_failed','narration_failed','cancelled'
  )),
  base_state_version INTEGER NOT NULL,
  committed_state_version INTEGER,
  operation_id TEXT NOT NULL,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(branch_id, command_id)
) STRICT;

CREATE INDEX turns_branch_created ON turns(branch_id, created_at, turn_id);

CREATE TABLE operations (
  operation_id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  branch_id TEXT,
  turn_id TEXT REFERENCES turns(turn_id),
  status TEXT NOT NULL CHECK(status IN ('queued','running','waiting_for_user','succeeded','failed','cancelled')),
  progress_json TEXT NOT NULL CHECK(json_valid(progress_json)),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE INDEX operations_status ON operations(status, updated_at);

CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(branch_id),
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  turn_id TEXT NOT NULL REFERENCES turns(turn_id),
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  state_version INTEGER NOT NULL CHECK(state_version > 0),
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  source_json TEXT NOT NULL CHECK(json_valid(source_json)),
  audience_json TEXT NOT NULL CHECK(json_valid(audience_json)),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  occurred_at TEXT NOT NULL,
  UNIQUE(branch_id, sequence)
) STRICT;

CREATE INDEX events_turn ON events(turn_id, sequence);
CREATE INDEX events_entity ON events(branch_id, entity_type, entity_id, sequence DESC);
CREATE INDEX events_type ON events(branch_id, event_type, sequence DESC);

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are immutable');
END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are immutable');
END;

CREATE TABLE state_entities (
  branch_id TEXT NOT NULL REFERENCES branches(branch_id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  state_version INTEGER NOT NULL CHECK(state_version >= 0),
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  updated_by_event_id TEXT REFERENCES events(event_id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, entity_type, entity_id)
) STRICT;

CREATE INDEX state_entities_type ON state_entities(branch_id, entity_type, entity_id);

CREATE TABLE rule_decisions (
  decision_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(branch_id),
  turn_id TEXT NOT NULL REFERENCES turns(turn_id),
  algorithm_version TEXT NOT NULL,
  rule_reference_json TEXT NOT NULL CHECK(json_valid(rule_reference_json)),
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  rng_json TEXT CHECK(rng_json IS NULL OR json_valid(rng_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at TEXT NOT NULL,
  UNIQUE(turn_id, decision_id)
) STRICT;

CREATE TABLE narrations (
  narration_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(branch_id),
  turn_id TEXT NOT NULL REFERENCES turns(turn_id),
  based_on_state_version INTEGER NOT NULL,
  model_task_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('final','superseded')),
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX narrations_one_final_per_turn
ON narrations(turn_id) WHERE status = 'final';

CREATE TABLE snapshots (
  snapshot_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(branch_id),
  state_version INTEGER NOT NULL,
  event_sequence INTEGER NOT NULL,
  compression TEXT NOT NULL CHECK(compression IN ('none','gzip')),
  state_blob BLOB NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(branch_id, state_version)
) STRICT;

CREATE TABLE checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(branch_id),
  state_version INTEGER NOT NULL,
  event_sequence INTEGER NOT NULL,
  snapshot_id TEXT REFERENCES snapshots(snapshot_id),
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('automatic','manual','pre_migration','ending')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE content_bindings (
  binding_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  snapshot_relative_path TEXT NOT NULL,
  bound_at TEXT NOT NULL,
  UNIQUE(content_id, content_type)
) STRICT;

CREATE TABLE background_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  branch_id TEXT,
  based_on_state_version INTEGER,
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  available_at TEXT NOT NULL,
  locked_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
