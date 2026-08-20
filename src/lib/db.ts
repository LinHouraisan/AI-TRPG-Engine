import Database from "@tauri-apps/plugin-sql";
import type { UIMessage } from "ai";
import { newId, nowIso } from "@/lib/ids";
import {
  DEFAULT_STATS,
  type AbilityScores,
  type Campaign,
  type Character,
  type Combatant,
  type Encounter,
  type InventoryItem,
  type Note,
  type Session,
  type SrdDoc,
  type SrdHit,
} from "@/lib/types";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:ai-trpg-engine.db");
  }
  return dbPromise;
}

type CampaignRow = {
  id: string;
  name: string;
  premise: string;
  created_at: string;
  updated_at: string;
};

type SessionRow = {
  id: string;
  campaign_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type CharacterRow = {
  id: string;
  campaign_id: string;
  name: string;
  ancestry: string;
  class_name: string;
  level: number;
  hp: number;
  max_hp: number;
  ac: number;
  stats_json: string;
  conditions_json: string;
  inventory_json: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

type EncounterRow = {
  id: string;
  campaign_id: string;
  session_id: string | null;
  name: string;
  is_active: number;
  created_at: string;
};

type CombatantRow = {
  id: string;
  encounter_id: string;
  name: string;
  hp: number;
  max_hp: number;
  ac: number;
  initiative: number | null;
  conditions_json: string;
  is_player: number;
  character_id: string | null;
  sort_order: number;
};

type NoteRow = {
  id: string;
  campaign_id: string;
  session_id: string | null;
  title: string;
  body: string;
  created_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: UIMessage["role"];
  parts_json: string;
  created_at: string;
};

function mapCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    premise: row.premise,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    ancestry: row.ancestry,
    className: row.class_name,
    level: row.level,
    hp: row.hp,
    maxHp: row.max_hp,
    ac: row.ac,
    stats: JSON.parse(row.stats_json) as AbilityScores,
    conditions: JSON.parse(row.conditions_json) as string[],
    inventory: JSON.parse(row.inventory_json) as InventoryItem[],
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEncounter(row: EncounterRow): Encounter {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    name: row.name,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

function mapCombatant(row: CombatantRow): Combatant {
  return {
    id: row.id,
    encounterId: row.encounter_id,
    name: row.name,
    hp: row.hp,
    maxHp: row.max_hp,
    ac: row.ac,
    initiative: row.initiative,
    conditions: JSON.parse(row.conditions_json) as string[],
    isPlayer: row.is_player === 1,
    characterId: row.character_id,
    sortOrder: row.sort_order,
  };
}

function mapNote(row: NoteRow): Note {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function listCampaigns(): Promise<Campaign[]> {
  const db = await getDb();
  const rows = await db.select<CampaignRow[]>(
    "SELECT * FROM campaigns ORDER BY updated_at DESC",
  );
  return rows.map(mapCampaign);
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const db = await getDb();
  const rows = await db.select<CampaignRow[]>(
    "SELECT * FROM campaigns WHERE id = $1",
    [id],
  );
  return rows[0] ? mapCampaign(rows[0]) : null;
}

export async function createCampaign(input: {
  name: string;
  premise?: string;
}): Promise<{ campaign: Campaign; session: Session }> {
  const db = await getDb();
  const stamp = nowIso();
  const campaign: Campaign = {
    id: newId(),
    name: input.name.trim() || "未命名战役",
    premise: input.premise?.trim() ?? "",
    createdAt: stamp,
    updatedAt: stamp,
  };
  const session: Session = {
    id: newId(),
    campaignId: campaign.id,
    title: "第 1 场",
    createdAt: stamp,
    updatedAt: stamp,
  };

  await db.execute(
    "INSERT INTO campaigns (id, name, premise, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
    [campaign.id, campaign.name, campaign.premise, campaign.createdAt, campaign.updatedAt],
  );
  await db.execute(
    "INSERT INTO sessions (id, campaign_id, title, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
    [session.id, session.campaignId, session.title, session.createdAt, session.updatedAt],
  );

  return { campaign, session };
}

export async function listSessions(campaignId: string): Promise<Session[]> {
  const db = await getDb();
  const rows = await db.select<SessionRow[]>(
    "SELECT * FROM sessions WHERE campaign_id = $1 ORDER BY created_at ASC",
    [campaignId],
  );
  return rows.map(mapSession);
}

export async function createSession(
  campaignId: string,
  title?: string,
): Promise<Session> {
  const db = await getDb();
  const existing = await listSessions(campaignId);
  const stamp = nowIso();
  const session: Session = {
    id: newId(),
    campaignId,
    title: title?.trim() || `第 ${existing.length + 1} 场`,
    createdAt: stamp,
    updatedAt: stamp,
  };
  await db.execute(
    "INSERT INTO sessions (id, campaign_id, title, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
    [session.id, session.campaignId, session.title, session.createdAt, session.updatedAt],
  );
  await db.execute("UPDATE campaigns SET updated_at = $1 WHERE id = $2", [
    stamp,
    campaignId,
  ]);
  return session;
}

export async function loadMessages(sessionId: string): Promise<UIMessage[]> {
  const db = await getDb();
  const rows = await db.select<MessageRow[]>(
    "SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at ASC",
    [sessionId],
  );
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: JSON.parse(row.parts_json) as UIMessage["parts"],
  }));
}

export async function saveMessages(
  sessionId: string,
  messages: UIMessage[],
): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM messages WHERE session_id = $1", [sessionId]);
  const stamp = nowIso();
  for (const [index, message] of messages.entries()) {
    await db.execute(
      "INSERT INTO messages (id, session_id, role, parts_json, created_at) VALUES ($1, $2, $3, $4, $5)",
      [
        message.id,
        sessionId,
        message.role,
        JSON.stringify(message.parts),
        new Date(Date.parse(stamp) + index).toISOString(),
      ],
    );
  }
  await db.execute("UPDATE sessions SET updated_at = $1 WHERE id = $2", [
    stamp,
    sessionId,
  ]);
}

