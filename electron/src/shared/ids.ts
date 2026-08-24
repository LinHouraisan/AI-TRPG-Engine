declare const brand: unique symbol;
export type Brand<T, TName extends string> = T & { readonly [brand]: TName };

export type CampaignId = Brand<string, "CampaignId">;
export type BranchId = Brand<string, "BranchId">;
export type TurnId = Brand<string, "TurnId">;
export type EventId = Brand<string, "EventId">;
export type EntityId = Brand<string, "EntityId">;
export type DecisionId = Brand<string, "DecisionId">;
export type OperationId = Brand<string, "OperationId">;
export type ContentId = Brand<string, "ContentId">;
export type StateVersion = Brand<number, "StateVersion">;

export function asCampaignId(value: string): CampaignId {
  return value as CampaignId;
}
export function asBranchId(value: string): BranchId {
  return value as BranchId;
}
export function asOperationId(value: string): OperationId {
  return value as OperationId;
}
export function asTurnId(value: string): TurnId {
  return value as TurnId;
}
export function asStateVersion(value: number): StateVersion {
  return value as StateVersion;
}

/** UUID v7：48 位毫秒时间戳 + 随机，小写带连字符。 */
export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const ms = Date.now();
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
