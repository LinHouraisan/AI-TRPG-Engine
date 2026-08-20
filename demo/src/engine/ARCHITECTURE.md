# Engine architecture slice (2026-08-20 docs)

Matches the main-branch AI rewrite: **no domain Analyzers**, **no Information/Memory/Director on the hot path**.

| Piece | Code | Status |
| --- | --- | --- |
| Turn routes | `routes.ts` | Fast path vs `free_action`. No `gm.interpret_action`. |
| Fact kernel | `kernel.ts` | Refs, bounds, locations. Runs on every commit. |
| Story Monitor | `story-monitor.ts` | Derived node/clue/stall view. `directorDue` is a flag only. |
| Hot recent buffer | `recent.ts` | Player + GM + events this turn. |
| Information AI | `ai/information.ts` + `ai/live.ts` | Deterministic plan first. Live model optional, never on hot path. |
| Director Frontier | `ai/director.ts` + `ai/live.ts` | Rebuild from Story Monitor. Model only if `directorDue`. |
| Memory | `ai/memory.ts` + SQLite | Extract/consolidate persist. Live semantic extract never writes facts. |
| Context double-buffer | `engine/context-store.ts` | current / preparing, swap at task boundary. Not authoritative. |
| `gm.handle_free_turn` | `keeper/free-turn.ts` | One `modelTaskId` for intent then narrate. Fast path uses `gm.narrate_result`. |
| After-commit jobs | `ai/jobs.ts` + `ai/live.ts` + `ai/trace.ts` | Non-blocking. Debug panel behind host checkbox `debugTrace`. |

`cd demo && bun run architecture:check`

Debug: host menu checkbox **调试后台任务** (`KeeperConfig.debugTrace`). Record column then shows Information → Director → Memory pipeline, context double-buffer, Story Monitor. Default off. Does not write facts.

