import type { EventPayload, GameEvent } from "./types";

export type FactDelta = {
  eventId: string;
  turnId: string;
  type: string;
  fields: Record<string, string | number | boolean | null>;
  stateVersion: number;
};

type FieldValue = string | number | boolean | null;

/**
 * Lossless compact fact channel from committed events.
 * Payload keys only — narration and other natural language stay off this map.
 */
export function factDeltas(events: GameEvent[]): FactDelta[] {
  return events.map((event) => ({
    eventId: event.id,
    turnId: event.turnId,
    type: event.payload.type,
    fields: payloadFields(event.payload),
    stateVersion: event.versionAfter,
  }));
}

function payloadFields(payload: EventPayload): Record<string, FieldValue> {
  const fields: Record<string, FieldValue> = {};
  flatten("", payload, fields);
  return fields;
}

function flatten(prefix: string, value: unknown, into: Record<string, FieldValue>): void {
  if (value === undefined) return;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (prefix) into[prefix] = value;
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === "narration") continue;
    flatten(prefix ? `${prefix}.${key}` : key, nested, into);
  }
}
