import { expect, test } from "bun:test";
import { allocationBudget, validateAllocation } from "./creation";
import { lintPack, loadPack, loadPackById } from "@core/engine/pack";

const rules = loadPackById("mist-harbor").manifest.creation;
if (!rules) throw new Error("Mist Harbor must define investigator creation rules");

test("fixed characteristics produce separate CoC 7e budgets", () => {
  expect(allocationBudget(rules)).toEqual({
    occupation: rules.characteristics.EDU * 4,
    interest: rules.characteristics.INT * 2,
  });
});

test("allocation must spend both budgets exactly and cap final skills at 90", () => {
  const invalid = validateAllocation(rules, {
    name: "林晚",
    lifeHistoryId: "history.archive-correspondent",
    occupationPoints: { 侦查: 999 },
    interestPoints: {},
  });

  expect(invalid.ok).toBe(false);
  if (!invalid.ok) expect(invalid.issues.map((issue) => issue.code)).toContain("SKILL_OVER_CAP");
});

test("allocation rejects invalid point sources and returns the derived profile only when valid", () => {
  const invalid = validateAllocation(rules, {
    name: "林晚",
    lifeHistoryId: "history.archive-correspondent",
    occupationPoints: { 开锁: -1, 不存在: 1 },
    interestPoints: { 侦查: 1.5 },
  });

  expect(invalid.ok).toBe(false);
  if (!invalid.ok) {
    const codes = invalid.issues.map((issue) => issue.code);
    expect(codes).toContain("OCCUPATION_SKILL_INVALID");
    expect(codes).toContain("SKILL_UNKNOWN");
    expect(codes).toContain("POINTS_INVALID");
    expect(codes).toContain("POINTS_REMAINING");
  }
});

test("allocation rejects unknown histories and final skills below one", () => {
  const invalid = validateAllocation({ ...rules, baseSkills: { ...rules.baseSkills, 开锁: 0 } }, {
    name: "林晚",
    lifeHistoryId: "history.unknown",
    occupationPoints: {},
    interestPoints: {},
  });

  expect(invalid.ok).toBe(false);
  if (!invalid.ok) {
    const codes = invalid.issues.map((issue) => issue.code);
    expect(codes).toContain("LIFE_HISTORY_UNKNOWN");
    expect(codes).toContain("SKILL_UNDER_MIN");
  }
});

test("valid allocation returns the complete fixed investigator profile", () => {
  const result = validateAllocation(rules, {
    name: "林晚",
    lifeHistoryId: "history.archive-correspondent",
    occupationPoints: { 侦查: 55, 聆听: 35, 图书馆使用: 50, 话术: 70, 心理学: 70 },
    interestPoints: { 侦查: 10, 聆听: 20, 图书馆使用: 20, 话术: 15, 心理学: 10, 开锁: 65 },
  });

  expect(result).toEqual({
    ok: true,
    profile: {
      name: "林晚",
      occupation: "记者",
      characteristics: { STR: 50, CON: 50, SIZ: 60, DEX: 60, APP: 50, INT: 70, POW: 65, EDU: 70 },
      baseSkills: { 侦查: 25, 聆听: 20, 图书馆使用: 20, 话术: 5, 心理学: 10, 开锁: 1 },
      occupationPoints: { 侦查: 55, 聆听: 35, 图书馆使用: 50, 话术: 70, 心理学: 70 },
      interestPoints: { 侦查: 10, 聆听: 20, 图书馆使用: 20, 话术: 15, 心理学: 10, 开锁: 65 },
      skills: { 侦查: 90, 聆听: 75, 图书馆使用: 90, 话术: 90, 心理学: 90, 开锁: 66 },
      hp: 11,
      san: 65,
      sanMax: 99,
      lifeHistoryId: "history.archive-correspondent",
      contentVersion: "0.1.0",
    },
  });
});

test("allocation trims a non-empty investigator name", () => {
  const result = validateAllocation(rules, {
    name: "  林晚  ",
    lifeHistoryId: "history.archive-correspondent",
    occupationPoints: { 侦查: 55, 聆听: 35, 图书馆使用: 50, 话术: 70, 心理学: 70 },
    interestPoints: { 侦查: 10, 聆听: 20, 图书馆使用: 20, 话术: 15, 心理学: 10, 开锁: 65 },
  });

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.profile.name).toBe("林晚");
});

test("allocation rejects an empty or whitespace-only investigator name", () => {
  for (const name of ["", "   ", "\t\n"]) {
    const result = validateAllocation(rules, {
      name,
      lifeHistoryId: "history.archive-correspondent",
      occupationPoints: { 侦查: 55, 聆听: 35, 图书馆使用: 50, 话术: 70, 心理学: 70 },
      interestPoints: { 侦查: 10, 聆听: 20, 图书馆使用: 20, 话术: 15, 心理学: 10, 开锁: 65 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("NAME_INVALID");
  }
});

test("creation rules reject a configured skill cap other than 90", () => {
  const invalid = validateAllocation(
    { ...rules, maxSkill: 99 as unknown as 90 },
    {
      name: "林晚",
      lifeHistoryId: "history.archive-correspondent",
      occupationPoints: {},
      interestPoints: {},
    },
  );

  expect(invalid.ok).toBe(false);
  if (!invalid.ok) expect(invalid.issues.map((issue) => issue.code)).toContain("MAX_SKILL_INVALID");
});

test("pack lint rejects a life history whose investigation is not authored", () => {
  const mist = loadPackById("mist-harbor");
  const source = {
    manifest: {
      ...mist.manifest,
      creation: {
        ...rules,
        lifeHistories: rules.lifeHistories.map((history, index) =>
          index === 0 ? { ...history, investigationId: "investigation.missing" } : history,
        ),
      },
    },
    rooms: mist.rooms,
    items: mist.items,
    locks: mist.locks,
    facts: mist.facts,
    npcs: mist.npcs,
    story: mist.story,
    conditions: mist.conditions,
    investigations: [],
  };

  const issues = lintPack(loadPack(source));
  expect(issues.map((issue) => issue.message)).toContain("调查入口 investigation.missing 不存在");
});

test("pack lint rejects an NPC knownFacts typo", () => {
  const mist = loadPackById("mist-harbor");
  const broken = {
    ...mist,
    npcs: mist.npcs.map((npc, index) =>
      index === 0 ? { ...npc, knownFacts: ["fact.missing"] } : npc,
    ),
  };

  const issues = lintPack(broken);
  expect(issues.map((issue) => issue.message)).toContain("NPC 已知事实 fact.missing 不存在");
});
