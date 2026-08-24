# Task 5 Report: Three-Turn NPC Dialogue Context and Figure 2 Regression

## Status

Implemented Task 5 with focused red/green coverage in the assigned isolated worktree.

## Implemented

- Added `DialogueTurn`, latest-three bounding, current-scene NPC resolution, recent dialogue rendering, and NPC-scoped context assembly.
- NPC context includes only that NPC's authored `knownFacts`, player-acquired public facts, current visible scene perception, the selected life-history relationship, and the latest three complete player/GM pairs.
- Added authored `knownFacts` to Mist Harbor NPC data and the NPC schema. Keeper notes remain excluded from prompts.
- Passed bounded dialogue into both route and narration prompts through free-turn, browser session, and Electron Main paths.
- Browser dialogue pairs are assembled only from finalized persistable player/Keeper messages; transient notices and unmatched/in-flight player messages are excluded.
- Electron loads the latest three final narration pairs without joining domain events. Program query/clarification replies now also receive final narration rows, and eventless `talk` turns run through Keeper narration and persist normally.
- Narration entity guarding now checks the selected Scenario Pack, so an absent other-NPC name is rejected even when a non-default pack is under test.
- Added the context-usage display entry required by the new exhaustive `NPC 对话` column.

## TDD Evidence

- RED: the focused run failed because `dialogue-context.ts` did not exist and Figure 2's bare `可以` routed to `unclear`; the six pre-existing free-turn tests still passed.
- GREEN: `可以`, `继续问她`, and `刚才那个名字` all route to `talk` when the girl's previous question is present.
- The secrecy regression places `fact.conductor_oath` in the conductor's authored knowledge, proves it is absent from the girl's context and narration prompt, and proves a narration naming the absent conductor is rejected by the guard.
- The narration-boundary regression captures the real Keeper request and proves recent dialogue reaches narration, not only the route prompt or pure builder.

## Final Verification

- `bun test demo/src/keeper/dialogue-context.test.ts demo/src/keeper/free-turn.test.ts` — 10 pass, 0 fail, 29 assertions.
- `bun run --cwd demo keeper:check` — 234 checks passed.
- `bun test demo/src` — 62 pass, 0 fail, 148 assertions.
- `bun run --cwd demo typecheck` — pass.
- `bun run --cwd demo pack:lint` — all three packs valid, zero warnings.
- `bun run --cwd electron build:main` — pass with the repository's existing CommonJS `import.meta` warnings.
- `bun run --cwd electron persist:check` — all checks passed.
- `bun test electron/main/services/turns-race.test.ts` — 1 pass, 0 fail, 11 assertions; Task 4 candidate/stateVersion race contract remains intact.

## Self-review

- Recent dialogue is sliced at the prompt boundary, preserving chronological order and including eventless finalized turns.
- No whole Scenario Pack, other NPC knowledge, or keeper notes are rendered into the chosen NPC's context.
- Task 4's investigation intent, `stateVersion` validation, candidate publication, authoritative re-read, and event commit section were not changed.
- The extra schema, guard, and context-usage files are direct compile/security dependencies of Task 5's authored knowledge and new context column; no adjacent refactor was performed.

## Concern

- `bun run --cwd electron gold` passed every behavioral and live/replay consistency assertion but missed its fixed `b6506aeb` hash after a six-attempt branch-ID-seeded lockpick (`f91111c1`). Task 4's report already documents this unchanged Windows fixture as flaky; Task 5 does not alter RNG, events, state projection, or the gold fixture.

## Review Fixes

- Browser routing and narration now read from a branch-scoped `PersistedDialogueSource`. Saves are serialized per branch, and the latest-three cache advances only after `Store.saveMessages` succeeds. Delayed saves expose no early pair; rejected saves expose no failed pair; unmatched player messages are excluded.
- Removed `npc.line` from NPC prompt assembly. The selected NPC context is limited to its `knownFacts`, player-known public facts, current perception, its bound life-history relationship, and recent persisted dialogue.
- Added fact-level narration guarding. Secret or other-NPC fact titles are denied unless their fact ID is authorized; entity-title-stripped authored phrases are denied too. Retry diagnostics are generic, so the forbidden phrase is not copied into a second prompt.
- Pack lint now verifies every `npc.knownFacts` ID against the pack fact index, with a typo regression.
- Added a real SQLite regression proving the latest three final eventless player/GM pairs load in chronological order without an `events` table.

## Review-Fix Verification

- Focused Task 5 regressions: `bun test demo/src/keeper/persisted-dialogue.test.ts demo/src/keeper/dialogue-context.test.ts demo/src/keeper/free-turn.test.ts demo/src/character/creation.test.ts demo/src/session-opening.test.ts electron/main/persist/turns-dialogue.test.ts` — 29 pass, 0 fail, 71 assertions.
- Full demo suite: `bun test demo/src` — 68 pass, 0 fail, 165 assertions.
- `bun run --cwd demo keeper:check` — 234 checks passed.
- `bun run --cwd demo typecheck` — pass.
- `bun run --cwd demo pack:lint` — all three packs valid, zero warnings.
- `bun run --cwd electron build:main` — pass with the repository's existing CommonJS `import.meta` warnings.
- `bun run --cwd electron persist:check` — all checks passed.
- `bun test electron/main/services/turns-race.test.ts electron/main/persist/turns-dialogue.test.ts` — 2 pass, 0 fail, 12 assertions.
- `git diff --check` — pass.
