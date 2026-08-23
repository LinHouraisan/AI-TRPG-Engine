export type GameState = {
  /** 每提交一次加一。叙述只能引用某一个版本上的事实。 */
  version: number;
  turn: number;
  /** 团内时间，单位是分钟 */
  clock: number;
  pcAt: string;
  npcAt: Record<string, string>;
  /** 房间编号，或者 inv.pc 表示在背包里 */
  itemAt: Record<string, string>;
  unlocked: Record<string, boolean>;
  observed: Record<string, boolean>;
  visited: Record<string, boolean>;
  flags: Record<string, boolean>;
  known: string[];
  hp: number;
  hpMax: number;
  san: number;
  sanMax: number;
  skills: Record<string, number>;
  /** Set only after a confirmed character-card write. Absent on gold path. */
  pcName?: string;
  pcOccupation?: string;
  pcCardHash?: string;
  characteristics?: Record<"STR" | "CON" | "SIZ" | "DEX" | "APP" | "INT" | "POW" | "EDU", number>;
  baseSkills?: Record<string, number>;
  occupationPoints?: Record<string, number>;
  interestPoints?: Record<string, number>;
  lifeHistoryId?: string;
  relationships?: Record<string, string>;
};

export type CheckResult = {
  skill: string;
  skillValue: number;
  difficulty: "regular" | "hard" | "extreme";
  threshold: number;
  roll: number;
  level: "大成功" | "极难成功" | "困难成功" | "成功" | "失败" | "大失败";
  ok: boolean;
};

/**
 * 事件载荷一律是纯数据，可以直接 JSON 序列化。
 * 只有这样，存档、读档和重放才是真的，而不是靠叙述凑出来的。
 */
export type EventPayload =
  | { type: "moved"; to: string; via: string; minutes: number }
  | { type: "observed"; item: string }
  | { type: "check_resolved"; target: string; check: CheckResult; minutes: number }
  | { type: "lock_opened"; lock: string }
  | { type: "item_moved"; item: string; from: string; to: string }
  | { type: "fact_known"; fact: string }
  | { type: "resource_changed"; resource: "hp" | "san"; delta: number }
  | { type: "flag_set"; flag: string; value: boolean }
  | { type: "npc_moved"; npc: string; to: string }
  | { type: "relationship_established"; npc: string; text: string }
  | { type: "node_done"; node: string }
  | { type: "action_rejected"; reason: string }
  | {
      type: "sheet_applied";
      name: string;
      occupation: string;
      hp: number;
      hpMax: number;
      san: number;
      sanMax: number;
      skills: Record<string, number>;
      cardHash: string;
      characteristics?: Record<"STR" | "CON" | "SIZ" | "DEX" | "APP" | "INT" | "POW" | "EDU", number>;
      baseSkills?: Record<string, number>;
      occupationPoints?: Record<string, number>;
      interestPoints?: Record<string, number>;
      lifeHistoryId?: string;
    };

export type EventType = EventPayload["type"];

/** 还没提交的候选变化。由程序生成，模型不许直接产出。 */
export type EventDraft = {
  payload: EventPayload;
  /** 写进事件记录的中文摘要，玩家在日志里看到的就是这一句 */
  summary: string;
  visibility?: "public" | "secret";
  /** 这条变化是谁引起的：玩家行动、条件、还是剧本运行时 */
  cause: string;
  /** 作者在资料包里写好的叙述。留空则由主持人自己组织语言 */
  narration?: string;
};

/** 已提交的事件。只追加，不可原地修改，也不可删除。 */
export type GameEvent = EventDraft & {
  id: string;
  seq: number;
  turnId: string;
  versionAfter: number;
  clock: number;
  visibility: "public" | "secret";
};

/** 查询是问「我现在知道什么」，不是行动：不掷骰、不提交、也不走团内时间。 */
export type QueryTopic = "inventory" | "sheet" | "clues" | "time" | "exits" | "recap";

export type Intent =
  | { kind: "move"; to: string }
  | { kind: "observe"; target: string }
  | { kind: "unlock"; lock: string }
  | { kind: "take"; item: string }
  | { kind: "read"; item: string }
  | { kind: "talk"; text: string }
  | { kind: "free_action"; text: string }
  | { kind: "query"; topic: QueryTopic }
  | { kind: "unclear"; text: string };

export type Suggestion = {
  label: string;
  intent: Intent;
};

/** 一个回合的处理结果：先裁定、先提交，然后才轮到叙述。 */
export type TurnOutcome = {
  drafts: EventDraft[];
  narration: string;
  check?: CheckResult;
  /** 追问：既不掷骰也不提交 */
  clarification?: string;
};
