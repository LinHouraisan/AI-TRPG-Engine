CREATE TABLE audit_runs (
  trace_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(branch_id),
  turn_id TEXT REFERENCES turns(turn_id),
  operation_id TEXT NOT NULL,
  base_state_version INTEGER NOT NULL CHECK(base_state_version >= 0),
  committed_state_version INTEGER CHECK(committed_state_version IS NULL OR committed_state_version >= 0),
  final_narration_id TEXT REFERENCES narrations(narration_id),
  completeness TEXT NOT NULL CHECK(completeness IN ('open','complete','partial','aborted','not_applicable')),
  gap_codes_json TEXT NOT NULL CHECK(json_valid(gap_codes_json)),
  started_at TEXT NOT NULL,
  finalized_at TEXT,
  schema_version TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX audit_runs_turn ON audit_runs(turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX audit_runs_branch_started ON audit_runs(branch_id, started_at DESC);
CREATE INDEX audit_runs_narration ON audit_runs(final_narration_id);

CREATE TABLE audit_spans (
  span_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES audit_runs(trace_id),
  parent_span_id TEXT REFERENCES audit_spans(span_id),
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  kind TEXT NOT NULL CHECK(kind IN ('program','model','retrieval','tool','guard','persistence')),
  stage TEXT NOT NULL,
  task_type TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK(attempt > 0),
  causal INTEGER NOT NULL CHECK(causal IN (0, 1)),
  model_task_id TEXT,
  based_on_state_version INTEGER CHECK(based_on_state_version IS NULL OR based_on_state_version >= 0),
  prompt_version TEXT,
  model_id TEXT,
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  output_json TEXT CHECK(output_json IS NULL OR json_valid(output_json)),
  status TEXT NOT NULL CHECK(status IN ('started','succeeded','rejected','failed','aborted','skipped')),
  error_code TEXT,
  duration_ms INTEGER CHECK(duration_ms IS NULL OR duration_ms >= 0),
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK(prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK(completion_tokens >= 0),
  cached_tokens INTEGER NOT NULL DEFAULT 0 CHECK(cached_tokens >= 0),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  payload_sha256 TEXT NOT NULL,
  UNIQUE(trace_id, sequence)
) STRICT;

CREATE INDEX audit_spans_trace_sequence ON audit_spans(trace_id, sequence);
CREATE INDEX audit_spans_task ON audit_spans(task_type, stage);

CREATE TABLE user_feedback (
  feedback_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES audit_runs(trace_id),
  turn_id TEXT NOT NULL REFERENCES turns(turn_id),
  narration_id TEXT NOT NULL REFERENCES narrations(narration_id),
  rating TEXT NOT NULL CHECK(rating = 'dissatisfied'),
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(narration_id, rating)
) STRICT;

CREATE TABLE diagnosis_results (
  diagnosis_id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES user_feedback(feedback_id),
  source TEXT NOT NULL CHECK(source IN ('rule','local_judge')),
  code TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
  severity TEXT NOT NULL CHECK(severity IN ('error','warning','info')),
  explanation TEXT NOT NULL,
  evidence_span_ids_json TEXT NOT NULL CHECK(json_valid(evidence_span_ids_json)),
  rule_version TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX diagnosis_feedback ON diagnosis_results(feedback_id, created_at);

CREATE TABLE dataset_export_batches (
  export_batch_id TEXT PRIMARY KEY,
  filters_json TEXT NOT NULL CHECK(json_valid(filters_json)),
  schema_version TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE dataset_candidates (
  case_id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL UNIQUE REFERENCES user_feedback(feedback_id),
  trace_id TEXT NOT NULL REFERENCES audit_runs(trace_id),
  status TEXT NOT NULL CHECK(status IN ('captured','auto_diagnosed','pending_review','reviewed','curated','exported','discarded')),
  confirmed_issue_tags_json TEXT NOT NULL CHECK(json_valid(confirmed_issue_tags_json)),
  review_note TEXT,
  corrected_output TEXT,
  dataset_usage TEXT CHECK(dataset_usage IS NULL OR dataset_usage IN ('evaluation_only','sft','preference','discard')),
  reviewed_at TEXT,
  export_batch_id TEXT REFERENCES dataset_export_batches(export_batch_id)
) STRICT;

CREATE INDEX dataset_candidates_status ON dataset_candidates(status, case_id);
