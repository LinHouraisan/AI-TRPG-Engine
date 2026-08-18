/**
 * 表结构照 PRD/04-技术选型.md §4：
 * 战役、分支、检查点、事件是权威的；对话（message）只是让叙述读起来连贯，
 * 读档绝不依赖它。事件的不可修改由触发器钉死，不靠自觉。
 */
export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS campaign (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  pack_ref      TEXT NOT NULL,
  initial_state TEXT NOT NULL,
  head_branch   TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS branch (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL REFERENCES campaign(id),
  title         TEXT NOT NULL,
  parent_branch TEXT REFERENCES branch(id),
  fork_seq      INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event (
  branch_id     TEXT NOT NULL REFERENCES branch(id),
  seq           INTEGER NOT NULL,
  event_id      TEXT NOT NULL,
  turn_id       TEXT NOT NULL,
  version_after INTEGER NOT NULL,
  clock         INTEGER NOT NULL,
  visibility    TEXT NOT NULL,
  cause         TEXT NOT NULL,
  summary       TEXT NOT NULL,
  narration     TEXT,
  payload       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (branch_id, seq)
);

CREATE TRIGGER IF NOT EXISTS event_no_update BEFORE UPDATE ON event
BEGIN SELECT RAISE(ABORT, '事件已经提交，不可修改'); END;

CREATE TRIGGER IF NOT EXISTS event_no_delete BEFORE DELETE ON event
BEGIN SELECT RAISE(ABORT, '事件已经提交，不可删除'); END;

CREATE TABLE IF NOT EXISTS checkpoint (
  branch_id     TEXT NOT NULL REFERENCES branch(id),
  cursor        INTEGER NOT NULL,
  state_version INTEGER NOT NULL,
  state_hash    TEXT NOT NULL,
  pack_ref      TEXT NOT NULL,
  snapshot      TEXT,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (branch_id, cursor)
);

CREATE TABLE IF NOT EXISTS message (
  branch_id     TEXT NOT NULL REFERENCES branch(id),
  seq           INTEGER NOT NULL,
  role          TEXT NOT NULL,
  text          TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  source        TEXT,
  note          TEXT,
  check_json    TEXT,
  kind          TEXT,
  PRIMARY KEY (branch_id, seq)
);
`;
