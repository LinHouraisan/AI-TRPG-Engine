import type { Driver } from "./persist/driver";
import { getSetting, setSetting } from "./persist/catalog";

export type ModelUsageEntry = {
  taskType: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  elapsedMs: number;
  estimatedMicros: number;
  outcome: "succeeded" | "failed";
  createdAt: string;
};

const KEY = "model.usage";

export function recordModelUsage(db: Driver, entry: ModelUsageEntry, now: string): void {
  const current = getSetting(db, KEY);
  const entries = Array.isArray(current) ? current : [];
  setSetting(db, KEY, [...entries.slice(-499), entry], now);
}

export function summarizeModelUsage(db: Driver): {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  estimatedMicros: number;
} {
  const current = getSetting(db, KEY);
  const entries = Array.isArray(current) ? (current as ModelUsageEntry[]) : [];
  return entries.reduce(
    (sum, item) => ({
      calls: sum.calls + 1,
      promptTokens: sum.promptTokens + item.promptTokens,
      completionTokens: sum.completionTokens + item.completionTokens,
      estimatedMicros: sum.estimatedMicros + item.estimatedMicros,
    }),
    { calls: 0, promptTokens: 0, completionTokens: 0, estimatedMicros: 0 },
  );
}
