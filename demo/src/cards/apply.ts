import { pack } from "../engine/pack";
import { commit } from "../engine/runtime";
import type { EventDraft, GameEvent, GameState } from "../engine/types";
import type { CardImportDraft } from "./types";
import { CARD_CAPABILITY } from "./types";

export type AppliedSheet = {
  capability: typeof CARD_CAPABILITY;
  name: string;
  occupation: string;
  cardHash: string;
  confirmed: true;
};

export type SheetApplyInput = {
  name: string;
  occupation: string;
  hp: number;
  hpMax: number;
  san: number;
  sanMax: number;
  skills: Record<string, number>;
  cardHash: string;
};

export function sheetInputFromDraft(draft: CardImportDraft): SheetApplyInput {
  const packSkills = pack.manifest.investigator.skills;
  return {
    name: draft.card.name,
    occupation: draft.sheet.occupation.value,
    hp: draft.sheet.hp.value,
    hpMax: draft.sheet.hp.value,
    san: draft.sheet.san.value,
    sanMax: draft.sheet.sanMax.value,
    skills: { ...packSkills, ...draft.sheet.skills.value },
    cardHash: draft.card.rawHash,
  };
}

/** Merge generated skills onto pack skills so lock checks still have 开锁 etc. */
export function sheetDraft(input: SheetApplyInput): EventDraft {
  return {
    payload: {
      type: "sheet_applied",
      ...input,
    },
    summary: `调查员换成「${input.name}」（人设卡，已确认）。资料包里的预组调查员还在，这场用这张卡。`,
    cause: "player:character_card",
  };
}

export function applyCharacterCard(params: {
  state: GameState;
  log: GameEvent[];
  draft: CardImportDraft;
}): { state: GameState; log: GameEvent[]; committed: GameEvent[]; applied: AppliedSheet } {
  const turnId = `turn-${params.state.turn + 1}`;
  const input = sheetInputFromDraft(params.draft);
  const result = commit({
    state: params.state,
    log: params.log,
    drafts: [sheetDraft(input)],
    turnId,
  });
  return {
    ...result,
    applied: {
      capability: CARD_CAPABILITY,
      name: input.name,
      occupation: input.occupation,
      cardHash: input.cardHash,
      confirmed: true,
    },
  };
}
