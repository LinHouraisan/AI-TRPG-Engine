CREATE TABLE checkpoint_test_cases (
  checkpoint_id TEXT PRIMARY KEY REFERENCES checkpoints(checkpoint_id),
  purpose TEXT NOT NULL,
  steps_json TEXT NOT NULL CHECK(json_valid(steps_json)),
  expected_json TEXT NOT NULL CHECK(json_valid(expected_json)),
  actual_json TEXT NOT NULL CHECK(json_valid(actual_json)),
  passed INTEGER NOT NULL CHECK(passed IN (0,1)),
  state_hash TEXT NOT NULL
) STRICT;
