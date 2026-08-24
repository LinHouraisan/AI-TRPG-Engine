import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createFreshDesktopCampaign, ensureDesktopCampaign, loadDesktopBranch, loadDesktopCampaign, loadDesktopEvents, submitDesktopTurn, tryDesktopApi } from "@/desktop-play";
import { emptyMemory, runAfterCommit, runAfterCommitLive, traceFromJobs, type JobTrace, type MemoryState } from "@/ai";
import { validateAllocation } from "@/character/creation";
import type {
  InvestigatorAllocation,
  InvestigatorCreationRules,
  InvestigatorProfile,
} from "@/character/types";
import { recentFromTurn } from "@/engine/recent";
import { storyMonitor } from "@/engine/story-monitor";
import { emptyContextStore, type ContextStore } from "@/engine/context-store";
import { narrate, openingLine, suggest } from "@/engine/narrate";
import { pack } from "@/engine/pack";
import { checkCandidateForIntent, publishCheckCandidate } from "@/engine/check-preview";
import { playTurn } from "@/engine/play-turn";
import { route } from "@/engine/router";
import { replay, stateHash } from "@/engine/runtime";
import { initialState } from "@/engine/state";
import type { CheckCandidate, CheckResult, EventDraft, GameEvent, GameState, Intent } from "@/engine/types";
import { loadConfig, saveConfig, type KeeperConfig } from "@/keeper/config";
import type { ContextUsage } from "@/keeper/context";
import type { DialogueTurn } from "@/keeper/dialogue-context";
import { handleFreeTurn, narrateFreeTurn, newFreeTurnTaskId } from "@/keeper/free-turn";
import { keeperNarrate, type NarrationStreamEvent } from "@/keeper/keeper";
import { PersistedDialogueSource } from "@/keeper/persisted-dialogue";
import {
  openStore,
  type BranchInfo,
  type ExportPayload,
  type Store,
  type StoredMessage,
} from "@/store";
import { confirmationReducer, initialConfirmationState } from "@/ui/investigator-creation-state";
import type { DesktopCampaignBackup } from "@/desktop";

export type MessageKind = "play" | "notice";

export type Message = {
  id: string;
  role: "kp" | "pl" | "system";
  text: string;
  check?: CheckResult;
  stateVersion: number;
  /** 这句话是模型讲的、模板兜底的，还是程序自己回的 */
  source?: "模型" | "模板" | "程序";
  /** 退回模板或者叙述没过体检的原因，只给调试看 */
  note?: string;
  /** play 是团里说的话；notice 是程序刚才做了什么 */
  kind?: MessageKind;
  /** 本次打开的一次性说明。进 messages 可以，进库不行。 */
  transient?: boolean;
};

function isTransient(message: Pick<Message, "transient" | "kind">): boolean {
  return message.transient === true || message.kind === "notice";
}

function toStored(message: Message): StoredMessage | null {
  if (isTransient(message) || message.role === "system") return null;
  return {
    role: message.role,
    text: message.text,
    stateVersion: message.stateVersion,
    source: message.source,
    note: message.note,
    check: message.check,
    kind: "play",
  };
}

/**
 * 双保险。真正的防线在 Store：role === "system" 的读时滤掉、写时拒写。
 * 这里再挡一层，免得有人绕过仓储把行塞进界面。
 */
function isLegacyNotice(message: Pick<StoredMessage, "role" | "kind" | "text">): boolean {
  if (message.role === "system" || message.kind === "notice") return true;
  return LEGACY_NOTICE_SHAPES.some((shape) => shape.test(message.text));
}

const LEGACY_NOTICE_SHAPES = [
  /^已续上上一场：重放 \d+ 条事件，回到版本 v\d+，哈希 [0-9a-fA-F]+。$/,
  /^存档对不上账（重放算出 .+，检查点记的是 .+），这一场按新的开。$/,
  /^已回到版本 v\d+ 并另起一条分支；原来那条一个字都没动。$/,
  /^这一回合没能落盘：/,
];

function fromStored(message: StoredMessage, index: number): Message | null {
  if (isLegacyNotice(message)) return null;
  return { ...message, id: `m-${index}`, kind: message.kind ?? "play" };
}

/** 门槛可以公开；点数和成败在掷出之前绝不能出现。 */
export type PendingCheck = CheckCandidate;

export type PendingAction = {
  label: string;
  /** 路由之后才有。回滚、切分支没有意图。 */
  intent: Intent | null;
  check: PendingCheck | null;
};

export type ActiveCheckPreview =
  | { kind: "candidate"; check: PendingCheck }
  | { kind: "resolved"; check: CheckResult }
  | null;

export type ActiveCheckPreviewAction =
  | { type: "began"; check: PendingCheck | null }
  | { type: "resolved"; check: CheckResult }
  | { type: "cleared" };

export function activeCheckPreviewReducer(
  _state: ActiveCheckPreview,
  action: ActiveCheckPreviewAction,
): ActiveCheckPreview {
  if (action.type === "began") {
    return action.check ? { kind: "candidate", check: action.check } : null;
  }
  if (action.type === "resolved") return { kind: "resolved", check: action.check };
  return null;
}

export type TurnMark = {
  turnId: string;
  /** 这一回合最后一条事件的序号，回滚就回到这里 */
  seq: number;
  version: number;
  clock: number;
  summary: string;
  rolled: boolean;
  forked: boolean;
};

export function createOpening(state: GameState, profile: InvestigatorProfile | null): Message[] {
  if (!profile) return [];
  return [
    { id: "m0", role: "kp", text: openingLine(), stateVersion: state.version, source: "模板" },
    {
      id: "m1",
      role: "kp",
      text: narrate({ state, events: [], intent: { kind: "unclear", text: "" } }),
      stateVersion: state.version,
      source: "模板",
    },
  ];
}

