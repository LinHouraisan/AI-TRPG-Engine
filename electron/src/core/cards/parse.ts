import { hashText } from "../engine/rng";
import { decodeCharaPayload, readPngText } from "./png";
import type { CardSpec, TavernCard, WorldBookEntry } from "./types";

const JSON_LIMIT = 1_000_000;
const PNG_LIMIT = 8_000_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function parseWorldBook(value: unknown): WorldBookEntry[] {
  const record = asRecord(value);
  const raw = record?.entries ?? value;
  if (!Array.isArray(raw)) return [];
  const entries: WorldBookEntry[] = [];
  for (const item of raw) {
    const entry = asRecord(item);
    if (!entry) continue;
    const keys = strList(entry.keys);
    const content = str(entry.content);
    if (keys.length === 0 && content.length === 0) continue;
    const enabled = entry.enabled === undefined ? true : Boolean(entry.enabled);
    entries.push({ keys, content, enabled });
  }
  return entries;
}

function specOf(raw: Record<string, unknown>): CardSpec {
  const spec = str(raw.spec);
  if (spec === "chara_card_v3") return "chara_card_v3";
  if (spec === "chara_card_v2") return "chara_card_v2";
  return "chara_card_v1";
}

function dataBlock(raw: Record<string, unknown>): Record<string, unknown> {
  const nested = asRecord(raw.data);
  if (nested && (str(raw.spec).startsWith("chara_card") || str(nested.name))) return nested;
  return raw;
}

export function parseTavernObject(raw: unknown, rawHash: string): TavernCard {
  const root = asRecord(raw);
  if (!root) throw new Error("人设卡不是对象");
  const data = dataBlock(root);
  const name = str(data.name).trim();
  if (!name) throw new Error("人设卡没有名字");

  const untrusted = [str(data.system_prompt), str(data.post_history_instructions)].filter(
    (text) => text.length > 0,
  );

  return {
    spec: specOf(root),
    name,
    description: str(data.description),
    personality: str(data.personality),
    scenario: str(data.scenario),
    firstMes: str(data.first_mes),
    mesExample: str(data.mes_example),
    creatorNotes: str(data.creator_notes),
    tags: strList(data.tags),
    worldBook: parseWorldBook(data.character_book),
    untrustedPrompts: untrusted,
    rawHash,
  };
}

function hashBytes(bytes: Uint8Array): string {
  return hashText(new TextDecoder().decode(bytes)).toString(16).padStart(8, "0");
}

export function parseTavernJson(text: string): TavernCard {
  if (text.length > JSON_LIMIT) throw new Error("人设卡 JSON 太大");
  return parseTavernObject(JSON.parse(text) as unknown, hashText(text).toString(16).padStart(8, "0"));
}

export function parseTavernPng(bytes: Uint8Array): TavernCard {
  if (bytes.length > PNG_LIMIT) throw new Error("人设卡 PNG 太大");
  const texts = readPngText(bytes);
  const encoded = texts.get("ccv3") ?? texts.get("chara");
  if (!encoded) throw new Error("PNG 里没有 chara / ccv3");
  return parseTavernObject(decodeCharaPayload(encoded), hashBytes(bytes));
}

export function parseTavernBytes(bytes: Uint8Array, hint = ""): TavernCard {
  const looksPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  if (looksPng || hint.endsWith(".png")) return parseTavernPng(bytes);
  return parseTavernJson(new TextDecoder().decode(bytes));
}
