import { ipcMain } from "electron";
import { z } from "zod";
import { API_VERSION } from "../../shared/api";
import { asCampaignId } from "../../shared/ids";
import { fail, ok, unavailable, type Result } from "../../shared/result";
import type { Clock } from "../clock";
import type { Composition } from "../composition";
import { getSetting, setSetting } from "../persist/catalog";
import type { LifecycleState } from "../lifecycle";

const MAX_BYTES = 1024 * 1024;

const nameSchema = z.object({ name: z.string() }).strict();
const pageSchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().positive(),
  })
  .strict();
const idSchema = z.object({ campaignId: z.string().min(1) }).strict();
const settingGet = z.object({ key: z.string().min(1) }).strict();
const settingSet = z.object({ key: z.string().min(1), value: z.unknown() }).strict();

function tooBig(payload: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(payload ?? null), "utf8") > MAX_BYTES;
}

function wrap(fn: (payload: unknown) => Result<unknown>) {
  return (_event: unknown, payload: unknown): Result<unknown> => {
    try {
      if (tooBig(payload)) {
        return fail({
          code: "IPC_PAYLOAD_TOO_LARGE",
          messageKey: "ipc.payload_too_large",
          retryable: false,
        });
      }
      return fn(payload);
    } catch {
      return fail({
        code: "IPC_INTERNAL_ERROR",
        messageKey: "ipc.internal",
        retryable: false,
      });
    }
  };
}

export function registerIpc(
  composition: Composition,
  lifecycle: LifecycleState,
  clock: Clock,
): void {
  ipcMain.removeHandler("app:getVersion");
  const handle = (channel: string, fn: (payload: unknown) => Result<unknown>) => {
    ipcMain.handle(channel, wrap(fn));
  };

  handle("app:getVersion", () => ok(API_VERSION));
  handle("app:getState", () => ok({ lifecycle: lifecycle.get() }));

  handle("campaign:create", (payload) => {
    const parsed = nameSchema.safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    return composition.campaigns.create(parsed.data.name);
  });

  handle("campaign:list", (payload) => {
    const parsed = pageSchema.safeParse(payload ?? { limit: 20 });
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    return composition.campaigns.list(parsed.data);
  });

  handle("campaign:open", (payload) => {
    const parsed = idSchema.safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    return composition.campaigns.open(asCampaignId(parsed.data.campaignId));
  });

  handle("campaign:close", (payload) => {
    const parsed = idSchema.safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    return composition.campaigns.close(asCampaignId(parsed.data.campaignId));
  });

  handle("campaign:moveToTrash", (payload) => {
    const parsed = idSchema.safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    return composition.campaigns.moveToTrash(asCampaignId(parsed.data.campaignId));
  });

  handle("campaign:restoreFromTrash", (payload) => {
    const parsed = idSchema.safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    return composition.campaigns.restoreFromTrash(asCampaignId(parsed.data.campaignId));
  });

  handle("settings:get", (payload) => {
    const parsed = settingGet.safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    return ok(getSetting(composition.settings, parsed.data.key));
  });

  handle("settings:set", (payload) => {
    const parsed = settingSet.safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    setSetting(composition.settings, parsed.data.key, parsed.data.value, clock.nowIso());
    return ok(undefined);
  });

  handle("turn:submitAction", () => unavailable());
  handle("timeline:page", () => unavailable());
  handle("content:list", () => unavailable());
  handle("model:list", () => unavailable());
  handle("backup:export", () => unavailable());
  handle("operation:get", () => unavailable());
}
