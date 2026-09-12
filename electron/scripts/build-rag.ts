/**
 * 建长期记忆的检索索引。
 *
 * 语料取自 `content/packs/<pack>/` 的**公开**设定：模组简介、公开事实、NPC 公开台词、场景描述。
 * 输出 `data/rag-index.json`，纯 JSON，可随存档走。
 *
 *   bun run rag:build                       # 全部模组
 *   bun run rag:build -- --pack mist-harbor # 只建一个
 *
 * 只索引 `visibility: "public"` 的事实：secret 事实一旦进检索就会被塞进叙述 prompt，
 * 与 `core/keeper/guard.ts` 拦截秘密外泄的既有约定相冲突。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildIndex, indexToJson } from "@core/ai/lc";
import { scriptEmbedder } from "./lib/lc-config";

type Fact = { id: string; title: string; visibility: string };
type Npc = { id: string; title: string; line: string };
type Room = { id: string; title: string; intro: string };

const PACKS_DIR = "content/packs";
const OUT = "data/rag-index.json";

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (!existsSync(PACKS_DIR)) {
  console.log(`✗ 找不到 ${PACKS_DIR}`);
  process.exit(1);
}

const only = arg("pack");
const packs = readdirSync(PACKS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => !only || name === only);

if (packs.length === 0) {
  console.log(`✗ ${PACKS_DIR} 下没有可用的模组${only ? `（--pack ${only} 不存在）` : ""}`);
  process.exit(1);
}

const docs: { id: string; text: string; source: string }[] = [];

for (const pack of packs) {
  const dir = join(PACKS_DIR, pack);
  const manifest = readJson<{ title: string; opening: string }>(join(dir, "pack.json"));
  if (!manifest) {
    console.log(`! 跳过 ${pack}：没有 pack.json`);
    continue;
  }
  docs.push({
    id: `${pack}#intro`,
    text: `${manifest.title}。${manifest.opening}`,
    source: `${pack}/intro`,
  });

  const facts = readJson<Fact[]>(join(dir, "facts.json")) ?? [];
  for (const fact of facts) {
    if (fact.visibility !== "public") continue;
    docs.push({ id: fact.id, text: fact.title, source: `${pack}/facts` });
  }

  const npcs = readJson<Npc[]>(join(dir, "npcs.json")) ?? [];
  for (const npc of npcs) {
    docs.push({ id: npc.id, text: `${npc.title}：${npc.line}`, source: `${pack}/npcs` });
  }

  const rooms = readJson<Room[]>(join(dir, "rooms.json")) ?? [];
  for (const room of rooms) {
    docs.push({ id: room.id, text: `${room.title}：${room.intro}`, source: `${pack}/rooms` });
  }
}

if (docs.length === 0) {
  console.log("✗ 语料为空，检查模组内容");
  process.exit(1);
}

const index = await buildIndex(scriptEmbedder(), docs);
mkdirSync("data", { recursive: true });
writeFileSync(OUT, indexToJson(index), "utf8");
console.log(
  `✓ 索引已写入 ${OUT}（${packs.join(", ")} 共 ${index.docs.length} 个片段，${index.dim} 维）`,
);
