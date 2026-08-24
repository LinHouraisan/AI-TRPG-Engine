# Electron Single Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every runtime-relevant module from `demo/` into a self-contained Electron workspace, remove the browser-only Demo and Astro handbook, and preserve desktop behavior, saves, tests, and Windows packaging.

**Architecture:** Consolidate application code under `electron/src/{main,preload,renderer,core,shared}` and authored packs under `electron/content/packs`. Keep unit tests beside their modules, place only cross-module desktop tests under `electron/tests`, and make `electron/package.json` the sole application dependency and command surface.

**Tech Stack:** TypeScript 5.8, React 19, Vite 7, Tailwind CSS 4, Electron 37, Bun 1.3, Zod 4, better-sqlite3 12, SQLite.

**Spec:** `docs/superpowers/specs/2026-08-24-electron-single-workspace-design.md`

## Global Constraints

- Preserve database schemas, save locations, IPC method names, Scenario Pack IDs, and gameplay behavior.
- Remove browser-only execution, the Ollama Vite proxy, `demo/`, and `handbook/`.
- Do not rewrite business logic while moving it.
- Active source, configuration, scripts, and current documentation must contain no `demo/` or `handbook/` references at completion.
- Historical accepted specs and plans may retain old paths as historical evidence.
- Preserve unrelated working-tree changes; stage only files named by each task.
- Use aliases `@core/*`, `@renderer/*`, `@shared/*`, and `@main/*` with the dependency directions specified by the design.
- Windows delivery remains a verified unpacked folder, not an installer or ZIP.

---

### Task 1: Move the Game Core and Scenario Packs

**Files:**
- Move: `demo/src/ai/**` → `electron/src/core/ai/**`
- Move: `demo/src/cards/**` → `electron/src/core/cards/**`
- Move: `demo/src/character/**` → `electron/src/core/character/**`
- Move: `demo/src/engine/**` → `electron/src/core/engine/**`
- Move: `demo/src/keeper/**` → `electron/src/core/keeper/**`
- Move: `demo/src/data/packs/**` → `electron/content/packs/**`
- Modify: `electron/tsconfig.json`
- Modify: `electron/scripts/build.ts`
- Modify: `electron/electron-builder.yml`
- Modify: every moved core `.ts` test/import that currently uses `@/...`
- Test: moved `electron/src/core/**/*.test.ts`

**Interfaces:**
- Produces aliases `@core/*`, `@shared/*`, `@main/*`, and `@renderer/*` in `electron/tsconfig.json`.
- Produces authored content root `electron/content/packs` consumed by pack loading, dev startup, content scripts, and electron-builder.
- Preserves all existing exports from the moved core modules.

- [ ] **Step 1: Add a failing path-contract check**

Create `electron/tests/workspace-layout.test.ts` with the initial contract:

```ts
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const electronRoot = join(import.meta.dir, "..");

test("game core and authored packs live inside electron", () => {
  expect(existsSync(join(electronRoot, "src/core/engine/runtime.ts"))).toBe(true);
  expect(existsSync(join(electronRoot, "src/core/keeper/keeper.ts"))).toBe(true);
  expect(existsSync(join(electronRoot, "content/packs/mist-harbor/pack.json"))).toBe(true);
});
```

- [ ] **Step 2: Run the layout check and confirm RED**

Run: `bun test electron/tests/workspace-layout.test.ts`

Expected: FAIL because `electron/src/core` and `electron/content/packs` do not exist.

- [ ] **Step 3: Move core modules and packs without editing behavior**

Use `git mv` for the six core directories and the complete `packs` directory. Do not copy generated `demo/dist` or `node_modules`. In moved core code, replace imports by responsibility:

```ts
import { replay } from "@core/engine/runtime";
import type { InvestigatorProfile } from "@core/character/types";
import type { DesktopApi } from "@shared/api";
```

Core modules must not import `@renderer/*` or `@main/*`.

- [ ] **Step 4: Define aliases and content packaging paths**

Update `electron/tsconfig.json` paths to:

```json
{
  "@core/*": ["src/core/*"],
  "@renderer/*": ["src/renderer/*"],
  "@shared/*": ["src/shared/*"],
  "@main/*": ["src/main/*"]
}
```

Update the esbuild alias in `electron/scripts/build.ts` to map these four aliases. Change `electron/electron-builder.yml` extraResources source from `../demo/src/data/packs` to `content/packs`.

- [ ] **Step 5: Run moved core tests and content lint**

Run: `bun test electron/src/core`

