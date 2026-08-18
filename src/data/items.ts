export type ItemVerb = "观察" | "检定" | "取走" | "阅读" | "使用";

export type ItemAction = {
  verb: ItemVerb;
  skill?: string;
  dc?: number;
  dc20?: number;
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

export type ItemBacklinks = {
  contained_in: string[];
  related: { kind: "地点" | "事件"; name: string }[];
  enables: string[];
  reveals: string[];
};

export const ITEMS: ItemDef[] = [
  {
    id: "item.desk_lock",
    name: "书桌锁",
    description: "黄铜锁扣，压在桌肚上。钥匙孔很浅，像是常年没上油。",
    at: "loc.study",
    contains: ["item.ledger"],
    takeable: false,
    actions: [
      {
        verb: "观察",
        reveals: ["fact.lock_dc"],
      },
      {
        verb: "检定",
        skill: "开锁",
        dc: 60,
        dc20: 15,
        opens: ["item.ledger"],
      },
    ],
    keeper: {
      notes: "锁本身拿不走。打开后才能取里面的账本。开锁失败且屋里过了三分钟，女房东下楼。",
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
    contains: [],
    takeable: true,
    actions: [
      {
        verb: "观察",
        need: ["item.desk_lock:open"],
      },
      {
        verb: "取走",
        need: ["item.desk_lock:open"],
        take: true,
      },
      {
        verb: "阅读",
        need: ["item.ledger:held"],
        reveals: ["fact.dock_time"],
        resource: { san: -5 },
      },
    ],
    keeper: {
      notes: "开场锁在书桌里。没打开锁时，叙述只能写「锁后似乎有本册子」，不能念夹页。",
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

const BY_ID = new Map(ITEMS.map((item) => [item.id, item]));
const BY_NAME = new Map(ITEMS.map((item) => [item.name, item]));

export function getItem(idOrName: string): ItemDef | null {
  const key = idOrName.trim();
  return BY_ID.get(key) ?? BY_NAME.get(key) ?? null;
}

export function listItems(): ItemDef[] {
  return ITEMS;
}

export function itemBacklinks(id: string): ItemBacklinks {
  const self = getItem(id);
  const contained_in = ITEMS.filter((item) => item.contains.includes(id)).map(
    (item) => item.id,
  );
  const reveals = [...new Set((self?.actions ?? []).flatMap((action) => action.reveals ?? []))];
  return {
    contained_in,
    related: self?.keeper.related ?? [],
    enables: self?.keeper.enables ?? [],
    reveals,
  };
}

export function playerItemView(item: ItemDef) {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    at: item.at,
    contains: item.contains,
    takeable: item.takeable,
    actions: item.actions.map((action) => ({
      verb: action.verb,
      skill: action.skill,
      need: action.need,
    })),
  };
}

export function keeperItemView(item: ItemDef) {
  return {
    ...playerItemView(item),
    actions: item.actions,
    keeper: item.keeper,
    links: itemBacklinks(item.id),
  };
}

export function keeperCatalog() {
  return ITEMS.map(keeperItemView);
}
