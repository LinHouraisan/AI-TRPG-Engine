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
import { chatModelFrom, indexFromJson, judgePrompt, narrateTurn } from "@core/ai/lc";
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
  keywordRecall: number;
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

/** 关键词召回：廉价的辅助指标，不依赖裁判模型，可复现。 */
function keywordRecall(answer: string, reference: string): number {
  const keys = reference
    .split(/[、,，]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  if (keys.length === 0) return 1;
  return keys.filter((key) => answer.includes(key)).length / keys.length;
}

async function judge(item: Case, answer: string): Promise<{ score: number; reason: string }> {
  const chain = judgePrompt
    .pipe(chatModelFrom(config, { temperature: 0.1, maxTokens: 128 }))
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
const index = useRag && existsSync("data/rag-index.json")
  ? indexFromJson(readFileSync("data/rag-index.json", "utf8"))
  : undefined;
if (useRag && !index) console.log("! 没有 data/rag-index.json，rag 档退化为 base");

const cases = limit > 0 ? loadCases(dataset).slice(0, limit) : loadCases(dataset);
const rows: Row[] = [];

for (const [i, item] of cases.entries()) {
  const started = Date.now();
  const result = await narrateTurn({
    config,
    input: item.context ? `${item.context}\n${item.question}` : item.question,
    ...generationRetrieval(mode, index, scriptEmbedder),
    lora: useLora
      ? { loraModel: process.env.LORA_MODEL ?? "", loraBaseUrl: process.env.LORA_BASE_URL ?? "" }
      : undefined,
  });
  const scored = await judge(item, result.text);
  rows.push({
    id: item.id,
    type: item.type,
    score: scored.score,
    keywordRecall: keywordRecall(result.text, item.reference),
    latencyMs: Date.now() - started,
    reason: scored.reason,
    answer: result.text,
  });
  console.log(`[${i + 1}/${cases.length}] ${item.id} score=${scored.score} ${scored.reason}`);
}

const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
const byType: Record<string, number> = {};
for (const row of rows) {
  const group = rows.filter((item) => item.type === row.type);
  byType[row.type] = mean(group.map((item) => item.score));
}

const summary = {
  mode,
  n: rows.length,
  overall: Number(mean(rows.map((row) => row.score)).toFixed(3)),
  byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Number(v.toFixed(3))])),
  keywordRecall: Number(mean(rows.map((row) => row.keywordRecall)).toFixed(3)),
  avgLatencyMs: Math.round(mean(rows.map((row) => row.latencyMs))),
};

mkdirSync(REPORT_DIR, { recursive: true });
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
    `- 知识要点命中率：${summary.keywordRecall}`,
    `- 平均延迟：${summary.avgLatencyMs}ms`,
  ].join("\n"),
  "utf8",
);
console.log(`\n✓ mode=${mode} 总分 ${summary.overall}（${summary.n} 条）→ ${REPORT_DIR}/report-${mode}.md`);
