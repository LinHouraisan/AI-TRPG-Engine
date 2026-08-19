import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureDesktopCampaign, loadDesktopEvents, submitDesktopTurn, tryDesktopApi } from "@/desktop-play";
import { narrate, openingLine, suggest } from "@/engine/narrate";
import { pack, packIndex } from "@/engine/pack";
import { playTurn } from "@/engine/play-turn";
import { route } from "@/engine/router";
import { thresholdFor } from "@/engine/rules";
import { replay, stateHash } from "@/engine/runtime";
import { initialState } from "@/engine/state";
import type { CheckResult, GameEvent, GameState, Intent } from "@/engine/types";
import { loadConfig, saveConfig, type KeeperConfig } from "@/keeper/config";
import type { ContextUsage } from "@/keeper/context";
import { keeperNarrate, keeperRoute, type NarrationStreamEvent } from "@/keeper/keeper";
import {
  openStore,
  type BranchInfo,
  type ExportPayload,
  type Store,
  type StoredMessage,
} from "@/store";

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
export type PendingCheck = {
  title: string;
  skill: string;
  skillValue: number;
  difficulty: "regular" | "hard" | "extreme";
  threshold: number;
};

export type PendingAction = {
  label: string;
  /** 路由之后才有。回滚、切分支没有意图。 */
  intent: Intent | null;
  check: PendingCheck | null;
};

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

