import { evaluate } from "./conditions";
import { applyEvent } from "./events";
import { assertKernel } from "./kernel";
import { pack, type Pack } from "./pack";
import type { EventDraft, GameEvent, GameState } from "./types";

/**
 * 原子提交：一批候选变化，要么全部落库，要么一条都不落。
 * 提交成功之后版本号加一，事件按顺序追加，之后绝不回头修改。
 */
export function commit(params: {
  state: GameState;
  log: GameEvent[];
  drafts: EventDraft[];
  turnId: string;
  scenarioPack?: Pack;
}): { state: GameState; log: GameEvent[]; committed: GameEvent[] } {
  const { state, log, turnId } = params;
  const scenarioPack = params.scenarioPack ?? pack;
  if (params.drafts.length === 0) {
    return { state, log, committed: [] };
  }

  let next = state;
  for (const draft of params.drafts) {
    next = applyEvent(next, draft.payload);
  }

  // 条件是在提交之后、对着已经提交的状态判定的；
  // 需要立即触发的，并进同一笔提交，不另开一个回合。
  const triggered = evaluateConditions(next, scenarioPack);
  for (const draft of triggered) {
    next = applyEvent(next, draft.payload);
  }

  const all = [...params.drafts, ...triggered];
  next = { ...next, version: state.version + 1, turn: state.turn + 1 };
  assertKernel(next, scenarioPack);

  const committed: GameEvent[] = all.map((draft, index) => ({
    ...draft,
    id: `${turnId}-${index}`,
    seq: log.length + index,
    turnId,
    versionAfter: next.version,
    clock: next.clock,
    visibility: draft.visibility ?? "public",
  }));

  return { state: next, log: [...log, ...committed], committed };
}

/**
 * 确定性触发：条件与剧情节点都写在资料包里，这里只负责对着已提交的状态求值。
 * 一条条件的效果可能让另一条成立，所以要跑到不动点为止（设上限防止作者写出死循环）。
 */
function evaluateConditions(state: GameState, scenarioPack: Pack): EventDraft[] {
  const drafts: EventDraft[] = [];
  let projected = state;

  for (let pass = 0; pass < 5; pass += 1) {
    const round: EventDraft[] = [];

    for (const condition of scenarioPack.conditions) {
      const firedFlag = `${condition.id}.fired`;
      if (condition.once && projected.flags[firedFlag]) continue;
      if (!evaluate(condition.when, projected)) continue;

      for (const effect of condition.effects) {
        round.push({
          payload: effect.event,
          summary: effect.summary,
          visibility: effect.visibility,
          narration: effect.narration,
          cause: `condition:${condition.id}`,
        });
      }
      if (condition.once) {
        round.push({
          payload: { type: "flag_set", flag: firedFlag, value: true },
          summary: `条件「${condition.title}」已触发过，不再重复。`,
          cause: `condition:${condition.id}`,
        });
      }
    }

    for (const node of scenarioPack.story) {
      const doneFlag = `${node.id}.done`;
      const failedFlag = `${node.id}.failed`;
      if (!projected.flags[doneFlag] && evaluate(node.doneWhen, projected)) {
        round.push({
          payload: { type: "node_done", node: node.id },
          summary: `剧情节点「${node.title}」完成。`,
          cause: `scenario:${node.id}`,
        });
      }
      if (node.failedWhen && !projected.flags[failedFlag] && evaluate(node.failedWhen, projected)) {
        round.push({
          payload: { type: "flag_set", flag: failedFlag, value: true },
          summary: `剧情节点「${node.title}」已失败。`,
          cause: `scenario:${node.id}`,
        });
      }
    }

    if (round.length === 0) break;
    for (const draft of round) projected = applyEvent(projected, draft.payload);
    drafts.push(...round);
  }

  return drafts;
}

/**
 * 重放：从初始状态出发，把事件逐条应用回去。
 * 存档存的就是「初始状态 + 事件记录」，读档必须能重放出同一个状态。
 */
export function replay(initial: GameState, log: GameEvent[]): GameState {
  let state = initial;
  const turns = new Set<string>();
  for (const event of log) {
    state = applyEvent(state, event.payload);
    turns.add(event.turnId);
  }
  return { ...state, version: turns.size, turn: turns.size };
}

/** 状态哈希：读档之后跟检查点比对，对不上就说明重放出了问题。 */
export function stateHash(state: GameState): string {
  const canonical = JSON.stringify(state, Object.keys(state).sort());
  let h = 2166136261;
  for (let i = 0; i < canonical.length; i += 1) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
