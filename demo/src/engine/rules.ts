import type { CheckResult } from "./types";

export type SkillBands = {
  regular: number;
  hard: number;
  extreme: number;
  fumbleFloor: number;
};

/**
 * 门槛只在这里算。界面和裁定都读这一份，免得房规改了之后两边各画各的。
 */
export function skillBands(skillValue: number): SkillBands {
  return {
    regular: skillValue,
    hard: Math.floor(skillValue / 2),
    extreme: Math.floor(skillValue / 5),
    fumbleFloor: skillValue < 50 ? 96 : 100,
  };
}

export function thresholdFor(
  skillValue: number,
  difficulty: CheckResult["difficulty"],
): number {
  const bands = skillBands(skillValue);
  if (difficulty === "extreme") return bands.extreme;
  if (difficulty === "hard") return bands.hard;
  return bands.regular;
}

/**
 * 百分骰（1d100）检定，按《克苏鲁的呼唤》第七版的成功等级来判。
 * 难度分三档：普通看技能值，困难看一半，极难看五分之一。
 * 规则由程序执行，主持人不参与，也拿不到点数以外的裁量权。
 */
export function resolveCheck(params: {
  skill: string;
  skillValue: number;
  difficulty: "regular" | "hard" | "extreme";
  roll: number;
}): CheckResult {
  const { skill, skillValue, difficulty, roll } = params;
  const bands = skillBands(skillValue);
  const threshold = thresholdFor(skillValue, difficulty);

  let level: CheckResult["level"];
  if (roll === 1) level = "大成功";
  else if (roll >= bands.fumbleFloor) level = "大失败";
  else if (roll <= bands.extreme) level = "极难成功";
  else if (roll <= bands.hard) level = "困难成功";
  else if (roll <= bands.regular) level = "成功";
  else level = "失败";

  const ok = roll !== 1 ? roll <= threshold && roll < bands.fumbleFloor : true;

  return { skill, skillValue, difficulty, threshold, roll, level, ok };
}

export function difficultyLabel(difficulty: CheckResult["difficulty"]): string {
  if (difficulty === "hard") return "困难";
  if (difficulty === "extreme") return "极难";
  return "普通";
}
