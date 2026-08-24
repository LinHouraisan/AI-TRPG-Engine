/** Electron preload 挂上的桥。浏览器里没有，Demo 继续走自己的 wasm 库。 */
import type { InvestigatorAllocation, InvestigatorProfile } from "@core/character/types";
import type { CheckCandidate, Intent } from "@core/engine/types";

export type DesktopResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; messageKey: string; retryable?: boolean } };

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

export type DesktopBranchHistory = {
  recap: string;
  recentTurns: Array<{ turnId: string; stateVersion: number; player: string; gm: string }>;
  restoredFrom: string | null;
};

export type DesktopCampaignBackup = {
  format: "ai-trpg-campaign-backup";
  formatVersion: 1;
  checksum: string;
  body: {
    sourceCampaignId: string;
    name: string;
    headBranchId: string;
    headStateVersion: number;
    databaseSchemaVersion: number;
    domainSchemaVersion: number;
    migrations: Array<{ migrationId: string; checksum: string }>;
    tables: Record<string, Array<Record<string, unknown>>>;
  };
};

export type OperationEvent =
  | {
      type: "operation.status";
      operation: { operationId: string; status: string; progress: { phase: string } };
    }
  | { type: "check.candidate"; commandId: string; intent: Intent; check: CheckCandidate }
  | { type: "narration.delta"; operationId: string; turnId: string; sequence: number; text: string }
  | { type: "narration.completed"; operationId: string; turnId: string; narrationId: string }
  | { type: "campaign.changed"; campaignId: string; branchId: string; stateVersion: number };

export interface DesktopApi {
  version: { major: 1; minor: number };
  campaign: {
    create(input: { name: string }): Promise<DesktopResult<DesktopCampaign>>;
    list(input: { limit: number }): Promise<DesktopResult<{ items: DesktopCampaign[]; nextCursor?: string | null }>>;
    open(input: { campaignId: string }): Promise<DesktopResult<DesktopCampaign>>;
    moveToTrash(input: { campaignId: string }): Promise<DesktopResult<void>>;
    confirmInvestigator(input: {
      campaignId: string;
      branchId: string;
      allocation: InvestigatorAllocation;
    }): Promise<DesktopResult<{
      profile: InvestigatorProfile;
      branchId: string;
      stateVersion: number;
      checkpointId: string;
    }>>;
    getInvestigator(input: {
      campaignId: string;
    }): Promise<DesktopResult<InvestigatorProfile | null>>;
  };
  settings: {
    get(input: { key: string }): Promise<DesktopResult<unknown>>;
    set(input: { key: string; value: unknown }): Promise<DesktopResult<void>>;
    setSecret(input: { credentialId?: string; value: string }): Promise<DesktopResult<{ credentialId: string }>>;
    hasSecret(input: { credentialId: string }): Promise<DesktopResult<{ present: boolean }>>;
    deleteSecret(input: { credentialId: string }): Promise<DesktopResult<void>>;
    testProvider(): Promise<DesktopResult<{ models: string[]; modelFound: boolean; generationOk: boolean; jsonOk: boolean }>>;
    getModelUsage(): Promise<DesktopResult<{ calls: number; promptTokens: number; completionTokens: number; estimatedMicros: number }>>;
    listProviders(): Promise<DesktopResult<Array<{
      providerInstanceId: string;
      providerType: string;
      displayName: string;
      baseUrl: string | null;
      credentialId: string | null;
      enabled: boolean;
    }>>>;
    upsertProvider(input: {
      providerInstanceId?: string;
      providerType: string;
      displayName: string;
      baseUrl?: string | null;
      credentialId?: string | null;
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
    }): Promise<DesktopResult<{ items: unknown[]; events?: unknown[] } & Partial<DesktopBranchHistory>>>;
  };
  checkpoint: {
    list(input:{campaignId:string}): Promise<DesktopResult<Array<{checkpointId:string;branchId:string;stateVersion:number;eventSequence:number;label:string;createdAt:string;purpose:string|null;passed:boolean|null;stateHash:string;recap:string}>>>;
    create(input:{campaignId:string;branchId:string;label:string;purpose?:string;steps?:string[];expected?:unknown;actual?:unknown;passed?:boolean}): Promise<DesktopResult<unknown>>;
    restoreCopy(input:{campaignId:string;checkpointId:string;label:string}): Promise<DesktopResult<{branchId:string;stateVersion:number}>>;
    recreateInvestigator(input:{campaignId:string;checkpointId:string;label:string}): Promise<DesktopResult<{branchId:string;stateVersion:number}>>;
  };
  backup: {
    exportCampaign(input:{campaignId:string}): Promise<DesktopResult<DesktopCampaignBackup>>;
    importCampaign(input:{backup:DesktopCampaignBackup}): Promise<DesktopResult<DesktopCampaign>>;
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
  return api ? withoutLegacyInvestigatorEdit(api) : undefined;
}

export function withoutLegacyInvestigatorEdit(api: DesktopApi): DesktopApi {
  const campaign = { ...api.campaign } as Record<string, unknown>;
  delete campaign.applyCharacterCard;
  return { ...api, campaign: campaign as unknown as DesktopApi["campaign"] };
}
