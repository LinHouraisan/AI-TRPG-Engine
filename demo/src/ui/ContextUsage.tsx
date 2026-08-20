import { useMemo, useState } from "react";
import type { GameState } from "@/engine/types";
import {
  buildContext,
  CONTEXT_OMISSION,
  type ContextColumnName,
  type ContextUsage,
} from "@/keeper/context";

const COLUMN_COLOR: Record<ContextColumnName, string> = {
  场景与出口: "var(--color-ctx-scene)",
  看得见的东西: "var(--color-ctx-visible)",
  背包: "var(--color-ctx-bag)",
  在场的人: "var(--color-ctx-people)",
  已知线索: "var(--color-ctx-clues)",
  调查员: "var(--color-ctx-pc)",
  经过: "var(--color-ctx-history)",
  本回合已提交的事实: "var(--color-ctx-facts)",
  作者写好的句子: "var(--color-ctx-authored)",
};

function omissionLine(name: ContextColumnName, dropped: number): string | null {
  if (dropped <= 0) return null;
  if (name === "经过") return `${CONTEXT_OMISSION.history} ${dropped} 条`;
  if (name === "已知线索") return `${CONTEXT_OMISSION.clues} ${dropped} 条`;
  return `${name}已略去 ${dropped} 条`;
}

function pctOf(usage: ContextUsage): number {
  return usage.budgetChars > 0 ? Math.round((usage.usedChars / usage.budgetChars) * 100) : 0;
}

/**
 * 模组作者的观察窗：只读 buildContext 交出来的分栏统计和正文。
 * 不从 GameState 另取道具、线索、备注——那些路径才是泄底的后门。
 */
