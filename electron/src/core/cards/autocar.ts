import { rngFrom } from "../engine/rng";
import type {
  AutoSheet,
  CharacteristicId,
  Characteristics,
  Sourced,
  TavernCard,
} from "./types";

type Occupation = {
  title: string;
  keys: string[];
  skills: string[];
};

const OCCUPATIONS: Occupation[] = [
  {
    title: "记者",
    keys: ["记者", "journalist", "reporter", "报社", "采访", "通讯"],
    skills: ["图书馆使用", "话术", "侦查", "聆听", "心理学"],
  },
  {
    title: "医生",
    keys: ["医生", "医师", "doctor", "护士", "大夫", "诊所"],
    skills: ["医学", "急救", "科学", "精神分析", "心理学"],
  },
  {
    title: "侦探",
    keys: ["侦探", "警探", "detective", "私家侦探", "巡捕"],
    skills: ["侦查", "开锁", "话术", "法律", "聆听"],
  },
  {
    title: "学者",
    keys: ["学者", "教授", "professor", "研究员", "考古"],
    skills: ["图书馆使用", "科学", "历史", "外语", "侦查"],
  },
  {
    title: "学生",
    keys: ["学生", "student", "大学生", "同学"],
    skills: ["图书馆使用", "科学", "聆听", "话术"],
  },
  {
    title: "军人",
    keys: ["军人", "士兵", "soldier", "军官", "退伍"],
    skills: ["射击", "近战", "生存", "急救", "聆听"],
  },
  {
    title: "艺术家",
    keys: ["艺术家", "画家", "artist", "演员", "歌手"],
    skills: ["艺术", "话术", "心理学", "侦查"],
  },
  {
    title: "接线员",
    keys: ["接线", "话务", "接线员", "交换台"],
    skills: ["聆听", "话术", "侦查", "图书馆使用"],
  },
];

const BASE_SKILLS: Record<string, number> = {
  开锁: 1,
  侦查: 25,
  图书馆使用: 20,
  话术: 5,
  聆听: 20,
  心理学: 10,
  医学: 1,
  急救: 30,
  科学: 1,
  精神分析: 1,
  法律: 5,
  历史: 5,
  外语: 1,
  射击: 20,
  近战: 25,
  生存: 10,
  艺术: 5,
};

const KEYWORD_SKILLS: { skill: string; keys: string[] }[] = [
  { skill: "开锁", keys: ["锁", "撬", "钥匙", "开锁", "挂锁"] },
  { skill: "侦查", keys: ["痕迹", "线索", "观察", "书桌", "账本"] },
  { skill: "图书馆使用", keys: ["书", "档案", "图书馆", "账本", "册子"] },
  { skill: "聆听", keys: ["听见", "隔墙", "电话", "雨声"] },
  { skill: "话术", keys: ["说服", "采访", "房东", "攀谈"] },
];

function sourced<T>(value: T): Sourced<T> {
  return { value, origin: "generated" };
}

function d6(rng: () => number): number {
  return 1 + Math.floor(rng() * 6);
}

function roll3d6x5(rng: () => number): number {
  return (d6(rng) + d6(rng) + d6(rng)) * 5;
}

function roll2d6p6x5(rng: () => number): number {
  return (d6(rng) + d6(rng) + 6) * 5;
}

function blobOf(card: TavernCard): string {
  return [
    card.name,
    card.description,
    card.personality,
    card.scenario,
    card.worldBook.map((entry) => `${entry.keys.join(" ")} ${entry.content}`).join("\n"),
  ].join("\n");
}

function pickOccupation(text: string): Occupation {
  const lower = text.toLowerCase();
  for (const occupation of OCCUPATIONS) {
    if (occupation.keys.some((key) => lower.includes(key.toLowerCase()))) return occupation;
  }
  return { title: "普通人", keys: [], skills: ["话术", "侦查", "聆听"] };
}

function clampSkill(value: number): number {
  return Math.max(1, Math.min(90, value));
}

function spend(skills: Record<string, number>, names: string[], points: number): void {
  let rest = points;
  let guard = 0;
  while (rest > 0 && guard < 200) {
    const name = names[guard % names.length];
    if (!name) break;
    const current = skills[name] ?? 1;
    const add = Math.min(5, rest, 90 - current);
    if (add <= 0) {
      guard += 1;
      if (names.every((skill) => (skills[skill] ?? 1) >= 90)) break;
      continue;
    }
    skills[name] = current + add;
    rest -= add;
    guard += 1;
  }
}

function applyKeywords(skills: Record<string, number>, text: string): string[] {
  const notes: string[] = [];
  for (const rule of KEYWORD_SKILLS) {
    if (!rule.keys.some((key) => text.includes(key))) continue;
    const current = skills[rule.skill] ?? BASE_SKILLS[rule.skill] ?? 1;
    skills[rule.skill] = clampSkill(current + 5);
    notes.push(`世界观提到「${rule.keys.find((key) => text.includes(key))}」，${rule.skill} +5`);
  }
  return notes;
}

/**
 * 按描述 + 场景 + 世界书自动车。CoC 7e 百分规则，种子来自卡面原文，
 * 同一张卡永远同一份数值。全部标成 generated，不是作者原文。
 */
export function autoCar(card: TavernCard): AutoSheet {
  const blob = blobOf(card);
  const rng = rngFrom(`autocar:${card.rawHash}:${card.name}`);
  const occupation = pickOccupation(`${card.description}\n${card.personality}\n${card.tags.join(" ")}`);

  const characteristics: Characteristics = {
    STR: roll3d6x5(rng),
    CON: roll3d6x5(rng),
    SIZ: roll2d6p6x5(rng),
    DEX: roll3d6x5(rng),
    APP: roll3d6x5(rng),
    INT: roll2d6p6x5(rng),
    POW: roll3d6x5(rng),
    EDU: roll2d6p6x5(rng),
  };

  const skills: Record<string, number> = { ...BASE_SKILLS };
  spend(skills, occupation.skills, characteristics.EDU * 4);
  spend(skills, occupation.skills, characteristics.INT * 2);
  const notes = [
    `职业从描述判为「${occupation.title}」，不是作者写在卡上的职业栏。`,
    ...applyKeywords(skills, blob),
  ];

  const hp = Math.max(1, Math.floor((characteristics.CON + characteristics.SIZ) / 10));
  const san = characteristics.POW;
  for (const [name, value] of Object.entries(skills)) {
    skills[name] = clampSkill(value);
  }

  return {
    occupation: sourced(occupation.title),
    characteristics: sourced(characteristics),
    hp: sourced(hp),
    san: sourced(san),
    sanMax: sourced(99),
    skills: sourced(skills),
    notes,
  };
}

export function characteristicList(): CharacteristicId[] {
  return ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU"];
}
