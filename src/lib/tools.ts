// 旧壳。写库工具已禁用。权威提交只在 electron/ 主进程。
import { tool } from "ai";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { listCharacters, searchSrd } from "@/lib/db";
import { getItem, keeperItemView, listItems } from "@/data/items";
import { executeCheck } from "@/lib/check";
import { rollDice } from "@/lib/dice";

const SHELL_WRITE_DISABLED =
  "旧 Tauri 外壳已停用：主持人不能写库。请用 Electron 主进程的 turn:submitAction。";

export type GameScope = {
  campaignId: string;
  sessionId: string;
  queryClient: QueryClient;
};

async function findCharacter(campaignId: string, nameOrId: string) {
  const characters = await listCharacters(campaignId);
  const needle = nameOrId.trim().toLowerCase();
  return (
    characters.find((character) => character.id === nameOrId) ??
    characters.find((character) => character.name.toLowerCase() === needle) ??
    characters.find((character) => character.name.toLowerCase().includes(needle))
  );
}

export function createGameTools(scope: GameScope) {
  return {
    check: tool({
      description:
        "对某个人或房间里的某件物品做一次技能检定。程序会自己查技能值、掷骰并判定成败。绝不要编造骰值或结果，也不要把骰值和结果传进来。开锁、搜查、说服等各类检定都用这个工具，不要用 roll_dice。",
      inputSchema: z.object({
        who: z.string().describe("角色名称或 id"),
        skill: z.string().describe("技能名称，例如 开锁 或 sleight of hand"),
        target: z
          .string()
          .optional()
          .describe("物品或障碍的 id 或名称，例如 书桌锁 或 item.desk_lock"),
      }),
      execute: async ({ who, skill, target }) => {
        const character = await findCharacter(scope.campaignId, who);
        if (!character) return { error: `没有找到名为 ${who} 的角色` };
        return executeCheck({ who, skill, target }, character);
      },
    }),
    roll_dice: tool({
      description:
        "掷伤害等与技能无关的骰子。骰式写成 NdM+K 的形式，例如 2d6+1。技能检定不要用这个工具，请改用 check。",
      inputSchema: z.object({
        notation: z.string().describe("骰式，例如 1d20+4"),
        mode: z
          .enum(["normal", "advantage", "disadvantage"])
          .optional()
          .describe("优势／劣势只对单颗 d20 生效"),
      }),
      execute: async ({ notation, mode }) => rollDice(notation, mode ?? "normal"),
    }),
    update_character: tool({
      description:
        "修改队伍中某个角色的生命值、护甲等级、状态、背包或笔记。用名称或 id 指定这个角色。",
      inputSchema: z.object({
        name: z.string().describe("角色名称或 id"),
        hp: z.number().int().optional(),
        maxHp: z.number().int().optional(),
        ac: z.number().int().optional(),
        conditions: z.array(z.string()).optional(),
        notes: z.string().optional(),
        addItem: z
          .object({ name: z.string(), qty: z.number().int().default(1) })
          .optional(),
        removeItem: z.string().optional(),
      }),
      execute: async () => ({ error: SHELL_WRITE_DISABLED }),
    }),
    start_combat: tool({
      description: "开始一场遭遇战，并把队伍成员加进先攻表。",
      inputSchema: z.object({
        name: z.string().optional().describe("遭遇战名称"),
      }),
      execute: async () => ({ error: SHELL_WRITE_DISABLED }),
    }),
    add_combatant: tool({
      description: "把一个怪物或 NPC 加入当前进行中的遭遇战。",
      inputSchema: z.object({
        name: z.string(),
        hp: z.number().int().optional(),
        ac: z.number().int().optional(),
        initiative: z.number().int().optional(),
      }),
      execute: async () => ({ error: SHELL_WRITE_DISABLED }),
    }),
    set_initiative: tool({
      description: "为当前遭遇战中的某个参战者设置先攻值。",
      inputSchema: z.object({
        name: z.string(),
        initiative: z.number().int(),
      }),
      execute: async () => ({ error: SHELL_WRITE_DISABLED }),
    }),
    update_combatant: tool({
      description: "修改某个参战者的生命值或状态。",
      inputSchema: z.object({
        name: z.string(),
        hp: z.number().int().optional(),
        conditions: z.array(z.string()).optional(),
      }),
      execute: async () => ({ error: SHELL_WRITE_DISABLED }),
    }),
    end_combat: tool({
      description: "结束当前进行中的遭遇战。",
      inputSchema: z.object({}),
      execute: async () => ({ error: SHELL_WRITE_DISABLED }),
    }),
    lookup_item: tool({
      description:
        "按 id 或名称从全局物品表里查一件物品，返回它的描述、内含物、可用动作，以及相关的地点和事件。在叙述房间里的物品，或对它调用 check、取走、阅读之前，先查一次。",
      inputSchema: z.object({
        name: z
          .string()
          .optional()
          .describe("物品的 id 或名称，例如 黑色账本 或 item.ledger。留空则列出全部物品。"),
      }),
      execute: async ({ name }) => {
        if (!name) {
          return listItems().map((item) => ({
            id: item.id,
            name: item.name,
            at: item.at,
            contains: item.contains,
          }));
        }
        const item = getItem(name);
        if (!item) return { error: `没有找到名为 ${name} 的物品` };
        return keeperItemView(item);
      },
    }),
    lookup_srd: tool({
      description: "在随程序打包的 5e SRD 里搜索怪物、法术或基础规则。",
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async ({ query }) => {
        const hits = await searchSrd(query);
        return hits.map((hit) => ({
          title: hit.title,
          kind: hit.kind,
          body: hit.body.slice(0, 1200),
        }));
      },
    }),
    write_note: tool({
      description: "把一条需要长期保留的战役或本场笔记存下来。",
      inputSchema: z.object({
        title: z.string(),
        body: z.string(),
      }),
      execute: async () => ({ error: SHELL_WRITE_DISABLED }),
    }),
  };
}
