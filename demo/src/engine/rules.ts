import type { CheckResult } from "./types";

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
  const hard = Math.floor(skillValue / 2);
  const extreme = Math.floor(skillValue / 5);
  const threshold =
    difficulty === "extreme" ? extreme : difficulty === "hard" ? hard : skillValue;

  const fumbleFloor = skillValue < 50 ? 96 : 100;

  let level: CheckResult["level"];
  if (roll === 1) level = "大成功";
  else if (roll >= fumbleFloor) level = "大失败";
  else if (roll <= extreme) level = "极难成功";
  else if (roll <= hard) level = "困难成功";
  else if (roll <= skillValue) level = "成功";
  else level = "失败";

  const ok = roll !== 1 ? roll <= threshold && roll < fumbleFloor : true;

  return { skill, skillValue, difficulty, threshold, roll, level, ok };
}

export function difficultyLabel(difficulty: CheckResult["difficulty"]): string {
  if (difficulty === "hard") return "困难";
  if (difficulty === "extreme") return "极难";
  return "普通";
}
