# Phase 1 Engineering and Security Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-first Electron application that enforces the Main/Preload/Renderer trust boundary and can create, close, list, and reopen an empty SQLite-backed campaign.

**Architecture:** Use a pnpm workspace and Electron modular monolith. The Renderer calls a narrow typed Preload API; Main validates every request, invokes application services, and owns SQLite, filesystem, logging, and credential access. Phase 1 contains no AI calls, game turns, content import, or author tooling.

**Tech Stack:** TypeScript strict, pnpm workspace, Electron, Electron Forge, React, Vite, CSS Modules, Zod, better-sqlite3, Vitest, Playwright, ESLint, Prettier, Pino

**Spec:** `docs/superpowers/specs/2026-08-19-v1-technical-design.md`

## Global Constraints

- Official runtime platform is Windows x64; do not add macOS release work.
- Renderer must run with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Renderer must not import Node built-ins, Electron Main APIs, better-sqlite3, filesystem APIs, or credential APIs.
- Preload exposes named campaign methods only; do not expose a generic IPC invoke method.
- Every IPC request and response is validated with Zod at runtime.
- Main is the composition root; domain and application packages do not import Electron or React.
- Use one SQLite file per campaign and a separate `settings.sqlite` database.
- SQLite writes are short transactions; no network or slow filesystem operation runs inside a write transaction.
- API keys and secrets do not enter SQLite, logs, IPC response bodies, or Renderer state.
- Do not add multiplayer networking, AI providers, content editing, portable mode, or auto-update implementation in this phase.
- Use CSS Modules; do not add Tailwind or a second utility-class framework.
- Each task uses TDD where behavior is introduced and ends in its own commit.

## File Map

```text
package.json                              workspace scripts and pinned package manager
pnpm-workspace.yaml                       workspace package discovery
tsconfig.base.json                        shared strict TypeScript settings
eslint.config.mjs                         lint and architectural import restrictions
.prettierrc.json                          formatting rules

apps/desktop/forge.config.ts              Electron Forge/Vite packaging entry
apps/desktop/vite.main.config.ts          Main bundle config
apps/desktop/vite.preload.config.ts       Preload bundle config
apps/desktop/vite.renderer.config.ts      Renderer bundle config
apps/desktop/src/main/main.ts              Electron lifecycle and secure BrowserWindow
apps/desktop/src/main/composition-root.ts  concrete dependency construction
apps/desktop/src/main/ipc/campaign-ipc.ts  campaign IPC handlers and validation
apps/desktop/src/main/forge-env.d.ts        Forge Vite generated-entry declarations
apps/desktop/src/preload/index.ts          narrow contextBridge API
apps/desktop/src/renderer/*                React shell and campaign UI

packages/contracts/src/campaign.ts         IPC request/response schemas
packages/contracts/src/errors.ts           stable public error envelope
packages/contracts/src/desktop-api.ts      Renderer-facing API type
packages/game-core/src/campaign.ts         campaign identity and metadata types
packages/application/src/campaign-service.ts create/list/open use cases
packages/application/src/ports.ts          repository, clock, ID and path ports
packages/persistence/src/settings/*        global catalog migration/repository
packages/persistence/src/campaign/*        campaign migration/repository
packages/platform/src/paths.ts             platform path adapter
packages/platform/src/credentials.ts       safeStorage-backed secret boundary
packages/test-support/src/temp-dir.ts       isolated test directory helper

tests/e2e/security.spec.ts                 Renderer security boundary
tests/e2e/campaign-lifecycle.spec.ts       create/relaunch/reopen workflow
```

---

