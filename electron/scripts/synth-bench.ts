/**
 * 用模型合成评测集 → data/bench/dataset.jsonl
 *
 *   bun run bench:synth -- --n 50
 *
 * 两条硬约束（踩过坑才明白为什么必须有）：
 *
 * 1. 语料必须来自真实卡包（读 data/rag-index.json，先跑 bun run rag:build）。
 *    之前用虚构主题「灰烬港城」生成，问题与索引毫无关系，
 *    RAG 检索不到任何相关文本，base 与 rag 两档分数必然趋同 —— 对比就没有意义了。
 *
 * 2. reference 的要点强制为原文子串。关键词召回本来就该是可比、可验、不依赖裁判模型的指标；
 *    可验、不依赖裁判模型的指标；而且空 reference 会被 keywordRecall 当成满分。
 *
 * 合成完**必须人工抽检 10%**：数据脏，bench 的数字就没有意义。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { scriptChatConfig } from "./lib/lc-config";
import { chatModelFrom } from "@core/ai/lc";

type Case = {
  id: string;
  type: "knowledge" | "rule" | "consistency";
  question: string;
  context: string;
  reference: string;
};

type RawCase = Partial<Case> & { question?: string; reference?: string };

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

/** 从模型返回的文本里抠出第一个 JSON 对象 / 数组。 */
function parseJson<T>(raw: string): T | undefined {
  const candidates = [
    [raw.indexOf("{"), raw.lastIndexOf("}")],
    [raw.indexOf("["), raw.lastIndexOf("]")],
  ] as const;
  for (const [start, end] of candidates) {
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        /* 试下一个候选 */
      }
    }
  }
  return undefined;
}

const INDEX_PATH = "data/rag-index.json";
if (!existsSync(INDEX_PATH)) {
  console.log(`✗ 缺少 ${INDEX_PATH}，先跑 bun run rag:build`);
  process.exit(1);
}

const index = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as {
  docs: { id: string; text: string; source: string }[];
};
const docs = index.docs.filter((doc) => doc.text && doc.text.trim().length >= 8);
if (docs.length === 0) {
  console.log("✗ 索引里没有可用片段");
  process.exit(1);
}

/** 规则类走模板，不劳烦模型：判定依据是内核 RNG，出题必须稳定可复现。 */
const RULE_POOL = [
  { action: "试图撬开锈死的舱门（力量 3，DC 12）", attribute: 3, difficulty: 12 },
  { action: "在摇晃的甲板上保持平衡（敏捷 2，DC 10）", attribute: 2, difficulty: 10 },
  { action: "辨认墙上的古代铭文（学识 4，DC 15）", attribute: 4, difficulty: 15 },
  { action: "说服女房东打开书房（魅力 3，DC 13）", attribute: 3, difficulty: 13 },
  { action: "在雾中听出钟声的方位（感知 2，DC 11）", attribute: 2, difficulty: 11 },
  { action: "忍住恐惧不去回头看（意志 4，DC 14）", attribute: 4, difficulty: 14 },
];


const total = Number(arg("n", "51"));
const nKnowledge = Math.min(docs.length, Math.round(total * 0.6));
const nConsistency = Math.min(Math.floor(docs.length / 2), Math.round(total * 0.2));
// 池子里的题目是固定的，重复生成只会同一条被计权多次，没有信息增量。
const nRule = Math.min(RULE_POOL.length, Math.max(0, total - nKnowledge - nConsistency));

const model = chatModelFrom(scriptChatConfig(), { temperature: 0.4, maxTokens: 512 });

/** 模型常把疑问句写成「……吗？？？」，收敛成一个问号，避免污染文本。 */
function normalizeQuestion(question: string): string {
  return question.trim().replace(/[？?]+$/, "？").replace(/[？?]{2,}/g, "？");
}

/**
 * 3B 出题会吐出半截句子（"女房东因楼上的声音影响而要求房东"）或带省略号的残句，
 * 这种题进评测集会污染分数。宁可丢题，也不能留脏题。
 */
function isUsableQuestion(question: string): boolean {
  const trimmed = question.trim();
  return (
    trimmed.length >= 8 &&
    /[？?]$/.test(trimmed) &&
    !trimmed.includes("...") &&
    !trimmed.includes("…") &&
    !/上文|这段|该文本|上述/.test(trimmed)
  );
}

