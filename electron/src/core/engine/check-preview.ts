import type { InvestigationProfile } from "./investigation";
import { allowedInvestigationSkills, visibleInvestigations } from "./investigation";
import { pack, packIndex, type Pack } from "./pack";
import { thresholdFor } from "./rules";
import type { CheckCandidate, GameState, Intent } from "./types";

export function checkCandidateForIntent(params: {
  intent: Intent;
  state: GameState;
  profile: InvestigationProfile | null;
  scenarioPack?: Pack;
}): CheckCandidate | null {
  const { intent, state, profile } = params;
  if (intent.kind === "unlock") {
    const lock = packIndex.lock(intent.lock);
    if (!lock || lock.at !== state.pcAt || state.unlocked[lock.id]) return null;
    const skillValue = state.skills[lock.skill];
    if (skillValue == null) return null;
    return {
      title: lock.title,
      skill: lock.skill,
      skillValue,
      difficulty: lock.difficulty,
      threshold: thresholdFor(skillValue, lock.difficulty),
    };
  }
  if (intent.kind === "free_check") {
    const skillValue = state.skills[intent.skill];
    if (skillValue == null) return null;
    return {
      title: intent.approach,
      skill: intent.skill,
      skillValue,
      difficulty: intent.difficulty,
      threshold: thresholdFor(skillValue, intent.difficulty),
    };
  }
  if (intent.kind !== "investigation" || !profile || intent.stateVersion !== state.version) {
    return null;
  }
  const investigation = visibleInvestigations(state, profile, params.scenarioPack ?? pack)
    .find((candidate) => candidate.id === intent.investigationId);
  if (!investigation || !allowedInvestigationSkills(investigation, profile).includes(intent.skill)) {
    return null;
  }
  const skillValue = profile.skills[intent.skill];
  if (skillValue == null || state.skills[intent.skill] !== skillValue) return null;
  return {
    title: investigation.title,
    skill: intent.skill,
    skillValue,
    difficulty: investigation.difficulty,
    threshold: thresholdFor(skillValue, investigation.difficulty),
  };
}

export async function publishCheckCandidate(params: {
  candidate: CheckCandidate | null;
  onCandidate: (candidate: CheckCandidate) => void;
  yieldControl?: () => Promise<void>;
}): Promise<void> {
  if (!params.candidate) return;
  params.onCandidate(params.candidate);
  await (params.yieldControl ?? yieldToNextTask)();
}

function yieldToNextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
