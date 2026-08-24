---
name: packaging-ai-trpg-windows
description: Use when packaging, rebuilding, refreshing, or preparing a Windows exe or demo build for the AI TRPG Engine repository, especially when electron-builder hangs, release artifacts may be stale, or win-unpacked must be delivered safely.
---

# Package AI TRPG Engine for Windows

## Core rule

Deliver only an artifact proven newer than the current source and verified by the project tests. Treat `electron/release/AI TRPG Engine-0.1.0-win-x64.exe` as stale until its timestamp and SHA-256 change during the current run.

**REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion` before reporting success. Use `superpowers:systematic-debugging` if building, packaging, or launching behaves unexpectedly.

## Workflow

1. Record `git status --short`, the latest commit time, and each existing artifact's length, timestamp, and SHA-256.
2. Run the full build once from the repository root:

   ```powershell
   bun run --cwd electron package:win
   ```

3. After the command yields, inspect `bun`, `node`, and electron-builder processes. A yielded command does not prove packaging ended. Never start a second builder while a verified builder process is active.
4. Poll process CPU and release-file size/timestamps at short intervals. If progress continues, wait. If the same verified builder has no CPU, child-process, or output growth across repeated observations, stop only its exact PID, confirm it exited, and preserve completed output.
5. Classify candidates:

   | Candidate | Accept only when |
   |---|---|
   | Outer single-file exe | New timestamp and hash, stable nonzero size, and launch verification pass |
   | `win-unpacked` | `resources/app.asar` and the executable were refreshed after the build, and verification passes |
   | `electron/dist` | Never deliver; it is build input |

6. Verify the current source and demo path:

   ```powershell
   bun test demo/src/session-opening.test.ts demo/src/keeper/guard.test.ts demo/src/keeper/free-turn.test.ts demo/src/character/creation.test.ts
   bun run --cwd electron checkpoint:check
   bun run --cwd electron demo:e2e
   ```

7. Hash the delivered candidate again after tests. Report the exact path, timestamp, size, SHA-256, test counts, and any packaging limitation.

## Delivery contract

- Prefer a verified fresh single-file exe when Electron Builder completes.
- If single-file packaging stalls but fresh `win-unpacked` passes verification, deliver the entire `electron/release/win-unpacked` directory as the portable demo. In the shared workspace, link to its executable; for transfer, archive the whole directory. Never send that exe alone because it depends on adjacent files.
- Explicitly identify stale outer installers that the user must not run.
- Recommend a new campaign when validating investigator creation; legacy campaigns may retain old data.

## Common mistakes

- Starting another builder because the parent command yielded.
- Calling an old outer exe "new" because `electron/dist` changed.
- Copying only `win-unpacked/AI TRPG Engine.exe` without its directory.
- Claiming the app is demonstrable from compilation alone instead of running targeted tests and `demo:e2e`.

## Example verdict

“The single-file installer is stale. The refreshed `win-unpacked` directory passed targeted tests, checkpoint recovery, and Mist Harbor E2E, so it is the current portable demo; run the executable inside that directory and keep all adjacent files.”
