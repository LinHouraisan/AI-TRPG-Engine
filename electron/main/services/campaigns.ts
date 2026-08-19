import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CampaignSummary, CampaignView, Page, PageRequest } from "../../shared/api";
import {
  asBranchId,
  asCampaignId,
  asStateVersion,
  uuidv7,
  type CampaignId,
} from "../../shared/ids";
import { fail, ok, type Result } from "../../shared/result";
import type { Clock } from "../clock";
import type { AppPaths } from "../paths";
import {
  getCatalog,
  insertCatalog,
  listCatalog,
  setCatalogHead,
  setTrashed,
  touchOpened,
} from "../persist/catalog";
import type { Driver } from "../persist/driver";
import { applyInit } from "../persist/migrate";

export type OpenDriver = (path: string) => Driver;

export class CampaignService {
  private readonly openCampaigns = new Map<string, Driver>();

  constructor(
    readonly settings: Driver,
    private readonly paths: AppPaths,
    private readonly clock: Clock,
    private readonly openDriver: OpenDriver,
    private readonly campaignSql: string,
  ) {}

  create(name: string): Result<CampaignSummary> {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "campaign.name_invalid",
        retryable: false,
        details: { min: 1, max: 80 },
      });
    }
    const campaignId = uuidv7();
    const branchId = uuidv7();
    const now = this.clock.nowIso();
    const file = this.paths.campaignFile(campaignId);
    mkdirSync(dirname(file), { recursive: true });
    const campaign = this.openDriver(file);
    try {
      applyInit(campaign, this.clock, this.campaignSql, "0001_init");
      campaign.transaction(() => {
        campaign.run(
          `INSERT INTO campaign_metadata (
            campaign_id, name, created_at, updated_at, database_schema_version, domain_schema_version
          ) VALUES (?, ?, ?, ?, 1, 1)`,
          [campaignId, trimmed, now, now],
        );
        campaign.run(
          `INSERT INTO branches (
            branch_id, parent_branch_id, fork_sequence, label, head_sequence,
            head_state_version, created_at, archived_at
          ) VALUES (?, NULL, NULL, '主线', 0, 0, ?, NULL)`,
          [branchId, now],
        );
      });
    } finally {
      campaign.close();
    }
    const summary = insertCatalog(this.settings, {
      campaignId,
      name: trimmed,
      relativePath: this.paths.campaignRelative(campaignId),
      headBranchId: branchId,
      now,
    });
    return ok(summary);
  }

  list(page: PageRequest): Result<Page<CampaignSummary>> {
    return ok(listCatalog(this.settings, page));
  }

  open(campaignId: CampaignId): Result<CampaignView> {
    const row = getCatalog(this.settings, campaignId);
    if (!row || row.trashed_at) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "campaign.not_found",
        retryable: false,
      });
    }
    const file = this.paths.campaignFile(campaignId);
    if (!this.openCampaigns.has(campaignId)) {
      const driver = this.openDriver(file);
      applyInit(driver, this.clock, this.campaignSql, "0001_init");
      this.openCampaigns.set(campaignId, driver);
    }
    touchOpened(this.settings, campaignId, this.clock.nowIso());
    return ok({
      campaignId: asCampaignId(row.campaign_id),
      name: row.name,
      health: row.health,
      headBranchId: asBranchId(row.head_branch_id),
      headStateVersion: asStateVersion(row.head_state_version),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastOpenedAt: this.clock.nowIso(),
      activeScene: null,
      playerCharacters: [],
      contentBindings: [],
    });
  }

  close(campaignId: CampaignId): Result<void> {
    const driver = this.openCampaigns.get(campaignId);
    driver?.close();
    this.openCampaigns.delete(campaignId);
    return ok(undefined);
  }

  moveToTrash(campaignId: CampaignId): Result<void> {
    if (!getCatalog(this.settings, campaignId)) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "campaign.not_found",
        retryable: false,
      });
    }
    this.close(campaignId);
    setTrashed(this.settings, campaignId, this.clock.nowIso(), this.clock.nowIso());
    return ok(undefined);
  }

  restoreFromTrash(campaignId: CampaignId): Result<void> {
    if (!getCatalog(this.settings, campaignId)) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "campaign.not_found",
        retryable: false,
      });
    }
    setTrashed(this.settings, campaignId, null, this.clock.nowIso());
    return ok(undefined);
  }

  driver(campaignId: CampaignId): Driver | undefined {
    return this.openCampaigns.get(campaignId);
  }

  ensureOpen(campaignId: CampaignId): Result<Driver> {
    const opened = this.open(campaignId);
    if (!opened.ok) return opened;
    const driver = this.openCampaigns.get(campaignId);
    if (!driver) {
      return fail({
        code: "IPC_INTERNAL_ERROR",
        messageKey: "campaign.not_open",
        retryable: false,
      });
    }
    return ok(driver);
  }

  setHead(campaignId: CampaignId, version: number): void {
    setCatalogHead(this.settings, campaignId, version, this.clock.nowIso());
  }

  dispose(): void {
    for (const driver of this.openCampaigns.values()) driver.close();
    this.openCampaigns.clear();
  }
}
