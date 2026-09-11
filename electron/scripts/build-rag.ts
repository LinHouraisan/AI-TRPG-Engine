/**
 * 建长期记忆的检索索引。
 *
 * 语料放 data/lore/*.md（世界观、设定、人物小传都行），
 * 输出 data/rag-index.json，纯 JSON，可随存档走。
 *
 *   bun run rag:build
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultConfig } from "@core/keeper/config";
import { buildIndex, embedderFrom, indexToJson } from "@core/ai/lc";

const LORE_DIR = "data/lore";
const OUT = "data/rag-index.json";

if (!existsSync(LORE_DIR)) {
  mkdirSync(LORE_DIR, { recursive: true });
  console.log(`✗ 没有 ${LORE_DIR}，已创建：把世界观文档放进去再跑一次`);
  process.exit(1);
}

const files = readdirSync(LORE_DIR).filter((name) => name.endsWith(".md") || name.endsWith(".txt"));
if (files.length === 0) {
  console.log(`✗ ${LORE_DIR} 里没有 .md / .txt 文档`);
  process.exit(1);
}

const docs = files.map((name) => ({
  id: name,
  text: readFileSync(join(LORE_DIR, name), "utf8"),
  source: name,
}));

const config = { ...defaultConfig, protocol: "ollama" as const };
const index = await buildIndex(embedderFrom(config), docs);

mkdirSync("data", { recursive: true });
writeFileSync(OUT, indexToJson(index), "utf8");
console.log(`✓ 索引已写入 ${OUT}（${index.docs.length} 个片段，${index.dim} 维）`);
