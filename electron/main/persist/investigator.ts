import { createHash } from "node:crypto";
import type { InvestigatorProfile } from "../../../demo/src/character/types";
import { uuidv7 } from "../../shared/ids";
import type { Driver } from "./driver";

export type InvestigatorRecord = {
  profileId: string;
  profile: InvestigatorProfile;
  profileJson: string;
  profileHash: string;
  contentVersion: string;
  createdAt: string;
};

export function canonicalProfileJson(profile: InvestigatorProfile): string {
  return JSON.stringify(sortValue(profile));
}

export function hashProfile(profile: InvestigatorProfile): string {
  return createHash("sha256").update(canonicalProfileJson(profile)).digest("hex");
}

export function saveInvestigator(
  db: Driver,
  input: { profile: InvestigatorProfile; profileHash: string; createdAt: string },
): InvestigatorRecord {
  const profileJson = canonicalProfileJson(input.profile);
  if (hashProfile(input.profile) !== input.profileHash) {
    throw new Error("investigator.profile_hash_mismatch");
  }
  const record: InvestigatorRecord = {
    profileId: uuidv7(),
    profile: input.profile,
    profileJson,
    profileHash: input.profileHash,
    contentVersion: input.profile.contentVersion,
    createdAt: input.createdAt,
  };
  db.run(
    `INSERT INTO investigator_profiles (
      profile_id, profile_json, profile_hash, content_version, created_at
    ) VALUES (?, ?, ?, ?, ?)`,
    [
      record.profileId,
      record.profileJson,
      record.profileHash,
      record.contentVersion,
      record.createdAt,
    ],
  );
  return record;
}

export function bindInvestigator(db: Driver, branchId: string, profileId: string): void {
  const existing = db.get<{ profile_id: string }>(
    "SELECT profile_id FROM branch_investigator_bindings WHERE branch_id = ?",
    [branchId],
  );
  if (existing) throw new Error("investigator.branch_already_bound");
  const turns = db.get<{ count: number }>(
    "SELECT count(*) AS count FROM turns WHERE branch_id = ?",
    [branchId],
  )?.count ?? 0;
  if (turns > 0) throw new Error("investigator.branch_started");
  db.run(
    "INSERT INTO branch_investigator_bindings (branch_id, profile_id) VALUES (?, ?)",
    [branchId, profileId],
  );
}

export function loadInvestigator(db: Driver, branchId: string): InvestigatorRecord | null {
  const row = db.get<{
    profile_id: string;
    profile_json: string;
    profile_hash: string;
    content_version: string;
    created_at: string;
  }>(
    `SELECT p.profile_id, p.profile_json, p.profile_hash, p.content_version, p.created_at
     FROM branch_investigator_bindings b
     JOIN investigator_profiles p ON p.profile_id = b.profile_id
     WHERE b.branch_id = ?`,
    [branchId],
  );
  if (!row) return null;
  return {
    profileId: row.profile_id,
    profile: JSON.parse(row.profile_json) as InvestigatorProfile,
    profileJson: row.profile_json,
    profileHash: row.profile_hash,
    contentVersion: row.content_version,
    createdAt: row.created_at,
  };
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}
