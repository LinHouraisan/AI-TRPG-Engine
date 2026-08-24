import { createHash } from "node:crypto";
import { validateAllocation } from "../../../demo/src/character/creation";
import type { InvestigatorProfile } from "../../../demo/src/character/types";
import { loadPackById } from "../../../demo/src/engine/pack";
import { replay } from "../../../demo/src/engine/runtime";
import { initialState } from "../../../demo/src/engine/state";
import type { CampaignBackup, CampaignBackupBody } from "../../shared/api";
import {
  canonicalProfileJson,
  hashProfile,
  isReplayConsistentInvestigator,
  loadInvestigator,
} from "./investigator";
import type { Driver } from "./driver";
import { loadGameEvents } from "./turns";

const FORMAT = "ai-trpg-campaign-backup" as const;

export const CAMPAIGN_BACKUP_TABLES = [
  "campaign_metadata",
  "branches",
  "investigator_profiles",
  "branch_investigator_bindings",
  "turns",
  "operations",
  "events",
  "state_entities",
  "rule_decisions",
  "narrations",
  "snapshots",
  "checkpoints",
  "content_bindings",
  "background_jobs",
  "memory_entries",
  "memory_cursors",
  "director_frontier",
  "checkpoint_test_cases",
  "checkpoint_recaps",
  "checkpoint_restore_sources",
  "checkpoint_dialogue_members",
  "investigator_recreation_branches",
] as const;

type TableName = (typeof CAMPAIGN_BACKUP_TABLES)[number];
type Row = Record<string, unknown>;
type Column = { name: string; pk: number };

const investigatorRules = loadPackById("mist-harbor").manifest.creation;

export function checksumBackupBody(body: CampaignBackupBody): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export function exportCampaignBackup(
  db: Driver,
  catalog: {
    campaignId: string;
    name: string;
    headBranchId: string;
    headStateVersion: number;
  },
): CampaignBackup {
  const metadata = db.get<{
    database_schema_version: number;
    domain_schema_version: number;
  }>("SELECT database_schema_version, domain_schema_version FROM campaign_metadata");
  if (!metadata) throw new Error("backup.metadata_missing");
  const tables: CampaignBackupBody["tables"] = {};
  for (const table of CAMPAIGN_BACKUP_TABLES) {
    const columns = tableColumns(db, table);
    if (columns.length === 0) throw new Error(`backup.table_missing:${table}`);
    const primaryKey = columns.filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk);
    const order = primaryKey.length > 0
      ? ` ORDER BY ${primaryKey.map((column) => quoteIdentifier(column.name)).join(", ")}`
      : "";
    tables[table] = db.all<Row>(`SELECT * FROM ${quoteIdentifier(table)}${order}`)
      .map(encodeRow);
  }

  const body: CampaignBackupBody = {
    sourceCampaignId: catalog.campaignId,
    name: catalog.name,
    headBranchId: catalog.headBranchId,
    headStateVersion: catalog.headStateVersion,
    databaseSchemaVersion: metadata.database_schema_version,
    domainSchemaVersion: metadata.domain_schema_version,
    migrations: migrationFingerprints(db),
    tables,
  };
  return {
    format: FORMAT,
    formatVersion: 1,
    checksum: checksumBackupBody(body),
    body,
  };
}

export function importCampaignBackup(
  db: Driver,
  backup: CampaignBackup,
  campaignId: string,
): { name: string; headBranchId: string; headStateVersion: number } {
  validateContainer(backup, db);
  const name = backup.body.name.trim();
  if (name.length < 1 || name.length > 80) throw new Error("backup.name_invalid");
  const branches = backup.body.tables.branches ?? [];
  if (!branches.some((row) => row.branch_id === backup.body.headBranchId)) {
    throw new Error("backup.head_branch_missing");
  }
  const head = branches.find((row) => row.branch_id === backup.body.headBranchId);
  if (head?.head_state_version !== backup.body.headStateVersion) {
    throw new Error("backup.head_version_mismatch");
  }

  const rowsByTable = Object.fromEntries(
    CAMPAIGN_BACKUP_TABLES.map((table) => [table, backup.body.tables[table] ?? []]),
  ) as Record<TableName, Row[]>;
  rowsByTable.campaign_metadata = rowsByTable.campaign_metadata.map((row) => ({
    ...row,
    campaign_id: campaignId,
    name,
  }));
  rowsByTable.operations = rowsByTable.operations.map((row) => ({
    ...row,
    campaign_id: campaignId,
  }));
  rowsByTable.branches = sortBranches(rowsByTable.branches);

  db.transaction(() => {
    for (const table of CAMPAIGN_BACKUP_TABLES) {
      insertRows(db, table, rowsByTable[table]);
    }
    validateImportedDatabase(db);
  });
  return {
    name,
    headBranchId: backup.body.headBranchId,
    headStateVersion: backup.body.headStateVersion,
  };
}

function validateImportedDatabase(db: Driver): void {
  const integrity = db.get<{ integrity_check: string }>("PRAGMA integrity_check");
  if (integrity?.integrity_check !== "ok") throw new Error("backup.sqlite_integrity_failed");
  if (db.all("PRAGMA foreign_key_check").length > 0) {
    throw new Error("backup.foreign_key_failed");
  }
  const boundBranches = db.all<{ branch_id: string }>(
    "SELECT branch_id FROM branch_investigator_bindings ORDER BY branch_id",
  );
  for (const { branch_id } of boundBranches) {
    const record = loadInvestigator(db, branch_id);
    if (!record) throw new Error("backup.investigator_binding_invalid");
    const state = replay(initialState(), loadGameEvents(db, branch_id));
    if (!isReplayConsistentInvestigator(record, state)) {
      throw new Error("backup.investigator_replay_mismatch");
    }
  }
}