export async function listCharacters(campaignId: string): Promise<Character[]> {
  const db = await getDb();
  const rows = await db.select<CharacterRow[]>(
    "SELECT * FROM characters WHERE campaign_id = $1 ORDER BY name ASC",
    [campaignId],
  );
  return rows.map(mapCharacter);
}

export async function createCharacter(input: {
  campaignId: string;
  name: string;
  ancestry?: string;
  className?: string;
}): Promise<Character> {
  const db = await getDb();
  const stamp = nowIso();
  const character: Character = {
    id: newId(),
    campaignId: input.campaignId,
    name: input.name.trim() || "无名角色",
    ancestry: input.ancestry?.trim() ?? "",
    className: input.className?.trim() ?? "",
    level: 1,
    hp: 10,
    maxHp: 10,
    ac: 10,
    stats: { ...DEFAULT_STATS },
    conditions: [],
    inventory: [],
    notes: "",
    createdAt: stamp,
    updatedAt: stamp,
  };
  await db.execute(
    `INSERT INTO characters (
      id, campaign_id, name, ancestry, class_name, level, hp, max_hp, ac,
      stats_json, conditions_json, inventory_json, notes, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      character.id,
      character.campaignId,
      character.name,
      character.ancestry,
      character.className,
      character.level,
      character.hp,
      character.maxHp,
      character.ac,
      JSON.stringify(character.stats),
      JSON.stringify(character.conditions),
      JSON.stringify(character.inventory),
      character.notes,
      character.createdAt,
      character.updatedAt,
    ],
  );
  return character;
}

export async function updateCharacter(
  id: string,
  patch: Partial<
    Pick<
      Character,
      | "name"
      | "ancestry"
      | "className"
      | "level"
      | "hp"
      | "maxHp"
      | "ac"
      | "stats"
      | "conditions"
      | "inventory"
      | "notes"
    >
  >,
): Promise<Character | null> {
  const db = await getDb();
  const rows = await db.select<CharacterRow[]>(
    "SELECT * FROM characters WHERE id = $1",
    [id],
  );
  if (!rows[0]) return null;
  const current = mapCharacter(rows[0]);
  const next: Character = {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  };
  await db.execute(
    `UPDATE characters SET
      name=$1, ancestry=$2, class_name=$3, level=$4, hp=$5, max_hp=$6, ac=$7,
      stats_json=$8, conditions_json=$9, inventory_json=$10, notes=$11, updated_at=$12
     WHERE id=$13`,
    [
      next.name,
      next.ancestry,
      next.className,
      next.level,
      next.hp,
      next.maxHp,
      next.ac,
      JSON.stringify(next.stats),
      JSON.stringify(next.conditions),
      JSON.stringify(next.inventory),
      next.notes,
      next.updatedAt,
      next.id,
    ],
  );
  return next;
}

export async function getActiveEncounter(
  campaignId: string,
): Promise<{ encounter: Encounter; combatants: Combatant[] } | null> {
  const db = await getDb();
  const rows = await db.select<EncounterRow[]>(
    "SELECT * FROM encounters WHERE campaign_id = $1 AND is_active = 1 ORDER BY created_at DESC LIMIT 1",
    [campaignId],
  );
  if (!rows[0]) return null;
  const encounter = mapEncounter(rows[0]);
  const combatantRows = await db.select<CombatantRow[]>(
    "SELECT * FROM combatants WHERE encounter_id = $1 ORDER BY initiative DESC, sort_order ASC",
    [encounter.id],
  );
  return { encounter, combatants: combatantRows.map(mapCombatant) };
}

export async function startCombat(input: {
  campaignId: string;
  sessionId: string;
  name?: string;
}): Promise<{ encounter: Encounter; combatants: Combatant[] }> {
  const db = await getDb();
  await db.execute(
    "UPDATE encounters SET is_active = 0 WHERE campaign_id = $1",
    [input.campaignId],
  );
  const stamp = nowIso();
  const encounter: Encounter = {
    id: newId(),
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    name: input.name?.trim() || "遭遇战",
    isActive: true,
    createdAt: stamp,
  };
  await db.execute(
    "INSERT INTO encounters (id, campaign_id, session_id, name, is_active, created_at) VALUES ($1,$2,$3,$4,1,$5)",
    [
      encounter.id,
      encounter.campaignId,
      encounter.sessionId,
      encounter.name,
      encounter.createdAt,
    ],
  );

  const party = await listCharacters(input.campaignId);
  const combatants: Combatant[] = [];
  for (const [index, character] of party.entries()) {
    const combatant: Combatant = {
      id: newId(),
      encounterId: encounter.id,
      name: character.name,
      hp: character.hp,
      maxHp: character.maxHp,
      ac: character.ac,
      initiative: null,
      conditions: [...character.conditions],
      isPlayer: true,
      characterId: character.id,
      sortOrder: index,
    };
    await insertCombatant(db, combatant);
    combatants.push(combatant);
  }

  return { encounter, combatants };
}

async function insertCombatant(db: Database, combatant: Combatant): Promise<void> {
  await db.execute(
    `INSERT INTO combatants (
      id, encounter_id, name, hp, max_hp, ac, initiative, conditions_json,
      is_player, character_id, sort_order
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      combatant.id,
      combatant.encounterId,
      combatant.name,
      combatant.hp,
      combatant.maxHp,
      combatant.ac,
      combatant.initiative,
      JSON.stringify(combatant.conditions),
      combatant.isPlayer ? 1 : 0,
      combatant.characterId,
      combatant.sortOrder,
    ],
  );
}

