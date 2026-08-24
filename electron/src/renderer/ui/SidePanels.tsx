import { factTitle } from "@core/engine/narrate";
import { pack, packIndex } from "@core/engine/pack";
import { itemsInRoom } from "@core/engine/state";
import type { GameEvent, GameState } from "@core/engine/types";
import { Panel } from "./Panel";

export function Inventory({ state }: { state: GameState }) {
  const bag = itemsInRoom(state, "inv.pc");
  return (
    <Panel title="背包">
      {bag.length === 0 ? (
        <p className="text-sm text-muted">身上只有雨水和一支笔。</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {bag.map((id) => (
            <li key={id} className="rounded bg-ink-3/50 px-2 py-1 break-words">
              {packIndex.item(id)?.title ?? id}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function Clues({ state }: { state: GameState }) {
  return (
    <Panel title="已知线索" hint={`${state.known.length} 条`}>
      {state.known.length === 0 ? (
        <p className="text-sm text-muted">还没有确认过任何事。</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {state.known.map((id) => (
            <li key={id} className="border-l-2 border-brass/60 pl-2">
              {factTitle(id)}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function StoryFlags({ state }: { state: GameState }) {
  return (
    <Panel title="剧情标记" hint="由条件判定，主持人改不了">
      <ul className="flex flex-col gap-1 text-sm">
        {pack.story.map((node) => {
          const done = Boolean(state.flags[`${node.id}.done`]);
          return (
            <li key={node.id} className="flex items-center justify-between">
              <span className={done ? "" : "text-muted"}>{node.title}</span>
              <span className={`text-[11px] ${done ? "text-moss" : "text-muted"}`}>
                {done ? "已完成" : "进行中"}
              </span>
            </li>
          );
        })}
        {pack.conditions.map((condition) => {
          const fired = Boolean(state.flags[`${condition.id}.fired`]);
          return (
            <li
              key={condition.id}
              className="flex items-center justify-between border-t border-line/50 pt-1"
            >
              <span className={fired ? "" : "text-muted"}>{condition.title}</span>
              <span className={`text-[11px] ${fired ? "text-blood" : "text-muted"}`}>
                {fired ? "已触发" : "未触发"}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function EventLog({ log }: { log: GameEvent[] }) {
  const visible = log.filter((event) => event.visibility === "public");
  return (
    <Panel title="事件记录" hint={`${log.length} 条，只追加`}>
      {visible.length === 0 ? (
        <p className="text-sm text-muted">这一场还没有发生任何被记下来的事。</p>
      ) : (
        <ol className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1 text-[13px]">
          {visible
            .slice()
            .reverse()
            .map((event) => (
              <li key={event.id} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-muted">#{event.seq}</span>
                <span className="min-w-0 break-words">
                  {event.summary}
                  <span className="ml-1 text-[11px] text-muted">v{event.versionAfter}</span>
                </span>
              </li>
            ))}
        </ol>
      )}
    </Panel>
  );
}
