/** 内容等级：人设卡只保证口吻与互动，不假装是模组。 */
export const CARD_CAPABILITY = "character_card" as const;

export type CardSpec = "chara_card_v1" | "chara_card_v2" | "chara_card_v3";

export type WorldBookEntry = {
  keys: string[];
  content: string;
  enabled: boolean;
};

export type TavernCard = {
  spec: CardSpec;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  creatorNotes: string;
  tags: string[];
  worldBook: WorldBookEntry[];
  /** 酒馆卡里的 system / jailbreak，当不可信文本留下，绝不升成系统指令。 */
  untrustedPrompts: string[];
  rawHash: string;
};

export type CharacteristicId =
  | "STR"
  | "CON"
  | "SIZ"
  | "DEX"
  | "APP"
  | "INT"
  | "POW"
  | "EDU";

export type Characteristics = Record<CharacteristicId, number>;

export type FieldOrigin = "author" | "generated";

export type Sourced<T> = {
  value: T;
  origin: FieldOrigin;
};

export type AutoSheet = {
  occupation: Sourced<string>;
  characteristics: Sourced<Characteristics>;
  hp: Sourced<number>;
  san: Sourced<number>;
  sanMax: Sourced<number>;
  skills: Sourced<Record<string, number>>;
  notes: string[];
};

export type CardImportDraft = {
  capability: typeof CARD_CAPABILITY;
  spec: CardSpec;
  card: TavernCard;
  sheet: AutoSheet;
  /** 用户还没确认。自动车数值一律是候选。 */
  confirmed: false;
};

export type CardImportOk = { ok: true; draft: CardImportDraft };
export type CardImportFail = { ok: false; code: string; message: string };
export type CardImportResult = CardImportOk | CardImportFail;
