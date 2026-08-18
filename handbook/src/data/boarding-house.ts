export type Predicate =
  | { has_item: string; who: string }
  | { at: string; who: string }
  | { resource: string; who: string; lte?: number; gte?: number }
  | { flag: string }
  | { fact_known: string; known_by: string }
  | { clock: string; gte: number }
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate };

export type LocationDef = {
  id: string;
  title: string;
  exits: { to: string; via: string; blocked_unless?: Predicate }[];
  contents: string[];
};

export const locations: LocationDef[] = [
  {
    id: "loc.hall",
    title: "门厅",
    exits: [
      { to: "loc.study", via: "房门" },
      { to: "loc.landing", via: "楼梯" },
    ],
    contents: [],
  },
  {
    id: "loc.study",
    title: "书房",
    exits: [{ to: "loc.hall", via: "房门" }],
    contents: ["item.desk_lock", "item.ledger"],
  },
  {
    id: "loc.landing",
    title: "楼梯平台",
    exits: [{ to: "loc.hall", via: "楼梯" }],
    contents: [],
  },
];

export const items = {
  "item.ledger": { title: "黑色账本", at: "loc.study" },
  "item.desk_lock": { title: "书桌锁", at: "loc.study" },
};

export const facts = {
  "fact.lock_dc": { title: "书桌锁很难开", visibility: "public" },
  "fact.dock_time": { title: "港口交易在凌晨三点", visibility: "secret" },
  "fact.landlady_knows": { title: "女房东已经知情", visibility: "secret" },
};

export type ItemAction = {
  verb: "观察" | "检定" | "取走" | "阅读" | "无";
  target: string;
  skill?: string;
  roll?: number;
  dc?: number;
  ok?: boolean;
  result: string;
};

export type Beat = {
  label: string;
  narration: string;
  pc: string;
  landlady: string;
  ledger: string;
  lock: "hidden" | "locked" | "failed" | "open" | "empty";
  san: number;
  hp: number;
  flags: string[];
  known: string[];
  clock: number;
  log: string;
  action: ItemAction;
};

export const beats: Beat[] = [
  {
    label: "开场",
    narration: "门厅的钟停在九点。女房东在楼梯口织毛衣。",
    pc: "loc.hall",
    landlady: "loc.landing",
    ledger: "loc.study",
    lock: "hidden",
    san: 65,
    hp: 11,
    flags: [],
    known: [],
    clock: 0,
    log: "回合 0 · 开场。调查员在门厅。",
    action: { verb: "无", target: "", result: "这一步不对道具动手。" },
  },
  {
    label: "进入书房",
    narration: "你推开书房门。桌上有一把锁，锁后似乎压着本册子。",
    pc: "loc.study",
    landlady: "loc.landing",
    ledger: "loc.study",
    lock: "locked",
    san: 65,
    hp: 11,
    flags: [],
    known: ["fact.lock_dc"],
    clock: 1,
    log: "回合 1 · 观察书桌锁。位置不变，记下一条线索。",
    action: {
      verb: "观察",
      target: "书桌锁",
      result: "已知线索：书桌锁很难开。锁和账本都还留在书房。",
    },
  },
  {
    label: "撬锁失败",
    narration: "锁芯一响。楼上织针停了片刻。账本仍在桌里。",
    pc: "loc.study",
    landlady: "loc.landing",
    ledger: "loc.study",
    lock: "failed",
    san: 65,
    hp: 11,
    flags: [],
    known: ["fact.lock_dc"],
    clock: 3,
    log: "回合 2 · 对书桌锁做开锁检定，失败，账本位置未变。",
    action: {
      verb: "检定",
      target: "书桌锁",
      skill: "开锁",
      roll: 42,
      dc: 60,
      ok: false,
      result: "检定失败，锁仍然锁着，因此取不走账本。",
    },
  },
  {
    label: "女房东下楼",
    narration: "脚步下楼。女房东站在门厅，朝书房看了一眼。",
    pc: "loc.study",
    landlady: "loc.hall",
    ledger: "loc.study",
    lock: "failed",
    san: 65,
    hp: 11,
    flags: ["alarm.raised"],
    known: ["fact.lock_dc"],
    clock: 3,
    log: "回合 2 · 条件满足：开锁失败且已过三分钟 → 女房东到门厅警戒。",
    action: { verb: "无", target: "", result: "这一步是条件改变了人的位置，并不是对道具动手。" },
  },
  {
    label: "再次开锁并取走账本",
    narration: "锁开了。你把黑色账本塞进外套。",
    pc: "loc.study",
    landlady: "loc.hall",
    ledger: "inv.pc",
    lock: "empty",
    san: 65,
    hp: 11,
    flags: ["alarm.raised", "study_unlocked"],
    known: ["fact.lock_dc"],
    clock: 5,
    log: "回合 3 · 开锁成功，随后取走账本。",
    action: {
      verb: "取走",
      target: "黑色账本",
      skill: "开锁",
      roll: 18,
      dc: 60,
      ok: true,
      result: "先检定成功把锁打开，再把账本从书房转移到背包。",
    },
  },
  {
    label: "读懂交易时间",
    narration: "账本夹页写着：码头，凌晨三点。",
    pc: "loc.study",
    landlady: "loc.hall",
    ledger: "inv.pc",
    lock: "empty",
    san: 60,
    hp: 11,
    flags: ["alarm.raised", "study_unlocked", "ending.can_go_docks"],
    known: ["fact.lock_dc", "fact.dock_time"],
    clock: 6,
    log: "回合 4 · 阅读背包里的账本。理智 −5。",
    action: {
      verb: "阅读",
      target: "黑色账本",
      result: "已知线索：港口交易在凌晨三点。理智 65 → 60。",
    },
  },
];
