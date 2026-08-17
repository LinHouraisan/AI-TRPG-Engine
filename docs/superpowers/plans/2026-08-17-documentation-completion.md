# Remaining Design Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the 19 empty design documents using the repository's existing product and architecture decisions as the sole baseline.

**Architecture:** Documents are completed in dependency order: logical component boundaries first, authoritative data semantics second, AI task policy third, game-domain behavior fourth, and navigation plus cross-document verification last. Each document stays implementation-independent and refers to shared concepts instead of redefining competing versions of them.

**Tech Stack:** Markdown, PowerShell, ripgrep, Git.

## Global Constraints

- Keep the current conceptual design depth; do not define complete code-ready schemas or APIs.
- Do not select a programming language, framework, database, model provider, deployment topology, or fixed token budget.
- GM remains the only player-facing AI.
- AI output is a sourced candidate until deterministic validation and atomic commit.
- Committed structured state and immutable events are the only authoritative facts.
- Adjudication and commit precede official narration; narration retries do not repeat adjudication.
- Director does not directly change `StoryProgress`; there is no independent Story AI.
- Active Context, relationship indexes, projections, snapshots, and summaries remain derived or recoverable data with explicit authority boundaries.
- Do not modify completed documents unless verification identifies a blocking contradiction; report unrelated issues instead.

---

### Task 1: Complete Core Architecture Responsibilities

**Files:**
- Modify: `docs/01-architecture/runtime.md`
- Modify: `docs/01-architecture/context-broker.md`
- Modify: `docs/01-architecture/memory.md`
- Modify: `docs/01-architecture/domain-ai.md`

**Interfaces:**
- Consumes: component names and boundaries from `docs/01-architecture/overview.md`, turn ordering from `game-loop.md`, context rules from `active-context.md`, and AI boundaries from `gm.md` and `director.md`.
- Produces: stable responsibility boundaries used by the data, AI, and game-system documents.

- [ ] **Step 1: Write Runtime and Coordinator design**

Define turn ownership, phase transitions, version binding, candidate collection, validation, atomic commit, narration handoff, idempotent retry, cancellation, and failure recovery. Keep Turn Router, Rule Engine, Scenario Runtime, Validator, stores, and AI roles separate.

- [ ] **Step 2: Write Context Broker design**

Define request parsing, entity resolution, source selection, visibility filtering, version checks, bounded relationship expansion, returned source packages, cache interaction, and failure behavior. State explicitly that the Broker does not decide semantic relevance or own facts.

- [ ] **Step 3: Write Memory AI design**

Define triggers, source material, memory candidates, provenance, consolidation, correction, invalidation, visibility, and failure behavior. Preserve raw events and prevent summaries from replacing authoritative state.

- [ ] **Step 4: Write Domain AI design**

Define optional analyzer responsibilities, when deterministic logic is sufficient, candidate contracts, access boundaries, domain ownership, cross-domain effects, and fallback when analyzers are unavailable.

- [ ] **Step 5: Verify architecture boundaries**

Run:

```powershell
rg -n "直接(修改|写入|提交)|Story AI|事实源|权威" docs/01-architecture
git diff --check -- docs/01-architecture
```

Expected: no new text grants AI direct authoritative writes; no independent Story AI is introduced; whitespace check passes.

- [ ] **Step 6: Commit architecture documents**

```powershell
git add -- docs/01-architecture/runtime.md docs/01-architecture/context-broker.md docs/01-architecture/memory.md docs/01-architecture/domain-ai.md
git commit -m "docs: complete core architecture responsibilities"
```

### Task 2: Complete Authoritative Data Semantics

**Files:**
- Modify: `docs/02-data/entity-model.md`
- Modify: `docs/02-data/event-model.md`
- Modify: `docs/02-data/relationships.md`
- Modify: `docs/02-data/state.md`
- Modify: `docs/02-data/save-branch.md`

