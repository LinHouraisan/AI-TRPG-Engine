/**
 * Program-only architecture slice: turn routes, fact kernel, Story Monitor, hot recent buffer.
 * No Information / Memory / Director model calls.
 *
 *   cd demo && bun run kernel:check
 */
import { playTurn } from "@core/engine/play-turn";
import { inspectKernel } from "@core/engine/kernel";
import { classifyIntent } from "@core/engine/routes";
import { route } from "@core/engine/router";
import { initialState } from "@core/engine/state";
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
  const outcome = playTurn({ text, state, log });
  if (outcome.kind === "committed") {
    state = outcome.state;
    log = outcome.log;
  }
  return outcome;
}

assert(inspectKernel(initialState()).length === 0, "initial state passes the fact kernel");
assert(classifyIntent(route("我推开书房门", state)).route === "structured_action", "move is structured_action");
assert(classifyIntent({ kind: "unlock", lock: "lock.desk" }).route === "mechanical_action", "unlock is mechanical_action");
assert(classifyIntent(route("背包里有什么", state)).route === "query", "inventory ask is query");
assert(classifyIntent(route("asdf", state)).route === "free_action", "unknown text is free_action, not a classify model");

const move = act("我推开书房门");
assert(move.kind === "committed", "move commits");
if (move.kind === "committed") {
  assert(move.classification.syncModels.length === 0, "hot path has no sync model");
  assert(move.classification.background.information === false, "Information AI not on this turn");
  assert(move.classification.background.director === false, "Director not on this turn");
  assert(move.recent.some((row) => row.kind === "player"), "hot buffer kept player text");
  assert(move.recent.some((row) => row.kind === "gm"), "hot buffer kept GM text");
  assert(move.recent.some((row) => row.kind === "event"), "hot buffer kept committed events");
  assert(move.story.directorDue === false, "Director not due after a move");
}

act("看看书桌锁");
const lockedTake = act("把黑色账本收进包里");
assert(lockedTake.kind === "committed", "rejected take still commits the rejection");

let attempts = 0;
let opened = act("我撬这把锁");
attempts += 1;
while (!state.unlocked["lock.desk"] && attempts < 12) {
  attempts += 1;
  opened = act("我撬这把锁");
}
assert(Boolean(state.unlocked["lock.desk"]), "desk unlocked");
assert(opened.kind === "committed", "unlock commit");
if (opened.kind === "committed") {
  assert(opened.story.changedNodeIds.includes("node.open_desk"), "Story Monitor saw open_desk complete");
  assert(opened.classification.route === "mechanical_action", "unlock stays mechanical_action");
}

act("把黑色账本收进包里");
const read = act("翻开账本读一读");
assert(read.kind === "committed", "read commits");
if (read.kind === "committed") {
  assert(read.story.changedNodeIds.includes("node.read_ledger"), "Story Monitor saw read_ledger complete");
  assert(read.story.turnsSinceProgress === 0, "progress this turn resets the stall counter");
  assert(
    read.story.clueCoverageGaps.every((gap) => gap.nodeId !== "node.read_ledger"),
    "completed nodes drop out of clue gaps",
  );
  assert(read.story.directorDue === false, "author paths still exist; Director stays cold");
  assert(inspectKernel(read.state).length === 0, "gold-path state still passes the kernel");
}

const query = act("背包里有什么");
assert(query.kind === "query", "bag query does not commit");

if (failed) {
  console.log(`\nfailed ${failed}`);
  process.exit(1);
}
console.log("\nkernel / Story Monitor / hot buffer ok. no Information, Memory, or Director calls.");