export function createRestoredMessages(
  state: GameState,
  history: { recap: string; recentTurns: Array<{ turnId: string; stateVersion: number; player: string; gm: string }>; restoredFrom: string | null },
): Message[] {
  const messages: Message[] = [{ id: "restore-recap", role: "system", text: `前情提要：${history.recap}`, stateVersion: state.version, kind: "notice", transient: true }];
  for (const turn of history.recentTurns.slice(-3)) {
    messages.push(
      { id: `${turn.turnId}-pl`, role: "pl", text: turn.player, stateVersion: turn.stateVersion, kind: "play" },
      { id: `${turn.turnId}-kp`, role: "kp", text: turn.gm, stateVersion: turn.stateVersion, kind: "play" },
    );
  }
  if (history.restoredFrom) messages.push({ id: "restore-notice", role: "system", text: `已从「${history.restoredFrom}」创建恢复分支。原检查点仍然保留。`, stateVersion: state.version, kind: "notice", transient: true });
  return messages;
}

/** 上一回合的素材。重述用的是同一批已提交事件，因此绝不会重掷骰子。 */
type LastTurn = {
  state: GameState;
  events: GameEvent[];
  intent: Intent;
  spoken: string;
  fallback: string;
  modelTaskId?: string;
};

type Desk = {
  state: GameState;
  log: GameEvent[];
};

function investigatorFromState(state: GameState): InvestigatorProfile | null {
  const creation = pack.manifest.creation;
  if (
    !creation ||
    !state.pcCardHash ||
    !state.pcName ||
    !state.pcOccupation ||
    !state.characteristics ||
    !state.baseSkills ||
    !state.occupationPoints ||
    !state.interestPoints ||
    !state.lifeHistoryId
  ) {
    return null;
  }
  return {
    name: state.pcName,
    occupation: state.pcOccupation,
    characteristics: { ...state.characteristics },
    baseSkills: { ...state.baseSkills },
    occupationPoints: { ...state.occupationPoints },
    interestPoints: { ...state.interestPoints },
    skills: { ...state.skills },
    hp: state.hpMax,
    san: state.san,
    sanMax: state.sanMax,
    lifeHistoryId: state.lifeHistoryId,
    contentVersion: creation.contentVersion,
  };
}

export function recentDialogueTurns(messages: Message[]): DialogueTurn[] {
  const turns: DialogueTurn[] = [];
  let player: string | undefined;
  for (const message of messages) {
    if (isTransient(message) || message.role === "system") continue;
    if (message.role === "pl") {
      player = message.text;
      continue;
    }
    if (message.role === "kp" && player !== undefined) {
      turns.push({ player, gm: message.text });
      player = undefined;
    }
  }
  return turns.slice(-3);
}

export function projectInvestigatorConfirmation(params: {
  state: GameState;
  log: GameEvent[];
  allocation: InvestigatorAllocation;
  rules: InvestigatorCreationRules;
  itemLocations: Record<string, string>;
}): { profile: InvestigatorProfile; state: GameState; log: GameEvent[]; committed: GameEvent[] } | null {
  if (params.state.version !== 0 || params.log.length !== 0) return null;
  const validated = validateAllocation(params.rules, params.allocation);
  if (!validated.ok) return null;
  const history = params.rules.lifeHistories.find((candidate) => candidate.id === validated.profile.lifeHistoryId);
  if (!history) return null;
  const profile = validated.profile;
  const drafts: EventDraft[] = [
    {
      payload: {
        type: "sheet_applied",
        name: profile.name,
        occupation: profile.occupation,
        hp: profile.hp,
        hpMax: profile.hp,
        san: profile.san,
        sanMax: profile.sanMax,
        skills: profile.skills,
        cardHash: `browser:${profile.contentVersion}:${profile.name}`,
        characteristics: profile.characteristics,
        baseSkills: profile.baseSkills,
        occupationPoints: profile.occupationPoints,
        interestPoints: profile.interestPoints,
        lifeHistoryId: profile.lifeHistoryId,
      },
      summary: `确认调查员「${profile.name}」。`,
      cause: `history:${history.id}`,
    },
    history.initialGrant.kind === "fact"
      ? {
          payload: { type: "fact_known", fact: history.initialGrant.id },
          summary: `人生经历带来已知线索「${history.initialGrant.id}」。`,
          cause: `history:${history.id}`,
        }
      : {
          payload: {
            type: "item_moved",
            item: history.initialGrant.id,
            from: params.itemLocations[history.initialGrant.id] ?? "unknown",
            to: "inv.pc",
          },
          summary: `人生经历带来初始物品「${history.initialGrant.id}」。`,
          cause: `history:${history.id}`,
        },
    {
      payload: {
        type: "relationship_established",
        npc: history.relationship.npcId,
        text: history.relationship.text,
      },
      summary: history.relationship.text,
      cause: `history:${history.id}`,
    },
  ];
  const turnId = "browser-confirm-investigator";
  const committed: GameEvent[] = drafts.map((draft, index) => ({
    ...draft,
    id: `${turnId}-${index}`,
    seq: index,
    turnId,
    versionAfter: 1,
    clock: 0,
    visibility: draft.visibility ?? "public",
  }));
  return {
    profile,
    state: replay(params.state, committed),
    log: committed,
    committed,
  };
}

async function getDesktopInvestigator(
  api: NonNullable<ReturnType<typeof tryDesktopApi>>,
  campaignId: string,
): Promise<InvestigatorProfile | null> {
  const loaded = await api.campaign.getInvestigator({ campaignId });
  return loaded.ok ? loaded.value : null;
}

