import { validateAllocation } from "@/character/creation";
import type {
  AllocationIssue,
  InvestigatorAllocation,
  InvestigatorCreationRules,
} from "@/character/types";

export type CreationStep = "premise" | "occupation" | "skills" | "history" | "review";

export type CreationState = {
  step: CreationStep;
  rules: InvestigatorCreationRules;
  allocation: InvestigatorAllocation;
  issues: AllocationIssue[];
};

export type CreationAction =
  | { type: "go"; step: CreationStep }
  | { type: "set-name"; name: string }
  | { type: "select-history"; lifeHistoryId: string }
  | {
      type: "set-points";
      pool: "occupation" | "interest";
      skill: string;
      value: number;
    };

export function initialCreationState(rules: InvestigatorCreationRules): CreationState {
  return {
    step: "premise",
    rules,
    allocation: {
      name: "林晚",
      lifeHistoryId: "",
      occupationPoints: {},
      interestPoints: {},
    },
    issues: [],
  };
}

export function creationReducer(state: CreationState, action: CreationAction): CreationState {
  if (action.type === "go") return moveTo(state, action.step);

  const allocation = updateAllocation(state.allocation, action);
  return {
    ...state,
    allocation,
    issues: validate(allocation, state.rules),
  };
}

function updateAllocation(
  allocation: InvestigatorAllocation,
  action: Exclude<CreationAction, { type: "go" }>,
): InvestigatorAllocation {
  if (action.type === "set-name") return { ...allocation, name: action.name };
  if (action.type === "select-history") {
    return { ...allocation, lifeHistoryId: action.lifeHistoryId };
  }
  const key = action.pool === "occupation" ? "occupationPoints" : "interestPoints";
  return {
    ...allocation,
    [key]: { ...allocation[key], [action.skill]: action.value },
  };
}

function moveTo(state: CreationState, step: CreationStep): CreationState {
  if (step === "premise" || step === "occupation" || step === "skills") {
    return { ...state, step };
  }

  const issues = validate(state.allocation, state.rules);
  if (step === "history") {
    const allocationIssues = issues.filter((issue) => issue.code !== "LIFE_HISTORY_UNKNOWN");
    return allocationIssues.length > 0
      ? { ...state, step: "skills", issues }
      : { ...state, step, issues };
  }

  if (issues.length === 0) return { ...state, step, issues };
  const skillsInvalid = issues.some((issue) => issue.code !== "LIFE_HISTORY_UNKNOWN");
  return { ...state, step: skillsInvalid ? "skills" : "history", issues };
}

function validate(
  allocation: InvestigatorAllocation,
  rules: InvestigatorCreationRules,
): AllocationIssue[] {
  const result = validateAllocation(rules, allocation);
  return result.ok ? [] : result.issues;
}