Run: `bun run --cwd electron pack:lint`

Expected: all moved core tests pass and all three packs report zero reference issues. If `pack:lint` is not yet exposed by `electron/package.json`, run `bun electron/scripts/pack-lint.ts` in this task and add the package script in Task 4.

- [ ] **Step 6: Re-run the layout contract and commit**

Run: `bun test electron/tests/workspace-layout.test.ts`

Expected: PASS.

```powershell
git add -- electron/src/core electron/content/packs electron/tests/workspace-layout.test.ts electron/tsconfig.json electron/scripts/build.ts electron/electron-builder.yml demo/src
git commit -m "refactor: move game core into electron"
```

---

### Task 2: Move the React Renderer and Renderer Storage

**Files:**
- Move: `demo/src/ui/**` → `electron/src/renderer/ui/**`
- Move: `demo/src/store/**` → `electron/src/renderer/store/**`
- Move: `demo/src/App.tsx` → `electron/src/renderer/App.tsx`
- Move: `demo/src/main.tsx` → `electron/src/renderer/main.tsx`
- Move: `demo/src/index.css` → `electron/src/renderer/index.css`
- Move: `demo/src/session.ts` → `electron/src/renderer/session.ts`
- Move: `demo/src/desktop.ts` → `electron/src/renderer/desktop.ts`
- Move: `demo/src/desktop-play.ts` → `electron/src/renderer/desktop-play.ts`
- Move: `demo/src/desktop-contract.test.ts` → `electron/tests/desktop-contract.test.ts`
- Move: `demo/src/desktop-play.test.ts` → `electron/tests/desktop-play.test.ts`
- Move: `demo/src/session-opening.test.ts` → `electron/tests/session-opening.test.ts`
- Move: `demo/index.html` → `electron/index.html`
- Create: `electron/vite.config.ts`
- Modify: moved renderer imports

**Interfaces:**
- Produces Vite entry `electron/src/renderer/main.tsx` and built renderer `electron/dist/renderer/index.html`.
- Renderer consumes `@core/*` and `@shared/*`; it must not consume `@main/*`.
- Preserves the global `window.desktopApi` contract and the existing `useSession` public behavior.

- [ ] **Step 1: Extend the layout test for renderer ownership**

Add to `electron/tests/workspace-layout.test.ts`:

