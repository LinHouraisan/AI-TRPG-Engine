import { getItem, listItems, type ItemDef } from "@/data/items";

export type CheckDifficulty = "regular" | "hard" | "extreme";

export type CheckTarget = {
  id: string;
  title: string;
  skill: string;
  dc?: number;
  dc20?: number;
  difficulty?: CheckDifficulty;
};

function checkAction(item: ItemDef): CheckTarget | null {
  const action = item.actions.find((entry) => entry.verb === "检定" && entry.skill);
  if (!action?.skill) return null;
  return {
    id: item.id,
    title: item.name,
    skill: action.skill,
    dc: action.dc,
    dc20: action.dc20,
  };
}

export function lookupCheckTarget(raw: string): CheckTarget | null {
  const item = getItem(raw);
  if (!item) return null;
  return checkAction(item);
}

export function listCheckTargets(): CheckTarget[] {
  return listItems()
    .map(checkAction)
    .filter((target): target is CheckTarget => target != null);
}
