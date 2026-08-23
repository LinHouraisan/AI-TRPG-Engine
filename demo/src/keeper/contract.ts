import { z } from "zod";

/**
 * 主持人契约。
 *
 * 模型能做的只有两件事：把玩家的话认成一个意图，以及把已经提交的事实讲成人话。
 * 它不产出事件，不产出点数，也不决定成败——那些只能由程序裁定。
 * 结构不合法的回复一律丢弃，且不产生任何副作用。
 */

export const VERBS = ["move", "observe", "unlock", "take", "read", "talk", "query", "free", "unclear"] as const;

/**
 * 路由回复故意做成一层平铺结构：动词加目标编号。
 * 嵌套的联合类型对小模型太难，摊平之后它几乎不会写错，
 * 而「这个编号在不在场」照样由程序自己查。
 */
const standardRouteReplySchema = z.object({
  verb: z.enum(VERBS),
  /** 资料包里的编号，例如 loc.study、item.ledger、lock.desk；说不准就留空 */
  target: z.string().default(""),
  /** 认成 unclear 时用来追问玩家的一句话 */
  text: z.string().default(""),
});

const investigationRouteReplySchema = z.object({
  kind: z.literal("investigation"),
  investigationId: z.string().startsWith("investigation."),
  skill: z.string().min(1),
  approach: z.string().min(1),
});

export const routeReplySchema = z.union([standardRouteReplySchema, investigationRouteReplySchema]);

export const narrationReplySchema = z.object({
  text: z.string().min(1),
});

export type RouteReply = z.infer<typeof routeReplySchema>;
export type NarrationReply = z.infer<typeof narrationReplySchema>;

/** Ollama 的结构化输出要的是 JSON Schema，直接从 Zod 生成，两边不会走样。 */
export const routeJsonSchema = z.toJSONSchema(routeReplySchema);
export const narrationJsonSchema = z.toJSONSchema(narrationReplySchema);
