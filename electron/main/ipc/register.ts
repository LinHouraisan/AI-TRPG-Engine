import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { API_VERSION, OPERATION_EVENT_CHANNEL, type SubmitActionInput } from "../../shared/api";
import { asBranchId, asCampaignId } from "../../shared/ids";
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
const setSecretSchema = z
  .object({
    credentialId: z.string().min(1).optional(),
    value: z.string().min(1),
  })
  .strict();
const secretIdSchema = z.object({ credentialId: z.string().min(1) }).strict();

function tooBig(payload: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(payload ?? null), "utf8") > MAX_BYTES;
}

function wrap(
  fn: (payload: unknown, event: IpcMainInvokeEvent) => Result<unknown> | Promise<Result<unknown>>,
) {
  return async (event: IpcMainInvokeEvent, payload: unknown): Promise<Result<unknown>> => {
    try {
      if (tooBig(payload)) {
        return fail({
          code: "IPC_PAYLOAD_TOO_LARGE",
          messageKey: "ipc.payload_too_large",
          retryable: false,
        });
      }
      return await fn(payload, event);
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
  const handle = (
    channel: string,
    fn: (payload: unknown, event: IpcMainInvokeEvent) => Result<unknown> | Promise<Result<unknown>>,
  ) => {
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

  handle("settings:setSecret", (payload) => {
    const parsed = setSecretSchema.safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    return composition.credentials.set(parsed.data);
  });

  handle("settings:hasSecret", (payload) => {
    const parsed = secretIdSchema.safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    return composition.credentials.has(parsed.data.credentialId);
  });

  handle("settings:deleteSecret", (payload) => {
    const parsed = secretIdSchema.safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    return composition.credentials.delete(parsed.data.credentialId);
  });

  const submitSchema = z
    .object({
      campaignId: z.string().min(1),
      branchId: z.string().min(1),
      actorId: z.string().min(1),
      controllerId: z.string().min(1),
      expectedStateVersion: z.number().int().nonnegative(),
      commandId: z.string().min(1),
      text: z.string(),
    })
    .strict();

  handle("turn:submitAction", (payload) => {
    const parsed = submitSchema.safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    return composition.turns.submit({
      ...parsed.data,
      campaignId: asCampaignId(parsed.data.campaignId),
      branchId: asBranchId(parsed.data.branchId),
      actorId: parsed.data.actorId as SubmitActionInput["actorId"],
      expectedStateVersion: parsed.data.expectedStateVersion as SubmitActionInput["expectedStateVersion"],
    });
  });

  handle("timeline:page", (payload) => {
    const parsed = z
      .object({
        campaignId: z.string().min(1),
        branchId: z.string().min(1),
        page: pageSchema,
      })
      .strict()
      .safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    return composition.turns.timeline(
      asCampaignId(parsed.data.campaignId),
      parsed.data.branchId,
      parsed.data.page.limit,
    );
  });

  handle("operation:get", (payload) => {
    const parsed = z
      .object({ operationId: z.string().min(1), campaignId: z.string().min(1) })
      .strict()
      .safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    return composition.turns.get(parsed.data.operationId, asCampaignId(parsed.data.campaignId));
  });

  handle("operation:subscribe", (payload, event) => {
    const parsed = z.object({ operationId: z.string().min(1) }).strict().safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    const sender = event.sender;
    const subscriptionId = composition.turns.subscribe(parsed.data.operationId, (opEvent) => {
      if (sender.isDestroyed()) return;
      sender.send(OPERATION_EVENT_CHANNEL, opEvent);
    });
    return ok({ subscriptionId });
  });

  handle("operation:unsubscribe", (payload) => {
    const parsed = z.object({ subscriptionId: z.string().min(1) }).strict().safeParse(payload);
    if (!parsed.success) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    composition.turns.unsubscribe(parsed.data.subscriptionId);
    return ok(undefined);
  });

  handle("content:list", () => unavailable());
  handle("model:list", () => unavailable());
  handle("backup:export", () => unavailable());
}
