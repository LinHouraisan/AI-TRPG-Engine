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
    text: "她听见了你的问题，却没有移开目光。",
    feedback: "她听见了你的问题。",
    reaction: "没有移开目光。",
    interactionPoints: ["她仍在等你说出那个名字。"],
  }, "dialogue")).toEqual({ ok: false, reason: "interaction_not_reflected" });
});

test("feedback and reaction must both be reflected in visible text", () => {
  expect(checkNarrationQuality({
    text: "她的指尖仍压在那张车票上，票背的字迹露在一旁。",
    feedback: "她听见了你的追问。",
    reaction: "她的指尖仍压在那张车票上。",
    interactionPoints: ["票背的字迹露在一旁"],
  }, "dialogue")).toEqual({ ok: false, reason: "feedback_not_reflected" });
  expect(checkNarrationQuality({
    text: "她听见了你的追问，票背的字迹露在一旁。",
    feedback: "她听见了你的追问。",
    reaction: "她的指尖仍压在那张车票上。",
    interactionPoints: ["票背的字迹露在一旁"],
  }, "dialogue")).toEqual({ ok: false, reason: "reaction_not_reflected" });
});

test("interaction points reject menus and copied player instructions", () => {
  const feedback = "她听见了你的追问";
  const reaction = "她的指尖仍压在那张车票上";
  for (const interactionPoint of [
    "1. 继续追问她",
    "你可以选择查看车票",
    "选项：询问那个名字",
    "继续追问她",
  ]) {
    expect(checkNarrationQuality({
      text: `${feedback}，${reaction}。${interactionPoint}。`,
      feedback,
      reaction,
      interactionPoints: [interactionPoint],
    }, "dialogue")).toEqual({ ok: false, reason: "menu_interaction" });
  }
});

test("interaction points reject player instructions appended to scene descriptions", () => {
  const feedback = "她听见了你的追问";
  const reaction = "她没有收起桌上的车票";
  for (const interactionPoint of [
    "车票仍摊在桌上，接下来请调查车票",
    "车门仍开着，然后你可以前往站台",
    "票背露出淡字，不妨查看那行墨痕",
    "女孩没有收回手，你能继续追问她",
    "雾里传来铃声，接下来选择行动",
  ]) {
    expect(checkNarrationQuality({
      text: `${feedback}，${reaction}。${interactionPoint}。`,
      feedback,
      reaction,
      interactionPoints: [interactionPoint],
    }, "dialogue")).toEqual({ ok: false, reason: "menu_interaction" });
  }
});

test("neutral affordances and quoted NPC speech are not player instructions", () => {
  const feedback = "她听见了你的追问";
  const reaction = "她没有收起桌上的车票";
  for (const interactionPoint of [
    "车票可以证明他的行程",
    "车票仍摊在桌上，票背的蓝墨痕没有被她遮住",
    "她低声说：“接下来请调查那张车票。”",
    "她低声说，接下来请调查那张车票",
  ]) {
    expect(checkNarrationQuality({
      text: `${feedback}，${reaction}。${interactionPoint}`,
      feedback,
      reaction,
      interactionPoints: [interactionPoint],
    }, "dialogue")).toEqual({ ok: true });
  }
});

test("a cohesive scene affordance satisfies every rich narration field", () => {
  expect(checkNarrationQuality({
    text: "她听见了你的追问，目光落向那张潮湿车票。车票背面的淡蓝字迹仍露在她指尖旁。",
    feedback: "她听见了你的追问。",
    reaction: "目光落向那张潮湿车票。",
    interactionPoints: ["车票背面的淡蓝字迹仍露在她指尖旁"],
  }, "dialogue")).toEqual({ ok: true });
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
  const short = "她听见了你的问题，没有移开目光，仍在等你说出那个名字。";
  expect(checkNarrationQuality({
    text: short,
    feedback: "她听见了你的问题。",
    reaction: "没有移开目光。",
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
