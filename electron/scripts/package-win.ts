import { join } from "node:path";

/**
 * Windows x64 package slice.
 *
 * Builds the renderer + main process, then writes one unpacked Windows
 * directory. Installers and archives are intentionally out of scope.
 *
 *   cd electron && bun run package:win
 */
const electronRoot = join(import.meta.dir, "..");
await Bun.$`bun run build`.cwd(electronRoot);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

await Bun.$`bunx electron-builder --win --x64 --dir --publish never`.cwd(electronRoot).env(env);
console.log("Windows unpacked build finished. See electron/release/win-unpacked/.");
