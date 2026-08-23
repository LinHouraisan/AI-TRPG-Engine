import type {
  AllocationIssue,
  InvestigatorAllocation,
  InvestigatorCreationRules,
  InvestigatorProfile,
} from "./types";

const MAX_SKILL = 90;

export function allocationBudget(rules: InvestigatorCreationRules): { occupation: number; interest: number } {
  return {
    occupation: rules.characteristics.EDU * 4,
    interest: rules.characteristics.INT * 2,
  };
}

export function validateAllocation(
  rules: InvestigatorCreationRules,
  allocation: InvestigatorAllocation,
): { ok: true; profile: InvestigatorProfile } | { ok: false; issues: AllocationIssue[] } {
  const issues: AllocationIssue[] = [];
  const occupationSkills = new Set(rules.occupationSkills);
  const skills = new Set(Object.keys(rules.baseSkills));
  const occupationPoints = validPoints(allocation.occupationPoints, "occupation", issues);
  const interestPoints = validPoints(allocation.interestPoints, "interest", issues);

  if (rules.maxSkill !== MAX_SKILL) {
    issues.push({
      code: "MAX_SKILL_INVALID",
      message: `调查员技能上限必须是 ${MAX_SKILL}`,
    });
  }

  for (const skill of Object.keys(occupationPoints)) {
    if (!occupationSkills.has(skill)) {
      issues.push({
        code: "OCCUPATION_SKILL_INVALID",
        message: `职业点不能分配给「${skill}」`,
        pool: "occupation",
        skill,
      });
    }
  }
  for (const skill of new Set([...Object.keys(occupationPoints), ...Object.keys(interestPoints)])) {
    if (!skills.has(skill)) {
      issues.push({ code: "SKILL_UNKNOWN", message: `没有技能「${skill}」`, skill });
    }
  }

  const budget = allocationBudget(rules);
  checkBudget("occupation", budget.occupation, occupationPoints, issues);
  checkBudget("interest", budget.interest, interestPoints, issues);

  if (!rules.lifeHistories.some((history) => history.id === allocation.lifeHistoryId)) {
    issues.push({ code: "LIFE_HISTORY_UNKNOWN", message: "选择的人生经历不存在" });
  }

  const finalSkills = Object.fromEntries(
    Object.entries(rules.baseSkills).map(([skill, base]) => [
      skill,
      base + (occupationPoints[skill] ?? 0) + (interestPoints[skill] ?? 0),
    ]),
  );
  for (const [skill, value] of Object.entries(finalSkills)) {
    if (value < 1) {
      issues.push({ code: "SKILL_UNDER_MIN", message: `技能「${skill}」不能低于 1`, skill });
    }
    if (value > MAX_SKILL) {
      issues.push({
        code: "SKILL_OVER_CAP",
        message: `技能「${skill}」不能高于 ${MAX_SKILL}`,
        skill,
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    profile: {
      name: allocation.name,
      occupation: rules.occupation,
      characteristics: { ...rules.characteristics },
      baseSkills: { ...rules.baseSkills },
      occupationPoints,
      interestPoints,
      skills: finalSkills,
      hp: rules.hp,
      san: rules.san,
      sanMax: rules.sanMax,
      lifeHistoryId: allocation.lifeHistoryId,
      contentVersion: rules.contentVersion,
    },
  };
}

function validPoints(
  points: Record<string, number>,
  pool: "occupation" | "interest",
  issues: AllocationIssue[],
): Record<string, number> {
  const valid: Record<string, number> = {};
  for (const [skill, value] of Object.entries(points)) {
    if (!Number.isInteger(value) || value < 0) {
      issues.push({
        code: "POINTS_INVALID",
        message: `「${skill}」的${pool === "occupation" ? "职业" : "兴趣"}点必须是非负整数`,
        pool,
        skill,
      });
      continue;
    }
    valid[skill] = value;
  }
  return valid;
}

function checkBudget(
  pool: "occupation" | "interest",
  budget: number,
  points: Record<string, number>,
  issues: AllocationIssue[],
): void {
  const spent = Object.values(points).reduce((total, value) => total + value, 0);
  if (spent !== budget) {
    issues.push({
      code: "POINTS_REMAINING",
      message: `${pool === "occupation" ? "职业" : "兴趣"}点必须恰好分完`,
      pool,
    });
  }
}
