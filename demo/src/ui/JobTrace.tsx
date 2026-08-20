import type { JobStage, JobTrace } from "@/ai/trace";

const KIND_LABEL: Record<JobStage["kind"], string> = {
  program: "程序",
  model: "模型",
  skipped: "跳过",
};

const KIND_CLASS: Record<JobStage["kind"], string> = {
  program: "border-line/70 text-muted",
  model: "border-moss/60 text-moss",
  skipped: "border-line/40 text-muted/70",
};

/**
 * Debug view of after-commit Information / Director / Memory.
 * Hidden unless the host options checkbox is on. Does not write facts.
 */
export function JobTracePanel({ trace }: { trace: JobTrace | null }) {
  if (!trace) {
    return (
      <section className="min-w-0 rounded-lg border border-line/60 bg-ink-2/70">
        <h2 className="border-b border-line/50 px-3 py-2 text-xs font-medium tracking-widest text-brass">
          后台任务
        </h2>
        <p className="p-3 text-[12px] leading-5 text-muted">
          还没有提交过。提交之后这里画出 Information → Director → Memory 这一条冷路径。
        </p>
      </section>
    );
  }

  return (
    <section className="min-w-0 rounded-lg border border-line/60 bg-ink-2/70">
      <header className="flex items-baseline justify-between gap-2 border-b border-line/50 px-3 py-2">
        <h2 className="text-xs font-medium tracking-widest text-brass">后台任务</h2>
        <span className="text-[11px] tabular-nums text-muted">
          v{trace.stateVersion} · 回合 {trace.turn}
          {trace.livePending ? " · 模型排队" : ""}
        </span>
      </header>

      <div className="space-y-3 p-3">
        <p className="text-[11px] leading-5 text-muted">
          不挡玩家。热路径已经提交。
          {trace.source === "desktop-replay" ? " 桌面权威在主进程，此面板是渲染进程旁路重算。" : ""}
        </p>

        <ol className="flex flex-wrap items-stretch gap-1">
          {trace.stages.map((stage, index) => (
            <li key={stage.id} className="flex min-w-0 items-stretch gap-1">
              {index > 0 ? (
                <span className="self-center text-[11px] text-muted" aria-hidden>
                  →
                </span>
              ) : null}
              <StageCard stage={stage} />
            </li>
          ))}
        </ol>

        <div className="grid gap-2 md:grid-cols-3">
          <InfoCard trace={trace} />
          <DirectorCard trace={trace} />
          <MemoryCard trace={trace} />
        </div>

        <ContextCard trace={trace} />
        <StoryCard trace={trace} />
      </div>
    </section>
  );
}

function StageCard({ stage }: { stage: JobStage }) {
  return (
    <div className={`min-w-[5.5rem] rounded border px-1.5 py-1 ${KIND_CLASS[stage.kind]}`}>
      <div className="text-[10px] tracking-wide">{KIND_LABEL[stage.kind]}</div>
      <div className="text-[11px] leading-4 text-paper">{stage.label}</div>
      <div className="text-[10px] leading-4 text-muted">{stage.detail}</div>
    </div>
  );
}

function InfoCard({ trace }: { trace: JobTrace }) {
  const { plan, proposals, usedModel } = trace.information;
  return (
    <article className="rounded border border-line/50 p-2 text-[11px]">
      <h3 className="text-brass">Information</h3>
      <p className="mt-1 text-muted">{usedModel ? "模型改过计划" : "确定性计划"}</p>
      <IdList label="load" ids={plan.load} />
      <IdList label="preload" ids={plan.preload} />
      <IdList label="drop" ids={plan.drop} />
      <p className="mt-1 text-muted">提案 {proposals.length}（confirmed 全是 false）</p>
      <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-paper/90">
        {proposals.slice(0, 8).map((item, index) => (
          <li key={`${item.summary}-${index}`}>
            {item.kind} · {item.summary}
          </li>
        ))}
      </ul>
    </article>
  );
}

