---
name: packaging-ai-trpg-windows
description: Use when packaging or refreshing the AI TRPG Engine Windows demo and the requested deliverable is a runnable win-unpacked folder, especially when old release output may be stale or locked.
---

# Package AI TRPG Engine for Windows

## Output contract

Produce one runnable folder at `electron/release/win-unpacked`. Keep at most one previous complete build at `electron/release/win-unpacked-old`.

Do not build installers, portable single-file executables, ZIP files, or blockmaps unless the user explicitly requests them. Final reporting should normally contain only the new folder path and verification result.

**REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion` before reporting success. Use `superpowers:systematic-debugging` if building, packaging, or launching behaves unexpectedly.

## Workflow

1. Record `git status --short`. Check whether the current and old folders contain both `AI TRPG Engine.exe` and `resources/app.asar`.
2. Ensure dependencies exist. If Electron dependencies are missing, install without package lifecycle scripts, then fetch the Electron-compatible native binary:

   ```powershell
   bun install --cwd electron --frozen-lockfile --ignore-scripts
   bun run --cwd electron rebuild:native
   ```

3. Build renderer and main process, then replace only `electron/dist/renderer` with `demo/dist`:

   ```powershell
   bun run --cwd demo build
   bun run --cwd electron build:main
   ```

4. From `electron`, build only an unpacked directory into staging inside the existing release folder:

   ```powershell
   bunx electron-builder --win --x64 --dir --publish never --config.directories.output=release/staging
   ```

   Never start a second builder while a builder process is active.

5. Verify `electron/release/staging/win-unpacked` before rotating folders:

   ```powershell
   bun test demo/src/session-opening.test.ts demo/src/keeper/guard.test.ts demo/src/keeper/free-turn.test.ts demo/src/character/creation.test.ts
   bun run --cwd electron checkpoint:check
   bun run --cwd electron demo:e2e
   ```

   Launch the staged executable briefly and confirm it remains running. Stop only the process launched for this check.

6. Rotate only after verification succeeds:

   - Delete `win-unpacked-old` if it exists.
   - Move the current `win-unpacked` to `win-unpacked-old` only when it is complete; delete it when incomplete.
   - Move `staging/win-unpacked` to `win-unpacked`.
   - Delete the empty staging directory and unrelated generated files in `electron/release`.

   Before recursive deletion or moving on Windows, resolve every absolute path and verify it remains under `electron/release`. If the current build is locked and no packaged app process owns it, keep it in place and rename the verified staged folder to `win-unpacked-new`. Keep both under the same `electron/release`; never create another top-level release directory.

7. Confirm the final release directory contains only:

   ```text
   electron/release/win-unpacked
   electron/release/win-unpacked-old  # only when a complete previous build exists
   electron/release/win-unpacked-new  # lock fallback; replaces win-unpacked-old
   ```

## Success criteria

- The new executable and `resources/app.asar` are newer than the source build.
- Targeted tests, checkpoint verification, E2E, and brief launch verification pass.
- `electron/release` contains no installer, ZIP, blockmap, temporary directory, or extra release tree.
- The user receives the `win-unpacked` folder, not the executable by itself.
