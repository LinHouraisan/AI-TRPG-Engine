import type { EventPayload, GameState } from "./types";

/**
 * 事件 → 状态的唯一入口。状态只会因为事件而改变，
 * 所以任何一处数值，都能顺着事件记录追回它的来源。
 */
export function applyEvent(state: GameState, payload: EventPayload): GameState {
  switch (payload.type) {
    case "moved":
      return {
        ...state,
        pcAt: payload.to,
        visited: { ...state.visited, [payload.to]: true },
        clock: state.clock + payload.minutes,
      };
    case "observed":
      return { ...state, observed: { ...state.observed, [payload.item]: true } };
    case "check_resolved":
      return { ...state, clock: state.clock + payload.minutes };
    case "lock_opened":
      return { ...state, unlocked: { ...state.unlocked, [payload.lock]: true } };
    case "item_moved":
      return { ...state, itemAt: { ...state.itemAt, [payload.item]: payload.to } };
    case "fact_known":
      return state.known.includes(payload.fact)
        ? state
        : { ...state, known: [...state.known, payload.fact] };
    case "resource_changed": {
      if (payload.resource === "hp") {
        return { ...state, hp: clamp(state.hp + payload.delta, 0, state.hpMax) };
      }
      return { ...state, san: clamp(state.san + payload.delta, 0, state.sanMax) };
    }
    case "flag_set":
      return { ...state, flags: { ...state.flags, [payload.flag]: payload.value } };
    case "npc_moved":
      return { ...state, npcAt: { ...state.npcAt, [payload.npc]: payload.to } };
    case "relationship_established":
      return {
        ...state,
        relationships: { ...state.relationships, [payload.npc]: payload.text },
      };
    case "node_done":
      // 节点编号本身就带 node. 前缀，这里只补一个 .done。
      return {
        ...state,
        flags: { ...state.flags, [`${payload.node}.done`]: true },
      };
    case "action_rejected":
      // 被拒绝的行动同样进事件记录，但它本身不改变任何事实。
      return state;
    case "sheet_applied":
      return {
        ...state,
        hp: payload.hp,
        hpMax: payload.hpMax,
        san: payload.san,
        sanMax: payload.sanMax,
        skills: { ...payload.skills },
        pcName: payload.name,
        pcOccupation: payload.occupation,
        pcCardHash: payload.cardHash,
        ...(payload.characteristics
          ? { characteristics: { ...payload.characteristics } }
          : {}),
        ...(payload.baseSkills ? { baseSkills: { ...payload.baseSkills } } : {}),
        ...(payload.occupationPoints
          ? { occupationPoints: { ...payload.occupationPoints } }
          : {}),
        ...(payload.interestPoints
          ? { interestPoints: { ...payload.interestPoints } }
          : {}),
        ...(payload.lifeHistoryId ? { lifeHistoryId: payload.lifeHistoryId } : {}),
      };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
