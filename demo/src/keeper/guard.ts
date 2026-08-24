import { pack, type Pack } from "@/engine/pack";
import type { GameEvent } from "@/engine/types";

/**
 * 叙述体检。
 *
 * 上下文里没有的人和物，叙述里不许出现；点数只能是这一回合真掷出来的那个。
 * 查出问题就退回这段叙述，按同一个回合编号重讲——重讲不会重掷骰子，
 * 因为骰子早在提交那一刻就定死了。
 */
export type GuardVerdict = { ok: true } | { ok: false; reason: string };

const MAX_LENGTH = 900;

export function checkNarration(params: {
  text: string;
  allowedNames: string[];
  events: GameEvent[];
  scenarioPack?: Pack;
}): GuardVerdict {
  const text = params.text.trim();

  if (text.length === 0) return { ok: false, reason: "叙述是空的" };
  if (text.length > MAX_LENGTH) return { ok: false, reason: `叙述太长（${text.length} 字）` };

  // 资料包里存在、但这一刻玩家感知不到的专有名词，一个都不许出现。
  const allowed = new Set(params.allowedNames);
  const scenarioPack = params.scenarioPack ?? pack;
  const known = [
    ...scenarioPack.rooms.map((r) => r.title),
    ...scenarioPack.items.map((i) => i.title),
    ...scenarioPack.npcs.map((n) => n.title),
  ];
  for (const name of known) {
    if (allowed.has(name)) continue;
    if (text.includes(name)) {
      return { ok: false, reason: `叙述提到了这一刻不该出现的「${name}」` };
    }
  }

  // 这一回合掷出来的点数是唯一允许出现的数字组合。
  const rolled = params.events
    .map((event) => (event.payload.type === "check_resolved" ? event.payload.check : undefined))
    .filter((check) => check != null);
  if (rolled.length === 0) {
    const stray = text.match(/\d{1,3}\s*点?(?=[，。、％%]|$)/);
    if (stray && /^\d+$/.test(stray[0].replace(/[^\d]/g, ""))) {
      const value = Number(stray[0].replace(/[^\d]/g, ""));
      if (value > 1) return { ok: false, reason: `这一回合没有掷骰，叙述却报出了数字 ${value}` };
    }
  } else {
    const allowedNumbers = new Set<number>();
    for (const check of rolled) {
      allowedNumbers.add(check.roll);
      allowedNumbers.add(check.threshold);
      allowedNumbers.add(check.skillValue);
    }
    for (const match of text.matchAll(/\d{1,3}/g)) {
      const value = Number(match[0]);
      if (value > 1 && !allowedNumbers.has(value)) {
        return { ok: false, reason: `叙述报出了没有掷出来的数字 ${value}` };
      }
    }
  }

  if (/作为(守秘人|KP|主持人)|as an ai|我是一个/i.test(text)) {
    return { ok: false, reason: "叙述里出现了出戏的自称" };
  }

  const claim = checkClaims(text, params.events);
  if (claim) return { ok: false, reason: claim };

  return { ok: true };
}

/**
 * 模型很爱替玩家把动作做完：只是看了一眼账本，它写成「你拿起账本翻开」。
 * 事实里没有对应的事件，这句话就不能出口——玩家会当真，然后接着往下玩。
 */
function checkClaims(text: string, events: GameEvent[]): string | undefined {
  const took = events.some(
    (event) => event.payload.type === "item_moved" && event.payload.to === "inv.pc",
  );
  const read = events.some(
    (event) =>
      event.payload.type === "fact_known" ||
      (event.payload.type === "flag_set" && event.payload.flag.endsWith(".read")),
  );
  const opened = events.some((event) => event.payload.type === "lock_opened");
  const moved = events.some((event) => event.payload.type === "moved");

  const claims: { words: RegExp; done: boolean; reason: string }[] = [
    {
      words: /拿起|拿走|捡起|收进|塞进|揣进|放进(背包|口袋|内袋)/,
      done: took,
      reason: "叙述说玩家把东西拿到了手上，但这一回合没有道具进背包",
    },
    {
      words: /翻开|翻到|读到|念出|字迹|夹页/,
      done: read,
      reason: "叙述说玩家读到了内容，但这一回合没有得到任何线索",
    },
    {
      words: /锁开了|打开了锁|撬开了|锁芯让开/,
      done: opened,
      reason: "叙述说锁开了，但这一回合没有开锁事件",
    },
    {
      words: /你走进|你穿过|你来到|推开门/,
      done: moved,
      reason: "叙述说玩家换了地方，但这一回合没有移动事件",
    },
  ];

  for (const claim of claims) {
    if (claim.words.test(text) && !claim.done) return claim.reason;
  }
  return undefined;
}
