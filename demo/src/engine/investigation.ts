import type { InvestigatorProfile } from "../character/types";
import { evaluate } from "./conditions";
import { pack, type Pack } from "./pack";
import type { InvestigationDef } from "./schema";
import { resolveCheck } from "./rules";
import type { CheckResult, EventDraft, GameState } from "./types";

export type InvestigationProfile = Pick<InvestigatorProfile, "lifeHistoryId" | "skills">;

export function investigationProfileFromState(state: GameState): InvestigationProfile | null {
  if (!state.lifeHistoryId) return null;
  return { lifeHistoryId: state.lifeHistoryId, skills: state.skills };
}

export function visibleInvestigations(
  state: GameState,
  profile: InvestigationProfile,
  scenarioPack: Pack = pack,
) {
  if (state.lifeHistoryId !== profile.lifeHistoryId) return [];
  return scenarioPack.investigations.filter((investigation) =>
    investigation.room === state.pcAt &&
    (!investigation.lifeHistoryId || investigation.lifeHistoryId === profile.lifeHistoryId) &&
    evaluate(investigation.visibleWhen, state)
  );
}

export function allowedInvestigationSkills(
  investigation: InvestigationDef,
  profile: InvestigationProfile,
): string[] {
  return [investigation.defaultSkill, ...investigation.alternateSkills]
    .filter((skill) => profile.skills[skill] != null);
}

export function resolveInvestigation(params: {
  state: GameState;
  profile: InvestigationProfile;
  id: string;
  skill: string;
  stateVersion: number;
  rng: () => number;
  scenarioPack?: Pack;
}): { drafts: EventDraft[]; check?: CheckResult; clarification?: string } {
  if (params.stateVersion !== params.state.version) {
    return {
      drafts: [],
      clarification: `调查候选基于状态版本 ${params.stateVersion}，当前版本是 ${params.state.version}，请重新说明行动。`,
    };
  }
  const scenarioPack = params.scenarioPack ?? pack;
  const investigation = visibleInvestigations(params.state, params.profile, scenarioPack)
    .find((candidate) => candidate.id === params.id);
  if (!investigation) {
    return { drafts: [], clarification: "这个调查入口此刻不可用；请说明你想检查哪里或采用什么办法。" };
  }
  if (!allowedInvestigationSkills(investigation, params.profile).includes(params.skill)) {
    return { drafts: [], clarification: `这个调查入口不能使用「${params.skill}」；请换一种明确的调查方式。` };
  }

  const skillValue = params.profile.skills[params.skill];
  if (skillValue == null || params.state.skills[params.skill] !== skillValue) {
    return { drafts: [], clarification: "调查员档案与当前状态不一致，不能进行这次检定。" };
  }
  const random = params.rng();
  if (!Number.isFinite(random) || random < 0 || random >= 1) {
    return { drafts: [], clarification: "随机数源无效，不能进行这次检定。" };
  }

  const check = resolveCheck({
    skill: params.skill,
    skillValue,
    difficulty: investigation.difficulty,
    roll: 1 + Math.floor(random * 100),
  });
  const outcome = check.ok ? investigation.outcomes.success : investigation.outcomes.failure;
  const minutes = check.ok ? investigation.minutes.success : investigation.minutes.failure;
  const cause = `player:investigation:${investigation.id}`;
  const drafts: EventDraft[] = [
    {
      payload: { type: "check_resolved", target: investigation.id, check, minutes },
      summary: `${params.skill}检定（资料包 ${scenarioPack.ref}）：1d100 掷出 ${check.roll}，阈值 ${check.threshold} → ${check.level}。`,
      cause,
    },
    ...outcome.map((effect) => ({
      payload: effect.event,
      summary: effect.summary,
      visibility: effect.visibility,
      narration: effect.narration,
      cause,
    })),
  ];
  return { drafts, check };
}
