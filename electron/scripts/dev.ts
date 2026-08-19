import { spawn } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const repo = join(root, "..");

await Bun.$`bun scripts/build.ts`.cwd(root);

const vite = spawn("bun", ["run", "dev"], {
  cwd: join(repo, "demo"),
  stdio: "inherit",
});

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      /* 还没起来 */
    }
    await Bun.sleep(250);
  }
  throw new Error(`等不到 ${url}`);
}

await waitFor("http://127.0.0.1:1421");

const electronBin = join(root, "node_modules/.bin/electron");
const electron = spawn(electronBin, ["."], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: "http://127.0.0.1:1421",
  },
});

const stop = () => {
  vite.kill();
  electron.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const code = await new Promise<number>((resolve) => {
  electron.on("exit", (value) => resolve(value ?? 0));
});
vite.kill();
process.exit(code);
