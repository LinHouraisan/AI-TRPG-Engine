import { expect, test } from "bun:test";
import { checkNarration } from "./guard";

test("关键探索叙述可以超过旧的四百字限制", () => {
  const text = "潮湿的空气沿着墙缝缓慢流动。".repeat(30);
  expect(text.length).toBeGreaterThan(400);
  expect(checkNarration({ text, allowedNames: [], events: [] })).toEqual({ ok: true });
});
