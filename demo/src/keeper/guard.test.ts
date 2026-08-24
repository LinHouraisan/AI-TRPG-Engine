import { expect, test } from "bun:test";
import { checkNarration, checkNarrationQuality } from "./guard";

test("dialogue narration requires feedback, reaction, and an interaction point", () => {
  expect(checkNarrationQuality({
    text: "她看着你。",
    feedback: "",
    reaction: "",
    interactionPoints: [],
  }, "dialogue")).toEqual({ ok: false, reason: "missing_feedback" });
});

test("dialogue narration requires each remaining semantic field", () => {
  expect(checkNarrationQuality({
    text: "她看着你。",
    feedback: "她听见了你的问题。",
    reaction: "",
    interactionPoints: ["她仍在等你说出那个名字。"],
  }, "dialogue")).toEqual({ ok: false, reason: "missing_reaction" });
  expect(checkNarrationQuality({
    text: "她听见了你的问题，仍在等你说出那个名字。",
    feedback: "她听见了你的问题。",
    reaction: "她没有移开目光。",
    interactionPoints: [],
  }, "dialogue")).toEqual({ ok: false, reason: "missing_interaction_points" });
});

test("punctuation-only semantic fields do not count as present", () => {
  expect(checkNarrationQuality({
    text: "她听见了你的问题。",
    feedback: "……",
    reaction: "她没有移开目光。",
    interactionPoints: ["继续追问"],
  }, "dialogue")).toEqual({ ok: false, reason: "missing_feedback" });
  expect(checkNarrationQuality({
    text: "她听见了你的问题。",
    feedback: "她听见了你的问题。",
    reaction: "她没有移开目光。",
    interactionPoints: ["……"],
  }, "dialogue")).toEqual({ ok: false, reason: "missing_interaction_points" });
});

test("interaction points must be reflected in the cohesive text", () => {
  expect(checkNarrationQuality({
    text: "她听完后安静地看着你。",
    feedback: "她听见了你的问题。",
    reaction: "她没有移开目光。",
    interactionPoints: ["她仍在等你说出那个名字。"],
  }, "dialogue")).toEqual({ ok: false, reason: "interaction_not_reflected" });
});

test("quality does not accept repeated padding", () => {
  const repeated = "她看着你。".repeat(40);
  expect(checkNarrationQuality({
    text: repeated,
    feedback: repeated,
    reaction: repeated,
    interactionPoints: [repeated],
  }, "dialogue").ok).toBe(false);

  const longerRepeated = "她把泛白的车票推回桌面，却什么也没有说。".repeat(12);
  expect(checkNarrationQuality({
    text: longerRepeated,
    feedback: longerRepeated,
    reaction: longerRepeated,
    interactionPoints: [longerRepeated],
  }, "dialogue").ok).toBe(false);
});

test("the 150 to 350 character target is soft, but empty and unsafe text are rejected", () => {
  const short = "她听见了你的问题，仍在等你说出那个名字。";
  expect(checkNarrationQuality({
    text: short,
    feedback: "她听见了你的问题。",
    reaction: "她没有移开目光。",
    interactionPoints: ["仍在等你说出那个名字"],
  }, "dialogue")).toEqual({ ok: true });
  expect(checkNarrationQuality({
    text: "",
    feedback: "现场反馈",
    reaction: "环境反应",
    interactionPoints: ["互动点"],
  }, "exploration")).toEqual({ ok: false, reason: "empty_text" });
  expect(checkNarrationQuality({
    text: "潮".repeat(901),
    feedback: "现场反馈",
    reaction: "环境反应",
    interactionPoints: ["互动点"],
  }, "exploration")).toEqual({ ok: false, reason: "unsafe_length" });
});

test("simple deterministic replies do not require rich semantic fields", () => {
  expect(checkNarrationQuality({
    text: "你目前没有携带物品。",
    feedback: "",
    reaction: "",
    interactionPoints: [],
  }, "simple")).toEqual({ ok: true });
});

test("关键探索叙述可以超过旧的四百字限制", () => {
  const text = "潮湿的空气沿着墙缝缓慢流动。".repeat(30);
  expect(text.length).toBeGreaterThan(400);
  expect(checkNarration({ text, allowedNames: [], events: [] })).toEqual({ ok: true });
});
