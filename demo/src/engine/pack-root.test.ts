import { expect, test } from "bun:test";
import { resolveElectronPacksRoot } from "./pack-root";

test("packaged Electron falls back to the resources packs directory", () => {
  expect(
    resolveElectronPacksRoot(undefined, "C:\\Program Files\\AI TRPG Engine\\resources", (...parts) =>
      parts.join("\\"),
    ),
  ).toBe("C:\\Program Files\\AI TRPG Engine\\resources\\packs");
});

test("an explicit packs directory still takes precedence", () => {
  expect(resolveElectronPacksRoot("D:\\custom-packs", "C:\\resources", (...parts) => parts.join("\\"))).toBe(
    "D:\\custom-packs",
  );
});
