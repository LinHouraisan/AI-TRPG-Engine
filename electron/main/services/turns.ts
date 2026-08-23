import { keeperNarrate } from "../../../demo/src/keeper/keeper";
import type { InvestigatorProfile } from "../../../demo/src/character/types";
import { checkCandidateForIntent, publishCheckCandidate } from "../../../demo/src/engine/check-preview";
import { handleFreeTurn, newFreeTurnTaskId } from "../../../demo/src/keeper/free-turn";
import { playTurn } from "../../../demo/src/engine/play-turn";
import { recentFromTurn } from "../../../demo/src/engine/recent";
import { commit, replay } from "../../../demo/src/engine/runtime";
import { initialState } from "../../../demo/src/engine/state";
import { route } from "../../../demo/src/engine/router";
import { storyMonitor } from "../../../demo/src/engine/story-monitor";
import type { CheckCandidate, GameEvent, GameState, Intent } from "../../../demo/src/engine/types";
import { runAfterCommit } from "../../../demo/src/ai/jobs";
import { emptyContextStore } from "../../../demo/src/engine/context-store";
import { sheetDraft, type SheetApplyInput } from "../../../demo/src/cards/apply";
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
import type { CredentialStore } from "../credentials";
import { withKeeperConfig } from "../model-config";
import { getCatalog } from "../persist/catalog";
import type { Driver } from "../persist/driver";
import {
  appendCommitted,
  findTurnByCommand,
  getOperation,
  listTimeline,
  loadBranchHistory,
  loadGameEvents,
} from "../persist/turns";
import { loadMemory, saveFrontier, saveMemory } from "../persist/derived";
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
    private readonly credentials: CredentialStore,
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

  async submit(
    input: SubmitActionInput,
    hooks: { onCandidate?: (candidate: { commandId: string; intent: Intent; check: CheckCandidate }) => void } = {},
  ): Promise<Result<{ operationId: string; turnId: string }>> {
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
    let profile: InvestigatorProfile | null = null;
    let intent = route(text, state);
    let freeTurnTaskId: string | undefined;
    if (intent.kind === "unclear") {
      const loadedProfile = this.campaigns.getInvestigator(input.campaignId);
      profile = loadedProfile.ok ? loadedProfile.value : null;
      freeTurnTaskId = newFreeTurnTaskId();
      const configured = withKeeperConfig(this.campaigns.settings, this.credentials, (config) =>
        handleFreeTurn({
          config,
          state,
          profile,
          spoken: text,
          modelTaskId: freeTurnTaskId!,
          currentStateVersion: () => getCatalog(this.campaigns.settings, input.campaignId)?.head_state_version ?? -1,
        }),
      );
      if (configured.ok) {
        try {
          intent = (await configured.value).intent;
        } catch {
          // Keep unclear: playTurn will ask a clarification without committing.
        }
      }
    }
    const candidate = checkCandidateForIntent({ intent, state, profile });
    if (candidate && hooks.onCandidate) {
      await publishCheckCandidate({
        candidate,
        onCandidate: (check) => hooks.onCandidate?.({ commandId: input.commandId, intent, check }),
      });
    }
    const outcome = playTurn({
      text,
      state,
      log,
      intent,
      profile,
      turnId: `${input.branchId}:turn-${state.turn + 1}`,
    });
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
    if (outcome.kind === "committed") {
      this.persistDerived(db, input.branchId, {
        taskId: turnId,
        state: outcome.state,
        committed: outcome.committed,
        recent: outcome.recent,
        story: outcome.story,
      });
    }

    const task = this.finishNarration({
      db,
      campaignId: input.campaignId,
      branchId: input.branchId,
      operationId,
      turnId,
      spoken: text,
      view,
      stateAfter: outcome.kind === "committed" ? outcome.state : state,
      modelTaskId: freeTurnTaskId,
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
    return ok({ items, events, ...loadBranchHistory(opened.value, branchId), nextCursor: null });
  }

  applyCharacterCard(input: {
    campaignId: CampaignId;
    branchId: string;
    expectedStateVersion: number;
    commandId: string;
    draft: SheetApplyInput;
  }): Result<{ operationId: string; turnId: string; stateVersion: number }> {
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
      return ok({
        operationId: existing.operationId,
        turnId: existing.turnId,
        stateVersion: existing.committedStateVersion ?? existing.baseStateVersion,
      });
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
      });
    }
    const log = loadGameEvents(db, input.branchId);
    const state = replay(initialState(), log);
    const before = state;
    const turnId = `${input.branchId}:turn-${state.turn + 1}`;
    const result = commit({
      state,
      log,
      drafts: [sheetDraft(input.draft)],
      turnId,
    });
    const now = this.clock.nowIso();
    const operationId = uuidv7();
    const view: TurnView = {
      kind: "committed",
      narration: `调查员换成「${input.draft.name}」（人设卡，已确认）。`,
      narrationKind: "程序",
      events: result.committed,
      stateVersion: result.state.version,
      intent: { kind: "unclear", text: "character_card" },
    };
    appendCommitted({
      db,
      campaignId: input.campaignId,
      branchId: input.branchId,
      turnId,
      operationId,
      commandId: input.commandId,
      actorId: "pc.linwan",
      controllerId: "player",
      text: `确认人设卡 ${input.draft.name}`,
      now,
      status: "completed",
      baseVersion: before.version,
      committedVersion: result.state.version,
      events: result.committed,
      result: view,
    });
    this.campaigns.setHead(input.campaignId, result.state.version);
    this.persistDerived(db, input.branchId, {
      taskId: turnId,
      state: result.state,
      committed: result.committed,
      recent: recentFromTurn({
        player: `确认人设卡 ${input.draft.name}`,
        gm: view.narration,
        committed: result.committed,
        stateVersion: result.state.version,
      }),
      story: storyMonitor({
        before,
        after: result.state,
        committed: result.committed,
        log: result.log,
      }),
    });
    return ok({ operationId, turnId, stateVersion: result.state.version });
  }

  private persistDerived(
    db: Driver,
    branchId: string,
    params: {
      taskId: string;
      state: GameState;
      committed: GameEvent[];
      recent: ReturnType<typeof recentFromTurn>;
      story: ReturnType<typeof storyMonitor>;
    },
  ): void {
    const jobs = runAfterCommit({
      taskId: params.taskId,
      branchId,
      state: params.state,
      committed: params.committed,
      recent: params.recent,
      story: params.story,
      memory: loadMemory(db, branchId),
      context: emptyContextStore(),
    });
    const now = this.clock.nowIso();
    saveMemory(db, branchId, jobs.memory, now);
    saveFrontier(db, branchId, jobs.director.frontier, now);
  }

  private emit(operationId: string, event: OperationEvent): void {
    const buffer = this.buffers.get(operationId) ?? [];
    buffer.push(event);
    this.buffers.set(operationId, buffer);
    const set = this.listeners.get(operationId);
    if (!set) return;
    for (const listener of set.values()) listener(event);
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
    modelTaskId?: string;
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
    let modelTaskId = params.modelTaskId ?? "template";
    if (view.events.length > 0 || (view.intent as Intent).kind === "free_action") {
      const configured = withKeeperConfig(this.campaigns.settings, this.credentials, async (config) => ({
        result: await keeperNarrate({
          config,
          state: params.stateAfter,
          events: view.events,
          intent: view.intent as Intent,
          spoken: params.spoken,
          fallback,
          onStream: (event) => {
            if (event.kind === "draft") batcher.accept(event.draft);
          },
        }),
        model: config.model,
      }));
      if (!configured.ok) {
        note = configured.error.messageKey;
      } else {
        try {
          const completed = await configured.value;
          text = completed.result.text;
          narrationKind = completed.result.source;
          note = completed.result.note;
          modelTaskId = narrationKind === "模型" ? (params.modelTaskId ?? completed.model) : "template";
        } catch (error) {
          note = error instanceof Error ? error.message : String(error);
        }
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
      modelTaskId,
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
