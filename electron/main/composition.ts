import { safeStorage } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "./clock";
import { CredentialStore, type SafeStorage } from "./credentials";
import type { LifecycleState } from "./lifecycle";
import type { AppPaths } from "./paths";
import { getSetting, setSetting } from "./persist/catalog";
import type { Driver } from "./persist/driver";
import { applyInit } from "./persist/migrate";
import { CampaignService, type OpenDriver } from "./services/campaigns";
import { TurnService } from "./services/turns";

export interface Composition {
  settings: Driver;
  campaigns: CampaignService;
  turns: TurnService;
  credentials: CredentialStore;
  dispose(): void;
}

function platformSafeStorage(): SafeStorage {
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (cipher) => safeStorage.decryptString(cipher),
  };
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
  const turns = new TurnService(campaigns, input.clock);
  const credentials = new CredentialStore(
    join(input.paths.root, "credentials.json"),
    input.clock,
    platformSafeStorage(),
  );
  return {
    settings,
    campaigns,
    turns,
    credentials,
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
