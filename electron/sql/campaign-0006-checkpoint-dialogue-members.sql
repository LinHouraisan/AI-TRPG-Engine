CREATE TABLE checkpoint_dialogue_members (
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(checkpoint_id),
  turn_id TEXT NOT NULL REFERENCES turns(turn_id),
  narration_id TEXT NOT NULL REFERENCES narrations(narration_id),
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  PRIMARY KEY(checkpoint_id, turn_id),
  UNIQUE(checkpoint_id, narration_id),
  UNIQUE(checkpoint_id, ordinal)
) STRICT;

INSERT INTO checkpoint_dialogue_members (checkpoint_id, turn_id, narration_id, ordinal)
SELECT
  c.checkpoint_id,
  t.turn_id,
  n.narration_id,
  row_number() OVER (
    PARTITION BY c.checkpoint_id
    ORDER BY t.created_at, t.turn_id
  ) - 1
FROM checkpoints c
JOIN turns t
  ON t.branch_id = c.branch_id
 AND COALESCE(t.committed_state_version, t.base_state_version) <= c.state_version
 AND t.created_at <= c.created_at
JOIN narrations n
  ON n.turn_id = t.turn_id
 AND n.status = 'final'
 AND n.created_at <= c.created_at;