export function useSession() {
  const [presented, setPresented] = useState<Desk>(() => ({
    state: initialState(),
    log: [],
  }));
  // 权威桌面：裁定之后立刻改。界面读 presented，叙述落笔才追上。
  const authoritative = useRef<Desk>({
    state: presented.state,
    log: presented.log,
  });
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [investigatorProfile, setInvestigatorProfile] = useState<InvestigatorProfile | null>(null);
  const [confirmation, dispatchConfirmation] = useReducer(confirmationReducer, initialConfirmationState);
  const [activeCheckPreview, dispatchCheckPreview] = useReducer(activeCheckPreviewReducer, null);
  const [messages, setMessages] = useState<Message[]>(() => createOpening(initialState(), null));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [config, setConfigState] = useState<KeeperConfig>(() => loadConfig());
  const lastTurn = useRef<LastTurn | null>(null);
  // 草稿还没过体检；进 messages 就会被落盘。只挂在内存里，定稿到达再写记录。
  const [narrationDraft, setNarrationDraft] = useState<string | null>(null);
  // 上一回合主持人真正吃进去的那份。预估跟它都得来自 buildContext，折算会和引擎脱节。
  const [lastUsage, setLastUsage] = useState<ContextUsage | null>(null);
  const [lastTrace, setLastTrace] = useState<JobTrace | null>(null);
  const inflight = useRef(false);
  const memoryRef = useRef<MemoryState>(emptyMemory());
  const contextRef = useRef<ContextStore>(emptyContextStore());
  const liveInflight = useRef(false);
  const persistedDialogue = useRef(new PersistedDialogueSource());

  const reveal = useCallback(() => {
    const desk = authoritative.current;
    setPresented({ state: desk.state, log: desk.log });
  }, []);

  const adopt = useCallback((desk: Desk) => {
    authoritative.current = desk;
    setPresented(desk);
  }, []);

  const store = useRef<Store | null>(null);
  const origin = useRef<GameState>(initialState());
  const [ready, setReady] = useState(false);
  const [storeBackend, setStoreBackend] = useState("正在打开…");
  const [storeDurable, setStoreDurable] = useState(true);
  const [storeNote, setStoreNote] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);

  const suggestions = useMemo(() => suggest(presented.state), [presented.state]);

  const setConfig = useCallback((next: KeeperConfig) => {
    setConfigState(next);
    saveConfig(next);
    const remote = tryDesktopApi();
    if (!remote) return;
    void remote.settings.set({ key: "keeper.enabled", value: next.enabled });
    void remote.settings.set({ key: "keeper.model", value: next.model });
    void remote.settings.set({ key: "keeper.baseUrl", value: next.baseUrl });
  }, []);

  const onNarrationStream = useCallback((event: NarrationStreamEvent) => {
    if (event.kind === "draft") setNarrationDraft(event.draft);
  }, []);

  const rememberUsage = useCallback((usage: ContextUsage | undefined) => {
    if (usage) setLastUsage(usage);
  }, []);

  const push = useCallback((message: Omit<Message, "id">) => {
    setMessages((prev) => [...prev, { ...message, id: `m-${prev.length}-${Date.now()}` }]);
  }, []);

  const pushNotice = useCallback(
    (text: string, stateVersion: number) => {
      push({ role: "system", text, stateVersion, kind: "notice", transient: true });
    },
    [push],
  );

  const refreshBranches = useCallback(async (id: string) => {
    const db = store.current;
    if (db) setBranches(await db.listBranches(id));
  }, []);

  // 开库、续场。事件是权威的，状态由重放算出来，检查点只用来对账。
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const remote = tryDesktopApi();
      if (remote) {
        setStoreBackend("electron-main");
        setStoreDurable(true);
        setStoreNote("权威在主进程。");
        const desk = await ensureDesktopCampaign(remote);
        if (cancelled) return;
        if (desk) {
          setCampaignId(desk.campaign.campaignId);
          setBranchId(desk.branchId);
          const profile = await getDesktopInvestigator(remote, desk.campaign.campaignId);
          if (cancelled) return;
          setInvestigatorProfile(profile);
          const storedEnabled = await remote.settings.get({ key: "keeper.enabled" });
          const storedModel = await remote.settings.get({ key: "keeper.model" });
          const storedUrl = await remote.settings.get({ key: "keeper.baseUrl" });
          if (!cancelled) {
            setConfigState((prev) => ({
              ...prev,
              enabled: storedEnabled.ok && storedEnabled.value === true,
              model:
                storedModel.ok && typeof storedModel.value === "string" && storedModel.value
                  ? storedModel.value
                  : prev.model,
              baseUrl:
                storedUrl.ok && typeof storedUrl.value === "string" && storedUrl.value
                  ? storedUrl.value
                  : prev.baseUrl,
            }));
          }
          const events = await loadDesktopEvents(
            remote,
            desk.campaign.campaignId,
            desk.branchId,
          );
          if (cancelled) return;
          if (events.length > 0) {
            const restored = replay(origin.current, events);
            adopt({ state: restored, log: events });
            setMessages(createOpening(restored, profile));
            pushNotice(
              `已续上主进程里的上一场：重放 ${events.length} 条事件，回到版本 v${restored.version}。`,
              restored.version,
            );
          } else {
            setInvestigatorProfile(null);
            pushNotice("主进程新开一场。事件会写进 campaign.sqlite。", 0);
          }
        }
        if (!cancelled) setReady(true);
        return;
      }

      const opened = await openStore();
      if (cancelled) return;
      store.current = opened.store;
      setStoreBackend(opened.backend);
      setStoreDurable(opened.durable);
      setStoreNote(opened.note ?? null);

      const handle = await opened.store.openCampaign({
        packRef: pack.ref,
        title: pack.manifest.title,
        initialState: origin.current,
      });
      if (cancelled) return;
      origin.current = handle.initialState;
      setCampaignId(handle.campaignId);
      setBranchId(handle.branchId);

      const events = await opened.store.loadEvents(handle.branchId);
      if (!cancelled && events.length > 0) {
        const restored = replay(handle.initialState, events);
        const hash = stateHash(restored);
        const checkpoint = await opened.store.latestCheckpoint(handle.branchId);
        const stored = await opened.store.loadMessages(handle.branchId);

        if (checkpoint && checkpoint.stateHash !== hash) {
          pushNotice(
            `存档对不上账（重放算出 ${hash}，检查点记的是 ${checkpoint.stateHash}），这一场按新的开。`,
            0,
          );
        } else {
          adopt({ state: restored, log: events });
          const profile = investigatorFromState(restored);
          setInvestigatorProfile(profile);
          const restoredMessages = stored
            .map((message, index) => fromStored(message, index))
            .filter((message): message is Message => message != null);
          persistedDialogue.current.hydrate(handle.branchId, recentDialogueTurns(restoredMessages));
          setMessages(restoredMessages.length > 0 ? restoredMessages : createOpening(restored, profile));
          memoryRef.current = await opened.store.loadMemory(handle.branchId);
          pushNotice(
            `已续上上一场：重放 ${events.length} 条事件，回到版本 v${restored.version}，哈希 ${hash}。`,
            restored.version,
          );
        }
      }
      if (events.length === 0) setInvestigatorProfile(null);

      if (cancelled) return;
      await refreshBranches(handle.campaignId);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [adopt, pushNotice, refreshBranches]);

  // 对话不是事实，整段覆盖即可；它丢了也不影响这一场能不能续上。
  useEffect(() => {
    const db = store.current;
    if (!ready || !branchId || !db) return;
    const stored = messages
      .map(toStored)
      .filter((message): message is StoredMessage => message != null);
    void persistedDialogue.current.persist(
      branchId,
      recentDialogueTurns(messages),
      () => db.saveMessages(branchId, stored),
    ).catch(() => undefined);
  }, [branchId, messages, ready]);

  const act = useCallback(
    async (intent: Intent, spoken: string, held = false, modelTaskId?: string) => {
      if (!held) {
        if (inflight.current) return false;
        inflight.current = true;
      }
      const { state, log } = authoritative.current;
      const recentTurns = branchId ? await persistedDialogue.current.snapshot(branchId) : [];
      setBusy(true);
      setNarrationDraft(null);
      const candidateCheck = checkCandidateForIntent({ intent, state, profile: investigatorProfile });
      if (!candidateCheck) {
        dispatchCheckPreview({ type: "began", check: null });
        setPending({ label: spoken, intent, check: null });
      }
      // 路由之后、掷骰之前：先公开意图和门槛，并跨一个任务让 React 落笔。
      await publishCheckCandidate({
        candidate: candidateCheck,
        onCandidate: (check) => {
          dispatchCheckPreview({ type: "began", check });
          setPending({ label: spoken, intent, check });
        },
      });
      const remote = tryDesktopApi();
      if (remote && campaignId && branchId) {
        setStatus("主持人正在组织语言…");
        let baseState = state;
        let baseLog = log;
        let activeBranch = branchId;
        let view: Awaited<ReturnType<typeof submitDesktopTurn>>;
        const onCandidate = (check: CheckCandidate, candidateIntent: Intent) => {
          dispatchCheckPreview({ type: "began", check });
          setPending({ label: spoken, intent: candidateIntent, check });
        };
        try {
          view = await submitDesktopTurn({
            api: remote,
            campaignId,
            branchId: activeBranch,
            expectedStateVersion: baseState.version,
            text: spoken,
            onDraft: (draft) => setNarrationDraft(draft),
            onCandidate,
          });
          if ("error" in view && view.errorCode === "TURN_VERSION_CONFLICT") {
            const synced = await loadDesktopCampaign(remote, campaignId);
            if (synced) {
              baseState = synced.state;
              baseLog = synced.events;
              activeBranch = synced.branchId;
              setBranchId(activeBranch);
              adopt({ state: baseState, log: baseLog });
              const syncedProfile = await getDesktopInvestigator(remote, campaignId);
              setInvestigatorProfile(syncedProfile);
              setMessages(createOpening(baseState, syncedProfile));
              lastTurn.current = null;
              memoryRef.current = emptyMemory();
              contextRef.current = emptyContextStore();
              setLastTrace(null);
              setLastUsage(null);
              view = await submitDesktopTurn({
                api: remote,
                campaignId,
                branchId: activeBranch,
                expectedStateVersion: baseState.version,
                text: spoken,
                onDraft: (draft) => setNarrationDraft(draft),
                onCandidate,
              });
            }
          }
        } catch (error) {
          setStatus(null);
          setNarrationDraft(null);
          pushNotice(`这一回合没能提交：${error instanceof Error ? error.message : String(error)}`, state.version);
          reveal();
          setPending(null);
          setBusy(false);
          if (!held) inflight.current = false;
          return false;
        }
        if ("error" in view) {
          setStatus(null);
          setNarrationDraft(null);
          pushNotice(`这一回合没能落盘：${view.error}`, state.version);
          reveal();
          setPending(null);
          setBusy(false);
          if (!held) inflight.current = false;
          return false;
        }
        push({ role: "pl", text: spoken, stateVersion: baseState.version });
        if (view.kind !== "committed") {
          setStatus(null);
          setNarrationDraft(null);
          push({ role: "kp", text: view.narration, stateVersion: baseState.version, source: "程序" });
          reveal();
          setPending(null);
          setBusy(false);
          if (!held) inflight.current = false;
          return true;
        }
        const nextLog = [...baseLog, ...view.events];
        const nextState = replay(origin.current, nextLog);
        authoritative.current = { state: nextState, log: nextLog };
        const check = view.check as import("@/engine/types").CheckResult | undefined;
        dispatchCheckPreview(check ? { type: "resolved", check } : { type: "cleared" });
        const fallback = view.narration;
        const remoteIntent = (view.intent as Intent | undefined) ?? intent;
        lastTurn.current = {
          state: nextState,
          events: view.events,
          intent: remoteIntent,
          spoken,
          fallback,
        };
        setStatus(null);
        setNarrationDraft(null);
        push({
          role: "kp",
          text: view.narration,
          check,
          stateVersion: nextState.version,
          source: view.narrationKind,
          note: view.narrationNote,
        });
        const story = storyMonitor({
          before: baseState,
          after: nextState,
          committed: view.events,
          log: nextLog,
        });
        const jobs = runAfterCommit({
          taskId: `task-${nextState.turn}`,
          branchId: activeBranch,
          state: nextState,
          committed: view.events,
          recent: recentFromTurn({
            player: spoken,
            gm: view.narration,
            committed: view.events,
            stateVersion: nextState.version,
          }),
          story,
          memory: memoryRef.current,
          context: contextRef.current,
        });
        // Replay only for the debug panel. Main already persisted; do not save again.
        memoryRef.current = jobs.memory;
        contextRef.current = jobs.context;
        setLastTrace(
          traceFromJobs({
            jobs,
            story,
            turn: nextState.turn,
            stateVersion: nextState.version,
            source: "desktop-replay",
          }),
        );
        reveal();
        setPending(null);
        setBusy(false);
        if (!held) inflight.current = false;
        return true;
      }

      push({ role: "pl", text: spoken, stateVersion: state.version });

      const outcome = playTurn({ text: spoken, state, log, intent, profile: investigatorProfile });
      if (outcome.kind === "query" || outcome.kind === "clarification") {
        push({
          role: "kp",
          text: outcome.text,
          stateVersion: state.version,
          source: "程序",
        });
        reveal();
        setPending(null);
        setBusy(false);
        if (!held) inflight.current = false;
        return true;
      }

      const { state: nextState, log: nextLog, committed, check, narration: fallback } = outcome;
      dispatchCheckPreview(check ? { type: "resolved", check } : { type: "cleared" });
      authoritative.current = { state: nextState, log: nextLog };

      const db = store.current;
      if (db && branchId) {
        try {
          await db.appendEvents(branchId, committed);
          await db.saveCheckpoint({
            branchId,
            cursor: nextLog.length - 1,
            stateVersion: nextState.version,
            stateHash: stateHash(nextState),
            packRef: pack.ref,
          });
          if (campaignId) await refreshBranches(campaignId);
        } catch (error) {
          pushNotice(
            `这一回合没能落盘：${error instanceof Error ? error.message : String(error)}`,
            nextState.version,
          );
        }
      }

      lastTurn.current = {
        state: nextState,
        events: committed,
        intent,
        spoken,
        fallback,
        modelTaskId,
      };
      let kickLive = () => {};
      if (outcome.kind === "committed") {
        const jobs = runAfterCommit({
          taskId: modelTaskId ?? `task-${nextState.turn}`,
          branchId: branchId ?? "local",
          state: nextState,
          committed,
          recent: outcome.recent,
          story: outcome.story,
          memory: memoryRef.current,
          context: contextRef.current,
        });
        memoryRef.current = jobs.memory;
        contextRef.current = jobs.context;
        if (store.current && branchId) {
          void store.current.saveMemory(branchId, jobs.memory);
          void store.current.saveFrontier(branchId, jobs.director.frontier);
        }
        setLastTrace(
          traceFromJobs({
            jobs,
            story: outcome.story,
            turn: nextState.turn,
            stateVersion: nextState.version,
            source: "local",
            livePending: config.enabled,
          }),
        );
        kickLive = () => {
          if (!config.enabled || liveInflight.current) return;
          liveInflight.current = true;
          void runAfterCommitLive({
            taskId: modelTaskId ?? `task-${nextState.turn}`,
            branchId: branchId ?? "local",
            state: nextState,
            committed,
            recent: outcome.recent,
            story: outcome.story,
            memory: memoryRef.current,
            context: contextRef.current,
            config,
          })
            .then((jobsLive) => {
              memoryRef.current = jobsLive.memory;
              contextRef.current = jobsLive.context;
              if (store.current && branchId) {
                void store.current.saveMemory(branchId, jobsLive.memory);
                void store.current.saveFrontier(branchId, jobsLive.director.frontier);
              }
              setLastTrace(
                traceFromJobs({
                  jobs: jobsLive,
                  story: outcome.story,
                  turn: nextState.turn,
                  stateVersion: nextState.version,
                  source: "local",
                }),
              );
            })
            .finally(() => {
              liveInflight.current = false;
            });
        };
      }
      const result = { state: nextState, committed };

      try {
        if (!config.enabled) {
          push({
            role: "kp",
            text: fallback,
            check,
            stateVersion: result.state.version,
            source: "模板",
          });
          return true;
        }

        setStatus("主持人正在组织语言…");
        const narration = modelTaskId
          ? await narrateFreeTurn({
              config,
              modelTaskId,
              state: result.state,
              events: result.committed,
              intent,
              spoken,
              recentTurns,
              profile: investigatorProfile,
              scenarioPack: pack,
              fallback,
              onStream: onNarrationStream,
            })
          : await keeperNarrate({
              config,
              state: result.state,
              events: result.committed,
              intent,
              spoken,
              recentTurns,
              profile: investigatorProfile,
              scenarioPack: pack,
              fallback,
              onStream: onNarrationStream,
            });
        setStatus(null);
        rememberUsage(narration.usage);
        setNarrationDraft(null);

        push({
          role: "kp",
          text: narration.text,
          check,
          stateVersion: result.state.version,
          source: narration.source,
          note: narration.note,
        });
        kickLive();
      } catch (error) {
        // 彻底失败也算落笔：退回模板，已呈现状态必须跟上，不能停在旧值。
        setStatus(null);
        setNarrationDraft(null);
        push({
          role: "kp",
          text: fallback,
          check,
          stateVersion: result.state.version,
          source: "模板",
          note: error instanceof Error ? error.message : String(error),
        });
        kickLive();
      } finally {
        reveal();
        setPending(null);
        setBusy(false);
        if (!held) inflight.current = false;
      }
      return true;
    },
    [
      branchId,
      campaignId,
      config,
      onNarrationStream,
      push,
      pushNotice,
      refreshBranches,
      rememberUsage,
      reveal,
      investigatorProfile,
    ],
  );

  const say = useCallback(
    async (text: string) => {
      if (inflight.current) return false;
      const desk = authoritative.current;
      // 快路径先走保守匹配；桌面主进程自己再路由一遍。只有浏览器才把听不懂的话交给模型。
      const fast = route(text, desk.state);
      if (tryDesktopApi() || fast.kind !== "unclear" || !config.enabled) {
        return await act(fast, text);
      }

      inflight.current = true;
      setBusy(true);
      setStatus("主持人正在听懂你这句话…");
      try {
        const modelTaskId = newFreeTurnTaskId();
        const recentTurns = branchId ? await persistedDialogue.current.snapshot(branchId) : [];
        const routed = await handleFreeTurn({
          config,
          state: desk.state,
          profile: investigatorProfile,
          currentStateVersion: () => authoritative.current.state.version,
          spoken: text,
          recentTurns,
          modelTaskId,
        });
        setStatus(null);
        return await act(routed.intent, text, true, modelTaskId);
      } catch (error) {
        setStatus(null);
        setPending(null);
        reveal();
        setBusy(false);
        pushNotice(
          `这句话没听懂：${error instanceof Error ? error.message : String(error)}`,
          desk.state.version,
        );
      } finally {
        inflight.current = false;
      }
      return false;
    },
    [act, branchId, config, investigatorProfile, pushNotice, reveal],
  );

  /** 换一种说法：同一批已提交事件重讲一遍，状态版本和骰子都不动。 */
  const retell = useCallback(async () => {
    if (tryDesktopApi()) return;
    const turn = lastTurn.current;
    if (!turn || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setNarrationDraft(null);
    setStatus("主持人正在换一种说法…");
    try {
      const recentTurns = branchId ? await persistedDialogue.current.snapshot(branchId) : [];
      const narration = await keeperNarrate({
        config,
        state: turn.state,
        events: turn.events,
        intent: turn.intent,
        spoken: turn.spoken,
        recentTurns,
        profile: investigatorProfile,
        scenarioPack: pack,
        fallback: turn.fallback,
        onStream: onNarrationStream,
      });
      setStatus(null);
      rememberUsage(narration.usage);
      setNarrationDraft(null);
      setMessages((prev) => {
        const index = prev.map((m) => m.role).lastIndexOf("kp");
        if (index < 0) return prev;
        const next = [...prev];
        next[index] = {
          ...next[index],
          text: narration.text,
          source: narration.source,
          note: narration.note,
        };
        return next;
      });
    } catch (error) {
      setStatus(null);
      setNarrationDraft(null);
      pushNotice(
        `换一种说法没写成：${error instanceof Error ? error.message : String(error)}`,
        authoritative.current.state.version,
      );
    } finally {
      setBusy(false);
      inflight.current = false;
    }
  }, [branchId, config, investigatorProfile, onNarrationStream, pushNotice, rememberUsage]);

  /** 切到某条分支：状态一律由那条分支的事件重放得来，不从别处抄。 */
  const switchBranch = useCallback(
    async (target: string) => {
      const db = store.current;
      if (!db || !campaignId || busy) return;
      setBusy(true);
      setPending({ label: "切换分支", intent: null, check: null });
      dispatchCheckPreview({ type: "cleared" });
      try {
        await persistedDialogue.current.settle(target);
        const events = await db.loadEvents(target);
        const stored = await db.loadMessages(target);
        const restored = replay(origin.current, events);

        setBranchId(target);
        adopt({ state: restored, log: events });
        const profile = investigatorFromState(restored);
        setInvestigatorProfile(profile);
        dispatchConfirmation({ type: "attempted" });
        const restoredMessages = stored
          .map((message, index) => fromStored(message, index))
          .filter((message): message is Message => message != null);
        persistedDialogue.current.hydrate(target, recentDialogueTurns(restoredMessages));
        setMessages(restoredMessages.length > 0 ? restoredMessages : createOpening(restored, profile));
        lastTurn.current = null;
        setLastUsage(null);
        setNarrationDraft(null);
        await db.setHead(campaignId, target);
        await refreshBranches(campaignId);
      } finally {
        setPending(null);
        setBusy(false);
      }
    },
    [adopt, busy, campaignId, refreshBranches],
  );

  /**
   * 回到某一版。
   * 后面的事一件都不会被抹掉——它们留在原来那条分支上，随时能切回去看。
   */
  const rewind = useCallback(
    async (mark: TurnMark) => {
      const db = store.current;
      if (!db || !campaignId || !branchId || busy) return;
      setBusy(true);
      setPending({ label: `回到版本 v${mark.version}`, intent: null, check: null });
      dispatchCheckPreview({ type: "cleared" });
      try {
        const target = await db.fork({
          campaignId,
          fromBranch: branchId,
          throughSeq: mark.seq,
          title: `从 v${mark.version} 另起`,
        });
        const events = await db.loadEvents(target);
        const restored = replay(origin.current, events);
        // 那一版之后说过的话不再作数，但它们仍然留在原分支的记录里。
        const kept = messages.filter(
          (message) => message.stateVersion <= mark.version && !isTransient(message),
        );
        await db.saveMessages(
          target,
          kept.map(toStored).filter((message): message is StoredMessage => message != null),
        );
        persistedDialogue.current.hydrate(target, recentDialogueTurns(kept));

        setBranchId(target);
        adopt({ state: restored, log: events });
        setInvestigatorProfile(investigatorFromState(restored));
        setMessages([
          ...kept,
          {
            id: `sys-${Date.now()}`,
            role: "system",
            text: `已回到版本 v${restored.version} 并另起一条分支；原来那条一个字都没动。`,
            stateVersion: restored.version,
            kind: "notice",
            transient: true,
          },
        ]);
        lastTurn.current = null;
        setLastUsage(null);
        setNarrationDraft(null);
        await db.setHead(campaignId, target);
        await refreshBranches(campaignId);
      } finally {
        setPending(null);
        setBusy(false);
      }
    },
    [adopt, branchId, busy, campaignId, messages, refreshBranches],
  );

  const adoptDesktopCampaign = useCallback((
    loaded: Awaited<ReturnType<typeof loadDesktopCampaign>>,
    profile: InvestigatorProfile | null,
  ) => {
    if (!loaded) return false;
    origin.current = initialState();
    setCampaignId(loaded.campaign.campaignId);
    setBranchId(loaded.branchId);
    adopt({ state: loaded.state, log: loaded.events });
    setInvestigatorProfile(profile);
    dispatchConfirmation({ type: "attempted" });
    setMessages(loaded.history ? createRestoredMessages(loaded.state, loaded.history) : createOpening(loaded.state, profile));
    lastTurn.current = null;
    memoryRef.current = emptyMemory();
    contextRef.current = emptyContextStore();
    setLastTrace(null);
    setLastUsage(null);
    setNarrationDraft(null);
    setPending(null);
    dispatchCheckPreview({ type: "cleared" });
    return true;
  }, [adopt]);

  /** 导出只包含战役权威数据；桌面设置、模型配置和 API Key 不在战役库中。 */
  const exportCampaign = useCallback(async () => {
    if (!campaignId) return;
    const remote = tryDesktopApi();
    const db = store.current;
    let payload: ExportPayload | DesktopCampaignBackup;
    let branchCount: number;
    if (remote) {
      const exported = await remote.backup.exportCampaign({ campaignId });
      if (!exported.ok) {
        pushNotice(`导出失败：${exported.error.messageKey}`, presented.state.version);
        return;
      }
      payload = exported.value;
      branchCount = exported.value.body.tables.branches?.length ?? 0;
    } else {
      if (!db) return;
      payload = await db.exportCampaign(campaignId);
      branchCount = payload.branches.length;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${pack.manifest.id}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    pushNotice(`已导出这一场：${branchCount} 条分支。`, presented.state.version);
  }, [campaignId, presented.state.version, pushNotice]);

  const importCampaign = useCallback(
    async (file: File) => {
      const remote = tryDesktopApi();
      const db = store.current;
      try {
        const parsed = JSON.parse(await file.text()) as ExportPayload | DesktopCampaignBackup;
        if (remote) {
          const imported = await remote.backup.importCampaign({
            backup: parsed as DesktopCampaignBackup,
          });
          if (!imported.ok) {
            pushNotice(`导入失败：${imported.error.messageKey}`, presented.state.version);
            return;
          }
          const loaded = await loadDesktopCampaign(remote, imported.value.campaignId);
          const profile = await getDesktopInvestigator(remote, imported.value.campaignId);
          if (!adoptDesktopCampaign(loaded, profile)) {
            pushNotice("备份已导入，但载入失败；请重新启动后重试。", presented.state.version);
            return;
          }
          pushNotice("战役备份已校验并导入。", loaded?.state.version ?? 0);
          return;
        }
        if (!db) return;
        const payload = parsed as ExportPayload;
        if (payload.campaign.packRef !== pack.ref) {
          pushNotice(
            `这份存档用的是资料包 ${payload.campaign.packRef}，当前是 ${pack.ref}，拒绝导入。`,
            presented.state.version,
          );
          return;
        }
        const handle = await db.importCampaign(payload);
        origin.current = handle.initialState;
        setCampaignId(handle.campaignId);
        await refreshBranches(handle.campaignId);
        await switchBranch(handle.branchId);
      } catch (error) {
        pushNotice(
          `导入失败：${error instanceof Error ? error.message : String(error)}`,
          presented.state.version,
        );
      }
    },
    [adoptDesktopCampaign, presented.state.version, pushNotice, refreshBranches, switchBranch],
  );

  const switchCampaign = useCallback(async (targetCampaignId: string) => {
    const remote = tryDesktopApi();
    if (!remote || busy || inflight.current) return;
    setBusy(true);
    try {
      const loaded = await loadDesktopCampaign(remote, targetCampaignId);
      const profile = await getDesktopInvestigator(remote, targetCampaignId);
      adoptDesktopCampaign(loaded, profile);
    } finally {
      setBusy(false);
    }
  }, [adoptDesktopCampaign, busy]);

  const deleteCampaign = useCallback(async (targetCampaignId: string) => {
    const remote = tryDesktopApi();
    if (!remote || busy || inflight.current) return;
    setBusy(true);
    try {
      const listed = await remote.campaign.list({ limit: 50 });
      if (!listed.ok) {
        pushNotice(`战役目录读取失败：${listed.error.messageKey}`, authoritative.current.state.version);
        return;
      }
      const next = listed.value.items.find((item) => item.campaignId !== targetCampaignId);
      const removed = await remote.campaign.moveToTrash({ campaignId: targetCampaignId });
      if (!removed.ok) {
        pushNotice(`战役删除失败：${removed.error.messageKey}`, authoritative.current.state.version);
        return;
      }
      if (targetCampaignId !== campaignId) return;
      const loaded = next
        ? await loadDesktopCampaign(remote, next.campaignId)
        : await createFreshDesktopCampaign(remote);
      const profile = loaded
        ? await getDesktopInvestigator(remote, loaded.campaign.campaignId)
        : null;
      if (!adoptDesktopCampaign(loaded, profile)) {
        pushNotice("旧战役已删除，但新战役载入失败；请重新启动后重试。", 0);
      }
    } finally {
      setBusy(false);
    }
  }, [adoptDesktopCampaign, busy, campaignId, pushNotice]);

  const restoreDesktopCheckpoint = useCallback(async (checkpointId: string) => {
    const remote = tryDesktopApi();
    if (!remote || !campaignId || busy || inflight.current) return false;
    inflight.current = true;
    setBusy(true);
    try {
      const restored = await remote.checkpoint.restoreCopy({
        campaignId,
        checkpointId,
        label: "测试恢复副本",
      });
      if (!restored.ok) {
        pushNotice(`恢复失败：${restored.error.messageKey}`, authoritative.current.state.version);
        return false;
      }
      const opened = await remote.campaign.open({ campaignId });
      const loaded = opened.ok
        ? await loadDesktopBranch(remote, opened.value, restored.value.branchId)
        : null;
      const profile = await getDesktopInvestigator(remote, campaignId);
      if (adoptDesktopCampaign(loaded, profile)) return true;
      pushNotice("恢复副本已经创建，但载入失败；请重新启动后重试。", authoritative.current.state.version);
      return false;
    } finally {
      setBusy(false);
      inflight.current = false;
    }
  }, [adoptDesktopCampaign, busy, campaignId, pushNotice]);

  const recreateDesktopInvestigator = useCallback(async (checkpointId: string) => {
    const remote = tryDesktopApi();
    if (!remote || !campaignId || busy || inflight.current) return false;
    inflight.current = true;
    setBusy(true);
    try {
      const recreated = await remote.checkpoint.recreateInvestigator({
        campaignId,
        checkpointId,
        label: "重新创建调查员",
      });
      if (!recreated.ok) {
        pushNotice(`重新创建失败：${recreated.error.messageKey}`, authoritative.current.state.version);
        return false;
      }
      const opened = await remote.campaign.open({ campaignId });
      const loaded = opened.ok
        ? await loadDesktopBranch(remote, opened.value, recreated.value.branchId)
        : null;
      const profile = await getDesktopInvestigator(remote, campaignId);
      if (profile !== null || !adoptDesktopCampaign(loaded, null)) {
        pushNotice("重建分支已经创建，但载入失败；请重新启动后重试。", authoritative.current.state.version);
        return false;
      }
      return true;
    } finally {
      setBusy(false);
      inflight.current = false;
    }
  }, [adoptDesktopCampaign, busy, campaignId, pushNotice]);

  /** 重开：旧的那一场留在库里，只是不再是当前这一场。 */
  const reset = useCallback(async () => {
    const remote = tryDesktopApi();
    if (remote) {
      if (busy || inflight.current) return;
      setBusy(true);
      try {
        adoptDesktopCampaign(await createFreshDesktopCampaign(remote), null);
      } finally {
        setBusy(false);
      }
      return;
    }
    const db = store.current;
    const fresh = initialState();
    origin.current = fresh;
    adopt({ state: fresh, log: [] });
    setInvestigatorProfile(null);
    dispatchConfirmation({ type: "attempted" });
    setMessages(createOpening(fresh, null));
    lastTurn.current = null;
    memoryRef.current = emptyMemory();
    contextRef.current = emptyContextStore();
    setLastTrace(null);
    setLastUsage(null);
    setNarrationDraft(null);
    setPending(null);
    dispatchCheckPreview({ type: "cleared" });

    if (!db) return;
    const handle = await db.openCampaign({
      packRef: pack.ref,
      title: pack.manifest.title,
      initialState: fresh,
      forceNew: true,
    });
    setCampaignId(handle.campaignId);
    setBranchId(handle.branchId);
    persistedDialogue.current.hydrate(handle.branchId, []);
    await refreshBranches(handle.campaignId);
  }, [adopt, adoptDesktopCampaign, busy, refreshBranches]);

  const confirmInvestigator = useCallback(async (allocation: InvestigatorAllocation) => {
    if (!campaignId || !branchId || busy || inflight.current || investigatorProfile) return false;
    dispatchConfirmation({ type: "attempted" });
    inflight.current = true;
    setBusy(true);
    setPending({ label: "确认调查员", intent: null, check: null });
    dispatchCheckPreview({ type: "cleared" });
    try {
      const remote = tryDesktopApi();
      if (remote) {
        const confirmed = await remote.campaign.confirmInvestigator({
          campaignId,
          branchId,
          allocation,
        });
        if (!confirmed.ok) {
          dispatchConfirmation({
            type: "rejected",
            error: `调查员确认失败：${confirmed.error.messageKey}`,
          });
          return false;
        }
        const loaded = await loadDesktopCampaign(remote, campaignId);
        if (!adoptDesktopCampaign(loaded, confirmed.value.profile) || !loaded) {
          dispatchConfirmation({
            type: "rejected",
            error: "调查员已经确认，但分支重载失败；请重新启动后重试。",
          });
          return false;
        }
        setMessages(createOpening(loaded.state, confirmed.value.profile));
        return true;
      }

      const desk = authoritative.current;
      if (desk.state.version > 0) {
        dispatchConfirmation({ type: "rejected", error: "这一场已经开始，不能再确认新的调查员。" });
        return false;
      }
      const rules = pack.manifest.creation;
      if (!rules) {
        dispatchConfirmation({ type: "rejected", error: "当前资料包没有调查员创建规则。" });
        return false;
      }
      const projected = projectInvestigatorConfirmation({
        state: desk.state,
        log: desk.log,
        allocation,
        rules,
        itemLocations: Object.fromEntries(pack.items.map((item) => [item.id, item.at])),
      });
      if (!projected) {
        dispatchConfirmation({ type: "rejected", error: "调查员点数或人生经历未通过校验。" });
        return false;
      }

      const db = store.current;
      if (db) {
        try {
          await db.appendEvents(branchId, projected.committed);
          await db.saveCheckpoint({
            branchId,
            cursor: projected.log.length - 1,
            stateVersion: projected.state.version,
            stateHash: stateHash(projected.state),
            packRef: pack.ref,
          });
          await refreshBranches(campaignId);
        } catch (error) {
          setStoreDurable(false);
          setStoreNote("调查员确认只保留在当前页面，关闭后可能丢失。");
          pushNotice(
            `调查员确认未能落盘：${error instanceof Error ? error.message : String(error)}`,
            projected.state.version,
          );
        }
      }
      adopt({ state: projected.state, log: projected.log });
      setInvestigatorProfile(projected.profile);
      setMessages(createOpening(projected.state, projected.profile));
      return true;
    } catch (error) {
      dispatchConfirmation({
        type: "rejected",
        error: `调查员确认失败：${error instanceof Error ? error.message : String(error)}`,
      });
      return false;
    } finally {
      setPending(null);
      setBusy(false);
      inflight.current = false;
    }
  }, [adopt, adoptDesktopCampaign, branchId, busy, campaignId, investigatorProfile, pushNotice, refreshBranches]);

  const pushSystem = useCallback(
    (text: string) => {
      pushNotice(text, 0);
    },
    [pushNotice],
  );

  return {
    state: presented.state,
    log: presented.log,
    investigatorProfile,
    confirmationError: confirmation.error,
    activeCheckPreview,
    pending,
    messages,
    narrationDraft,
    lastUsage,
    lastTrace,
    suggestions,
    busy,
    status,
    config,
    setConfig,
    canRetell: lastTurn.current != null && !tryDesktopApi(),
    ready,
    storeBackend,
    storeDurable,
    storeNote,
    campaignId,
    branchId,
    branches,
    act,
    say,
    retell,
    rewind,
    switchBranch,
    exportCampaign,
    importCampaign,
    reset,
    switchCampaign,
    deleteCampaign,
    restoreDesktopCheckpoint,
    recreateDesktopInvestigator,
    confirmInvestigator,
    pushSystem,
  };
}
