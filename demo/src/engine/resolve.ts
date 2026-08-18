import { facts, items, locks, packVersion, rooms } from "@/data/boarding-house";
import { rollFor } from "./rng";
import { resolveCheck } from "./rules";
import { itemsInRoom, npcsInRoom } from "./state";
import type { CheckResult, EventDraft, GameState, Intent } from "./types";

/**
 * 程序裁定：把意图变成一批候选变化。
 * 这一步只产出候选，真正写进事实的是 runtime.commit。
 */
export function resolveIntent(params: {
  intent: Intent;
  state: GameState;
  turnId: string;
}): { drafts: EventDraft[]; check?: CheckResult; clarification?: string } {
  const { intent, state, turnId } = params;
  const here = itemsInRoom(state, state.pcAt);

  switch (intent.kind) {
    case "move": {
      const room = rooms.find((r) => r.id === state.pcAt);
      const exit = room?.exits.find((e) => e.to === intent.to);
      const target = rooms.find((r) => r.id === intent.to);
      if (!exit || !target) {
        return {
          drafts: [
            reject(`从${room?.title ?? "这里"}没有直接通向那边的路。`, "router:no_exit"),
          ],
        };
      }
      return {
        drafts: [
          {
            payload: { type: "moved", to: intent.to, via: exit.via, minutes: 1 },
            summary: `移动：${room?.title} → ${target.title}（经${exit.via}），团内时间 +1 分钟。`,
            cause: "player:move",
          },
        ],
      };
    }

    case "observe": {
      if (intent.target.startsWith("loc.")) {
        return { drafts: [] };
      }
      const item = items[intent.target];
      if (!item || !(here.includes(item.id) || state.itemAt[item.id] === "inv.pc")) {
        return { drafts: [reject("这里没有那样东西。", "router:not_here")] };
      }
      const drafts: EventDraft[] = [
        {
          payload: { type: "observed", item: item.id },
          summary: `观察「${item.title}」，说明已对玩家公开。`,
          cause: "player:observe",
        },
      ];
      if (item.id === "item.desk_lock" && !state.known.includes("fact.lock_scratched")) {
        drafts.push({
          payload: { type: "fact_known", fact: "fact.lock_scratched" },
          summary: `得到线索：${facts["fact.lock_scratched"].title}。`,
          cause: "player:observe",
        });
      }
      return { drafts };
    }

    case "unlock": {
      const lock = locks[intent.lock];
      if (!lock) return { drafts: [reject("这里没有那把锁。", "router:not_here")] };
      if (state.unlocked[lock.id]) {
        return { drafts: [reject(`${lock.title}已经开着了。`, "rules:already_open")] };
      }
      const skillValue = state.skills[lock.skill];
      if (skillValue == null) {
        return { drafts: [reject(`调查员卡上没有「${lock.skill}」这项技能。`, "rules:no_skill")] };
      }

      const roll = rollFor(packVersion, `${turnId}:${lock.id}`, 100);
      const check = resolveCheck({
        skill: lock.skill,
        skillValue,
        difficulty: lock.difficulty,
        roll,
      });

      const drafts: EventDraft[] = [
        {
          payload: {
            type: "check_resolved",
            target: lock.id,
            check,
            minutes: check.ok ? 2 : 3,
          },
          summary: `${lock.skill}检定：1d100 掷出 ${check.roll}，阈值 ${check.threshold} → ${check.level}。`,
          cause: "player:unlock",
        },
      ];

      if (check.ok) {
        drafts.push(
          {
            payload: { type: "lock_opened", lock: lock.id },
            summary: `${lock.title}打开了。`,
            cause: "player:unlock",
          },
          {
            payload: { type: "flag_set", flag: `${lock.id}.open`, value: true },
            summary: `剧情标记「${lock.id}.open」打开。`,
            cause: "player:unlock",
          },
        );
      } else {
        drafts.push({
          payload: { type: "flag_set", flag: `${lock.id}.failed`, value: true },
          summary: `剧情标记「${lock.id}.failed」打开：撬锁弄出了声响。`,
          cause: "player:unlock",
        });
      }

      return { drafts, check };
    }

    case "take": {
      const item = items[intent.item];
      if (!item || !here.includes(item.id)) {
        return { drafts: [reject("这里没有那样东西。", "router:not_here")] };
      }
      if (!item.portable) {
        return { drafts: [reject(`${item.title}拿不走。`, "rules:not_portable")] };
      }
      if (item.lockedBy && !state.unlocked[item.lockedBy]) {
        return {
          drafts: [
            reject(
              `${locks[item.lockedBy]?.title ?? "锁"}还锁着，拿不到${item.title}。`,
              "rules:locked",
            ),
          ],
        };
      }
      return {
        drafts: [
          {
            payload: {
              type: "item_moved",
              item: item.id,
              from: state.itemAt[item.id],
              to: "inv.pc",
            },
            summary: `道具转移：${item.title} 从${roomTitle(state.itemAt[item.id])}进入背包。`,
            cause: "player:take",
          },
        ],
      };
    }

    case "read": {
      const item = items[intent.item];
      if (!item) return { drafts: [reject("没有这样东西。", "router:not_here")] };
      if (state.itemAt[item.id] !== "inv.pc") {
        return { drafts: [reject(`${item.title}还不在你手上。`, "rules:not_held")] };
      }
      if (item.id !== "item.ledger") {
        return { drafts: [reject(`${item.title}上没有可读的东西。`, "rules:nothing_to_read")] };
      }
      if (state.flags["ledger.read"]) {
        return { drafts: [reject("夹页你已经读过了。", "rules:already_read")] };
      }
      return {
        drafts: [
          {
            payload: { type: "fact_known", fact: "fact.dock_time" },
            summary: `得到线索：${facts["fact.dock_time"].title}。`,
            cause: "player:read",
            visibility: "secret",
          },
          {
            payload: { type: "resource_changed", resource: "san", delta: -5 },
            summary: "理智 −5。",
            cause: "player:read",
          },
          {
            payload: { type: "flag_set", flag: "ledger.read", value: true },
            summary: "剧情标记「ledger.read」打开。",
            cause: "player:read",
          },
        ],
      };
    }

    case "talk": {
      // 纯扮演：不检定，也不改动任何权威状态。
      const present = npcsInRoom(state, state.pcAt);
      if (present.length === 0) {
        return { drafts: [], clarification: "这间屋子里没有别人。你是想自言自语，还是朝别处喊？" };
      }
      return { drafts: [] };
    }

    case "unclear":
      return {
        drafts: [],
        clarification: "这一步我没听明白：你想去哪儿、对什么东西动手，还是先看看四周？",
      };
  }
}

function reject(reason: string, cause: string): EventDraft {
  return {
    payload: { type: "action_rejected", reason },
    summary: `行动被拒绝：${reason}`,
    cause,
  };
}

function roomTitle(id: string | undefined): string {
  if (id === "inv.pc") return "背包";
  return rooms.find((r) => r.id === id)?.title ?? "原处";
}
