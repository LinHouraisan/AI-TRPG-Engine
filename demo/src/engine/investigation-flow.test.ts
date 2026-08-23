import { afterEach, expect, test } from "bun:test";
import type { InvestigatorProfile } from "../character/types";
import type { KeeperConfig } from "../keeper/config";
import { handleFreeTurn } from "../keeper/free-turn";
import { loadPackById } from "./pack";
import { playTurn } from "./play-turn";
import { route } from "./router";
import type { GameState } from "./types";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const config: KeeperConfig = {
  enabled: true,
  protocol: "openai_compatible",
  baseUrl: "https://api.deepseek.com",
  apiKey: "test-secret",
  model: "deepseek-v4-flash",
  timeoutMs: 1000,
  temperature: 0,
  contextBudgetChars: 4000,
  stream: false,
  debugTrace: false,
};

test("exact Figure 1 sentence routes through authored investigation and commits its check and effect", async () => {
  const mist = loadPackById("mist-harbor");
  const investigator = mist.manifest.investigator;
  const profile: Pick<InvestigatorProfile, "lifeHistoryId" | "skills"> = {
    lifeHistoryId: "history.archive-correspondent",
    skills: { ...investigator.skills },
  };
  const state: GameState = {
    version: 4,
    turn: 4,
    clock: 7,
    pcAt: "loc.platform",
    npcAt: Object.fromEntries(mist.npcs.map((npc) => [npc.id, npc.startAt])),
    itemAt: Object.fromEntries(mist.items.map((item) => [item.id, item.at])),
    unlocked: {},
    observed: {},
    visited: { "loc.concourse": true, "loc.platform": true },
    flags: {},
    known: ["fact.ticket_48"],
    hp: investigator.hp,
    hpMax: investigator.hp,
    san: investigator.san,
    sanMax: investigator.sanMax,
    skills: { ...profile.skills },
    lifeHistoryId: profile.lifeHistoryId,
  };
  const spoken = "查看四周，重点注意是否有可以让列车员回答问题的办法";
  expect(route(spoken, state)).toEqual({ kind: "unclear", text: spoken });

  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      kind: "investigation",
      investigationId: "investigation.conductor-leverage",
      skill: "侦查",
      approach: "寻找能让列车员开口的细节",
    }) } }],
  }), { status: 200 })) as unknown as typeof fetch;
  const routed = await handleFreeTurn({
    config,
    state,
    profile,
    scenarioPack: mist,
    spoken,
    modelTaskId: "task-figure-one-flow",
  });
  expect(routed.intent).toMatchObject({
    kind: "investigation",
    investigationId: "investigation.conductor-leverage",
    skill: "侦查",
    stateVersion: 4,
  });

  const outcome = playTurn({
    text: spoken,
    state,
    log: [],
    intent: routed.intent,
    profile,
    scenarioPack: mist,
    turnId: "turn-figure-one",
  });
  expect(outcome.kind).toBe("committed");
  if (outcome.kind !== "committed") throw new Error(`unexpected outcome ${outcome.kind}`);
  expect(outcome.committed.map((event) => event.payload.type)).toEqual([
    "check_resolved",
    "flag_set",
  ]);
  expect(outcome.committed[0]?.payload).toMatchObject({
    type: "check_resolved",
    target: "investigation.conductor-leverage",
  });
  expect(outcome.state.flags["investigation.conductor-leverage.failed"]).toBe(true);
  expect(outcome.committed[1]?.narration).toContain("整理票夹");
});
