import { z } from "zod";

export const investigatorAllocationInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  lifeHistoryId: z.string().min(1),
  occupationPoints: z.record(z.string(), z.number().int().nonnegative()),
  interestPoints: z.record(z.string(), z.number().int().nonnegative()),
}).strict();

export const confirmInvestigatorInputSchema = z.object({
  campaignId: z.string().min(1),
  branchId: z.string().min(1),
  allocation: investigatorAllocationInputSchema,
}).strict();

const backupRowSchema = z.record(z.string(), z.unknown());

export const campaignBackupSchema = z.object({
  format: z.literal("ai-trpg-campaign-backup"),
  formatVersion: z.literal(1),
  checksum: z.string().regex(/^[0-9a-f]{64}$/u),
  body: z.object({
    sourceCampaignId: z.string().min(1),
    name: z.string().min(1).max(80),
    headBranchId: z.string().min(1),
    headStateVersion: z.number().int().nonnegative(),
    databaseSchemaVersion: z.number().int().positive(),
    domainSchemaVersion: z.number().int().positive(),
    migrations: z.array(z.object({
      migrationId: z.string().min(1),
      checksum: z.string().regex(/^[0-9a-f]{64}$/u),
    }).strict()),
    tables: z.record(z.string(), z.array(backupRowSchema)),
  }).strict(),
}).strict();

export const importCampaignBackupInputSchema = z.object({ backup: campaignBackupSchema }).strict();
