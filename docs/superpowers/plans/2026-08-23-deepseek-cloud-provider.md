# DeepSeek Cloud Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure DeepSeek cloud narration to the packaged Electron app while retaining Ollama and deterministic fallback behavior.

**Architecture:** Keep the React renderer in `demo/`, but send model traffic from Electron Main. Extend the existing keeper client with an OpenAI-compatible protocol branch, resolve the configured provider/profile/credential in Main, and expose only write/has/delete secret operations to Renderer.

**Tech Stack:** TypeScript, React 19, Electron 37, Bun 1.3.13, Zod, `safeStorage`, `fetch`

**Spec:** Approved in chat on 2026-08-23: DeepSeek preset over a generic OpenAI-compatible adapter; encrypted API key; GM only; Ollama and template fallback retained.

## Global Constraints

- Never return an API key to Renderer after it is submitted.
- Never write plaintext secrets to SQLite, logs, exports, or test output.
- Use `https://api.deepseek.com` and `deepseek-v4-flash` as DeepSeek defaults.
- Information, Director, and Memory remain deterministic for this slice.
- Model failure must preserve committed game state and fall back to template narration.

---

### Task 1: OpenAI-compatible keeper protocol

**Files:**
- Modify: `demo/src/keeper/config.ts`
- Modify: `demo/src/keeper/client.ts`
- Create: `demo/src/keeper/client.test.ts`

**Interfaces:**
- Consumes: existing `KeeperConfig` and Zod response contracts.
- Produces: `KeeperConfig.protocol: "ollama" | "openai_compatible"` and optional `apiKey`; `askKeeper()` selects the correct HTTP contract.

- [ ] Write tests that stub `fetch`, call the real `askKeeper()`, and assert OpenAI-compatible requests use `/chat/completions`, `Authorization: Bearer`, `response_format: { type: "json_object" }`, and parse `choices[0].message.content`.
- [ ] Run `bun test src/keeper/client.test.ts`; expect failure because the protocol branch is absent.
- [ ] Add the minimal protocol branch while leaving the Ollama branch unchanged.
- [ ] Re-run the focused test and existing keeper checks; expect pass.

### Task 2: Main-process provider and credential resolution

**Files:**
- Modify: `electron/main/composition.ts`
- Modify: `electron/main/services/turns.ts`
- Modify: `electron/main/persist/providers.ts`
- Modify: `electron/main/ipc/register.ts`
- Create: `electron/scripts/cloud-provider-check.ts`
- Modify: `electron/package.json`

**Interfaces:**
- Consumes: provider instances, model profiles, GM task routes, and `CredentialStore.use()`.
- Produces: a `KeeperConfig` for either Ollama or DeepSeek without exposing plaintext outside Main; IPC `settings:testProvider` performs a minimal authenticated request.

- [ ] Add a failing check with an in-memory settings database and fake cipher proving a DeepSeek provider resolves to OpenAI-compatible protocol, model, Base URL, and decrypted credential only inside a callback.
- [ ] Run `bun run cloud:check`; expect failure because provider resolution does not exist.
- [ ] Pass `CredentialStore` into `TurnService`, resolve only GM routes from provider/profile tables, and keep background jobs deterministic.
- [ ] Register a validated provider connection-test IPC handler that returns success/error metadata without returning secrets.
- [ ] Re-run `cloud:check` and `persist:check`; expect pass after the existing Windows pack-path issue is addressed within the verification task.

### Task 3: Desktop settings UI

**Files:**
- Modify: `demo/src/desktop.ts`
- Modify: `electron/shared/api.ts`
- Modify: `electron/preload/index.ts`
- Modify: `demo/src/ui/ModelSettings.tsx`
- Create: `demo/src/ui/model-settings.test.ts`

**Interfaces:**
- Consumes: secret write/has/delete, provider upsert, profile upsert, and provider test IPC.
- Produces: an Electron-only DeepSeek form with provider preset, Base URL, model, masked API-key status, save, delete, and test actions.

- [ ] Add a failing pure-state test proving the DeepSeek preset selects `openai_compatible`, `https://api.deepseek.com`, and `deepseek-v4-flash` without retaining the key after save.
- [ ] Run the focused test; expect failure because the preset/state helper is absent.
- [ ] Implement the minimum settings UI and bridge types; attach the returned `credentialId` to the provider row.
- [ ] Re-run focused tests and `bun run typecheck`; expect pass.

### Task 4: Windows path quality gate and release verification

**Files:**
- Modify: `demo/src/engine/pack.ts`
- Modify: `demo/src/engine/pack-root.test.ts`
- Rebuild: `electron/release/AI TRPG Engine-0.1.0-win-x64.exe`

**Interfaces:**
- Consumes: existing Bun pack scan and packaging scripts.
- Produces: Windows-compatible pack scanning so smoke/gold/persistence gates can run before release.

- [ ] Extend the existing path regression test with a Windows file-URL pathname case.
- [ ] Run it and confirm failure against `/C:/...`.
- [ ] Convert file URLs with the platform path utility before passing the directory to `Bun.Glob`.
- [ ] Run `typecheck`, `smoke`, `store:check`, `card:check`, Electron `persist:check`, `gold`, `content:check`, and the cloud checks.
- [ ] Run `package:win`, install silently, launch the installed app, and verify the process remains responsive.
- [ ] Compute and report the final installer SHA-256.
