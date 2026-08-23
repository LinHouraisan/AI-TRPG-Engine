# Mist Harbor Investigator Creation and Demo Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete fixed-attribute CoC 7e skill-allocation opening, campaign-persisted life history, character-sheet feedback, safe authored investigation checks, three-turn NPC continuity, stronger GM narration, and correct checkpoint recap/history rendering for the Mist Harbor demo.

**Architecture:** Keep the demo's event-sourced `GameState` and deterministic rules boundary. Store one immutable investigator profile per campaign, project it into the initial event stream, and let authored Scenario Pack investigation opportunities turn model-understood free text into program-validated checks. Conversation and restore views read bounded persisted history; the model never receives hidden facts outside the active NPC's knowledge.

**Tech Stack:** TypeScript 5.8, React 19, Electron 37, Bun 1.3, Zod 4, SQLite/better-sqlite3, existing deterministic percentile rules.

**Spec:** `docs/superpowers/specs/2026-08-24-mist-harbor-investigator-and-demo-repairs-design.md`

## Global Constraints

- Windows x64 remains the only release target for this demo.
- Use Mist Harbor's fixed characteristics; occupation points are `EDU * 4`, interest points are `INT * 2`, and final skills must remain in `1..90`.
- An investigator is immutable after formal play starts; no in-place edit API is allowed.
- Models may propose only authored investigation IDs and dialogue; programs validate checks, RNG, visibility, and commits.
- NPC context contains only that NPC's knowledge, public player statements, current perception, life-history relationship, and the latest three dialogue turns.
- Restore shows a checkpoint-bounded recap followed by up to three real player/GM turns and never pads with the opening.
- Preserve API keys and provider configuration outside campaign databases and exports.
- Every implementation task follows Red → Green → Refactor and ends in a focused commit.

---

### Task 1: Investigator Creation Domain and Point Accounting

**Files:**
- Create: `demo/src/character/creation.ts`
- Create: `demo/src/character/creation.test.ts`
- Create: `demo/src/character/types.ts`
- Modify: `demo/src/engine/schema.ts`
- Modify: `demo/src/engine/pack.ts`
- Modify: `demo/src/data/packs/mist-harbor/pack.json`
- Test: `demo/scripts/mist-harbor-check.ts`

**Interfaces:**
- Produces: `InvestigatorCreationRules`, `LifeHistoryDef`, `InvestigatorAllocation`, and `InvestigatorProfile` from `demo/src/character/types.ts`.
- Produces: `allocationBudget(rules): { occupation: number; interest: number }`.
- Produces: `validateAllocation(rules, allocation): { ok: true; profile: InvestigatorProfile } | { ok: false; issues: AllocationIssue[] }`.
- Consumes later: profile hashing and persistence in Task 2; UI reducer in Task 3.

- [ ] **Step 1: Write failing point-accounting tests**

```ts
import { expect, test } from "bun:test";
import { allocationBudget, validateAllocation } from "./creation";
import { pack } from "@/engine/pack";

test("fixed characteristics produce separate CoC 7e budgets", () => {
  expect(allocationBudget(pack.manifest.creation)).toEqual({
    occupation: pack.manifest.creation.characteristics.EDU * 4,
    interest: pack.manifest.creation.characteristics.INT * 2,
  });
});

test("allocation must spend both budgets exactly and cap final skills at 90", () => {
  const invalid = validateAllocation(pack.manifest.creation, {
    name: "林晚",
    lifeHistoryId: "history.archive-correspondent",
    occupationPoints: { 侦查: 999 },
    interestPoints: {},
  });
  expect(invalid.ok).toBe(false);
  if (!invalid.ok) expect(invalid.issues.map((issue) => issue.code)).toContain("SKILL_OVER_CAP");
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `bun test demo/src/character/creation.test.ts`

Expected: FAIL because `demo/src/character/creation.ts` and manifest creation data do not exist.

- [ ] **Step 3: Add exact creation types and validation**

```ts
export type InvestigatorAllocation = {
  name: string;
  lifeHistoryId: string;
  occupationPoints: Record<string, number>;
  interestPoints: Record<string, number>;
};

