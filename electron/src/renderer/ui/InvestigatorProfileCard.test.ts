import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { InvestigatorProfile } from "@core/character/types";
import { InvestigatorProfileCard } from "./InvestigatorProfileCard";

const profile: InvestigatorProfile = {
  name: "林晚",
  occupation: "记者",
  characteristics: { APP: 50, CON: 50, DEX: 60, EDU: 70, INT: 70, POW: 65, SIZ: 60, STR: 50 },
  baseSkills: { 话术: 5, 侦查: 25 },
  occupationPoints: { 话术: 70, 侦查: 55 },
  interestPoints: { 话术: 15, 侦查: 10 },
  skills: { 话术: 90, 侦查: 90 },
  hp: 11,
  san: 65,
  sanMax: 99,
  lifeHistoryId: "history.old-line-reporter",
  contentVersion: "0.1.0",
};

test("shared profile card shows the complete confirmed creation values", () => {
  const html = renderToStaticMarkup(createElement(InvestigatorProfileCard, {
    profile,
    hp: 9,
    hpMax: 11,
    san: 61,
    sanMax: 99,
    relationships: ["沈鹭信任你会把她的名字写进档案。"],
  }));
  const text = html.replace(/<[^>]+>/gu, "");

  expect(html).toContain("林晚");
  expect(html).toContain("记者");
  expect(html).toContain("旧线事故记者");
  expect(html).toContain("沈鹭信任你会把她的名字写进档案。");
  expect(text).toContain("基础 25 + 职业 55 + 兴趣 10 = 最终 90");
  expect(text).toContain("9 / 11");
  expect(text).toContain("61 / 99");
  expect(html.indexOf("STR")).toBeLessThan(html.indexOf("CON"));
  expect(html.indexOf("侦查")).toBeLessThan(html.indexOf("话术"));
});
