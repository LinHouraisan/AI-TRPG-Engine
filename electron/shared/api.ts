import type { BranchId, CampaignId, EntityId, OperationId, StateVersion, TurnId } from "./ids";
import type { Result } from "./result";

export interface ApiVersion {
  major: 1;
  minor: number;
}

export interface PageRequest {
  cursor?: string;
  limit: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CampaignSummary {
  campaignId: CampaignId;
  name: string;
  health: "unknown" | "healthy" | "recovery_required" | "read_only";
  headBranchId: BranchId;
  headStateVersion: StateVersion;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface CampaignView extends CampaignSummary {
  activeScene: { sceneId: EntityId; name: string } | null;
  playerCharacters: Array<{ entityId: EntityId; name: string }>;
  contentBindings: Array<{ contentId: string; type: string; version: string; hash: string }>;
}

export interface CreateCampaignInput {
  name: string;
}

export interface SubmitActionInput {
  campaignId: CampaignId;
  branchId: BranchId;
  actorId: EntityId;
  controllerId: string;
  expectedStateVersion: StateVersion;
  commandId: string;
  text: string;
}

export interface OperationAccepted {
  operationId: OperationId;
  turnId?: TurnId;
}

export type NarrationKind = "模型" | "模板" | "程序";

export interface TurnView {
  kind: "query" | "clarification" | "committed";
  narration: string;
  narrationKind: NarrationKind;
  narrationNote?: string;
  events: unknown[];
  stateVersion: number;
  check?: unknown;
  intent: unknown;
}

export interface OperationView {
  operationId: OperationId | string;
  type: string;
  status: "queued" | "running" | "waiting_for_user" | "succeeded" | "failed" | "cancelled";
  progress: { phase: string; completed?: number; total?: number };
  createdAt: string;
  updatedAt: string;
}

export type OperationEvent =
  | { type: "operation.status"; operation: OperationView }
  | {
      type: "narration.delta";
      operationId: OperationId | string;
      turnId: TurnId | string;
      sequence: number;
      text: string;
    }
  | {
      type: "narration.completed";
      operationId: OperationId | string;
      turnId: TurnId | string;
      narrationId: string;
    }
  | {
      type: "campaign.changed";
      campaignId: CampaignId | string;
      branchId: BranchId | string;
      stateVersion: number;
    };

export const OPERATION_EVENT_CHANNEL = "operation:event";

const OPERATION_EVENT_TYPES = new Set([
  "operation.status",
  "narration.delta",
  "narration.completed",
  "campaign.changed",
]);

export function isOperationEvent(value: unknown): value is OperationEvent {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  return OPERATION_EVENT_TYPES.has((value as { type: string }).type);
}

export interface AppState {
  lifecycle:
    | "cold"
    | "initializing_platform"
    | "opening_settings"
    | "registering_ipc"
    | "creating_window"
    | "ready"
    | "shutting_down"
    | "stopped"
    | "startup_failed"
    | "recovery_required";
}

export interface AppApi {
  getVersion(): Promise<Result<ApiVersion>>;
  getState(): Promise<Result<AppState>>;
}

export interface CampaignApi {
  create(input: CreateCampaignInput): Promise<Result<CampaignSummary>>;
  list(input: PageRequest): Promise<Result<Page<CampaignSummary>>>;
  open(input: { campaignId: CampaignId }): Promise<Result<CampaignView>>;
  close(input: { campaignId: CampaignId }): Promise<Result<void>>;
  moveToTrash(input: { campaignId: CampaignId }): Promise<Result<void>>;
  restoreFromTrash(input: { campaignId: CampaignId }): Promise<Result<void>>;
  applyCharacterCard(input: ApplyCharacterCardInput): Promise<
    Result<{ operationId: string; turnId: string; stateVersion: number }>
  >;
}

export interface SettingsApi {
  get(input: { key: string }): Promise<Result<unknown>>;
  set(input: { key: string; value: unknown }): Promise<Result<void>>;
  setSecret(input: { credentialId?: string; value: string }): Promise<Result<{ credentialId: string }>>;
  hasSecret(input: { credentialId: string }): Promise<Result<{ present: boolean }>>;
  deleteSecret(input: { credentialId: string }): Promise<Result<void>>;
  listProviders(): Promise<Result<ProviderInstanceView[]>>;
  upsertProvider(input: UpsertProviderInput): Promise<Result<ProviderInstanceView>>;
  deleteProvider(input: { providerInstanceId: string }): Promise<Result<void>>;
  listProfiles(): Promise<Result<ModelProfileView[]>>;
  upsertProfile(input: UpsertProfileInput): Promise<Result<ModelProfileView>>;
  listTaskRoutes(): Promise<Result<TaskRouteView[]>>;
  setTaskRoute(input: SetTaskRouteInput): Promise<Result<TaskRouteView>>;
}

export interface ProviderInstanceView {
  providerInstanceId: string;
  providerType: string;
  displayName: string;
  baseUrl: string | null;
  credentialId: string | null;
  enabled: boolean;
}

export interface ModelProfileView {
  modelProfileId: string;
  providerInstanceId: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
}

export interface TaskRouteView {
  taskType: string;
  primaryModelProfileId: string;
  fallbackModelProfileId: string | null;
}

export interface UpsertProviderInput {
  providerInstanceId?: string;
  providerType: string;
  displayName: string;
  baseUrl?: string | null;
  credentialId?: string | null;
  enabled: boolean;
}

export interface UpsertProfileInput {
  modelProfileId?: string;
  providerInstanceId: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
}

export interface SetTaskRouteInput {
  taskType: string;
  primaryModelProfileId: string;
  fallbackModelProfileId?: string | null;
}

export interface ApplyCharacterCardInput {
  campaignId: CampaignId;
  branchId: BranchId;
  expectedStateVersion: StateVersion;
  commandId: string;
  name: string;
  occupation: string;
  hp: number;
  hpMax: number;
  san: number;
  sanMax: number;
  skills: Record<string, number>;
  cardHash: string;
}

export interface DesktopApi {
  version: ApiVersion;
  app: AppApi;
  campaign: CampaignApi;
  settings: SettingsApi;
  turn: { submitAction(input: SubmitActionInput): Promise<Result<OperationAccepted>> };
  timeline: {
    page(input: {
      campaignId: CampaignId;
      branchId: BranchId;
      page: PageRequest;
    }): Promise<Result<Page<{ kind: string; turnId: string; summary: string; occurredAt: string }>>>;
  };
  content: { list(): Promise<Result<never>> };
  model: { list(): Promise<Result<never>> };
  backup: { exportCampaign(): Promise<Result<never>> };
  operation: {
    get(input: { operationId: OperationId; campaignId: CampaignId }): Promise<Result<TurnView>>;
    subscribe(input: { operationId: OperationId | string }): Promise<Result<{ subscriptionId: string }>>;
    unsubscribe(input: { subscriptionId: string }): Promise<Result<void>>;
    onEvent(cb: (event: OperationEvent) => void): () => void;
  };
}

export const API_VERSION: ApiVersion = { major: 1, minor: 0 };

export const CHANNELS = {
  "app:getVersion": true,
  "app:getState": true,
  "campaign:create": true,
  "campaign:list": true,
  "campaign:open": true,
  "campaign:close": true,
  "campaign:moveToTrash": true,
  "campaign:restoreFromTrash": true,
  "settings:get": true,
  "settings:set": true,
  "settings:setSecret": true,
  "settings:hasSecret": true,
  "settings:deleteSecret": true,
  "settings:listProviders": true,
  "settings:upsertProvider": true,
  "settings:deleteProvider": true,
  "settings:listProfiles": true,
  "settings:upsertProfile": true,
  "settings:listTaskRoutes": true,
  "settings:setTaskRoute": true,
  "turn:submitAction": true,
  "timeline:page": true,
  "operation:get": true,
  "operation:subscribe": true,
  "operation:unsubscribe": true,
  "campaign:applyCharacterCard": true,
} as const;

export type Channel = keyof typeof CHANNELS;
