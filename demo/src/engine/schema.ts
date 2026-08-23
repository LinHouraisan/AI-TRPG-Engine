import { z } from "zod";
import type { InvestigatorCreationRules } from "../character/types";

/**
 * 资料包的模式。模组作者写 JSON，这里负责校验。
 * 校验不过就不许开团——宁可开团失败，也不能让引擎带着一份说不清的资料跑。
 */

export const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ flag: z.string() }),
    z.object({ unlocked: z.string() }),
    z.object({ has: z.string() }),
    z.object({ observed: z.string() }),
    z.object({ pcAt: z.string() }),
    z.object({ npcAt: z.object({ npc: z.string(), room: z.string() }) }),
    z.object({ known: z.string() }),
    z.object({ clockGte: z.number().int().nonnegative() }),
    z.object({
      resource: z.object({
        which: z.enum(["hp", "san"]),
        lte: z.number().optional(),
        gte: z.number().optional(),
      }),
    }),
    z.object({ all: z.array(predicateSchema) }),
    z.object({ any: z.array(predicateSchema) }),
    z.object({ not: predicateSchema }),
  ]),
);

export type Predicate =
  | { flag: string }
  | { unlocked: string }
  | { has: string }
  | { observed: string }
  | { pcAt: string }
  | { npcAt: { npc: string; room: string } }
  | { known: string }
  | { clockGte: number }
  | { resource: { which: "hp" | "san"; lte?: number; gte?: number } }
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate };

export const roomSchema = z.object({
  id: z.string().startsWith("loc."),
  title: z.string(),
  intro: z.string(),
  exits: z.array(z.object({ to: z.string(), via: z.string() })),
});

export const itemSchema = z.object({
  id: z.string().startsWith("item."),
  title: z.string(),
  aliases: z.array(z.string()).default([]),
  at: z.string(),
  observed: z.string(),
  keeperNote: z.string().optional(),
  observeGrants: z.string().optional(),
  portable: z.boolean().default(false),
  /**
   * 可见性由作者声明，引擎不自作主张。判定口径只有一条：
   * 可见 =「没藏着」或者「revealedWhen 成立」；在背包里的东西一律可见。
   *
   * 藏着的东西不会出现在房间描述、建议行动、界面清单里，也不进主持人的上下文，
   * 玩家点名要它得到的回答与不存在的东西一模一样——这是防泄底的唯一开关。
   */
  hidden: z.boolean().default(false),
  revealedWhen: predicateSchema.optional(),
  /**
   * 关在哪把锁后面。这是常用写法的简写，等价于
   * hidden: true 加 revealedWhen: { unlocked: 那把锁 }。
   * 同时写了 revealedWhen 就以 revealedWhen 为准。
   */
  lockedBy: z.string().optional(),
  takeText: z.string().optional(),
  read: z
    .object({
      text: z.string(),
      afterText: z.string().optional(),
      grants: z.string().optional(),
      sanLoss: z.number().int().nonnegative().default(0),
      flag: z.string(),
      alreadyText: z.string(),
    })
    .optional(),
});

export const lockSchema = z.object({
  id: z.string().startsWith("lock."),
  title: z.string(),
  at: z.string(),
  skill: z.string(),
  difficulty: z.enum(["regular", "hard", "extreme"]),
  opens: z.string(),
  minutes: z.object({ ok: z.number().int(), fail: z.number().int() }),
  text: z.object({
    ok: z.string(),
    fail: z.string(),
    fumble: z.string(),
    alreadyOpen: z.string(),
  }),
});

export const factSchema = z.object({
  id: z.string().startsWith("fact."),
  title: z.string(),
  visibility: z.enum(["public", "secret"]),
});

export const npcSchema = z.object({
  id: z.string().startsWith("npc."),
  title: z.string(),
  startAt: z.string(),
  line: z.string(),
  keeperNote: z.string().optional(),
});

export const storyNodeSchema = z.object({
  id: z.string().startsWith("node."),
  title: z.string(),
  doneWhen: predicateSchema,
  failedWhen: predicateSchema.optional(),
});

/** 条件的效果只能是引擎认得的事件，条件里写不出「凭空改一个数」。 */
export const effectSchema = z.object({
  event: z.discriminatedUnion("type", [
    z.object({ type: z.literal("npc_moved"), npc: z.string(), to: z.string() }),
    z.object({ type: z.literal("flag_set"), flag: z.string(), value: z.boolean() }),
    z.object({ type: z.literal("fact_known"), fact: z.string() }),
    z.object({
      type: z.literal("resource_changed"),
      resource: z.enum(["hp", "san"]),
      delta: z.number().int(),
    }),
    z.object({
      type: z.literal("item_moved"),
      item: z.string(),
      from: z.string(),
      to: z.string(),
    }),
  ]),
  summary: z.string(),
  visibility: z.enum(["public", "secret"]).optional(),
  /** 条件触发时，守秘人可以补一句话；留空就只改状态、不出声 */
  narration: z.string().optional(),
});

export const conditionSchema = z.object({
  id: z.string().startsWith("cond."),
  title: z.string(),
  once: z.boolean().default(false),
  when: predicateSchema,
  effects: z.array(effectSchema).min(1),
});

const creationSchema: z.ZodType<InvestigatorCreationRules> = z.object({
  occupation: z.string(),
  characteristics: z.object({
    STR: z.number().int().positive(),
    CON: z.number().int().positive(),
    SIZ: z.number().int().positive(),
    DEX: z.number().int().positive(),
    APP: z.number().int().positive(),
    INT: z.number().int().positive(),
    POW: z.number().int().positive(),
    EDU: z.number().int().positive(),
  }),
  baseSkills: z.record(z.string(), z.number().int()),
  occupationSkills: z.array(z.string()).min(1),
  maxSkill: z.literal(90),
  hp: z.number().int().positive(),
  san: z.number().int().positive(),
  sanMax: z.number().int().positive(),
  contentVersion: z.string(),
  lifeHistories: z.array(
    z.object({
      id: z.string().startsWith("history."),
      title: z.string(),
      background: z.string(),
      roleplayPrompt: z.string(),
      initialGrant: z.object({ kind: z.enum(["fact", "item"]), id: z.string() }),
      relationship: z.object({ npcId: z.string(), text: z.string() }),
      investigationId: z.string().startsWith("investigation."),
    }),
  ).length(4),
});

export const investigationSchema = z.object({
  id: z.string().startsWith("investigation."),
  title: z.string(),
});

export const manifestSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.string(),
  kind: z.enum(["one-shot", "scenario", "campaign"]),
  rules: z.enum(["percentile"]),
  opening: z.string(),
  investigator: z.object({
    id: z.string().startsWith("pc."),
    name: z.string(),
    occupation: z.string(),
    hp: z.number().int().positive(),
    san: z.number().int().positive(),
    sanMax: z.number().int().positive(),
    startAt: z.string(),
    skills: z.record(z.string(), z.number().int().nonnegative()),
  }),
  creation: creationSchema.optional(),
});

export type RoomDef = z.infer<typeof roomSchema>;
export type ItemDef = z.infer<typeof itemSchema>;
export type LockDef = z.infer<typeof lockSchema>;
export type FactDef = z.infer<typeof factSchema>;
export type NpcDef = z.infer<typeof npcSchema>;
export type StoryNodeDef = z.infer<typeof storyNodeSchema>;
export type ConditionDef = z.infer<typeof conditionSchema>;
export type ManifestDef = z.infer<typeof manifestSchema>;
export type EffectDef = z.infer<typeof effectSchema>;
export type InvestigationDef = z.infer<typeof investigationSchema>;
