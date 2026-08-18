import { npcs, rooms } from "@/data/boarding-house";
import { itemsInRoom, npcsInRoom } from "@/engine/state";
import type { GameState } from "@/engine/types";
import { Panel } from "./Panel";

/** 房间是权威状态的一部分：同一个版本里，人和东西都只能在一个地方。 */
export function RoomMap({ state }: { state: GameState }) {
  return (
    <Panel title="当前场景" hint={`团内时间 +${state.clock} 分钟`}>
      <div className="flex flex-col gap-1.5">
        {rooms.map((room) => {
          const here = state.pcAt === room.id;
          const people = npcsInRoom(state, room.id).map((id) => npcs[id]?.title ?? id);
          const things = itemsInRoom(state, room.id).length;
          const seen = state.visited[room.id];
          return (
            <div
              key={room.id}
              className={`rounded-md border px-2.5 py-1.5 text-sm ${
                here
                  ? "border-brass/70 bg-brass/10"
                  : seen
                    ? "border-line/60 bg-ink-3/40"
                    : "border-line/30 bg-ink-3/20 text-muted"
              }`}
            >
              <div className="flex items-center justify-between">
                <span>
                  {seen ? room.title : "未去过的房间"}
                  {here ? <span className="ml-2 text-xs text-brass">调查员在此</span> : null}
                </span>
                <span className="text-[11px] text-muted">
                  {seen ? `道具 ${things}` : "—"}
                </span>
              </div>
              {seen && people.length > 0 ? (
                <div className="mt-0.5 text-[11px] text-muted">在场：{people.join("、")}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
