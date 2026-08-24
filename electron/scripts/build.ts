import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const root = join(import.meta.dir, "..");
const out = join(root, "dist");
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "src/main/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: join(out, "main.cjs"),
  external: ["electron", "better-sqlite3"],
  alias: aliases(root),
});

await build({
  entryPoints: [join(root, "src/preload/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: join(out, "preload.cjs"),
  external: ["electron"],
  alias: aliases(root),
});

cpSync(join(root, "sql"), join(out, "sql"), { recursive: true });
console.log("electron main/preload 已打包");

function aliases(root: string): Record<string, string> {
  return {
    "@core": join(root, "src/core"),
    "@renderer": join(root, "src/renderer"),
    "@shared": join(root, "src/shared"),
    "@main": join(root, "src/main"),
  };
}