export async function addCombatant(input: {
  encounterId: string;
  name: string;
  hp?: number;
  ac?: number;
  initiative?: number | null;
  isPlayer?: boolean;
  characterId?: string | null;
}): Promise<Combatant> {
  const db = await getDb();
  const existing = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) as n FROM combatants WHERE encounter_id = $1",
    [input.encounterId],
  );
  const hp = input.hp ?? 10;
  const combatant: Combatant = {
    id: newId(),
    encounterId: input.encounterId,
    name: input.name.trim() || "参战者",
    hp,
    maxHp: hp,
    ac: input.ac ?? 10,
    initiative: input.initiative ?? null,
    conditions: [],
    isPlayer: input.isPlayer ?? false,
    characterId: input.characterId ?? null,
    sortOrder: existing[0]?.n ?? 0,
  };
  await insertCombatant(db, combatant);
  return combatant;
}

export async function updateCombatant(
  id: string,
  patch: Partial<
    Pick<Combatant, "hp" | "maxHp" | "ac" | "initiative" | "conditions" | "name">
  >,
): Promise<Combatant | null> {
  const db = await getDb();
  const rows = await db.select<CombatantRow[]>(
    "SELECT * FROM combatants WHERE id = $1",
    [id],
  );
  if (!rows[0]) return null;
  const current = mapCombatant(rows[0]);
  const next: Combatant = { ...current, ...patch };
  await db.execute(
    `UPDATE combatants SET
      name=$1, hp=$2, max_hp=$3, ac=$4, initiative=$5, conditions_json=$6
     WHERE id=$7`,
    [
      next.name,
      next.hp,
      next.maxHp,
      next.ac,
      next.initiative,
      JSON.stringify(next.conditions),
      next.id,
    ],
  );
  if (next.characterId && patch.hp !== undefined) {
    await updateCharacter(next.characterId, { hp: next.hp });
  }
  return next;
}

