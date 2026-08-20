import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface AppPaths {
  root: string;
  settingsDb: string;
  campaignsDir: string;
  campaignFile(campaignId: string): string;
  campaignRelative(campaignId: string): string;
}

export function resolvePaths(root: string): AppPaths {
  mkdirSync(join(root, "campaigns"), { recursive: true });
  return {
    root,
    settingsDb: join(root, "settings.sqlite"),
    campaignsDir: join(root, "campaigns"),
    campaignFile: (campaignId) => join(root, "campaigns", campaignId, "campaign.sqlite"),
    campaignRelative: (campaignId) => `campaigns/${campaignId}/campaign.sqlite`,
  };
}
