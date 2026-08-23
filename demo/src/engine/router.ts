import { pack, packIndex } from "./pack";
import { locksInRoom } from "./state";
import type { GameState, Intent, QueryTopic } from "./types";

/**
 * 回合路由：把玩家那句白话，保守地匹配成一个意图。
 * 宁可匹配不上、转去追问，也不能靠几个关键词就猜着执行。
 * 真正接上模型之后，这里只处理 1、2 级快路径，含糊的一律交给主持人澄清。
 */

const MOVE_WORDS = ["去", "进", "走", "回", "推开", "上", "下", "前往", "离开"];
const OBSERVE_WORDS = ["看", "观察", "检查", "查看", "打量", "瞧"];
const UNLOCK_WORDS = ["撬", "开锁", "解锁", "开开", "撬开", "打开"];
const TAKE_WORDS = ["拿", "取", "收", "装", "塞", "捡", "带走"];
const READ_WORDS = ["读", "翻", "阅读", "念"];
const CONTENT_WORDS = ["里有什么", "里写", "写着什么", "写了什么", "上面写", "内容"];
const TALK_WORDS = ["问", "说", "聊", "喊", "打招呼", "搭话"];

/** 查询规则必须排在「看／去／问」前面，否则「查看背包」会被观察抢走。 */
const QUERY_RULES: { topic: QueryTopic; words: string[] }[] = [
  {
    topic: "recap",
    words: [
      "刚才发生了什么",
      "刚刚发生了什么",
      "之前发生了什么",
      "刚才怎么了",
      "回顾",
      "捋一捋",
      "前情提要",
      "到目前为止",
    ],
  },
  {
    topic: "sheet",
    words: [
      "人物卡",
      "调查员卡",
      "角色卡",
      "我的属性",
      "我的技能",
      "我的数值",
      "技能表",
      "理智还剩多少",
      "还剩多少理智",
      "我还剩多少理智",
      "理智值",
      "生命值",
      "还剩多少生命",
      "我的生命",
    ],
  },
  {
    topic: "clues",
    words: [
      "线索",
      "我知道些什么",
      "知道些什么",
      "我知道什么",
      "知道了什么",
      "查到了什么",
      "查到什么",
      "发现了什么",
      "掌握了什么",
      "记下了什么",
    ],
  },
  {
    topic: "time",
    words: [
      "几点了",
      "现在几点",
      "过了多久",
      "过了多少时间",
      "过了几分钟",
      "过了多少分钟",
      "团内时间",
      "现在什么时候",
      "时间过了多久",
    ],
  },
  {
    topic: "exits",
    words: [
      "出口",
      "怎么走",
      "路怎么走",
      "能去哪",
      "能去哪儿",
      "能去哪里",
      "可以去哪",
      "可以去哪儿",
      "可以去哪里",
      "有哪些门",
      "有几扇门",
      "有哪几扇门",
      "通向哪",
      "通向哪里",
      "通往哪",
      "通往哪里",
    ],
  },
  {
    topic: "inventory",
    words: [
      "背包",
      "包里",
      "口袋",
      "身上带了什么",
      "身上带着什么",
      "身上有什么",
      "带了什么",
      "带了哪些",
      "翻翻包",
      "摸摸口袋",
    ],
  },
];

const INVENTORY_LOOSE = ["有什么东西", "有哪些东西", "有些什么", "有啥", "我有什么"];
const LOOKING_AROUND = ["四周", "周围", "房间"];
const ROOM_OBSERVATIONS = [
  "看看四周", "查看四周", "观察四周", "打量四周", "瞧瞧四周",
  "看看周围", "查看周围", "观察周围", "打量周围", "瞧瞧周围",
  "看看房间", "查看房间", "观察房间", "打量房间", "瞧瞧房间",
];

function hit(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

/** 玩家提到的是不是这件道具：本名或者资料包里写的别名，命中一个就算。 */
function mentions(text: string, itemId: string): boolean {
  const item = packIndex.item(itemId);
  if (!item) return false;
  return hit(text, [item.title, ...item.aliases]);
}

export function route(text: string, state: GameState): Intent {
  const input = text.trim();
  if (!input) return { kind: "unclear", text };

  const room = packIndex.room(state.pcAt);
  const query = matchQuery(input);
  if (query) return { kind: "query", topic: query };

  // 移动：目标必须是当前房间的某个出口，或者出口本身的名字（房门、楼梯）。
  if (hit(input, MOVE_WORDS) && room) {
    const exits = room.exits.filter((exit) => {
      const target = packIndex.room(exit.to);
      return (target && input.includes(target.title)) || input.includes(exit.via);
    });
    if (exits.length === 1) return { kind: "move", to: exits[0].to };
    if (exits.length > 1) return { kind: "unclear", text };
  }

  // 玩家嘴里叫得出名字的东西，路由就该认出来；至于它在不在这儿、够不够得着，
  // 交给裁定去说。把「不在场」当成「听不懂」，只会让玩家一头雾水。
  const named = pack.items.filter((item) => mentions(input, item.id)).map((item) => item.id);

  // 阅读要排在观察前面：「读账本」和「看账本」想做的事情不一样。
  // 「账本里有什么」问的也是内容，不是背包，所以同样算阅读。
  if ((hit(input, READ_WORDS) || hit(input, CONTENT_WORDS)) && named.length === 1) {
    return { kind: "read", item: named[0] };
  }

  if (hit(input, UNLOCK_WORDS)) {
    const candidates = locksInRoom(state.pcAt).filter(
      (lock) => input.includes(lock.title) || input.includes("锁"),
    );
    if (candidates.length === 1) return { kind: "unlock", lock: candidates[0].id };
  }

  if (hit(input, TAKE_WORDS) && named.length === 1) {
    return { kind: "take", item: named[0] };
  }

  if (hit(input, OBSERVE_WORDS)) {
    if (named.length === 1) return { kind: "observe", target: named[0] };
    // 「看看四周」这类，就当成观察房间本身
    if (named.length === 0 && ROOM_OBSERVATIONS.includes(input.replace(/^我(?:先|想)?/, ""))) {
      return { kind: "observe", target: state.pcAt };
    }
  }

  if (hit(input.replaceAll("问题", ""), TALK_WORDS)) {
    const people = pack.npcs.filter((npc) => input.includes(npc.title));
    if (people.length <= 1) return { kind: "talk", text: input };
  }

  return { kind: "unclear", text: input };
}

function matchQuery(input: string): QueryTopic | undefined {
  for (const rule of QUERY_RULES) {
    if (!hit(input, rule.words)) continue;
    // 「把账本收进包里」带了「包里」，但仍是拿取，不能当成翻背包。
    if (rule.topic === "inventory" && looksLikeTake(input)) continue;
    return rule.topic;
  }
  // 「我有啥」问的是背包；可一旦他点了名（「书桌上有啥」），那就不是翻包了。
  const namesSomething = pack.items.some((item) => mentions(input, item.id));
  if (hit(input, INVENTORY_LOOSE) && !hit(input, LOOKING_AROUND) && !namesSomething) {
    return "inventory";
  }
  return undefined;
}

function looksLikeTake(input: string): boolean {
  if (!hit(input, TAKE_WORDS)) return false;
  // 认的是「他提到了某件东西」，不是「那件东西此刻在不在」。
  return pack.items.some((item) => mentions(input, item.id));
}
