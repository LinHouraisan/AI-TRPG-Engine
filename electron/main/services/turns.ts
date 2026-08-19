import { playTurn } from "../../../demo/src/engine/play-turn";
import { initialState } from "../../../demo/src/engine/state";
import { replay } from "../../../demo/src/engine/runtime";
import type { GameEvent } from "../../../demo/src/engine/types";
import type { SubmitActionInput } from "../../shared/api";
import { asOperationId, asTurnId, uuidv7, type CampaignId } from "../../shared/ids";
import { fail, ok, type Result } from "../../shared/result";
import type { Clock } from "../clock";
import { getCatalog } from "../persist/catalog";
import {
  appendCommitted,
  findTurnByCommand,
  getOperation,
  listTimeline,
  loadGameEvents,
} from "../persist/turns";
import type { CampaignService } from "./campaigns";

export type TurnView = {
  kind: "query" | "clarification" | "committed";
  narration: string;
  events: GameEvent[];
  stateVersion: number;
  check?: unknown;
  intent: unknown;
};

export class TurnService {
  constructor(
    private readonly campaigns: CampaignService,
    private readonly clock: Clock,
  ) {}

  submit(input: SubmitActionInput): Result<{ operationId: string; turnId: string }> {
    const text = input.text.trim();
    if (text.length < 1 || text.length > 20_000) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "turn.text_invalid",
        retryable: false,
      });
    }

    const opened = this.campaigns.ensureOpen(input.campaignId);
    if (!opened.ok) return opened;
    const db = opened.value;
    const catalog = getCatalog(this.campaigns.settings, input.campaignId);
    if (!catalog) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "campaign.not_found",
        retryable: false,
      });
    }
    const existing = findTurnByCommand(db, input.branchId, input.commandId);
    if (existing) {
      return ok({ operationId: existing.operationId, turnId: existing.turnId });
    }
    if (catalog.head_branch_id !== input.branchId) {
      return fail({
        code: "TURN_VERSION_CONFLICT",
        messageKey: "turn.branch_mismatch",
        retryable: true,
      });
    }
    if (catalog.head_state_version !== Number(input.expectedStateVersion)) {
      return fail({
        code: "TURN_VERSION_CONFLICT",
        messageKey: "turn.version_conflict",
        retryable: true,
        details: { expected: Number(input.expectedStateVersion), actual: catalog.head_state_version },
      });
    }

    const log = loadGameEvents(db, input.branchId);
    const state = replay(initialState(), log);
    const outcome = playTurn({ text, state, log });
    const now = this.clock.nowIso();
    const operationId = uuidv7();
    const turnId =
      outcome.kind === "committed" && outcome.committed[0]
        ? outcome.committed[0].turnId
        : `turn-${state.turn + 1}`;

    const view: TurnView = {
      kind: outcome.kind,
      narration: outcome.kind === "committed" ? outcome.narration : outcome.text,
      events: outcome.kind === "committed" ? outcome.committed : [],
      stateVersion: outcome.kind === "committed" ? outcome.state.version : state.version,
      check: outcome.kind === "committed" ? outcome.check : undefined,
      intent: outcome.intent,
    };

    const status =
      outcome.kind === "clarification"
        ? "needs_clarification"
        : outcome.kind === "query"
          ? "completed"
          : "completed";

    appendCommitted({
      db,
      campaignId: input.campaignId,
      branchId: input.branchId,
      turnId,
      operationId,
      commandId: input.commandId,
      actorId: input.actorId,
      controllerId: input.controllerId,
      text,
      now,
      status,
      baseVersion: state.version,
      committedVersion: outcome.kind === "committed" ? outcome.state.version : state.version,
      events: view.events,
      check: outcome.kind === "committed" ? outcome.check : undefined,
      result: view,
    });
    this.campaigns.setHead(input.campaignId, view.stateVersion);
    return ok({ operationId, turnId });
  }

  get(operationId: string, campaignId: CampaignId): Result<TurnView> {
    const opened = this.campaigns.ensureOpen(campaignId);
    if (!opened.ok) return opened;
    const row = getOperation(opened.value, operationId);
    if (!row?.result_json) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "operation.not_found",
        retryable: false,
      });
    }
    return ok(JSON.parse(row.result_json) as TurnView);
  }

  timeline(campaignId: CampaignId, branchId: string, limit: number) {
    const opened = this.campaigns.ensureOpen(campaignId);
    if (!opened.ok) return opened;
    const events = loadGameEvents(opened.value, branchId);
    const items = listTimeline(opened.value, branchId, limit).map((row) => {
      const event = JSON.parse(row.payload_json) as GameEvent;
      return {
        kind: "state_change" as const,
        turnId: asTurnId(row.turn_id),
        eventId: row.event_id,
        summary: event.summary,
        occurredAt: row.occurred_at,
      };
    });
    return ok({ items, events, nextCursor: null });
  }
}
