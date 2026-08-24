import { pack, type Pack } from "@/engine/pack";
import type { GameEvent } from "@/engine/types";
import type { NarrationReply } from "./contract";

/**
 * 叙述体检。
 *
 * 上下文里没有的人和物，叙述里不许出现；点数只能是这一回合真掷出来的那个。
 * 查出问题就退回这段叙述，按同一个回合编号重讲——重讲不会重掷骰子，
 * 因为骰子早在提交那一刻就定死了。
 */
export type GuardVerdict = { ok: true } | { ok: false; reason: string };
export type NarrationQualityMode = "simple" | "investigation" | "dialogue" | "exploration";

const MAX_LENGTH = 900;

export function checkNarrationQuality(
  reply: NarrationReply,
  mode: NarrationQualityMode,
): GuardVerdict {
  const text = reply.text.trim();
  if (!text) return { ok: false, reason: "empty_text" };
  if (text.length > MAX_LENGTH) return { ok: false, reason: "unsafe_length" };
  if (hasRepeatedPadding(text)) return { ok: false, reason: "repeated_padding" };
  if (mode === "simple") return { ok: true };

  const feedback = normalizeReflection(reply.feedback);
  const reaction = normalizeReflection(reply.reaction);
  if (!feedback) return { ok: false, reason: "missing_feedback" };
  if (!reaction) return { ok: false, reason: "missing_reaction" };
  const interactionPoints = reply.interactionPoints
    .map((point) => point.trim())
    .filter((point) => normalizeReflection(point));
  if (interactionPoints.length === 0) {
    return { ok: false, reason: "missing_interaction_points" };
  }
  const cohesive = normalizeReflection(text);
  if (!cohesive.includes(feedback)) return { ok: false, reason: "feedback_not_reflected" };
  if (!cohesive.includes(reaction)) return { ok: false, reason: "reaction_not_reflected" };
  if (hasMenuInteraction(text, interactionPoints)) {
    return { ok: false, reason: "menu_interaction" };
  }
  if (interactionPoints.some((point) => !cohesive.includes(normalizeReflection(point)))) {
    return { ok: false, reason: "interaction_not_reflected" };
  }
  return { ok: true };
}

function normalizeReflection(text: string): string {
  return text.replace(/[\s，。！？、；：“”‘’（）《》…—,.!?;:'"()[\]{}-]/gu, "");
}

function hasMenuInteraction(text: string, interactionPoints: string[]): boolean {
  const narrativeText = withoutNpcSpeech(text);
  if (/(?:^|\n)\s*(?:\d+[.、)]|[-*•])\s*|你可以选择|选项[：:]/u.test(narrativeText)) {
    return true;
  }
  return interactionPoints.some((point) => {
    const narrativePoint = withoutNpcSpeech(point).trim();
    if (/^(?:\d+[.、)]|[-*•]|你可以|请选择|选项[：:]?|继续(?:追问|询问|调查|查看|尝试)|(?:追问|询问|调查|查看|尝试|选择|决定))/u.test(narrativePoint)) {
      return true;
    }
    if (/接下来(?!的)|下一步|然后\s*请|请你|你可以|你能|不妨|(?:^|[，,；;。！？\n])\s*请/u.test(narrativePoint)) {
      return true;
    }
    return /[，,；;]\s*(?:请|你可以|你能|不妨)?\s*(?:先|再|继续)?\s*(?:调查|查看|询问|追问|选择|前往|行动)[^。！？\n]{0,16}[。！？]?\s*$/u.test(narrativePoint);
  });
}

function withoutNpcSpeech(text: string): string {
  return text
    .replace(/“[^”]*”/gu, "")
    .replace(/‘[^’]*’/gu, "")
    .replace(/"[^"]*"/gu, "")
    .replace(/'[^']*'/gu, "")
    .replace(/(?:低声说|低声道|喊道|回答|提醒|说|问)[：，,][^。！？\n]*/gu, "");
}

function hasRepeatedPadding(text: string): boolean {
  const normalized = normalizeReflection(text);
  if (normalized.length < 40) return false;

  const width = 4;
  const total = normalized.length - width + 1;
  const counts = new Map<string, number>();
  let mostFrequent = 0;
  for (let index = 0; index < total; index += 1) {
    const gram = normalized.slice(index, index + width);
    const count = (counts.get(gram) ?? 0) + 1;
    counts.set(gram, count);
    mostFrequent = Math.max(mostFrequent, count);
  }
  return (
    (mostFrequent >= 4 && mostFrequent / total >= 0.08) ||
    counts.size / total < 0.55
  );
}

export function checkNarration(params: {
  text: string;
  allowedNames: string[];
  events: GameEvent[];
  scenarioPack?: Pack;
  allowedFactIds?: string[];
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

  if (params.allowedFactIds) {
    const allowedFacts = new Set(params.allowedFactIds);
    const npcFacts = new Set(scenarioPack.npcs.flatMap((npc) => npc.knownFacts));
    for (const fact of scenarioPack.facts) {
      if (allowedFacts.has(fact.id)) continue;
      if (fact.visibility !== "secret" && !npcFacts.has(fact.id)) continue;
      if (factPhrases(fact, scenarioPack).some((phrase) => text.includes(phrase))) {
        return { ok: false, reason: "叙述声称了上下文未授权的事实" };
      }
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

function factPhrases(fact: Pack["facts"][number], scenarioPack: Pack): string[] {
  let withoutEntity = fact.title;
  for (const entity of [...scenarioPack.npcs, ...scenarioPack.rooms, ...scenarioPack.items]) {
    withoutEntity = withoutEntity.replaceAll(entity.title, "");
  }
  const stripped = withoutEntity.trim();
  const phrases = stripped.length >= 4 && stripped !== fact.title
    ? [fact.title, stripped, ...fact.guardPhrases]
    : [fact.title, ...fact.guardPhrases];
  return [...new Set(phrases)];
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