### Task 1: Workspace, TypeScript, and Test Foundation

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `vitest.workspace.ts`
- Create: `packages/test-support/package.json`
- Create: `packages/test-support/src/temp-dir.ts`
- Create: `packages/test-support/src/temp-dir.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `createTempDirectory(prefix: string): Promise<{ path: string; dispose(): Promise<void> }>` and workspace-wide `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` scripts

- [ ] **Step 1: Create the workspace manifests and install the phase dependencies**

Create the root package manifest with `packageManager`, private workspaces, and scripts. Run:

```powershell
corepack enable
pnpm add -Dw typescript eslint @eslint/js typescript-eslint prettier vitest @types/node
pnpm add -Dw electron @electron-forge/cli @electron-forge/plugin-vite @electron-forge/maker-squirrel vite @vitejs/plugin-react
pnpm add -w react react-dom zod better-sqlite3 pino zustand @tanstack/react-query react-router-dom
pnpm add -Dw @types/react @types/react-dom @types/better-sqlite3 playwright @playwright/test
```

The generated lockfile is part of the commit. Set `packageManager` to the exact pnpm version printed by `pnpm --version`.

- [ ] **Step 2: Write the failing temp-directory test**

```ts
import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createTempDirectory } from "./temp-dir";

describe("createTempDirectory", () => {
  it("creates and disposes an isolated directory", async () => {
    const temp = await createTempDirectory("trpg-test-");
    await expect(access(temp.path)).resolves.toBeUndefined();
    await temp.dispose();
    await expect(access(temp.path)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the test and confirm the missing implementation failure**

Run: `pnpm vitest run packages/test-support/src/temp-dir.test.ts`

Expected: FAIL because `./temp-dir` does not exist.

- [ ] **Step 4: Implement the helper and strict shared configuration**

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function createTempDirectory(prefix: string) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  return {
    path,
    dispose: () => rm(path, { recursive: true, force: true }),
  };
}
```

Set `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, and `useUnknownInCatchVariables` to `true` in `tsconfig.base.json`. Configure Vitest to find `packages/**/*.test.ts` and `apps/**/*.test.ts`.

- [ ] **Step 5: Add architectural lint restrictions**

In `eslint.config.mjs`, reject imports of `electron`, `node:*`, `better-sqlite3`, and `packages/persistence` from `apps/desktop/src/renderer/**`. Reject imports of `electron` and React from `packages/game-core/**` and `packages/application/**`.

- [ ] **Step 6: Verify the workspace foundation**

Run:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: all commands exit 0; the temp-directory test reports 1 passed test.

- [ ] **Step 7: Commit**

```powershell
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json vitest.workspace.ts packages/test-support
git commit -m "build: establish TypeScript workspace"
```

### Task 2: Public Campaign Contracts

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/campaign.ts`
- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/desktop-api.ts`
- Create: `packages/contracts/src/campaign.test.ts`
- Create: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: Zod
- Produces: `CreateCampaignInputSchema`, `CampaignSummarySchema`, `CampaignIdSchema`, `PublicErrorSchema`, and `DesktopApi`

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import { CreateCampaignInputSchema, CampaignIdSchema } from "./campaign";

describe("campaign contracts", () => {
  it("normalizes a valid campaign name", () => {
    expect(CreateCampaignInputSchema.parse({ name: "  雾都奇谈  " })).toEqual({ name: "雾都奇谈" });
  });

  it("rejects an empty name", () => {
    expect(() => CreateCampaignInputSchema.parse({ name: "   " })).toThrow();
  });

  it("rejects a path in place of a campaign id", () => {
    expect(() => CampaignIdSchema.parse("../campaign.sqlite")).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `pnpm vitest run packages/contracts/src/campaign.test.ts`

Expected: FAIL because the schemas do not exist.

- [ ] **Step 3: Implement exact public schemas**

```ts
import { z } from "zod";

export const CampaignIdSchema = z.string().uuid();
export const CreateCampaignInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export const CampaignSummarySchema = z.object({
  campaignId: CampaignIdSchema,
  name: z.string().min(1).max(80),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  stateVersion: z.number().int().nonnegative(),
});
export const CampaignListSchema = z.array(CampaignSummarySchema);
```

Define `PublicErrorSchema` as `{ code, message, operationId?, retryable }`, with `code` using stable uppercase snake-case values. Define `DesktopApi` with exactly `campaign.create`, `campaign.list`, and `campaign.open`; use `z.infer` types from the schemas.

- [ ] **Step 4: Verify contracts**

Run: `pnpm vitest run packages/contracts/src/campaign.test.ts && pnpm typecheck`

Expected: 3 tests pass and typecheck exits 0.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts
git commit -m "feat: define campaign IPC contracts"
```

### Task 3: Core Campaign Types and Application Ports

**Files:**
- Create: `packages/game-core/package.json`
- Create: `packages/game-core/src/campaign.ts`
- Create: `packages/game-core/src/index.ts`
- Create: `packages/application/package.json`
- Create: `packages/application/src/ports.ts`
- Create: `packages/application/src/campaign-service.ts`
- Create: `packages/application/src/campaign-service.test.ts`
- Create: `packages/application/src/index.ts`

**Interfaces:**
- Consumes: `CreateCampaignInput`, `CampaignSummary` from contracts
- Produces: `CampaignRepository`, `IdGenerator`, `Clock`, and `CampaignService`

- [ ] **Step 1: Write a failing application-service test with in-memory fakes**

```ts
it("creates and reopens a campaign through the repository boundary", async () => {
  const repository = new MemoryCampaignRepository();
  const service = new CampaignService(repository, () => "11111111-1111-4111-8111-111111111111", () => new Date("2026-08-19T00:00:00.000Z"));

  const created = await service.create({ name: "雾都奇谈" });
  expect(created.stateVersion).toBe(0);
  expect(await service.list()).toEqual([created]);
  expect(await service.open(created.campaignId)).toEqual(created);
});
```

The fake remains inside the test file and uses the exact repository interface declared below:

```ts
class MemoryCampaignRepository implements CampaignRepository {
  private readonly campaigns = new Map<string, CampaignSummary>();
  async create(summary: CampaignSummary) { this.campaigns.set(summary.campaignId, summary); }
  async list() { return [...this.campaigns.values()]; }
  async findById(campaignId: string) { return this.campaigns.get(campaignId) ?? null; }
}
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm vitest run packages/application/src/campaign-service.test.ts`

Expected: FAIL because `CampaignService` and ports do not exist.

- [ ] **Step 3: Define ports and minimal service**

```ts
export interface CampaignRepository {
  create(summary: CampaignSummary): Promise<void>;
  list(): Promise<CampaignSummary[]>;
  findById(campaignId: string): Promise<CampaignSummary | null>;
}

export type IdGenerator = () => string;
export type Clock = () => Date;
```

`CampaignService.create()` trims through the already parsed contract, creates version 0 metadata, saves it once, and returns the summary. `open()` throws an application error with code `CAMPAIGN_NOT_FOUND` when the repository returns null. It must not know filesystem paths or SQL.

- [ ] **Step 4: Verify service behavior and dependency purity**

Run:

```powershell
pnpm vitest run packages/application/src/campaign-service.test.ts
pnpm lint
pnpm typecheck
```

Expected: service tests pass; architectural lint reports no Electron, React, SQLite, or Node imports in core/application.

- [ ] **Step 5: Commit**

```powershell
git add packages/game-core packages/application
git commit -m "feat: add campaign application boundary"
```

### Task 4: SQLite Campaign Catalog and Per-Campaign Database

**Files:**
- Create: `packages/persistence/package.json`
- Create: `packages/persistence/src/sqlite.ts`
- Create: `packages/persistence/src/settings/migrations.ts`
- Create: `packages/persistence/src/settings/sqlite-campaign-repository.ts`
- Create: `packages/persistence/src/campaign/migrations.ts`
- Create: `packages/persistence/src/settings/sqlite-campaign-repository.test.ts`
- Create: `packages/persistence/src/index.ts`

**Interfaces:**
- Consumes: `CampaignRepository`, `CampaignSummary`, a root campaigns directory
- Produces: `SqliteCampaignRepository implements CampaignRepository` and `openSqlite(path: string)`

- [ ] **Step 1: Write the failing persistence lifecycle test**

```ts
it("persists a catalog entry and initializes an independent campaign database", async () => {
  const temp = await createTempDirectory("trpg-persistence-");
  const repository = await SqliteCampaignRepository.open({ rootDirectory: temp.path });
  const summary = {
    campaignId: "11111111-1111-4111-8111-111111111111",
    name: "雾都奇谈",
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    stateVersion: 0,
  };

  await repository.create(summary);
  await repository.close();

  const reopened = await SqliteCampaignRepository.open({ rootDirectory: temp.path });
  expect(await reopened.findById(summary.campaignId)).toEqual(summary);
  await expect(access(join(temp.path, "campaigns", summary.campaignId, "campaign.sqlite"))).resolves.toBeUndefined();
  await reopened.close();
  await temp.dispose();
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm vitest run packages/persistence/src/settings/sqlite-campaign-repository.test.ts`

Expected: FAIL because the SQLite repository does not exist.

- [ ] **Step 3: Implement the connection policy and migrations**

`openSqlite()` must execute:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

The settings migration creates `schema_migrations` and `campaign_catalog(campaign_id PRIMARY KEY, name, created_at, updated_at, state_version, relative_path UNIQUE)`. The campaign migration creates `campaign_metadata`, `branches`, `turns`, `events`, `state_entities`, `rule_decisions`, `snapshots`, `checkpoints`, `content_bindings`, `background_jobs`, and `schema_migrations`, even though Phase 1 only inserts campaign metadata and the root branch.

- [ ] **Step 4: Implement atomic campaign creation**

Create the campaign directory first under the controlled root, initialize `campaign.sqlite` in a transaction with metadata and root branch, then insert the settings catalog row. If catalog insertion fails, close the database and remove only the newly created campaign directory after resolving and verifying that it is a child of the configured root.

Store only a normalized relative path in `settings.sqlite`; never accept a path from Renderer.

- [ ] **Step 5: Add rollback and duplicate-ID tests**

Add tests proving that duplicate campaign IDs fail without overwriting the first database and that a forced catalog failure leaves no second catalog entry or orphan database.

- [ ] **Step 6: Verify persistence**

Run: `pnpm vitest run packages/persistence/src/settings/sqlite-campaign-repository.test.ts`

Expected: lifecycle, duplicate, and rollback tests all pass.

- [ ] **Step 7: Commit**

```powershell
git add packages/persistence
git commit -m "feat: persist empty campaigns in SQLite"
```

### Task 5: Platform Paths and Credential Boundary

**Files:**
- Create: `packages/platform/package.json`
- Create: `packages/platform/src/paths.ts`
- Create: `packages/platform/src/credentials.ts`
- Create: `packages/platform/src/credentials.test.ts`
- Create: `packages/platform/src/index.ts`

**Interfaces:**
- Consumes: Electron `app.getPath`, Electron `safeStorage`, Pino logger
- Produces: `AppPaths`, `resolveAppPaths()`, and `CredentialStore`

- [ ] **Step 1: Write failing credential tests against a fake cipher**

```ts
it("never returns a stored secret from list metadata", async () => {
  const secrets = new Map<string, Buffer>();
  const store = new CredentialStore(
    {
      encrypt: (value) => Buffer.from(value, "utf8"),
      decrypt: (value) => value.toString("utf8"),
    },
    {
      set: async (id, value) => void secrets.set(id, value),
      get: async (id) => secrets.get(id) ?? null,
      listIds: async () => [...secrets.keys()],
      delete: async (id) => void secrets.delete(id),
    },
  );
  await store.set("provider-main", "sk-secret-value");
  expect(await store.list()).toEqual([{ credentialId: "provider-main", configured: true }]);
  expect(JSON.stringify(await store.list())).not.toContain("sk-secret-value");
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm vitest run packages/platform/src/credentials.test.ts`

Expected: FAIL because `CredentialStore` does not exist.

- [ ] **Step 3: Implement injectable encryption and path resolution**

Define:

```ts
export interface SecretCipher {
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

export interface SecretPersistence {
  set(credentialId: string, ciphertext: Buffer): Promise<void>;
  get(credentialId: string): Promise<Buffer | null>;
  listIds(): Promise<string[]>;
  delete(credentialId: string): Promise<void>;
}

export interface AppPaths {
  settingsDatabase: string;
  campaignsRoot: string;
  logsRoot: string;
  cacheRoot: string;
  backupsRoot: string;
}
```

The Electron adapter wraps `safeStorage.encryptString/decryptString`. The store persists only encrypted bytes and credential IDs in a Main-only file beneath the app data directory. Logging accepts only operation metadata and credential ID, never plaintext or ciphertext.

- [ ] **Step 4: Add failure tests**

Test unavailable encryption, corrupted ciphertext, overwrite, and delete. Each failure returns a stable application error and never includes the secret in its message.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run packages/platform/src/credentials.test.ts && pnpm lint && pnpm typecheck`

Expected: all commands exit 0.

```powershell
git add packages/platform
git commit -m "feat: add Windows platform boundaries"
```

### Task 6: Secure Electron Main, Composition Root, and IPC

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/forge.config.ts`
- Create: `apps/desktop/vite.main.config.ts`
- Create: `apps/desktop/vite.preload.config.ts`
- Create: `apps/desktop/vite.renderer.config.ts`
- Create: `apps/desktop/src/main/main.ts`
- Create: `apps/desktop/src/main/composition-root.ts`
- Create: `apps/desktop/src/main/ipc/campaign-ipc.ts`
- Create: `apps/desktop/src/main/ipc/campaign-ipc.test.ts`
- Create: `apps/desktop/src/main/forge-env.d.ts`
- Create: `apps/desktop/src/preload/index.ts`

**Interfaces:**
- Consumes: `CampaignService`, contracts, SQLite repository, platform paths
- Produces: secure BrowserWindow, handlers for `campaign:create`, `campaign:list`, `campaign:open`, and `window.desktopApi`

- [ ] **Step 1: Write failing handler tests with a fake IPC registrar**

Test that `campaign:create` rejects an empty name before calling the service, returns a schema-valid summary for valid input, and maps an unknown exception to `INTERNAL_ERROR` without returning a stack trace.

```ts
expect(() => CreateCampaignInputSchema.parse(rawInput)).not.toThrow();
expect(CampaignSummarySchema.parse(result)).toEqual(result);
```

- [ ] **Step 2: Run the handler tests and verify failure**

Run: `pnpm vitest run apps/desktop/src/main/ipc/campaign-ipc.test.ts`

Expected: FAIL because the registrar does not exist.

- [ ] **Step 3: Implement the composition root and IPC registration**

The composition root resolves paths after `app.whenReady()`, creates the Pino logger, opens the SQLite repository, constructs `CampaignService`, and registers handlers. Handlers validate both input and successful output with contracts.

Use explicit channel constants exported by contracts. Do not accept a channel name from Renderer data.

- [ ] **Step 4: Implement the secure BrowserWindow**

```ts
const window = new BrowserWindow({
  webPreferences: {
    preload: PRELOAD_ENTRY,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});
```

`PRELOAD_ENTRY` is the compile-time entry constant generated by the configured Electron Forge Vite plugin. Declare it explicitly in `apps/desktop/src/main/forge-env.d.ts` together with `MAIN_WINDOW_VITE_DEV_SERVER_URL` and `MAIN_WINDOW_VITE_NAME`.

Block navigation away from the packaged renderer. Deny unexpected `window.open` requests and pass confirmed external URLs to a separate Main-owned function; do not implement external link UI in this phase.

- [ ] **Step 5: Expose the narrow Preload API**

```ts
contextBridge.exposeInMainWorld("desktopApi", {
  campaign: {
    create: (input) => ipcRenderer.invoke("campaign:create", input),
    list: () => ipcRenderer.invoke("campaign:list"),
    open: (campaignId) => ipcRenderer.invoke("campaign:open", { campaignId }),
  },
} satisfies DesktopApi);
```

Add the global Window declaration using `DesktopApi`. Do not expose `ipcRenderer` itself.

- [ ] **Step 6: Verify Main and IPC tests**

Run: `pnpm vitest run apps/desktop/src/main/ipc/campaign-ipc.test.ts && pnpm typecheck && pnpm lint`

Expected: all handler tests pass and architectural lint finds no forbidden Renderer imports.

- [ ] **Step 7: Commit**

```powershell
git add apps/desktop/src/main apps/desktop/src/preload apps/desktop/package.json apps/desktop/forge.config.ts apps/desktop/vite.*.config.ts
git commit -m "feat: add secure Electron application boundary"
```

### Task 7: React Campaign Shell

**Files:**
- Create: `apps/desktop/index.html`
- Create: `apps/desktop/src/renderer/main.tsx`
- Create: `apps/desktop/src/renderer/app.tsx`
- Create: `apps/desktop/src/renderer/app.module.css`
- Create: `apps/desktop/src/renderer/global.css`
- Create: `apps/desktop/src/renderer/campaigns/campaign-list.tsx`
- Create: `apps/desktop/src/renderer/campaigns/create-campaign-form.tsx`
- Create: `apps/desktop/src/renderer/campaigns/campaign-screen.tsx`
- Create: `apps/desktop/src/renderer/campaigns/campaigns.test.tsx`

**Interfaces:**
- Consumes: `window.desktopApi.campaign.*`, campaign DTOs
- Produces: create/list/open UI and `/campaign/:campaignId` route

- [ ] **Step 1: Write failing UI tests**

With a fake `window.desktopApi`, test that the initial page lists campaigns, trims and submits a new name, disables duplicate submission while pending, and opens the selected campaign route.

```ts
await user.type(screen.getByLabelText("战役名称"), "雾都奇谈");
await user.click(screen.getByRole("button", { name: "创建战役" }));
expect(fakeApi.campaign.create).toHaveBeenCalledWith({ name: "雾都奇谈" });
```

- [ ] **Step 2: Run the UI tests and verify failure**

Run: `pnpm vitest run apps/desktop/src/renderer/campaigns/campaigns.test.tsx`

Expected: FAIL because the React components do not exist.

- [ ] **Step 3: Implement the minimal player shell**

Create a QueryClient, React Router routes for `/` and `/campaign/:campaignId`, a campaign list, and a create form. The campaign screen displays campaign name, ID, and state version plus a “返回战役列表” link. It does not include GM UI, AI settings, content import, or placeholder buttons for later phases.

Add this restrictive initial CSP to `index.html`; later phases may extend only the specific connect or media directives they require:

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'"
/>
```

- [ ] **Step 4: Implement error and loading states**

Render stable user messages for `CAMPAIGN_NOT_FOUND`, validation failure, and generic failure. Keep the form value after a failed create. Never render stack traces or raw IPC payloads.

- [ ] **Step 5: Verify UI and architectural boundary**

Run:

```powershell
pnpm vitest run apps/desktop/src/renderer/campaigns/campaigns.test.tsx
pnpm lint
pnpm typecheck
```

Expected: UI tests pass; Renderer forbidden-import lint passes.

- [ ] **Step 6: Commit**

```powershell
git add apps/desktop/index.html apps/desktop/src/renderer
git commit -m "feat: add empty campaign player shell"
```

### Task 8: Electron Security and Campaign Lifecycle E2E

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/helpers/launch-desktop.ts`
- Create: `tests/e2e/security.spec.ts`
- Create: `tests/e2e/campaign-lifecycle.spec.ts`
- Create: `docs/development/phase-1-verification.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: packaged/development Electron app and temporary user-data directory
- Produces: `pnpm test:e2e` proof of trust-boundary and persistence behavior

- [ ] **Step 1: Write the failing security E2E test**

```ts
test("renderer exposes only the named desktop API", async () => {
  const keys = await page.evaluate(() => Object.keys(window.desktopApi));
  expect(keys).toEqual(["campaign"]);
  expect(await page.evaluate(() => typeof window.require)).toBe("undefined");
  expect(await page.evaluate(() => typeof window.process)).toBe("undefined");
});
```

Also assert that the campaign object has exactly `create`, `list`, and `open`.
Read the loaded document's CSP meta tag and assert it does not contain `unsafe-eval`, `unsafe-inline`, `http:`, or `https:`.

- [ ] **Step 2: Write the failing relaunch test**

Launch with an isolated `--user-data-dir`, create “雾都奇谈”, close Electron, relaunch with the same directory, and assert the campaign appears and can be opened with state version 0.

- [ ] **Step 3: Run E2E and verify failure**

Run: `pnpm test:e2e`

Expected: FAIL until the launch helper, development build command, and app lifecycle are correctly wired.

- [ ] **Step 4: Implement deterministic E2E launch and shutdown**

The helper starts Electron with a unique test directory, waits for the first window, and always closes the ElectronApplication in `finally`. Main must close SQLite connections in `before-quit` without waiting for background work.

- [ ] **Step 5: Run the full Phase 1 verification**

Run:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm --filter desktop make
```

Expected: all commands exit 0; unit/integration/E2E tests report no failures; Electron Forge produces a Windows x64 installer artifact.

- [ ] **Step 6: Manually inspect the packaged application**

Install the generated artifact in a disposable Windows user context. Create a campaign, exit, reopen it, confirm version 0, uninstall the app, and verify campaign data remains in the user data location. Record the command, artifact name, and result in `docs/development/phase-1-verification.md`.

- [ ] **Step 7: Commit**

```powershell
git add playwright.config.ts tests/e2e package.json docs/development/phase-1-verification.md
git commit -m "test: verify secure campaign lifecycle"
```

### Task 9: Phase 1 Documentation and Acceptance Gate

**Files:**
- Create: `docs/development/getting-started.md`
- Create: `docs/architecture/process-boundaries.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: verified commands and final file structure from Tasks 1–8
- Produces: contributor setup, trust-boundary documentation, and Phase 1 acceptance record

- [ ] **Step 1: Write the contributor setup with verified commands**

Document required Windows tooling, Node and pnpm versions from the committed environment, `pnpm install`, development launch, unit tests, E2E, packaging, and the location of disposable test data. Do not document unimplemented AI, content, or game-turn commands.

- [ ] **Step 2: Document the enforced trust boundary**

Include the Renderer → Preload → Main → Application → Persistence flow, named IPC methods, forbidden dependencies, credential handling, and how to add a new IPC method with request and response schemas.

- [ ] **Step 3: Run the final acceptance checklist**

Run:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm --filter desktop make
git diff --check
```

Expected: every command exits 0. Confirm manually that Renderer has no Node access, a campaign persists across restart, API/credential values are absent from SQLite and logs, and no AI/content/multiplayer/author-tool UI was added.

- [ ] **Step 4: Commit**

```powershell
git add README.md docs/development/getting-started.md docs/architecture/process-boundaries.md
git commit -m "docs: document phase one development workflow"
```

## Phase 1 Exit Criteria

- A signed release is not required yet, but Electron Forge must build a Windows x64 installer.
- Renderer has no Node, SQLite, filesystem, Electron Main, or credential access.
- Preload exposes exactly the three campaign methods defined in `DesktopApi`.
- Invalid IPC input is rejected before calling application services.
- A campaign is stored in its own SQLite file and catalogued in `settings.sqlite`.
- A campaign can be created, the app can exit, and the campaign can be reopened at state version 0.
- Duplicate IDs and partial creation failures do not overwrite or orphan campaign data.
- Credential boundary tests prove secrets are not returned through metadata APIs or error messages.
- Unit, integration, E2E, lint, typecheck, formatting, and Windows packaging checks all pass.
- Contributor and process-boundary documentation matches the verified implementation.
