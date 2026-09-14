import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openBun } from "./persist/bun-driver";
import type { Driver } from "./persist/driver";
import { applyInit } from "./persist/migrate";
import { recordModelUsage, summarizeModelUsage } from "./model-usage";

const databases: Driver[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function settingsDb(): Driver {
  const db = openBun(":memory:");
  databases.push(db);
  applyInit(
    db,
    { nowIso: () => "2026-09-14T12:00:00.000Z" },
    readFileSync(join(import.meta.dir, "../../sql/settings.sql"), "utf8"),
    "0001_init",
  );
  return db;
}

test("usage summary reports insufficient history instead of inventing a forecast", () => {
  const summary = summarizeModelUsage(settingsDb(), "2026-09-14T12:00:00.000Z");

  expect(summary).toEqual({
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedMicros: 0,
    forecast: null,
  });
});

test("seven-day forecast uses only the latest seven calendar days", () => {
  const db = settingsDb();
  recordModelUsage(db, {
    taskType: "gm.narrate_result",
    model: "deepseek-v4-flash",
    promptTokens: 100,
    completionTokens: 100,
    cachedTokens: 0,
    elapsedMs: 800,
    estimatedMicros: 0,
    outcome: "succeeded",
    createdAt: "2026-08-01T12:00:00.000Z",
  }, "2026-08-01T12:00:00.000Z");
  recordModelUsage(db, {
    taskType: "gm.narrate_result",
    model: "deepseek-v4-flash",
    promptTokens: 30,
    completionTokens: 10,
    cachedTokens: 0,
    elapsedMs: 500,
    estimatedMicros: 0,
    outcome: "succeeded",
    createdAt: "2026-09-07T23:00:00.000Z",
  }, "2026-09-07T23:00:00.000Z");
  recordModelUsage(db, {
    taskType: "gm.narrate_result",
    model: "deepseek-v4-flash",
    promptTokens: 10,
    completionTokens: 5,
    cachedTokens: 2,
    elapsedMs: 300,
    estimatedMicros: 0,
    outcome: "succeeded",
    createdAt: "2026-09-13T12:00:00.000Z",
  }, "2026-09-13T12:00:00.000Z");
  recordModelUsage(db, {
    taskType: "gm.narrate_result",
    model: "deepseek-v4-flash",
    promptTokens: 20,
    completionTokens: 5,
    cachedTokens: 4,
    elapsedMs: 400,
    estimatedMicros: 0,
    outcome: "succeeded",
    createdAt: "2026-09-14T08:00:00.000Z",
  }, "2026-09-14T08:00:00.000Z");

  expect(summarizeModelUsage(db, "2026-09-14T12:00:00.000Z")).toEqual({
    calls: 4,
    promptTokens: 160,
    completionTokens: 120,
    estimatedMicros: 0,
    forecast: {
      horizonDays: 7,
      sampleDays: 7,
      calls: 2,
      totalTokens: 40,
    },
  });
});
