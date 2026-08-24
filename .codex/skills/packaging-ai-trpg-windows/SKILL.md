---
name: packaging-ai-trpg-windows
description: Use when packaging or refreshing the AI TRPG Engine Windows demo and the requested deliverable is a runnable win-unpacked folder, especially when old release output may be stale or locked.
---

# Package AI TRPG Engine for Windows

## Output contract

Produce one runnable folder at `electron/release/win-unpacked`.

Do not build installers, portable single-file executables, ZIP files, or blockmaps unless the user explicitly requests them. Final reporting should normally contain only the new folder path and verification result.

**REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion` before reporting success. Use `superpowers:systematic-debugging` if building, packaging, or launching behaves unexpectedly.

## Workflow

1. Record `git status --short`. Check whether the current and old folders contain both `AI TRPG Engine.exe` and `resources/app.asar`.
2. Ensure dependencies exist. If Electron dependencies are missing, install without package lifecycle scripts, then fetch the Electron-compatible native binary:

   ```powershell
   bun install --cwd electron --frozen-lockfile --ignore-scripts
   bun run --cwd electron rebuild:native
   ```

3. Build the Electron-owned renderer and main process:

   ```powershell
   bun run --cwd electron build
   ```

4. From `electron`, build only an unpacked directory into staging inside the existing release folder:

   ```powershell
   bunx electron-builder --win --x64 --dir --publish never --config.directories.output=release/staging
   ```

   Never start a second builder while a builder process is active.

5. Verify `electron/release/staging/win-unpacked` before rotating folders:

   ```powershell
   bun run --cwd electron typecheck
   bun run --cwd electron test
   bun run --cwd electron checkpoint:check
   bun run --cwd electron demo:e2e
   ```

   Launch the staged executable briefly and confirm it remains running. Stop only the process launched for this check.

6. Replace `win-unpacked` with the verified staged folder and delete staging. Before deletion or moving, resolve every absolute path and verify it remains under `electron/release`. If the current build is locked, stop and report the lock; do not create fallback release trees.

7. Confirm the final release directory contains only:

   ```text
   electron/release/win-unpacked
   ```

## Success criteria

- The new executable and `resources/app.asar` are newer than the source build.
- Targeted tests, checkpoint verification, E2E, and brief launch verification pass.
- `electron/release` contains no installer, ZIP, blockmap, temporary directory, or extra release tree.
- The user receives the `win-unpacked` folder, not the executable by itself.
