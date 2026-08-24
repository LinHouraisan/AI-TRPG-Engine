import { z } from "zod";

const sourceSchema = z.object({ kind: z.string(), id: z.string().min(1) });

export const contextPlanSchema = z.object({
  load: z.array(z.string()).default([]),
  keep: z.array(z.string()).default([]),
  demote: z.array(z.string()).default([]),
  drop: z.array(z.string()).default([]),
  preload: z.array(z.string()).default([]),
});

export const factProposalSchema = z.object({
  entityIds: z.array(z.string()).default([]),
  summary: z.string().min(1),
  kind: z.enum(["fact", "cognition", "intent", "inference", "prediction", "unconfirmed"]),
  sources: z.array(sourceSchema).min(1),
  confirmed: z.literal(false),
});

export const informationProposeSchema = z.object({
  proposals: z.array(factProposalSchema).default([]),
});

export const directorAnalyzeSchema = z.object({
  opportunities: z
    .array(
      z.object({
        opportunityId: z.string().min(1),
        affectedNodeIds: z.array(z.string()).default([]),
        kind: z.string().min(1),
        gmGuidance: z.object({
          opportunity: z.string().min(1),
          doNotReveal: z.array(z.string()).default([]),
        }),
      }),
    )
    .default([]),
  playerGoalMemoryIds: z.array(z.string()).default([]),
  preload: z.array(z.string()).default([]),
});

export const memoryExtractSchema = z.object({
  entries: z
    .array(
      z.object({
        memoryType: z.enum(["causal", "commitment", "relation", "goal", "unresolved"]),
        summary: z.string().min(1),
        sources: z.array(z.string().min(1)).min(1),
        entityIds: z.array(z.string()).default([]),
        importance: z.number().int().min(1).max(5).default(1),
      }),
    )
    .default([]),
});

export const memoryConsolidateSchema = z.object({
  summary: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
});

export const contextPlanJsonSchema = z.toJSONSchema(contextPlanSchema);
export const informationProposeJsonSchema = z.toJSONSchema(informationProposeSchema);
export const directorAnalyzeJsonSchema = z.toJSONSchema(directorAnalyzeSchema);
export const memoryExtractJsonSchema = z.toJSONSchema(memoryExtractSchema);
export const memoryConsolidateJsonSchema = z.toJSONSchema(memoryConsolidateSchema);
