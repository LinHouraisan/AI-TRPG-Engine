/**
 * 主持人契约测试。
 *
 * 前半段把模型换成一只故意乱说的假模型：不给 JSON、编造人和物、报出没掷过的点数、
 * 挑一个不在场的编号。要证明的是——不管它怎么说，事件记录和状态一步都不受影响。
 * 后半段如果连得上真机，就跑两个回合看看实际效果。
 *
 * 运行：cd demo && bun run keeper:check
 */
import { pack } from "@/engine/pack";
import { narrate } from "@/engine/narrate";
import { resolveIntent } from "@/engine/resolve";
import { commit, stateHash } from "@/engine/runtime";
import { initialState, isHidden } from "@/engine/state";
import type { EventPayload, GameEvent, GameState } from "@/engine/types";
import {
  DEFAULT_CONTEXT_BUDGET_CHARS,
  defaultConfig,
  type KeeperConfig,
} from "@/keeper/config";
import {
  buildContext,
  CONTEXT_COLUMN_NAMES,
  CONTEXT_OMISSION,
  type ContextColumnName,
  type KeeperContext,
} from "@/keeper/context";
import {
  keeperNarrate,
  keeperRoute,
  type NarrationStreamEvent,
} from "@/keeper/keeper";

const realFetch = globalThis.fetch;
let passed = 0;

