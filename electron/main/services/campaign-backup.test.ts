import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock } from "../clock";
import { CredentialStore } from "../credentials";
import { resolvePaths } from "../paths";
import { openBun } from "../persist/bun-driver";
import { createCheckpoint } from "../persist/checkpoints";
import { hashProfile, loadInvestigator } from "../persist/investigator";
import { applyInit } from "../persist/migrate";
import { checksumBackupBody } from "../persist/backup";
import { loadBranchHistory, loadGameEvents } from "../persist/turns";
import { setSetting } from "../persist/catalog";
import { CampaignService } from "./campaigns";
import { TurnService } from "./turns";

const now = "2026-08-24T00:00:00.000Z";

test("desktop campaign backup round-trips profile hash, branch, history, recaps, and content binding", async () => {
  const fixture = campaignFixture();
  try {
    const created = fixture.campaigns.create("备份往返");
    if (!created.ok) throw new Error("campaign create failed");
    const confirmed = fixture.campaigns.confirmInvestigator({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      allocation: validAllocation("林晚"),
    });
    if (!confirmed.ok) throw new Error("investigator confirmation failed");
    const sourceDb = fixture.campaigns.driver(created.value.campaignId);
    if (!sourceDb) throw new Error("campaign not open");
    sourceDb.run(
      `INSERT INTO content_bindings (
        binding_id, content_id, content_type, content_version, content_hash,
        snapshot_relative_path, bound_at
      ) VALUES ('mist-binding', 'mist-harbor', 'scenario', '0.1.0', 'content-sha',
        'packs/mist-harbor', ?)`,
      [now],
    );
    const submitted = await fixture.turns.submit({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      actorId: "pc.linwan" as never,
      controllerId: "player",
      expectedStateVersion: 1 as never,
      commandId: "backup-history-turn",
      text: "现在几点",
    });
    if (!submitted.ok) throw new Error(`turn failed: ${submitted.error.code}`);
    await fixture.turns.waitForNarration(submitted.value.operationId);
    createCheckpoint(sourceDb, {
      branchId: created.value.headBranchId,
      label: "备份检查点",
      now: "2026-08-24T00:01:00.000Z",
    });
    setSetting(fixture.settings, "keeper.apiKey", "sk-must-not-export", now);

    const exported = fixture.campaigns.exportCampaign(created.value.campaignId);
    expect(exported.ok).toBe(true);
    if (!exported.ok) throw new Error("export failed");
    expect(JSON.stringify(exported.value)).not.toContain("sk-must-not-export");

    const imported = fixture.campaigns.importCampaign(exported.value);
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error(`import failed: ${imported.error.code}`);
    expect(imported.value.campaignId).not.toBe(created.value.campaignId);
    expect(imported.value.headBranchId).toBe(created.value.headBranchId);
    expect(imported.value.headStateVersion).toBe(1);

    const importedDbResult = fixture.campaigns.ensureOpen(imported.value.campaignId);
    if (!importedDbResult.ok) throw new Error("imported campaign open failed");
    const importedDb = importedDbResult.value;
    const sourceRecord = loadInvestigator(sourceDb, created.value.headBranchId);
    const importedRecord = loadInvestigator(importedDb, imported.value.headBranchId);
    expect(importedRecord?.profileJson).toBe(sourceRecord?.profileJson);
    expect(importedRecord?.profileHash).toBe(sourceRecord?.profileHash);
    expect(importedRecord?.profileHash).toBe(
      importedRecord ? hashProfile(importedRecord.profile) : null,
    );
    expect(loadGameEvents(importedDb, imported.value.headBranchId))
      .toEqual(loadGameEvents(sourceDb, created.value.headBranchId));
    expect(loadBranchHistory(importedDb, imported.value.headBranchId))
      .toEqual(loadBranchHistory(sourceDb, created.value.headBranchId));
    expect(importedDb.get<{ content_hash: string }>(
      "SELECT content_hash FROM content_bindings WHERE binding_id = 'mist-binding'",
    )?.content_hash).toBe("content-sha");
    expect(importedDb.get<{ count: number }>(
      "SELECT count(*) AS count FROM checkpoint_dialogue_members",
    )?.count).toBe(1);
  } finally {
    fixture.close();
  }
});

