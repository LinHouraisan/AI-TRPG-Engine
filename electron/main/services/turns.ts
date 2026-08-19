import { DEFAULT_CONTEXT_BUDGET_CHARS, type KeeperConfig } from "../../../demo/src/keeper/config";
import { keeperNarrate } from "../../../demo/src/keeper/keeper";
import { playTurn } from "../../../demo/src/engine/play-turn";
import { initialState } from "../../../demo/src/engine/state";
import { replay } from "../../../demo/src/engine/runtime";
import type { GameEvent, GameState, Intent } from "../../../demo/src/engine/types";
import type {
  NarrationKind,
  OperationEvent,
  OperationView,
  SubmitActionInput,
  TurnView as SharedTurnView,
} from "../../shared/api";
import { asOperationId, asTurnId, uuidv7, type CampaignId } from "../../shared/ids";
import { fail, ok, type Result } from "../../shared/result";
import type { Clock } from "../clock";
import { getCatalog, getSetting } from "../persist/catalog";
import type { Driver } from "../persist/driver";
import {
  appendCommitted,
  findTurnByCommand,
  getOperation,
  listTimeline,
  loadGameEvents,
} from "../persist/turns";
import type { CampaignService } from "./campaigns";

export type TurnView = SharedTurnView & { events: GameEvent[] };

const DELTA_FLUSH_MS = 40;
const DELTA_FLUSH_CHARS = 256;

export class TurnService {
  private readonly listeners = new Map<string, Map<string, (event: OperationEvent) => void>>();
  private readonly buffers = new Map<string, OperationEvent[]>();
  private readonly finishing = new Map<string, Promise<void>>();

  constructor(
    private readonly campaigns: CampaignService,
    private readonly clock: Clock,
  ) {}

  subscribe(operationId: string, listener: (event: OperationEvent) => void): string {
    const subscriptionId = uuidv7();
    let set = this.listeners.get(operationId);
    if (!set) {
      set = new Map();
      this.listeners.set(operationId, set);
    }
    set.set(subscriptionId, listener);
    for (const event of this.buffers.get(operationId) ?? []) {
      listener(event);
    }
    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): void {
    for (const [operationId, set] of this.listeners) {
      if (set.delete(subscriptionId)) {
        if (set.size === 0) this.listeners.delete(operationId);
        return;
      }
    }
  }

  waitForNarration(operationId: string): Promise<void> {
    return this.finishing.get(operationId) ?? Promise.resolve();
  }

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
        : `turn-ask-${operationId}`;

