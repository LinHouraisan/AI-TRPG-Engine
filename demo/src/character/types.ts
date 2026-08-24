export type Characteristic = "STR" | "CON" | "SIZ" | "DEX" | "APP" | "INT" | "POW" | "EDU";

export type LifeHistoryDef = {
  id: string;
  title: string;
  background: string;
  roleplayPrompt: string;
  initialGrant: { kind: "fact" | "item"; id: string };
  relationship: { npcId: string; text: string };
  investigationId: string;
};

export type InvestigatorCreationRules = {
  occupation: string;
  characteristics: Record<Characteristic, number>;
  baseSkills: Record<string, number>;
  occupationSkills: string[];
  maxSkill: 90;
  hp: number;
  san: number;
  sanMax: number;
  contentVersion: string;
  lifeHistories: LifeHistoryDef[];
};

export type InvestigatorAllocation = {
  name: string;
  lifeHistoryId: string;
  occupationPoints: Record<string, number>;
  interestPoints: Record<string, number>;
};

export type InvestigatorProfile = {
  name: string;
  occupation: string;
  characteristics: Record<"STR" | "CON" | "SIZ" | "DEX" | "APP" | "INT" | "POW" | "EDU", number>;
  baseSkills: Record<string, number>;
  occupationPoints: Record<string, number>;
  interestPoints: Record<string, number>;
  skills: Record<string, number>;
  hp: number;
  san: number;
  sanMax: number;
  lifeHistoryId: string;
  contentVersion: string;
};

export type AllocationIssue = {
  code:
    | "NAME_INVALID"
    | "POINTS_INVALID"
    | "OCCUPATION_SKILL_INVALID"
    | "SKILL_UNKNOWN"
    | "LIFE_HISTORY_UNKNOWN"
    | "POINTS_REMAINING"
    | "MAX_SKILL_INVALID"
    | "SKILL_UNDER_MIN"
    | "SKILL_OVER_CAP";
  message: string;
  pool?: "occupation" | "interest";
  skill?: string;
};