export async function endCombat(campaignId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE encounters SET is_active = 0 WHERE campaign_id = $1",
    [campaignId],
  );
}

export async function listNotes(campaignId: string): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(
    "SELECT * FROM notes WHERE campaign_id = $1 ORDER BY created_at DESC",
    [campaignId],
  );
  return rows.map(mapNote);
}

export async function createNote(input: {
  campaignId: string;
  sessionId?: string | null;
  title: string;
  body: string;
}): Promise<Note> {
  const db = await getDb();
  const note: Note = {
    id: newId(),
    campaignId: input.campaignId,
    sessionId: input.sessionId ?? null,
    title: input.title.trim() || "笔记",
    body: input.body.trim(),
    createdAt: nowIso(),
  };
  await db.execute(
    "INSERT INTO notes (id, campaign_id, session_id, title, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [note.id, note.campaignId, note.sessionId, note.title, note.body, note.createdAt],
  );
  return note;
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export async function srdCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) as n FROM srd_fts",
  );
  return rows[0]?.n ?? 0;
}

export async function importSrd(docs: SrdDoc[]): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM srd_fts");
  for (const doc of docs) {
    await db.execute(
      "INSERT INTO srd_fts (doc_id, kind, title, body) VALUES ($1, $2, $3, $4)",
      [doc.id, doc.kind, doc.title, doc.body],
    );
  }
}

export async function searchSrd(query: string): Promise<SrdHit[]> {
  const db = await getDb();
  const safe = query.replace(/[^\w\s-]/g, " ").trim();
  if (!safe) return [];
  const rows = await db.select<
    { doc_id: string; kind: SrdDoc["kind"]; title: string; body: string; snippet: string }[]
  >(
    `SELECT doc_id, kind, title, body, snippet(srd_fts, 3, '', '', '…', 28) AS snippet
     FROM srd_fts
     WHERE srd_fts MATCH $1
     LIMIT 8`,
    [safe],
  );
  return rows.map((row) => ({
    id: row.doc_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    snippet: row.snippet,
  }));
}
