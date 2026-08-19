/**
 * 酒馆卡原型自检：解析 V1 / V2 / PNG，自动车确定性，能力只能是人设卡。
 * 运行：cd demo && bun run card:check
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { autoCar } from "@/cards/autocar";
import { importTavernCard, importTavernText } from "@/cards/import";
import { parseTavernJson, parseTavernPng } from "@/cards/parse";
import { CARD_CAPABILITY } from "@/cards/types";

const fixtures = join(import.meta.dir, "../src/data/cards");

let failed = 0;
function assert(ok: boolean, label: string): void {
  if (ok) console.log(`✓ ${label}`);
  else {
    failed += 1;
    console.log(`✗ ${label}`);
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

function pngWithChara(json: string): Uint8Array {
  const sig = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const ihdr = pngChunk(
    "IHDR",
    Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0),
  );
  const keyword = new TextEncoder().encode("chara");
  const utf8 = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of utf8) binary += String.fromCharCode(byte);
  const payload = new TextEncoder().encode(btoa(binary));
  const text = new Uint8Array(keyword.length + 1 + payload.length);
  text.set(keyword, 0);
  text[keyword.length] = 0;
  text.set(payload, keyword.length + 1);
  const tEXt = pngChunk("tEXt", text);
  const iend = pngChunk("IEND", new Uint8Array());
  const out = new Uint8Array(sig.length + ihdr.length + tEXt.length + iend.length);
  out.set(sig, 0);
  out.set(ihdr, sig.length);
  out.set(tEXt, sig.length + ihdr.length);
  out.set(iend, sig.length + ihdr.length + tEXt.length);
  return out;
}

const suhengText = readFileSync(join(fixtures, "suheng.card.json"), "utf8");
const v1Text = readFileSync(join(fixtures, "v1-plain.card.json"), "utf8");

const suheng = importTavernText(suhengText);
assert(suheng.ok, "V2 JSON 能解析");
if (suheng.ok) {
  assert(suheng.draft.capability === CARD_CAPABILITY, "能力标记是人设卡");
  assert(suheng.draft.confirmed === false, "自动车未确认，仍是候选");
  assert(suheng.draft.card.name === "苏蘅", "读到名字");
  assert(suheng.draft.card.spec === "chara_card_v2", "spec 是 v2");
  assert(suheng.draft.card.worldBook.length === 2, "世界书两条");
  assert(suheng.draft.card.untrustedPrompts.length === 2, "system/jailbreak 留下但不升级");
  assert(suheng.draft.sheet.occupation.value === "接线员", "描述判出接线员");
  assert(suheng.draft.sheet.occupation.origin === "generated", "职业是生成的");
  assert(suheng.draft.sheet.hp.origin === "generated", "生命值是生成的");
  assert(suheng.draft.sheet.skills.value["开锁"] >= 1, "有开锁");
  assert(
    suheng.draft.sheet.notes.some((note) => note.includes("锁") || note.includes("账本")),
    "世界书写进自动车备注",
  );
  const again = autoCar(suheng.draft.card);
  assert(
    JSON.stringify(again.characteristics) === JSON.stringify(suheng.draft.sheet.characteristics),
    "同一张卡自动车数值不变",
  );
}

const v1 = importTavernText(v1Text);
assert(v1.ok, "V1 扁平卡能解析");
if (v1.ok) {
  assert(v1.draft.card.spec === "chara_card_v1", "无 spec 当 v1");
  assert(v1.draft.sheet.occupation.value === "学生", "医学院学生判为学生");
  assert(v1.draft.capability === CARD_CAPABILITY, "V1 也只是人设卡");
}

const png = pngWithChara(suhengText);
const fromPng = parseTavernPng(png);
assert(fromPng.name === "苏蘅", "PNG chara 块能拆出同一张卡");
const pngImport = importTavernCard(png, "suheng.png");
assert(pngImport.ok, "PNG 导入成功");
if (pngImport.ok && suheng.ok) {
  assert(
    pngImport.draft.sheet.occupation.value === suheng.draft.sheet.occupation.value,
    "PNG 与 JSON 职业一致",
  );
}

const garbage = importTavernText("{");
assert(!garbage.ok, "坏 JSON 拒绝");

const nameless = importTavernText(JSON.stringify({ description: "没有名字" }));
assert(!nameless.ok, "没名字拒绝");

const parsed = parseTavernJson(suhengText);
const withoutWorld = { ...parsed, worldBook: [] };
const withWorld = autoCar(parsed);
const noWorld = autoCar(withoutWorld);
assert(
  (withWorld.skills.value["开锁"] ?? 0) >= (noWorld.skills.value["开锁"] ?? 0),
  "世界书提到锁，开锁不会比没世界书更低",
);

if (failed) {
  console.log(`\n失败 ${failed} 项。`);
  process.exit(1);
}
console.log("\n酒馆卡原型全部通过。");