test("desktop campaign import rejects resealed profile-hash and replay mismatches", () => {
  const fixture = campaignFixture();
  try {
    const created = fixture.campaigns.create("篡改备份");
    if (!created.ok) throw new Error("campaign create failed");
    const confirmed = fixture.campaigns.confirmInvestigator({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      allocation: validAllocation("林晚"),
    });
    if (!confirmed.ok) throw new Error("investigator confirmation failed");
    const exported = fixture.campaigns.exportCampaign(created.value.campaignId);
    if (!exported.ok) throw new Error("export failed");
    const tampered = structuredClone(exported.value);
    const profile = tampered.body.tables.investigator_profiles?.[0];
    if (!profile) throw new Error("profile missing from backup");
    profile.profile_hash = "0".repeat(64);
    tampered.checksum = checksumBackupBody(tampered.body);

    const imported = fixture.campaigns.importCampaign(tampered);
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.error.code).toBe("BACKUP_INVALID");

    const replayTampered = structuredClone(exported.value);
    replayTampered.body.tables.events = replayTampered.body.tables.events
      ?.filter((row) => row.event_type !== "sheet_applied") ?? [];
    replayTampered.checksum = checksumBackupBody(replayTampered.body);
    const replayImport = fixture.campaigns.importCampaign(replayTampered);
    expect(replayImport.ok).toBe(false);
    if (!replayImport.ok) expect(replayImport.error.code).toBe("BACKUP_INVALID");
  } finally {
    fixture.close();
  }
});

function validAllocation(name: string) {
  return {
    name,
    lifeHistoryId: "history.archive-correspondent",
    occupationPoints: { 侦查: 55, 聆听: 35, 图书馆使用: 50, 话术: 70, 心理学: 70 },
    interestPoints: { 侦查: 7, 聆听: 35, 图书馆使用: 9, 开锁: 89 },
  };
}

function campaignFixture() {
  const root = mkdtempSync(join(tmpdir(), "campaign-backup-"));
  const clock = fixedClock(now);
  const paths = resolvePaths(root);
  const settings = openBun(paths.settingsDb);
  const sqlDir = join(import.meta.dir, "../../sql");
  applyInit(settings, clock, readFileSync(join(sqlDir, "settings.sql"), "utf8"), "0001_init");
  const migrations = [
    ["0002_memory", "campaign-0002-memory.sql"],
    ["0003_checkpoint_tests", "campaign-0003-checkpoint-tests.sql"],
    ["0004_investigator", "campaign-0004-investigator.sql"],
    ["0005_checkpoint_recaps", "campaign-0005-checkpoint-recaps.sql"],
    ["0006_checkpoint_dialogue_members", "campaign-0006-checkpoint-dialogue-members.sql"],
    ["0007_investigator_recreation", "campaign-0007-investigator-recreation.sql"],
  ].map(([id, file]) => ({ id, sql: readFileSync(join(sqlDir, file), "utf8") }));
  const campaigns = new CampaignService(
    settings,
    paths,
    clock,
    openBun,
    readFileSync(join(sqlDir, "campaign.sql"), "utf8"),
    migrations,
  );
  const credentials = new CredentialStore(join(root, "credentials.json"), clock, {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => "",
  });
  const turns = new TurnService(campaigns, credentials, clock);
  return {
    settings,
    campaigns,
    turns,
    close() {
      campaigns.dispose();
      settings.close();
      try { rmSync(root, { recursive: true, force: true }); } catch { /* SQLite handle */ }
    },
  };
}
