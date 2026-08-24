import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvestigatorAllocation } from "../../../demo/src/character/types";
import type { InvestigatorProfile } from "../../../demo/src/character/types";
import { fixedClock } from "../clock";
import { resolvePaths } from "../paths";
import { CampaignService } from "../services/campaigns";
import { CHANNELS } from "../../shared/api";
import { openBun } from "./bun-driver";
import {
  bindInvestigator,
  hashProfile,
  loadInvestigator,
  saveInvestigator,
} from "./investigator";
import { applyInit, applyMigration } from "./migrate";

const now = "2026-08-24T00:00:00.000Z";
const profile: InvestigatorProfile = {
  name: "林晚",
  occupation: "记者",
  characteristics: { STR: 50, CON: 50, SIZ: 60, DEX: 60, APP: 50, INT: 70, POW: 65, EDU: 70 },
  baseSkills: { 侦查: 25, 聆听: 20, 图书馆使用: 20, 话术: 5, 心理学: 10, 开锁: 1 },
  occupationPoints: { 侦查: 55, 聆听: 35, 图书馆使用: 50, 话术: 70, 心理学: 70 },
  interestPoints: { 侦查: 7, 聆听: 35, 图书馆使用: 9, 开锁: 89 },
  skills: { 侦查: 87, 聆听: 90, 图书馆使用: 79, 话术: 75, 心理学: 80, 开锁: 90 },
  hp: 11,
  san: 65,
  sanMax: 99,
  lifeHistoryId: "history.archive-correspondent",
  contentVersion: "0.1.0",
};
const allocation: InvestigatorAllocation = {
  name: profile.name,
  lifeHistoryId: profile.lifeHistoryId,
  occupationPoints: profile.occupationPoints,
  interestPoints: profile.interestPoints,
};

function openDatabase() {
  const db = openBun(":memory:");
  const clock = fixedClock(now);
  const sqlDir = join(import.meta.dir, "../../sql");
  applyInit(db, clock, readFileSync(join(sqlDir, "campaign.sql"), "utf8"), "0001_init");
  applyMigration(
    db,
    clock,
    readFileSync(join(sqlDir, "campaign-0004-investigator.sql"), "utf8"),
    "0004_investigator",
  );
  db.run("INSERT INTO branches VALUES ('main', NULL, NULL, '主线', 0, 0, ?, NULL)", [now]);
  return db;
}

