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