export function ContextUsagePanel({
  state,
  budgetChars,
  lastUsage,
}: {
  state: GameState;
  budgetChars: number;
  /** 上一回合 keeperNarrate 当时那次装配。还没提交过就是空。 */
  lastUsage: ContextUsage | null;
}) {
  const [open, setOpen] = useState(false);
  // 下一回合的事实还没发生，所以用空事件估一份即将发出去的上下文。
  const preview = useMemo(
    () => buildContext({ state, events: [], budgetChars }),
    [state, budgetChars],
  );
  const previewUsage = preview.usage;
  const headline = lastUsage
    ? `预估 ${previewUsage ? pctOf(previewUsage) : 0}% · 实发 ${pctOf(lastUsage)}%`
    : `已用 ${previewUsage ? pctOf(previewUsage) : 0}%`;

  return (
    <section className="min-w-0 overflow-x-hidden rounded-lg border border-line/60 bg-ink-2/70 backdrop-blur-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 border-b border-line/50 px-3 text-left"
      >
        <h2 className="shrink-0 text-xs font-medium tracking-widest text-brass">
          上下文用量
        </h2>
        <span className="min-w-0 truncate text-[11px] text-muted">
          {open ? "收起" : headline}
        </span>
      </button>

      {open ? (
        <div className="min-w-0 space-y-3 overflow-x-hidden p-3">
          {lastUsage && previewUsage ? (
            <ComparedUsage preview={previewUsage} last={lastUsage} previewText={preview.text} />
          ) : previewUsage ? (
            <SingleUsage
              usage={previewUsage}
              text={preview.text}
              caption="按当前场面预估下一份会发给主持人的上下文。还没提交过，所以没有上一回合实发。"
            />
          ) : (
            <p className="text-sm text-muted">分栏统计还没跟上，过一会儿再展开看。</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function SingleUsage({
  usage,
  text,
  caption,
}: {
  usage: ContextUsage;
  text: string;
  caption: string;
}) {
  const omitted = usage.columns
    .map((col) => omissionLine(col.name, col.dropped))
    .filter((line): line is string => line != null);

  return (
    <>
      <p className="text-[11px] leading-5 text-muted">{caption}</p>
      <UsageHead usage={usage} />
      <UsageBar usage={usage} />
      {omitted.length > 0 ? (
        <ul className="space-y-0.5 text-[11px] text-brass">
          {omitted.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <ul className="flex flex-col gap-1">
        {usage.columns.map((col) => (
          <li key={col.name} className="flex min-w-0 items-baseline gap-2 text-[12px]">
            <span
              className="mt-[0.2em] size-2.5 shrink-0 rounded-sm"
              style={{ background: COLUMN_COLOR[col.name] }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 break-words">{col.name}</span>
            <span className="shrink-0 tabular-nums text-muted">{col.chars}</span>
          </li>
        ))}
      </ul>
      <PreviewBody text={text} />
    </>
  );
}

function ComparedUsage({
  preview,
  last,
  previewText,
}: {
  preview: ContextUsage;
  last: ContextUsage;
  previewText: string;
}) {
  const previewOmitted = preview.columns
    .map((col) => omissionLine(col.name, col.dropped))
    .filter((line): line is string => line != null);
  const lastOmitted = last.columns
    .map((col) => omissionLine(col.name, col.dropped))
    .filter((line): line is string => line != null);

  return (
    <>
      <p className="text-[11px] leading-5 text-muted">
        左边是按当前场面预估的下一份，右边是上一回合真正发给主持人的那一份。
        两栏都是装配结果，不是折算。
      </p>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <div className="mb-1 text-muted">预估</div>
          <UsageHead usage={preview} />
          <UsageBar usage={preview} />
        </div>
        <div>
          <div className="mb-1 text-brass">上一回合实发</div>
          <UsageHead usage={last} />
          <UsageBar usage={last} />
        </div>
      </div>

      {previewOmitted.length > 0 || lastOmitted.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 text-[11px] text-brass">
          <ul className="space-y-0.5">
            {previewOmitted.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <ul className="space-y-0.5">
            {lastOmitted.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="flex flex-col gap-1">
        <li className="flex min-w-0 items-baseline gap-2 text-[11px] text-muted">
          <span className="size-2.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1" />
          <span className="w-10 shrink-0 text-right">预估</span>
          <span className="w-10 shrink-0 text-right text-brass">实发</span>
        </li>
        {preview.columns.map((col, index) => {
          const actual = last.columns[index];
          return (
            <li key={col.name} className="flex min-w-0 items-baseline gap-2 text-[12px]">
              <span
                className="mt-[0.2em] size-2.5 shrink-0 rounded-sm"
                style={{ background: COLUMN_COLOR[col.name] }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 break-words">{col.name}</span>
              <span className="w-10 shrink-0 text-right tabular-nums text-muted">{col.chars}</span>
              <span className="w-10 shrink-0 text-right tabular-nums">{actual?.chars ?? 0}</span>
            </li>
          );
        })}
      </ul>

      <PreviewBody text={previewText} />
    </>
  );
}

function UsageHead({ usage }: { usage: ContextUsage }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[12px]">
      <span>已用 {pctOf(usage)}%</span>
      <span className="tabular-nums text-muted">
        约 {usage.usedChars} / {usage.budgetChars} 字
      </span>
    </div>
  );
}

function UsageBar({ usage }: { usage: ContextUsage }) {
  const denom = Math.max(usage.usedChars, usage.budgetChars, 1);
  return (
    <div className="mt-1 flex h-2 w-full min-w-0 overflow-hidden rounded-full bg-ink-3" aria-hidden>
      {usage.columns.map((col) =>
        col.chars > 0 ? (
          <div
            key={col.name}
            title={`${col.name} ${col.chars} 字`}
            className="h-full shrink-0"
            style={{
              width: `${(col.chars / denom) * 100}%`,
              background: COLUMN_COLOR[col.name],
            }}
          />
        ) : null,
      )}
    </div>
  );
}

function PreviewBody({ text }: { text: string }) {
  return (
    <details className="min-w-0">
      <summary className="flex min-h-11 cursor-pointer items-center text-[11px] text-muted">
        预览正文
      </summary>
      <pre className="mt-1 max-h-48 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-muted">
        {text}
      </pre>
    </details>
  );
}
