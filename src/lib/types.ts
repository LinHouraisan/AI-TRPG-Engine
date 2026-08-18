export type AbilityScores = {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  skills?: Record<string, number>;
};

export type InventoryItem = {
  name: string;
  qty: number;
};

export type Campaign = {
  id: string;
  name: string;
  premise: string;
  createdAt: string;
  updatedAt: string;
};

export type Session = {
  id: string;
  campaignId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Character = {
  id: string;
  campaignId: string;
  name: string;
  ancestry: string;
  className: string;
  level: number;
  hp: number;
  maxHp: number;
  ac: number;
  stats: AbilityScores;
  conditions: string[];
  inventory: InventoryItem[];
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type Encounter = {
  id: string;
  campaignId: string;
  sessionId: string | null;
  name: string;
  isActive: boolean;
  createdAt: string;
};

export type Combatant = {
  id: string;
  encounterId: string;
  name: string;
  hp: number;
  maxHp: number;
  ac: number;
  initiative: number | null;
  conditions: string[];
  isPlayer: boolean;
  characterId: string | null;
  sortOrder: number;
};

export type Note = {
  id: string;
  campaignId: string;
  sessionId: string | null;
  title: string;
  body: string;
  createdAt: string;
};

export type ProviderId =
  | "ollama"
  | "lmstudio"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "custom";

export type AppSettings = {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  lastCampaignId: string;
  lastSessionId: string;
};

export type SrdKind = "monster" | "spell" | "rule";

export type SrdDoc = {
  id: string;
  kind: SrdKind;
  title: string;
  body: string;
};

export type SrdHit = SrdDoc & {
  snippet: string;
};

export const DEFAULT_STATS: AbilityScores = {
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
};

export const DEFAULT_SETTINGS: AppSettings = {
  provider: "ollama",
  model: "llama3.1",
  baseUrl: "http://127.0.0.1:11434/v1",
  lastCampaignId: "",
  lastSessionId: "",
};

export const PROVIDER_DEFAULTS: Record<
  ProviderId,
  { label: string; baseUrl: string; model: string; needsKey: boolean }
> = {
  ollama: {
    label: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.1",
    needsKey: false,
  },
  lmstudio: {
    label: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
    needsKey: false,
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1",
    needsKey: true,
  },
  anthropic: {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
    needsKey: true,
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4.5",
    needsKey: true,
  },
  custom: {
    label: "自定义（兼容 OpenAI）",
    baseUrl: "http://127.0.0.1:8080/v1",
    model: "local-model",
    needsKey: false,
  },
};
