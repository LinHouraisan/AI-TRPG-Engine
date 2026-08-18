// 模组资料包：《寄宿公寓账本》
// 这里只放「定义」，团内会变的东西一律进状态库，见 engine/state.ts。
// 权威说明以 handbook/ 为准，这份文件是它可运行的摘录。

export type RoomDef = {
  id: string;
  title: string;
  /** 玩家第一次进来时听到的话 */
  intro: string;
  exits: { to: string; via: string }[];
};

export type ItemDef = {
  id: string;
  title: string;
  /** 玩家嘴里可能怎么称呼它。路由只做保守匹配，别名要写全 */
  aliases?: string[];
  /** 观察之后才给玩家看的说明 */
  observed: string;
  /** 只给守秘人看，永远不进玩家可见的上下文 */
  keeperNote?: string;
  /** 这件道具能不能被取走 */
  portable?: boolean;
  /** 取走之前必须先解开哪把锁 */
  lockedBy?: string;
};

export type LockDef = {
  id: string;
  title: string;
  skill: string;
  difficulty: "regular" | "hard" | "extreme";
  /** 解开之后放出哪件道具 */
  opens: string;
};

export type FactDef = {
  id: string;
  title: string;
  visibility: "public" | "secret";
};

export type StoryNodeDef = {
  id: string;
  title: string;
  /** 满足这些条件就算完成，由剧本运行时判定，不由主持人随口说 */
  doneWhen: (flags: Record<string, boolean>) => boolean;
};

export type InvestigatorDef = {
  id: string;
  name: string;
  occupation: string;
  hp: number;
  san: number;
  skills: Record<string, number>;
  startAt: string;
};

export const rooms: RoomDef[] = [
  {
    id: "loc.hall",
    title: "门厅",
    intro: "门厅的挂钟停在九点。墙纸上有一圈水渍，楼梯往上没有灯。",
    exits: [
      { to: "loc.study", via: "房门" },
      { to: "loc.landing", via: "楼梯" },
    ],
  },
  {
    id: "loc.study",
    title: "书房",
    intro: "窗帘没拉开。写字台上压着一把黄铜锁，锁后面像是塞着一本册子。",
    exits: [{ to: "loc.hall", via: "房门" }],
  },
  {
    id: "loc.landing",
    title: "楼梯平台",
    intro: "平台上摆着一张藤椅，椅子上搁着没织完的毛衣，针还插在上面。",
    exits: [{ to: "loc.hall", via: "楼梯" }],
  },
];

export const items: Record<string, ItemDef> = {
  "item.desk_lock": {
    id: "item.desk_lock",
    title: "书桌锁",
    aliases: ["锁", "挂锁", "黄铜锁", "书桌", "写字台"],
    observed: "一把黄铜挂锁，锁体发黑，锁孔边缘有新划痕——最近有人动过。",
    keeperNote: "女房东每天擦一次锁，划痕是她自己留下的。",
  },
  "item.ledger": {
    id: "item.ledger",
    title: "黑色账本",
    aliases: ["账本", "本子", "册子", "黑账本"],
    observed: "硬壳账本，边角磨得发白，中间夹着一张对折的纸。",
    keeperNote: "夹页写着码头交易的时间，读到就掉 5 点理智。",
    portable: true,
    lockedBy: "lock.desk",
  },
};

export const locks: Record<string, LockDef> = {
  "lock.desk": {
    id: "lock.desk",
    title: "书桌锁",
    skill: "开锁",
    difficulty: "regular",
    opens: "item.ledger",
  },
};

export const facts: Record<string, FactDef> = {
  "fact.lock_scratched": { id: "fact.lock_scratched", title: "锁孔有新划痕，最近有人开过", visibility: "public" },
  "fact.dock_time": { id: "fact.dock_time", title: "码头的交易在凌晨三点", visibility: "secret" },
};

/** 每间房里摆着哪些道具（团开始时的初始位置） */
export const itemPlacement: Record<string, string> = {
  "item.desk_lock": "loc.study",
  "item.ledger": "loc.study",
};

export const npcs: Record<string, { id: string; title: string; startAt: string }> = {
  "npc.landlady": { id: "npc.landlady", title: "女房东", startAt: "loc.landing" },
};

export const storyNodes: StoryNodeDef[] = [
  {
    id: "node.open_desk",
    title: "打开写字台",
    doneWhen: (flags) => Boolean(flags["lock.desk.open"]),
  },
  {
    id: "node.read_ledger",
    title: "读懂交易时间",
    doneWhen: (flags) => Boolean(flags["ledger.read"]),
  },
];

export const investigator: InvestigatorDef = {
  id: "pc.linwan",
  name: "林晚",
  occupation: "记者",
  hp: 11,
  san: 65,
  skills: {
    开锁: 45,
    侦查: 60,
    图书馆使用: 70,
    话术: 55,
    聆听: 50,
  },
  startAt: "loc.hall",
};

export const packVersion = "boarding-house@0.1.0";
