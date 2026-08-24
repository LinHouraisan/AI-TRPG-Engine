import { expect, test } from "bun:test";
import type { InvestigatorProfile } from "../character/types";
import { initialState } from "./state";
import { resolveInvestigation, visibleInvestigations } from "./investigation";
import { loadPackById } from "./pack";

const mist = loadPackById("mist-harbor");

function profile(lifeHistoryId = "history.archive-correspondent"): Pick<
  InvestigatorProfile,
  "lifeHistoryId" | "skills"
> {
  return {
    lifeHistoryId,
    skills: { 侦查: 65, 心理学: 50, 图书馆使用: 60, 话术: 55 },
  };
}

test("visible investigations include the conductor opportunity and only the matching history entry", () => {
  const state = { ...initialState(), pcAt: "loc.platform", npcAt: { "npc.conductor": "loc.platform" }, lifeHistoryId: "history.archive-correspondent" };
  expect(visibleInvestigations(state, profile(), mist).map((entry) => entry.id)).toEqual([
    "investigation.conductor-leverage",
  ]);

  const archiveState = { ...state, pcAt: "loc.baggage-car" };
  expect(visibleInvestigations(archiveState, profile(), mist).map((entry) => entry.id)).toEqual([
    "investigation.archive-correspondent",
  ]);
  expect(visibleInvestigations(archiveState, profile("history.old-line-reporter"), mist)).toEqual([]);
});

test("invalid investigation proposals clarify before consuming RNG", () => {
  const base = { ...initialState(), pcAt: "loc.platform", npcAt: { "npc.conductor": "loc.platform" }, skills: profile().skills, lifeHistoryId: "history.archive-correspondent" };
  const invalid = [
    { state: base, id: "investigation.missing", skill: "侦查", who: profile() },
    { state: { ...base, pcAt: "loc.concourse" }, id: "investigation.conductor-leverage", skill: "侦查", who: profile() },
    { state: { ...base, known: ["fact.conductor_oath"] }, id: "investigation.conductor-leverage", skill: "侦查", who: profile() },
    { state: { ...base, pcAt: "loc.baggage-car" }, id: "investigation.archive-correspondent", skill: "图书馆使用", who: profile("history.old-line-reporter") },
    { state: base, id: "investigation.conductor-leverage", skill: "开锁", who: profile() },
    { state: base, id: "investigation.conductor-leverage", skill: "侦查", who: profile("history.old-line-reporter") },
  ];

  for (const candidate of invalid) {
    let rolled = false;
    const result = resolveInvestigation({
      state: candidate.state,
      profile: candidate.who,
      id: candidate.id,
      skill: candidate.skill,
      stateVersion: candidate.state.version,
      rng: () => {
        rolled = true;
        return 0;
      },
      scenarioPack: mist,
    });
    expect(result.clarification).toBeTruthy();
    expect(result.drafts).toEqual([]);
    expect(rolled).toBe(false);
  }
});

test("investigation resolution emits a deterministic check and authored success or failure drafts", () => {
  const state = { ...initialState(), pcAt: "loc.platform", npcAt: { "npc.conductor": "loc.platform" }, skills: profile().skills, lifeHistoryId: "history.archive-correspondent" };
  const success = resolveInvestigation({
    state,
    profile: profile(),
    id: "investigation.conductor-leverage",
    skill: "侦查",
    stateVersion: state.version,
    rng: () => 0.49,
    scenarioPack: mist,
  });
  expect(success.check).toMatchObject({ skill: "侦查", roll: 50, threshold: 65, ok: true });
  expect(success.drafts.map((draft) => draft.payload)).toEqual([
    { type: "check_resolved", target: "investigation.conductor-leverage", check: success.check!, minutes: 3 },
    { type: "fact_known", fact: "fact.conductor_oath" },
  ]);
  expect(success.drafts[1]?.narration).toBe("你注意到许澄每次核对车票时都会避开第四十八格；指出这个空位后，他终于承认自己受誓约约束。");

  const failure = resolveInvestigation({
    state,
    profile: profile(),
    id: "investigation.conductor-leverage",
    skill: "侦查",
    stateVersion: state.version,
    rng: () => 0.79,
    scenarioPack: mist,
  });
  expect(failure.check).toMatchObject({ skill: "侦查", roll: 80, threshold: 65, ok: false });
  expect(failure.drafts.map((draft) => draft.payload)).toEqual([
    { type: "check_resolved", target: "investigation.conductor-leverage", check: failure.check!, minutes: 5 },
    { type: "flag_set", flag: "investigation.conductor-leverage.failed", value: true },
  ]);
  expect(failure.drafts[1]?.narration).toBe("你只看到许澄一遍遍整理票夹；他察觉你的注视，把话题重新推回上车检票。");
});

test("investigation rejects a stale intent state version before consuming RNG", () => {
  const state = {
    ...initialState(),
    pcAt: "loc.platform",
    npcAt: { "npc.conductor": "loc.platform" },
    skills: profile().skills,
    lifeHistoryId: "history.archive-correspondent",
  };
  let rolled = false;
  const result = resolveInvestigation({
    state,
    profile: profile(),
    id: "investigation.conductor-leverage",
    skill: "侦查",
    stateVersion: state.version + 1,
    rng: () => {
      rolled = true;
      return 0;
    },
    scenarioPack: mist,
  });
  expect(result.clarification).toContain("状态版本");
  expect(result.drafts).toEqual([]);
  expect(rolled).toBe(false);
});