    const view: TurnView = {
      kind: outcome.kind,
      narration: outcome.kind === "committed" ? outcome.narration : outcome.text,
      narrationKind: outcome.kind === "committed" ? "模板" : "程序",
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

    const task = this.finishNarration({
      db,
      campaignId: input.campaignId,
      branchId: input.branchId,
      operationId,
      turnId,
      spoken: text,
      view,
      stateAfter: outcome.kind === "committed" ? outcome.state : state,
    }).catch(() => undefined);
    this.finishing.set(operationId, task);
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

  private emit(operationId: string, event: OperationEvent): void {
    const buffer = this.buffers.get(operationId) ?? [];
    buffer.push(event);
    this.buffers.set(operationId, buffer);
    const set = this.listeners.get(operationId);
    if (!set) return;
    for (const listener of set.values()) listener(event);
  }

  private keeperConfig(): KeeperConfig {
    const settings = this.campaigns.settings;
    const enabled = getSetting(settings, "keeper.enabled");
    const model = getSetting(settings, "keeper.model");
    const baseUrl = getSetting(settings, "keeper.baseUrl");
    return {
      enabled: enabled === true,
      baseUrl:
        typeof baseUrl === "string" && baseUrl.length > 0
          ? baseUrl
          : (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434"),
      model:
        typeof model === "string" && model.length > 0
          ? model
          : (process.env.KEEPER_MODEL ?? "qwen3.8:latest"),
      timeoutMs: 60_000,
      temperature: 0.7,
      contextBudgetChars: DEFAULT_CONTEXT_BUDGET_CHARS,
      stream: true,
    };
  }

  private operationView(
    operationId: string,
    status: OperationView["status"],
    phase: string,
  ): OperationView {
    const now = this.clock.nowIso();
    return {
      operationId: asOperationId(operationId),
      type: "turn.submitAction",
      status,
      progress: { phase },
      createdAt: now,
      updatedAt: now,
    };
  }

  private async finishNarration(params: {
    db: Driver;
    campaignId: string;
    branchId: string;
    operationId: string;
    turnId: string;
    spoken: string;
    view: TurnView;
    stateAfter: GameState;
  }): Promise<void> {
    const { db, operationId, turnId, view } = params;
    this.emit(operationId, {
      type: "operation.status",
      operation: this.operationView(operationId, "running", "narrating"),
    });
    if (view.kind === "committed") {
      this.emit(operationId, {
        type: "campaign.changed",
        campaignId: params.campaignId,
        branchId: params.branchId,
        stateVersion: view.stateVersion,
      });
    }

    if (view.kind !== "committed") {
      this.emit(operationId, {
        type: "operation.status",
        operation: this.operationView(operationId, "succeeded", view.kind),
      });
      return;
    }

    const fallback = view.narration;
    const config = this.keeperConfig();
    const batcher = new DeltaBatcher((sequence, text) => {
      this.emit(operationId, {
        type: "narration.delta",
        operationId: asOperationId(operationId),
        turnId: asTurnId(turnId),
        sequence,
        text,
      });
    });

    let narrationKind: NarrationKind = "模板";
    let text = fallback;
    let note: string | undefined;
    if (view.events.length > 0) {
      try {
        const result = await keeperNarrate({
          config,
          state: params.stateAfter,
          events: view.events,
          intent: view.intent as Intent,
          spoken: params.spoken,
          fallback,
          onStream: (event) => {
            if (event.kind === "draft") batcher.accept(event.draft);
          },
        });
        text = result.text;
        narrationKind = result.source;
        note = result.note;
      } catch (error) {
        text = fallback;
        narrationKind = "模板";
        note = error instanceof Error ? error.message : String(error);
      }
    }

    batcher.complete(text);
    const narrationId = uuidv7();
    const now = this.clock.nowIso();
    const finalView: TurnView = {
      ...view,
      narration: text,
      narrationKind,
      narrationNote: note,
    };
    persistFinalNarration({
      db,
      narrationId,
      branchId: params.branchId,
      turnId,
      stateVersion: view.stateVersion,
      modelTaskId: narrationKind === "模型" ? config.model : "template",
      promptVersion: narrationKind === "模型" ? "keeper-w0" : "template-w0",
      text,
      now,
      operationId,
      result: finalView,
    });
    this.emit(operationId, {
      type: "narration.completed",
      operationId: asOperationId(operationId),
      turnId: asTurnId(turnId),
      narrationId,
    });
    this.emit(operationId, {
      type: "operation.status",
      operation: this.operationView(operationId, "succeeded", "completed"),
    });
  }
}

function persistFinalNarration(params: {
  db: Driver;
  narrationId: string;
  branchId: string;
  turnId: string;
  stateVersion: number;
  modelTaskId: string;
  promptVersion: string;
  text: string;
  now: string;
  operationId: string;
  result: TurnView;
}): void {
  params.db.transaction(() => {
    params.db.run(
      `INSERT INTO narrations (
        narration_id, branch_id, turn_id, based_on_state_version,
        model_task_id, prompt_version, text, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'final', ?)`,
      [
        params.narrationId,
        params.branchId,
        params.turnId,
        params.stateVersion,
        params.modelTaskId,
        params.promptVersion,
        params.text,
        params.now,
      ],
    );
    params.db.run(
      `UPDATE operations
       SET result_json = ?, progress_json = ?, status = 'succeeded',
           updated_at = ?, completed_at = ?
       WHERE operation_id = ?`,
      [
        JSON.stringify(params.result),
        JSON.stringify({ phase: "completed" }),
        params.now,
        params.now,
        params.operationId,
      ],
    );
  });
}

/** 文本 delta：30–50ms 或 256 字，先到先发。sequence 从 0 计。 */
class DeltaBatcher {
  private pending = "";
  private flushed = 0;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly send: (sequence: number, text: string) => void) {}

  accept(draft: string): void {
    if (draft.length <= this.flushed) return;
    this.pending += draft.slice(this.flushed);
    this.flushed = draft.length;
    if (this.pending.length >= DELTA_FLUSH_CHARS) this.flush();
    else this.schedule();
  }

  complete(finalText: string): void {
    if (finalText.length > this.flushed) {
      this.pending += finalText.slice(this.flushed);
      this.flushed = finalText.length;
    }
    this.flush();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), DELTA_FLUSH_MS);
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return;
    this.send(this.sequence, this.pending);
    this.sequence += 1;
    this.pending = "";
  }
}
