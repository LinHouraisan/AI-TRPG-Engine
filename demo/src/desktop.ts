/** Electron preload 挂上的桥。浏览器里没有，Demo 继续走自己的 wasm 库。 */
export type DesktopResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; messageKey: string } };

export interface DesktopCampaign {
  campaignId: string;
  name: string;
  headBranchId: string;
  headStateVersion: number;
}

export type NarrationKind = "模型" | "模板" | "程序";

export type DesktopTurnView = {
  kind: "query" | "clarification" | "committed";
  narration: string;
  narrationKind: NarrationKind;
  narrationNote?: string;
  events: unknown[];
  stateVersion: number;
  check?: unknown;
  intent: unknown;
};

export type OperationEvent =
  | {
      type: "operation.status";
      operation: { operationId: string; status: string; progress: { phase: string } };
    }
  | { type: "narration.delta"; operationId: string; turnId: string; sequence: number; text: string }
  | { type: "narration.completed"; operationId: string; turnId: string; narrationId: string }
  | { type: "campaign.changed"; campaignId: string; branchId: string; stateVersion: number };

export interface DesktopApi {
  version: { major: 1; minor: number };
  campaign: {
    create(input: { name: string }): Promise<DesktopResult<DesktopCampaign>>;
    list(input: { limit: number }): Promise<DesktopResult<{ items: DesktopCampaign[] }>>;
    open(input: { campaignId: string }): Promise<DesktopResult<DesktopCampaign>>;
    applyCharacterCard?(input: {
      campaignId: string;
      branchId: string;
      expectedStateVersion: number;
      commandId: string;
      name: string;
      occupation: string;
      hp: number;
      hpMax: number;
      san: number;
      sanMax: number;
      skills: Record<string, number>;
      cardHash: string;
    }): Promise<DesktopResult<{ operationId: string; turnId: string; stateVersion: number }>>;
  };
  settings: {
    get(input: { key: string }): Promise<DesktopResult<unknown>>;
    set(input: { key: string; value: unknown }): Promise<DesktopResult<void>>;
    listProviders(): Promise<DesktopResult<Array<{
      providerInstanceId: string;
      providerType: string;
      displayName: string;
      baseUrl: string | null;
      enabled: boolean;
    }>>>;
    upsertProvider(input: {
      providerInstanceId?: string;
      providerType: string;
      displayName: string;
      baseUrl?: string | null;
      enabled: boolean;
    }): Promise<DesktopResult<{ providerInstanceId: string }>>;
    listProfiles(): Promise<DesktopResult<Array<{
      modelProfileId: string;
      providerInstanceId: string;
      modelId: string;
      displayName: string;
      enabled: boolean;
    }>>>;
    upsertProfile(input: {
      modelProfileId?: string;
      providerInstanceId: string;
      modelId: string;
      displayName: string;
      enabled: boolean;
    }): Promise<DesktopResult<unknown>>;
    listTaskRoutes(): Promise<DesktopResult<Array<{
      taskType: string;
      primaryModelProfileId: string;
      fallbackModelProfileId: string | null;
    }>>>;
    setTaskRoute(input: {
      taskType: string;
      primaryModelProfileId: string;
    }): Promise<DesktopResult<unknown>>;
  };
  turn: {
    submitAction(input: {
      campaignId: string;
      branchId: string;
      actorId: string;
      controllerId: string;
      expectedStateVersion: number;
      commandId: string;
      text: string;
    }): Promise<DesktopResult<{ operationId: string; turnId?: string }>>;
  };
  timeline: {
    page(input: {
      campaignId: string;
      branchId: string;
      page: { limit: number };
    }): Promise<DesktopResult<{ items: unknown[]; events?: unknown[] }>>;
  };
  operation: {
    get(input: {
      operationId: string;
      campaignId: string;
    }): Promise<DesktopResult<DesktopTurnView>>;
    subscribe(input: { operationId: string }): Promise<DesktopResult<{ subscriptionId: string }>>;
    unsubscribe(input: { subscriptionId: string }): Promise<DesktopResult<void>>;
    onEvent(cb: (event: OperationEvent) => void): () => void;
  };
}

export function desktopApi(): DesktopApi | undefined {
  const api = (window as Window & { desktopApi?: DesktopApi }).desktopApi;
  return api;
}
