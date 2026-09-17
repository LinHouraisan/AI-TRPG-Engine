import { keeperNarrate } from "@core/keeper/keeper";
import { createHash } from "node:crypto";
import type { DialogueTurn } from "@core/keeper/dialogue-context";
import type { InvestigatorProfile } from "@core/character/types";
import { checkCandidateForIntent, publishCheckCandidate } from "@core/engine/check-preview";
import { handleFreeTurn, newFreeTurnTaskId } from "@core/keeper/free-turn";
import { playTurn } from "@core/engine/play-turn";
import { recentFromTurn } from "@core/engine/recent";
import { commit, replay } from "@core/engine/runtime";
import { initialState } from "@core/engine/state";
import { route } from "@core/engine/router";
import { storyMonitor } from "@core/engine/story-monitor";
import type { CheckCandidate, GameEvent, GameState, Intent } from "@core/engine/types";
import { runAfterCommit } from "@core/ai/jobs";
import { emptyContextStore } from "@core/engine/context-store";
import { sheetDraft, type SheetApplyInput } from "@core/cards/apply";
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
import { recordModelUsage } from "../model-usage";
import { findAuditTraceByOperation } from "../persist/audit";
import { getCatalog } from "../persist/catalog";
import type { Driver } from "../persist/driver";
import {
  appendCommitted,
  findTurnByCommand,
  getOperation,
  listTimeline,
  loadBranchHistory,
  loadGameEvents,
  loadRecentDialogueTurns,
} from "../persist/turns";
import { loadMemory, saveFrontier, saveMemory } from "../persist/derived";
import type { CampaignService } from "./campaigns";
import { beginTurnAudit, type TurnAuditRecorder } from "./turn-audit";
import {
  hasInvestigatorPersistence,
  isReplayConsistentInvestigator,
  loadInvestigator,
} from "../persist/investigator";

