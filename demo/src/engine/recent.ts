import type { GameEvent } from "./types";

export type RecentKind = "player" | "gm" | "event";

export type RecentRecord = {
  kind: RecentKind;
  text: string;
  stateVersion: number;
  turnId?: string;
};

/**
 * Hot channel: player text, GM output, and committed events from this turn.
 * Readable before Memory extract. Natural language is not upgraded to fact.
 */
export function recentFromTurn(params: {
  player: string;
  gm: string;
  committed: GameEvent[];
  stateVersion: number;
}): RecentRecord[] {
  const records: RecentRecord[] = [
    { kind: "player", text: params.player, stateVersion: params.stateVersion },
    { kind: "gm", text: params.gm, stateVersion: params.stateVersion },
  ];
  for (const event of params.committed) {
    records.push({
      kind: "event",
      text: event.summary,
      stateVersion: event.versionAfter,
      turnId: event.turnId,
    });
  }
  return records;
}
