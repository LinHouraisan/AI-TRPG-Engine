import { newId } from "@/lib/ids";
import type { Character } from "@/lib/types";
import { lookupCheckTarget, type CheckTarget } from "@/lib/check-targets";

export type CheckProposal = {
  who: string;
  skill: string;
  target?: string;
};

export type CheckResult = {
  id: string;
  who: string;
  whoId: string;
  skill: string;
  skillValue: number;
  target?: string;
  pack: "percentile" | "d20";
  die: "1d100" | "1d20";
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  threshold: number;
  ok: boolean;
  outcome: "success" | "failure";
  detail: string;
};

export type CheckFailure = {
  error: string;
};

const SKILL_ALIASES: Record<string, string> = {
  开锁: "sleight of hand",
  锁匠: "sleight of hand",
  lockpick: "sleight of hand",
  lockpicking: "sleight of hand",
  "thieves' tools": "sleight of hand",
  图书馆: "investigation",
  library: "investigation",
  观察: "perception",
  聆听: "perception",
  潜行: "stealth",
  说服: "persuasion",
  恐吓: "intimidation",
  心理学: "insight",
};

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;

type AbilityKey = (typeof ABILITY_KEYS)[number];

function isAbilityKey(name: string): name is AbilityKey {
  return (ABILITY_KEYS as readonly string[]).includes(name);
}

const SKILL_ABILITY: Record<string, AbilityKey> = {
  athletics: "str",
  acrobatics: "dex",
  "sleight of hand": "dex",
  stealth: "dex",
  investigation: "int",
  history: "int",
  nature: "int",
  religion: "int",
  insight: "wis",
  medicine: "wis",
  perception: "wis",
  survival: "wis",
  deception: "cha",
  intimidation: "cha",
  performance: "cha",
  persuasion: "cha",
};

function rollDie(sides: number): number {
  return 1 + Math.floor(Math.random() * sides);
}

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function proficiency(level: number): number {
  return 2 + Math.floor((level - 1) / 4);
}

function normalizeSkill(name: string): string {
  const key = name.trim().toLowerCase();
  return SKILL_ALIASES[key] ?? SKILL_ALIASES[name.trim()] ?? key;
}

function sheetSkills(character: Character): Record<string, number> {
  const extra = character.stats as Character["stats"] & {
    skills?: Record<string, number>;
  };
  return extra.skills ?? {};
}

function percentileValue(character: Character, skill: string): number | null {
  const skills = sheetSkills(character);
  const direct = skills[skill] ?? skills[skill.trim()];
  if (typeof direct === "number") return direct;
  const aliased = skills[normalizeSkill(skill)];
  if (typeof aliased === "number") return aliased;
  for (const [name, value] of Object.entries(skills)) {
    if (normalizeSkill(name) === normalizeSkill(skill)) return value;
  }
  return null;
}

function d20Modifier(character: Character, skill: string): number | null {
  const norm = normalizeSkill(skill);
  const ability = SKILL_ABILITY[norm];
  if (!ability) {
    const raw = skill.trim().toLowerCase();
    if (isAbilityKey(raw)) {
      return abilityMod(character.stats[raw]);
    }
    return null;
  }
  return abilityMod(character.stats[ability]) + proficiency(character.level);
}

export function resolveCheck(
  proposal: CheckProposal,
  character: Character,
  target: CheckTarget | null,
  rng: (sides: number) => number = rollDie,
): CheckResult | CheckFailure {
  const skillName = proposal.skill.trim();
  if (!skillName) return { error: "检定必须指定一项技能" };

  const requiredSkill = target?.skill;
  if (requiredSkill && normalizeSkill(requiredSkill) !== normalizeSkill(skillName)) {
    return {
      error: `这个目标需要的是 ${requiredSkill}，而不是 ${skillName}`,
    };
  }

  const percentile = percentileValue(character, skillName);
  const pack: CheckResult["pack"] = percentile != null ? "percentile" : "d20";

  if (pack === "d20") {
    const modifier = d20Modifier(character, skillName);
    if (modifier == null) {
      return { error: `${character.name} 的人物卡上没有叫 ${skillName} 的技能或属性` };
    }
    const dc = target?.dc20 ?? 15;
    const roll = rng(20);
    const total = roll + modifier;
    const ok = total >= dc;
    return {
      id: newId(),
      who: character.name,
      whoId: character.id,
      skill: skillName,
      skillValue: modifier,
      target: proposal.target,
      pack,
      die: "1d20",
      roll,
      modifier,
      total,
      dc,
      threshold: dc,
      ok,
      outcome: ok ? "success" : "failure",
      detail: `${character.name} ${skillName} 1d20+${modifier} → ${roll}+${modifier}=${total}，对抗难度 ${dc} → ${ok ? "成功" : "失败"}`,
    };
  }

  const skillValue = percentile as number;
  const dc = target?.dc ?? skillValue;
  let threshold = skillValue;
  if (target?.difficulty === "hard") threshold = Math.floor(skillValue / 2);
  if (target?.difficulty === "extreme") threshold = Math.floor(skillValue / 5);

  const roll = rng(100);
  const tooHard = target?.dc != null && skillValue < target.dc;
  const ok = !tooHard && roll <= threshold;

  return {
    id: newId(),
    who: character.name,
    whoId: character.id,
    skill: skillName,
    skillValue,
    target: proposal.target,
    pack,
    die: "1d100",
    roll,
    modifier: 0,
    total: roll,
    dc,
    threshold,
    ok,
    outcome: ok ? "success" : "failure",
    detail: tooHard
      ? `${character.name} ${skillName} ${skillValue} 低于难度 ${dc} → 失败`
      : `${character.name} ${skillName} 1d100 → ${roll} / ${threshold} → ${ok ? "成功" : "失败"}`,
  };
}

export function executeCheck(
  proposal: CheckProposal,
  character: Character,
): CheckResult | CheckFailure {
  const target = proposal.target ? lookupCheckTarget(proposal.target) : null;
  if (proposal.target && !target) {
    return { error: `未知的检定目标：${proposal.target}` };
  }
  return resolveCheck(proposal, character, target);
}
