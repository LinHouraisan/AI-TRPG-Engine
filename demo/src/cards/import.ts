import { autoCar } from "./autocar";
import { parseTavernBytes, parseTavernJson } from "./parse";
import { CARD_CAPABILITY, type CardImportResult } from "./types";

function fail(code: string, message: string): CardImportResult {
  return { ok: false, code, message };
}

function fromCard(card: ReturnType<typeof parseTavernJson>): CardImportResult {
  return {
    ok: true,
    draft: {
      capability: CARD_CAPABILITY,
      spec: card.spec,
      card,
      sheet: autoCar(card),
      confirmed: false,
    },
  };
}

/** 把酒馆卡（JSON 或 PNG）收成 ImportDraft。失败不写盘、不改战役。 */
export function importTavernCard(bytes: Uint8Array, hint = ""): CardImportResult {
  try {
    return fromCard(parseTavernBytes(bytes, hint));
  } catch (error) {
    return fail("CONTENT_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
}

export function importTavernText(text: string): CardImportResult {
  try {
    return fromCard(parseTavernJson(text));
  } catch (error) {
    return fail("CONTENT_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
}