function assert(ok: boolean, label: string) {
  if (!ok) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✓ ${label}`);
}

/** 把假模型的回复塞进 fetch，askKeeper 那一层完全不知情。 */
function fakeModel(content: string | null) {
  globalThis.fetch = (async () => {
    if (content === null) {
      return new Response("boom", { status: 500 });
    }
    return new Response(JSON.stringify({ message: { content } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function structuredNarration(text: string): string {
  return JSON.stringify({
    text,
    feedback: text,
    reaction: text,
    interactionPoints: [text],
  });
}

/**
 * 模拟 Ollama 的 NDJSON 流。pieces 是模型 JSON 的增量碎片。
 * hangUpAfter 表示发出这么多片之后把连接掐断——用来证明半截叙述不会定稿。
 */
function fakeModelStream(params: { pieces: string[]; hangUpAfter?: number }) {
  globalThis.fetch = (async () => {
    const encoder = new TextEncoder();
    let i = 0;
    let sentDone = false;
    const stream = new ReadableStream<Uint8Array>({
      // 用 pull 而不是 start 里一次 enqueue 再 error：否则有的运行时会把已入队的片丢掉，
      // 调用方根本收不到「写到一半」的草稿。
      pull(controller) {
        if (params.hangUpAfter !== undefined && i >= params.hangUpAfter) {
          controller.error(new TypeError("socket hang up"));
          return;
        }
        if (i < params.pieces.length) {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({ message: { content: params.pieces[i] }, done: false })}\n`,
            ),
          );
          i += 1;
          return;
        }
        if (!sentDone) {
          sentDone = true;
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ message: { content: "" }, done: true })}\n`),
          );
          controller.close();
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });
  }) as unknown as typeof fetch;
}

function chunkString(value: string, size: number): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < value.length; i += size) pieces.push(value.slice(i, i + size));
  return pieces;
}

function collectStream(): {
  events: NarrationStreamEvent[];
  onStream: (event: NarrationStreamEvent) => void;
  drafts: () => string[];
} {
  const events: NarrationStreamEvent[] = [];
  return {
    events,
    onStream: (event) => {
      events.push(event);
    },
    drafts: () =>
      events
        .filter((event): event is Extract<NarrationStreamEvent, { kind: "draft" }> => {
          return event.kind === "draft";
        })
        .map((event) => event.draft),
  };
}

const config: KeeperConfig = { ...defaultConfig, enabled: true, timeoutMs: 5_000 };

// 先用程序把一个回合真正提交下来，后面所有叙述都对着这一批事实讲。
let state: GameState = initialState();
let log: GameEvent[] = [];

function step(input: Parameters<typeof resolveIntent>[0]["intent"]) {
  const turnId = `turn-${state.turn + 1}`;
  const { drafts } = resolveIntent({ intent: input, state, turnId });
  const result = commit({ state, log, drafts, turnId });
  state = result.state;
  log = result.log;
  return result.committed;
}

function playOnce(intent: Parameters<typeof resolveIntent>[0]["intent"]): {
  state: GameState;
  events: GameEvent[];
} {
  const start = initialState();
  const turnId = `turn-${start.turn + 1}`;
  const { drafts } = resolveIntent({ intent, state: start, turnId });
  const result = commit({ state: start, log: [], drafts, turnId });
  return { state: result.state, events: result.committed };
}

function fakeEvent(params: {
  summary: string;
  turnId: string;
  seq: number;
  visibility?: GameEvent["visibility"];
  cause?: string;
  payload?: EventPayload;
}): GameEvent {
  return {
    id: `hist-${params.turnId}`,
    seq: params.seq,
    turnId: params.turnId,
    versionAfter: params.seq,
    clock: params.seq,
    visibility: params.visibility ?? "public",
    cause: params.cause ?? "player:recap",
    summary: params.summary,
    payload: params.payload ?? { type: "moved", to: "loc.hall", via: "房门", minutes: 1 },
  };
}

/**
 * 各栏 chars 是装配时称过的那段正文；有内容的栏之间用一个换行拼接。
 * 所以 Σ chars + max(0, 有内容的栏数 − 1) === text.length。
 * 空栏 chars 为 0，不贡献分隔符；栏内换行已经算进该栏，不是这笔「栏间换行」。
 */
function assertUsageMatchesText(ctx: KeeperContext, label: string) {
  const usage = ctx.usage;
  assert(Boolean(usage), `${label}：装配结果带着分栏统计`);
  if (!usage) return;

  assert(usage.columns.length === CONTEXT_COLUMN_NAMES.length, `${label}：九栏都在，空栏也占位`);
  for (let i = 0; i < CONTEXT_COLUMN_NAMES.length; i += 1) {
    assert(
      usage.columns[i]?.name === CONTEXT_COLUMN_NAMES[i],
      `${label}：第 ${i + 1} 栏是${CONTEXT_COLUMN_NAMES[i]}`,
    );
  }

  const columnSum = usage.columns.reduce((n, col) => n + col.chars, 0);
  const present = usage.columns.filter((col) => col.chars > 0).length;
  const separators = Math.max(0, present - 1);
  assert(
    columnSum + separators === ctx.text.length,
    `${label}：各栏 ${columnSum} + 栏间换行 ${separators} === text.length ${ctx.text.length}`,
  );
  assert(usage.usedChars === ctx.text.length, `${label}：usedChars 就是拼出来的文本长度`);
}

function columnOf(ctx: KeeperContext, name: ContextColumnName) {
  const found = ctx.usage?.columns.find((col) => col.name === name);
  assert(Boolean(found), `统计里有「${name}」`);
  return found!;
}

function assertSecretsHeld(
  target: GameState,
  events: GameEvent[],
  label: string,
  ctx = buildContext({ state: target, events }),
) {
  assertUsageMatchesText(ctx, label);
  const haystacks = [ctx.text, ctx.allowedNames.join("\u0000"), JSON.stringify(ctx.usage ?? {})];
  const notes = [...pack.items, ...pack.npcs]
    .map((entry) => entry.keeperNote)
    .filter((note): note is string => Boolean(note));
  const leakedNote = notes.find((note) => haystacks.some((text) => text.includes(note)));
  assert(!leakedNote, `${label}：守秘人备注没漏${leakedNote ? `（${leakedNote.slice(0, 12)}）` : ""}`);

  const leakedFact = pack.facts.find(
    (fact) =>
      fact.visibility === "secret" &&
      !target.known.includes(fact.id) &&
      haystacks.some((text) => text.includes(fact.title)),
  );
  assert(!leakedFact, `${label}：未获得的秘密线索没漏${leakedFact ? `（${leakedFact.title}）` : ""}`);

  const leakedItem = pack.items.find(
    (item) => isHidden(target, item.id) && haystacks.some((text) => text.includes(item.title)),
  );
  assert(!leakedItem, `${label}：藏着的道具没漏${leakedItem ? `（${leakedItem.title}）` : ""}`);
  assert(!ctx.text.includes("你不该看见的秘密经过"), `${label}：未感知的秘密事件没漏`);
}

const moveEvents = step({ kind: "move", to: "loc.study" });
const unlockEvents = step({ kind: "unlock", lock: "lock.desk" });
const fallback = narrate({ state, events: unlockEvents, intent: { kind: "unlock", lock: "lock.desk" } });
const hashBefore = stateHash(state);
const logLengthBefore = log.length;

console.log("— 假模型：连不上 —");
fakeModel(null);
let out = await keeperNarrate({
  config,
  state,
  events: unlockEvents,
  intent: { kind: "unlock", lock: "lock.desk" },
  spoken: "我撬这把锁",
  fallback,
});
assert(out.source === "模板" && out.text === fallback, "连不上时退回模板");

console.log("\n— 假模型：不给 JSON —");
fakeModel("我觉得这里应该来一段气氛描写");
out = await keeperNarrate({
  config,
  state,
  events: unlockEvents,
  intent: { kind: "unlock", lock: "lock.desk" },
  spoken: "我撬这把锁",
  fallback,
});
assert(out.source === "模板", "回复不是 JSON 时退回模板");

console.log("\n— 假模型：编造这一刻不存在的人 —");
// 这一回合只是走进书房，女房东还在楼梯平台，事实里没有她，叙述里也就不许有她。
fakeModel(structuredNarration("女房东就站在你身后，看着你推开书房的门。"));
out = await keeperNarrate({
  config,
  state,
  events: moveEvents,
  intent: { kind: "move", to: "loc.study" },
  spoken: "我推开书房门",
  fallback: narrate({ state, events: moveEvents, intent: { kind: "move", to: "loc.study" } }),
});
assert(out.source === "模板", "编造不在场的人时被体检拦下");
assert(Boolean(out.note?.includes("女房东")), `拦下的理由说得出是谁：${out.note}`);

console.log("\n— 假模型：报出没掷过的点数 —");
fakeModel(structuredNarration("你掷出了 97，锁纹丝不动。"));
out = await keeperNarrate({
  config,
  state,
  events: unlockEvents,
  intent: { kind: "unlock", lock: "lock.desk" },
  spoken: "我撬这把锁",
  fallback,
});
assert(out.source === "模板", "报出没掷过的数字时被体检拦下");

console.log("\n— 假模型：路由挑了一个不在场的编号 —");
fakeModel(JSON.stringify({ verb: "take", target: "item.не_существует", text: "" }));
const routed = await keeperRoute({ config, state, spoken: "把那个东西拿走" });
assert(routed.intent.kind === "unclear", "不在场的编号一律作废，转成追问");

console.log("\n— 假模型：替玩家把动作做完 —");
// 这一回合只是撬了一下锁，没有任何东西进背包，「拿起」就不能出口。
fakeModel(structuredNarration("你拿起那本硬壳账本，随手翻开。"));
out = await keeperNarrate({
  config,
  state,
  events: unlockEvents,
  intent: { kind: "unlock", lock: "lock.desk" },
  spoken: "我撬这把锁",
  fallback,
});
assert(out.source === "模板", "叙述替玩家做了没发生过的动作，被体检拦下");

console.log("\n— 假模型：一次合格的叙述 —");
fakeModel(structuredNarration("你贴着锁孔听了一会儿，屋子里静得能听见自己的呼吸。"));
out = await keeperNarrate({
  config,
  state,
  events: unlockEvents,
  intent: { kind: "unlock", lock: "lock.desk" },
  spoken: "我撬这把锁",
  fallback,
});
assert(out.source === "模型", "合格的叙述被采纳");

assert(stateHash(state) === hashBefore, "被模型折腾一圈之后，状态哈希没有变");
assert(log.length === logLengthBefore, "事件记录一条都没多");

const streamConfig: KeeperConfig = { ...config, stream: true };
const moveFallback = narrate({
  state,
  events: moveEvents,
  intent: { kind: "move", to: "loc.study" },
});
const acceptedText = "你贴着锁孔听了一会儿，屋子里静得能听见自己的呼吸。";
const acceptedJson = structuredNarration(acceptedText);

console.log("\n— 流式：中途断线 —");
{
  const hung = collectStream();
  fakeModelStream({
    pieces: ['{"text":"', "你贴着锁孔听了"],
    hangUpAfter: 2,
  });
  out = await keeperNarrate({
    config: streamConfig,
    state,
    events: unlockEvents,
    intent: { kind: "unlock", lock: "lock.desk" },
    spoken: "我撬这把锁",
    fallback,
    onStream: hung.onStream,
  });
  const last = hung.events[hung.events.length - 1];
  assert(out.source === "模板" && out.text === fallback, "流式说到一半断开时退回模板");
  assert(out.text !== "你贴着锁孔听了", "定稿里没有半截叙述");
  assert(Boolean(out.note), `断线的理由写在 note 里：${out.note}`);
  assert(hung.drafts().length === 0, "断线前的未验证文字从未交给界面");
  assert(last?.kind === "final", "断线之后仍会给出一条定稿事件");
  assert(last?.kind === "final" && last.text === fallback, "定稿事件的 text 是模板，不是草稿");
  assert(
    hung.events.every((event) =>
      event.kind === "draft" ? !("text" in event) : !("draft" in event),
    ),
    "草稿走 draft 字段，定稿走 text 字段，不混用",
  );
}

console.log("\n— 流式：体检不过 —");
{
  const invented = structuredNarration("女房东就站在你身后，看着你推开书房的门。");
  const blocked = collectStream();
  fakeModelStream({ pieces: chunkString(invented, 4) });
  out = await keeperNarrate({
    config: streamConfig,
    state,
    events: moveEvents,
    intent: { kind: "move", to: "loc.study" },
    spoken: "我推开书房门",
    fallback: moveFallback,
    onStream: blocked.onStream,
  });
  assert(out.source === "模板" && out.text === moveFallback, "流式编造不在场的人时整段作废");
  assert(Boolean(out.note?.includes("女房东")), `拦下的理由说得出是谁：${out.note}`);
  assert(blocked.drafts().length === 0, "作废的编造文字从未交给界面");
  const finals = blocked.events.filter((event) => event.kind === "final");
  assert(finals.length === 1, "体检失败只留下一条定稿");
  assert(
    finals[0]?.kind === "final" && finals[0].text === moveFallback,
    "定稿是模板，编造的句子没有留下",
  );
}

console.log("\n— 流式：终稿与非流式一致 —");
{
  fakeModel(acceptedJson);
  const nonStream = await keeperNarrate({
    config: { ...config, stream: false },
    state,
    events: unlockEvents,
    intent: { kind: "unlock", lock: "lock.desk" },
    spoken: "我撬这把锁",
    fallback,
  });
  const streamed = collectStream();
  fakeModelStream({ pieces: chunkString(acceptedJson, 3) });
  const streamedOut = await keeperNarrate({
    config: streamConfig,
    state,
    events: unlockEvents,
    intent: { kind: "unlock", lock: "lock.desk" },
    spoken: "我撬这把锁",
    fallback,
    onStream: streamed.onStream,
  });
  assert(
    nonStream.source === "模型" && streamedOut.source === "模型",
    "合格叙述两条路径都采纳模型",
  );
  assert(nonStream.text === acceptedText, "非流式终稿就是模型给的句子");
  assert(streamedOut.text === nonStream.text, "同样输入下，流式终稿与非流式一致");
  assert(streamed.drafts().length === 0, "合格内容也只在全部体检通过后作为定稿交给界面");
  const streamedFinal = streamed.events.filter((event) => event.kind === "final");
  assert(
    streamedFinal.length === 1 &&
      streamedFinal[0]?.kind === "final" &&
      streamedFinal[0].text === nonStream.text,
    "定稿事件与返回值一致",
  );
}

assert(stateHash(state) === hashBefore, "流式折腾一圈之后，状态哈希仍然没有变");
assert(log.length === logLengthBefore, "流式折腾一圈之后，事件记录一条都没多");

globalThis.fetch = realFetch;

console.log("\n— 上下文预算 —");

const defaultCtx = buildContext({ state, events: unlockEvents });
console.log(`默认预算 ${DEFAULT_CONTEXT_BUDGET_CHARS} 字；本回合实际 ${defaultCtx.text.length} 字`);
console.log(`正常预算下的分栏统计：\n${JSON.stringify(defaultCtx.usage, null, 2)}`);
assert(
  defaultCtx.text.length <= DEFAULT_CONTEXT_BUDGET_CHARS,
  "默认预算容得下现有模组这一回合",
);
assert(defaultCtx.usage?.budgetChars === DEFAULT_CONTEXT_BUDGET_CHARS, "统计里的预算就是装配时用的数");
assert(columnOf(defaultCtx, "经过").chars === 0, "只传本回合时经过栏字数为 0，但栏还在");
assert(columnOf(defaultCtx, "经过").dropped === 0, "没超预算时经过没有被裁");
assertSecretsHeld(state, unlockEvents, "开锁之后的本回合", defaultCtx);
assert(!defaultCtx.text.includes(CONTEXT_OMISSION.history), "没超预算时不写「经过已略去」");
assert(!defaultCtx.text.includes("【经过】"), "只传本回合时不另开经过栏");

const arrived = playOnce({ kind: "move", to: "loc.study" });
assertSecretsHeld(arrived.state, arrived.events, "开锁之前的书房");

const HISTORY_OLD = "最早的公开经过：你刚推开公寓大门，挂钟停在九点。";
const HISTORY_NEW = "最近的公开经过：你站在书房门口，手还按在门把上。";
const history: GameEvent[] = [];
for (let i = 0; i < 400; i += 1) {
  const summary =
    i === 0
      ? HISTORY_OLD
      : i === 399
        ? HISTORY_NEW
        : `第 ${String(i).padStart(3, "0")} 步：你在门厅来回走，看挂钟，看水渍，听楼上有没有脚步。`;
  history.push(fakeEvent({ summary, turnId: `hist-${i}`, seq: i }));
}
history.push(
  fakeEvent({
    summary: "你不该看见的秘密经过：码头的交易在凌晨三点。",
    turnId: "hist-secret",
    seq: 400,
    visibility: "secret",
    cause: "system:hidden",
    payload: { type: "fact_known", fact: "fact.dock_time" },
  }),
);

const longEvents = [...history, ...arrived.events];
const trimmed = buildContext({ state: arrived.state, events: longEvents });
const trimmedLines = trimmed.text.split("\n");
console.log(`超长历史压完之后 ${trimmed.text.length} 字`);
console.log(
  `\n被裁之后的上下文（节选）：\n${trimmedLines.slice(0, 10).join("\n")}\n……\n${trimmedLines.slice(-4).join("\n")}\n`,
);
assert(trimmed.text.length <= DEFAULT_CONTEXT_BUDGET_CHARS, "四百条经过被压到默认预算之内");
assert(trimmed.text.includes(CONTEXT_OMISSION.history), "裁掉经过时留下痕迹");
assert(!trimmed.text.includes(HISTORY_OLD), "最久远的公开经过被裁掉了");
assert(trimmed.text.includes(HISTORY_NEW), "最近的公开经过还在");
assert(trimmed.text.includes("书房"), "当前房间还在");
assert(trimmed.text.includes("【在场的人】只有你自己"), "在场的人还在");
for (const event of arrived.events) {
  if (event.visibility === "public" || event.cause.startsWith("player:")) {
    assert(trimmed.text.includes(event.summary), `本回合事实还在：${event.summary}`);
  }
}
assertSecretsHeld(arrived.state, longEvents, "裁过超长历史之后", trimmed);

const CLUE_OLD = "最早确认的一条线索：门厅挂钟停了";
const CLUE_NEW = "刚确认的一条线索：锁孔边上有新划痕";
const cluePadding = Array.from(
  { length: 40 },
  (_, i) => `中间拿到的线索 ${i}：${"墙纸水渍看了又看。".repeat(4)}`,
);
const stateWithClues: GameState = {
  ...arrived.state,
  known: [CLUE_OLD, ...cluePadding, CLUE_NEW],
};
const cluesFull = buildContext({
  state: stateWithClues,
  events: arrived.events,
  budgetChars: 100_000,
});
const cluesWithoutOld = buildContext({
  state: { ...stateWithClues, known: stateWithClues.known.slice(1) },
  events: arrived.events,
  budgetChars: 100_000,
});
const clueBudget = cluesWithoutOld.text.length + `（${CONTEXT_OMISSION.clues}）`.length;
const cluesTrimmed = buildContext({
  state: stateWithClues,
  events: arrived.events,
  budgetChars: clueBudget,
});
assert(cluesTrimmed.text.length <= clueBudget, "线索超预算时被压住");
assert(cluesTrimmed.text.includes(CONTEXT_OMISSION.clues), "裁掉线索时留下痕迹");
assert(!cluesTrimmed.text.includes(CLUE_OLD), "较早的已知线索先被裁");
assert(cluesTrimmed.text.includes(CLUE_NEW), "刚确认的线索还在");
assert(cluesFull.text.length > clueBudget, "没裁的话线索栏会超预算");
assertUsageMatchesText(cluesFull, "线索未裁");
assertUsageMatchesText(cluesWithoutOld, "线索去掉最早一条");
assertUsageMatchesText(cluesTrimmed, "线索被裁之后");
assert(columnOf(cluesTrimmed, "已知线索").dropped > 0, "线索超预算时被裁条数大于零");
assert(
  columnOf(cluesTrimmed, "已知线索").chars < columnOf(cluesFull, "已知线索").chars,
  "裁过之后线索栏字数变小",
);

const historyBeforeClues = buildContext({
  state: stateWithClues,
  events: longEvents,
  budgetChars: cluesFull.text.length + `【经过】\n（${CONTEXT_OMISSION.history}）`.length + 1,
});
assert(historyBeforeClues.text.includes(CLUE_OLD), "先裁经过，较早的线索还没轮到");
assert(historyBeforeClues.text.includes(CLUE_NEW), "先裁经过，刚确认的线索还在");
assert(historyBeforeClues.text.includes(CONTEXT_OMISSION.history), "经过先被裁并留痕");
assert(!historyBeforeClues.text.includes(HISTORY_OLD), "为了给线索让路，久远经过先没了");
assertSecretsHeld(stateWithClues, longEvents, "先裁经过、后裁线索之后", historyBeforeClues);

const fullBoth = buildContext({
  state: stateWithClues,
  events: longEvents,
  budgetChars: 100_000,
});
const bothTrimmed = buildContext({
  state: stateWithClues,
  events: longEvents,
  budgetChars: clueBudget,
});
assertUsageMatchesText(fullBoth, "经过与线索都未裁");
assertUsageMatchesText(bothTrimmed, "经过与线索都被裁");
console.log(`被裁之后的分栏统计：\n${JSON.stringify(bothTrimmed.usage, null, 2)}`);
assert(columnOf(bothTrimmed, "经过").dropped > 0, "超预算时经过被裁条数大于零");
assert(columnOf(bothTrimmed, "已知线索").dropped > 0, "超预算时线索被裁条数大于零");
assert(
  columnOf(bothTrimmed, "经过").chars < columnOf(fullBoth, "经过").chars,
  "裁过之后经过栏字数变小",
);
assert(
  columnOf(bothTrimmed, "已知线索").chars < columnOf(fullBoth, "已知线索").chars,
  "裁过之后线索栏字数变小",
);
assertSecretsHeld(stateWithClues, longEvents, "经过与线索都被裁之后", bothTrimmed);

const liveUrl = process.env.OLLAMA_URL;
if (!liveUrl) {
  console.log(`\n全部通过（${passed} 项）。设置 OLLAMA_URL 之后会再跑一遍真机。`);
  process.exit(0);
}

console.log(`\n— 真机：${liveUrl}，模型 ${config.model} —`);
const live: KeeperConfig = { ...config, baseUrl: liveUrl, timeoutMs: 120_000 };
try {
  const started = Date.now();
  const real = await keeperNarrate({
    config: live,
    state,
    events: unlockEvents,
    intent: { kind: "unlock", lock: "lock.desk" },
    spoken: "我撬这把锁",
    fallback,
  });
  console.log(`【${real.source}】${real.text}`);
  if (real.note) console.log(`（${real.note}）`);
  console.log(`耗时 ${Date.now() - started} 毫秒`);

  const realRoute = await keeperRoute({
    config: live,
    state,
    spoken: "我想把桌上那本硬壳的东西顺走",
  });
  console.log(`路由结果：${JSON.stringify(realRoute.intent)}${realRoute.note ? `（${realRoute.note}）` : ""}`);
} catch (error) {
  console.log(`真机没跑成：${error instanceof Error ? error.message : String(error)}`);
}

console.log(`\n全部通过（${passed} 项）。`);