**Interfaces:**
- Consumes: authoritative-data boundaries from Task 1 and `docs/01-architecture/overview.md`.
- Produces: shared state, event, source, version, projection, snapshot, and branch semantics for Tasks 3 and 4.

- [ ] **Step 1: Write entity model design**

Define stable identity, immutable definitions versus runtime state, type and extension boundaries, source metadata, lifecycle, references, visibility, validation, and deletion or retirement semantics without prescribing storage tables.

- [ ] **Step 2: Write event model design**

Define immutable committed events, intent versus result records, causal references, ordering, branch and version binding, rule and RNG evidence, correction events, replay requirements, idempotency, and rejected-candidate handling.

- [ ] **Step 3: Write relationship design**

Distinguish authoritative relationship facts from the derived relationship index. Cover direction, type, source, temporal validity, visibility, traversal limits, invalidation, and rebuilding.

- [ ] **Step 4: Write state design**

Define current authoritative state, versioning, read views, transaction boundaries, optimistic conflict handling, state derivation, projections, consistency checks, and recovery from events and snapshots.

- [ ] **Step 5: Write save, replay, rollback, and branch design**

Define checkpoints, snapshots, branch ancestry, replay, rollback as a new active timeline, correction without history deletion, state hashes, content and rule references, model independence, and failed-load handling.

- [ ] **Step 6: Verify data authority language**

Run:

```powershell
rg -n "唯一权威|事实源|派生|可重建|不可变|分支|版本" docs/02-data
git diff --check -- docs/02-data
```

Expected: every secondary representation has an explicit authority boundary; event history is not destructively rewritten; whitespace check passes.

- [ ] **Step 7: Commit data documents**

```powershell
git add -- docs/02-data
git commit -m "docs: define authoritative data semantics"
```

### Task 3: Complete AI Task Policies

**Files:**
- Modify: `docs/03-ai/model-strategy.md`
- Modify: `docs/03-ai/context-strategy.md`
- Modify: `docs/03-ai/prompt-contracts.md`
- Modify: `docs/03-ai/token-budget.md`

**Interfaces:**
- Consumes: AI role boundaries from architecture documents and source/version/visibility semantics from Task 2.
- Produces: model selection, prompt construction, structured-output, and budget rules used by every AI role.

- [ ] **Step 1: Write model strategy**

Define logical-role separation from providers, capability declarations, task-to-model matching, BYOK boundary, model replacement, fallback, privacy, observability, failure isolation, and experiment-driven choices without naming a preferred provider.

- [ ] **Step 2: Write context strategy**

Define task-specific context construction, deterministic required inputs, Active Context selection, retrieval, source and visibility checks, branch/version binding, context isolation between roles, freshness, and missing-information behavior.

- [ ] **Step 3: Write prompt contracts**

Define instruction layers, input envelope, allowed output types, source references, version binding, schema and semantic validation, tool constraints, secret handling, retry and repair, and prompt-version traceability.

- [ ] **Step 4: Write token budget policy**

Define separate store and prompt budgets, mandatory reservations, priority ordering, degradation and summarization rules, output reservation, measurements, per-task tuning, and behavior when mandatory material cannot fit. Do not set universal numeric limits.

- [ ] **Step 5: Verify AI boundaries and placeholders**

Run:

```powershell
rg -n -i "TBD|TODO|FIXME|placeholder|待定|以后补" docs/03-ai
rg -n "供应商|固定|Token|权限|版本|来源" docs/03-ai
git diff --check -- docs/03-ai
```

Expected: placeholder scan has no matches; no provider or universal numeric budget is mandated; whitespace check passes.

- [ ] **Step 6: Commit AI documents**

```powershell
git add -- docs/03-ai
git commit -m "docs: define AI task and context policies"
```

### Task 4: Complete Game-System Domains

