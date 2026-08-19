import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "./clock";
import type { LifecycleState } from "./lifecycle";
import type { AppPaths } from "./paths";
import { getSetting, setSetting } from "./persist/catalog";
import type { Driver } from "./persist/driver";
import { applyInit } from "./persist/migrate";
import { CampaignService, type OpenDriver } from "./services/campaigns";

export interface Composition {
  settings: Driver;
  campaigns: CampaignService;
  dispose(): void;
}

export function createComposition(input: {
  paths: AppPaths;
  clock: Clock;
  openDriver: OpenDriver;
  sqlDir: string;
  lifecycle: LifecycleState;
}): Composition {
  input.lifecycle.set("opening_settings");
  const settingsSql = readFileSync(join(input.sqlDir, "settings.sql"), "utf8");
  const campaignSql = readFileSync(join(input.sqlDir, "campaign.sql"), "utf8");
  const settings = input.openDriver(input.paths.settingsDb);
  applyInit(settings, input.clock, settingsSql, "0001_init");
  const campaigns = new CampaignService(
    settings,
    input.paths,
    input.clock,
    input.openDriver,
    campaignSql,
  );
  return {
    settings,
    campaigns,
    dispose() {
      campaigns.dispose();
      settings.close();
    },
  };
}

export function settingsApi(settings: Driver, clock: Clock) {
  return {
    get(key: string) {
      return getSetting(settings, key);
    },
    set(key: string, value: unknown) {
      setSetting(settings, key, value, clock.nowIso());
    },
  };
}