export type TurnView = SharedTurnView & {
  events: GameEvent[];
  traceId?: string;
  turnId?: string;
  narrationId?: string;
};

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
  ): Promise<Result<{ operationId: string; turnId: string; traceId: string }>> {
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
    if (catalog.head_branch_id !== input.branchId) {
      return fail({
        code: "TURN_VERSION_CONFLICT",
        messageKey: "turn.branch_mismatch",
        retryable: true,
      });
    }
    const log = loadGameEvents(db, input.branchId);
    const state = replay(initialState(), log);
    let profile: InvestigatorProfile | null = null;
    if (hasInvestigatorPersistence(db)) {
      const bound = loadInvestigator(db, input.branchId);
      if (!bound) {
        return fail({
          code: "INVESTIGATOR_REQUIRED",
          messageKey: "investigator.required_before_play",
          retryable: false,
        });
      }
      if (!isReplayConsistentInvestigator(bound, state)) {
        return fail({
          code: "INVESTIGATOR_REPLAY_MISMATCH",
          messageKey: "investigator.replay_mismatch",
          retryable: false,
        });
      }
      profile = bound.profile;
    }
    const existing = findTurnByCommand(db, input.branchId, input.commandId);
    if (existing) {
      const traceId = findAuditTraceByOperation(db, existing.operationId);
      if (traceId) {
        return ok({ operationId: existing.operationId, turnId: existing.turnId, traceId });
      }
      const legacyAudit = beginTurnAudit({
        db,
        clock: this.clock,
        campaignId: input.campaignId,
        branchId: input.branchId,
        operationId: existing.operationId,
        baseStateVersion: existing.baseStateVersion,
      });
      legacyAudit.bindTurn({
        turnId: existing.turnId,
        committedStateVersion: existing.committedStateVersion,
      });
      legacyAudit.append({
        kind: "program",
        stage: "legacy.idempotent",
        taskType: "turn.submitAction",
        attempt: 1,
        causal: false,
        basedOnStateVersion: existing.baseStateVersion,
        input: { commandId: input.commandId },
        status: "skipped",
        output: { reason: "turn_predates_audit" },
      });
      legacyAudit.finalize("not_applicable");
      return ok({
        operationId: existing.operationId,
        turnId: existing.turnId,
        traceId: legacyAudit.traceId,
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

    const operationId = uuidv7();
    const audit = beginTurnAudit({
      db,
      clock: this.clock,
      campaignId: input.campaignId,
      branchId: input.branchId,
      operationId,
      baseStateVersion: state.version,
    });
    audit.append({
      kind: "program",
      stage: "turn.received",
      taskType: "turn.submitAction",
      attempt: 1,
      causal: true,
      basedOnStateVersion: state.version,
      input: {
        commandId: input.commandId,
        actorId: input.actorId,
        controllerId: input.controllerId,
        text,
        expectedStateVersion: Number(input.expectedStateVersion),
      },
      status: "succeeded",
      output: { accepted: true },
    });

    const recentTurns = loadRecentDialogueTurns(db, input.branchId);
    let intent = route(text, state);
    audit.append({
      kind: "program",
      stage: "route.deterministic",
      taskType: "gm.route",
      attempt: 1,
      causal: true,
      basedOnStateVersion: state.version,
      promptVersion: "router-v1",
      input: { text },
      status: "succeeded",
      output: { intent },
    });
    let freeTurnTaskId: string | undefined;
    if (intent.kind === "unclear") {
      freeTurnTaskId = newFreeTurnTaskId();
      const configured = withKeeperConfig(this.campaigns.settings, this.credentials, (config) =>
        handleFreeTurn({
          config,
          state,
          profile,
          spoken: text,
          recentTurns,
          modelTaskId: freeTurnTaskId!,
          currentStateVersion: () => getCatalog(this.campaigns.settings, input.campaignId)?.head_state_version ?? -1,
          audit,
        }),
      );
      if (configured.ok) {
        try {
          const routed = await configured.value;
          intent = routed.intent;
          audit.append({
            parentSpanId: routed.sourceSpanId,
            kind: "guard",
            stage: "route.validate",
            taskType: "gm.handle_free_turn",
            attempt: 1,
            causal: true,
            modelTaskId: freeTurnTaskId,
            basedOnStateVersion: state.version,
            promptVersion: "route-validate-v1",
            input: { deterministicIntent: { kind: "unclear", text } },
            status: routed.auditCode ? "rejected" : "succeeded",
            errorCode: routed.auditCode,
            output: {
              finalIntent: routed.intent,
              source: routed.source,
              sourceSpanId: routed.sourceSpanId ?? null,
              uncertain: routed.auditCode === "ROUTE_UNCERTAIN",
            },
          });
        } catch {
          audit.append({
            kind: "guard",
            stage: "route.validate",
            taskType: "gm.handle_free_turn",
            attempt: 1,
            causal: true,
            modelTaskId: freeTurnTaskId,
            basedOnStateVersion: state.version,
            promptVersion: "route-validate-v1",
            input: { deterministicIntent: { kind: "unclear", text } },
            status: "failed",
            errorCode: "PROVIDER_FAILURE",
            output: { finalIntent: intent },
          });
          // Keep unclear: playTurn will ask a clarification without committing.
        }
      } else {
        audit.append({
          kind: "guard",
          stage: "route.validate",
          taskType: "gm.handle_free_turn",
          attempt: 1,
          causal: true,
          modelTaskId: freeTurnTaskId,
          basedOnStateVersion: state.version,
          promptVersion: "route-validate-v1",
          input: { deterministicIntent: { kind: "unclear", text } },
          status: "failed",
          errorCode: "PROVIDER_FAILURE",
          output: { finalIntent: intent },
        });
      }
    }
    const candidate = checkCandidateForIntent({ intent, state, profile });
    if (candidate && hooks.onCandidate) {
      await publishCheckCandidate({
        candidate,
        onCandidate: (check) => hooks.onCandidate?.({ commandId: input.commandId, intent, check }),
      });
    }
    const authoritativeCatalog = getCatalog(this.campaigns.settings, input.campaignId);
    const authoritativeBranch = db.get<{ head_state_version: number }>(
      "SELECT head_state_version FROM branches WHERE branch_id = ?",
      [input.branchId],
    );
    const authoritativeLog = loadGameEvents(db, input.branchId);
    const authoritativeState = replay(initialState(), authoritativeLog);
    const expectedStateVersion = Number(input.expectedStateVersion);
    const intentStateVersion = intent.kind === "investigation" ? intent.stateVersion : expectedStateVersion;
    if (
      !authoritativeCatalog ||
      authoritativeCatalog.head_branch_id !== input.branchId ||
      authoritativeCatalog.head_state_version !== expectedStateVersion ||
      authoritativeBranch?.head_state_version !== expectedStateVersion ||
      authoritativeState.version !== expectedStateVersion ||
      intentStateVersion !== expectedStateVersion
    ) {
      audit.append({
        kind: "guard",
        stage: "route.validate",
        taskType: "turn.submitAction",
        attempt: 1,
        causal: true,
        basedOnStateVersion: authoritativeState.version,
        input: { intent, expectedStateVersion },
        status: "rejected",
        errorCode: "STALE_STATE",
        output: {
          catalog: authoritativeCatalog?.head_state_version ?? -1,
          branch: authoritativeBranch?.head_state_version ?? -1,
          replayed: authoritativeState.version,
          intent: intentStateVersion,
        },
      });
      audit.finalize("aborted");
      return fail({
        code: "TURN_VERSION_CONFLICT",
        messageKey: "turn.version_conflict",
        retryable: true,
        details: {
          expected: expectedStateVersion,
          catalog: authoritativeCatalog?.head_state_version ?? -1,
          branch: authoritativeBranch?.head_state_version ?? -1,
          replayed: authoritativeState.version,
          intent: intentStateVersion,
        },
      });
    }
    const outcome = playTurn({
      text,
      state: authoritativeState,
      log: authoritativeLog,
      intent,
      profile,
      turnId: `${input.branchId}:turn-${authoritativeState.turn + 1}`,
    });
    audit.append({
      kind: "program",
      stage: "rule.resolve",
      taskType: "turn.resolve",
      attempt: 1,
      causal: true,
      basedOnStateVersion: authoritativeState.version,
      input: { text, intent },
      status: "succeeded",
      output: {
        outcomeKind: outcome.kind,
        check: outcome.kind === "committed" ? outcome.check ?? null : null,
        events: outcome.kind === "committed" ? outcome.committed : [],
      },
    });
    const now = this.clock.nowIso();
    const turnId =
      outcome.kind === "committed" && outcome.committed[0]
        ? outcome.committed[0].turnId
        : `turn-ask-${operationId}`;

    const view: TurnView = {
      kind: outcome.kind,
      narration: outcome.kind === "committed" ? outcome.narration : outcome.text,
      narrationKind: outcome.kind === "committed" ? "模板" : "程序",
      events: outcome.kind === "committed" ? outcome.committed : [],
      stateVersion: outcome.kind === "committed" ? outcome.state.version : authoritativeState.version,
      check: outcome.kind === "committed" ? outcome.check : undefined,
      intent: outcome.intent,
      traceId: audit.traceId,
      turnId,
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
      baseVersion: authoritativeState.version,
      committedVersion: outcome.kind === "committed" ? outcome.state.version : authoritativeState.version,
      events: view.events,
      check: outcome.kind === "committed" ? outcome.check : undefined,
      result: view,
    });
    audit.bindTurn({ turnId, committedStateVersion: view.stateVersion });
    audit.append({
      kind: "persistence",
      stage: "state.commit",
      taskType: "turn.submitAction",
      attempt: 1,
      causal: true,
      basedOnStateVersion: authoritativeState.version,
      input: {
        turnId,
        operationId,
        baseStateVersion: authoritativeState.version,
        eventIds: outcome.kind === "committed" ? outcome.committed.map((event) => event.id) : [],
      },
      status: "succeeded",
      output: {
        beforeVersion: authoritativeState.version,
        afterVersion: view.stateVersion,
      },
    });
    this.campaigns.setHead(input.campaignId, view.stateVersion);
    if (outcome.kind === "committed") {
      this.persistDerived(db, input.branchId, {
        taskId: turnId,
        state: outcome.state,
        committed: outcome.committed,
        recent: outcome.recent,
        story: outcome.story,
      }, audit);
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
      recentTurns,
      profile,
      audit,
    }).catch(() => {
      audit.gap("NARRATION_FINALIZE_FAILED");
      audit.finalize("partial");
    });
    this.finishing.set(operationId, task);
    return ok({ operationId, turnId, traceId: audit.traceId });
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
    const branch = opened.value.get<{ head_state_version: number; head_sequence: number }>(
      "SELECT head_state_version, head_sequence FROM branches WHERE branch_id = ?",
      [branchId],
    );
    const upperBound = branch
      ? { stateVersion: branch.head_state_version, eventSequence: branch.head_sequence }
      : undefined;
    const events = loadGameEvents(opened.value, branchId, upperBound?.eventSequence);
    const items = listTimeline(opened.value, branchId, limit, upperBound?.eventSequence).map((row) => {
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
    audit?: TurnAuditRecorder,
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
    const common = {
      kind: "program" as const,
      attempt: 1,
      causal: false,
      basedOnStateVersion: params.state.version,
      input: { taskId: params.taskId },
      status: "succeeded" as const,
    };
    audit?.append({
      ...common,
      stage: "derived.information",
      taskType: "information.after_commit",
      output: jobs.information,
    });
    audit?.append({
      ...common,
      stage: "derived.director",
      taskType: "director.after_commit",
      output: jobs.director,
    });
    audit?.append({
      ...common,
      stage: "derived.memory",
      taskType: "memory.after_commit",
      output: { memory: jobs.memory },
    });
    audit?.append({
      ...common,
      stage: "derived.context",
      taskType: "context.after_commit",
      output: { context: jobs.context },
    });
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
    recentTurns: DialogueTurn[];
    profile: InvestigatorProfile | null;
    audit: TurnAuditRecorder;
  }): Promise<void> {
    const { audit, db, operationId, turnId, view } = params;
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
      const narrationId = uuidv7();
      const finalView: TurnView = { ...view, narrationId };
      persistFinalNarration({
        db,
        narrationId,
        branchId: params.branchId,
        turnId,
        stateVersion: view.stateVersion,
        modelTaskId: "program",
        promptVersion: "program-w0",
        text: view.narration,
        now: this.clock.nowIso(),
        operationId,
        result: finalView,
      });
      audit.linkFinalNarration({ narrationId });
      audit.append({
        kind: "program",
        stage: "narration.select",
        taskType: "gm.narrate_result",
        attempt: 1,
        causal: true,
        basedOnStateVersion: view.stateVersion,
        promptVersion: "program-w0",
        input: { outcomeKind: view.kind },
        status: "succeeded",
        output: {
          source: "程序",
          sourceSpanId: null,
          narrationId,
          finalTextSha256: sha256(view.narration),
        },
      });
      audit.finalize();
      this.emit(operationId, {
        type: "narration.completed",
        operationId: asOperationId(operationId),
        turnId: asTurnId(turnId),
        narrationId,
      });
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
    const modelTaskId = params.modelTaskId ?? newFreeTurnTaskId();
    let selectionRecorded = false;
    let sourceSpanId: string | undefined;
    if (
      view.events.length > 0 ||
      (view.intent as Intent).kind === "free_action" ||
      (view.intent as Intent).kind === "talk"
    ) {
      const configured = withKeeperConfig(this.campaigns.settings, this.credentials, async (config) => ({
        result: await keeperNarrate({
          config,
          state: params.stateAfter,
          events: view.events,
          intent: view.intent as Intent,
          spoken: params.spoken,
          recentTurns: params.recentTurns,
          profile: params.profile,
          fallback,
          audit: {
            sink: audit,
            modelTaskId: params.modelTaskId ?? modelTaskId,
          },
          onCall: (usage) => {
            const createdAt = this.clock.nowIso();
            recordModelUsage(
              this.campaigns.settings,
              {
                taskType: "gm.narrate_result",
                model: config.model,
                ...usage,
                estimatedMicros: 0,
                createdAt,
              },
              createdAt,
            );
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
          sourceSpanId = completed.result.sourceSpanId;
          selectionRecorded = true;
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
      narrationId,
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
    audit.linkFinalNarration({ narrationId, sourceSpanId });
    if (!selectionRecorded) {
      audit.append({
        kind: "program",
        stage: "narration.select",
        taskType: "gm.narrate_result",
        attempt: 1,
        causal: true,
        modelTaskId,
        basedOnStateVersion: view.stateVersion,
        promptVersion: "template-w0",
        input: { fallback, note: note ?? null },
        status: "succeeded",
        output: {
          source: narrationKind,
          sourceSpanId: sourceSpanId ?? null,
          narrationId,
          finalTextSha256: sha256(text),
        },
      });
    }
    audit.append({
      kind: "persistence",
      stage: "narration.persist",
      taskType: "gm.narrate_result",
      attempt: 1,
      causal: true,
      modelTaskId,
      basedOnStateVersion: view.stateVersion,
      input: { narrationId, source: narrationKind },
      status: "succeeded",
      output: {
        narrationId,
        source: narrationKind,
        sourceSpanId: sourceSpanId ?? null,
        finalTextSha256: sha256(text),
      },
    });
    audit.finalize();
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