function createOpening(state: GameState): Message[] {
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

/** 上一回合的素材。重述用的是同一批已提交事件，因此绝不会重掷骰子。 */
type LastTurn = {
  state: GameState;
  events: GameEvent[];
  intent: Intent;
  spoken: string;
  fallback: string;
};

type Desk = {
  state: GameState;
  log: GameEvent[];
};

/**
 * 门槛只问 rules，不走裁定。裁定会立刻带出点数；
 * 界面如果等它，等待条就会变成剧透。
 */
function pendingCheckFor(intent: Intent, state: GameState): PendingCheck | null {
  if (intent.kind !== "unlock") return null;
  const lock = packIndex.lock(intent.lock);
  if (!lock || lock.at !== state.pcAt || state.unlocked[lock.id]) return null;
  const skillValue = state.skills[lock.skill];
  if (skillValue == null) return null;
  return {
    title: lock.title,
    skill: lock.skill,
    skillValue,
    difficulty: lock.difficulty,
    threshold: thresholdFor(skillValue, lock.difficulty),
  };
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
  const [messages, setMessages] = useState<Message[]>(() => createOpening(initialState()));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [config, setConfigState] = useState<KeeperConfig>(() => loadConfig());
  const lastTurn = useRef<LastTurn | null>(null);
  // 草稿还没过体检；进 messages 就会被落盘。只挂在内存里，定稿到达再写记录。
  const [narrationDraft, setNarrationDraft] = useState<string | null>(null);
  // 上一回合主持人真正吃进去的那份。预估跟它都得来自 buildContext，折算会和引擎脱节。
  const [lastUsage, setLastUsage] = useState<ContextUsage | null>(null);
  const inflight = useRef(false);

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
            pushNotice(
              `已续上主进程里的上一场：重放 ${events.length} 条事件，回到版本 v${restored.version}。`,
              restored.version,
            );
          } else {
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
          const restoredMessages = stored
            .map((message, index) => fromStored(message, index))
            .filter((message): message is Message => message != null);
          if (restoredMessages.length > 0) {
            setMessages(restoredMessages);
          }
          pushNotice(
            `已续上上一场：重放 ${events.length} 条事件，回到版本 v${restored.version}，哈希 ${hash}。`,
            restored.version,
          );
        }
      }

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
    void db.saveMessages(
      branchId,
      messages.map(toStored).filter((message): message is StoredMessage => message != null),
    );
  }, [branchId, messages, ready]);

  const act = useCallback(
    async (intent: Intent, spoken: string, held = false) => {
      if (!held) {
        if (inflight.current) return;
        inflight.current = true;
      }
      const { state, log } = authoritative.current;
      setBusy(true);
      setNarrationDraft(null);
      // 路由之后、掷骰之前：只公开意图和门槛，绝不带点数。
      setPending({
        label: spoken,
        intent,
        check: pendingCheckFor(intent, state),
      });
      push({ role: "pl", text: spoken, stateVersion: state.version });

      const remote = tryDesktopApi();
      if (remote && campaignId && branchId) {
        setStatus("主持人正在组织语言…");
        const view = await submitDesktopTurn({
          api: remote,
          campaignId,
          branchId,
          expectedStateVersion: state.version,
          text: spoken,
          onDraft: (draft) => setNarrationDraft(draft),
        });
        if ("error" in view) {
          setStatus(null);
          setNarrationDraft(null);
          pushNotice(`这一回合没能落盘：${view.error}`, state.version);
          reveal();
          setPending(null);
          setBusy(false);
          if (!held) inflight.current = false;
          return;
        }
        if (view.kind !== "committed") {
          setStatus(null);
          setNarrationDraft(null);
          push({ role: "kp", text: view.narration, stateVersion: state.version, source: "程序" });
          reveal();
          setPending(null);
          setBusy(false);
          if (!held) inflight.current = false;
          return;
        }
        const nextLog = [...log, ...view.events];
        const nextState = replay(origin.current, nextLog);
        authoritative.current = { state: nextState, log: nextLog };
        const check = view.check as import("@/engine/types").CheckResult | undefined;
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
        reveal();
        setPending(null);
        setBusy(false);
        if (!held) inflight.current = false;
        return;
      }

      const outcome = playTurn({ text: spoken, state, log, intent });
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
        return;
      }

      const { state: nextState, log: nextLog, committed, check, narration: fallback } = outcome;
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
      };
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
          return;
        }

        setStatus("主持人正在组织语言…");
        const narration = await keeperNarrate({
          config,
          state: result.state,
          events: result.committed,
          intent,
          spoken,
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
      } finally {
        reveal();
        setPending(null);
        setBusy(false);
        if (!held) inflight.current = false;
      }
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
    ],
  );

  const say = useCallback(
    async (text: string) => {
      if (inflight.current) return;
      const desk = authoritative.current;
      // 快路径先走保守匹配；桌面主进程自己再路由一遍。只有浏览器才把听不懂的话交给模型。
      const fast = route(text, desk.state);
      if (tryDesktopApi() || fast.kind !== "unclear" || !config.enabled) {
        await act(fast, text);
        return;
      }

      inflight.current = true;
      setBusy(true);
      setStatus("主持人正在听懂你这句话…");
      try {
        const routed = await keeperRoute({ config, state: desk.state, spoken: text });
        setStatus(null);
        await act(routed.intent, text, true);
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
    },
    [act, config, pushNotice, reveal],
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
      const narration = await keeperNarrate({
        config,
        state: turn.state,
        events: turn.events,
        intent: turn.intent,
        spoken: turn.spoken,
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
  }, [config, onNarrationStream, pushNotice, rememberUsage]);

  /** 切到某条分支：状态一律由那条分支的事件重放得来，不从别处抄。 */
  const switchBranch = useCallback(
    async (target: string) => {
      const db = store.current;
      if (!db || !campaignId || busy) return;
      setBusy(true);
      setPending({ label: "切换分支", intent: null, check: null });
      try {
        const events = await db.loadEvents(target);
        const stored = await db.loadMessages(target);
        const restored = replay(origin.current, events);

        setBranchId(target);
        adopt({ state: restored, log: events });
        const restoredMessages = stored
          .map((message, index) => fromStored(message, index))
          .filter((message): message is Message => message != null);
        setMessages(restoredMessages.length > 0 ? restoredMessages : createOpening(restored));
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

        setBranchId(target);
        adopt({ state: restored, log: events });
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

  /** 导出的是事件记录，不是聊天记录：换一台机器重放，能得到一模一样的状态。 */
  const exportCampaign = useCallback(async () => {
    const db = store.current;
    if (!db || !campaignId) return;
    const payload = await db.exportCampaign(campaignId);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${pack.manifest.id}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    pushNotice(`已导出这一场：${payload.branches.length} 条分支。`, presented.state.version);
  }, [campaignId, presented.state.version, pushNotice]);

  const importCampaign = useCallback(
    async (file: File) => {
      const db = store.current;
      if (!db) return;
      try {
        const payload = JSON.parse(await file.text()) as ExportPayload;
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
    [presented.state.version, pushNotice, refreshBranches, switchBranch],
  );

  /** 重开：旧的那一场留在库里，只是不再是当前这一场。 */
  const reset = useCallback(async () => {
    const db = store.current;
    const fresh = initialState();
    origin.current = fresh;
    adopt({ state: fresh, log: [] });
    setMessages(createOpening(fresh));
    lastTurn.current = null;
    setLastUsage(null);
    setNarrationDraft(null);
    setPending(null);

    if (!db) return;
    const handle = await db.openCampaign({
      packRef: pack.ref,
      title: pack.manifest.title,
      initialState: fresh,
      forceNew: true,
    });
    setCampaignId(handle.campaignId);
    setBranchId(handle.branchId);
    await refreshBranches(handle.campaignId);
  }, [adopt, refreshBranches]);

  const pushSystem = useCallback(
    (text: string) => {
      pushNotice(text, 0);
    },
    [pushNotice],
  );

  return {
    state: presented.state,
    log: presented.log,
    pending,
    messages,
    narrationDraft,
    lastUsage,
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
    pushSystem,
  };
}
