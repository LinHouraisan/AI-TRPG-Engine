import { allocationBudget, validateAllocation } from "@core/character/creation";
import type {
  AllocationIssue,
  InvestigatorAllocation,
  InvestigatorCreationRules,
} from "@core/character/types";

export type CreationStep = "premise" | "occupation" | "skills" | "history" | "review";

export type OpeningGate = "creation" | "unsupported" | "play";

export function openingGate(hasConfirmedInvestigator: boolean, hasCreationRules: boolean): OpeningGate {
  if (hasConfirmedInvestigator) return "play";
  return hasCreationRules ? "creation" : "unsupported";
}

export type ConfirmationState = { error: string | null };
export const initialConfirmationState: ConfirmationState = { error: null };

export function confirmationReducer(
  state: ConfirmationState,
  action: { type: "attempted" } | { type: "rejected"; error: string },
): ConfirmationState {
  if (action.type === "attempted") return initialConfirmationState;
  return state.error === action.error ? state : { error: action.error };
}

export function canSubmitConfirmation(params: {
  ready: boolean;
  busy: boolean;
  issueCount: number;
}): boolean {
  return params.ready && !params.busy && params.issueCount === 0;
}

export function shouldAutoConfirm(params: {
  step: CreationStep;
  ready: boolean;
  busy: boolean;
  issueCount: number;
  alreadyAttempted: boolean;
}): boolean {
  return params.step === "review"
    && canSubmitConfirmation(params)
    && !params.alreadyAttempted;
}

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
      occupationPoints: { ...rules.occupationDefaults },
      interestPoints: {},
    },
    issues: [],
  };
}

export function creationReducer(state: CreationState, action: CreationAction): CreationState {
  if (action.type === "go") return moveTo(state, action.step);

  const allocation = updateAllocation(state.allocation, action, state.rules);
  return {
    ...state,
    allocation,
    issues: validate(allocation, state.rules),
  };
}

function updateAllocation(
  allocation: InvestigatorAllocation,
  action: Exclude<CreationAction, { type: "go" }>,
  rules: InvestigatorCreationRules,
): InvestigatorAllocation {
  if (action.type === "set-name") return { ...allocation, name: action.name };
  if (action.type === "select-history") {
    return { ...allocation, lifeHistoryId: action.lifeHistoryId };
  }
  const key = action.pool === "occupation" ? "occupationPoints" : "interestPoints";
  const otherKey = action.pool === "occupation" ? "interestPoints" : "occupationPoints";
  const current = allocation[key][action.skill] ?? 0;
  const spentElsewhere = Object.entries(allocation[key])
    .reduce((total, [skill, value]) => total + (skill === action.skill ? 0 : value), 0);
  const poolBudget = allocationBudget(rules)[action.pool];
  const skillRoom = rules.maxSkill
    - (rules.baseSkills[action.skill] ?? 0)
    - (allocation[otherKey][action.skill] ?? 0);
  const maximum = Math.max(0, Math.min(poolBudget - spentElsewhere, skillRoom));
  const value = Number.isFinite(action.value)
    ? Math.min(maximum, Math.max(0, Math.trunc(action.value)))
    : current;
  return {
    ...allocation,
    [key]: { ...allocation[key], [action.skill]: value },
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