export type InvestigatorProfile = {
  name: string;
  occupation: string;
  characteristics: Record<"STR"|"CON"|"SIZ"|"DEX"|"APP"|"INT"|"POW"|"EDU", number>;
  baseSkills: Record<string, number>;
  occupationPoints: Record<string, number>;
  interestPoints: Record<string, number>;
  skills: Record<string, number>;
  hp: number;
  san: number;
  sanMax: number;
  lifeHistoryId: string;
  contentVersion: string;
};
```

Implement `validateAllocation` so it rejects negative or fractional points, occupation points on non-occupation skills, unknown history IDs, incorrect separate totals, and final values outside `1..90`. Return the fully derived profile only on success.

- [ ] **Step 4: Extend the manifest schema and Mist Harbor content**

Add `manifest.creation` with fixed characteristics, base skills, reporter occupation skills, `maxSkill: 90`, and exactly four authored histories. Each history must name exactly one initial grant, one NPC relationship, and one investigation opportunity ID. Extend `mist-harbor-check.ts` to assert all references exist and no history directly grants an ending condition.

- [ ] **Step 5: Run domain and pack checks**

Run: `bun test demo/src/character/creation.test.ts`

Run: `bun run --cwd demo pack:lint`

Run: `bun run --cwd demo mist:check`

Expected: all PASS.

- [ ] **Step 6: Commit the domain milestone**

```powershell
git add -- demo/src/character demo/src/engine/schema.ts demo/src/engine/pack.ts demo/src/data/packs/mist-harbor/pack.json demo/scripts/mist-harbor-check.ts
git commit -m "feat: define Mist Harbor investigator creation"
```

### Task 2: Immutable Campaign Investigator Persistence

**Files:**
- Create: `electron/sql/campaign-0004-investigator.sql`
- Create: `electron/main/persist/investigator.ts`
- Create: `electron/main/persist/investigator.test.ts`
- Modify: `electron/main/composition.ts`
- Modify: `electron/main/services/campaigns.ts`
- Modify: `electron/main/ipc/register.ts`
- Modify: `electron/shared/api.ts`
- Modify: `electron/preload/index.ts`
- Modify: `demo/src/desktop.ts`
- Modify: `demo/src/engine/types.ts`
- Modify: `demo/src/engine/events.ts`
- Modify: `demo/src/cards/apply.ts`
- Test: `electron/scripts/persist-check.ts`

**Interfaces:**
- Consumes: `InvestigatorProfile` and `validateAllocation` from Task 1.
- Produces: `saveInvestigator(db, input): InvestigatorRecord`, `bindInvestigator(db, branchId, profileId): void`, and `loadInvestigator(db, branchId): InvestigatorRecord | null`.
- Produces IPC: `campaign.confirmInvestigator(input): Promise<Result<{ profile: InvestigatorProfile; branchId: string; stateVersion: number; checkpointId: string }>>`.
- Produces IPC: `campaign.getInvestigator({campaignId}): Promise<Result<InvestigatorProfile | null>>`.

- [ ] **Step 1: Write failing persistence tests**

```ts
test("confirmed investigator binding is immutable and survives reopen", () => {
  const first = saveInvestigator(db, { profile, profileHash: hashProfile(profile), createdAt: now });
  bindInvestigator(db, branchId, first.profileId);
  expect(loadInvestigator(db, branchId)).toEqual(first);
  expect(() => bindInvestigator(db, branchId, otherProfileId))
    .toThrow("investigator.branch_already_bound");
});
```

Extend `persist-check.ts` to confirm the investigator, close/reopen the campaign, restore a checkpoint copy, and assert the canonical profile JSON and SHA-256 hash are unchanged.

- [ ] **Step 2: Run tests and confirm RED**

Run: `bun test electron/main/persist/investigator.test.ts`

Run: `bun run --cwd electron persist:check`

Expected: FAIL because migration `0004_investigator` and persistence API do not exist.

- [ ] **Step 3: Add the immutable table and repository**

Create append-only `investigator_profiles` with `profile_id` primary key, canonical `profile_json`, `profile_hash`, `content_version`, and `created_at`. Add `branch_investigator_bindings` with `branch_id` primary key and `profile_id` foreign key. Ordinary branch/copy creation inherits the source binding; only an unstarted branch with no formal-play events may create a different immutable profile. Do not add UPDATE or delete APIs. Register the migration after `0003_checkpoint_tests` in `composition.ts`.

- [ ] **Step 4: Make confirmation atomic**

In `CampaignService.confirmInvestigator`, validate allocation again in Main, then in one transaction insert the profile, commit `sheet_applied` plus history grant/relationship events, and create the `正式开局前` checkpoint. Reject confirmation when the branch already contains formal-play turns or a profile exists.

Extend `sheet_applied` with fixed characteristics, point-source maps, and `lifeHistoryId`; update event replay so `GameState` carries the persisted projection.

- [ ] **Step 5: Wire strict IPC contracts**

Add Zod schemas for the allocation request and exact response types. Preload exposes only `confirmInvestigator` and `getInvestigator`; there is no edit endpoint.

- [ ] **Step 6: Verify persistence and replay**

Run: `bun test electron/main/persist/investigator.test.ts`

Run: `bun run --cwd electron persist:check`

Run: `bun run --cwd electron checkpoint:check`

Expected: all PASS; source and restored branches resolve the same profile hash.

- [ ] **Step 7: Commit the persistence milestone**

```powershell
git add -- electron/sql/campaign-0004-investigator.sql electron/main/persist/investigator.ts electron/main/persist/investigator.test.ts electron/main/composition.ts electron/main/services/campaigns.ts electron/main/ipc/register.ts electron/shared/api.ts electron/preload/index.ts demo/src/desktop.ts demo/src/engine/types.ts demo/src/engine/events.ts demo/src/cards/apply.ts electron/scripts/persist-check.ts
git commit -m "feat: persist immutable campaign investigators"
```

### Task 3: Opening Wizard and Character-Sheet Feedback

**Files:**
- Create: `demo/src/ui/investigator-creation-state.ts`
- Create: `demo/src/ui/investigator-creation-state.test.ts`
- Create: `demo/src/ui/InvestigatorCreation.tsx`
- Modify: `demo/src/ui/FirstRunFlow.tsx`
- Modify: `demo/src/ui/InvestigatorSheet.tsx`
- Modify: `demo/src/App.tsx`
- Modify: `demo/src/session.ts`
- Test: `demo/src/session-opening.test.ts`

**Interfaces:**
- Consumes: Task 1 rules/validation and Task 2 IPC.
- Produces: `CreationState`, `creationReducer(state, action)`, and `CreationStep = "premise" | "occupation" | "skills" | "history" | "review"`.
- Produces session fields: `investigatorProfile`, `activeCheckPreview`, and `confirmInvestigator(allocation)`.

- [ ] **Step 1: Write failing reducer and opening tests**

```ts
test("cannot advance from skills until both point pools are exactly spent", () => {
  const state = initialCreationState(rules);
  const next = creationReducer(state, { type: "go", step: "history" });
  expect(next.step).toBe("skills");
  expect(next.issues.some((issue) => issue.code === "POINTS_REMAINING")).toBe(true);
});

