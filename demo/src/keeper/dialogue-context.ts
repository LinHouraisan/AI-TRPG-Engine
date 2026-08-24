import { evaluate } from "@/engine/conditions";
import { indexPack, itemVisibility, pack, type Pack } from "@/engine/pack";
import type { GameState } from "@/engine/types";

export type DialogueTurn = { player: string; gm: string };

type DialogueProfile = { lifeHistoryId?: string } | null;

export function latestDialogueTurns(recentTurns: DialogueTurn[]): DialogueTurn[] {
  return recentTurns.slice(-3);
}

export function resolveDialogueNpcId(params: {
  state: GameState;
  recentTurns: DialogueTurn[];
  spoken?: string;
  scenarioPack?: Pack;
}): string | undefined {
  const scenarioPack = params.scenarioPack ?? pack;
  const present = scenarioPack.npcs.filter((npc) => params.state.npcAt[npc.id] === params.state.pcAt);
  if (present.length === 1) return present[0]?.id;

  const dialogue = latestDialogueTurns(params.recentTurns);
  const words = [params.spoken ?? "", ...dialogue.flatMap((turn) => [turn.player, turn.gm])].join("\n");
  const named = present.filter((npc) => words.includes(npc.title));
  return named.length === 1 ? named[0]?.id : undefined;
}

export function buildRecentDialogueContext(recentTurns: DialogueTurn[]): string {
  const turns = latestDialogueTurns(recentTurns);
  if (turns.length === 0) return "";
  return [
    "【最近三轮完整对话（从早到晚）】",
    ...turns.flatMap((turn) => [`玩家：${turn.player}`, `守秘人：${turn.gm}`]),
  ].join("\n");
}

export function buildNpcDialogueContext(params: {
  npcId: string;
  state: GameState;
  recentTurns: DialogueTurn[];
  profile: DialogueProfile;
  scenarioPack?: Pack;
}): string {
  const scenarioPack = params.scenarioPack ?? pack;
  const index = indexPack(scenarioPack);
  const npc = index.npc(params.npcId);
  if (!npc || params.state.npcAt[npc.id] !== params.state.pcAt) {
    return buildRecentDialogueContext(params.recentTurns);
  }

  const ownFacts = npc.knownFacts
    .map((id) => index.fact(id)?.title)
    .filter((title): title is string => Boolean(title));
  const publicFacts = params.state.known
    .map((id) => index.fact(id))
    .filter((fact) => fact?.visibility === "public" && !npc.knownFacts.includes(fact.id))
    .map((fact) => fact!.title);
  const visibleItems = scenarioPack.items
    .filter((item) => params.state.itemAt[item.id] === params.state.pcAt && isVisible(item, params.state))
    .map((item) => item.title);
  const people = scenarioPack.npcs
    .filter((candidate) => params.state.npcAt[candidate.id] === params.state.pcAt)
    .map((candidate) => candidate.title);
  const historyId = params.profile?.lifeHistoryId ?? params.state.lifeHistoryId;
  const history = scenarioPack.manifest.creation?.lifeHistories.find(
    (candidate) => candidate.id === historyId && candidate.relationship.npcId === npc.id,
  );
  const relationship = history
    ? params.state.relationships?.[npc.id] ?? history.relationship.text
    : undefined;
  const room = index.room(params.state.pcAt);

  return [
    `【当前交谈对象】${npc.title}`,
    `【NPC 自身已知事实】${ownFacts.join("；") || "无"}`,
    `【双方已公开确认的事实】${publicFacts.join("；") || "无"}`,
    `【当前可感知】${room?.title ?? params.state.pcAt}；在场：${people.join("、") || "无"}；可见物品：${visibleItems.join("、") || "无"}`,
    `【NPC 公开表现】${npc.line}`,
    relationship ? `【共同关系】${relationship}` : "",
    buildRecentDialogueContext(params.recentTurns),
  ].filter(Boolean).join("\n");
}

function isVisible(item: Pack["items"][number], state: GameState): boolean {
  const visibility = itemVisibility(item);
  if (visibility.kind === "always") return true;
  if (visibility.kind === "never") return false;
  return evaluate(visibility.when, state);
}
