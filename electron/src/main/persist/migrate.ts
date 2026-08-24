import { createHash } from "node:crypto";
import type { Clock } from "../clock";
import type { Driver } from "./driver";

const APP_VERSION = "0.1.0";

export function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function hasMigrationsTable(driver: Driver): boolean {
  return Boolean(
    driver.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    ),
  );
}

export function applyInit(driver: Driver, clock: Clock, sql: string, migrationId: string): void {
  const hash = checksum(sql);
  if (hasMigrationsTable(driver)) {
    const existing = driver.get<{ checksum: string }>(
      "SELECT checksum FROM schema_migrations WHERE migration_id = ?",
      [migrationId],
    );
    if (!existing) {
      throw Object.assign(new Error("DB_MIGRATION_FAILED"), { code: "DB_MIGRATION_FAILED" });
    }
    if (existing.checksum !== hash) {
      throw Object.assign(new Error("DB_MIGRATION_CHECKSUM_MISMATCH"), {
        code: "DB_MIGRATION_CHECKSUM_MISMATCH",
      });
    }
    return;
  }
  driver.transaction(() => {
    driver.exec(sql);
    driver.run(
      "INSERT INTO schema_migrations (migration_id, applied_at, app_version, checksum) VALUES (?, ?, ?, ?)",
      [migrationId, clock.nowIso(), APP_VERSION, hash],
    );
  });
}

/** Additive migration after 0001_init. Idempotent. Checksum-pinned. */
export function applyMigration(driver: Driver, clock: Clock, sql: string, migrationId: string): void {
  if (!hasMigrationsTable(driver)) {
    throw Object.assign(new Error("DB_MIGRATION_FAILED"), { code: "DB_MIGRATION_FAILED" });
  }
  const hash = checksum(sql);
  const existing = driver.get<{ checksum: string }>(
    "SELECT checksum FROM schema_migrations WHERE migration_id = ?",
    [migrationId],
  );
  if (existing) {
    if (existing.checksum !== hash) {
      throw Object.assign(new Error("DB_MIGRATION_CHECKSUM_MISMATCH"), {
        code: "DB_MIGRATION_CHECKSUM_MISMATCH",
      });
    }
    return;
  }
  driver.transaction(() => {
    driver.exec(sql);
    driver.run(
      "INSERT INTO schema_migrations (migration_id, applied_at, app_version, checksum) VALUES (?, ?, ?, ?)",
      [migrationId, clock.nowIso(), APP_VERSION, hash],
    );
  });
}