/** 只保留原文里真实出现的要点：这样「命中」是可验证的，不是靠裁判心情。 */
function groundReference(rawReference: string, source: string): string {
  const keys = rawReference
    .split(/[、,，;；]/)
    .map((part) => part.replace(/^[-•*\s]+/, "").trim())
    .filter((part) => part.length >= 2 && source.includes(part));
  return [...new Set(keys)].slice(0, 5).join("、");
}

const knowledgePrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `你是 TRPG 评测题出题人。给你一段真实的设定文本，写一个**只能依据这段文本回答**的问题。
只输出 JSON：{{"question": "...", "reference": "要点1、要点2、要点3"}}
要求：
- question 是一个完整疑问句，以？结尾，自包含（不出现"上文""这段文本"），不含省略号；
- reference 要点必须逐字摘自给定文本（2-6 字为佳），3 到 5 个，用于评判回答是否踩中了关键事实。
不要输出解释文字。`,
  ],
  ["human", "设定文本：\n{text}"],
]);
const knowledgeChain = knowledgePrompt.pipe(model).pipe(new StringOutputParser());

const consistencyPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `你是 TRPG 评测题出题人。给你两段同属一个模组的设定文本，写一个需要**同时联系两段**才能回答好的叙述性问题。
只输出 JSON：{{"question": "...", "reference": "要点1、要点2、要点3"}}
要求同 knowledge：完整疑问句、以？结尾、自包含；reference 要点逐字摘自文本，3 到 5 个。
不要输出解释文字。`,
  ],
  ["human", "文本 A：\n{a}\n\n文本 B：\n{b}"],
]);
const consistencyChain = consistencyPrompt.pipe(model).pipe(new StringOutputParser());

const cases: Case[] = [];

console.log(`生成 ${nKnowledge} 道 knowledge（来自 ${docs.length} 个片段）…`);
for (const [i, doc] of docs.slice(0, nKnowledge).entries()) {
  const raw = await knowledgeChain.invoke({ text: doc.text });
  const parsed = parseJson<RawCase>(raw);
  const question = parsed?.question ? normalizeQuestion(parsed.question) : "";
  const reference = parsed?.reference ? groundReference(parsed.reference, doc.text) : "";
  if (!question || !reference || !isUsableQuestion(question)) {
    console.log(`  ! 跳过 ${doc.id}（题目不合格或要点为空）`);
    continue;
  }
  cases.push({
    id: `know-${i}`,
    type: "knowledge",
    question,
    context: "",
    reference,
  });
}

if (nConsistency > 0) {
  console.log(`生成 ${nConsistency} 道 consistency…`);
  for (let i = 0; i < nConsistency; i += 1) {
    const a = docs[i * 2];
    const b = docs[i * 2 + 1];
    if (!a || !b) break;
    const raw = await consistencyChain.invoke({ a: a.text, b: b.text });
    const parsed = parseJson<RawCase>(raw);
    const question = parsed?.question ? normalizeQuestion(parsed.question) : "";
    const reference = parsed?.reference
      ? groundReference(parsed.reference, `${a.text}\n${b.text}`)
      : "";
    if (!question || !reference || !isUsableQuestion(question)) {
      console.log(`  ! 跳过第 ${i} 组`);
      continue;
    }
    cases.push({
      id: `cons-${i}`,
      type: "consistency",
      question,
      context: `${a.text}\n${b.text}`,
      reference,
    });
  }
}

for (let i = 0; i < nRule; i += 1) {
  const item = RULE_POOL[i % RULE_POOL.length];
  cases.push({
    id: `rule-${i}`,
    type: "rule",
    question: item.action,
    context: "",
    // 规则题的要点是「处置流程」，不是事实；由 bench 按 rubric 判定。
    reference: `掷骰、检定、成功`,
  });
}

mkdirSync("data/bench", { recursive: true });
writeFileSync(
  "data/bench/dataset.jsonl",
  cases.map((item) => JSON.stringify(item)).join("\n") + "\n",
  "utf8",
);

const byType = cases.reduce<Record<string, number>>((acc, item) => {
  acc[item.type] = (acc[item.type] ?? 0) + 1;
  return acc;
}, {});
console.log(
  `✓ ${cases.length} 条 → data/bench/dataset.jsonl（${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join("，")}）`,
);
console.log("  记得抽检 10%：AI 出的题本身可能是错的。");