function validateContainer(backup: CampaignBackup, target: Driver): void {
  if (backup.format !== FORMAT || backup.formatVersion !== 1) {
    throw new Error("backup.format_invalid");
  }
  if (!/^[0-9a-f]{64}$/u.test(backup.checksum) || backup.checksum !== checksumBackupBody(backup.body)) {
    throw new Error("backup.checksum_mismatch");
  }
  if (
    !backup.body ||
    typeof backup.body.sourceCampaignId !== "string" ||
    typeof backup.body.name !== "string" ||
    typeof backup.body.headBranchId !== "string" ||
    !Number.isInteger(backup.body.headStateVersion) ||
    backup.body.databaseSchemaVersion !== 1 ||
    backup.body.domainSchemaVersion !== 1
  ) throw new Error("backup.schema_invalid");
  if (canonicalJson(backup.body.migrations) !== canonicalJson(migrationFingerprints(target))) {
    throw new Error("backup.migration_mismatch");
  }
  const tableNames = Object.keys(backup.body.tables).sort();
  const expectedTables = [...CAMPAIGN_BACKUP_TABLES].sort();
  if (canonicalJson(tableNames) !== canonicalJson(expectedTables)) {
    throw new Error("backup.tables_invalid");
  }
  for (const table of CAMPAIGN_BACKUP_TABLES) {
    if (!Array.isArray(backup.body.tables[table])) throw new Error(`backup.rows_invalid:${table}`);
  }
  validateProfiles(backup.body.tables.investigator_profiles ?? []);
  const metadata = backup.body.tables.campaign_metadata ?? [];
  if (
    metadata.length !== 1 ||
    metadata[0]?.campaign_id !== backup.body.sourceCampaignId ||
    metadata[0]?.database_schema_version !== backup.body.databaseSchemaVersion ||
    metadata[0]?.domain_schema_version !== backup.body.domainSchemaVersion
  ) throw new Error("backup.metadata_invalid");
}

function validateProfiles(rows: Row[]): void {
  if (!investigatorRules) throw new Error("backup.investigator_rules_missing");
  for (const row of rows) {
    if (
      typeof row.profile_json !== "string" ||
      typeof row.profile_hash !== "string" ||
      typeof row.content_version !== "string"
    ) throw new Error("backup.profile_invalid");
    let profile: InvestigatorProfile;
    try {
      profile = JSON.parse(row.profile_json) as InvestigatorProfile;
    } catch {
      throw new Error("backup.profile_invalid");
    }
    const validated = validateAllocation(investigatorRules, {
      name: profile.name,
      lifeHistoryId: profile.lifeHistoryId,
      occupationPoints: profile.occupationPoints,
      interestPoints: profile.interestPoints,
    });
    if (
      !validated.ok ||
      canonicalProfileJson(validated.profile) !== row.profile_json ||
      canonicalProfileJson(profile) !== row.profile_json ||
      hashProfile(profile) !== row.profile_hash ||
      profile.contentVersion !== row.content_version
    ) throw new Error("backup.profile_hash_mismatch");
  }
}

function insertRows(db: Driver, table: TableName, rows: Row[]): void {
  const columns = tableColumns(db, table).map((column) => column.name);
  const expected = [...columns].sort();
  for (const encoded of rows) {
    const keys = Object.keys(encoded).sort();
    if (canonicalJson(keys) !== canonicalJson(expected)) {
      throw new Error(`backup.columns_invalid:${table}`);
    }
    const sql = `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
    db.run(sql, columns.map((column) => decodeValue(encoded[column])));
  }
}

function migrationFingerprints(db: Driver): Array<{ migrationId: string; checksum: string }> {
  return db.all<{ migration_id: string; checksum: string }>(
    "SELECT migration_id, checksum FROM schema_migrations ORDER BY migration_id",
  ).map((row) => ({ migrationId: row.migration_id, checksum: row.checksum }));
}

function tableColumns(db: Driver, table: TableName): Column[] {
  return db.all<{ name: string; pk: number }>(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .map((column) => ({ name: column.name, pk: column.pk }));
}

function sortBranches(rows: Row[]): Row[] {
  const pending = new Map(rows.map((row) => [String(row.branch_id), row]));
  const sorted: Row[] = [];
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((row) =>
      row.parent_branch_id == null || sorted.some((parent) => parent.branch_id === row.parent_branch_id));
    if (ready.length === 0) throw new Error("backup.branch_cycle");
    ready.sort((left, right) => String(left.branch_id).localeCompare(String(right.branch_id)));
    for (const row of ready) {
      sorted.push(row);
      pending.delete(String(row.branch_id));
    }
  }
  return sorted;
}

function encodeRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, encodeValue(value)]));
}

function encodeValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { $binary: Buffer.from(value).toString("base64") };
  }
  return value;
}

function decodeValue(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    typeof (value as { $binary?: unknown }).$binary === "string"
  ) return Buffer.from((value as { $binary: string }).$binary, "base64");
  return value;
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_]+$/u.test(value)) throw new Error("backup.identifier_invalid");
  return `"${value}"`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}