```ts
test("React renderer lives inside electron", () => {
  expect(existsSync(join(electronRoot, "src/renderer/main.tsx"))).toBe(true);
  expect(existsSync(join(electronRoot, "src/renderer/ui/InvestigatorCreation.tsx"))).toBe(true);
  expect(existsSync(join(electronRoot, "vite.config.ts"))).toBe(true);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `bun test electron/tests/workspace-layout.test.ts`

Expected: FAIL on the missing renderer files.

- [ ] **Step 3: Move renderer code, tests, and HTML**

Use `git mv` for every file listed above. Rewrite aliases by ownership, for example:

```ts
import { allocationBudget } from "@core/character/creation";
import type { GameState } from "@core/engine/types";
import { tryDesktopApi } from "@renderer/desktop";
import type { DesktopApi } from "@shared/api";
```

Delete browser-only branches only when they exclusively support direct browser startup. Preserve browser storage adapters if unit tests or renderer fallback still use them until Task 6 decides they are unreachable.

- [ ] **Step 4: Create the Electron-owned Vite configuration**

Create `electron/vite.config.ts` using React and Tailwind plugins, `base: "./"`, and the four aliases. Do not include the `/ollama` proxy or read `demo/.env.local`. Configure build output explicitly:

```ts
build: {
  outDir: "dist/renderer",
  emptyOutDir: true,
}
```

- [ ] **Step 5: Run renderer-focused tests**

Run:

```powershell
bun test electron/src/renderer/ui electron/tests/session-opening.test.ts electron/tests/desktop-play.test.ts electron/tests/desktop-contract.test.ts
```

Expected: all renderer state, opening, desktop contract, and branch tests pass.

- [ ] **Step 6: Run layout test and commit**

Run: `bun test electron/tests/workspace-layout.test.ts`

Expected: PASS.

```powershell
git add -- electron/src/renderer electron/tests electron/index.html electron/vite.config.ts demo/src demo/index.html
git commit -m "refactor: move renderer into electron"
```

---

### Task 3: Normalize Main, Preload, and Shared Source Paths

**Files:**
- Move: `electron/main/**` → `electron/src/main/**`
- Move: `electron/preload/**` → `electron/src/preload/**`
- Move: `electron/shared/**` → `electron/src/shared/**`
- Modify: `electron/scripts/build.ts`
- Modify: `electron/tsconfig.json`
- Modify: all moved imports that reference `demo/src` or old Electron source roots
- Test: moved `electron/src/main/**/*.test.ts`

**Interfaces:**
- Main consumes `@core/*` and `@shared/*`.
- Preload consumes `@shared/*` and Electron only.
- `electron/dist/main.cjs` and `electron/dist/preload.cjs` remain the production entry outputs expected by `package.json`.

- [ ] **Step 1: Extend the layout test for normalized Electron sources**

```ts
test("main preload and shared code use the unified source tree", () => {
  expect(existsSync(join(electronRoot, "src/main/index.ts"))).toBe(true);
  expect(existsSync(join(electronRoot, "src/preload/index.ts"))).toBe(true);
  expect(existsSync(join(electronRoot, "src/shared/api.ts"))).toBe(true);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `bun test electron/tests/workspace-layout.test.ts`

Expected: FAIL because these modules still live at the Electron root.

- [ ] **Step 3: Move source trees and replace cross-project imports**

Use `git mv`. Replace imports such as:

```ts
import { validateAllocation } from "@core/character/creation";
import { loadPackById } from "@core/engine/pack";
import type { DesktopApi } from "@shared/api";
```

No file under `src/main`, `src/preload`, or `src/shared` may contain `demo/src`.

- [ ] **Step 4: Update main/preload build entries**

In `electron/scripts/build.ts`, set entry points to `src/main/index.ts` and `src/preload/index.ts`, retain outputs `dist/main.cjs` and `dist/preload.cjs`, and map all four aliases to absolute paths under `electron/src`.

- [ ] **Step 5: Run main and persistence tests**

Run: `bun test electron/src/main electron/src/shared`

Run: `bun run --cwd electron persist:check`

Expected: all tests pass and persistence verification completes.

- [ ] **Step 6: Run layout test and commit**

Run: `bun test electron/tests/workspace-layout.test.ts`

Expected: PASS.

```powershell
git add -- electron/src/main electron/src/preload electron/src/shared electron/scripts/build.ts electron/tsconfig.json electron/main electron/preload electron/shared electron/tests/workspace-layout.test.ts
git commit -m "refactor: normalize electron source layout"
```

---

### Task 4: Make Electron the Only Application Package

**Files:**
- Modify: `electron/package.json`
- Modify: `electron/bun.lock`
- Modify: `electron/tsconfig.json`
- Modify: `electron/vite.config.ts`
- Modify: `electron/scripts/dev.ts`
- Modify: `electron/scripts/package-win.ts`
- Delete after merge: `demo/package.json`
- Delete after merge: `demo/bun.lock`
- Delete after merge: `demo/tsconfig.json`
- Delete after merge: `demo/vite.config.ts`

**Interfaces:**
- Produces package scripts `dev`, `test`, `typecheck`, `build:renderer`, `build:main`, `build`, `smoke`, `pack:lint`, `keeper:check`, `checkpoint:check`, `persist:check`, `demo:e2e`, and `package:win`.
- Produces a single `electron/bun.lock` containing all renderer and main dependencies.

- [ ] **Step 1: Add a failing package-contract test**

Extend `electron/tests/workspace-layout.test.ts`:

```ts
import electronPackage from "../package.json";

test("electron package owns renderer and desktop commands", () => {
  expect(electronPackage.scripts["build:renderer"]).toBe("vite build");
  expect(electronPackage.scripts.typecheck).toContain("tsc");
  expect(electronPackage.dependencies.react).toBeDefined();
  expect(electronPackage.dependencies["better-sqlite3"]).toBeDefined();
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `bun test electron/tests/workspace-layout.test.ts`

Expected: FAIL because Electron does not yet own React/Vite scripts and dependencies.

- [ ] **Step 3: Merge dependencies and scripts**

Merge the exact dependency versions from `demo/package.json` into `electron/package.json`. Define:

```json
{
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc -b --noEmit",
    "build:renderer": "vite build",
    "build:main": "bun scripts/build.ts",
    "build": "bun run build:renderer && bun run build:main"
  }
}
```

Retain existing Electron verification scripts and expose the migrated Demo checks under their existing command names.

- [ ] **Step 4: Regenerate the Electron lockfile once**

Run from `electron`:

```powershell
bun install --ignore-scripts
bun run rebuild:native
```

Expected: one `electron/node_modules` and one `electron/bun.lock` satisfy both renderer and desktop builds.

- [ ] **Step 5: Simplify dev and package scripts**

Update `scripts/dev.ts` to start the Electron-owned Vite config and set `AI_TRPG_PACKS_DIR` to `electron/content/packs`. Update `scripts/package-win.ts` to call `bun run build` in `electron` and stop copying `demo/dist`; renderer output already lands in `electron/dist/renderer`.

- [ ] **Step 6: Verify package ownership**

Run:

```powershell
bun run --cwd electron typecheck
bun run --cwd electron build
bun test electron/tests/workspace-layout.test.ts
```

Expected: all commands pass from Electron without invoking `--cwd demo`.

- [ ] **Step 7: Commit**

```powershell
git add -- electron/package.json electron/bun.lock electron/tsconfig.json electron/vite.config.ts electron/scripts demo/package.json demo/bun.lock demo/tsconfig.json demo/vite.config.ts electron/tests/workspace-layout.test.ts
git commit -m "build: make electron the sole app workspace"
```

---

### Task 5: Migrate Checks, E2E, and Content Tooling

**Files:**
- Move: remaining `demo/scripts/*.ts` → `electron/scripts/*.ts`
- Modify: migrated scripts for `src/core`, `src/renderer`, and `content/packs`
- Modify: `electron/scripts/gold-path.ts`
- Modify: `electron/scripts/mist-harbor-e2e.ts`
- Modify: `electron/scripts/persist-check.ts`
- Modify: `electron/scripts/scenario-pack.ts`
- Modify: `electron/package.json`
- Test: all migrated scripts

**Interfaces:**
- All checks run with `bun run --cwd electron <script>` and consume only Electron-owned paths.
- `content:pack` and `content:check` read `electron/content/packs`.
- E2E imports `@core/*` or `electron/src/core/*`, never `demo/src`.

- [ ] **Step 1: Add a failing active-reference test**

Add to `electron/tests/workspace-layout.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

test("electron source and scripts do not reference demo", () => {
  const files = [...sourceFiles(join(electronRoot, "src")), ...sourceFiles(join(electronRoot, "scripts"))]
    .filter((file) => /\.(ts|tsx|json|yml)$/.test(file));
  const offenders = files.filter((file) => readFileSync(file, "utf8").includes("demo/"));
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `bun test electron/tests/workspace-layout.test.ts`

Expected: FAIL listing Electron scripts that still reference `demo`.

- [ ] **Step 3: Move remaining checks and update all paths**

Use `git mv` for remaining Demo scripts. Resolve naming collisions explicitly; keep the stronger Electron integration script when two scripts cover the same behavior, and move unique assertions into it before deleting the weaker duplicate. Update pack roots to `content/packs` and code imports to `src/core` aliases.

- [ ] **Step 4: Run the complete check surface**

Run:

```powershell
bun run --cwd electron pack:lint
bun run --cwd electron smoke
bun run --cwd electron keeper:check
bun run --cwd electron persist:check
bun run --cwd electron checkpoint:check
bun run --cwd electron gold
bun run --cwd electron content:check
bun run --cwd electron demo:e2e
```

Expected: every command exits 0; pack lint reports all three packs usable; E2E completes all Mist Harbor assertions.

- [ ] **Step 5: Run active-reference test and commit**

Run: `bun test electron/tests/workspace-layout.test.ts`

Expected: PASS.

```powershell
git add -- electron/scripts electron/package.json electron/tests/workspace-layout.test.ts demo/scripts
git commit -m "refactor: consolidate electron verification tooling"
```

---

### Task 6: Remove Demo and Handbook, Then Update Current Documentation

**Files:**
- Delete: remaining `demo/**`
- Delete: `handbook/**`
- Modify: root `package.json`
- Modify: root `bun.lock`
- Modify: `README.md`
- Modify: `electron/README.md`
- Modify: `.codex/skills/packaging-ai-trpg-windows/SKILL.md`
- Modify: current non-historical docs that instruct users to run Demo or handbook commands
- Test: `electron/tests/workspace-layout.test.ts`

**Interfaces:**
- Root scripts delegate only to Electron.
- Current user/developer documentation describes the unified Electron layout.
- Historical files under `docs/superpowers/specs` and `docs/superpowers/plans` are excluded from old-path rejection.

- [ ] **Step 1: Extend the layout contract for deleted roots**

```ts
const repoRoot = join(electronRoot, "..");

test("legacy demo and handbook workspaces are absent", () => {
  expect(existsSync(join(repoRoot, "demo"))).toBe(false);
  expect(existsSync(join(repoRoot, "handbook"))).toBe(false);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `bun test electron/tests/workspace-layout.test.ts`

Expected: FAIL because `demo/` and `handbook/` still exist.

- [ ] **Step 3: Audit before deletion**

Run:

```powershell
rg --files demo
rg --files handbook
rg -n "demo/|demo\\|handbook/|handbook\\" electron package.json README.md docs/00-product docs/01-architecture docs/05-implementation-design
```

For every remaining tracked file under `demo`, identify either its moved path or its browser-only/generated classification. Stop rather than delete if any business source, test, or pack lacks a destination.

- [ ] **Step 4: Delete legacy roots and clean root package metadata**

Delete `demo/` and `handbook/` only after Step 3 passes. Remove the handbook workspace and handbook script from root `package.json`; define root conveniences as Electron delegates:

```json
{
  "scripts": {
    "desktop": "bun run --cwd electron dev",
    "test": "bun run --cwd electron test",
    "build": "bun run --cwd electron build"
  }
}
```

Regenerate the root lockfile only if root workspace metadata requires it; do not duplicate Electron application dependencies at root.

- [ ] **Step 5: Update current docs and packaging skill**

Rewrite root README and Electron README directory/command examples for the unified layout. Update the packaging skill so renderer build, tests, content paths, and delivery refer only to `electron/`. Do not rewrite accepted historical plans merely to remove old path strings.

- [ ] **Step 6: Verify no active old references remain**

Run:

```powershell
rg -n "demo/|demo\\|handbook/|handbook\\" electron package.json README.md docs/00-product docs/01-architecture docs/05-implementation-design .codex/skills
bun test electron/tests/workspace-layout.test.ts
```

Expected: `rg` returns no active references and the layout test passes.

- [ ] **Step 7: Commit**

```powershell
git add -- demo handbook package.json bun.lock README.md electron/README.md electron/tests/workspace-layout.test.ts .codex/skills/packaging-ai-trpg-windows docs/00-product docs/01-architecture docs/05-implementation-design
git commit -m "refactor: remove legacy demo and handbook workspaces"
```

---

### Task 7: Full Regression and Windows Unpacked Delivery

**Files:**
- Modify only if verification exposes migration defects: files already moved under `electron/`
- Output: `electron/release/win-unpacked`
- Test: complete Electron test, build, persistence, E2E, and launch surface

**Interfaces:**
- Consumes the unified Electron workspace from Tasks 1–6.
- Produces one verified runnable `win-unpacked` directory and no installer/ZIP artifacts.

- [ ] **Step 1: Run every unit test**

Run: `bun test --cwd electron`

Expected: all migrated unit and integration tests pass with zero failures.

- [ ] **Step 2: Run typecheck and production build**

Run:

```powershell
bun run --cwd electron typecheck
bun run --cwd electron build
```

Expected: both commands exit 0 and `electron/dist/renderer/index.html`, `electron/dist/main.cjs`, and `electron/dist/preload.cjs` exist.

- [ ] **Step 3: Run complete behavioral verification**

Run:

```powershell
bun run --cwd electron smoke
bun run --cwd electron persist:check
bun run --cwd electron checkpoint:check
bun run --cwd electron gold
bun run --cwd electron content:check
bun run --cwd electron demo:e2e
```

Expected: all commands exit 0.

- [ ] **Step 4: Build only win-unpacked using the project skill**

Use `packaging-ai-trpg-windows`. Build to staging with electron-builder `--dir`, verify the staged app, then rotate it into `electron/release/win-unpacked`. Do not create portable, NSIS, ZIP, blockmap, or a second top-level release directory.

- [ ] **Step 5: Launch and inspect the packaged application**

Start `electron/release/win-unpacked/AI TRPG Engine.exe`, confirm it stays alive, opens the renderer, loads Mist Harbor packs, and can create or reopen a campaign. Stop only the verification process started by this step.

- [ ] **Step 6: Final path and dirty-tree audit**

Run:

```powershell
rg -n "demo/|demo\\|handbook/|handbook\\" electron package.json README.md docs/00-product docs/01-architecture docs/05-implementation-design .codex/skills
git status --short
```

Expected: no active old-path references. Review status line-by-line and confirm unrelated pre-existing changes remain untouched.

- [ ] **Step 7: Commit verification-only fixes if needed**

If Steps 1–6 required migration fixes, stage only those exact Electron files and commit:

```powershell
git commit -m "fix: close unified workspace verification gaps"
```

If no source changes were required, do not create an empty commit.
