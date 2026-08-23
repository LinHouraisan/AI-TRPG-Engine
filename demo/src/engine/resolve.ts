import { suggest } from "./narrate";
import { pack, packIndex } from "./pack";
import { rollFor } from "./rng";
import { resolveCheck } from "./rules";
import { npcsInRoom, visibleItemsInRoom } from "./state";
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
  const here = visibleItemsInRoom(state, state.pcAt);

  switch (intent.kind) {
    case "move": {
      const room = packIndex.room(state.pcAt);
      const exit = room?.exits.find((e) => e.to === intent.to);
      const target = packIndex.room(intent.to);
      if (!exit || !target) {
        return {
          drafts: [reject(`从${room?.title ?? "这里"}没有直接通向那边的路。`, "router:no_exit")],
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
      if (intent.target.startsWith("loc.")) return { drafts: [] };

      const item = packIndex.item(intent.target);
      if (!item || !(here.includes(item.id) || state.itemAt[item.id] === "inv.pc")) {
        return { drafts: [reject("这里没有那样东西。", "router:not_here")] };
      }

      const drafts: EventDraft[] = [
        {
          payload: { type: "observed", item: item.id },
          summary: `观察「${item.title}」，说明已对玩家公开。`,
          cause: "player:observe",
          narration: item.observed,
        },
      ];
      if (item.observeGrants && !state.known.includes(item.observeGrants)) {
        drafts.push({
          payload: { type: "fact_known", fact: item.observeGrants },
          summary: `得到线索：${packIndex.fact(item.observeGrants)?.title ?? item.observeGrants}。`,
          cause: "player:observe",
        });
      }
      return { drafts };
    }

    case "unlock": {
      const lock = packIndex.lock(intent.lock);
      if (!lock || lock.at !== state.pcAt) {
        return { drafts: [reject("这里没有那把锁。", "router:not_here")] };
      }
      if (state.unlocked[lock.id]) {
        return { drafts: [reject(lock.text.alreadyOpen, "rules:already_open")] };
      }
      const skillValue = state.skills[lock.skill];
      if (skillValue == null) {
        return { drafts: [reject(`调查员卡上没有「${lock.skill}」这项技能。`, "rules:no_skill")] };
      }

      const roll = rollFor(pack.ref, `${turnId}:${lock.id}`, 100);
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
            minutes: check.ok ? lock.minutes.ok : lock.minutes.fail,
          },
          summary: `${lock.skill}检定（资料包 ${pack.ref}）：1d100 掷出 ${check.roll}，阈值 ${check.threshold} → ${check.level}。`,
          cause: "player:unlock",
          narration: check.ok
            ? lock.text.ok
            : check.level === "大失败"
              ? lock.text.fumble
              : lock.text.fail,
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
      const item = packIndex.item(intent.item);
      if (!item || !here.includes(item.id)) {
        return { drafts: [reject("这里没有那样东西。", "router:not_here")] };
      }
      if (!item.portable) {
        return { drafts: [reject(`${item.title}拿不走。`, "rules:not_portable")] };
      }
      if (item.lockedBy && !state.unlocked[item.lockedBy]) {
        const lock = packIndex.lock(item.lockedBy);
        return {
          drafts: [
            reject(`${lock?.title ?? "锁"}还锁着，拿不到${item.title}。`, "rules:locked"),
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
            summary: `道具转移：${item.title} 从${placeTitle(state.itemAt[item.id])}进入背包。`,
            cause: "player:take",
            narration: item.takeText ?? `你把${item.title}收了起来。`,
          },
        ],
      };
    }

    case "read": {
      const item = packIndex.item(intent.item);
      if (!item) return { drafts: [reject("没有这样东西。", "router:not_here")] };
      if (state.itemAt[item.id] !== "inv.pc") {
        return { drafts: [reject(`${item.title}还不在你手上。`, "rules:not_held")] };
      }
      const read = item.read;
      if (!read) {
        return { drafts: [reject(`${item.title}上没有可读的东西。`, "rules:nothing_to_read")] };
      }
      if (state.flags[read.flag]) {
        return { drafts: [reject(read.alreadyText, "rules:already_read")] };
      }

      const drafts: EventDraft[] = [];
      if (read.grants) {
        drafts.push({
          payload: { type: "fact_known", fact: read.grants },
          summary: `得到线索：${packIndex.fact(read.grants)?.title ?? read.grants}。`,
          cause: "player:read",
          visibility: packIndex.fact(read.grants)?.visibility ?? "public",
          narration: read.text,
        });
      }
      if (read.sanLoss > 0) {
        drafts.push({
          payload: { type: "resource_changed", resource: "san", delta: -read.sanLoss },
          summary: `理智 −${read.sanLoss}。`,
          cause: "player:read",
          narration: read.afterText,
        });
      }
      drafts.push({
        payload: { type: "flag_set", flag: read.flag, value: true },
        summary: `剧情标记「${read.flag}」打开。`,
        cause: "player:read",
      });
      return { drafts };
    }

    case "talk": {
      // 纯扮演：不检定，也不改动任何权威状态。
      const present = npcsInRoom(state, state.pcAt);
      if (present.length === 0) {
        return {
          drafts: [],
          clarification: "这间屋子里没有别人。你是想自言自语，还是朝别处喊？",
        };
      }
      return { drafts: [] };
    }

    case "free_action":
      // Demo 的最小自由行动：由 GM 承接互动，但不擅自改变权威状态。
      return { drafts: [] };

    case "query":
      return { drafts: [] };

    case "unclear": {
      const labels = suggest(state).map((item) => item.label);
      const clarification =
        labels.length > 0
          ? `这一步我没听明白。你可以${labels.join("、")}，或者把想做的事再说具体一点。`
          : "这一步我没听明白：你想去哪儿、对什么东西动手，还是先看看四周？";
      return { drafts: [], clarification };
    }
  }
}

function reject(reason: string, cause: string): EventDraft {
  return {
    payload: { type: "action_rejected", reason },
    summary: `行动被拒绝：${reason}`,
    cause,
    narration: reason,
  };
}

function placeTitle(id: string | undefined): string {
  if (id === "inv.pc") return "背包";
  return packIndex.room(id ?? "")?.title ?? "原处";
}
