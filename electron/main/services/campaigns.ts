import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { validateAllocation } from "../../../demo/src/character/creation";
import { loadPackById } from "../../../demo/src/engine/pack";
import type { EventDraft, GameEvent } from "../../../demo/src/engine/types";
import { sheetDraft } from "../../../demo/src/cards/apply";
import type {
  CampaignSummary,
  CampaignBackup,
  CampaignView,
  ConfirmInvestigatorInput,
  ConfirmInvestigatorView,
  Page,
  PageRequest,
} from "../../shared/api";
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
  setCatalogBranchHead,
  setTrashed,
  touchOpened,
} from "../persist/catalog";
import type { Driver } from "../persist/driver";
import { applyInit, applyMigration } from "../persist/migrate";
import {
  createCheckpoint,
  createInvestigatorRecreationBranch,
} from "../persist/checkpoints";
import {
  bindInvestigator,
  hashProfile,
  loadInvestigator,
  saveInvestigator,
} from "../persist/investigator";
import { appendCommitted } from "../persist/turns";
import { exportCampaignBackup, importCampaignBackup } from "../persist/backup";

export type OpenDriver = (path: string) => Driver;

export type NamedSql = { id: string; sql: string };

const investigatorPack = loadPackById("mist-harbor");

export class CampaignService {
  private readonly openCampaigns = new Map<string, Driver>();