describe("immutable campaign investigator persistence", () => {
  test("confirmed investigator binding is immutable and survives reopen", () => {
    const db = openDatabase();
    try {
      const first = saveInvestigator(db, {
        profile,
        profileHash: hashProfile(profile),
        createdAt: now,
      });
      const other = saveInvestigator(db, {
        profile: { ...profile, name: "顾弦" },
        profileHash: hashProfile({ ...profile, name: "顾弦" }),
        createdAt: now,
      });

      bindInvestigator(db, "main", first.profileId);

      expect(loadInvestigator(db, "main")).toEqual(first);
      expect(() => bindInvestigator(db, "main", other.profileId)).toThrow(
        "investigator.branch_already_bound",
      );
    } finally {
      db.close();
    }
  });

  test("profile rows are append-only and child branches inherit the binding", () => {
    const db = openDatabase();
    try {
      const saved = saveInvestigator(db, {
        profile,
        profileHash: hashProfile(profile),
        createdAt: now,
      });
      bindInvestigator(db, "main", saved.profileId);

      expect(() =>
        db.run("UPDATE investigator_profiles SET profile_hash = 'tampered' WHERE profile_id = ?", [
          saved.profileId,
        ]),
      ).toThrow();
      expect(() =>
        db.run("DELETE FROM investigator_profiles WHERE profile_id = ?", [saved.profileId]),
      ).toThrow();

      db.run("INSERT INTO branches VALUES ('copy', 'main', 0, '副本', 0, 0, ?, NULL)", [now]);
      expect(loadInvestigator(db, "copy")).toEqual(saved);
    } finally {
      db.close();
    }
  });

  test("a branch with formal play cannot receive its first binding", () => {
    const db = openDatabase();
    try {
      const saved = saveInvestigator(db, {
        profile,
        profileHash: hashProfile(profile),
        createdAt: now,
      });
      db.run(
        `INSERT INTO turns (
          turn_id, branch_id, command_id, actor_id, controller_id, input_text, status,
          base_state_version, committed_state_version, operation_id, failure_code, created_at, updated_at
        ) VALUES ('formal', 'main', 'formal', 'pc.linwan', 'player', '开始', 'received', 0, NULL,
          'formal-operation', NULL, ?, ?)`,
        [now, now],
      );

      expect(() => bindInvestigator(db, "main", saved.profileId)).toThrow(
        "investigator.branch_started",
      );
      expect(loadInvestigator(db, "main")).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("atomic investigator confirmation", () => {
  test("desktop contract exposes confirm and get without an investigator edit channel", () => {
    expect("campaign:confirmInvestigator" in CHANNELS).toBe(true);
    expect("campaign:getInvestigator" in CHANNELS).toBe(true);
    expect("campaign:applyCharacterCard" in CHANNELS).toBe(false);
  });

  test("confirmation commits the profile and history once", () => {
    const fixture = campaignService();
    try {
      const created = fixture.service.create("调查员确认");
      if (!created.ok) throw new Error("campaign create failed");

      const confirmed = fixture.service.confirmInvestigator({
        campaignId: created.value.campaignId,
        branchId: created.value.headBranchId,
        allocation,
      });
      expect(confirmed.ok).toBe(true);
      const db = fixture.service.driver(created.value.campaignId);
      expect(db?.get<{ count: number }>("SELECT count(*) AS count FROM investigator_profiles")?.count)
        .toBe(1);
      expect(
        db?.all<{ event_type: string }>("SELECT event_type FROM events ORDER BY sequence")
          .map((row) => row.event_type),
      ).toEqual(["sheet_applied", "fact_known", "relationship_established"]);

      const duplicate = fixture.service.confirmInvestigator({
        campaignId: created.value.campaignId,
        branchId: created.value.headBranchId,
        allocation,
      });
      expect(duplicate.ok).toBe(false);
      expect(db?.get<{ count: number }>("SELECT count(*) AS count FROM investigator_profiles")?.count)
        .toBe(1);
    } finally {
      fixture.close();
    }
  });

  test("checkpoint failure rolls back the complete confirmation", () => {
    const fixture = campaignService();
    try {
      const created = fixture.service.create("原子确认");
      if (!created.ok) throw new Error("campaign create failed");
      const opened = fixture.service.ensureOpen(created.value.campaignId);
      if (!opened.ok) throw new Error("campaign open failed");
      opened.value.exec(`
        CREATE TRIGGER reject_confirmation_checkpoint BEFORE INSERT ON checkpoints
        BEGIN
          SELECT RAISE(ABORT, 'checkpoint rejected');
        END;
      `);

      const confirmed = fixture.service.confirmInvestigator({
        campaignId: created.value.campaignId,
        branchId: created.value.headBranchId,
        allocation,
      });
      expect(confirmed.ok).toBe(false);
      expect(opened.value.get<{ count: number }>("SELECT count(*) AS count FROM investigator_profiles")?.count)
        .toBe(0);
      expect(opened.value.get<{ count: number }>("SELECT count(*) AS count FROM events")?.count)
        .toBe(0);
      expect(
        opened.value.get<{ head: number }>(
          "SELECT head_state_version AS head FROM branches WHERE branch_id = ?",
          [created.value.headBranchId],
        )?.head,
      ).toBe(0);
    } finally {
      fixture.close();
    }
  });

  test("formal play prevents first-time confirmation", () => {
    const fixture = campaignService();
    try {
      const created = fixture.service.create("正式游玩分支");
      if (!created.ok) throw new Error("campaign create failed");
      const opened = fixture.service.ensureOpen(created.value.campaignId);
      if (!opened.ok) throw new Error("campaign open failed");
      opened.value.run(
        `INSERT INTO turns (
          turn_id, branch_id, command_id, actor_id, controller_id, input_text, status,
          base_state_version, committed_state_version, operation_id, failure_code, created_at, updated_at
        ) VALUES ('formal', ?, 'formal', 'pc.linwan', 'player', '开始', 'received', 0, NULL,
          'formal-operation', NULL, ?, ?)`,
        [created.value.headBranchId, now, now],
      );

      const confirmed = fixture.service.confirmInvestigator({
        campaignId: created.value.campaignId,
        branchId: created.value.headBranchId,
        allocation,
      });
      expect(confirmed.ok).toBe(false);
      expect(opened.value.get<{ count: number }>("SELECT count(*) AS count FROM investigator_profiles")?.count)
        .toBe(0);
    } finally {
      fixture.close();
    }
  });
});

function campaignService() {
  const root = mkdtempSync(join(tmpdir(), "investigator-service-"));
  const paths = resolvePaths(root);
  const settings = openBun(paths.settingsDb);
  const clock = fixedClock(now);
  const sqlDir = join(import.meta.dir, "../../sql");
  applyInit(settings, clock, readFileSync(join(sqlDir, "settings.sql"), "utf8"), "0001_init");
  const service = new CampaignService(
    settings,
    paths,
    clock,
    openBun,
    readFileSync(join(sqlDir, "campaign.sql"), "utf8"),
    [
      {
        id: "0003_checkpoint_tests",
        sql: readFileSync(join(sqlDir, "campaign-0003-checkpoint-tests.sql"), "utf8"),
      },
      {
        id: "0004_investigator",
        sql: readFileSync(join(sqlDir, "campaign-0004-investigator.sql"), "utf8"),
      },
      {
        id: "0005_checkpoint_recaps",
        sql: readFileSync(join(sqlDir, "campaign-0005-checkpoint-recaps.sql"), "utf8"),
      },
      {
        id: "0006_checkpoint_dialogue_members",
        sql: readFileSync(join(sqlDir, "campaign-0006-checkpoint-dialogue-members.sql"), "utf8"),
      },
    ],
  );
  return {
    service,
    close() {
      service.dispose();
      settings.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // bun:sqlite can retain Windows file handles until process exit.
      }
    },
  };
}
