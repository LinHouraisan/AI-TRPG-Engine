import { keeperCatalog } from "@/data/items";
import {
  getActiveEncounter,
  getCampaign,
  listCharacters,
  listNotes,
} from "@/lib/db";

export async function buildSystemPrompt(
  campaignId: string,
  sessionId: string,
): Promise<string> {
  const [campaign, characters, combat, notes] = await Promise.all([
    getCampaign(campaignId),
    listCharacters(campaignId),
    getActiveEncounter(campaignId),
    listNotes(campaignId),
  ]);

  const party = characters.map((character) => ({
    id: character.id,
    name: character.name,
    ancestry: character.ancestry,
    class: character.className,
    level: character.level,
    hp: `${character.hp}/${character.maxHp}`,
    ac: character.ac,
    stats: character.stats,
    conditions: character.conditions,
    inventory: character.inventory,
    notes: character.notes,
  }));

  const recap = notes
    .slice(0, 6)
    .map((note) => `- ${note.title}: ${note.body}`)
    .join("\n");

  return [
    "你是一款本地单人跑团／主持人辅助程序里的带团主持人。",
    "只使用 5e SRD 的规则，绝不要声称这是官方的《龙与地下城》。",
    "以简洁而有画面感的主持人口吻叙述，主动把选择权交给玩家，让节奏一直往前走。",
    "当某项技能需要检定时（开锁、搜查、说服、潜行等），调用 check，只传 who、skill，以及可选的 target。",
    "绝不要自己编造骰值、难度或成败，也不要把这些传给任何工具。必须等 check 返回结果之后再叙述。",
    "roll_dice 只用来掷伤害之类与技能无关的骰子。",
    "生命值、背包、状态或先攻发生变化时，调用对应的工具把改动记下来。",
    "所有物品都记在物品表里。描述房间里的物品，或对它进行操作之前，先调用 lookup_item。",
    "在 check、阅读或观察类的工具把某条隐藏信息揭示出来之前，绝不要把守秘人笔记或秘密念给玩家听。",
    "引用怪物、法术和规则的具体数值之前，先用 lookup_srd 查证。",
    "有信息需要长期记住时，用 write_note 写一条简短的本场记录。",
    "",
    `战役：${campaign?.name ?? "未知"}`,
    campaign?.premise ? `开场设定：${campaign.premise}` : "",
    `本场 id：${sessionId}`,
    "",
    "队伍数据（JSON）：",
    JSON.stringify(party, null, 2),
    "",
    "物品表（守秘人视角，含笔记、秘密以及相关的地点与事件）。玩家只有在观察过之后，才能听到名称和描述：",
    JSON.stringify(keeperCatalog(), null, 2),
    "",
    combat
      ? `进行中的战斗：${JSON.stringify(
          {
            encounter: combat.encounter.name,
            combatants: combat.combatants.map((c) => ({
              id: c.id,
              name: c.name,
              hp: `${c.hp}/${c.maxHp}`,
              ac: c.ac,
              initiative: c.initiative,
              conditions: c.conditions,
            })),
          },
          null,
          2,
        )}`
      : "当前没有进行中的战斗。",
    "",
    recap ? `最近的笔记：\n${recap}` : "目前还没有存下任何笔记。",
  ]
    .filter(Boolean)
    .join("\n");
}
