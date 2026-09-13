/**
 * 效果评估：同一份评测集，跑 base / rag / lora 三档，输出对比报告。
 *
 *   bun run bench -- --mode base
 *   bun run bench -- --mode rag
 *   LORA_MODEL=qwen2.5-3b-lora LORA_BASE_URL=http://127.0.0.1:8000/v1 bun run bench -- --mode lora
 *
 * 报告落在 docs/bench/report-<mode>.md 与同名 .json。
 * 这套对比数是"模型接入到底带来多少提升"的唯一凭据。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { StringOutputParser } from "@langchain/core/output_parsers";
import {
  chatModelFrom,
  indexFromJson,
  judgePrompt,
  narrateTurn,
  resolveWithRules,
  search,
} from "@core/ai/lc";
import { rollFor } from "@core/engine/rng";
import { generationRetrieval } from "./bench-mode";
import { scriptChatConfig, scriptEmbedder } from "./lib/lc-config";

type Case = {
  id: string;
  type: "knowledge" | "rule" | "consistency";
  question: string;
  context: string;
  reference: string;
};

type Row = {
  id: string;
  type: string;
  score: number;
  keywordRecall: number | null;
  /** 仅规则类有值：回答里的点数能否回溯到内核 RNG。 */
  diceTraceable?: boolean | null;
  latencyMs: number;
  reason: string;
  answer: string;
};

const RUBRIC: Record<string, string> = {
  knowledge: "回答中的事实是否与参考答案一致：完全一致 5 分，部分正确 3 分，事实错误或编造 1 分。",
  rule: "处置流程是否正确、是否给出数值依据：完整正确 5 分，缺依据 3 分，判定错误 1 分。",
  consistency: "相对 context 的剧情连贯性：自然承接 5 分，轻微脱节 3 分，明显矛盾 1 分。",
};

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function loadCases(path: string): Case[] {
  if (!existsSync(path)) {
    console.log(`✗ 缺少 ${path}，先跑 bun run bench:synth`);
    process.exit(1);
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Case);
}

/**
 * 关键词召回：廉价的辅助指标，不依赖裁判模型，可复现。
 * reference 为空时返回 null（而不是 1）——空参考答案本就无分可评，
 * 之前把它当成满分，会凭空抬高总分。
 */
function keywordRecall(answer: string, reference: string): number | null {
  const keys = reference
    .split(/[、,，]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  if (keys.length === 0) return null;
  return keys.filter((key) => answer.includes(key)).length / keys.length;
}

async function judge(item: Case, answer: string): Promise<{ score: number; reason: string }> {
  const chain = judgePrompt
    // 温度取 0：同一份答案多次打分必须得到同一个分数，否则 base / rag 的差值里混着裁判噪声。
    .pipe(chatModelFrom(config, { temperature: 0, maxTokens: 128 }))
    .pipe(new StringOutputParser());
  const raw = await chain.invoke({
    task: `按 ${item.type} 类型给这条 TRPG 引擎回答打分（1-5 整数）`,
    rubric: RUBRIC[item.type] ?? RUBRIC.knowledge,
    reference: item.reference,
    answer,
  });
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { score: 0, reason: "裁判未返回 JSON" };
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { score?: number; reason?: string };
    return { score: Number(parsed.score ?? 0), reason: parsed.reason ?? "" };
  } catch {
    return { score: 0, reason: "裁判 JSON 解析失败" };
  }
}

const mode = arg("mode", "base");
const limit = Number(arg("limit", "0"));
const dataset = arg("dataset", "data/bench/dataset.jsonl");
const config = scriptChatConfig();
/** 报告写到仓库根的 docs/bench/，与其余文档同处一地（脚本 cwd 是 electron/）。 */
const REPORT_DIR = "../docs/bench";

const useRag = mode !== "base";
const useLora = mode === "lora";
// 索引总是加载（检索质量是索引的属性，与档位无关），useRag 只决定要不要注入到生成。
const hasIndex = existsSync("data/rag-index.json");
const index = hasIndex
  ? indexFromJson(readFileSync("data/rag-index.json", "utf8"))
  : undefined;
if (useRag && !index) console.log("! 没有 data/rag-index.json，rag 档退化为 base");

const cases = limit > 0 ? loadCases(dataset).slice(0, limit) : loadCases(dataset);
const rows: Row[] = [];

/**
 * 检索质量（Recall@k）：不经过 LLM，纯 IR 指标，因此可复现、不受裁判模型影响。
 * 金标片段不用额外标注——reference 的要点都是原文子串，
 * 能同时包含全部要点的那个片段就是出题用的源片段。
 */
async function retrievalRecall(topK: number): Promise<{ hit: number; total: number } | null> {
  if (!index) return null;
  const embed = scriptEmbedder();
  let hit = 0;
  let total = 0;
  for (const item of cases) {
    if (item.type !== "knowledge") continue;
    const keys = item.reference
      .split(/[、,，]/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2);
    if (keys.length === 0) continue;
    const gold = index.docs.find((doc) => keys.every((key) => doc.text.includes(key)));
    if (!gold) continue;
    total += 1;
    const hits = await search(index, embed, item.question, topK);
    if (hits.some((found) => found.id === gold.id)) hit += 1;
  }
  return total === 0 ? null : { hit, total };
}

