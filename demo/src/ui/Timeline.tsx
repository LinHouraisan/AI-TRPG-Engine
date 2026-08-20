import type { GameEvent } from "@/engine/types";
import type { TurnMark } from "@/session";
import type { BranchInfo } from "@/store";
import { Panel } from "./Panel";

export type { TurnMark };

/** 按回合把事件收拢起来：时间线上的一格是一个回合，不是一条事件。 */
export function marksFrom(log: GameEvent[], branches: BranchInfo[] = []): TurnMark[] {
  const forkAt = new Set(
    branches.map((branch) => branch.forkSeq).filter((seq): seq is number => seq != null),
  );
  const marks: TurnMark[] = [];
  for (const event of log) {
    const last = marks[marks.length - 1];
    const rolled = event.payload.type === "check_resolved";
    if (last && last.turnId === event.turnId) {
      last.seq = event.seq;
      last.version = event.versionAfter;
      last.clock = event.clock;
      last.rolled = last.rolled || rolled;
      last.forked = forkAt.has(event.seq);
      continue;
    }
    marks.push({
      turnId: event.turnId,
      seq: event.seq,
      version: event.versionAfter,
      clock: event.clock,
      summary: event.summary,
      rolled,
      forked: forkAt.has(event.seq),
    });
  }
  for (const mark of marks) {
    if (forkAt.has(mark.seq)) mark.forked = true;
  }
  return marks;
}

/**
 * 时间线与分支。
 *
 * 回到某一版不会抹掉后面的事——它从那一刻分出一条新分支，
 * 旧的那条还在列表里，随时能切回去看。
 */
export function Timeline({
  log,
  branches,
  currentBranch,
  busy,
  onRewind,
  onSwitch,
}: {
  log: GameEvent[];
  branches: BranchInfo[];
  currentBranch: string | null;
  busy: boolean;
  onRewind: (mark: TurnMark) => void;
  onSwitch: (branchId: string) => void;
}) {
  const marks = marksFrom(log, branches);
  const currentTitle = branches.find((branch) => branch.id === currentBranch)?.title;
  const latestId = marks[marks.length - 1]?.turnId;

  return (
    <Panel
      title="时间线"
      hint={currentTitle ? `当前在「${currentTitle}」` : "回到某一版会分出新分支"}
    >
      {marks.length === 0 ? (
        <p className="text-sm text-muted">还没有提交过任何回合。</p>
      ) : (
        <ol className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1 text-[13px]">
          {marks
            .slice()
            .reverse()
            .map((mark) => (
              <li
                key={mark.turnId}
                className={`rounded-md px-1.5 py-1 ${
                  mark.turnId === latestId ? "bg-brass/10" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="shrink-0 tabular-nums text-muted">v{mark.version}</span>
                  <span className="min-w-0 flex-1 break-words" title={mark.summary}>
                    {mark.summary}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRewind(mark)}
                    className="min-h-11 shrink-0 px-1 text-[11px] text-muted transition hover:text-brass disabled:opacity-40"
                  >
                    回到这一版
                  </button>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 pl-8 text-[10px] text-muted">
                  <span>团内时间 +{mark.clock} 分</span>
                  {mark.rolled ? (
                    <span className="rounded border border-line/70 px-1 py-px">掷了骰</span>
                  ) : null}
                  {mark.forked ? (
                    <span className="rounded border border-brass/40 px-1 py-px text-brass">
                      在此分叉
                    </span>
                  ) : null}
                  {mark.turnId === latestId ? (
                    <span className="text-brass">当前回合</span>
                  ) : null}
                </div>
              </li>
            ))}
        </ol>
      )}

      {branches.length > 1 ? (
        <div className="mt-2 border-t border-line/50 pt-2">
          <p className="mb-1 text-[11px] text-muted">分支</p>
          <ul className="flex flex-col gap-1 text-[13px]">
            {branches.map((branch) => {
              const current = branch.id === currentBranch;
              return (
                <li
                  key={branch.id}
                  className={`flex items-center justify-between gap-2 rounded-md px-1.5 ${
                    current ? "bg-brass/10" : ""
                  }`}
                >
                  <span className={current ? "" : "text-muted"}>
                    {branch.title}
                    <span className="ml-1 text-[11px] text-muted">
                      v{branch.version}·{branch.events} 条
                    </span>
                  </span>
                  {current ? (
                    <span className="min-h-11 px-1 text-[11px] leading-[44px] text-brass">
                      当前
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onSwitch(branch.id)}
                      className="min-h-11 px-1 text-[11px] text-muted transition hover:text-brass disabled:opacity-40"
                    >
                      切过去
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}
