import type { CampaignSummary, Page, PageRequest } from "../../shared/api";
import {
  asBranchId,
  asCampaignId,
  asStateVersion,
  type CampaignId,
} from "../../shared/ids";
import type { Driver } from "./driver";

type CatalogRow = {
  campaign_id: string;
  name: string;
  health: CampaignSummary["health"];
  head_branch_id: string;
  head_state_version: number;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  trashed_at: string | null;
};

function toSummary(row: CatalogRow): CampaignSummary {
  return {
    campaignId: asCampaignId(row.campaign_id),
    name: row.name,
    health: row.health,
    headBranchId: asBranchId(row.head_branch_id),
    headStateVersion: asStateVersion(row.head_state_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  };
}

export function insertCatalog(
  settings: Driver,
  row: {
    campaignId: string;
    name: string;
    relativePath: string;
    headBranchId: string;
    now: string;
  },
): CampaignSummary {
  settings.run(
    `INSERT INTO campaign_catalog (
      campaign_id, name, relative_path, created_at, updated_at, last_opened_at,
      trashed_at, health, head_branch_id, head_state_version
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'healthy', ?, 0)`,
    [row.campaignId, row.name, row.relativePath, row.now, row.now, row.headBranchId],
  );
  const stored = settings.get<CatalogRow>(
    `SELECT campaign_id, name, health, head_branch_id, head_state_version,
            created_at, updated_at, last_opened_at, trashed_at
     FROM campaign_catalog WHERE campaign_id = ?`,
    [row.campaignId],
  );
  if (!stored) throw new Error("DB_CONSTRAINT_VIOLATION");
  return toSummary(stored);
}

export function listCatalog(settings: Driver, page: PageRequest): Page<CampaignSummary> {
  const limit = Math.min(Math.max(page.limit, 1), 50);
  const rows = settings.all<CatalogRow>(
    `SELECT campaign_id, name, health, head_branch_id, head_state_version,
            created_at, updated_at, last_opened_at, trashed_at
     FROM campaign_catalog
     WHERE trashed_at IS NULL
     ORDER BY last_opened_at IS NULL, last_opened_at DESC, created_at DESC, campaign_id
     LIMIT ?`,
    [limit + 1],
  );
  const slice = rows.slice(0, limit);
  const last = slice[slice.length - 1];
  return {
    items: slice.map(toSummary),
    nextCursor: rows.length > limit && last ? last.campaign_id : null,
  };
}

export function getCatalog(settings: Driver, campaignId: CampaignId): CatalogRow | undefined {
  return settings.get<CatalogRow>(
    `SELECT campaign_id, name, health, head_branch_id, head_state_version,
            created_at, updated_at, last_opened_at, trashed_at
     FROM campaign_catalog WHERE campaign_id = ?`,
    [campaignId],
  );
}

export function setCatalogHead(
  settings: Driver,
  campaignId: CampaignId,
  headStateVersion: number,
  now: string,
): void {
  settings.run(
    "UPDATE campaign_catalog SET head_state_version = ?, updated_at = ? WHERE campaign_id = ?",
    [headStateVersion, now, campaignId],
  );
}

export function touchOpened(settings: Driver, campaignId: CampaignId, now: string): void {
  settings.run(
    "UPDATE campaign_catalog SET last_opened_at = ?, updated_at = ? WHERE campaign_id = ?",
    [now, now, campaignId],
  );
}

export function setTrashed(
  settings: Driver,
  campaignId: CampaignId,
  trashedAt: string | null,
  now: string,
): void {
  settings.run(
    "UPDATE campaign_catalog SET trashed_at = ?, updated_at = ? WHERE campaign_id = ?",
    [trashedAt, now, campaignId],
  );
}

export function getSetting(settings: Driver, key: string): unknown {
  const row = settings.get<{ value_json: string }>(
    "SELECT value_json FROM app_settings WHERE setting_key = ?",
    [key],
  );
  return row ? (JSON.parse(row.value_json) as unknown) : null;
}

export function setSetting(settings: Driver, key: string, value: unknown, now: string): void {
  settings.run(
    `INSERT INTO app_settings (setting_key, value_json, schema_version, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), now],
  );
}
