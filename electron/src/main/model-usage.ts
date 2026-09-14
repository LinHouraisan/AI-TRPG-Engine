import type { Driver } from "./persist/driver";
import { getSetting, setSetting } from "./persist/catalog";
import type { ModelUsageSummary } from "../shared/api";

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
const DAY_MS = 24 * 60 * 60 * 1000;
const FORECAST_DAYS = 7;

export function recordModelUsage(db: Driver, entry: ModelUsageEntry, now: string): void {
  const current = getSetting(db, KEY);
  const entries = Array.isArray(current) ? current : [];
  setSetting(db, KEY, [...entries.slice(-499), entry], now);
}

export function summarizeModelUsage(
  db: Driver,
  nowIso = new Date().toISOString(),
): ModelUsageSummary {
  const current = getSetting(db, KEY);
  const entries = Array.isArray(current) ? (current as ModelUsageEntry[]) : [];
  const totals = entries.reduce(
    (sum, item) => ({
      calls: sum.calls + 1,
      promptTokens: sum.promptTokens + item.promptTokens,
      completionTokens: sum.completionTokens + item.completionTokens,
      estimatedMicros: sum.estimatedMicros + item.estimatedMicros,
    }),
    { calls: 0, promptTokens: 0, completionTokens: 0, estimatedMicros: 0 },
  );
  const now = Date.parse(nowIso);
  const currentDay = utcDayStart(now);
  const firstForecastDay = currentDay - (FORECAST_DAYS - 1) * DAY_MS;
  const historical = entries
    .map((item) => ({ item, createdAt: Date.parse(item.createdAt) }))
    .filter(({ createdAt }) => Number.isFinite(createdAt) && createdAt <= now);
  if (historical.length === 0) return { ...totals, forecast: null };

  const historyStartDay = Math.min(
    ...historical.map(({ createdAt }) => utcDayStart(createdAt)),
  );
  const sampleStartDay = Math.max(firstForecastDay, historyStartDay);
  const sampleDays = Math.min(
    FORECAST_DAYS,
    Math.max(1, Math.floor((currentDay - sampleStartDay) / DAY_MS) + 1),
  );
  const recent = historical
    .filter(({ createdAt }) => createdAt >= sampleStartDay)
    .map(({ item }) => item);
  const recentTokens = recent.reduce(
    (sum, item) => sum + item.promptTokens + item.completionTokens,
    0,
  );
  return {
    ...totals,
    forecast: {
      horizonDays: FORECAST_DAYS,
      sampleDays,
      calls: Math.round((recent.length / sampleDays) * FORECAST_DAYS),
      totalTokens: Math.round((recentTokens / sampleDays) * FORECAST_DAYS),
    },
  };
}

function utcDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
