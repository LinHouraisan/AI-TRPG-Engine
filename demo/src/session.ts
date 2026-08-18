import { useCallback, useMemo, useState } from "react";
import { narrate, suggest } from "@/engine/narrate";
import { resolveIntent } from "@/engine/resolve";
import { route } from "@/engine/router";
import { commit, replay, stateHash } from "@/engine/runtime";
import { initialState } from "@/engine/state";
import type { CheckResult, GameEvent, GameState, Intent } from "@/engine/types";

export type Message = {
  id: string;
  role: "kp" | "pl" | "system";
  text: string;
  check?: CheckResult;
  stateVersion: number;
};

const SAVE_KEY = "ai-trpg-engine-demo/save";

const OPENING =
  "钟停在九点。你按响门铃的时候，雨已经把外套下摆浸透了。女房东只开了半扇门，把钥匙塞给你，说楼上那间空着，别往书房去。";

function createOpening(state: GameState): Message[] {
  return [
    { id: "m0", role: "kp", text: OPENING, stateVersion: state.version },
    {
      id: "m1",
      role: "kp",
      text: narrate({ state, events: [], intent: { kind: "unclear", text: "" } }),
      stateVersion: state.version,
    },
  ];
}

export function useSession() {
  const [state, setState] = useState<GameState>(() => initialState());
  const [log, setLog] = useState<GameEvent[]>([]);
  const [messages, setMessages] = useState<Message[]>(() => createOpening(initialState()));
  const [busy, setBusy] = useState(false);

  const suggestions = useMemo(() => suggest(state), [state]);

  const act = useCallback(
    (intent: Intent, spoken: string) => {
      setBusy(true);
      setMessages((prev) => [
        ...prev,
        {
          id: `pl-${prev.length}`,
          role: "pl",
          text: spoken,
          stateVersion: state.version,
        },
      ]);

      const turnId = `turn-${state.turn + 1}`;
      const { drafts, check, clarification } = resolveIntent({ intent, state, turnId });

      // 追问不掷骰、不提交，回合停在这里等玩家把话说清楚。
      if (clarification) {
        setMessages((prev) => [
          ...prev,
          {
            id: `kp-${prev.length}`,
            role: "kp",
            text: clarification,
            stateVersion: state.version,
          },
        ]);
        setBusy(false);
        return;
      }

      const result = commit({ state, log, drafts, turnId });
      const text = narrate({ state: result.state, events: result.committed, intent });

      setState(result.state);
      setLog(result.log);
      setMessages((prev) => [
        ...prev,
        {
          id: `kp-${prev.length}`,
          role: "kp",
          text,
          check,
          stateVersion: result.state.version,
        },
      ]);
      setBusy(false);
    },
    [log, state],
  );

  const say = useCallback(
    (text: string) => {
      const intent = route(text, state);
      act(intent, text);
    },
    [act, state],
  );

  const save = useCallback(() => {
    const payload = {
      version: 1,
      log,
      messages,
      hash: stateHash(state),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    return payload.hash;
  }, [log, messages, state]);

  const load = useCallback(() => {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { ok: false, reason: "还没有存档。" };
    const payload = JSON.parse(raw) as {
      log: GameEvent[];
      messages: Message[];
      hash: string;
    };
    // 读档走的是重放：从初始状态出发，把事件逐条应用回去。
    const restored = replay(initialState(), payload.log);
    const hash = stateHash(restored);
    if (hash !== payload.hash) {
      return { ok: false, reason: `状态哈希对不上（${hash} ≠ ${payload.hash}），拒绝读档。` };
    }
    setState(restored);
    setLog(payload.log);
    setMessages(payload.messages);
    return { ok: true, reason: `已按事件记录重放到版本 ${restored.version}，哈希 ${hash}。` };
  }, []);

  const reset = useCallback(() => {
    const fresh = initialState();
    setState(fresh);
    setLog([]);
    setMessages(createOpening(fresh));
  }, []);

  const pushSystem = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `sys-${prev.length}`, role: "system", text, stateVersion: 0 },
    ]);
  }, []);

  return { state, log, messages, suggestions, busy, act, say, save, load, reset, pushSystem };
}
