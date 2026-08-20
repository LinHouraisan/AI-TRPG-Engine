import { contextBridge, ipcRenderer } from "electron";
import {
  API_VERSION,
  OPERATION_EVENT_CHANNEL,
  isOperationEvent,
  type DesktopApi,
} from "../shared/api";
import type { Result } from "../shared/result";

function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<Result<T>>;
}

const desktopApi: DesktopApi = {
  version: API_VERSION,
  app: {
    getVersion: () => invoke("app:getVersion"),
    getState: () => invoke("app:getState"),
  },
  campaign: {
    create: (input) => invoke("campaign:create", input),
    list: (input) => invoke("campaign:list", input),
    open: (input) => invoke("campaign:open", input),
    close: (input) => invoke("campaign:close", input),
    moveToTrash: (input) => invoke("campaign:moveToTrash", input),
    restoreFromTrash: (input) => invoke("campaign:restoreFromTrash", input),
    applyCharacterCard: (input) => invoke("campaign:applyCharacterCard", input),
  },
  settings: {
    get: (input) => invoke("settings:get", input),
    set: (input) => invoke("settings:set", input),
    setSecret: (input) => invoke("settings:setSecret", input),
    hasSecret: (input) => invoke("settings:hasSecret", input),
    deleteSecret: (input) => invoke("settings:deleteSecret", input),
    listProviders: () => invoke("settings:listProviders"),
    upsertProvider: (input) => invoke("settings:upsertProvider", input),
    deleteProvider: (input) => invoke("settings:deleteProvider", input),
    listProfiles: () => invoke("settings:listProfiles"),
    upsertProfile: (input) => invoke("settings:upsertProfile", input),
    listTaskRoutes: () => invoke("settings:listTaskRoutes"),
    setTaskRoute: (input) => invoke("settings:setTaskRoute", input),
  },
  turn: {
    submitAction: (input) => invoke("turn:submitAction", input),
  },
  timeline: {
    page: (input) => invoke("timeline:page", input),
  },
  content: {
    list: () => invoke("content:list"),
  },
  model: {
    list: () => invoke("model:list"),
  },
  backup: {
    exportCampaign: () => invoke("backup:export"),
  },
  operation: {
    get: (input) => invoke("operation:get", input),
    subscribe: (input) => invoke("operation:subscribe", input),
    unsubscribe: (input) => invoke("operation:unsubscribe", input),
    onEvent: (cb) => {
      const listener = (_event: unknown, payload: unknown) => {
        if (!isOperationEvent(payload)) return;
        cb(payload);
      };
      ipcRenderer.on(OPERATION_EVENT_CHANNEL, listener);
      return () => {
        ipcRenderer.removeListener(OPERATION_EVENT_CHANNEL, listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
