/**
 * 规则工具：掷骰与检定。
 *
 * 关键点——点数由内核的种子 RNG 产生（`engine/rng.ts`），模型只能请求掷骰，
 * 不能自己编一个数出来。同一个 seed + turnId 重放结果不变，
 * 这与"重掷一次骰子必须是显式的新回合"是同一条规则。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { rollFor } from "@core/engine/rng";

export type DiceSeed = { seed: string; turnId: string };

const NOTATION = /^(\d+)d(\d+)\s*([+-]\s*\d+)?$/i;

export function rollNotation(notation: string, seed: DiceSeed): string {
  const matched = NOTATION.exec(notation.trim());
  if (!matched) return `无法解析骰子表达式「${notation}」，请使用形如 2d6+3 的写法`;

  const times = Number(matched[1]);
  const sides = Number(matched[2]);
  const modifier = matched[3] ? Number(matched[3].replace(/\s+/g, "")) : 0;
  if (times < 1 || times > 20 || sides < 2 || sides > 1000) {
    return `骰子表达式超出允许范围：${notation}`;
  }

  const rolls: number[] = [];
  for (let i = 0; i < times; i += 1) {
    rolls.push(rollFor(seed.seed, `${seed.turnId}:${notation}:${i}`, sides));
  }
  const total = rolls.reduce((sum, value) => sum + value, 0) + modifier;
  const detail = `${rolls.join("+")}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ""}`;
  return `${notation} = ${total}（${detail}）`;
}

export function skillCheck(params: {
  seed: DiceSeed;
  attribute: number;
  difficulty: number;
  sides?: number;
}): string {
  const sides = params.sides ?? 20;
  const key = `${params.seed.turnId}:check:${params.attribute}:${params.difficulty}`;
  const roll = rollFor(params.seed.seed, key, sides);
  const total = roll + params.attribute;
  return `d${sides}=${roll} + 属性 ${params.attribute} = ${total} vs DC${params.difficulty} → ${total >= params.difficulty ? "成功" : "失败"}`;
}

export function createRuleTools(seed: DiceSeed) {
  const dice = tool(
    async ({ notation }) => rollNotation(notation, seed),
    {
      name: "roll_dice",
      description: "按标准骰子表达式掷骰，如 2d6+3。禁止自行计算点数，必须调用本工具。",
      schema: z.object({ notation: z.string().describe("骰子表达式，例如 2d6+3") }),
    },
  );

  const check = tool(
    async ({ attribute, difficulty, sides }) =>
      skillCheck({ seed, attribute, difficulty, sides: sides ?? 20 }),
    {
      name: "skill_check",
      description: "属性检定：掷骰结果 + 属性值 >= 难度 DC 则成功。",
      schema: z.object({
        attribute: z.number().int().describe("角色属性值"),
        difficulty: z.number().int().describe("难度 DC"),
        sides: z.number().int().optional().describe("骰面数，默认 20"),
      }),
    },
  );

  return [dice, check];
}