test("formal opening is absent until investigator confirmation", () => {
  expect(createOpening(initialState(), null).map((message) => message.text).join(" "))
    .not.toContain(pack.manifest.opening);
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `bun test demo/src/ui/investigator-creation-state.test.ts demo/src/session-opening.test.ts`

Expected: FAIL because the creation reducer and gated opening do not exist.

- [ ] **Step 3: Implement the reducer and wizard**

Build five explicit steps: premise, fixed occupation/characteristics, full point allocation, one life-history choice, and final review. Use numeric steppers plus direct integer input, show separate remaining pools, and disable confirmation on any validation issue. Keep all validation in Task 1 domain functions; UI only renders issues.

- [ ] **Step 4: Gate formal play and persist confirmation**

While no profile exists, hide Composer and suggestions and render `InvestigatorCreation`. Confirmation calls Task 2 IPC, reloads branch state, then displays the authored opening and enables play. Browser-only fallback uses the same profile/event projection without pretending to be durable.

- [ ] **Step 5: Add character-sheet linkage**

Render characteristics, life history, public relationship, and expandable base/occupation/interest contributions. Add an `activeCheckPreview` panel that shows candidate skill/difficulty before submission and actual roll/result after commit; clear it on the next unrelated action.

- [ ] **Step 6: Verify UI state and build**

Run: `bun test demo/src/ui/investigator-creation-state.test.ts demo/src/session-opening.test.ts`

Run: `bun run --cwd demo typecheck`

Run: `bun run --cwd demo build`

Expected: all PASS.

- [ ] **Step 7: Commit the opening milestone**

```powershell
git add -- demo/src/ui/investigator-creation-state.ts demo/src/ui/investigator-creation-state.test.ts demo/src/ui/InvestigatorCreation.tsx demo/src/ui/FirstRunFlow.tsx demo/src/ui/InvestigatorSheet.tsx demo/src/App.tsx demo/src/session.ts demo/src/session-opening.test.ts
git commit -m "feat: add complete investigator opening flow"
```

### Task 4: Authored Investigation Opportunities and Figure 1 Regression

**Files:**
- Modify: `demo/src/engine/schema.ts`
- Modify: `demo/src/engine/pack.ts`
- Modify: `demo/src/engine/types.ts`
- Create: `demo/src/engine/investigation.ts`
- Create: `demo/src/engine/investigation.test.ts`
- Modify: `demo/src/data/packs/mist-harbor/pack.json`
- Create: `demo/src/data/packs/mist-harbor/investigations.json`
- Modify: `demo/src/keeper/contract.ts`
- Modify: `demo/src/keeper/keeper.ts`
- Modify: `demo/src/keeper/free-turn.ts`
- Modify: `demo/src/keeper/free-turn.test.ts`
- Modify: `demo/src/engine/resolve.ts`
- Modify: `demo/src/engine/play-turn.ts`
- Modify: `electron/main/services/turns.ts`
- Test: `demo/scripts/mist-harbor-check.ts`

**Interfaces:**
- Produces: `InvestigationDef`, `visibleInvestigations(state, profile)`, and `resolveInvestigation({state, profile, id, skill, rng})`.
- Extends free-turn decision with `{ kind: "investigation"; investigationId: string; skill: string; approach: string }`.
- Consumes: profile/history from Tasks 1–2 and existing `CheckResult`/RNG.

- [ ] **Step 1: Write the Figure 1 failing regression**

```ts
test("searching for leverage on the conductor selects an authored Spot Hidden check", async () => {
  const result = await handleFreeTurn(fixture({
    spoken: "查看四周，重点注意是否有可以让列车员回答问题的办法",
    model: { kind: "investigation", investigationId: "investigation.conductor-leverage", skill: "侦查", approach: "寻找能让列车员开口的细节" },
  }));
  expect(result.intent).toEqual({
    kind: "investigation",
    investigationId: "investigation.conductor-leverage",
    skill: "侦查",
    approach: "寻找能让列车员开口的细节",
  });
});
```

Add tests rejecting hidden, wrong-room, unknown, and life-history-ineligible IDs, and asserting deterministic `check_resolved` plus authored success/failure drafts.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `bun test demo/src/engine/investigation.test.ts demo/src/keeper/free-turn.test.ts`

Expected: FAIL because investigation schema and intent do not exist.

- [ ] **Step 3: Add Scenario Pack investigation definitions**

Define the conductor-leverage opportunity and the four additional opportunities referenced by the authored life histories. Each definition includes room, visibility predicate, phrases/description for the model, default and alternate skills, difficulty, minutes, and authored outcome effects.

- [ ] **Step 4: Extend the free-turn contract safely**

Expose only currently visible investigation IDs and allowed skills in route context. Parse the structured candidate, then revalidate ID, room, predicate, skill, history, and `stateVersion` in program code. Ambiguous or invalid proposals return clarification without RNG or events.

- [ ] **Step 5: Resolve and commit checks**

Use the existing deterministic percentile rule path and event transaction. The model never supplies roll or success. Surface candidate and final check through Task 3's sheet linkage.

- [ ] **Step 6: Verify regression and content reachability**

Run: `bun test demo/src/engine/investigation.test.ts demo/src/keeper/free-turn.test.ts`

Run: `bun run --cwd demo mist:check`

Run: `bun run --cwd electron gold`

Expected: all PASS, including the exact Figure 1 sentence.

- [ ] **Step 7: Commit the investigation milestone**

```powershell
git add -- demo/src/engine/schema.ts demo/src/engine/pack.ts demo/src/engine/types.ts demo/src/engine/investigation.ts demo/src/engine/investigation.test.ts demo/src/data/packs/mist-harbor/pack.json demo/src/data/packs/mist-harbor/investigations.json demo/src/keeper/contract.ts demo/src/keeper/keeper.ts demo/src/keeper/free-turn.ts demo/src/keeper/free-turn.test.ts demo/src/engine/resolve.ts demo/src/engine/play-turn.ts electron/main/services/turns.ts demo/scripts/mist-harbor-check.ts
git commit -m "feat: adjudicate authored free investigations"
```

### Task 5: Three-Turn NPC Dialogue Context and Figure 2 Regression

**Files:**
- Create: `demo/src/keeper/dialogue-context.ts`
- Create: `demo/src/keeper/dialogue-context.test.ts`
- Modify: `demo/src/keeper/context.ts`
- Modify: `demo/src/keeper/keeper.ts`
- Modify: `demo/src/keeper/free-turn.ts`
- Modify: `demo/src/data/packs/mist-harbor/npcs.json`
- Modify: `electron/main/persist/turns.ts`
- Modify: `electron/main/services/turns.ts`
- Modify: `demo/src/session.ts`
- Test: `demo/src/keeper/free-turn.test.ts`

**Interfaces:**
- Produces: `DialogueTurn = { player: string; gm: string }` and `buildNpcDialogueContext({npcId,state,recentTurns,profile}): string`.
- Extends keeper route/narrate inputs with `recentTurns: DialogueTurn[]` limited to the latest three before prompt construction.
- Consumes: NPC authored knowledge, visible facts, and life-history relationship.

- [ ] **Step 1: Write the Figure 2 failing regression**

```ts
test("bare agreement continues the girl's previous question", async () => {
  const recentTurns = [{ player: "询问女孩的名字", gm: "你能替我记住一个名字吗？" }];
  const routed = await keeperRoute(fixture({ spoken: "可以", recentTurns }));
  expect(routed.intent.kind).toBe("talk");
});
```

Add a negative test placing a secret fact in another NPC's knowledge and assert it is absent from the girl's assembled context and rejected by narration guard.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `bun test demo/src/keeper/dialogue-context.test.ts demo/src/keeper/free-turn.test.ts`

Expected: FAIL because recent turns are not route/narration inputs.

- [ ] **Step 3: Load bounded recent dialogue**

Add a persistence query returning the latest three final player/GM pairs regardless of whether the turn committed domain events. Pass those pairs into both route and narration calls in desktop and browser paths.

- [ ] **Step 4: Assemble NPC-scoped knowledge**

Resolve the NPC present in the current scene; include only authored `knownFacts`, public state facts, current perception, relationship text for the chosen life history, and recent dialogue. Do not pass the entire Scenario Pack or all NPC keeper notes.

- [ ] **Step 5: Verify continuity and secrecy**

Run: `bun test demo/src/keeper/dialogue-context.test.ts demo/src/keeper/free-turn.test.ts`

Run: `bun run --cwd demo keeper:check`

Expected: “可以”, “继续问她”, and “刚才那个名字” route as continuing talk; hidden-fact fixtures remain absent.

- [ ] **Step 6: Commit the dialogue milestone**

```powershell
git add -- demo/src/keeper/dialogue-context.ts demo/src/keeper/dialogue-context.test.ts demo/src/keeper/context.ts demo/src/keeper/keeper.ts demo/src/keeper/free-turn.ts demo/src/data/packs/mist-harbor/npcs.json electron/main/persist/turns.ts electron/main/services/turns.ts demo/src/session.ts demo/src/keeper/free-turn.test.ts
git commit -m "fix: preserve bounded NPC dialogue context"
```

### Task 6: GM Response Quality Contract

**Files:**
- Modify: `demo/src/keeper/contract.ts`
- Modify: `demo/src/keeper/keeper.ts`
- Modify: `demo/src/keeper/guard.ts`
- Modify: `demo/src/keeper/guard.test.ts`
- Modify: `demo/src/keeper/free-turn.test.ts`

**Interfaces:**
- Produces structured narration reply `{ text: string; feedback: string; reaction: string; interactionPoints: string[] }` while displaying only `text`.
- Produces `checkNarrationQuality(reply, mode): GuardVerdict`, where `mode` distinguishes simple query from investigation/dialogue/exploration.

- [ ] **Step 1: Write failing semantic quality tests**

```ts
test("dialogue narration requires feedback, reaction, and an interaction point", () => {
  expect(checkNarrationQuality({ text: "她看着你。", feedback: "", reaction: "", interactionPoints: [] }, "dialogue"))
    .toEqual({ ok: false, reason: "missing_feedback" });
});

test("quality does not accept repeated padding", () => {
  const repeated = "她看着你。".repeat(40);
  expect(checkNarrationQuality({ text: repeated, feedback: repeated, reaction: repeated, interactionPoints: [repeated] }, "dialogue").ok)
    .toBe(false);
});
```

- [ ] **Step 2: Run guard tests and confirm RED**

Run: `bun test demo/src/keeper/guard.test.ts demo/src/keeper/free-turn.test.ts`

Expected: FAIL because structured quality fields and semantic guard do not exist.

- [ ] **Step 3: Update prompt and schema**

Require the model to separately draft现场反馈, NPC/环境反应, and one or more natural interaction points, then provide a cohesive 150–350-character `text`. Allow deterministic queries to use the existing shorter path.

- [ ] **Step 4: Add quality validation without a hard minimum**

Reject missing semantic fields, interaction points not reflected in text, excessive repeated n-grams, unauthorized facts, and uncommitted outcomes. Treat length outside the target as a retry hint unless it is empty or exceeds the existing 900-character safety cap.

- [ ] **Step 5: Verify quality and fallback behavior**

Run: `bun test demo/src/keeper/guard.test.ts demo/src/keeper/free-turn.test.ts`

Run: `bun run --cwd demo keeper:check`

Expected: all PASS; two failed model attempts still return a safe non-leaking fallback.

- [ ] **Step 6: Commit the narration milestone**

```powershell
git add -- demo/src/keeper/contract.ts demo/src/keeper/keeper.ts demo/src/keeper/guard.ts demo/src/keeper/guard.test.ts demo/src/keeper/free-turn.test.ts
git commit -m "fix: enforce useful GM response structure"
```

### Task 7: Checkpoint-Bounded Recap and Figure 3 Regression

**Files:**
- Modify: `electron/sql/campaign-0003-checkpoint-tests.sql`
- Modify: `electron/main/persist/checkpoints.ts`
- Modify: `electron/main/persist/turns.ts`
- Modify: `electron/main/services/turns.ts`
- Modify: `demo/src/desktop-play.ts`
- Modify: `demo/src/desktop-play.test.ts`
- Modify: `demo/src/session.ts`
- Modify: `demo/src/session-opening.test.ts`
- Modify: `demo/src/ui/CheckpointTests.tsx`
- Test: `electron/scripts/checkpoint-check.ts`

**Interfaces:**
- Produces checkpoint field `recap: string` generated from public events at or before `eventSequence` plus the immutable investigator premise/history.
- Produces `loadBranchHistory(db, branchId, upperBound?): { recap; recentTurns; restoredFrom }`, where `upperBound` contains checkpoint `stateVersion` and `eventSequence`.
- Consumes: immutable profile from Task 2.

- [ ] **Step 1: Write the Figure 3 failing regression**

```ts
test("restored view renders recap then exactly the real latest three turns", () => {
  const messages = createRestoredMessages(state, {
    recap: "林晚因沈鹭寄来的车票来到雾港站，并发现末班车名单有异常。",
    recentTurns: turns.slice(-3),
    restoredFrom: "第三幕前",
  });
  expect(messages[0].text).toStartWith("前情提要：林晚因沈鹭");
  expect(messages.filter((message) => message.role === "pl")).toHaveLength(3);
  expect(messages.some((message) => message.text === pack.manifest.opening)).toBe(false);
});
```

Add a two-turn case expecting two pairs only and a checkpoint-bound case proving post-checkpoint dialogue is absent.

- [ ] **Step 2: Run restore tests and confirm RED**

Run: `bun test demo/src/session-opening.test.ts demo/src/desktop-play.test.ts`

Run: `bun run --cwd electron checkpoint:check`

Expected: FAIL on checkpoint-bounded recap/history behavior.

- [ ] **Step 3: Persist recap at checkpoint creation**

Store a public recap derived from the immutable premise/history plus public event summaries through the checkpoint sequence. Do not invoke a live model while creating or restoring a checkpoint. Add a new migration if changing the already-applied `0003` checksum would break existing databases; do not mutate an applied migration in production code.

- [ ] **Step 4: Bound copied history and restore rendering**

Copy/select only turns and final narrations whose committed version is at or before the checkpoint, while retaining eventless dialogue turns created before the checkpoint timestamp/sequence boundary. Return the persisted recap and latest three real pairs. `createRestoredMessages` must not call `createOpening` or synthesize missing pairs.

- [ ] **Step 5: Verify restore correctness**

Run: `bun test demo/src/session-opening.test.ts demo/src/desktop-play.test.ts`

Run: `bun run --cwd electron checkpoint:check`

Run: `bun run --cwd electron persist:check`

Expected: all PASS and source branch remains unchanged.

- [ ] **Step 6: Commit the restore milestone**

```powershell
git add -- electron/sql electron/main/persist/checkpoints.ts electron/main/persist/turns.ts electron/main/services/turns.ts demo/src/desktop-play.ts demo/src/desktop-play.test.ts demo/src/session.ts demo/src/session-opening.test.ts demo/src/ui/CheckpointTests.tsx electron/scripts/checkpoint-check.ts
git commit -m "fix: restore checkpoint recap and three-turn history"
```

### Task 8: Integrated Demo Certification and Windows Package

**Files:**
- Modify: `electron/scripts/mist-harbor-e2e.ts`
- Modify: `docs/demo/mist-harbor-test-cases.md`
- Modify: `docs/demo/mist-harbor-known-issues.md`

**Interfaces:**
- Consumes all prior task interfaces.
- Produces a certified Windows demo build in the existing `electron/release/win-unpacked` location.

- [ ] **Step 1: Add one integrated scripted scenario**

The E2E must create an investigator, spend both pools exactly, select a history, confirm and reopen the campaign, execute the exact Figure 1 sentence, complete the Figure 2 exchange including “可以”, create a checkpoint after at least three turns, advance further, restore a copy, and assert Figure 3 history excludes later turns.

- [ ] **Step 2: Run targeted suites**

Run: `bun test demo/src/character/creation.test.ts demo/src/ui/investigator-creation-state.test.ts demo/src/engine/investigation.test.ts demo/src/keeper/dialogue-context.test.ts demo/src/keeper/guard.test.ts demo/src/session-opening.test.ts demo/src/desktop-play.test.ts`

Expected: all PASS.

- [ ] **Step 3: Run full Demo verification**

Run: `bun test --cwd demo`

Run: `bun run --cwd demo smoke`

Run: `bun run --cwd demo typecheck`

Run: `bun run --cwd demo build`

Expected: all PASS.

- [ ] **Step 4: Run full Electron verification**

Run: `bun run --cwd electron persist:check`

Run: `bun run --cwd electron checkpoint:check`

Run: `bun run --cwd electron gold`

Run: `bun run --cwd electron content:check`

Run: `bun run --cwd electron demo:e2e`

Run: `bun run --cwd electron build:main`

Expected: all PASS.

- [ ] **Step 5: Build the Windows demo package**

Run: `bun run --cwd electron package:win`

Expected: package command completes and `electron/release/win-unpacked/AI TRPG Engine.exe` exists. If the documented environment-level electron-builder packaging hang recurs, stop and report it; do not claim a newly packaged build by copying an older shell.

- [ ] **Step 6: Perform the manual screenshot regression**

On a fresh campaign, reproduce all three user-reported scenes, verify character-sheet highlighting, inspect the girl's answer for hidden-fact leakage, close/reopen, restore the checkpoint, and record actual results in `docs/demo/mist-harbor-test-cases.md`.

- [ ] **Step 7: Update demo boundary documentation**

Document the fixed-attribute reporter constraint, supported authored histories, immutable-after-start behavior, DeepSeek dependency, and any remaining non-blocking limitations. Do not label the build V1.0.

- [ ] **Step 8: Commit certification evidence**

```powershell
git add -- electron/scripts/mist-harbor-e2e.ts docs/demo/mist-harbor-test-cases.md docs/demo/mist-harbor-known-issues.md
git commit -m "test: certify investigator-driven Mist Harbor demo"
```
