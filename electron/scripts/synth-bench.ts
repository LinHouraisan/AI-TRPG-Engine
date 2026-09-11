/**
 * 用模型合成评测集 → data/bench/dataset.jsonl
 *
 *   bun run bench:synth -- --n 90 --topic "低魔中世纪黑暗奇幻：灰烬港城与地下遗迹"
 *
 * 合成完**必须人工抽检 10%**：数据脏，bench 的数字就没有意义。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { defaultConfig } from "@core/keeper/config";
import { chatModelFrom } from "@core/ai/lc";

type Case = {
  id: string;
  type: "knowledge" | "rule" | "consistency";
  question: string;
  context: string;
  reference: string;
};

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const SYSTEM = `你为一款中文 TRPG 引擎设计评测集。
只输出 JSON 数组，不要任何解释文字。
每条字段：id, type, question, context（可空字符串）, reference。
type 取值 knowledge（设定事实）/ rule（规则判定）/ consistency（剧情连贯），三类各占约三分之一。
reference 是参考答案要点，多个要点用中文顿号分隔，便于程序做关键词召回统计。`;

const prompt = ChatPromptTemplate.fromMessages([
  ["system", SYSTEM],
  ["human", "主题：{topic}\n生成 {n} 条评测样本。"],
]);

const n = Number(arg("n", "90"));
const topic = arg("topic", "低魔中世纪黑暗奇幻：灰烬港城与地下遗迹");

const chain = prompt.pipe(chatModelFrom(defaultConfig, { temperature: 1.0 })).pipe(new StringOutputParser());
const raw = await chain.invoke({ n: String(n), topic });

const start = raw.indexOf("[");
const end = raw.lastIndexOf("]");
if (start < 0 || end <= start) {
  console.log(`✗ 模型没有返回数组：${raw.slice(0, 200)}`);
  process.exit(1);
}

const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<Case>[];
const cases: Case[] = parsed.map((item, i) => ({
  id: item.id ?? `case-${i}`,
  type: item.type ?? "knowledge",
  question: item.question ?? "",
  context: item.context ?? "",
  reference: item.reference ?? "",
}));

mkdirSync("data/bench", { recursive: true });
writeFileSync(
  "data/bench/dataset.jsonl",
  cases.map((item) => JSON.stringify(item)).join("\n") + "\n",
  "utf8",
);
console.log(`✓ 生成 ${cases.length} 条 → data/bench/dataset.jsonl（记得抽检 10%）`);
