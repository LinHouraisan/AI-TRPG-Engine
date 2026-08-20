import type { FactDelta } from "../engine/fact-delta";
import type { RecentRecord } from "../engine/recent";

export type MemoryType =
  | "fact"
  | "causal"
  | "commitment"
  | "relation"
  | "goal"
  | "unresolved"
  | "scene"
  | "character"
  | "campaign";

export type MemoryEntry = {
  id: string;
  memoryType: MemoryType;
  summary: string;
  sources: string[];
  entityIds: string[];
  sceneId: string | null;
  importance: number;
  status: "active" | "superseded" | "conflicted";
  structured: Record<string, string | number | boolean | string[]>;
  extractedThroughTurn: number;
};

export type MemoryCursor = {
  rawRecordedThroughTurn: number;
  memoryProcessedThroughTurn: number;
};

export type MemoryState = {
  cursor: MemoryCursor;
  entries: MemoryEntry[];
};

const ENTITY_PREFIXES = ["loc.", "item.", "npc.", "pc.", "lock.", "fact.", "node."] as const;

/**
 * Cold Memory starts empty. Hot recording and extract are separate.
 */
export function emptyMemory(): MemoryState {
  return {
    cursor: { rawRecordedThroughTurn: 0, memoryProcessedThroughTurn: 0 },
    entries: [],
  };
}

/**
 * Hot channel cursor only. Does not extract or promote natural language to fact.
 */
export function recordRaw(state: MemoryState, turnNumber: number): MemoryState {
  return {
    ...state,
    cursor: {
      ...state.cursor,
      rawRecordedThroughTurn: Math.max(state.cursor.rawRecordedThroughTurn, turnNumber),
    },
  };
}

/**
 * Program extract over a fixed turn range of fact deltas.
 * Overlapping eventIds do not duplicate. Player/GM recent text is not summarized into facts.
 */
export function extractMemory(params: {
  memory: MemoryState;
  deltas: FactDelta[];
  recent: RecentRecord[];
  turnNumber: number;
  sceneId: string;
}): MemoryState {
  void params.recent;
  const seen = new Set<string>();
  for (const entry of params.memory.entries) {
    for (const source of entry.sources) seen.add(source);
  }

  const added: MemoryEntry[] = [];
  for (const delta of params.deltas) {
    if (seen.has(delta.eventId)) continue;
    seen.add(delta.eventId);
    added.push(factEntry(delta, params.turnNumber, params.sceneId));
  }

  return {
    cursor: {
      ...params.memory.cursor,
      memoryProcessedThroughTurn: Math.max(params.memory.cursor.memoryProcessedThroughTurn, params.turnNumber),
    },
    entries: [...params.memory.entries, ...added],
  };
}

/**
 * Incremental scene summary from accumulated active facts. Does not rewrite facts or reread history.
 */
export function consolidateMemory(memory: MemoryState, sceneId: string): MemoryState {
  const facts = memory.entries.filter(
    (entry) => entry.memoryType === "fact" && entry.status === "active" && entry.sceneId === sceneId,
  );
  if (facts.length < 3) return memory;

  const sources = unique(facts.flatMap((entry) => entry.sources));
  const eventTypes = facts.map((entry) => factType(entry));
  const existing = memory.entries.find(
    (entry) => entry.memoryType === "scene" && entry.sceneId === sceneId && entry.status === "active",
  );
  if (existing && sameSources(existing.sources, sources)) return memory;

  const extractedThroughTurn = Math.max(...facts.map((entry) => entry.extractedThroughTurn));
  const next: MemoryEntry = {
    id: `scene:${sceneId}:${extractedThroughTurn}:${sources.join(",")}`,
    memoryType: "scene",
    summary: eventTypes.join(", "),
    sources,
    entityIds: unique(facts.flatMap((entry) => entry.entityIds)),
    sceneId,
    importance: 2,
    status: "active",
    structured: { eventTypes },
    extractedThroughTurn,
  };

  return {
    ...memory,
    entries: [
      ...memory.entries.map((entry) =>
        entry.memoryType === "scene" && entry.sceneId === sceneId && entry.status === "active"
          ? { ...entry, status: "superseded" as const }
          : entry,
      ),
      next,
    ],
  };
}

function factEntry(delta: FactDelta, turnNumber: number, sceneId: string): MemoryEntry {
  const entityIds = entityIdsFrom(delta.fields);
  const structured: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(delta.fields)) {
    if (value !== null) structured[key] = value;
  }
  return {
    id: `fact:${delta.eventId}`,
    memoryType: "fact",
    summary: factSummary(delta),
    sources: [delta.eventId],
    entityIds,
    sceneId,
    importance: 1,
    status: "active",
    structured,
    extractedThroughTurn: turnNumber,
  };
}

function factSummary(delta: FactDelta): string {
  const parts: string[] = [delta.type];
  for (const [key, value] of Object.entries(delta.fields)) {
    if (key === "type") continue;
    parts.push(`${key}=${value}`);
  }
  return parts.join(" ");
}

function factType(entry: MemoryEntry): string {
  const type = entry.structured.type;
  return typeof type === "string" ? type : entry.summary.split(" ")[0] ?? "fact";
}

function entityIdsFrom(fields: FactDelta["fields"]): string[] {
  const ids: string[] = [];
  for (const value of Object.values(fields)) {
    if (typeof value !== "string") continue;
    if (ENTITY_PREFIXES.some((prefix) => value.startsWith(prefix))) ids.push(value);
  }
  return unique(ids);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sameSources(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const other = new Set(b);
  return a.every((id) => other.has(id));
}
