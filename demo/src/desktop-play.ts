import type { GameEvent } from "@/engine/types";
import {
  desktopApi,
  type DesktopApi,
  type DesktopCampaign,
  type DesktopTurnView,
} from "@/desktop";

export type RemoteTurnView = DesktopTurnView & { events: GameEvent[] };

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

function asTurnView(value: DesktopTurnView): RemoteTurnView {
  return { ...value, events: (value.events ?? []) as GameEvent[] };
}

/**
 * 提交之后订阅 delta。叙述在主进程，渲染进程只展示草稿和定稿。
 */
export async function submitDesktopTurn(params: {
  api: DesktopApi;
  campaignId: string;
  branchId: string;
  expectedStateVersion: number;
  text: string;
  onDraft?: (draft: string) => void;
}): Promise<RemoteTurnView | { error: string }> {
  const commandId = crypto.randomUUID();
  let acc = "";
  const seen = new Set<number>();
  let completed = false;
  let operationId = "";
  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const stop = params.api.operation.onEvent((event) => {
    if (operationId) {
      if (event.type === "narration.delta" && event.operationId !== operationId) return;
      if (event.type === "narration.completed" && event.operationId !== operationId) return;
    }
    if (event.type === "narration.delta") {
      if (seen.has(event.sequence)) return;
      seen.add(event.sequence);
      acc += event.text;
      params.onDraft?.(acc);
    }
    if (event.type === "narration.completed") {
      completed = true;
      resolveDone?.();
    }
  });

  try {
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
    operationId = submitted.value.operationId;
    const sub = await params.api.operation.subscribe({ operationId });
    const first = await params.api.operation.get({
      operationId,
      campaignId: params.campaignId,
    });
    if (!first.ok) {
      if (sub.ok) await params.api.operation.unsubscribe({ subscriptionId: sub.value.subscriptionId });
      return { error: first.error.messageKey };
    }
    const firstView = asTurnView(first.value);
    if (firstView.kind !== "committed") {
      if (sub.ok) await params.api.operation.unsubscribe({ subscriptionId: sub.value.subscriptionId });
      return firstView;
    }
    if (!completed) {
      await Promise.race([
        done,
        new Promise<void>((resolve) => {
          setTimeout(resolve, 120_000);
        }),
      ]);
    }
    const op = await params.api.operation.get({
      operationId,
      campaignId: params.campaignId,
    });
    if (sub.ok) await params.api.operation.unsubscribe({ subscriptionId: sub.value.subscriptionId });
    if (!op.ok) return { error: op.error.messageKey };
    return asTurnView(op.value);
  } finally {
    stop();
  }
}

export function tryDesktopApi(): DesktopApi | undefined {
  return desktopApi();
}
