# Persistence 与 SQLite

Status: Draft
Implements: V1.0 技术设计第 8、14 节
Depends On: [公共约定](00-common-conventions.md)
Consumed By: Event/State、Application Runtime、Content、Context/Memory

## 1. 职责与边界

Persistence 管理连接、migration、事务、Repository、在线备份和完整性检查。它不判断领域合法性，不调用模型，不生成叙事，不把数据库行直接暴露给 Renderer。

使用 `better-sqlite3`。每个战役一个 `campaign.sqlite`；全局 `settings.sqlite` 保存内容目录、战役目录、非敏感模型配置和应用偏好。任何慢 I/O 或模型调用必须在事务外完成。

## 2. 连接策略

每个打开的数据库执行：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
```

单个 Main 进程拥有连接。普通读使用同一连接；大型导出可用只读连接。V1.0 不允许多个应用实例同时写同一战役。

## 3. Settings DDL

```sql
CREATE TABLE schema_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  app_version TEXT NOT NULL,
  checksum TEXT NOT NULL
) STRICT;

CREATE TABLE campaign_catalog (
  campaign_id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  relative_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT,
  trashed_at TEXT,
  health TEXT NOT NULL CHECK(health IN ('unknown','healthy','recovery_required','read_only')),
  head_branch_id TEXT NOT NULL,
  head_state_version INTEGER NOT NULL CHECK(head_state_version >= 0)
) STRICT;

CREATE INDEX campaign_catalog_recent
ON campaign_catalog(trashed_at, last_opened_at DESC, campaign_id);

CREATE TABLE app_settings (
  setting_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE provider_instances (
  provider_instance_id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT,
  credential_id TEXT,
  config_json TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE model_profiles (
  model_profile_id TEXT PRIMARY KEY,
  provider_instance_id TEXT NOT NULL REFERENCES provider_instances(provider_instance_id),
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capabilities_json TEXT NOT NULL CHECK(json_valid(capabilities_json)),
  generation_defaults_json TEXT NOT NULL CHECK(json_valid(generation_defaults_json)),
  capability_source TEXT NOT NULL CHECK(capability_source IN ('user','probe','certified','provider','default')),
  probed_at TEXT,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  UNIQUE(provider_instance_id, model_id)
) STRICT;

CREATE TABLE task_routes (
  task_type TEXT PRIMARY KEY,
  primary_model_profile_id TEXT NOT NULL REFERENCES model_profiles(model_profile_id),
  fallback_model_profile_id TEXT REFERENCES model_profiles(model_profile_id),
  budget_json TEXT NOT NULL CHECK(json_valid(budget_json)),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE installed_content (
  installation_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  relative_path TEXT NOT NULL UNIQUE,
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  capability_level TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  UNIQUE(content_id, content_type, content_version, content_hash)
) STRICT;
```

## 4. Campaign DDL

```sql
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
```

Memory、关系和搜索表在对应模块定义。

## 5. Repository 与事务

```ts
interface UnitOfWork {
  events: EventWriter;
  entities: EntityStateWriter;
  decisions: RuleDecisionWriter;
  turns: TurnWriter;
  branches: BranchWriter;
}

interface TransactionManager {
  execute<T>(work: (uow: UnitOfWork) => T): T;
}
```

Repository 方法接受领域 DTO，不接受任意 SQL fragments。动态排序字段使用白名单映射。事务回调必须同步，防止在事务中 `await` 网络或磁盘慢操作。

## 6. Migration

Migration 文件命名 `NNNN_description.sql`，包含固定 SHA-256。执行时先在线备份，检查当前版本，只按连续序号前进，在单事务中写 schema 和 migration 记录。已应用 migration 校验和变化时停止启动并报 `DB_MIGRATION_CHECKSUM_MISMATCH`。

领域 JSON migration 使用读取旧 schema → 验证 → 纯函数转换 → 验证新 schema → 写入的批次流程，每批最多 500 行，并在外层升级备份基础上执行。

## 7. 错误与恢复

| 错误码 | 处理 |
|---|---|
| `DB_BUSY` | 有界重试，总计不超过 2 秒 |
| `DB_VERSION_CONFLICT` | Application 重新读取和评估 |
| `DB_CONSTRAINT_VIOLATION` | 视为程序或输入错误，不盲重试 |
| `DB_INTEGRITY_FAILED` | 停止写入、只读打开 |
| `DB_MIGRATION_FAILED` | 保留原文件和备份 |
| `DB_MIGRATION_CHECKSUM_MISMATCH` | 停止启动 |
| `DB_DISK_FULL` | 回滚、提示释放空间 |
| `DB_BACKUP_FAILED` | 不执行依赖该备份的升级/覆盖 |

## 8. 性能与测试

- 普通状态读取 P95 < 100 ms；短提交 P95 < 250 ms；
- 单事务事件建议不超过 100 个，超过时记录警告但不拆分原子事实；
- 10,000 事件打开和分页正常；50,000 事件通过快照恢复；
- 集成测试覆盖每个约束、索引查询计划、回滚、重复 command、磁盘满、WAL 恢复；
- migration 测试从每个正式旧版本 fixture 升级；
- 备份测试验证正在写入时仍得到一致副本；
- 禁止 `SELECT *` 跨 Repository 返回、禁止字符串拼 SQL、禁止把 JSON 当作未验证对象返回。
