export type ItemVerb = "观察" | "检定" | "取走" | "阅读" | "使用";

export type ItemAction = {
  verb: ItemVerb;
  skill?: string;
  dc?: number;
  need?: string[];
  reveals?: string[];
  opens?: string[];
  take?: boolean;
  resource?: { san?: number };
};

export type ItemDef = {
  id: string;
  name: string;
  description: string;
  at: string;
  atName: string;
  contains: string[];
  takeable: boolean;
  actions: ItemAction[];
  keeper: {
    notes: string;
    secrets: string[];
    enables: string[];
    related: { kind: "地点" | "事件"; name: string }[];
  };
};

export const ITEMS: ItemDef[] = [
  {
    id: "item.desk_lock",
    name: "书桌锁",
    description: "黄铜锁扣，压在桌肚上。钥匙孔很浅，像是常年没上油。",
    at: "loc.study",
    atName: "书房",
    contains: ["item.ledger"],
    takeable: false,
    actions: [
      { verb: "观察", reveals: ["fact.lock_dc"] },
      { verb: "检定", skill: "开锁", dc: 60, opens: ["item.ledger"] },
    ],
    keeper: {
      notes: "锁本身拿不走，打开之后才能取出里面的账本。如果开锁失败、且屋里已经过了三分钟，女房东就会下楼。",
      secrets: [],
      enables: ["取走黑色账本"],
      related: [
        { kind: "地点", name: "书房" },
        { kind: "事件", name: "开锁失败且过三分钟，女房东下楼" },
        { kind: "事件", name: "取走黑色账本" },
      ],
    },
  },
  {
    id: "item.ledger",
    name: "黑色账本",
    description: "黑皮封面，边角磨白。夹页里夹着一张薄纸。",
    at: "loc.study",
    atName: "书房",
    contains: [],
    takeable: true,
    actions: [
      { verb: "观察", need: ["书桌锁已开"] },
      { verb: "取走", need: ["书桌锁已开"], take: true },
      { verb: "阅读", need: ["账本在背包"], reveals: ["fact.dock_time"], resource: { san: -5 } },
    ],
    keeper: {
      notes: "开场时锁在书桌里。锁没有打开之前，叙述只能写「锁后似乎有本册子」，不能念出夹页的内容。",
      secrets: ["港口交易在凌晨三点"],
      enables: ["可去码头"],
      related: [
        { kind: "地点", name: "书房" },
        { kind: "地点", name: "码头" },
        { kind: "事件", name: "读懂交易时间" },
      ],
    },
  },
];

export function backlinks(id: string) {
  const self = ITEMS.find((item) => item.id === id);
  return {
    contained_in: ITEMS.filter((item) => item.contains.includes(id)).map((item) => item.name),
    related: self?.keeper.related ?? [],
    enables: self?.keeper.enables ?? [],
    reveals: [...new Set((self?.actions ?? []).flatMap((action) => action.reveals ?? []))],
  };
}
