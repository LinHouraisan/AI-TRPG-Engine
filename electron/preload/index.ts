import { contextBridge, ipcRenderer } from "electron";
import { API_VERSION, type DesktopApi } from "../shared/api";
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
  },
  settings: {
    get: (input) => invoke("settings:get", input),
    set: (input) => invoke("settings:set", input),
  },
  turn: {
    submitAction: (input) => invoke("turn:submitAction", input),
  },
  timeline: {
    page: () => invoke("timeline:page"),
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
    get: () => invoke("operation:get"),
  },
};

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
