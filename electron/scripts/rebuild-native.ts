import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const version = JSON.parse(
  readFileSync(join(root, "node_modules/electron/package.json"), "utf8"),
).version as string;

const result = Bun.spawnSync(
  ["bunx", "prebuild-install", "--runtime", "electron", `--target=${version}`],
  {
    cwd: join(root, "node_modules/better-sqlite3"),
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exit(result.exitCode ?? 1);
