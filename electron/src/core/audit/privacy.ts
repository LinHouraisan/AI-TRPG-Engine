import type { AuditCase, JsonObject } from "./types";

const SECRET_KEY = /authorization|api[_-]?key|credential|headers?|secret|token$/i;
const PRIVATE_TEXT_KEY = /^(text|summary|narration|content|description|title)$/i;

export function collectPrivateAuditTexts(
  value: unknown,
  found = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectPrivateAuditTexts(item, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  const record = value as Record<string, unknown>;
  const audience = record.audience as Record<string, unknown> | undefined;
  if (record.visibility === "gm_only"
    || record.visibility === "secret"
    || audience?.kind === "gm_only") {
    for (const [key, item] of Object.entries(record)) {
      if (PRIVATE_TEXT_KEY.test(key) && typeof item === "string" && item.length > 0) {
        found.add(item);
      }
    }
  }
  for (const item of Object.values(record)) collectPrivateAuditTexts(item, found);
  return found;
}

export function redactAuditValue(value: unknown, privateTexts: Iterable<string>): unknown {
  const texts = [...privateTexts].sort((left, right) => right.length - left.length || compareText(left, right));
  return redact(value, texts);
}

export function redactAuditText(value: string, privateTexts: Iterable<string>): string {
  return redactAuditValue(value, privateTexts) as string;
}

export function redactAuditCase(audit: AuditCase): AuditCase {
  const privateTexts = collectPrivateAuditTexts(audit.spans);
  return {
    run: audit.run,
    spans: audit.spans.map((span) => ({
      ...span,
      input: redactAuditValue(span.input, privateTexts) as JsonObject,
      output: span.output === null
        ? null
        : redactAuditValue(span.output, privateTexts) as JsonObject,
    })),
  };
}

function redact(value: unknown, privateTexts: string[]): unknown {
  if (typeof value === "string") {
    return privateTexts.reduce(
      (result, privateText) => result.split(privateText).join("[REDACTED]"),
      value,
    );
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry, privateTexts));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const audience = record.audience as Record<string, unknown> | undefined;
  if (record.visibility === "gm_only"
    || record.visibility === "secret"
    || audience?.kind === "gm_only") {
    const payload = record.payload as Record<string, unknown> | undefined;
    return {
      visibility: record.visibility ?? "gm_only",
      sourceKind: stringOrNull(record.sourceKind) ?? stringOrNull(payload?.type),
      sourceId: stringOrNull(record.sourceId) ?? stringOrNull(record.id),
      included: typeof record.included === "boolean" ? record.included : null,
      redacted: true,
    };
  }
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !SECRET_KEY.test(key))
      .map(([key, entry]) => [key, redact(entry, privateTexts)]),
  );
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
