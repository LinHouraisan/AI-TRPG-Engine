import { packIndex } from "./pack";
import { isHidden, npcsInRoom, visibleItemsInRoom } from "./state";
import type { StoryMonitorView } from "./story-monitor";
import type { GameEvent, GameState } from "./types";

export type ContextRetention = "required" | "optional" | "prefetch";

export type ContextEntry = {
  id: string;
  kind: string;
  text: string;
  sourceRefs: string[];
  stateVersion: number;
  retention: ContextRetention;
};

export type TurnSnapshot = {
  taskId: string;
  branchId: string;
  stateVersion: number;
  entries: ContextEntry[];
  builtAtTurn: number;
  story?: StoryMonitorView;
};

export type ContextStore = {
  current: TurnSnapshot | null;
  preparing: TurnSnapshot | null;
};

export type ContextPlanIds = {
  load: string[];
  drop: string[];
  preload: string[];
};

export type BaseLoadParams = {
  taskId: string;
  branchId: string;
  state: GameState;
  events: GameEvent[];
  turn: number;
  story?: StoryMonitorView;
};

const RESOURCE_ID = "pc.resources";

/**
 * Active Context is double-buffered and rebuildable. The current GM task
 * reads an immutable Turn Snapshot. Plans, memory, and prefetch write to
 * preparing. Swap only at the task boundary after source / permission /
 * version / budget checks. Incomplete preparing never blocks: use current
 * plus deterministic base load. No I/O, no model.
 */
export function emptyContextStore(): ContextStore {
  return { current: null, preparing: null };
}

export function baseLoad(params: BaseLoadParams): TurnSnapshot {
  const { taskId, branchId, state, events, turn, story } = params;
  const version = state.version;
  const entries: ContextEntry[] = [];

  const room = packIndex.room(state.pcAt);
  entries.push(
    required(
      state.pcAt,
      "location",
      room ? `${state.pcAt} ${room.title}` : state.pcAt,
      [state.pcAt],
      version,
    ),
  );

  for (const id of visibleItemsInRoom(state, state.pcAt)) {
    const item = packIndex.item(id);
    entries.push(
      required(id, "item", item ? `${id} ${item.title}` : id, [id], version),
    );
  }

  for (const id of npcsInRoom(state, state.pcAt)) {
    const npc = packIndex.npc(id);
    entries.push(required(id, "npc", npc ? `${id} ${npc.title}` : id, [id], version));
  }

  for (const event of events.slice(-3)) {
    entries.push(required(event.id, "event", event.summary, [event.id], version));
  }

  entries.push(
    required(
      RESOURCE_ID,
      "resource",
      `hp ${state.hp}/${state.hpMax} san ${state.san}/${state.sanMax}`,
      [RESOURCE_ID],
      version,
    ),
  );

  return {
    taskId,
    branchId,
    stateVersion: version,
    entries,
    builtAtTurn: turn,
    ...(story ? { story } : {}),
  };
}

export function beginPreparing(store: ContextStore, snapshot: TurnSnapshot): ContextStore {
  return {
    current: store.current,
    preparing: cloneSnapshot(snapshot),
  };
}

/**
 * Apply a broker-checked plan onto preparing. Unknown ids are skipped.
 * Required entries are never dropped. Hidden items and unknown secret
 * facts fail the permission check and are not added.
 */
export function applyPlan(
  preparing: TurnSnapshot,
  plan: ContextPlanIds,
  state: GameState,
): TurnSnapshot {
  if (preparing.stateVersion !== state.version) return preparing;

  const drop = new Set(plan.drop);
  const entries = preparing.entries.filter(
    (entry) => entry.retention === "required" || !drop.has(entry.id),
  );
  const seen = new Set(entries.map((entry) => entry.id));

  addFromIds(entries, seen, plan.load, "optional", preparing.stateVersion, state);
  addFromIds(entries, seen, plan.preload, "prefetch", preparing.stateVersion, state);

  return { ...preparing, entries };
}

export function commitPreparing(store: ContextStore): ContextStore {
  if (!store.preparing) return store;
  return { current: store.preparing, preparing: null };
}

export function snapshotForTask(store: ContextStore): TurnSnapshot {
  if (!store.current) {
    throw new Error("Turn Snapshot is not primed");
  }
  return store.current;
}

export function ensureCurrent(store: ContextStore, base: BaseLoadParams): ContextStore {
  if (store.current) return store;
  return { current: baseLoad(base), preparing: store.preparing };
}

function required(
  id: string,
  kind: string,
  text: string,
  sourceRefs: string[],
  stateVersion: number,
): ContextEntry {
  return { id, kind, text, sourceRefs, stateVersion, retention: "required" };
}

function cloneSnapshot(snapshot: TurnSnapshot): TurnSnapshot {
  return {
    ...snapshot,
    entries: snapshot.entries.map((entry) => ({ ...entry, sourceRefs: [...entry.sourceRefs] })),
  };
}

function addFromIds(
  entries: ContextEntry[],
  seen: Set<string>,
  ids: string[],
  retention: "optional" | "prefetch",
  stateVersion: number,
  state: GameState,
): void {
  for (const id of ids) {
    if (seen.has(id)) continue;
    const resolved = resolvePack(id, state);
    if (!resolved) continue;
    seen.add(id);
    entries.push({
      id,
      kind: resolved.kind,
      text: `${id} ${resolved.title}`,
      sourceRefs: [id],
      stateVersion,
      retention,
    });
  }
}

function resolvePack(
  id: string,
  state: GameState,
): { kind: "room" | "item" | "npc" | "fact" | "lock"; title: string } | undefined {
  const room = packIndex.room(id);
  if (room) return { kind: "room", title: room.title };

  const item = packIndex.item(id);
  if (item) {
    if (isHidden(state, id)) return undefined;
    return { kind: "item", title: item.title };
  }

  const npc = packIndex.npc(id);
  if (npc) return { kind: "npc", title: npc.title };

  const fact = packIndex.fact(id);
  if (fact) {
    if (fact.visibility === "secret" && !state.known.includes(id)) return undefined;
    return { kind: "fact", title: fact.title };
  }

  const lock = packIndex.lock(id);
  if (lock) return { kind: "lock", title: lock.title };

  return undefined;
}
