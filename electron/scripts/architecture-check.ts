/**
 * Full architecture slice: routes, kernel, Story Monitor, Information plan,
 * Director frontier, Memory extract/consolidate, context double-buffer, debug trace.
 * No model calls. Must not change gold-path hash.
 *
 *   cd demo && bun run architecture:check
 */
import { emptyMemory } from "@core/ai/memory";
import { runAfterCommit } from "@core/ai/jobs";
import { runAfterCommitLive } from "@core/ai/live";
import { traceFromJobs } from "@core/ai/trace";
import { defaultConfig } from "@core/keeper/config";
import { emptyContextStore } from "@core/engine/context-store";
import { playTurn } from "@core/engine/play-turn";
import { inspectKernel } from "@core/engine/kernel";
import { initialState } from "@core/engine/state";
import { stateHash } from "@core/engine/runtime";
import type { GameEvent, GameState } from "@core/engine/types";

let state: GameState = initialState();
let log: GameEvent[] = [];
let failed = 0;

function assert(ok: boolean, label: string): void {
  if (ok) console.log(`✓ ${label}`);
  else {
    failed += 1;
    console.log(`✗ ${label}`);
  }
}

function act(text: string) {
  return playTurn({ text, state, log });
}

let memory = emptyMemory();
let context = emptyContextStore();

function commitAndJobs(text: string) {
  const outcome = act(text);
  if (outcome.kind !== "committed") return outcome;
  state = outcome.state;
  log = outcome.log;
  const jobs = runAfterCommit({
    taskId: `task-${state.turn}`,
    branchId: "br-test",
    state,
    committed: outcome.committed,
    recent: outcome.recent,
    story: outcome.story,
    memory,
    context,
  });
  memory = jobs.memory;
  context = jobs.context;
  return { outcome, jobs };
}

assert(inspectKernel(initialState()).length === 0, "kernel: initial ok");

const moved = commitAndJobs("我推开书房门");
assert(!("kind" in moved) || moved.kind !== "query", "move committed");
if ("jobs" in moved) {
  assert(moved.jobs.blockedTurn === false, "after-commit jobs do not block the turn");
  assert(moved.jobs.information.usedModel === false, "Information used no model");
  assert(moved.jobs.director.usedModel === false, "Director used no model");
  assert(moved.jobs.information.proposals.length >= 1, "Information proposals from events");
  assert(moved.jobs.context.current !== null, "context current snapshot exists");
  assert(moved.jobs.context.preparing === null, "preparing swapped away at boundary");
  assert(moved.jobs.memory.cursor.rawRecordedThroughTurn >= 1, "hot cursor advanced");
  assert(moved.jobs.director.due === false, "Director not due after a move");
  const snap = traceFromJobs({
    jobs: moved.jobs,
    story: moved.outcome.story,
    turn: state.turn,
    stateVersion: state.version,
    source: "local",
  });
  assert(snap.stages.length === 8, "debug trace has eight pipeline stages");
  assert(snap.blockedTurn === false, "debug trace still non-blocking");
  assert(snap.information.proposals.every((item) => item.confirmed === false), "trace proposals stay unconfirmed");
}

commitAndJobs("看看书桌锁");
commitAndJobs("把黑色账本收进包里");
let attempts = 0;
while (!state.unlocked["lock.desk"] && attempts < 12) {
  attempts += 1;
  commitAndJobs("我撬这把锁");
}
assert(Boolean(state.unlocked["lock.desk"]), "unlocked");

commitAndJobs("把黑色账本收进包里");
const read = commitAndJobs("翻开账本读一读");
if ("jobs" in read) {
  assert(read.outcome.story.changedNodeIds.includes("node.read_ledger"), "monitor saw ledger node");
  assert(
    read.jobs.memory.entries.some((entry) => entry.memoryType === "fact"),
    "Memory extract stored fact deltas",
  );
  assert(
    read.jobs.memory.entries.every((entry) => entry.status !== "active" || entry.sources.length > 0),
    "active memory has sources",
  );
}

if ("jobs" in read) {
  const live = await runAfterCommitLive({
    taskId: "task-live",
    branchId: "br-test",
    state,
    committed: read.outcome.committed,
    recent: read.outcome.recent,
    story: read.outcome.story,
    memory: emptyMemory(),
    context: emptyContextStore(),
    config: { ...defaultConfig, enabled: false },
  });
  assert(live.information.usedModel === false, "disabled live Information uses no model");
  assert(live.director.usedModel === false, "disabled live Director uses no model");
  assert(live.memoryUsedModel === false, "disabled live Memory uses no model");
  assert(live.blockedTurn === false, "live jobs still do not block");
}

assert(stateHash(state) === "b6506aeb", `gold hash still b6506aeb (got ${stateHash(state)})`);

if (failed) {
  console.log(`\nfailed ${failed}`);
  process.exit(1);
}
console.log("\narchitecture jobs ok (deterministic, non-blocking).");
