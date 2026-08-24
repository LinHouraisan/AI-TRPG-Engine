import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const electronRoot = join(import.meta.dir, "..");
const repositoryRoot = join(electronRoot, "..");

test("application sources and authored packs live inside electron", () => {
  expect(existsSync(join(electronRoot, "src/core/engine/runtime.ts"))).toBe(true);
  expect(existsSync(join(electronRoot, "src/core/keeper/keeper.ts"))).toBe(true);
  expect(existsSync(join(electronRoot, "src/renderer/main.tsx"))).toBe(true);
  expect(existsSync(join(electronRoot, "src/main/index.ts"))).toBe(true);
  expect(existsSync(join(electronRoot, "src/preload/index.ts"))).toBe(true);
  expect(existsSync(join(electronRoot, "src/shared/api.ts"))).toBe(true);
  expect(existsSync(join(electronRoot, "content/packs/mist-harbor/pack.json"))).toBe(true);
  expect(existsSync(join(electronRoot, "content/cards/fixtures/suheng.card.json"))).toBe(true);
  expect(existsSync(join(repositoryRoot, "demo"))).toBe(false);
  expect(existsSync(join(repositoryRoot, "handbook"))).toBe(false);
});