const recallAt3 = await retrievalRecall(3);

/**
 * 点数溯源检查：规则类的点数本该来自内核 RNG，模型不该自己编一个数。
 * 用同样的 seed 重算一遍，看回答里是否出现这个点数（或加点值后的总和）。
 *
 * 这是启发式判定：模型若改用 roll_dice 而不是 skill_check，随机数也是确定的，
 * 只是取的 key 不同，这种情况会被判为「未溯源」——所以这个数字偏保守。
 */
function diceTraceable(item: Case, seedTurnId: string, answer: string): boolean | null {
  if (item.type !== "rule") return null;
  const numbers = item.question.match(/\d+/g)?.map(Number);
  if (!numbers || numbers.length < 2) return null;
  const attribute = numbers[numbers.length - 2];
  const difficulty = numbers[numbers.length - 1];
  const roll = rollFor("bench", `${seedTurnId}:check:${attribute}:${difficulty}`, 20);
  return answer.includes(String(roll)) || answer.includes(String(roll + attribute));
}

/** 规则类要真的走规则 Agent（点数来自内核 RNG），叙述类走叙述链。 */
async function answer(item: Case, i: number): Promise<string> {
  if (item.type === "rule") {
    return resolveWithRules({
      config,
      action: item.question,
      seed: { seed: "bench", turnId: `${mode}-${item.id}-${i}` },
    });
  }
  const result = await narrateTurn({
    config,
    input: item.context ? `${item.context}\n${item.question}` : item.question,
    ...generationRetrieval(mode, index, scriptEmbedder),
    lora: useLora
      ? { loraModel: process.env.LORA_MODEL ?? "", loraBaseUrl: process.env.LORA_BASE_URL ?? "" }
      : undefined,
  });
  return result.text;
}

for (const [i, item] of cases.entries()) {
  const started = Date.now();
  let text: string;
  try {
    text = await answer(item, i);
  } catch (error) {
    text = "";
    console.log(`[${i + 1}/${cases.length}] ${item.id} 调用失败：${String(error).slice(0, 120)}`);
  }
  const scored = await judge(item, text);
  const seedTurnId = `${mode}-${item.id}-${i}`;
  const traceable = diceTraceable(item, seedTurnId, text);
  rows.push({
    id: item.id,
    type: item.type,
    score: scored.score,
    keywordRecall: keywordRecall(text, item.reference),
    diceTraceable: traceable,
    latencyMs: Date.now() - started,
    reason: scored.reason,
    answer: text,
  });
  const tail = traceable === null ? "" : traceable ? " [点数可溯源]" : " [点数未溯源]";
  console.log(`[${i + 1}/${cases.length}] ${item.id} score=${scored.score} ${scored.reason}${tail}`);
}

const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
const compact = (values: (number | null)[]) => values.filter((v): v is number => v !== null);
const byType: Record<string, number> = {};
for (const row of rows) {
  const group = rows.filter((item) => item.type === row.type);
  byType[row.type] = mean(group.map((item) => item.score));
}

const scoredRecall = compact(rows.map((row) => row.keywordRecall));
const traced = rows.filter((row) => row.diceTraceable !== null && row.diceTraceable !== undefined);
const summary = {
  mode,
  n: rows.length,
  overall: Number(mean(rows.map((row) => row.score)).toFixed(3)),
  byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Number(v.toFixed(3))])),
  keywordRecall: Number(mean(scoredRecall).toFixed(3)),
  keywordRecallN: scoredRecall.length,
  diceTraceable: traced.length === 0 ? null : `${traced.filter((row) => row.diceTraceable).length}/${traced.length}`,
  recallAt3: recallAt3 ? `${recallAt3.hit}/${recallAt3.total}` : null,
  avgLatencyMs: Math.round(mean(rows.map((row) => row.latencyMs))),
};

// Bun 的 mkdirSync 在目录已存在时仍会抛 EEXIST（Node 不会），
// 不先判存在的话，第二次跑 bench 必崩。
if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(`${REPORT_DIR}/report-${mode}.json`, JSON.stringify({ summary, rows }, null, 2), "utf8");
writeFileSync(
  `${REPORT_DIR}/report-${mode}.md`,
  [
    `# Bench 报告（mode=${mode}）`,
    "",
    `- 模型：${config.model}（${config.baseUrl}）`,
    `- 样本数：${summary.n}`,
    `- 总分（1-5）：**${summary.overall}**`,
    `- 分类型：${Object.entries(summary.byType).map(([k, v]) => `${k}=${v}`).join("，")}`,
    `- 知识要点命中率：${summary.keywordRecall}（${summary.keywordRecallN}/${summary.n} 条可评）`,
    `- 点数溯源率：${summary.diceTraceable ?? "无规则题"}`,
    `- 检索 Recall@3：${summary.recallAt3 ?? "无索引"}`,
    `- 平均延迟：${summary.avgLatencyMs}ms`,
  ].join("\n"),
  "utf8",
);
console.log(`\n✓ mode=${mode} 总分 ${summary.overall}（${summary.n} 条）→ ${REPORT_DIR}/report-${mode}.md`);
