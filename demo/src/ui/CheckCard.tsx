import { difficultyLabel } from "@/engine/rules";
import type { CheckResult } from "@/engine/types";

/**
 * 公开检定尺：技能、掷出的点数、阈值、成功等级，一律摊开给玩家看。
 * 这些数字只能来自程序，主持人没有改动它们的权限。
 */
export function CheckCard({ check }: { check: CheckResult }) {
  const good = check.ok;
  return (
    <div
      className={`mt-2 overflow-hidden rounded-md border ${
        good ? "border-moss/50" : "border-blood/50"
      } bg-ink-3/60`}
    >
      <div className="flex items-center justify-between px-3 py-1.5 text-xs">
        <span className="tracking-wider text-muted">
          {check.skill} · {difficultyLabel(check.difficulty)}难度
        </span>
        <span className={good ? "text-moss" : "text-blood"}>{check.level}</span>
      </div>
      <div className="flex items-end gap-4 px-3 pb-2">
        <div>
          <div className="text-2xl leading-none tabular-nums">{check.roll}</div>
          <div className="text-[11px] text-muted">1d100 掷出</div>
        </div>
        <div>
          <div className="text-2xl leading-none tabular-nums text-muted">{check.threshold}</div>
          <div className="text-[11px] text-muted">成功阈值</div>
        </div>
        <div className="ml-auto text-right text-[11px] text-muted">
          技能值 {check.skillValue}
        </div>
      </div>
    </div>
  );
}