**Files:**
- Modify: `docs/04-game-system/npc.md`
- Modify: `docs/04-game-system/items.md`
- Modify: `docs/04-game-system/rules.md`
- Modify: `docs/04-game-system/scenario.md`
- Modify: `docs/04-game-system/world.md`

**Interfaces:**
- Consumes: authoritative data semantics from Task 2, AI boundaries from Task 3, and domain ownership from architecture documents.
- Produces: consistent domain-level definitions, state, constraints, events, views, and cross-domain collaboration rules.

- [ ] **Step 1: Write NPC domain design**

Define NPC definitions and state, identity, location, condition, knowledge, goals, relationships, plans, commitments, perception and visibility, GM portrayal, candidate changes, events, and consistency rules.

- [ ] **Step 2: Write item domain design**

Define item definitions and instances, ownership and containment, quantity, durability, charges, effects, transfers, creation and destruction, visibility, event sources, and atomic invariants.

- [ ] **Step 3: Write rule-system design**

Define Rule Pack scope, action resolution, checks, modifiers, RNG evidence, deterministic decisions, ambiguity and house rules, rule explanations, effect candidates, version compatibility, and unsupported-action behavior.

- [ ] **Step 4: Write scenario-system design**

Define immutable scenario canon, nodes, conditions, clues, secrets, paths, endings, `StoryProgress`, deterministic Scenario Runtime transitions, Director proposals, adaptive content markers, fail-forward, and completion or failure.

- [ ] **Step 5: Write world-system design**

Define world definitions and state, time, places, global conditions, scheduled consequences, cross-scene effects, World AI candidate boundary, visibility, events, and bounded simulation scope.

- [ ] **Step 6: Verify domain ownership and scope**

Run:

```powershell
rg -n "Definition|State|事件|来源|可见|直接(修改|提交)|StoryProgress" docs/04-game-system
git diff --check -- docs/04-game-system
```

Expected: definitions are distinct from runtime state; cross-domain changes use candidates and committed events; Scenario Runtime alone commits story progress; whitespace check passes.

- [ ] **Step 7: Commit game-system documents**

```powershell
git add -- docs/04-game-system
git commit -m "docs: complete game system domains"
```

### Task 5: Build Documentation Entry Point and Run Global Verification

**Files:**
- Modify: `docs/Readme.md`

**Interfaces:**
- Consumes: all completed product and design documents.
- Produces: repository documentation map and recommended reading order.

- [ ] **Step 1: Write the documentation index**

Describe the purpose of the documentation set, its authority and maturity, a recommended reading order, and grouped relative links for product, architecture, data, AI, and game-system documents. Explain that the documents define logical design rather than a fixed deployment topology.

- [ ] **Step 2: Verify no Markdown file remains empty**

Run:

```powershell
$empty = rg --files -g '*.md' | Where-Object { (Get-Item -LiteralPath $_).Length -eq 0 }
$empty
```

Expected: no output.

- [ ] **Step 3: Verify relative Markdown links**

Run a PowerShell link check that extracts local `(...md)` targets from every Markdown file, resolves each target relative to its source file, and reports missing files.

Expected: no missing local Markdown target.

- [ ] **Step 4: Verify terminology and forbidden placeholders**

Run:

```powershell
rg -n -i "TBD|TODO|FIXME|placeholder|待定|以后补" -g '*.md'
rg -n "Story AI|Active Context" docs
git diff --check
```

Expected: placeholder scan has no unresolved matches; `Story AI` appears only in text explicitly rejecting an independent Story AI; every Active Context use distinguishes Manager, Store, subsystem, or concept; whitespace check passes.

- [ ] **Step 5: Review the complete diff against the approved design**

Check that all 19 target files contain substantive text, no completed source document was modified, each document stays within its topic, and every global constraint is reflected consistently.

- [ ] **Step 6: Commit the documentation index**

```powershell
git add -- docs/Readme.md
git commit -m "docs: add design documentation index"
```
