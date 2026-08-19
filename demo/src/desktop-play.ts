import type { GameEvent } from "@/engine/types";
import { desktopApi, type DesktopApi, type DesktopCampaign } from "@/desktop";

export type RemoteTurnView = {
  kind: "query" | "clarification" | "committed";
  narration: string;
  events: GameEvent[];
  stateVersion: number;
  check?: unknown;
  intent: unknown;
};

export async function ensureDesktopCampaign(
  api: DesktopApi,
): Promise<{ campaign: DesktopCampaign; branchId: string } | null> {
  const listed = await api.campaign.list({ limit: 1 });
  if (!listed.ok) return null;
  const existing = listed.value.items[0];
  const created = existing
    ? { ok: true as const, value: existing }
    : await api.campaign.create({ name: "寄宿公寓试玩" });
  if (!created.ok) return null;
  const opened = await api.campaign.open({ campaignId: created.value.campaignId });
  if (!opened.ok) return null;
  return { campaign: opened.value, branchId: opened.value.headBranchId };
}

export async function loadDesktopEvents(
  api: DesktopApi,
  campaignId: string,
  branchId: string,
): Promise<GameEvent[]> {
  const page = await api.timeline.page({
    campaignId,
    branchId,
    page: { limit: 10_000 },
  });
  if (!page.ok) return [];
  const extra = page.value as { events?: GameEvent[] };
  return extra.events ?? [];
}

export async function submitDesktopTurn(params: {
  api: DesktopApi;
  campaignId: string;
  branchId: string;
  expectedStateVersion: number;
  text: string;
}): Promise<RemoteTurnView | { error: string }> {
  const commandId = crypto.randomUUID();
  const submitted = await params.api.turn.submitAction({
    campaignId: params.campaignId,
    branchId: params.branchId,
    actorId: "pc.linwan",
    controllerId: "player",
    expectedStateVersion: params.expectedStateVersion,
    commandId,
    text: params.text,
  });
  if (!submitted.ok) return { error: submitted.error.messageKey };
  const op = await params.api.operation.get({
    operationId: submitted.value.operationId,
    campaignId: params.campaignId,
  });
  if (!op.ok) return { error: op.error.messageKey };
  return op.value as RemoteTurnView;
}

export function tryDesktopApi(): DesktopApi | undefined {
  return desktopApi();
}