  constructor(
    readonly settings: Driver,
    private readonly paths: AppPaths,
    private readonly clock: Clock,
    private readonly openDriver: OpenDriver,
    private readonly campaignSql: string,
    private readonly extraMigrations: NamedSql[] = [],
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
      for (const migration of this.extraMigrations) {
        applyMigration(campaign, this.clock, migration.sql, migration.id);
      }
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
      for (const migration of this.extraMigrations) {
        applyMigration(driver, this.clock, migration.sql, migration.id);
      }
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

  confirmInvestigator(input: ConfirmInvestigatorInput): Result<ConfirmInvestigatorView> {
    const opened = this.ensureOpen(input.campaignId);
    if (!opened.ok) return opened;
    const db = opened.value;
    const catalog = getCatalog(this.settings, input.campaignId);
    if (!catalog || catalog.head_branch_id !== input.branchId) {
      return fail({
        code: "TURN_VERSION_CONFLICT",
        messageKey: "turn.branch_mismatch",
        retryable: true,
      });
    }
    if (loadInvestigator(db, input.branchId)) {
      return fail({
        code: "INVESTIGATOR_ALREADY_CONFIRMED",
        messageKey: "investigator.already_confirmed",
        retryable: false,
      });
    }
    const formalTurns = db.get<{ count: number }>(
      "SELECT count(*) AS count FROM turns WHERE branch_id = ?",
      [input.branchId],
    )?.count ?? 0;
    if (formalTurns > 0) {
      return fail({
        code: "INVESTIGATOR_BRANCH_STARTED",
        messageKey: "investigator.branch_started",
        retryable: false,
      });
    }
    const rules = investigatorPack.manifest.creation;
    if (!rules) {
      return fail({
        code: "INVESTIGATOR_CREATION_UNAVAILABLE",
        messageKey: "investigator.creation_unavailable",
        retryable: false,
      });
    }
    const validated = validateAllocation(rules, input.allocation);
    if (!validated.ok) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "investigator.allocation_invalid",
        retryable: false,
        details: { issueCount: validated.issues.length },
      });
    }
    const history = rules.lifeHistories.find(
      (candidate) => candidate.id === validated.profile.lifeHistoryId,
    );
    if (!history) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "investigator.life_history_invalid",
        retryable: false,
      });
    }

    const profile = validated.profile;
    const profileHash = hashProfile(profile);
    const turnId = `${input.branchId}:turn-1`;
    const drafts: EventDraft[] = [
      sheetDraft({
        name: profile.name,
        occupation: profile.occupation,
        hp: profile.hp,
        hpMax: profile.hp,
        san: profile.san,
        sanMax: profile.sanMax,
        skills: profile.skills,
        cardHash: profileHash,
        characteristics: profile.characteristics,
        baseSkills: profile.baseSkills,
        occupationPoints: profile.occupationPoints,
        interestPoints: profile.interestPoints,
        lifeHistoryId: profile.lifeHistoryId,
      }),
      history.initialGrant.kind === "fact"
        ? {
            payload: { type: "fact_known", fact: history.initialGrant.id },
            summary: `人生经历带来已知线索「${history.initialGrant.id}」。`,
            cause: `history:${history.id}`,
          }
        : {
            payload: {
              type: "item_moved",
              item: history.initialGrant.id,
              from:
                investigatorPack.items.find((item) => item.id === history.initialGrant.id)?.at ??
                "unknown",
              to: "inv.pc",
            },
            summary: `人生经历带来初始物品「${history.initialGrant.id}」。`,
            cause: `history:${history.id}`,
          },
      {
        payload: {
          type: "relationship_established",
          npc: history.relationship.npcId,
          text: history.relationship.text,
        },
        summary: history.relationship.text,
        cause: `history:${history.id}`,
      },
    ];
    const committed: GameEvent[] = drafts.map((draft, index) => ({
      ...draft,
      id: `${turnId}-${index}`,
      seq: index,
      turnId,
      versionAfter: 1,
      clock: 0,
      visibility: draft.visibility ?? "public",
    }));
    const now = this.clock.nowIso();
    const operationId = uuidv7();
    let checkpointId = "";
    try {
      db.transaction(() => {
        const record = saveInvestigator(db, { profile, profileHash, createdAt: now });
        bindInvestigator(db, input.branchId, record.profileId);
        appendCommitted({
          db,
          campaignId: input.campaignId,
          branchId: input.branchId,
          turnId,
          operationId,
          commandId: `${input.branchId}:confirm-investigator`,
          actorId: investigatorPack.manifest.investigator.id,
          controllerId: "player",
          text: `确认调查员 ${profile.name}`,
          now,
          status: "completed",
          baseVersion: 0,
          committedVersion: 1,
          events: committed,
          result: { profile, stateVersion: 1 },
        });
        checkpointId = createCheckpoint(db, {
          branchId: input.branchId,
          label: "正式开局前",
          now,
        }).checkpointId;
      });
    } catch {
      return fail({
        code: "INVESTIGATOR_CONFIRMATION_FAILED",
        messageKey: "investigator.confirmation_failed",
        retryable: false,
      });
    }
    this.setHead(input.campaignId, 1);
    return ok({
      profile,
      branchId: input.branchId,
      stateVersion: 1,
      checkpointId,
    });
  }

  getInvestigator(campaignId: CampaignId): Result<ConfirmInvestigatorView["profile"] | null> {
    const opened = this.ensureOpen(campaignId);
    if (!opened.ok) return opened;
    const catalog = getCatalog(this.settings, campaignId);
    if (!catalog) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "campaign.not_found",
        retryable: false,
      });
    }
    return ok(loadInvestigator(opened.value, catalog.head_branch_id)?.profile ?? null);
  }

  exportCampaign(campaignId: CampaignId): Result<CampaignBackup> {
    const opened = this.ensureOpen(campaignId);
    if (!opened.ok) return opened;
    const catalog = getCatalog(this.settings, campaignId);
    if (!catalog) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "campaign.not_found",
        retryable: false,
      });
    }
    try {
      return ok(exportCampaignBackup(opened.value, {
        campaignId,
        name: catalog.name,
        headBranchId: catalog.head_branch_id,
        headStateVersion: catalog.head_state_version,
      }));
    } catch {
      return fail({ code: "BACKUP_EXPORT_FAILED", messageKey: "backup.export_failed", retryable: false });
    }
  }

  importCampaign(backup: CampaignBackup): Result<CampaignSummary> {
    const campaignId = uuidv7();
    const file = this.paths.campaignFile(campaignId);
    mkdirSync(dirname(file), { recursive: true });
    const db = this.openDriver(file);
    try {
      applyInit(db, this.clock, this.campaignSql, "0001_init");
      for (const migration of this.extraMigrations) {
        applyMigration(db, this.clock, migration.sql, migration.id);
      }
      const imported = importCampaignBackup(db, backup, campaignId);
      db.close();
      const catalog = this.settings.transaction(() => {
        insertCatalog(this.settings, {
          campaignId,
          name: imported.name,
          relativePath: this.paths.campaignRelative(campaignId),
          headBranchId: imported.headBranchId,
          now: this.clock.nowIso(),
        });
        setCatalogBranchHead(
          this.settings,
          campaignId,
          imported.headBranchId,
          imported.headStateVersion,
          this.clock.nowIso(),
        );
        const inserted = getCatalog(this.settings, asCampaignId(campaignId));
        if (!inserted) throw new Error("backup.catalog_failed");
        return inserted;
      });
      return ok({
        campaignId: asCampaignId(catalog.campaign_id),
        name: catalog.name,
        health: catalog.health,
        headBranchId: asBranchId(catalog.head_branch_id),
        headStateVersion: asStateVersion(catalog.head_state_version),
        createdAt: catalog.created_at,
        updatedAt: catalog.updated_at,
        lastOpenedAt: catalog.last_opened_at,
      });
    } catch {
      try { db.close(); } catch { /* already closed */ }
      try { rmSync(file, { force: true }); } catch { /* invalid imports stay uncatalogued */ }
      return fail({ code: "BACKUP_INVALID", messageKey: "backup.invalid", retryable: false });
    }
  }

  createInvestigatorRecreation(input: {
    campaignId: CampaignId;
    checkpointId: string;
    label: string;
  }): Result<{ branchId: string; stateVersion: number }> {
    const opened = this.ensureOpen(input.campaignId);
    if (!opened.ok) return opened;
    try {
      const recreated = createInvestigatorRecreationBranch(
        opened.value,
        input.checkpointId,
        input.label,
        this.clock.nowIso(),
      );
      this.setBranchHead(input.campaignId, recreated.branchId, recreated.stateVersion);
      return ok(recreated);
    } catch {
      return fail({
        code: "INVESTIGATOR_RECREATION_REJECTED",
        messageKey: "investigator.recreation_rejected",
        retryable: false,
      });
    }
  }

  setHead(campaignId: CampaignId, version: number): void {
    setCatalogHead(this.settings, campaignId, version, this.clock.nowIso());
  }

  setBranchHead(campaignId: CampaignId, branchId: string, version: number): void {
    setCatalogBranchHead(this.settings, campaignId, branchId, version, this.clock.nowIso());
  }

  dispose(): void {
    for (const driver of this.openCampaigns.values()) driver.close();
    this.openCampaigns.clear();
  }
}
