export type FieldRow = {
  key: string;
  meaning: string;
  who: string;
  example: string;
};

export type Schema = {
  id: string;
  title: string;
  href: string;
  note: string;
  sample: string;
  fields: FieldRow[];
};

export const schemas: Schema[] = [
  {
    id: "room",
    title: "房间",
    href: "/rooms",
    note: "房间就是地点；人与物在同一时刻只能位于一处。",
    sample: `{
  "id": "loc.study",
  "title": "书房",
  "exits": [{ "to": "loc.hall", "via": "房门" }],
  "contents": ["item.desk_lock", "item.ledger"]
}`,
    fields: [
      { key: "id", meaning: "编号", who: "程序", example: "loc.study" },
      { key: "title", meaning: "名称", who: "界面", example: "书房" },
      { key: "exits", meaning: "出口列表", who: "程序", example: "见出口" },
      { key: "contents", meaning: "开场时容纳的道具编号", who: "程序", example: "item.ledger" },
    ],
  },
  {
    id: "exit",
    title: "出口",
    href: "/rooms",
    note: "从本房间通往另一个房间，可以附带条件。",
    sample: `{ "to": "loc.hall", "via": "房门" }`,
    fields: [
      { key: "to", meaning: "通向哪个房间", who: "程序", example: "loc.hall" },
      { key: "via", meaning: "经过什么", who: "界面", example: "房门" },
      { key: "blocked_unless", meaning: "不满足则过不去", who: "程序", example: "已有钥匙" },
    ],
  },
  {
    id: "item",
    title: "道具",
    href: "/items",
    note: "总表里的一件东西。界面上用名称，程序里用编号。",
    sample: `{
  "id": "item.ledger",
  "name": "黑色账本",
  "description": "黑皮封面，边角磨白。夹页里夹着一张薄纸。",
  "at": "loc.study",
  "contains": [],
  "takeable": true,
  "actions": [
    { "verb": "观察", "need": ["item.desk_lock:open"] },
    { "verb": "取走", "need": ["item.desk_lock:open"], "take": true },
    { "verb": "阅读", "need": ["item.ledger:held"], "reveals": ["fact.dock_time"], "resource": { "san": -5 } }
  ],
  "keeper": {
    "notes": "没打开锁时，不能念夹页。",
    "secrets": ["港口交易在凌晨三点"],
    "enables": ["可去码头"],
    "related": [
      { "kind": "地点", "name": "书房" },
      { "kind": "地点", "name": "码头" },
      { "kind": "事件", "name": "读懂交易时间" }
    ]
  }
}`,
    fields: [
      { key: "id", meaning: "编号", who: "程序", example: "item.ledger" },
      { key: "name", meaning: "名称", who: "双方", example: "黑色账本" },
      { key: "description", meaning: "说明，观察之后给玩家", who: "玩家", example: "黑皮封面…" },
      { key: "at", meaning: "开场位置", who: "程序", example: "loc.study" },
      { key: "contains", meaning: "里面有哪些道具", who: "程序", example: "[]" },
      { key: "takeable", meaning: "能不能拿进背包", who: "程序", example: "true" },
      { key: "actions", meaning: "可做的事", who: "程序、守秘人", example: "见动作" },
      { key: "keeper", meaning: "只给守秘人的备注与相关", who: "守秘人", example: "见守秘人" },
    ],
  },
  {
    id: "action",
    title: "道具动作",
    href: "/items",
    note: "对这件道具能做的一步动作。检定难度写在这里，不由模型报出。",
    sample: `{ "verb": "阅读", "need": ["item.ledger:held"], "reveals": ["fact.dock_time"], "resource": { "san": -5 } }`,
    fields: [
      { key: "verb", meaning: "做什么", who: "双方", example: "观察 / 检定 / 取走 / 阅读 / 使用" },
      { key: "skill", meaning: "用哪项技能", who: "程序", example: "开锁" },
      { key: "dc", meaning: "百分检定难度", who: "程序", example: "60" },
      { key: "dc20", meaning: "二十面检定难度", who: "程序", example: "15" },
      { key: "need", meaning: "先要满足什么", who: "程序", example: "item.desk_lock:open" },
      { key: "reveals", meaning: "做成后揭开哪些线索", who: "程序", example: "fact.dock_time" },
      { key: "opens", meaning: "做成后哪些东西可取", who: "程序", example: "item.ledger" },
      { key: "take", meaning: "是否把本道具放进背包", who: "程序", example: "true" },
      { key: "resource.san", meaning: "理智加减", who: "程序", example: "-5" },
    ],
  },
  {
    id: "keeper",
    title: "守秘人栏",
    href: "/items",
    note: "这一栏不会在玩家对话里念出来，只供模型查表时使用。",
    sample: `{
  "notes": "没打开锁时，不能念夹页。",
  "secrets": ["港口交易在凌晨三点"],
  "enables": ["可去码头"],
  "related": [{ "kind": "地点", "name": "书房" }]
}`,
    fields: [
      { key: "notes", meaning: "备注", who: "守秘人", example: "不能念夹页" },
      { key: "secrets", meaning: "未揭开的秘密", who: "守秘人", example: "港口交易在凌晨三点" },
      { key: "enables", meaning: "做成后能推动什么", who: "守秘人", example: "可去码头" },
      { key: "related", meaning: "相关事件或地点", who: "守秘人", example: "见相关" },
    ],
  },
  {
    id: "related",
    title: "相关事件或地点",
    href: "/items",
    note: "记录这件东西和哪些地点、事件有关。",
    sample: `{ "kind": "事件", "name": "读懂交易时间" }`,
    fields: [
      { key: "kind", meaning: "种类", who: "守秘人", example: "地点 / 事件" },
      { key: "name", meaning: "名称", who: "守秘人", example: "书房、码头、读懂交易时间" },
    ],
  },
  {
    id: "check-in",
    title: "检定提议",
    href: "/tools",
    note: "模型只允许传这三项，不准带上点数或成败。",
    sample: `{
  "who": "林晚",
  "skill": "开锁",
  "target": "书桌锁"
}`,
    fields: [
      { key: "who", meaning: "谁来检定", who: "模型 → 程序", example: "林晚" },
      { key: "skill", meaning: "什么技能", who: "模型 → 程序", example: "开锁" },
      { key: "target", meaning: "对着哪一件，可以留空", who: "模型 → 程序", example: "书桌锁" },
    ],
  },
  {
    id: "check-out",
    title: "检定结果",
    href: "/tools",
    note: "程序掷骰并比对之后交回的结果，界面按这份数据来绘制。",
    sample: `{
  "who": "林晚",
  "skill": "开锁",
  "target": "书桌锁",
  "skillValue": 45,
  "die": "1d100",
  "roll": 42,
  "dc": 60,
  "ok": false,
  "outcome": "failure"
}`,
    fields: [
      { key: "who", meaning: "谁", who: "程序", example: "林晚" },
      { key: "skill", meaning: "技能名", who: "程序", example: "开锁" },
      { key: "target", meaning: "目标", who: "程序", example: "书桌锁" },
      { key: "skillValue", meaning: "卡上的技能值", who: "程序", example: "45" },
      { key: "die", meaning: "用哪颗骰", who: "程序", example: "1d100" },
      { key: "roll", meaning: "掷出的点数", who: "程序", example: "42" },
      { key: "dc", meaning: "难度", who: "程序", example: "60" },
      { key: "ok", meaning: "是否成功", who: "程序", example: "false" },
      { key: "outcome", meaning: "成败字面", who: "程序", example: "failure" },
    ],
  },
  {
    id: "condition",
    title: "条件",
    href: "/conditions",
    note: "逐条对照已经提交的状态来判定；一旦成立，就在同一笔提交里改动状态。",
    sample: `{
  "when": {
    "all": [
      { "check": { "skill": "开锁", "result": "失败" } },
      { "clock": { "id": "house.minutes", "gte": 3 } }
    ]
  },
  "then": [
    { "move": { "who": "npc.landlady", "to": "loc.hall" } },
    { "set_flag": "alarm.raised" }
  ]
}`,
    fields: [
      { key: "when", meaning: "何时成立", who: "程序", example: "见判断" },
      { key: "when.all", meaning: "并且", who: "程序", example: "两条都要" },
      { key: "when.any", meaning: "或者", who: "程序", example: "一条即可" },
      { key: "when.not", meaning: "取反", who: "程序", example: "不成立才算" },
      { key: "check", meaning: "某次检定的结果", who: "程序", example: "开锁失败" },
      { key: "clock", meaning: "时间是否已过", who: "程序", example: "已过三分钟" },
      { key: "then", meaning: "成立后改什么", who: "程序", example: "见改动" },
      { key: "move", meaning: "谁到哪", who: "程序", example: "女房东到门厅" },
      { key: "set_flag", meaning: "加上哪条标记", who: "程序", example: "alarm.raised" },
    ],
  },
  {
    id: "story",
    title: "关键情节",
    href: "/story",
    note: "剧情不是一段长文，而是若干情节及其状态。",
    sample: `{
  "id": "read_ledger",
  "title": "读懂交易时间",
  "status": "available",
  "ready_when": "背包里有账本",
  "done_then": ["fact.dock_time", "ending.can_go_docks"]
}`,
    fields: [
      { key: "id", meaning: "编号", who: "程序", example: "read_ledger" },
      { key: "title", meaning: "名称", who: "界面", example: "读懂交易时间" },
      { key: "status", meaning: "状态", who: "双方", example: "locked / available / done / failed / replaced" },
      { key: "ready_when", meaning: "何时可进行", who: "程序", example: "背包里有账本" },
      { key: "done_then", meaning: "完成后记下什么", who: "程序", example: "可去码头" },
    ],
  },
  {
    id: "save",
    title: "存档",
    href: "/save",
    note: "能够接着玩的那一份数据；只有聊天记录不能作为正式读档。",
    sample: `{
  "scenario": "寄宿公寓账本",
  "turn": 4,
  "state": {
    "pc_location": "loc.study",
    "hp": 11,
    "san": 60,
    "inventory": ["item.ledger"],
    "flags": ["alarm.raised", "study_unlocked", "ending.can_go_docks"],
    "known_facts": ["fact.lock_dc", "fact.dock_time"],
    "clock": { "house.minutes": 6 },
    "item_at": { "item.ledger": "inv.pc" },
    "npc_at": { "npc.landlady": "loc.hall" }
  },
  "events": [
    { "id": 1, "type": "move", "from": "loc.hall", "to": "loc.study" },
    { "id": 2, "type": "check", "skill": "开锁", "roll": 42, "dc": 60, "ok": false }
  ]
}`,
    fields: [
      { key: "scenario", meaning: "剧本名", who: "双方", example: "寄宿公寓账本" },
      { key: "turn", meaning: "回合", who: "程序", example: "4" },
      { key: "state", meaning: "当前状态", who: "程序", example: "见下" },
      { key: "state.pc_location", meaning: "调查员在哪", who: "程序", example: "loc.study" },
      { key: "state.hp", meaning: "生命值", who: "双方", example: "11" },
      { key: "state.san", meaning: "理智", who: "双方", example: "60" },
      { key: "state.inventory", meaning: "背包", who: "双方", example: "item.ledger" },
      { key: "state.flags", meaning: "标记", who: "程序", example: "alarm.raised" },
      { key: "state.known_facts", meaning: "已知线索", who: "双方", example: "fact.dock_time" },
      { key: "state.clock", meaning: "时间", who: "程序", example: "已过 6 分钟" },
      { key: "state.item_at", meaning: "每件道具在哪", who: "程序", example: "账本在背包" },
      { key: "state.npc_at", meaning: "每个人在哪", who: "程序", example: "女房东在门厅" },
      { key: "events", meaning: "只追加的事件记录", who: "程序", example: "见事件" },
    ],
  },
  {
    id: "event",
    title: "事件记录",
    href: "/save",
    note: "每一条都只追加、不改写；摘要必须引用编号。",
    sample: `{ "id": 2, "type": "check", "skill": "开锁", "roll": 42, "dc": 60, "ok": false }`,
    fields: [
      { key: "id", meaning: "编号", who: "程序", example: "2" },
      { key: "type", meaning: "种类", who: "程序", example: "move / check / trigger / item_moved / fact_known / resource" },
      { key: "from / to", meaning: "从哪到哪", who: "程序", example: "门厅 → 书房" },
      { key: "skill / roll / dc / ok", meaning: "检定细节", who: "程序", example: "开锁 42 / 60 失败" },
      { key: "item", meaning: "哪件道具", who: "程序", example: "item.ledger" },
      { key: "fact", meaning: "哪条线索", who: "程序", example: "fact.dock_time" },
      { key: "san", meaning: "理智变化", who: "程序", example: "-5" },
    ],
  },
  {
    id: "switch",
    title: "事件开关",
    href: "/switches",
    note: "全局的真假值，只有开和关两种，与 RPG Maker 的开关相同。",
    sample: `{
  "id": "sw.alarm",
  "name": "女房东已警戒",
  "on": false
}`,
    fields: [
      { key: "id", meaning: "编号", who: "程序", example: "sw.alarm" },
      { key: "name", meaning: "名称", who: "界面、守秘人", example: "女房东已警戒" },
      { key: "on", meaning: "开还是关", who: "程序", example: "false" },
    ],
  },
  {
    id: "self-switch",
    title: "独立开关",
    href: "/switches",
    note: "只属于某一个事件，与 RPG Maker 的独立开关 A／B／C／D 相同。",
    sample: `{
  "event": "ev.desk",
  "slot": "A",
  "on": true
}`,
    fields: [
      { key: "event", meaning: "属于哪个事件", who: "程序", example: "ev.desk" },
      { key: "slot", meaning: "哪一格", who: "程序", example: "A / B / C / D" },
      { key: "on", meaning: "开还是关", who: "程序", example: "true" },
    ],
  },
  {
    id: "variable",
    title: "变量",
    href: "/switches",
    note: "一个数字，与 RPG Maker 的变量相同，用来记录时间或次数。",
    sample: `{
  "id": "var.minutes",
  "name": "屋里过了几分钟",
  "value": 3
}`,
    fields: [
      { key: "id", meaning: "编号", who: "程序", example: "var.minutes" },
      { key: "name", meaning: "名称", who: "界面", example: "屋里过了几分钟" },
      { key: "value", meaning: "当前数字", who: "程序", example: "3" },
    ],
  },
  {
    id: "event-page",
    title: "事件页",
    href: "/switches",
    note: "同一个事件可以有多页；在出现条件都满足的那些页里，页码最大的一页生效，这一点与 RPG Maker 相同。",
    sample: `{
  "event": "ev.landlady",
  "page": 2,
  "when": { "switch": "sw.alarm", "on": true },
  "at": "loc.hall",
  "description": "站在门厅警戒"
}`,
    fields: [
      { key: "event", meaning: "属于哪个事件", who: "程序", example: "ev.landlady" },
      { key: "page", meaning: "页码，大的优先", who: "程序", example: "2" },
      { key: "when", meaning: "出现条件", who: "程序", example: "开关开着" },
      { key: "when.switch", meaning: "要看哪一只事件开关", who: "程序", example: "sw.alarm" },
      { key: "when.self", meaning: "要看哪一格独立开关", who: "程序", example: "A" },
      { key: "when.variable", meaning: "变量要达到多少", who: "程序", example: "var.minutes >= 3" },
      { key: "when.item", meaning: "是否持有某道具", who: "程序", example: "item.ledger" },
      { key: "at", meaning: "这一页人在哪", who: "程序", example: "loc.hall" },
      { key: "description", meaning: "内容描述", who: "守秘人", example: "站在门厅警戒" },
    ],
  },
];

export function schemaById(id: string): Schema | undefined {
  return schemas.find((schema) => schema.id === id);
}