function DirectorCard({ trace }: { trace: JobTrace }) {
  const { director } = trace;
  const f = director.frontier;
  return (
    <article className="rounded border border-line/50 p-2 text-[11px]">
      <h3 className="text-brass">Director</h3>
      <p className="mt-1 text-muted">
        {director.due ? (director.usedModel ? "Monitor 叫了，模型答了" : "Monitor 叫了，程序重建 Frontier") : "未触发"}
      </p>
      <p className="mt-1 tabular-nums">
        活跃 {f.activeArcIds.length} · 受阻 {f.blockedArcIds.length} · 休眠 {f.dormantArcIds.length}
      </p>
      <p className="text-muted">机会 {director.opportunities.length} · 版本 {f.basedOnStateVersion}</p>
      <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto">
        {director.opportunities.map((item) => (
          <li key={item.opportunityId}>
            {item.kind} · {item.gmGuidance.opportunity}
          </li>
        ))}
      </ul>
    </article>
  );
}

function MemoryCard({ trace }: { trace: JobTrace }) {
  const { memory } = trace;
  return (
    <article className="rounded border border-line/50 p-2 text-[11px]">
      <h3 className="text-brass">Memory</h3>
      <p className="mt-1 text-muted">{memory.usedModel ? "语义通道走了模型" : "只走 fact delta"}</p>
      <p className="mt-1 tabular-nums">
        raw {memory.cursor.rawRecordedThroughTurn} · processed {memory.cursor.memoryProcessedThroughTurn}
      </p>
      <p>active {memory.active}</p>
      <ul className="mt-1 text-muted">
        {Object.entries(memory.byType).map(([type, count]) => (
          <li key={type}>
            {type} {count}
          </li>
        ))}
      </ul>
      <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-paper/90">
        {memory.sample.map((entry) => (
          <li key={entry.id} title={entry.sources.join(",")}>
            {entry.memoryType} · {entry.summary}
          </li>
        ))}
      </ul>
    </article>
  );
}

function ContextCard({ trace }: { trace: JobTrace }) {
  const { context } = trace;
  return (
    <article className="rounded border border-line/50 p-2 text-[11px]">
      <h3 className="text-brass">Active Context</h3>
      <p className="mt-1 tabular-nums text-muted">
        current {context.current} · preparing {context.preparing}
      </p>
      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-ink-3" aria-hidden>
        <Bar n={context.byRetention.required} total={context.current} color="var(--color-brass)" />
        <Bar n={context.byRetention.optional} total={context.current} color="var(--color-moss)" />
        <Bar n={context.byRetention.prefetch} total={context.current} color="var(--color-ctx-history)" />
      </div>
      <p className="mt-1 text-muted">
        required {context.byRetention.required} · optional {context.byRetention.optional} · prefetch{" "}
        {context.byRetention.prefetch}
      </p>
    </article>
  );
}

function StoryCard({ trace }: { trace: JobTrace }) {
  const { story } = trace;
  return (
    <article className="rounded border border-line/50 p-2 text-[11px]">
      <h3 className="text-brass">Story Monitor</h3>
      <p className="mt-1 text-muted">
        directorDue {story.directorDue ? "是" : "否"} · 停滞 {story.turnsSinceProgress} 回合
      </p>
      <p>
        可达 {story.structurallyReachable} · 受阻线 {story.blockedArcs} · 线索缺口 {story.clueGaps}
      </p>
      <p className="mt-1 break-all text-muted">
        变化节点 {story.changedNodeIds.join(", ") || "无"}
      </p>
    </article>
  );
}

function IdList({ label, ids }: { label: string; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <p className="mt-1 break-all">
      <span className="text-muted">{label}</span> {ids.slice(0, 12).join(" ")}
      {ids.length > 12 ? ` +${ids.length - 12}` : ""}
    </p>
  );
}

function Bar({ n, total, color }: { n: number; total: number; color: string }) {
  if (n <= 0 || total <= 0) return null;
  return <div className="h-full shrink-0" style={{ width: `${(n / total) * 100}%`, background: color }} />;
}
