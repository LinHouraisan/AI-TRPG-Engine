import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const root = join(import.meta.dir, "..");
const out = join(root, "dist");
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "main/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: join(out, "main.cjs"),
  external: ["electron", "better-sqlite3"],
});

await build({
  entryPoints: [join(root, "preload/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: join(out, "preload.cjs"),
  external: ["electron"],
});

cpSync(join(root, "sql"), join(out, "sql"), { recursive: true });
console.log("electron main/preload 已打包");
