import { useState } from "react";
import { difficultyLabel, skillBands } from "@/engine/rules";
import type { CheckResult } from "@/engine/types";
import type { PendingCheck } from "./pending";

export function CheckPrimer({
  skillValue,
  difficulty,
  threshold,
}: {
  skillValue: number;
  difficulty?: CheckResult["difficulty"];
  threshold?: number;
}) {
  const bands = skillBands(skillValue);
  return (
    <div className="space-y-1 text-[12px] leading-5 text-muted">
      <p>
        普通看技能值 {bands.regular}，困难看一半 {bands.hard}，极难看五分之一{" "}
        {bands.extreme}。
      </p>
      <p>
        大成功只看掷出 1。大失败：掷点 ≥ {bands.fumbleFloor}。
      </p>
      {difficulty && threshold != null ? (
        <p>
          本局按{difficultyLabel(difficulty)}难度，过线看 {threshold}。
        </p>
      ) : null}
    </div>
  );
}

export function PendingCheckNote({ check }: { check: PendingCheck }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="mt-1 flex min-h-11 w-full items-center justify-between text-left text-[11px] text-muted transition hover:text-brass"
      >
        <span>检定怎么算</span>
        <span>{open ? "收起" : "展开"}</span>
      </button>
      {open ? (
        <CheckPrimer
          skillValue={check.skillValue}
          difficulty={check.difficulty}
          threshold={check.threshold}
        />
      ) : null}
    </div>
  );
}

/**
 * 检定尺必须能自证：玩家看见的是规则门槛，不是主持人改过的数。
 * 点数只在已经掷出之后才画上去。
 */
export function CheckCard({ check }: { check: CheckResult }) {
  const [open, setOpen] = useState(false);
  const good = check.ok;

  return (
    <div
      className={`mt-2 overflow-hidden rounded-md border ${
        good ? "border-moss/50" : "border-blood/50"
      } bg-ink-3/60`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1.5 text-xs">
        <span className="tracking-wider text-muted">
          {check.skill} · {difficultyLabel(check.difficulty)}难度
        </span>
        <span className={good ? "text-moss" : "text-blood"}>{check.level}</span>
      </div>
      <div className="flex flex-wrap items-end gap-4 px-3 pb-2">
        <div>
          <div className="text-2xl leading-none tabular-nums">{check.roll}</div>
          <div className="text-[11px] text-muted">1d100 掷出</div>
        </div>
        <div>
          <div className="text-2xl leading-none tabular-nums text-muted">{check.threshold}</div>
          <div className="text-[11px] text-muted">
            {difficultyLabel(check.difficulty)}门槛
          </div>
        </div>
        <div className="ml-auto text-right text-[11px] text-muted">
          技能值 {check.skillValue}
        </div>
      </div>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between border-t border-line/40 px-3 text-left text-[11px] text-muted transition hover:text-brass"
      >
        <span>这局门槛怎么算</span>
        <span>{open ? "收起" : "展开"}</span>
      </button>

      {open ? (
        <div className="border-t border-line/30 px-3 py-2">
          <CheckPrimer
            skillValue={check.skillValue}
            difficulty={check.difficulty}
            threshold={check.threshold}
          />
        </div>
      ) : null}
    </div>
  );
}

