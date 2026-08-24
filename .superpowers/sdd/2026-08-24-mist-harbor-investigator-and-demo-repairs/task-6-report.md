# Task 6 Report: GM Response Quality Contract

## Status

Implemented Task 6 in the assigned isolated worktree with focused red/green coverage.

## Implemented

- Extended the narration contract to require `text`, `feedback`, `reaction`, and `interactionPoints` while keeping `NarrationResult`, streaming drafts, persistence, and player-visible output limited to `text`.
- Updated the Keeper prompt to draft现场反馈、NPC/环境反应、自然互动点 and a cohesive 150–350-character target response.
- Added `checkNarrationQuality(reply, mode)` for simple, investigation, dialogue, and exploration modes.
- Rich narration rejects missing or punctuation-only semantic fields, interaction points absent from `text`, repeated four-character n-gram padding, empty text, and text above the existing 900-character safety cap.
- The 150–350 range is soft: the first semantically valid out-of-range reply receives a generic retry hint, while a second semantically valid reply is accepted rather than falling back solely for length.
- Existing entity, number, fact-level secrecy, and uncommitted-outcome checks remain in `checkNarration`. Retry prompts now use generic diagnostics and do not echo rejected facts or model output.
- Simple deterministic queries retain the existing program path and their quality mode does not require rich fields.
- Updated the Task 5 dialogue secrecy fixtures and the Keeper verification script to exercise the new structured contract before reaching the existing security guards.

## TDD Evidence

- Initial RED: focused tests failed because `checkNarrationQuality` was not exported, `{ text }` still passed the narration schema, and semantically invalid replies were accepted after one request.
- Semantic-presence RED: punctuation-only `feedback` reached the interaction check instead of returning `missing_feedback`.
- Repetition RED: a longer repeated sentence evaded the initial most-frequent n-gram threshold.
- GREEN: the focused guard/free-turn/dialogue suite now passes 22 tests with 62 assertions.

## Final Verification

- `bun test demo/src/keeper/guard.test.ts demo/src/keeper/free-turn.test.ts demo/src/keeper/dialogue-context.test.ts` — 22 pass, 0 fail, 62 assertions.
- `bun run --cwd demo keeper:check` — 234 checks passed.
- `bun test demo/src` — 77 pass, 0 fail, 190 assertions.
- `bun run --cwd demo typecheck` — pass.
- `git diff --check` — pass; only the repository's existing LF-to-CRLF warnings were emitted.

## Self-review

- Task 5's `allowedFactIds` guard and generic unauthorized-fact reason are unchanged; its regression proves a forbidden phrase is absent from both initial and retry prompts.
- Quality metadata is consumed only by validation. It is not added to `NarrationResult`, stream events, messages, or persistence.
- Length cannot by itself force fallback below 900 characters, and repeated content cannot satisfy the soft target.
- Route and investigation contracts, state commits, RNG, and deterministic query handling were not changed.

## Concern

- `demo/src/keeper/dialogue-context.test.ts` and `demo/scripts/keeper-check.ts` are support-fixture updates beyond the five primary Task 6 files; they were required so the stated full Keeper and Task 5 secrecy checks exercise the new required fields rather than stopping at the old schema.

## Review Fixes

- A semantically valid and fully safety-checked first reply that misses only the 150–350 target is now retained as a soft candidate. If the improvement request fails at the network or schema layer, or returns a semantically invalid or unauthorized reply, the first candidate is finalized instead of falling back to the template.
- The retained-candidate regression covers both short and long candidates against network failure, malformed structure, and an unauthorized fact. Only a second reply that passes the complete quality and safety pipeline can replace the candidate.
- Rich narration now requires normalized `feedback` and `reaction` clauses to appear in visible `text`, not merely exist in hidden structure fields.
- Interaction points must be visible scene affordances. Numbered/bulleted entries, `选项`, `你可以...`, and command-like `继续追问`/`查看`/`调查` forms are rejected even when copied into the end of `text`.
- The prompt now states the exact reflection and non-menu contract. Existing Task 5 secrecy fixtures and Keeper checker fixtures were updated to reach the underlying entity, fact, number, and uncommitted-outcome guards.

## Review-Fix Verification

- Focused Keeper suite: 26 pass, 0 fail, 90 assertions.
- `bun run --cwd demo keeper:check`: 234 checks passed.
- Full demo suite: 81 pass, 0 fail, 218 assertions.
- `bun run --cwd demo typecheck`: pass.
- `git diff --check`: pass with only the repository's existing LF-to-CRLF warnings.
