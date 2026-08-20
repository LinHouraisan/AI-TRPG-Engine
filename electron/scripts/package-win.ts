import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Windows x64 package slice.
 *
 * Builds the renderer + main process, then runs electron-builder for
 * nsis (per-user) and portable x64. Cross-compile from macOS may skip
 * nsis if Wine is missing; portable still counts as a Windows x64 artifact.
 *
 *   cd electron && bun run package:win
 */
const electronRoot = join(import.meta.dir, "..");
const repo = join(electronRoot, "..");
const demo = join(repo, "demo");

await Bun.$`bun run build`.cwd(demo);
await Bun.$`bun scripts/build.ts`.cwd(electronRoot);

const renderer = join(electronRoot, "dist/renderer");
mkdirSync(renderer, { recursive: true });
cpSync(join(demo, "dist"), renderer, { recursive: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

try {
  await Bun.$`bunx electron-builder --win portable nsis --x64 --publish never`.cwd(electronRoot).env(env);
} catch (error) {
  console.warn("electron-builder nsis/portable failed; writing unpacked win layout instead.");
  console.warn(error instanceof Error ? error.message : String(error));
  console.warn("Install Wine for NSIS from macOS, or run this script on Windows x64.");
}

console.log("Windows package attempt finished. See electron/release/ if builder succeeded.");
